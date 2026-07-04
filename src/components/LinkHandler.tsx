/**
 * LinkHandler — Markdown 链接处理器 (契约 4 / FR-06/13/14/16/17).
 *
 * 设计依据: docs/design/compiled.md §3.5.1 + §3.8 契约 4 + 设计 §3.10 事件流 +
 *   T19 §3.1 强化 (FR-01/FR-05/FR-06 落地).
 *
 * 责任 (T19):
 *   - 渲染时: 先经 urlSafe() 校验 href; 危险协议 / 空 href 改写为 '#'
 *   - 点击: preventDefault + 分发
 *     - 危险协议 (kind=inert && !safe): 5s 合并去重后 pushToast('toast.link.blocked') + 标准化 warn
 *     - 锚点 (#xxx / '' / '#'): scrollIntoView + history.replaceState + warn-if-missing
 *     - 修饰键 (Ctrl/Cmd/Shift/Alt) + external: window.open(url, '_blank', 'noopener,noreferrer')
 *     - 外链 (http/https/mailto/tel): 通过 openExternalUrl 包装调 IPC + 更新 inlineStore
 *     - 相对路径 (.md): 文本中 md 链接视为 in-app 跳转 (host 空, 不发 IPC)
 *   - 强制外链 rel="noopener noreferrer" (AC-14-5 / NFR-S-03)
 *
 * 不调 IPC:
 *   - 通过 lib/tauri.openExternalUrl 包装调用.
 *   - 通过 useInlineStore 更新 UI 反馈.
 */
import { useMemo, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { urlSafe } from '../lib/inline/urlSafe';
import { slugify } from '../lib/inline/slugify';
import { openExternalUrl } from '../lib/tauri';
import { useInlineStore } from '../stores/inlineStore';
import { pushToast } from '../lib/toast';

export interface LinkHandlerProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href?: string;
  children?: ReactNode;
  /** react-markdown 透传的节点 (未使用, 占位). */
  node?: unknown;
}

/** 5s 合并去重窗口 (AC-06-2): 同 reason 在 5s 内仅触发 1 次 toast.
 *  模块级 Map, 单例共享, 测试可通过 vi.resetModules() 重置. */
const DEBOUNCE_WINDOW_MS = 5_000;
const recentlyBlocked = new Map<string, number>();

/** shouldEmitToast — 5s 合并去重门控. 返回 true 表示应 pushToast, false 表示跳过.
 *  @param reason 协议拒绝 reason (如 'protocol:javascript')
 *  @param now 当前时间戳 (ms); 测试可注入固定值. */
export function shouldEmitToast(reason: string, now: number): boolean {
  const last = recentlyBlocked.get(reason);
  if (last !== undefined && now - last < DEBOUNCE_WINDOW_MS) {
    return false;
  }
  recentlyBlocked.set(reason, now);
  return true;
}

/** 重置模块级最近拒绝 Map. 供单测注入. */
export function __resetBlockedCache(): void {
  recentlyBlocked.clear();
}

/** buildBlockWarn — 标准化控制台 warn (NFR-M-01 / AC-06-3).
 *  href 截断 200 字符, 防止长 payload 撑爆终端日志.
 *  格式: `[<source>] blocked unsafe href: reason=<r> href=<h(≤200)> source=<s>`. */
export function buildBlockWarn(
  source: 'LinkHandler' | 'MarkdownRenderer',
  href: string,
  reason: string,
): string {
  const truncated = href.length > 200 ? `${href.slice(0, 200)}…` : href;
  return `[${source}] blocked unsafe href: reason=${reason} href=${truncated} source=${source}`;
}

/** detectModifiers — 修饰键检测. 任一 Ctrl/Cmd/Shift/Alt 按下即 true. */
function detectModifiers(e: MouseEvent): boolean {
  return e.ctrlKey || e.metaKey || e.shiftKey || e.altKey;
}

/** openInNewTab — 浏览器原生新标签页 (FR-05 / AC-05-1). */
function openInNewTab(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function LinkHandler(props: LinkHandlerProps): JSX.Element {
  const { href, children, title, node: _node, ...rest } = props;
  const setExternal = useInlineStore((s) => s.setExternal);
  const pushTooltip = useInlineStore((s) => s.pushTooltip);
  const { t } = useTranslation();

  // 1) 渲染时校验 href (契约 4 / AC-06-4/5/6).
  const check = useMemo(() => urlSafe(href ?? ''), [href]);
  const safeHref = check.href;

  // 2) 点击处理.
  const onClick = (e: MouseEvent<HTMLAnchorElement>): void => {
    e.preventDefault();
    e.stopPropagation();

    const url = check.href;
    const rawHref = href ?? '';

    // 2a) 危险协议 / data-html: 5s 合并去重 toast + 标准化 warn (FR-06 / AC-06-1/2/3)
    if (!check.safe && check.kind === 'inert') {
      const reason = check.reason ?? 'unknown';
      const now = Date.now();
      if (shouldEmitToast(reason, now)) {
        pushToast({ kind: 'error', message: t('toast.link.blocked') });
      }
      console.warn(buildBlockWarn('LinkHandler', rawHref, reason));
      return;
    }

    // 2b) 锚点 (#xxx / '' / '#')
    if (check.kind === 'anchor') {
      const raw = rawHref;
      const hash = raw.startsWith('#') ? raw.slice(1) : '';
      const id = hash.length === 0 ? '' : slugify(hash);
      // 空 hash → 静默滚动到顶部或无操作 (AC-13-4)
      if (id.length === 0) {
        window.history.replaceState(null, '', '#');
        return;
      }
      const target = document.getElementById(id);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        window.history.replaceState(null, '', `#${id}`);
      } else {
        // 锚点未命中: 静默更新 hash + warn (AC-11-3)
        window.history.replaceState(null, '', `#${id}`);
        console.warn(`[LinkHandler] anchor not found: ${id}`);
      }
      return;
    }

    // 2c) 相对路径 (.md / .png 等): host 空, 不发 IPC.
    //    文本中 md 链接 → 在更上层 docStore 触发 reader 加载 (本组件不接管,
    //    留给 reader 层 useMarkdownDoc / 后续 T 任务).
    if (check.kind === 'relative') {
      return;
    }

    // 2d) external: 修饰键优先 → window.open; 否则 IPC.
    //     data: 图片不在 <a> 中唤起浏览器 (在 2e 分支处理).
    if (check.kind === 'external') {
      // 修饰键命中 → 浏览器原生新标签页 (FR-05 / AC-05-1); 不调 IPC.
      if (detectModifiers(e)) {
        openInNewTab(url);
        return;
      }
      // 先更新 UI 反馈 (FR-16 状态栏 / FR-17 tooltip),
      // 再 fire-and-forget IPC (失败不阻塞 UI).
      if (check.host) {
        setExternal(check.host, url);
      }
      pushTooltip({ x: e.clientX, y: e.clientY, url });
      void openExternalUrl(url).catch((err) => {
        console.warn('[LinkHandler] open_external_url failed:', err);
      });
      return;
    }

    // 2e) data: 图片, 不在 <a> 中唤起浏览器 — 静默.
    if (check.kind === 'data') {
      return;
    }
  };

  // 3) 强制 rel (AC-14-5 / NFR-S-03): 所有外链 <a> 都带 noopener noreferrer.
  const computedRel = typeof rest.rel === 'string' ? rest.rel : 'noopener noreferrer';
  const finalRel = computedRel.includes('noopener') && computedRel.includes('noreferrer')
    ? computedRel
    : 'noopener noreferrer';

  return (
    <a
      href={safeHref}
      title={title}
      rel={finalRel}
      target={check.kind === 'external' ? '_blank' : undefined}
      onClick={onClick}
      {...rest}
    >
      {children}
    </a>
  );
}

export default LinkHandler;
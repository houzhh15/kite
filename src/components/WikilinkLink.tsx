/**
 * WikilinkLink — wikilink 点击行为封装 (T28 / F-46 / FR-03 / FR-06).
 *
 * 设计依据: docs/design/compiled.md §3.3.
 *
 * 责任:
 *   - 渲染 <button type="button" role="link"> 作为可点击 UI (键盘 Tab + Enter 默认支持).
 *   - onClick 流程 (FR-03 + AC-03-1..5 / AC-06-1..5):
 *       1) preventDefault + stopPropagation
 *       2) 逐层假设 vaultRoot (T28 增量):
 *            取 currentPath, 调用 probeVaultRootCandidates → string[]
 *            (例: /A/B/C/D.md → ['/A/B/C', '/A/B', '/A', '/']).
 *          顺序遍历每个候选:
 *            a) resolveWikilinkTarget({ target, vaultRoot: candidate, anchor })
 *               security-violation → 静默 noop (AC-03-4)
 *               not-configured → 跳过 (理论上不会发生, 候选非空)
 *            b) await pathExists(absPath) (Tauri IPC, 轻量级 fs::metadata).
 *               true → 立即 break, 进入 step 3
 *               false → 继续下一个候选
 *          所有候选均 false → pushToast(t('toast.wikilink.targetNotFound')) + return
 *          currentPath 为 null (无文件打开) → 弹 vaultNotConfigured toast + return
 *       3) loadFile(absPath) — 通过 loadFileRef 拿到 App.tsx 的实例
 *       4) anchor 滚动 — 双 RAF 后 scrollIntoView; 不命中 → console.warn
 *
 * 错误映射 (FR-06):
 *   - loadFile 抛 NOT_FOUND → 走 docStore.loadFile 内部统一映射 (pushToast message.fileNotFound);
 *     currentPath / history 不变.
 *   - loadFile 抛 IO → pushToast message.ioError.
 *   - anchor 不命中 → console.warn('[WikilinkLink] anchor not found: <slug>').
 *
 * 纪律:
 *   - 不调 IPC except pathExists / loadFile.
 *   - 不订阅 store; 通过 getState() 同步取 currentPath.
 *   - React.memo 包裹 (NFR-01).
 */
import { memo, useCallback, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { resolveWikilinkTarget, probeVaultRootCandidates } from '../lib/wikilink/resolveWikilinkTarget';
import { useDocStore } from '../stores/docStore';
import { pushToast } from '../lib/toast';
import { slugify } from '../lib/inline/slugify';
import { readWikilinkLoadFile } from '../lib/wikilink/loadFileRef';
import { pathExists } from '../lib/tauri';
import type { WikilinkLinkProps } from '../lib/wikilink/types';

function WikilinkLinkInner(props: WikilinkLinkProps): JSX.Element {
  const { target, anchor, alias, children } = props;
  const { t } = useTranslation();

  const onClick = useCallback(
    async (e: MouseEvent<HTMLButtonElement>): Promise<void> => {
      e.preventDefault();
      e.stopPropagation();

      // 1) 同步取 currentPath, 派生候选 vaultRoot 列表.
      const currentPath = useDocStore.getState().state.currentPath;
      const candidates = probeVaultRootCandidates(currentPath);
      if (candidates.length === 0) {
        // AC-06-1: 没有打开的文件, 无法猜测 vaultRoot → toast 提示去设置.
        pushToast({ kind: 'error', message: t('toast.wikilink.vaultNotConfigured') });
        return;
      }

      // 2) 逐层探测: 取第一个 pathExists 为 true 的候选.
      // 探测策略 (T28 / F-46 / FR-03 增量):
      //   - 当前目录 → 父目录 → ... → 根 (按路径段数动态).
      //   - 每个候选先尝试 resolveWikilinkTarget (自动补 .md + 5 重安全网关).
      //   - 命中即 break.
      //   - 全部失败 → pushToast(t('toast.wikilink.targetNotFound')) + return.
      let resolved: { absPath: string; anchor?: string } | null = null;
      for (const candidate of candidates) {
        const r = resolveWikilinkTarget({ target, vaultRoot: candidate, anchor });
        if (!r.ok) {
          // security-violation: 跳过 (防探测, AC-03-4)
          continue;
        }
        // 轻量级 IPC: 仅 fs::metadata, 4-10ms.
        // NFR-S-01: pathExists 永不抛错, 只返回 true/false.
        let exists = false;
        try {
          exists = await pathExists(r.absPath);
        } catch {
          exists = false;
        }
        if (exists) {
          resolved = { absPath: r.absPath, anchor: r.anchor };
          break;
        }
      }

      // R-29 调试: 当 per-level 探测失败时, console.warn 输出全部尝试过的路径, 帮用户排查.
      // 这是 R-04 缓解 (NFR-12 调试可观测性): 不弹 toast (已经弹了), 仅在 dev tools 可见.
      if (resolved === null && candidates.length > 0) {
        const attempted: string[] = [];
        for (const candidate of candidates) {
          const r = resolveWikilinkTarget({ target, vaultRoot: candidate, anchor });
          if (r.ok) attempted.push(r.absPath);
        }
        console.warn(
          `[WikilinkLink] targetNotFound: target=${JSON.stringify(target)} ` +
            `currentPath=${JSON.stringify(currentPath)} attempted=${JSON.stringify(attempted)}`,
        );
      }

      if (resolved === null) {
        // AC-06: 全部候选都不存在 → toast 提示.
        pushToast({
          kind: 'error',
          message: t('toast.wikilink.targetNotFound', { target }),
        });
        return;
      }

      // 3) loadFile — 通过 loadFileRef 拿到 App.tsx 的 useMarkdownDoc.loadFile.
      //   跨目录 / 同目录判定: T15 pushHistory 截断语义已统一处理, 此处不分支.
      const loadFile = readWikilinkLoadFile();
      if (!loadFile) {
        // App 未挂载 (测试 / SSR / 极端场景) → 静默 noop.
        return;
      }
      try {
        await loadFile(resolved.absPath);
      } catch {
        // useMarkdownDoc.loadFile 内部已 pushToast; currentPath / history 由 docStore 截断保持.
        // 此处不重复抛错 / 不重弹 toast.
        return;
      }

      // 4) anchor 滚动 (双 RAF, AC-03-2 / AC-06-4).
      if (resolved.anchor) {
        const slug = slugify(resolved.anchor);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const el = document.getElementById(slug);
            if (el) {
              el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } else {
              // AC-06-4: anchor 不命中 → console.warn, 不弹 toast.
              console.warn(`[WikilinkLink] anchor not found: ${slug}`);
            }
          });
        });
      }
    },
    [target, anchor, t],
  );

  const displayText = (children as string) ?? alias ?? target;
  const ariaLabel =
    alias && alias !== target
      ? `${t('common.open')}: ${alias}`
      : `${t('common.open')}: ${target}`;

  return (
    <button
      type="button"
      role="link"
      data-wikilink={target}
      {...(anchor !== undefined ? { 'data-anchor': anchor } : {})}
      {...(alias !== undefined ? { 'data-alias': alias } : {})}
      aria-label={ariaLabel}
      onClick={onClick}
      className="wikilink rounded px-0.5 text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      {displayText}
    </button>
  );
}

export const WikilinkLink = memo(WikilinkLinkInner);

export default WikilinkLink;
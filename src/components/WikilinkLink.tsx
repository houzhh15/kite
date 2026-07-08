/**
 * WikilinkLink — wikilink 点击行为封装 (T28 / F-46 / FR-03 / FR-06).
 *
 * 设计依据: docs/design/compiled.md §3.3.
 *
 * 责任:
 *   - 渲染 <button type="button" role="link"> 作为可点击 UI (键盘 Tab + Enter 默认支持).
 *   - onClick 流程 (FR-03 + AC-03-1..5 / AC-06-1..5):
 *       1) preventDefault + stopPropagation
 *       2) 取 vaultRoot (同步, 通过 deriveVaultRoot + usePrefStore + useDocStore.getState)
 *          root === null → pushToast(t('toast.wikilink.vaultNotConfigured')) + return
 *       3) resolveWikilinkTarget({ target, vaultRoot, anchor })
 *          security-violation → 静默 noop (防探测)
 *          not-configured → 已在前置拦截
 *       4) loadFile(absPath) — 通过 loadFileRef 拿到 App.tsx 的实例
 *       5) anchor 滚动 — 双 RAF 后 scrollIntoView; 不命中 → console.warn
 *
 * 错误映射 (FR-06):
 *   - loadFile 抛 NOT_FOUND → 走 docStore.loadFile 内部统一映射 (pushToast message.fileNotFound);
 *     currentPath / history 不变.
 *   - loadFile 抛 IO → pushToast message.ioError.
 *   - anchor 不命中 → console.warn('[WikilinkLink] anchor not found: <slug>').
 *
 * 纪律:
 *   - 不调 IPC (IPC 由 useMarkdownDoc.loadFile 内部调).
 *   - 不订阅 store; 通过 getState() 同步取 currentPath / root.
 *   - React.memo 包裹 (NFR-01).
 */
import { memo, useCallback, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { resolveWikilinkTarget } from '../lib/wikilink/resolveWikilinkTarget';
import { deriveVaultRoot } from '../lib/wikilink/vaultRoot';
import { usePrefStore } from '../stores/prefStore';
import { useDocStore } from '../stores/docStore';
import { pushToast } from '../lib/toast';
import { slugify } from '../lib/inline/slugify';
import { readWikilinkLoadFile } from '../lib/wikilink/loadFileRef';
import type { WikilinkLinkProps } from '../lib/wikilink/types';

function WikilinkLinkInner(props: WikilinkLinkProps): JSX.Element {
  const { target, anchor, alias, children } = props;
  const { t } = useTranslation();

  const onClick = useCallback(
    async (e: MouseEvent<HTMLButtonElement>): Promise<void> => {
      e.preventDefault();
      e.stopPropagation();

      // 1) 取 root (同步, 不订阅)
      const mode = usePrefStore.getState().prefs.vaultRootMode;
      const customPath = usePrefStore.getState().prefs.vaultRootCustom;
      const currentPath = useDocStore.getState().state.currentPath;
      const root = deriveVaultRoot(mode, customPath, currentPath);

      if (root === null) {
        // AC-06-1: vaultRoot=null → toast (5s 合并去重由 toast UI 自动 TTL 保证;
        // wikilink 与 LinkHandler 共享 link 类文案路径, 由 UI 自动清空).
        pushToast({ kind: 'error', message: t('toast.wikilink.vaultNotConfigured') });
        return;
      }

      // 2) resolve
      const r = resolveWikilinkTarget({ target, vaultRoot: root, anchor });
      if (!r.ok) {
        // security-violation / not-configured → 静默 noop (防探测, AC-03-4 / AC-06-2)
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
        await loadFile(r.absPath);
      } catch {
        // useMarkdownDoc.loadFile 内部已 pushToast; currentPath / history 由 docStore 截断保持.
        // 此处不重复抛错 / 不重弹 toast.
        return;
      }

      // 4) anchor 滚动 (双 RAF, AC-03-2 / AC-06-4).
      if (r.anchor) {
        const slug = slugify(r.anchor);
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
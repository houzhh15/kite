/**
 * WikilinkNode — react-markdown 自定义 wikilink 节点组件 (T28 / F-46 / FR-02).
 *
 * 设计依据: docs/design/compiled.md §3.2.
 *
 * 责任:
 *   - 消费 react-markdown 透传的 `data-wikilink` / `data-anchor` / `data-alias` props.
 *   - 根据 `useVaultRoot().root` 决定渲染分支:
 *       root !== null → <WikilinkLink> 可点击 (FR-03 接管 onClick)
 *       root === null → <span aria-disabled="true" title=...> 降级静态文本 (AC-02-3)
 *   - 不调 IPC; 不调 useMarkdownDoc.loadFile (由 WikilinkLink 内部调).
 *   - React.memo 包裹 (NFR-01): content / props 不变不重渲.
 *
 * 纪律:
 *   - 仅消费 T27 useVaultRoot; 不订阅 docStore; 不调 setVaultRootMode.
 *   - a11y: 可点击态用 <button role="link"> (键盘 Tab + Enter 默认支持);
 *           降级态用 <span aria-disabled="true"> + title 提示.
 */
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { WikilinkLink } from './WikilinkLink';
import { useVaultRoot } from '../lib/wikilink/vaultRoot';
import type { WikilinkNodeProps } from '../lib/wikilink/types';

function WikilinkNodeInner(props: WikilinkNodeProps): JSX.Element {
  const { 'data-wikilink': target, 'data-anchor': anchor, 'data-alias': alias, children } = props;
  const { t } = useTranslation();
  let root: string | null = null;
  try {
    root = useVaultRoot().root;
  } catch (err) {
    // AC-02-4: useVaultRoot 抛错 mock 时渲染降级 + console.error 一次.
    console.error('[WikilinkNode] useVaultRoot failed:', err);
    root = null;
  }

  // 缺 target 时不渲染任何内容 (防御性, react-markdown 不会传空值).
  if (typeof target !== 'string' || target.length === 0) {
    return <span className="text-muted">{(children as string) ?? ''}</span>;
  }

  if (root === null) {
    // 降级: aria-disabled + title 提示.
    return (
      <span
        data-wikilink={target}
        aria-disabled="true"
        title={t('toast.wikilink.vaultNotConfigured')}
        className="wikilink-disabled cursor-not-allowed text-muted"
      >
        {children}
      </span>
    );
  }

  return (
    <WikilinkLink target={target} anchor={anchor} alias={alias}>
      {children}
    </WikilinkLink>
  );
}

export const WikilinkNode = memo(WikilinkNodeInner);

export default WikilinkNode;
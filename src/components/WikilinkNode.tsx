/**
 * WikilinkNode — react-markdown 自定义 wikilink 节点组件 (T28 / F-46 / FR-02).
 *
 * 设计依据: docs/design/compiled.md §3.2.
 *
 * 责任:
 *   - 消费 react-markdown 透传的 `data-wikilink` / `data-anchor` / `data-alias` props.
 *   - 始终渲染为 <WikilinkLink> 可点击按钮 (统一的链接视觉).
 *   - vaultRoot 缺失时的错误处理下沉到 WikilinkLink.onClick: 点击时同步取
 *     `useDocStore.getState().state.currentPath` + `usePrefStore.getState().prefs`,
 *     派生 root; root === null → pushToast 提示去设置 (AC-06-1).
 *   - 这样可以保证:
 *       1) 所有 wikilink 视觉上一致, 都是 text-accent + hover:underline (不被误认为
 *          "文字而非链接" / "禁止点击").
 *       2) 点击总是有反馈 (要么跳转, 要么 toast), 不会出现 "点了无反应" 状态.
 *   - 不调 IPC; 不调 useMarkdownDoc.loadFile (由 WikilinkLink 内部调).
 *   - React.memo 包裹 (NFR-01): content / props 不变不重渲.
 *
 * 纪律:
 *   - 仅消费 T27 useVaultRoot 用于 prop drilling (alias / target); 不订阅 docStore;
 *     不调 setVaultRootMode.
 *   - a11y: 可点击态用 <button role="link"> (键盘 Tab + Enter 默认支持);
 *           WikilinkLink 内部已处理 disabled/aria-label 语义.
 *   - R-25 修复: hName 改为 'wikilink' (非 'span'), 匹配 components map key,
 *     否则 vite/rollup 会 tree-shake 删除本组件.
 *   - R-26 修复: 始终渲染 WikilinkLink, 不分支成 disabled span — 用户在
 *     follow-current 模式下但 currentPath=null 时 (如新装 app 未打开任何文件)
 *     仍可点击 → 触发 toast 引导去设置 vaultRoot.
 */
import { memo } from 'react';

import { WikilinkLink } from './WikilinkLink';
import type { WikilinkNodeProps } from '../lib/wikilink/types';

function WikilinkNodeInner(props: WikilinkNodeProps): JSX.Element {
  const { 'data-wikilink': target, 'data-anchor': anchor, 'data-alias': alias, children } = props;

  // 缺 target 时不渲染任何内容 (防御性, react-markdown 不会传空值).
  if (typeof target !== 'string' || target.length === 0) {
    return <span className="text-muted">{(children as string) ?? ''}</span>;
  }

  // 始终渲染为可点击链接按钮. vaultRoot 缺失时的错误处理在 WikilinkLink.onClick 内部.
  return (
    <WikilinkLink target={target} anchor={anchor} alias={alias}>
      {children}
    </WikilinkLink>
  );
}

export const WikilinkNode = memo(WikilinkNodeInner);

export default WikilinkNode;
/**
 * src/lib/wikilink/types.ts — wikilink 节点公共类型 (T28 / F-46).
 *
 * 设计依据: docs/design/compiled.md §3.2.2 + §3.3.3.
 *
 * 责任:
 *   - 集中声明 WikilinkNode (react-markdown 透传 props) 与 WikilinkLink (业务 props).
 *   - 三层组件 (remarkWikilink → WikilinkNode → WikilinkLink) 通过 props 透传,
 *     不互调; types 集中维护便于后续扩展 (例如 anchor 信息扩展).
 *
 * 纪律:
 *   - 纯类型; 无副作用; 不依赖 React / store.
 *   - 与 design §3.6.2 / §3.6.3 接口契约一致.
 */
import type { ReactNode } from 'react';

/**
 * WikilinkNodeProps — 由 react-markdown 透传的 hast 节点属性.
 *
 * react-markdown 9.x 会把 `data-*` 属性展开到 props 上 (而非作为
 * `node.hProperties` 子对象). 本组件透传 `data-wikilink` / `data-anchor` /
 * `data-alias` 给 WikilinkLink.
 */
export interface WikilinkNodeProps {
  /** react-markdown 透传的子节点 (显示文本, alias 优先; 无 alias 时为 target). */
  children?: ReactNode;
  /** react-markdown 透传的 hast 节点 (未直接使用, 占位). */
  node?: unknown;
  /** vault 相对路径 (来自 data.hProperties.data-wikilink). */
  'data-wikilink'?: string;
  /** 可选锚点 (来自 data.hProperties.data-anchor). */
  'data-anchor'?: string;
  /** 可选别名 (来自 data.hProperties.data-alias; children 已含显示文本). */
  'data-alias'?: string;
}

/**
 * WikilinkLinkProps — 业务 props. 由 WikilinkNode 内部渲染时填入.
 */
export interface WikilinkLinkProps {
  /** vault 相对路径. */
  target: string;
  /** 可选锚点 (heading slug 在 onClick 内由 caller 派生). */
  anchor?: string;
  /** 可选别名 (影响 aria-label 与 tooltip). */
  alias?: string;
  /** 显示文本 (alias ?? target). */
  children?: ReactNode;
}
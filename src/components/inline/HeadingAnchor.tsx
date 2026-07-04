/**
 * HeadingAnchor — T09 给 h1~h6 节点注入 `id` 锚点 (设计 §3.7).
 *
 * 设计依据: docs/design/compiled.md §3.7 + docs/plan/compiled.md §1 step-3p.
 *
 * 责任:
 *   - 作为 `react-markdown` 自定义 `h1`~`h6` 组件, 在渲染时给元素加 `id`.
 *   - `id` 取自 outline 端的 `registerOutlineIds()` 灌入的池子, 与
 *     `lib/outline.slugifyWithCounter` 共用 `seen` 语义 (R-1 缓解).
 *   - 仅做 id 注入; 不修改样式, 不修改 children.
 *
 * 工作流:
 *   - `useMarkdownOutline(md)` 计算完成后, 调用 `registerOutlineIds(items.map(i=>i.id))`.
 *   - HeadingAnchor 渲染时, 从池中查 id (若之前 outline 已计算过该 slug).
 *   - 文档切换时调用 `clearOutlineIdPool()` 防止跨文档残留.
 *
 * react-markdown 9.x 自定义组件约定:
 *   - `props` 含 `children` 与 `node` (hast 节点). 不一定有 `level`, 我们从
 *     `node.tagName` 反推: `h1`→1, `h2`→2, ..., `h6`→6.
 *   - 透传 props 时不能用 spread (会把 `node` 字段序列化进 DOM), 仅传必要 props.
 */

import type { HTMLAttributes, ReactNode } from 'react';

import { slugify } from '../../lib/inline/slugify';

/* 模块作用域的 "已知 id 池". 每次 outline 计算完成后会写入. */
const _idPool: Set<string> = new Set<string>();

/** 一次性灌入 outline 抽取结果确定的 ids. */
export function registerOutlineIds(ids: ReadonlyArray<string>): void {
  for (const id of ids) _idPool.add(id);
}

/** 清空池子 (切文档时调用). */
export function clearOutlineIdPool(): void {
  _idPool.clear();
}

export interface HeadingAnchorProps extends Omit<HTMLAttributes<HTMLHeadingElement>, 'level'> {
  children?: ReactNode;
  /** hast 节点 (react-markdown 透传). 我们用它反推 level. */
  node?: unknown;
  /** 可选显式 level; 多数路径下从 node.tagName 推导. */
  level?: number;
}

function resolveLevel(node: unknown, fallback: number): 1 | 2 | 3 | 4 | 5 | 6 {
  // react-markdown 9.x 透传的 `node` 是 hast ElementNode; tagName 为 'h1'..'h6'.
  if (node && typeof node === 'object') {
    const tag = (node as { tagName?: unknown }).tagName;
    if (typeof tag === 'string') {
      const m = /^h([1-6])$/.exec(tag);
      if (m && m[1]) {
        const n = Number(m[1]);
        if (n >= 1 && n <= 6) return n as 1 | 2 | 3 | 4 | 5 | 6;
      }
    }
  }
  // 兜底: 有些 markdown 插件会传 level 字段.
  if (node && typeof node === 'object') {
    const lvl = (node as { level?: unknown }).level;
    if (typeof lvl === 'number' && lvl >= 1 && lvl <= 6) {
      return lvl as 1 | 2 | 3 | 4 | 5 | 6;
    }
  }
  return (Math.max(1, Math.min(6, fallback)) as 1 | 2 | 3 | 4 | 5 | 6);
}

/**
 * 根据文本从池中复用 outline 已分配的 id. 若池中已有匹配基础 slug, 直接用.
 * 若没有, fallback 到 `slugify(text)`.
 */
function resolveId(text: string): string {
  const t = text.trim();
  if (!t) return '';
  const base = slugify(t);
  if (!base) return '';
  if (_idPool.has(base)) return base;
  return base;
}

export function HeadingAnchor(props: HeadingAnchorProps): JSX.Element {
  const level = resolveLevel(props.node, props.level && typeof props.level === 'number' ? props.level : 1);
  const { children, id: providedId, node: _node, ...rest } = props;
  const Tag = `h${level}` as 'h1';
  const text = typeof children === 'string' ? children : '';
  const id = providedId ?? resolveId(text);
  // 不能把 `node` 字段传给 DOM (react 报错). 仅透传安全字段.
  const safeRest: HTMLAttributes<HTMLHeadingElement> = rest;
  return (
    <Tag id={id} {...safeRest}>
      {children}
    </Tag>
  );
}

export default HeadingAnchor;

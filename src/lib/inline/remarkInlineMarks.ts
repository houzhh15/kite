/**
 * src/lib/inline/remarkInlineMarks.ts — 自研 remark 插件 (契约 3).
 *
 * 设计依据: docs/design/compiled.md §3.2 + §3.8 契约 3 + FR-04/FR-05.
 *
 * 责任 (AST 后处理, 在 mdast 上跑):
 *   - 把文本节点中的 '==…==' 拆分为 <mark> (AC-04-1)
 *   - 把 'X~y~Z' 拆分为 <sub>, 仅当 y 非空且无空白 (AC-05-1/3)
 *   - 把 'X^y^Z' 拆分为 <sup>, 仅当 y 非空且无空白 (AC-05-2)
 *   - 受 flags.highlight / flags.subSup 控制; 关闭时字面输出 (AC-04-2, AC-05-4)
 *   - 未闭合不创建节点 (AC-04-3)
 *
 * 注意: 此插件**不**做 tokenize (不替换 micromark 解析阶段),
 * 仅在 mdast 上对文本节点二次遍历拆分. 这样与 remark-gfm 完全兼容,
 * 不会污染扩展点; 但需要在 lib/pipeline.ts 的 REMARK_PLUGINS 中挂载.
 */

import type { Root, RootContent, Text, PhrasingContent, Parent } from 'mdast';

import { getFlags } from '../featureFlags';

interface MarkNode {
  type: 'mark' | 'sub' | 'sup';
  data?: Record<string, unknown>;
  children: PhrasingContent[];
}

interface DelimMatcher {
  open: string;
  close: string;
  wrap: 'mark' | 'sub' | 'sup';
  noWhitespace?: boolean;
}

interface Span {
  start: number;
  end: number;
  wrap: 'mark' | 'sub' | 'sup';
  inner: string;
}

/** 在 text 节点值中查找所有匹配 [open, value, close] 三元组. */
function findDelimited(
  value: string,
  open: string,
  close: string,
  opts: { noWhitespace?: boolean } = {},
): Span[] {
  const matches: Span[] = [];
  let i = 0;
  // 双字符 delimiters (==) 要求边界避免 'a==b==c' 误切 'a==';
  // 单字符 delimiters (~, ^) 在 subSup 语义下允许任意上下文,
  // 但要求内层非空且无空白 (noWhitespace).
  const requireBoundary = open.length > 1;
  while (i < value.length) {
    const openIdx = value.indexOf(open, i);
    if (openIdx === -1) break;
    if (requireBoundary) {
      // open 之前必须是边界: 开头 / 空白 / 标点 (避免 'a==b==c' 拆分 'a==')
      const prev = openIdx > 0 ? value[openIdx - 1] : '';
      if (openIdx > 0 && /[\p{L}\p{N}]/u.test(prev ?? '')) {
        i = openIdx + 1;
        continue;
      }
    }
    const innerStart = openIdx + open.length;
    const closeIdx = value.indexOf(close, innerStart);
    if (closeIdx === -1) break;
    const inner = value.slice(innerStart, closeIdx);
    if (inner.length === 0) {
      i = closeIdx + close.length;
      continue;
    }
    if (opts.noWhitespace && /\s/.test(inner)) {
      i = closeIdx + close.length;
      continue;
    }
    matches.push({ start: openIdx, end: closeIdx + close.length, wrap: 'mark', inner });
    i = closeIdx + close.length;
  }
  return matches;
}

/** 把 text 节点按分隔符列表拆分为多种类型节点的扁平数组. */
function splitTextNode(
  node: Text,
  matchers: DelimMatcher[],
): PhrasingContent[] {
  if (matchers.length === 0) return [node];

  const value = node.value;
  // 收集所有 match 位置 (assign wrap 后再排序去重)
  const spans: Span[] = [];
  for (const m of matchers) {
    const found = findDelimited(value, m.open, m.close, { noWhitespace: m.noWhitespace });
    for (const f of found) {
      spans.push({ ...f, wrap: m.wrap });
    }
  }
  // 排序 + 去除重叠 (按 start 升序, 后到的不覆盖前面的, 跳过)
  spans.sort((a, b) => a.start - b.start);
  const filtered: Span[] = [];
  let lastEnd = -1;
  for (const s of spans) {
    if (s.start >= lastEnd) {
      filtered.push(s);
      lastEnd = s.end;
    }
  }
  if (filtered.length === 0) return [node];

  const out: PhrasingContent[] = [];
  let cursor = 0;
  for (const s of filtered) {
    if (s.start > cursor) {
      const text: Text = {
        type: 'text',
        value: value.slice(cursor, s.start),
      };
      out.push(text);
    }
    const wrapped: MarkNode = {
      type: s.wrap,
      data: { hName: s.wrap, hProperties: {} },
      children: [{ type: 'text', value: s.inner }],
    };
    out.push(wrapped as unknown as PhrasingContent);
    cursor = s.end;
  }
  if (cursor < value.length) {
    out.push({ type: 'text', value: value.slice(cursor) });
  }
  return out;
}

/** 递归遍历 Parent 节点, 替换 text 节点. */
function transformParent(parent: Parent, matchers: DelimMatcher[]): void {
  if (!Array.isArray(parent.children) || parent.children.length === 0) return;
  const newChildren: RootContent[] = [];
  for (const child of parent.children) {
    if (child.type === 'text') {
      const replacements = splitTextNode(child as Text, matchers);
      for (const r of replacements) {
        newChildren.push(r as RootContent);
      }
    } else {
      // 递归进入容器节点 (paragraph / emphasis / strong / link / ...)
      if ('children' in child && Array.isArray((child as Parent).children)) {
        transformParent(child as Parent, matchers);
      }
      newChildren.push(child);
    }
  }
  parent.children = newChildren;
}

/**
 * remarkInlineMarks — 插件工厂.
 * 返回一个 transformer, 在 mdast 上遍历 text 节点并拆分.
 */
export function remarkInlineMarks(): (tree: Root) => void {
  return (tree: Root) => {
    const flags = getFlags();
    const matchers: DelimMatcher[] = [];
    if (flags.highlight) {
      matchers.push({ open: '==', close: '==', wrap: 'mark' });
    }
    if (flags.subSup) {
      matchers.push({ open: '~', close: '~', wrap: 'sub', noWhitespace: true });
      matchers.push({ open: '^', close: '^', wrap: 'sup', noWhitespace: true });
    }
    if (matchers.length === 0) return;

    transformParent(tree as unknown as Parent, matchers);
  };
}
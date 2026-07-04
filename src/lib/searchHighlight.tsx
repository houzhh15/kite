/**
 * searchHighlight — T10 页内查找高亮注入器 (设计 §3.3).
 *
 * 设计依据: docs/design/compiled.md §3.3 + §3.4 + §9.2.
 *
 * 重要说明 (与原 design 的偏差):
 *   react-markdown 9.x 的 components map **不支持** `text` 节点自定义组件 —
 *   hast-util-to-jsx-runtime 把 text 节点直接序列化为 string, 不走 components 钩子.
 *   (验证: 传入 `components.text` 不会触发调用; 默认的 `text()` 只 return node.value.)
 *   同时, react-markdown 渲染后的 DOM text 节点内容是**剥离 markdown 语法**的纯文本,
 *   与原始 content 的字符偏移不对齐 (例如 `# foo` 渲染为单个 text node 'foo', offset 0).
 *
 *   因此本模块采用**渲染后 DOM 注入**方案 (与浏览器原生 Cmd+F 思路一致):
 *   1. 渲染阶段: buildSearchComponents 返回空 {}, 不污染 markdown 结构 (AC-02-3).
 *   2. 提交后阶段: <SearchHighlight> 组件通过 useLayoutEffect 遍历 article DOM,
 *      对每个 text node 跑 query 在其 textContent 上的 substring 搜索,
 *      把命中段包成 <mark data-search-hit data-current>.
 *   3. data-search-hit 序号在每次渲染时按命中数组稳定分配 (设计 §10 风险: 序号错乱).
 *
 *   - 该方案**不**修改 remarkPlugins/rehypePlugins, 严格符合 NFR-04-2.
 *   - DOM 仅在 hits 数组非空时被改写; 否则 useLayoutEffect 立即还原, 不留任何 <mark>.
 *   - 单一数据源: hits 仍由 useSearch 持有; 本模块只读不写 store.
 *
 * 关键性能 (设计 §6):
 *   - useLayoutEffect 同步执行, 不触发额外 paint; 一帧完成.
 *   - hits 为空时**立即还原**, 不留任何 <mark> 节点, 与无 wrapper DOM hash 一致.
 */
import { useLayoutEffect, useMemo, useRef, type ReactElement, type ReactNode } from 'react';

import { buildPattern, type SearchHit } from '../hooks/useSearch';

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

export interface SearchHighlightComponents {
  // 当前实现下, react-markdown 不支持 text 自定义组件, 此处永远返回 {}.
  // 保留签名供 Reader 接线 (Reader 不再使用 components; 改挂 <SearchHighlight> 包裹).
  text?: never;
  paragraph?: never;
}

/**
 * buildSearchComponents 兼容接口 — 当前实现不再向 react-markdown 注入 components.
 *
 * 设计 §3.3.2 中设想 `text`/`paragraph` 覆盖层, 但 react-markdown 9.x 不支持 text
 * 自定义组件, 因此返回值仅为占位. Reader 实际通过 <SearchHighlight> 组件做 DOM 注入.
 *
 *   - hits 为空 → 返回 {}, ReactMarkdown 渲染原样, 无 <mark>.
 *   - hits 非空 → 仍返回 {} (DOM 注入由 SearchHighlight 接管), ReactMarkdown 渲染原样.
 */
export function buildSearchComponents(
  _currentIndex: number,
  _hits: SearchHit[],
): SearchHighlightComponents {
  // 占位. 见文件头说明.
  return {};
}

/* -------------------------------------------------------------------------- */
/* <SearchHighlight> 组件 — Reader 接线点                                     */
/* -------------------------------------------------------------------------- */

export interface SearchHighlightProps {
  /** 当前下标. */
  currentIndex: number;
  /** 命中数组 (空时组件透明, 无副作用). 用于驱动全局命中计数与序号. */
  hits: SearchHit[];
  /** 命中查询关键字 (用于在每个 text node 上重新跑 substring 搜索). */
  patternQuery?: string;
  patternCaseSensitive?: boolean;
  patternWholeWord?: boolean;
  patternRegex?: boolean;
  /** 子节点 (react-markdown 渲染后的 article). */
  children: ReactNode;
}

/**
 * 在 children 渲染后, 对容器内的 text 节点做命中高亮注入.
 *
 * 用法:
 *   <SearchHighlight hits={hits} currentIndex={currentIndex} ...>
 *     <ReactMarkdown ...>{content}</ReactMarkdown>
 *   </SearchHighlight>
 *
 * 注入策略:
 *   对每个 text node (用 TreeWalker SHOW_TEXT 顺序遍历):
 *     1. 在 textContent 上重新跑 query substring 搜索 (受 caseSensitive / wholeWord / regex 影响).
 *     2. 把每个匹配位置用 <mark class="search-hit" data-search-hit="N" data-current="..."> 包起来.
 *   hitIndex N 通过维护全局计数器保证跨 text node 单调递增, 与 useSearch.hits 顺序一致.
 *
 * 性能:
 *   - useLayoutEffect 同步执行, 一帧内完成 DOM mutate, 不触发额外 paint.
 *   - hits 引用变化时清除旧 mark 后再注入新 mark (幂等).
 */
export function SearchHighlight({
  hits,
  currentIndex,
  patternQuery = '',
  patternCaseSensitive = false,
  patternWholeWord = false,
  patternRegex = false,
  children,
}: SearchHighlightProps): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hasInjectedRef = useRef(false);

  // 构造稳定依赖 key: query/options/currentIndex/hits.length 任一变化都重跑.
  const runKey = useMemo(() => {
    return `${patternQuery}|${patternCaseSensitive ? 1 : 0}|${patternWholeWord ? 1 : 0}|${patternRegex ? 1 : 0}|${currentIndex}|${hits.length}`;
  }, [patternQuery, patternCaseSensitive, patternWholeWord, patternRegex, currentIndex, hits.length]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 1. 先清除上次的注入 (幂等).
    if (hasInjectedRef.current) {
      clearHighlights(container);
      hasInjectedRef.current = false;
    }

    // 2. 空 query 或无 hits: 不注入, 与无搜索基线一致 (AC-02-3).
    if (patternQuery === '' || hits.length === 0) {
      return;
    }

    // 3. 构造匹配正则.
    const { pattern } = buildPattern(patternQuery, {
      caseSensitive: patternCaseSensitive,
      wholeWord: patternWholeWord,
      regex: patternRegex,
    });
    if (pattern === null) return; // invalidRegex 等情形, 不注入.

    // 4. 遍历 text nodes, 按出现顺序分配全局 hitIndex.
    const doc = container.ownerDocument ?? document;
    const walker = doc.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    let node: Node | null = walker.nextNode();
    while (node) {
      textNodes.push(node as Text);
      node = walker.nextNode();
    }
    if (textNodes.length === 0) return;

    // 5. 跨 text node 单调递增分配 hitIndex: 直接复用 useSearch.hits 的序号,
    //    每个匹配按出现顺序从 hits 数组取下一序号 (循环).
    let globalHitCursor = 0;
    const totalHits = Math.max(hits.length, 1);

    for (const textNode of textNodes) {
      const text = textNode.nodeValue ?? '';
      if (text.length === 0) continue;
      pattern.lastIndex = 0;
      const localHits: Array<{ start: number; length: number }> = [];
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(text)) !== null) {
        const matched = m[0];
        if (matched.length === 0) {
          pattern.lastIndex++;
          continue;
        }
        localHits.push({ start: m.index, length: matched.length });
        if (!pattern.global) break;
      }
      if (localHits.length === 0) continue;
      const annotated = localHits.map((lh) => {
        const idx = hits[globalHitCursor % totalHits]?.index ?? globalHitCursor;
        globalHitCursor++;
        return {
          start: lh.start,
          length: lh.length,
          hitIndex: idx,
          isCurrent: idx === currentIndex,
        };
      });
      splitTextNode(textNode, annotated);
    }

    hasInjectedRef.current = true;
  }, [runKey, patternQuery, patternCaseSensitive, patternWholeWord, patternRegex, currentIndex, hits]);

  // 卸载时清理 (Reader 切换文档等场景).
  useLayoutEffect(() => {
    return () => {
      const container = containerRef.current;
      if (!container) return;
      if (hasInjectedRef.current) {
        clearHighlights(container);
        hasInjectedRef.current = false;
      }
    };
  }, []);

  return (
    <div ref={containerRef} data-search-highlight-root="">
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* DOM helpers                                                                */
/* -------------------------------------------------------------------------- */

function splitTextNode(
  textNode: Text,
  cuts: Array<{ start: number; length: number; hitIndex: number; isCurrent: boolean }>,
): void {
  const original = textNode.nodeValue ?? '';
  const parent = textNode.parentNode;
  if (!parent) return;

  const frag = document.createDocumentFragment();
  let cursor = 0;
  const sorted = cuts.slice().sort((a, b) => a.start - b.start);
  for (const c of sorted) {
    if (c.start > cursor) {
      frag.appendChild(document.createTextNode(original.slice(cursor, c.start)));
    }
    const seg = original.slice(c.start, c.start + c.length);
    const mark = document.createElement('mark');
    mark.className = 'search-hit';
    mark.setAttribute('data-search-hit', String(c.hitIndex));
    mark.setAttribute('data-current', c.isCurrent ? 'true' : 'false');
    mark.appendChild(document.createTextNode(seg));
    frag.appendChild(mark);
    cursor = c.start + c.length;
  }
  if (cursor < original.length) {
    frag.appendChild(document.createTextNode(original.slice(cursor)));
  }
  parent.replaceChild(frag, textNode);
}

/**
 * 还原 DOM: 移除所有 .search-hit, 拼接相邻 text 节点.
 *
 * 不重渲 React 树, 仅做 DOM mutate. 必须在 unmount / hits=[] 时调用,
 * 保证 AC-02-3 / NFR-04-2 的"无搜索基线 DOM hash 一致".
 */
function clearHighlights(container: Element): void {
  const marks = container.querySelectorAll('mark.search-hit');
  for (const m of Array.from(marks)) {
    const parent = m.parentNode;
    if (!parent) continue;
    const text = document.createTextNode(m.textContent ?? '');
    parent.replaceChild(text, m);
  }
  container.normalize();
}

/* -------------------------------------------------------------------------- */
/* Re-exports                                                                 */
/* -------------------------------------------------------------------------- */

export type { SearchHit };
export default buildSearchComponents;
/**
 * src/lib/mermaidDetect.ts — mermaid 围栏代码块识别工具 (T17-P2 F-21).
 *
 * 设计依据: docs/design/compiled.md §3.3.2 / §3.4.5.
 *
 * - 复用 CodeBlock.tsx 的 `extractLanguage` 思路, 但集中导出避免在两处重复.
 * - `isMermaidBlock(children)` 由 MarkdownRenderer 在 pre 节点自定义时调用,
 *   命中则路由到 <MermaidBlock />, 否则走原有 <CodeBlock />.
 * - 返回 boolean; 不抛错, 未知类型统一返回 false.
 */

import type { ReactNode } from 'react';

/** 递归查找 className 含 `language-mermaid` 的 <code> 子节点.
 *  与 CodeBlock.extractLanguage 同形, 但单独模块以避免相互 import. */
function findLanguageMermaid(node: ReactNode): boolean {
  if (Array.isArray(node)) {
    for (const c of node) {
      if (findLanguageMermaid(c)) return true;
    }
    return false;
  }
  if (!node || typeof node !== 'object') return false;
  const el = node as { props?: { className?: string; children?: ReactNode } };
  if (el.props?.className && /\blanguage-mermaid\b/.test(el.props.className)) {
    return true;
  }
  if (el.props?.children !== undefined) {
    return findLanguageMermaid(el.props.children);
  }
  return false;
}

/** 判断 react-markdown 透传的 <pre> children 是否为 mermaid 围栏代码块.
 *  - 命中: children 中存在 <code className="language-mermaid ...">.
 *  - 不命中: 普通代码块 / 无 language- 标记 / 非 React 元素 → 返回 false. */
export function isMermaidBlock(children: ReactNode): boolean {
  return findLanguageMermaid(children);
}
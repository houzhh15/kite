/**
 * InlineCode — T07 行内 `code` (FR-03 / AC-03-1/2/3) + T08 块级增强.
 *
 * 设计依据: docs/design/compiled.md §3.5.3.
 *
 * react-markdown 在两个场景下都触发 `code` 组件:
 *   - 行内: `` `foo()` `` → <code>foo()</code>
 *   - 块级: ```ts\n...\n``` → rehype-highlight 注入 <code class="language-ts">
 *
 * 区分逻辑:
 *   - 若存在 `className` 含 'language-' 前缀 → 块级, 透传 className.
 *     **T08 step-3 增量**: 附加 `data-block-code={language}` 给父 <pre> 选择器定位.
 *   - 否则 → 行内, 应用 kite-code className.
 *
 * 注意: 不修改 children, react-markdown 默认已经做 HTML escape.
 */
import type { HTMLAttributes, ReactNode } from 'react';

export interface InlineCodeProps extends HTMLAttributes<HTMLElement> {
  children?: ReactNode;
  /** react-markdown 透传的节点信息 (未使用, 仅占位). */
  node?: unknown;
  className?: string;
}

function isBlockCode(className?: string): boolean {
  return typeof className === 'string' && /language-/.test(className);
}

function languageFromClassName(className?: string): string | null {
  if (typeof className !== 'string') return null;
  const m = className.match(/language-([\w-]+)/);
  return m ? m[1] : null;
}

export function InlineCode(props: InlineCodeProps): JSX.Element {
  const { children, className, node: _node, ...rest } = props;
  if (isBlockCode(className)) {
    const lang = languageFromClassName(className);
    return (
      <code
        className={className}
        data-block-code={lang ?? 'unknown'}
        {...rest}
      >
        {children}
      </code>
    );
  }
  return (
    <code className={`kite-code ${className ?? ''}`.trim()} {...rest}>
      {children}
    </code>
  );
}

export default InlineCode;
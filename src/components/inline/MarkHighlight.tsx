/**
 * MarkHighlight — T07 ==text== 行内高亮 (FR-04 / AC-04-1).
 *
 * 设计依据: docs/design/compiled.md §3.5.4 + 契约 3.
 * react-markdown 通过 `mark` 节点触发; 这里仅添加 className 与样式 token,
 * 保留 <mark> 原生语义 (屏幕阅读器朗读「标记」).
 *
 * flag off 时 remarkInlineMarks 不会产生 mark 节点, 此组件不会被调用.
 * 保留作为兜底渲染组件存在, 当 flag 后端切换时不会引入运行时报错.
 */
import type { HTMLAttributes, ReactNode } from 'react';

export interface MarkHighlightProps extends HTMLAttributes<HTMLElement> {
  children?: ReactNode;
}

export function MarkHighlight({ children, className, ...rest }: MarkHighlightProps): JSX.Element {
  return (
    <mark className={`kite-mark ${className ?? ''}`.trim()} {...rest}>
      {children}
    </mark>
  );
}

export default MarkHighlight;
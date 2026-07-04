/**
 * DelStrike — T07 ~~text~~ 删除线 (FR-02 / AC-02-1/2).
 *
 * 设计依据: docs/design/compiled.md §3.5.4.
 * 增强 <del> 默认样式: 透明度降级 + line-through. 由 inline.css 兜底.
 */
import type { HTMLAttributes, ReactNode } from 'react';

export interface DelStrikeProps extends HTMLAttributes<HTMLElement> {
  children?: ReactNode;
}

export function DelStrike({ children, className, ...rest }: DelStrikeProps): JSX.Element {
  return (
    <del className={`kite-del ${className ?? ''}`.trim()} {...rest}>
      {children}
    </del>
  );
}

export default DelStrike;
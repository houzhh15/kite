/**
 * SubMark — T07 H~2~O 下标 (FR-05 / AC-05-1).
 */
import type { HTMLAttributes, ReactNode } from 'react';

export interface SubMarkProps extends HTMLAttributes<HTMLElement> {
  children?: ReactNode;
}

export function SubMark({ children, className, ...rest }: SubMarkProps): JSX.Element {
  return (
    <sub className={`kite-sub ${className ?? ''}`.trim()} {...rest}>
      {children}
    </sub>
  );
}

export default SubMark;
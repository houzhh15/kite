/**
 * SupMark — T07 x^2^ 上标 (FR-05 / AC-05-2).
 */
import type { HTMLAttributes, ReactNode } from 'react';

export interface SupMarkProps extends HTMLAttributes<HTMLElement> {
  children?: ReactNode;
}

export function SupMark({ children, className, ...rest }: SupMarkProps): JSX.Element {
  return (
    <sup className={`kite-sup ${className ?? ''}`.trim()} {...rest}>
      {children}
    </sup>
  );
}

export default SupMark;
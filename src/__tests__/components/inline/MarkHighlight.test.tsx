/**
 * MarkHighlight.test.tsx — ==text== → <mark> 渲染测试 (FR-04).
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import MarkHighlight from '../../../components/inline/MarkHighlight';

describe('MarkHighlight', () => {
  it('renders <mark> with kite-mark class', () => {
    const { container } = render(<MarkHighlight>hello</MarkHighlight>);
    const m = container.querySelector('mark');
    expect(m).not.toBeNull();
    expect(m?.className).toContain('kite-mark');
    expect(m?.textContent).toBe('hello');
  });

  it('forwards additional className', () => {
    const { container } = render(<MarkHighlight className="custom">x</MarkHighlight>);
    const m = container.querySelector('mark');
    expect(m?.className).toContain('kite-mark');
    expect(m?.className).toContain('custom');
  });
});
/**
 * SupMark.test.tsx — x^2^ 上标 (FR-05).
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import SupMark from '../../../components/inline/SupMark';

describe('SupMark', () => {
  it('renders <sup> with kite-sup class', () => {
    const { container } = render(<SupMark>2</SupMark>);
    const s = container.querySelector('sup');
    expect(s).not.toBeNull();
    expect(s?.className).toContain('kite-sup');
    expect(s?.textContent).toBe('2');
  });
});
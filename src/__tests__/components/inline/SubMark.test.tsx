/**
 * SubMark.test.tsx — H~2~O 下标 (FR-05).
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import SubMark from '../../../components/inline/SubMark';

describe('SubMark', () => {
  it('renders <sub> with kite-sub class', () => {
    const { container } = render(<SubMark>2</SubMark>);
    const s = container.querySelector('sub');
    expect(s).not.toBeNull();
    expect(s?.className).toContain('kite-sub');
    expect(s?.textContent).toBe('2');
  });
});
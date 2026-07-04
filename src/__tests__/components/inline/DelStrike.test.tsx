/**
 * DelStrike.test.tsx — ~~text~~ 删除线 (FR-02).
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import DelStrike from '../../../components/inline/DelStrike';

describe('DelStrike', () => {
  it('renders <del> with kite-del class', () => {
    const { container } = render(<DelStrike>gone</DelStrike>);
    const d = container.querySelector('del');
    expect(d).not.toBeNull();
    expect(d?.className).toContain('kite-del');
    expect(d?.textContent).toBe('gone');
  });
});
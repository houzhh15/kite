/**
 * SkipLink.test.tsx — T12 跳过链接 DOM 验证.
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { SkipLink } from '../SkipLink';

describe('SkipLink', () => {
  it('renders an anchor with href to main-content', () => {
    const { getByTestId } = render(<SkipLink />);
    const link = getByTestId('skip-link');
    expect(link.getAttribute('href')).toBe('#main-content');
  });

  it('uses custom targetId and label', () => {
    const { getByTestId } = render(<SkipLink targetId="reader" label="Skip" />);
    const link = getByTestId('skip-link');
    expect(link.getAttribute('href')).toBe('#reader');
    expect(link.textContent).toBe('Skip');
  });

  it('is visually hidden via sr-only but visible on focus (CSS class)', () => {
    const { getByTestId } = render(<SkipLink />);
    const link = getByTestId('skip-link');
    expect(link.className).toContain('sr-only');
    expect(link.className).toContain('focus:not-sr-only');
  });
});
/**
 * a11y-landmarks.test.tsx — T12 ARIA landmark 与角色断言 (设计 §3.6.7).
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { Toolbar } from '../components/Toolbar';
import { SkipLink } from '../components/SkipLink';

describe('ARIA landmarks — T12', () => {
  it('Toolbar role=banner (header)', () => {
    const { getByTestId } = render(<Toolbar disabled={false} onOpen={() => {}} />);
    const tb = getByTestId('toolbar');
    expect(tb.getAttribute('role')).toBe('banner');
  });

  it('Toolbar brand logo image is present (T19)', () => {
    const { getByTestId } = render(<Toolbar disabled={false} onOpen={() => {}} />);
    const logo = getByTestId('toolbar-logo');
    expect(logo.tagName.toLowerCase()).toBe('img');
    expect(logo.getAttribute('alt')).toBe('KITE');
  });

  it('SkipLink 链接到 #main-content', () => {
    const { getByTestId } = render(<SkipLink />);
    const link = getByTestId('skip-link');
    expect(link.getAttribute('href')).toBe('#main-content');
  });

  it('字号指示器 aria-hidden=true (屏幕阅读器跳过 visual only)', () => {
    const { getByTestId } = render(<Toolbar disabled={false} onOpen={() => {}} />);
    const ind = getByTestId('font-size-indicator');
    expect(ind.getAttribute('aria-hidden')).toBe('true');
  });

  it('字号 announcer 是 aria-live=polite', () => {
    const { getByTestId } = render(<Toolbar disabled={false} onOpen={() => {}} />);
    const ann = getByTestId('font-size-announcer');
    expect(ann.getAttribute('aria-live')).toBe('polite');
    expect(ann.getAttribute('aria-atomic')).toBe('true');
  });
});
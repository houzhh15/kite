/**
 * Toolbar.t12.test.tsx — T12 字号指示器 + aria-live announcer 测试.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

import { Toolbar } from '../Toolbar';
import { usePrefStore } from '../../stores/prefStore';

describe('Toolbar — T12 字号指示器', () => {
  beforeEach(() => {
    usePrefStore.setState({
      prefs: {
        theme: 'system',
        fontSize: 16,
        lineHeight: 1.6,
        codeBlockTheme: 'github',
        fontSizeId: 'md',
        lineHeightId: 'cozy',
        codeFontSizeId: 'md',
        language: 'zh-CN',
        mermaidEnabled: false,
        katexEnabled: false,
      },
      hydrated: true,
      loaded: true,
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('字号指示器默认显示 "A 16px"', () => {
    const { getByTestId } = render(<Toolbar disabled={false} onOpen={() => {}} />);
    const indicator = getByTestId('font-size-indicator');
    expect(indicator.textContent).toContain('A');
    expect(indicator.textContent).toContain('16px');
  });

  it('字号指示器随 setFontSizeId("2xl") 更新为 "A+++ 24px"', () => {
    usePrefStore.getState().setFontSizeId('2xl');
    const { getByTestId } = render(<Toolbar disabled={false} onOpen={() => {}} />);
    const indicator = getByTestId('font-size-indicator');
    expect(indicator.textContent).toContain('A+++');
    expect(indicator.textContent).toContain('24px');
  });

  it('aria-live announcer 写入屏读器文本', () => {
    usePrefStore.getState().setFontSizeId('lg');
    const { getByTestId } = render(<Toolbar disabled={false} onOpen={() => {}} />);
    const announcer = getByTestId('font-size-announcer');
    expect(announcer.getAttribute('aria-live')).toBe('polite');
    expect(announcer.textContent).toContain('18');
    expect(announcer.textContent).toContain('像素');
  });
});
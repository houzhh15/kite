/**
 * useReaderCssVars.test.tsx — T12 Reader 字号 / 行高 / 代码块字号 CSS 变量注入测试.
 *
 * 验证 step-06:
 *   - useReaderFontSize 写入 documentElement.style.fontSize + CSS vars.
 *   - useReaderLineHeight 写入 --reader-line-height.
 *   - useReaderCodeFontSize 写入 --code-font-size.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { useReaderFontSize } from '../useReaderFontSize';
import { useReaderLineHeight } from '../useReaderLineHeight';
import { useReaderCodeFontSize } from '../useReaderCodeFontSize';
import { usePrefStore } from '../../stores/prefStore';

function FontSizeHook(): null {
  useReaderFontSize();
  return null;
}
function LineHeightHook(): null {
  useReaderLineHeight();
  return null;
}
function CodeFontSizeHook(): null {
  useReaderCodeFontSize();
  return null;
}

describe('useReaderFontSize — DOM CSS 变量注入', () => {
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
    document.documentElement.style.removeProperty('font-size');
    document.documentElement.style.removeProperty('--reader-font-size');
    document.documentElement.style.removeProperty('--kite-font-size');
    document.documentElement.style.removeProperty('--reader-line-height');
    document.documentElement.style.removeProperty('--kite-line-height');
    document.documentElement.style.removeProperty('--code-font-size');
  });

  it('writes html.style.fontSize in px', () => {
    usePrefStore.getState().setFontSizeId('lg');
    render(<FontSizeHook />);
    expect(document.documentElement.style.fontSize).toBe('18px');
  });

  it('writes --reader-font-size and --kite-font-size CSS vars', () => {
    usePrefStore.getState().setFontSizeId('2xl');
    render(<FontSizeHook />);
    expect(document.documentElement.style.getPropertyValue('--reader-font-size')).toBe('24px');
    expect(document.documentElement.style.getPropertyValue('--kite-font-size')).toBe('24px');
  });

  it('writes --reader-line-height', () => {
    usePrefStore.getState().setLineHeightId('comfortable');
    render(<LineHeightHook />);
    expect(document.documentElement.style.getPropertyValue('--reader-line-height')).toBe('1.8');
    expect(document.documentElement.style.getPropertyValue('--kite-line-height')).toBe('1.8');
  });

  it('writes --code-font-size from codeFontSizeId', () => {
    usePrefStore.getState().setCodeFontSize('lg');
    render(<CodeFontSizeHook />);
    expect(document.documentElement.style.getPropertyValue('--code-font-size')).toBe('16px');
  });
});
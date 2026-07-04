/**
 * LinkTooltip.test.tsx — 外链点击浮层 (FR-17).
 *
 * T18: LinkTooltip 通过 useTranslation() 消费 common.externalOpened 模板.
 *   测试用 I18nextProvider 包裹, 默认 zh-CN.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';

import LinkTooltip from '../../../components/inline/LinkTooltip';
import { useInlineStore } from '../../../stores/inlineStore';
import i18n, { DEFAULT_LNG } from '../../../i18n';

beforeEach(async () => {
  vi.useFakeTimers();
  useInlineStore.setState({ lastExternal: null, tooltip: null });
  Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
  // T18: 重置 i18next 到 zh-CN.
  await i18n.changeLanguage(DEFAULT_LNG);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** T18: 包裹 I18nextProvider, 让 LinkTooltip 内部 useTranslation() 拿到字典. */
function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}

describe('LinkTooltip — FR-17', () => {
  it('tooltip=null → 不渲染', () => {
    const { container } = renderWithI18n(<LinkTooltip />);
    expect(container.querySelector('[data-testid="link-tooltip"]')).toBeNull();
  });

  it('pushTooltip 后 → 浮层出现 (AC-17-1)', () => {
    useInlineStore.getState().pushTooltip({ x: 500, y: 500, url: 'https://example.com/x' });
    const { getByTestId } = renderWithI18n(<LinkTooltip />);
    const tip = getByTestId('link-tooltip');
    expect(tip).toBeTruthy();
    expect(tip.textContent).toContain('已在系统浏览器打开');
    expect(tip.textContent).toContain('https://example.com/x');
  });

  it('1.5s 后开始 fade (data-fading=true)', () => {
    useInlineStore.getState().pushTooltip({ x: 500, y: 500, url: 'https://example.com' });
    const { getByTestId } = renderWithI18n(<LinkTooltip />);
    expect(getByTestId('link-tooltip').getAttribute('data-fading')).toBe('false');
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(getByTestId('link-tooltip').getAttribute('data-fading')).toBe('true');
  });

  it('200ms fade 后 dismissTooltip → tooltip 清空 (AC-17-1)', () => {
    useInlineStore.getState().pushTooltip({ x: 500, y: 500, url: 'https://example.com' });
    const { queryByTestId } = renderWithI18n(<LinkTooltip />);
    expect(queryByTestId('link-tooltip')).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(1500 + 200);
    });
    expect(queryByTestId('link-tooltip')).toBeNull();
    expect(useInlineStore.getState().tooltip).toBeNull();
  });

  it('URL > 60 字符 → 截断 + … (AC-17-2)', () => {
    const long = 'https://example.com/' + 'a'.repeat(100);
    useInlineStore.getState().pushTooltip({ x: 500, y: 500, url: long });
    const { getByTestId } = renderWithI18n(<LinkTooltip />);
    const tipText = getByTestId('link-tooltip').textContent ?? '';
    // T18: zh-CN 模板用 '：' 分隔; 仍按位置取 url 部分.
    const urlInTip = tipText.split(/[:：]/).slice(-1)[0] ?? '';
    expect(urlInTip.length).toBeLessThanOrEqual(61); // 60 + '…'
    expect(urlInTip.endsWith('…')).toBe(true);
  });

  it('URL <= 60 字符 → 不截断', () => {
    const short = 'https://example.com/x';
    useInlineStore.getState().pushTooltip({ x: 500, y: 500, url: short });
    const { getByTestId } = renderWithI18n(<LinkTooltip />);
    expect(getByTestId('link-tooltip').textContent).toContain(short);
  });

  it('视口右溢出 → X 左偏移 (AC-17-4)', () => {
    // x=innerWidth-5 应被夹紧
    useInlineStore.getState().pushTooltip({ x: window.innerWidth - 5, y: 500, url: 'https://example.com' });
    const { getByTestId } = renderWithI18n(<LinkTooltip />);
    const tip = getByTestId('link-tooltip');
    const leftStyle = tip.style.left;
    const leftPx = Number(leftStyle.replace('px', ''));
    // 应该小于 innerWidth - 8
    expect(leftPx).toBeLessThan(window.innerWidth - 8 + 180);
  });

  it('连续 pushTooltip 重置 timer', () => {
    useInlineStore.getState().pushTooltip({ x: 100, y: 100, url: 'https://a.com' });
    renderWithI18n(<LinkTooltip />);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    // 1s 后再次 push, timer 应重置
    act(() => {
      useInlineStore.getState().pushTooltip({ x: 200, y: 200, url: 'https://b.com' });
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    // 此时距离第二次 push 仅 1s, 不应 fade
    const tip = document.querySelector('[data-testid="link-tooltip"]');
    expect(tip).not.toBeNull();
    expect(tip?.getAttribute('data-fading')).toBe('false');
  });
});
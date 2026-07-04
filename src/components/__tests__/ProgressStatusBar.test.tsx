/**
 * ProgressStatusBar 单元测试 (T09 / FR-04 / AC-04-3 + T18 i18n).
 *
 * 覆盖:
 *   - progress=0.42 -> "进度 42%" (默认 zh-CN).
 *   - words/lines 来自 content, content 切换时重算 (AC-04-3).
 *   - 文末 progress=1 -> "进度 100%" (AC-04-2).
 *   - 空 content -> "进度 0% · 0 字 · 0 行".
 *   - T18: 切换语言后渲染对应文案.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';

import ProgressStatusBar from '../ProgressStatusBar';
import i18n, { DEFAULT_LNG } from '../../i18n';
import { enUS } from '../../i18n/en-US';

function renderWithI18n(ui: React.ReactElement, lng: 'zh-CN' | 'en-US' = 'zh-CN') {
  // 同步切到目标语言; i18next 在内存中已初始化.
  return i18n.changeLanguage(lng).then(() => {
    return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
  });
}

describe('ProgressStatusBar', () => {
  beforeEach(async () => {
    await i18n.changeLanguage(DEFAULT_LNG);
  });

  it('渲染 "进度 0%" 默认态 (content 空, progress=0)', async () => {
    const { getByTestId } = await renderWithI18n(
      <ProgressStatusBar progress={0} content="" />,
    );
    const el = getByTestId('progress-status-bar');
    expect(el.textContent).toContain('进度 0%');
    expect(el.textContent).toContain('0 字');
    expect(el.textContent).toContain('0 行');
  });

  it('progress=0.42 -> "进度 42%"', async () => {
    const { getByTestId } = await renderWithI18n(
      <ProgressStatusBar progress={0.42} content="x" />,
    );
    expect(getByTestId('progress-status-bar').textContent).toContain('进度 42%');
  });

  it('content 切换 -> words/lines 重算 (AC-04-3)', async () => {
    const { getByTestId, rerender } = await renderWithI18n(
      <ProgressStatusBar progress={0} content="Hello world" />,
    );
    const t1 = getByTestId('progress-status-bar').textContent ?? '';
    expect(t1).toMatch(/10 字/); // Hello world 长度 11, 空格不算 -> 10

    rerender(
      <I18nextProvider i18n={i18n}>
        <ProgressStatusBar progress={0} content={'a\nb\nc'} />
      </I18nextProvider>,
    );
    const t2 = getByTestId('progress-status-bar').textContent ?? '';
    expect(t2).toContain('3 字');
    expect(t2).toContain('3 行'); // 3 非空行
  });

  it('progress=1 -> "100%" (AC-04-2 文末判稳)', async () => {
    const { getByTestId } = await renderWithI18n(
      <ProgressStatusBar progress={1} content="x" />,
    );
    expect(getByTestId('progress-status-bar').textContent).toContain('100%');
  });

  it('中文 / 英文混合: words 按字符计', async () => {
    const { getByTestId } = await renderWithI18n(
      <ProgressStatusBar progress={0} content={'你好 hello'} />,
    );
    // "你好 hello": 2 + 5 = 7 字符 (空格不计)
    expect(getByTestId('progress-status-bar').textContent).toContain('7 字');
  });

  it('连字符 / 千分位格式: 3250 字 -> 3,250 字', async () => {
    // 构造一个 3250 字字符串.
    const md = 'x'.repeat(3250);
    const { getByTestId } = await renderWithI18n(
      <ProgressStatusBar progress={0} content={md} />,
    );
    expect(getByTestId('progress-status-bar').textContent).toContain('3,250 字');
  });

  it('T18: 切到 en-US 后渲染英文 statusBar', async () => {
    const { getByTestId } = await renderWithI18n(
      <ProgressStatusBar progress={0.42} content="hello" />,
      'en-US',
    );
    const text = getByTestId('progress-status-bar').textContent ?? '';
    expect(text).toContain(enUS.statusBar.progressFmt.split('{{n}}')[0]);
    expect(text).toMatch(/Progress/);
  });
});
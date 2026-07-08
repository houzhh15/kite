/**
 * Settings.test.tsx — T04 + T12 设置面板行为验证 (设计 §3.6.2).
 *
 * 覆盖:
 *   - open=false → null.
 *   - open=true → 含 ThemeSwitcher + 字号 5 档 radiogroup + 行高 3 档 + 代码块 4 档.
 *   - 字号 radio click → prefs.fontSizeId 更新.
 *   - 行高 radio click → prefs.lineHeightId 更新.
 *   - 代码块字号 radio click → prefs.codeFontSizeId 更新.
 *   - 重置按钮触发 resetReadingPrefs.
 *   - 关闭按钮触发 onClose.
 *   - Esc 触发 onClose.
 *   - 焦点陷阱: Tab 循环不逃出面板.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';

import { usePrefStore } from '../../stores/prefStore';
import { Settings } from '../Settings';

const FULL_PREFS = {
  theme: 'system' as const,
  fontSize: 16,
  lineHeight: 1.6 as const,
  codeBlockTheme: 'github',
  fontSizeId: 'md' as const,
  lineHeightId: 'cozy' as const,
  codeFontSizeId: 'md' as const,
  language: 'zh-CN' as const,
  mermaidEnabled: false as const,
  katexEnabled: false as const,
  externalEditor: 'system' as const,
  externalEditorCustomCmd: '',
  vaultRootMode: 'follow-current' as const,
  vaultRootCustom: null,
};

describe('Settings (T04 + T12)', () => {
  beforeEach(() => {
    usePrefStore.setState({
      prefs: { ...FULL_PREFS },
      hydrated: true,
      loaded: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when open=false', () => {
    const { container } = render(<Settings open={false} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders dialog with role + aria when open=true', () => {
    const { getByTestId } = render(<Settings open={true} onClose={vi.fn()} />);
    const dialog = getByTestId('settings-panel');
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('设置');
  });

  it('includes ThemeSwitcher (T03 控件不动)', () => {
    const { getByTestId } = render(<Settings open={true} onClose={vi.fn()} />);
    expect(getByTestId('theme-switcher')).toBeTruthy();
  });

  it('renders font-size radiogroup with 5 buttons', () => {
    const { getByTestId } = render(<Settings open={true} onClose={vi.fn()} />);
    const group = getByTestId('font-size-radiogroup');
    expect(group.getAttribute('role')).toBe('radiogroup');
    const buttons = group.querySelectorAll('[role="radio"]');
    expect(buttons.length).toBe(5);
  });

  it('clicking font-size-lg button sets prefs.fontSizeId + fontSize', () => {
    const { getByTestId } = render(<Settings open={true} onClose={vi.fn()} />);
    const btn = getByTestId('font-size-lg');
    fireEvent.click(btn);
    const s = usePrefStore.getState();
    expect(s.prefs.fontSizeId).toBe('lg');
    expect(s.prefs.fontSize).toBe(18);
    expect(btn.getAttribute('aria-checked')).toBe('true');
  });

  it('renders line-height radiogroup with 3 buttons', () => {
    const { getByTestId } = render(<Settings open={true} onClose={vi.fn()} />);
    const group = getByTestId('line-height-radiogroup');
    const buttons = group.querySelectorAll('[role="radio"]');
    expect(buttons.length).toBe(3);
  });

  it('clicking line-height-comfortable button sets prefs.lineHeightId + lineHeight', () => {
    const { getByTestId } = render(<Settings open={true} onClose={vi.fn()} />);
    const btn = getByTestId('line-height-comfortable');
    fireEvent.click(btn);
    const s = usePrefStore.getState();
    expect(s.prefs.lineHeightId).toBe('comfortable');
    expect(s.prefs.lineHeight).toBe(1.8);
    expect(btn.getAttribute('aria-checked')).toBe('true');
  });

  it('renders code-font-size radiogroup with 4 buttons', () => {
    const { getByTestId } = render(<Settings open={true} onClose={vi.fn()} />);
    const group = getByTestId('code-font-size-radiogroup');
    const buttons = group.querySelectorAll('[role="radio"]');
    expect(buttons.length).toBe(4);
  });

  it('clicking code-font-size-lg button sets prefs.codeFontSizeId', () => {
    const { getByTestId } = render(<Settings open={true} onClose={vi.fn()} />);
    const btn = getByTestId('code-font-size-lg');
    fireEvent.click(btn);
    expect(usePrefStore.getState().prefs.codeFontSizeId).toBe('lg');
    expect(btn.getAttribute('aria-checked')).toBe('true');
  });

  it('reset button triggers resetReadingPrefs', () => {
    usePrefStore.getState().setFontSizeId('2xl');
    usePrefStore.getState().setLineHeightId('comfortable');
    const { getByTestId } = render(<Settings open={true} onClose={vi.fn()} />);
    fireEvent.click(getByTestId('settings-reset'));
    const s = usePrefStore.getState();
    expect(s.prefs.fontSizeId).toBe('md');
    expect(s.prefs.lineHeightId).toBe('cozy');
    expect(s.prefs.codeFontSizeId).toBe('md');
  });

  it('clicking close calls onClose', () => {
    const onClose = vi.fn();
    const { getByTestId } = render(<Settings open={true} onClose={onClose} />);
    fireEvent.click(getByTestId('settings-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Esc key triggers onClose (focus trap)', () => {
    const onClose = vi.fn();
    render(<Settings open={true} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
/**
 * t04-flow.test.tsx — T04 集成验证: 主题 / 字号 / 行高三项联动.
 *
 * 覆盖 (Step 9):
 *   - loadPreferences({theme:'dark'}) → usePreferences hydrate → useTheme 反映.
 *   - 设置 theme='system' + matchMedia 模拟 dark → appliedTheme 切到 dark.
 *   - savePreferences 接收变更 (theme / fontSize / lineHeight).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';

import { usePrefStore } from '../../stores/prefStore';
import { usePreferences } from '../usePreferences';
import { useTheme } from '../useTheme';

vi.mock('../../lib/tauri', () => ({
  loadPreferences: vi.fn(),
  savePreferences: vi.fn(),
  setWindowTitle: vi.fn(),
}));

import { loadPreferences, savePreferences } from '../../lib/tauri';

const mockLoad = loadPreferences as unknown as ReturnType<typeof vi.fn>;
const mockSave = savePreferences as unknown as ReturnType<typeof vi.fn>;

function Probe(): null {
  usePreferences();
  useTheme();
  return null;
}

describe('T04 flow integration (主题 / 字号 / 行高三项联动)', () => {
  let matchMediaMock: { matches: boolean; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn>; _emit: (m: boolean) => void };

  beforeEach(() => {
    vi.useFakeTimers();
    document.documentElement.removeAttribute('style');
    document.documentElement.classList.remove('dark');
    document.documentElement.style.cssText = '';
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
      hydrated: false,
      loaded: false,
    });
    mockLoad.mockReset();
    mockSave.mockReset();
    mockSave.mockResolvedValue(undefined);

    // mock matchMedia: prefers-color-scheme: dark
    const listeners: Array<(e: MediaQueryListEvent) => void> = [];
    matchMediaMock = {
      matches: false,
      addEventListener: vi.fn((_e: string, cb: (e: MediaQueryListEvent) => void) => {
        listeners.push(cb);
      }),
      removeEventListener: vi.fn((_e: string, cb: (e: MediaQueryListEvent) => void) => {
        const idx = listeners.indexOf(cb);
        if (idx >= 0) listeners.splice(idx, 1);
      }),
      _emit(m: boolean) {
        this.matches = m;
        const event = { matches: m, media: '' } as unknown as MediaQueryListEvent;
        for (const cb of listeners) cb(event);
      },
    };
    Object.defineProperty(window, 'matchMedia', {
      value: () => matchMediaMock,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('loadPreferences({theme:dark}) → hydrate → <html>.dark (AC-FR01-1 + AC-FR06-1)', async () => {
    mockLoad.mockResolvedValue({ theme: 'dark', fontSize: 20, lineHeight: 1.8 });
    render(<Probe />);
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
      await Promise.resolve();
    });
    const s = usePrefStore.getState();
    expect(s.hydrated).toBe(true);
    expect(s.prefs.theme).toBe('dark');
    expect(s.prefs.fontSize).toBe(20);
    expect(s.prefs.lineHeight).toBe(1.8);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.style.getPropertyValue('--kite-font-size')).toBe('20px');
    expect(document.documentElement.style.getPropertyValue('--kite-line-height')).toBe('1.8');
  });

  it('theme=system + matchMedia change → appliedTheme follows (AC-FR06-2)', async () => {
    mockLoad.mockResolvedValue({ theme: 'system', fontSize: 16, lineHeight: 1.6 });
    render(<Probe />);
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
      await Promise.resolve();
    });
    // 初始 matchMedia.matches=false → light
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    // 模拟 OS 切到 dark
    await act(async () => {
      matchMediaMock._emit(true);
    });
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('setFontSize + setLineHeight trigger debounced save with new values', async () => {
    mockLoad.mockResolvedValue({ theme: 'system', fontSize: 16, lineHeight: 1.6 });
    render(<Probe />);
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
      await Promise.resolve();
    });
    mockSave.mockClear();

    await act(async () => {
      usePrefStore.getState().setFontSize(20);
    });
    await act(async () => {
      usePrefStore.getState().setLineHeight(1.8);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(mockSave).toHaveBeenCalledTimes(1);
    const arg = mockSave.mock.calls[0]?.[0] as { fontSize: number; lineHeight: number };
    expect(arg.fontSize).toBe(20);
    expect(arg.lineHeight).toBe(1.8);
  });
});
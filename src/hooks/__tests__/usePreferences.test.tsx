/**
 * usePreferences.test.tsx — T04 hook 行为验证 (设计 §3.4.1).
 *
 * 覆盖:
 *   - 启动 hydrate: loadPreferences 调 1 次 → hydrated=true.
 *   - CSS 变量同步: setProperty 在 hydrate 后生效.
 *   - debounce: 30 次 setFontSize → savePreferences 1 次 (AC-NFR01-1).
 *   - pagehide: 立即 save.
 *   - loadPreferences 失败: hydrate() fallback (AC-FR01-3).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';

import { usePrefStore } from '../../stores/prefStore';
import { usePreferences } from '../usePreferences';

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
  return null;
}

describe('usePreferences (T04)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
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
        externalEditor: 'system',
        externalEditorCustomCmd: '',
        vaultRootMode: 'follow-current',
        vaultRootCustom: null,
      },
      hydrated: false,
      loaded: false,
    });
    document.documentElement.removeAttribute('style');
    mockLoad.mockReset();
    mockSave.mockReset();
    mockSave.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('calls loadPreferences once on mount and hydrates store (AC-FR01-1)', async () => {
    mockLoad.mockResolvedValue({ theme: 'dark', fontSize: 20, lineHeight: 1.8 });
    render(<Probe />);
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
      await Promise.resolve();
    });
    expect(mockLoad).toHaveBeenCalledTimes(1);
    const s = usePrefStore.getState();
    expect(s.hydrated).toBe(true);
    expect(s.prefs.theme).toBe('dark');
    expect(s.prefs.fontSize).toBe(20);
    expect(s.prefs.lineHeight).toBe(1.8);
  });

  it('writes CSS variables on hydrate (FR-08)', async () => {
    mockLoad.mockResolvedValue({ theme: 'dark', fontSize: 20, lineHeight: 1.8 });
    render(<Probe />);
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
      await Promise.resolve();
    });
    expect(document.documentElement.style.getPropertyValue('--kite-font-size')).toBe('20px');
    expect(document.documentElement.style.getPropertyValue('--kite-line-height')).toBe('1.8');
  });

  it('debounces: 30 setFontSize in 1.5s → savePreferences called once (AC-NFR01-1 / AC-FR04-1)', async () => {
    mockLoad.mockResolvedValue({ theme: 'system', fontSize: 16, lineHeight: 1.6 });
    render(<Probe />);
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
      await Promise.resolve();
    });
    expect(mockSave).not.toHaveBeenCalled();

    for (let i = 0; i < 30; i++) {
      await act(async () => {
        usePrefStore.getState().setFontSize(17 + (i % 6));
        await vi.advanceTimersByTimeAsync(40);
      });
    }
    expect(mockSave).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(mockSave).toHaveBeenCalledTimes(1);
    const arg = mockSave.mock.calls[0]?.[0] as { fontSize: number };
    expect(arg.fontSize).toBe(17 + (29 % 6));
  });

  it('pagehide triggers immediate save (AC-FR04-3)', async () => {
    mockLoad.mockResolvedValue({ theme: 'dark', fontSize: 20, lineHeight: 1.8 });
    render(<Probe />);
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
      await Promise.resolve();
    });
    mockSave.mockClear();

    await act(async () => {
      usePrefStore.getState().setLineHeight(1.4);
    });
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(mockSave).toHaveBeenCalledTimes(1);
    const arg = mockSave.mock.calls[0]?.[0] as { lineHeight: number };
    expect(arg.lineHeight).toBe(1.4);
  });

  it('loadPreferences failure: hydrates with defaults (AC-FR01-3)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockLoad.mockRejectedValue(new Error('boom'));
    render(<Probe />);
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
      await Promise.resolve();
    });
    expect(warn).toHaveBeenCalled();
    const s = usePrefStore.getState();
    expect(s.hydrated).toBe(true);
    expect(s.prefs.theme).toBe('system');
    expect(s.prefs.fontSize).toBe(16);
    expect(s.prefs.lineHeight).toBe(1.6);
  });

  it('does not save on debounce when value returns to last-saved (short-circuit)', async () => {
    mockLoad.mockResolvedValue({ theme: 'dark', fontSize: 20, lineHeight: 1.8 });
    render(<Probe />);
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
      await Promise.resolve();
    });
    mockSave.mockClear();

    await act(async () => {
      usePrefStore.getState().setFontSize(18);
      usePrefStore.getState().setFontSize(20); // 回到 lastSaved
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    // shallowEqual 与 lastSaved (20) 一致 → 短路
    expect(mockSave).not.toHaveBeenCalled();
  });
});
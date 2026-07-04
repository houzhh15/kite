/**
 * ShortcutsHint 单元测试 (T11 step-11 / FR-12).
 *
 * 覆盖:
 *   - hydrated=false → 不展示.
 *   - hydrated=true + seenShortcutsHint=false → 展示浮层.
 *   - hydrated=true + seenShortcutsHint=true → 不展示.
 *   - 关闭 + 勾选 → setSeenShortcutsHint(true) + flush(true).
 *   - 关闭 + 未勾选 → 不写盘.
 *   - CustomEvent 'kite:show-shortcuts-hint' → 再次展示.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, fireEvent } from '@testing-library/react';

const saveProgressMock = vi.fn().mockResolvedValue(undefined);

vi.mock('../../lib/tauri', () => ({
  tauri: {
    saveProgress: (...args: unknown[]) => saveProgressMock(...args),
    loadProgress: vi.fn().mockResolvedValue({ lastPath: null, perFile: {}, seenShortcutsHint: false }),
  },
}));

import { ShortcutsHint } from '../ShortcutsHint';
import { useProgressStore, __resetProgressStoreForTest } from '../../stores/progressStore';

beforeEach(() => {
  __resetProgressStoreForTest();
  saveProgressMock.mockReset();
  saveProgressMock.mockResolvedValue(undefined);
  vi.useRealTimers();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ShortcutsHint (T11 step-11)', () => {
  it('hydrated=false → 不渲染', () => {
    const { container } = render(<ShortcutsHint />);
    expect(container.querySelector('[data-testid="shortcuts-hint"]')).toBeNull();
  });

  it('hydrated=true + seenShortcutsHint=false → 渲染浮层', async () => {
    act(() => {
      useProgressStore.getState().hydrate({
        lastPath: null,
        perFile: {},
        seenShortcutsHint: false,
      });
    });
    // 等 useEffect + setTimeout(0).
    await new Promise((r) => setTimeout(r, 10));
    const { container } = render(<ShortcutsHint />);
    expect(container.querySelector('[data-testid="shortcuts-hint"]')).toBeTruthy();
    // 含 10 条快捷键行.
    const rows = container.querySelectorAll('[data-testid^="shortcuts-hint-row-"]');
    expect(rows.length).toBe(10);
  });

  it('hydrated=true + seenShortcutsHint=true → 不渲染', () => {
    act(() => {
      useProgressStore.getState().hydrate({
        lastPath: null,
        perFile: {},
        seenShortcutsHint: true,
      });
    });
    const { container } = render(<ShortcutsHint />);
    expect(container.querySelector('[data-testid="shortcuts-hint"]')).toBeNull();
  });

  it('关闭 + 勾选「不再提示」→ setSeenShortcutsHint(true) + flush(true)', async () => {
    vi.useFakeTimers();
    act(() => {
      useProgressStore.getState().hydrate({
        lastPath: null,
        perFile: {},
        seenShortcutsHint: false,
      });
    });
    await vi.runAllTimersAsync();
    const { container } = render(<ShortcutsHint />);
    expect(container.querySelector('[data-testid="shortcuts-hint"]')).toBeTruthy();

    const checkbox = container.querySelector<HTMLInputElement>(
      '[data-testid="shortcuts-hint-dont-show"]',
    );
    if (!checkbox) throw new Error('checkbox not found');
    act(() => {
      fireEvent.click(checkbox);
    });
    const closeBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="shortcuts-hint-close"]',
    );
    if (!closeBtn) throw new Error('close button not found');
    act(() => {
      fireEvent.click(closeBtn);
    });
    await vi.runAllTimersAsync();
    expect(useProgressStore.getState().seenShortcutsHint).toBe(true);
    expect(saveProgressMock).toHaveBeenCalled();
  });

  it('关闭 + 未勾选 → 不写盘 (seenShortcutsHint 保持 false)', async () => {
    vi.useFakeTimers();
    act(() => {
      useProgressStore.getState().hydrate({
        lastPath: null,
        perFile: {},
        seenShortcutsHint: false,
      });
    });
    await vi.runAllTimersAsync();
    saveProgressMock.mockClear();
    const { container } = render(<ShortcutsHint />);
    const closeBtn2 = container.querySelector<HTMLButtonElement>(
      '[data-testid="shortcuts-hint-close"]',
    );
    if (!closeBtn2) throw new Error('close button not found');
    act(() => {
      fireEvent.click(closeBtn2);
    });
    await vi.runAllTimersAsync();
    expect(useProgressStore.getState().seenShortcutsHint).toBe(false);
    expect(saveProgressMock).not.toHaveBeenCalled();
  });

  it('CustomEvent kite:show-shortcuts-hint → 再次展示', () => {
    act(() => {
      useProgressStore.getState().hydrate({
        lastPath: null,
        perFile: {},
        seenShortcutsHint: true,
      });
    });
    const { container } = render(<ShortcutsHint />);
    expect(container.querySelector('[data-testid="shortcuts-hint"]')).toBeNull();

    act(() => {
      window.dispatchEvent(new CustomEvent('kite:show-shortcuts-hint'));
    });
    expect(container.querySelector('[data-testid="shortcuts-hint"]')).toBeTruthy();
  });
});
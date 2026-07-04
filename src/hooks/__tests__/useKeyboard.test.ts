/**
 * useKeyboard 单元测试 (T10 step-5a).
 *
 * 设计依据: docs/design/compiled.md §3.5.1 + §9.4 + 需求 FR-01 / FR-04 / CO-04.
 *
 * 覆盖:
 *   - Ctrl+F → 调 useSearch.open() + preventDefault
 *   - Cmd+F (macOS) → 同上
 *   - Ctrl+F 在已打开状态 → 再次 open (AC-01-2)
 *   - Esc 当 isOpen=true → 调 close (AC-04-1)
 *   - Esc 当 isOpen=false → no-op, 不抛错 (AC-04-2)
 *   - 单次注册: 卸载后 listener 被移除
 *   - 重复注册: 移除旧 listener
 *   - 集成: 与 useSearch 单例 store 联动
 *
 * 测试策略: 大部分 case 直接构造纯 mock API (vi.fn); 仅集成 case 跑真实 useSearch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import {
  registerSearchShortcuts,
  unregisterSearchShortcuts,
} from '../useKeyboard';
import { useSearch, __resetSearchForTest } from '../useSearch';

function flushRAF(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function setPlatform(value: string): void {
  Object.defineProperty(navigator, 'platform', { value, configurable: true });
  Object.defineProperty(navigator, 'userAgent', {
    value: value.includes('Mac')
      ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    configurable: true,
  });
}

beforeEach(() => {
  __resetSearchForTest();
  // jsdom 默认 platform 为空字符串 (非 Mac); 各测试按需覆盖.
  setPlatform('');
});

afterEach(() => {
  unregisterSearchShortcuts();
  vi.restoreAllMocks();
  setPlatform('');
});

describe('useKeyboard (T10 step-5a)', () => {
  it('Ctrl+F → open + preventDefault (AC-01-1 / CO-04)', () => {
    const openSpy = vi.fn();
    const api = { isOpen: () => false, open: openSpy, close: vi.fn() };
    registerSearchShortcuts(api);

    const ev = new KeyboardEvent('keydown', {
      key: 'f',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    const preventDefaultSpy = vi.spyOn(ev, 'preventDefault');
    window.dispatchEvent(ev);

    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(openSpy).toHaveBeenCalled();
  });

  it('Cmd+F (macOS) → open (AC-01-1)', () => {
    setPlatform('MacIntel');
    const openSpy = vi.fn();
    const api = { isOpen: () => false, open: openSpy, close: vi.fn() };
    registerSearchShortcuts(api);

    const ev = new KeyboardEvent('keydown', {
      key: 'f',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    const preventDefaultSpy = vi.spyOn(ev, 'preventDefault');
    window.dispatchEvent(ev);
    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(openSpy).toHaveBeenCalled();
  });

  it('Ctrl+F 在 isOpen=true 时 → 再次 open (AC-01-2)', () => {
    const openSpy = vi.fn();
    const api = { isOpen: () => true, open: openSpy, close: vi.fn() };
    registerSearchShortcuts(api);

    const ev = new KeyboardEvent('keydown', {
      key: 'f',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(ev);
    expect(openSpy).toHaveBeenCalled();
  });

  it('Esc 当 isOpen=true → close (AC-04-1)', () => {
    const closeSpy = vi.fn();
    const api = { isOpen: () => true, open: vi.fn(), close: closeSpy };
    registerSearchShortcuts(api);

    const ev = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    const preventDefaultSpy = vi.spyOn(ev, 'preventDefault');
    window.dispatchEvent(ev);
    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(closeSpy).toHaveBeenCalled();
  });

  it('Esc 当 isOpen=false → no-op, 不抛错 (AC-04-2)', () => {
    const closeSpy = vi.fn();
    const api = { isOpen: () => false, open: vi.fn(), close: closeSpy };
    registerSearchShortcuts(api);

    expect(() => {
      const ev = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(ev);
    }).not.toThrow();
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it('未注册的其它快捷键: 不响应', () => {
    const openSpy = vi.fn();
    const api = { isOpen: () => false, open: openSpy, close: vi.fn() };
    registerSearchShortcuts(api);

    const ev = new KeyboardEvent('keydown', {
      key: 'a',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(ev);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('unregister 后: 不再响应', () => {
    const openSpy = vi.fn();
    const api = { isOpen: () => false, open: openSpy, close: vi.fn() };
    registerSearchShortcuts(api);
    unregisterSearchShortcuts();

    const ev = new KeyboardEvent('keydown', {
      key: 'f',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(ev);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('重复注册: 移除旧 listener', () => {
    const api = { isOpen: () => false, open: vi.fn(), close: vi.fn() };
    registerSearchShortcuts(api);
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    registerSearchShortcuts(api);
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true);
  });

  it('集成: 与 useSearch 单例 store 联动 (AC-01-1 + AC-04-1)', async () => {
    const { result } = renderHook(() => useSearch('hello world'));
    act(() => {
      registerSearchShortcuts({
        isOpen: () => result.current.isOpen,
        open: result.current.open,
        close: result.current.close,
      });
    });

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'f',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await flushRAF();
    expect(result.current.isOpen).toBe(true);
  });
});
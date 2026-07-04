/**
 * useDebouncedValue 单元测试 (T10 step-1a).
 *
 * 设计依据: docs/design/compiled.md §4.2 (debounce 策略).
 *
 * 覆盖:
 *   - 初始挂载: debouncedValue === value, 不延迟.
 *   - 持续 setValue: 50ms 窗口内只提交末尾一次.
 *   - 清空 query (''): 立即同步, 不走 debounce (设计 §4.2 / AC-02-3).
 *   - 卸载时清掉未到期的 timer.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useDebouncedValue } from '../useDebouncedValue';

describe('useDebouncedValue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('初始挂载: debouncedValue === value, 立即同步', () => {
    const { result } = renderHook(() => useDebouncedValue('hello', 50));
    expect(result.current[0]).toBe('hello');
    expect(result.current[1]).toBe('hello');
  });

  it('setValue 后 50ms 窗口末尾提交一次', () => {
    const { result, rerender } = renderHook(
      ({ v }: { v: string }) => useDebouncedValue(v, 50),
      { initialProps: { v: 'a' } },
    );
    expect(result.current[1]).toBe('a');

    // 连续快速变更: a -> b -> c
    rerender({ v: 'b' });
    act(() => {
      vi.advanceTimersByTime(20);
    });
    rerender({ v: 'c' });
    act(() => {
      vi.advanceTimersByTime(20);
    });

    // 还没到 50ms: debounced 还是 'a'
    expect(result.current[1]).toBe('a');

    // 再推进超过 50ms: 提交末尾值 'c'
    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(result.current[1]).toBe('c');
  });

  it('空字符串: 跳过 debounce 立即同步 (设计 §4.2 / AC-02-3)', () => {
    const { result, rerender } = renderHook(
      ({ v }: { v: string }) => useDebouncedValue(v, 50),
      { initialProps: { v: 'foo' } },
    );
    expect(result.current[1]).toBe('foo');

    rerender({ v: '' });
    // 不推进 timer: 应当已经立即同步到 ''
    expect(result.current[1]).toBe('');
  });

  it('卸载时清掉未到期 timer (无 setState on unmounted)', () => {
    const { result, rerender, unmount } = renderHook(
      ({ v }: { v: string }) => useDebouncedValue(v, 50),
      { initialProps: { v: 'x' } },
    );
    rerender({ v: 'y' });
    // timer 已排, 但还没到.
    unmount();
    // 推进时间: 即使 timer 触发了 setState, 组件已卸载, 也不应该报 warn.
    expect(() => {
      act(() => {
        vi.advanceTimersByTime(100);
      });
    }).not.toThrow();
    expect(result.current[0]).toBe('y');
  });

  it('delay 变化: 使用最新 delay 重排 timer', () => {
    const { result, rerender } = renderHook(
      ({ v, d }: { v: string; d: number }) => useDebouncedValue(v, d),
      { initialProps: { v: 'a', d: 50 } },
    );

    rerender({ v: 'b', d: 50 });
    // 推进 30ms: 未到 (原 50ms 窗口).
    act(() => {
      vi.advanceTimersByTime(30);
    });
    expect(result.current[1]).toBe('a');

    // 改变 delay 到 200, 新的 timer 应当重新以 200ms 计时.
    rerender({ v: 'b', d: 200 });
    // 再推进 100ms (累计 130ms since 初始 debounce start): 未到 200ms.
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current[1]).toBe('a');

    // 再推进到 > 200ms: 应当提交 'b'.
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(result.current[1]).toBe('b');
  });
});
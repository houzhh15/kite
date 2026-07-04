/**
 * useSearch hook 本体单元测试 (T10 step-2b / step-2c).
 *
 * 设计依据: docs/design/compiled.md §3.1.4 + §4.3 + §9.1.
 *
 * 覆盖:
 *   - step-2b: 状态机 / setQuery debounce / next-prev 循环 / content 切换 / setOption
 *   - step-2c: scrollCurrentIntoView 节点缺失 warn 回退 / 节点存在时调用
 *
 * 策略: 使用真实 timer + 一帧等待 (80ms), 因为 jsdom rAF 与 fake timer 配合会死锁.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useSearch, __resetSearchForTest, getSearchInputRef } from '../useSearch';

function flushRAF(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/** 等 debounce (50ms) + 一帧 (16ms) 完成, 让 React commit & rAF 全部跑完. */
async function advanceAll(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 80));
  await flushRAF();
}

// jsdom 默认不实现 scrollIntoView. 在原型上挂一个 noop, 让 spy 能挂上.
if (typeof HTMLElement !== 'undefined' && !HTMLElement.prototype.scrollIntoView) {
  (HTMLElement.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView =
    function (): void {
      // noop
    };
}

describe('useSearch hook (T10 step-2b / step-2c)', () => {
  beforeEach(() => {
    __resetSearchForTest();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('初始挂载: query="", isOpen=false, count=0', () => {
    const { result } = renderHook(() => useSearch('hello world'));
    expect(result.current.query).toBe('');
    expect(result.current.isOpen).toBe(false);
    expect(result.current.count).toBe(0);
    expect(result.current.invalidRegex).toBe(false);
  });

  it('open: isOpen=true', () => {
    const { result } = renderHook(() => useSearch('hello world'));
    act(() => result.current.open());
    expect(result.current.isOpen).toBe(true);
  });

  it('close: query/hits/currentIndex/isOpen 全清 (AC-04-1)', async () => {
    const { result } = renderHook(() => useSearch('foo foo foo'));
    act(() => result.current.setQuery('foo'));
    await advanceAll();
    expect(result.current.count).toBe(3);

    act(() => result.current.close());
    expect(result.current.query).toBe('');
    expect(result.current.count).toBe(0);
    expect(result.current.currentIndex).toBe(0);
    expect(result.current.isOpen).toBe(false);
  });

  it('setQuery 后 50ms 才提交命中 (debounce)', async () => {
    const { result } = renderHook(() => useSearch('foo foo foo'));
    act(() => result.current.setQuery('foo'));
    // 还没到 50ms: 命中仍为 0
    expect(result.current.count).toBe(0);
    await advanceAll();
    expect(result.current.count).toBe(3);
  });

  it('清空 query 立即同步 (AC-02-3)', async () => {
    const { result } = renderHook(() => useSearch('foo foo'));
    act(() => result.current.setQuery('foo'));
    await advanceAll();
    expect(result.current.count).toBe(2);
    act(() => result.current.setQuery(''));
    // 不推进 timer: 立即清零
    expect(result.current.count).toBe(0);
  });

  it('next: currentIndex 从 0→1 (AC-03-1)', async () => {
    const { result } = renderHook(() => useSearch('foo foo foo'));
    act(() => result.current.setQuery('foo'));
    await advanceAll();
    expect(result.current.currentIndex).toBe(0);
    act(() => result.current.next());
    expect(result.current.currentIndex).toBe(1);
  });

  it('next 循环: count=3, current=2 → next → 0 (AC-03-2)', async () => {
    const { result } = renderHook(() => useSearch('foo foo foo'));
    act(() => result.current.setQuery('foo'));
    await advanceAll();
    act(() => result.current.next());
    act(() => result.current.next());
    expect(result.current.currentIndex).toBe(2);
    act(() => result.current.next());
    expect(result.current.currentIndex).toBe(0);
  });

  it('prev: 循环边界 0 → 倒数第一', async () => {
    const { result } = renderHook(() => useSearch('foo foo foo'));
    act(() => result.current.setQuery('foo'));
    await advanceAll();
    expect(result.current.currentIndex).toBe(0);
    act(() => result.current.prev());
    expect(result.current.currentIndex).toBe(2);
  });

  it('count=0 时 next/prev no-op (AC-03-3)', () => {
    const { result } = renderHook(() => useSearch('hello'));
    expect(result.current.count).toBe(0);
    act(() => result.current.next());
    expect(result.current.currentIndex).toBe(0);
    act(() => result.current.prev());
    expect(result.current.currentIndex).toBe(0);
  });

  it('content 切换: 自动 close (NFR-04-1)', async () => {
    const { result, rerender } = renderHook(
      ({ c }: { c: string }) => useSearch(c),
      { initialProps: { c: 'foo' } },
    );
    act(() => result.current.setQuery('foo'));
    await advanceAll();
    expect(result.current.count).toBe(1);

    rerender({ c: 'bar bar' });
    // useEffect 同步: 自动 close
    expect(result.current.query).toBe('');
    expect(result.current.isOpen).toBe(false);
    expect(result.current.count).toBe(0);
  });

  it('setOption caseSensitive: 立即重算命中数 (不走 debounce)', async () => {
    const { result } = renderHook(() => useSearch('Hello hello HELLO'));
    act(() => result.current.setQuery('hello'));
    await advanceAll();
    expect(result.current.count).toBe(3);
    act(() => result.current.setOption('caseSensitive', true));
    expect(result.current.count).toBe(1);
    expect(result.current.options.caseSensitive).toBe(true);
  });

  it('next 触发 scrollIntoView: 节点存在 → 调用 (AC-03-1)', async () => {
    const { result } = renderHook(() => useSearch('foo foo'));
    act(() => result.current.setQuery('foo'));
    await advanceAll();
    expect(result.current.count).toBe(2);

    const el = document.createElement('mark');
    el.setAttribute('data-search-hit', '1');
    document.body.appendChild(el);
    const scrollSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollIntoView')
      .mockImplementation(() => undefined);

    act(() => result.current.next());
    await flushRAF();
    expect(scrollSpy).toHaveBeenCalled();

    document.body.removeChild(el);
    scrollSpy.mockRestore();
  });

  it('scrollCurrentIntoView 节点缺失: console.warn 不抛错 (AC-03-3)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { result } = renderHook(() => useSearch('foo foo'));
    act(() => result.current.setQuery('foo'));
    await advanceAll();
    expect(result.current.count).toBe(2);
    // 没放任何 DOM 节点
    expect(() => result.current.scrollCurrentIntoView()).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith('search target missing, retrying');
  });

  it('inputRef 暴露供 useKeyboard 复用', () => {
    const { result } = renderHook(() => useSearch('foo'));
    expect(result.current.inputRef).toBeDefined();
    expect(getSearchInputRef()).toBeDefined();
  });
});
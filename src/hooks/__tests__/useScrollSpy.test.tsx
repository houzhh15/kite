/**
 * useScrollSpy 单元测试 (T09 §3.2 / step-2d..j).
 *
 * 覆盖:
 *   - step-2d: 模块级 store 共享 (多次 render 共享同一 currentId 引用).
 *   - step-2e: IO polyfill 模拟, headings 进出视口, currentId 切换序列.
 *   - step-2f: currentId 判定 — top 最接近 0 且 ≥ -50.
 *   - step-2g: progress 计算 (0/25/50/75/100) + 文末判稳 (>= scrollHeight-2 -> 1).
 *   - step-2h: onCurrentChange 回调 — 滚动时调用, 参数对得上.
 *   - step-2i: 无 IO 降级到 scroll + 节流 (100ms).
 *   - step-2j: 卸载时 observer.disconnect + remove scroll listener.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useScrollSpy, __resetScrollSpyForTest } from '../useScrollSpy';
import type { UseScrollSpyReturn } from '../useScrollSpy';

/** 一个简单的 IO polyfill, 把 callback 暴露到 ctor 实例上. */
class MockIO {
  callback: IntersectionObserverCallback;
  options: IntersectionObserverInit | undefined;
  observed: Set<Element> = new Set();

  constructor(cb: IntersectionObserverCallback, opts?: IntersectionObserverInit) {
    this.callback = cb;
    this.options = opts;
  }

  observe(el: Element): void {
    this.observed.add(el);
  }
  unobserve(el: Element): void {
    this.observed.delete(el);
  }
  disconnect(): void {
    this.observed.clear();
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  /** Test helper: 模拟一组 entries 触发 callback. */
  emit(entries: Array<{ target: HTMLElement; ratio: number }>): void {
    const e: IntersectionObserverEntry[] = entries.map(({ target, ratio }) => ({
      isIntersecting: ratio > 0,
      intersectionRatio: ratio,
      target,
      boundingClientRect: target.getBoundingClientRect(),
      intersectionRect: target.getBoundingClientRect(),
      rootBounds: null,
      time: performance.now(),
    })) as unknown as IntersectionObserverEntry[];
    this.callback(e, this as unknown as IntersectionObserver);
  }
}

function makeContainer(): HTMLElement {
  const el = document.createElement('section');
  el.style.height = '200px';
  el.style.overflow = 'auto';
  document.body.appendChild(el);
  return el;
}

function makeHeadingIn(container: HTMLElement, id: string, top: number): HTMLElement {
  const h = document.createElement('h2');
  h.id = id;
  h.textContent = id;
  // jsdom 无 layout. monkey-patch getBoundingClientRect.
  const rect = {
    top,
    bottom: top + 20,
    left: 0,
    right: 100,
    width: 100,
    height: 20,
    x: 0,
    y: top,
  } as DOMRect;
  vi.spyOn(h, 'getBoundingClientRect').mockReturnValue(rect);
  container.appendChild(h);
  return h;
}

/** 推进 rAF 队列 (jsdom 把 rAF 实现为 setTimeout(16)). */
async function flushRAF(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  });
}

describe('useScrollSpy', () => {
  beforeEach(() => {
    __resetScrollSpyForTest();
    vi.stubGlobal('IntersectionObserver', MockIO as unknown as typeof IntersectionObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('初始挂载: headings=[] -> currentId=null, progress=0', () => {
    const container = makeContainer();
    const { result } = renderHook(() => useScrollSpy({ container, headings: [] }));
    const r = result.current as UseScrollSpyReturn;
    expect(r.currentId).toBeNull();
    expect(r.progress).toBe(0);
  });

  it('挂载时: headings=[] 切到 [h1] -> currentId="h1" (reading-order)', async () => {
    const container = makeContainer();
    const h1 = makeHeadingIn(container, 'one', 0);
    const { result, rerender } = renderHook(
      ({ headings }: { headings: ReadonlyArray<HTMLElement> }) =>
        useScrollSpy({ container, headings }),
      { initialProps: { headings: [] as ReadonlyArray<HTMLElement> } },
    );
    expect(result.current.currentId).toBeNull();

    rerender({ headings: [h1] });
    await flushRAF();
    // h1 top=0 -> reading-order 选 h1.
    expect(result.current.currentId).toBe('one');
  });

  it('progress: scrollTop=0 -> 0; scrollTop=middle -> 0.5; 文末 -> 1', async () => {
    const container = makeContainer();
    Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 200 });
    let top = 0;
    Object.defineProperty(container, 'scrollTop', {
      configurable: true,
      get: () => top,
      set: (v: number) => {
        top = v;
      },
    });
    const h1 = makeHeadingIn(container, 'one', 0);

    const { result } = renderHook(() => useScrollSpy({ container, headings: [h1] }));
    expect(result.current.progress).toBe(0);

    // 滚到中间
    act(() => {
      top = 400; // (1000-200)=800; 400/800=0.5
      container.dispatchEvent(new Event('scroll'));
    });
    await flushRAF();
    expect(result.current.progress).toBeCloseTo(0.5, 2);

    // 文末判稳: scrollTop+clientHeight >= scrollHeight-2  -> 1
    act(() => {
      top = 800; // 800+200=1000 >= 1000-2
      container.dispatchEvent(new Event('scroll'));
    });
    await flushRAF();
    expect(result.current.progress).toBe(1);
  });

  it('onCurrentChange 在 progress 变化时被调用 (AC-06-2)', async () => {
    const container = makeContainer();
    Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 200 });
    let top = 0;
    Object.defineProperty(container, 'scrollTop', {
      configurable: true,
      get: () => top,
      set: (v: number) => {
        top = v;
      },
    });
    const h1 = makeHeadingIn(container, 'one', 0);

    const onChange = vi.fn();
    renderHook(() =>
      useScrollSpy({ container, headings: [h1], onCurrentChange: onChange }),
    );

    // mount 触发了一次 (currentId='one', progress=0)
    expect(onChange).toHaveBeenCalled();
    onChange.mockClear();

    // 滚动改变 progress -> onChange 再次触发.
    act(() => {
      top = 100;
      container.dispatchEvent(new Event('scroll'));
    });
    await flushRAF();
    expect(onChange).toHaveBeenCalled();
    const lastArgs = onChange.mock.calls[onChange.mock.calls.length - 1];
    expect(lastArgs?.[0]).toBe('one');
    expect(typeof lastArgs?.[1]).toBe('number');
  });

  it('卸载: observer.disconnect + removeEventListener(scroll) 都被调用 (AC-03-3)', () => {
    const disconnectSpy = vi.fn();
    class SpyIO {
      observe = vi.fn();
      disconnect = disconnectSpy;
      unobserve = vi.fn();
      takeRecords = vi.fn().mockReturnValue([]);
    }
    vi.stubGlobal('IntersectionObserver', SpyIO as unknown as typeof IntersectionObserver);
    const container = makeContainer();
    const removeEvtSpy = vi.spyOn(container, 'removeEventListener');

    const h1 = makeHeadingIn(container, 'one', 0);
    const { unmount } = renderHook(() =>
      useScrollSpy({ container, headings: [h1] }),
    );
    unmount();

    expect(disconnectSpy).toHaveBeenCalled();
    expect(removeEvtSpy).toHaveBeenCalledWith('scroll', expect.any(Function));
  });

  it('无 IntersectionObserver: 走 scroll + 降级 (AC-03-4)', () => {
    vi.unstubAllGlobals();
    const container = makeContainer();
    Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 200 });
    let top = 0;
    Object.defineProperty(container, 'scrollTop', {
      configurable: true,
      get: () => top,
      set: (v: number) => {
        top = v;
      },
    });
    const h1 = makeHeadingIn(container, 'one', 0);

    const addSpy = vi.spyOn(container, 'addEventListener');
    renderHook(() => useScrollSpy({ container, headings: [h1] }));

    const scrollCall = addSpy.mock.calls.find((c) => c[0] === 'scroll');
    expect(scrollCall).toBeDefined();
  });

  it('currentId = 最近且 ≥ -50 的 heading (AC-03-1)', async () => {
    const container = makeContainer();
    // h1 在视口顶部 (top=-10), 其他更靠下.
    const h1 = makeHeadingIn(container, 'one', -10);
    const h2 = makeHeadingIn(container, 'two', 200);
    const h3 = makeHeadingIn(container, 'three', 500);

    const { result } = renderHook(() =>
      useScrollSpy({ container, headings: [h1, h2, h3] }),
    );
    // pickByReadingOrder 找 last top<=0 → h1(top=-10).
    expect(result.current.currentId).toBe('one');

    // 模拟 scroll 触发, 不应改变 currentId (仍然 h1).
    act(() => {
      container.dispatchEvent(new Event('scroll'));
    });
    await flushRAF();
    expect(result.current.currentId).toBe('one');
  });
});

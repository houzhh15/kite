/**
 * useScrollSpy — T09 当前章节追踪 Hook (FR-03 / 设计 §3.3).
 *
 * 设计依据: docs/design/compiled.md §3.3 + docs/plan/compiled.md §3.2.
 *
 * 责任:
 *   - 监听 `<Reader>` 内 `h1[id]..h6[id]` 节点, 通过 IntersectionObserver
 *     维护 `currentId: string | null`.
 *   - 暴露 `progress: number ∈ [0, 1]` (由 Reader `scroll` 事件 + RAF 节流
 *     计算 `scrollTop / (scrollHeight - clientHeight)`, 文末判稳).
 *   - 暴露可选 `onCurrentChange(id, progress)` 回调, 供 T11 持久化接入.
 *   - DOM `headings` 数组引用变化时自动 re-subscribe (AC-03-2).
 *   - 不支持 IntersectionObserver 时降级到 `scroll` + 100ms throttle (AC-03-4).
 *   - 卸载时 `observer.disconnect()` + remove scroll listener (NFR-ROBUST-2).
 *
 * 模块作用域极简 store (与 useImageViewer 同模式, D-3):
 *   - 多个 hook 调用共享同一份 `currentId` / `progress` 快照.
 *   - Reader 内的滚动事件 → outline / progressbar / statusbar 三处可订阅.
 *   - 不引入 React Context; 不新建 zustand store.
 *
 * 重要: `useSyncExternalStore` 需要 `getSnapshot` 在值未变时返回**同一引用**;
 * 我们用单一 `_snapshot` 对象, 仅当 `currentId` 或 `progress` 真正变化时覆写,
 * 否则保持原引用.
 */

import { useEffect, useRef, useSyncExternalStore } from 'react';

export interface UseScrollSpyOptions {
  /** 滚动容器 DOM (Reader 的 <section>). 必填. */
  container: HTMLElement | null;
  /** 当前文档所有标题 DOM 节点列表 (来自 ref + querySelectorAll). */
  headings: ReadonlyArray<HTMLElement>;
  /** 状态变化回调 (FR-06), T11 接入 lastPosition. */
  onCurrentChange?: (id: string | null, progress: number) => void;
  /** IntersectionObserver rootMargin. 默认偏向视口顶部. */
  rootMargin?: string;
}

export interface UseScrollSpyReturn {
  currentId: string | null;
  /** ∈ [0, 1] */
  progress: number;
  /** heading id -> intersectionRatio. */
  ratios: ReadonlyMap<string, number>;
}

/* -------------------------------------------------------------------------- */
/* 模块作用域 store                                                           */
/* -------------------------------------------------------------------------- */

interface SpySnapshot {
  currentId: string | null;
  progress: number;
}

const DEFAULT_SNAPSHOT: SpySnapshot = { currentId: null, progress: 0 };

let _snapshot: SpySnapshot = DEFAULT_SNAPSHOT;
let _ratios: Map<string, number> = new Map();
const _listeners = new Set<() => void>();
let _lastEmitted: { id: string | null; progress: number } | null = null;
type OnChangeCb = (id: string | null, progress: number) => void;
let _onChange: OnChangeCb | null = null;

function setSnapshot(next: SpySnapshot): boolean {
  // 仅在 currentId 或 progress 真正变化时更新 (避免 useSyncExternalStore 死循环).
  if (_snapshot.currentId === next.currentId && _snapshot.progress === next.progress) {
    return false;
  }
  _snapshot = next;
  notify();
  return true;
}

function notify(): void {
  for (const l of _listeners) l();
  if (_onChange) {
    const cur = { id: _snapshot.currentId, progress: _snapshot.progress };
    const last = _lastEmitted;
    if (!last || last.id !== cur.id || Math.abs(last.progress - cur.progress) > 1e-6) {
      _lastEmitted = cur;
      try {
        _onChange(cur.id, cur.progress);
      } catch (err) {
        console.warn('[useScrollSpy] onCurrentChange threw:', err);
      }
    }
  }
}

function subscribe(cb: () => void): () => void {
  _listeners.add(cb);
  return () => {
    _listeners.delete(cb);
  };
}

function getSnapshot(): SpySnapshot {
  return _snapshot;
}

function getServerSnapshot(): SpySnapshot {
  return DEFAULT_SNAPSHOT;
}

/** 仅测试/特殊场景使用: 重置模块级状态. */
export function __resetScrollSpyForTest(): void {
  _snapshot = DEFAULT_SNAPSHOT;
  _ratios = new Map();
  _listeners.clear();
  _lastEmitted = null;
  _onChange = null;
}

/* -------------------------------------------------------------------------- */
/* 工具函数                                                                   */
/* -------------------------------------------------------------------------- */

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

function readProgress(container: HTMLElement): number {
  const scrollHeight = container.scrollHeight;
  const clientHeight = container.clientHeight;
  const scrollTop = container.scrollTop;
  const max = scrollHeight - clientHeight;
  if (max <= 0) return 0;
  // 文末判稳 (AC-04-2)
  if (scrollTop + clientHeight >= scrollHeight - 2) return 1;
  return clamp(scrollTop / max, 0, 1);
}

function pickByReadingOrder(
  headings: ReadonlyArray<HTMLElement>,
  container: HTMLElement,
): { id: string | null; progress: number } {
  const progress = readProgress(container);
  if (headings.length === 0) return { id: null, progress };

  // 找最后一个 top <= 0 的 heading (在视口顶部或上方, 即"已滚过").
  const containerRect = container.getBoundingClientRect();
  const containerTop = containerRect.top;
  let lastAbove: { id: string; top: number } | null = null;
  for (const el of headings) {
    const rect = el.getBoundingClientRect();
    const top = rect.top - containerTop;
    const id = el.id;
    if (!id) continue;
    if (top <= 0) {
      lastAbove = { id, top };
    }
  }
  return { id: lastAbove?.id ?? null, progress };
}

function selectCurrentByIO(
  ratios: ReadonlyMap<string, number>,
  headings: ReadonlyArray<HTMLElement>,
): string | null {
  // 视口内有交集的 heading, 按距视口顶部最近(且 ≥ -50)选一.
  let best: { id: string; top: number } | null = null;
  for (const h of headings) {
    const r = ratios.get(h.id);
    if (r === undefined || r <= 0) continue;
    const rect = h.getBoundingClientRect();
    // element.top 是相对于 viewport (非 container); 我们用绝对值距离 0 最近.
    const dist = rect.top;
    if (dist < -50) continue;
    if (best === null || Math.abs(dist) < Math.abs(best.top)) {
      best = { id: h.id, top: dist };
    }
  }
  return best?.id ?? null;
}

/* -------------------------------------------------------------------------- */
/* Hook                                                                       */
/* -------------------------------------------------------------------------- */

export function useScrollSpy(options: UseScrollSpyOptions): UseScrollSpyReturn {
  const { container, headings, onCurrentChange, rootMargin } = options;

  // 订阅模块级 store
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // 注册 onCurrentChange
  useEffect(() => {
    _onChange = onCurrentChange ?? null;
    _lastEmitted = null;
    return () => {
      if (_onChange === onCurrentChange) {
        _onChange = null;
        _lastEmitted = null;
      }
    };
  }, [onCurrentChange]);

  // 单次容器绑定 + scroll 监听 (lifecycle 期间持续)
  const boundRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!container) {
      boundRef.current = null;
      return;
    }
    if (boundRef.current === container) return;
    boundRef.current = container;

    let rafId: number | null = null;
    let scrollThrottle: ReturnType<typeof setTimeout> | null = null;

    const computeAndSet = (): void => {
      if (!boundRef.current) return;
      const progress = readProgress(boundRef.current);
      let id: string | null;
      const hasIO =
        typeof globalThis !== 'undefined' &&
        typeof (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver !==
          'undefined';
      if (hasIO) {
        id = selectCurrentByIO(_ratios, headings);
        if (!id) {
          id = pickByReadingOrder(headings, boundRef.current).id;
        }
      } else {
        id = pickByReadingOrder(headings, boundRef.current).id;
      }
      setSnapshot({ currentId: id, progress });
    };

    const hasRAF = typeof requestAnimationFrame === 'function';
    const onScroll = (): void => {
      if (hasRAF) {
        if (rafId !== null) return;
        rafId = requestAnimationFrame(() => {
          rafId = null;
          computeAndSet();
        });
      } else {
        if (scrollThrottle !== null) return;
        scrollThrottle = setTimeout(() => {
          scrollThrottle = null;
          computeAndSet();
        }, 100);
      }
    };

    container.addEventListener('scroll', onScroll, { passive: true });

    // 初始计算 (mount 时立即给一个 currentId)
    computeAndSet();

    return () => {
      if (rafId !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafId);
      }
      if (boundRef.current) {
        boundRef.current.removeEventListener('scroll', onScroll);
      }
      if (scrollThrottle !== null) clearTimeout(scrollThrottle);
      boundRef.current = null;
    };
    // 注: `headings` 变化由独立 effect 处理 (建立 IntersectionObserver).
  }, [container, rootMargin]);

  // headings 引用变化: 重建 IntersectionObserver + 立即基于 reading-order 计算一次
  useEffect(() => {
    if (!container) return;
    const IO = (globalThis as { IntersectionObserver?: typeof IntersectionObserver })
      .IntersectionObserver;
    if (!IO) {
      // 降级路径: 无 IO, 仅靠 scroll 事件驱动; 立即算一次 reading-order.
      const fb = pickByReadingOrder(headings, container);
      setSnapshot({ currentId: fb.id, progress: fb.progress });
      return;
    }

    const observer = new IO(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).id;
          if (!id) continue;
          _ratios.set(id, e.intersectionRatio);
        }
      },
      {
        root: null,
        rootMargin: rootMargin ?? '0px 0px -60% 0px',
        threshold: [0, 0.25, 0.5, 0.75, 1],
      },
    );
    for (const h of headings) observer.observe(h);

    // 立即根据 reading-order 计算 (保证首屏/挂载时 currentId 已有合理值)
    const fb = pickByReadingOrder(headings, container);
    setSnapshot({ currentId: fb.id, progress: fb.progress });

    return () => {
      observer.disconnect();
    };
  }, [headings, container, rootMargin]);

  return {
    currentId: snap.currentId,
    progress: snap.progress,
    ratios: _ratios,
  };
}

export default useScrollSpy;

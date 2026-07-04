/**
 * useProgress — T11 阅读进度订阅与防抖落盘 (FR-08 / FR-09, 设计 §3.6.9).
 *
 * 设计依据: docs/design/compiled.md §3.4 + §3.6.9 + 需求 FR-08.
 *
 * 责任:
 *   - 订阅 useScrollSpy 的 progress (∈[0,1]);
 *   - 当 progress / 滚动容器变化时, 订阅 useDocStore.currentPath, 写入 progressStore;
 *   - 不直接调 IPC; 通过 progressStore.flush 触发;
 *   - onUnmount: flush(true) 同步落盘 (NFR-Robust-1).
 *
 * 性能 (设计 §3.10):
 *   - 滚动走 RAF (useScrollSpy 已有); 落盘走 300ms debounce (progressStore 内).
 *   - 100 次连续滚动只产生 1~2 次 IPC (NFR-1).
 *
 * 纪律:
 *   - 不持有持久化; 不调 IPC.
 *   - scrollContainer 传入后用于读取 scrollTop (虽然 Reader 已通过 useScrollSpy 间接计算,
 *     这里仅用其作为生命周期信号, 不重新监听 scroll 事件).
 */
import { useEffect, useRef } from 'react';

import { __resetScrollSpyForTest, useScrollSpy } from './useScrollSpy';
import { useDocStore } from '../stores/docStore';
import { useProgressStore } from '../stores/progressStore';

export interface UseProgressOptions {
  /** 滚动容器 DOM; null 时仅订阅 useScrollSpy 模块级 progress. */
  scrollContainer?: HTMLElement | null;
}

export interface UseProgressReturn {
  /** 0..100 整数百分比 (与 useScrollSpy.progress 一致). */
  pct: number;
  /** 强制立即落盘 (供 useMarkdownDoc 在 OPEN_OK 后调用). */
  persistNow(): void;
}

/**
 * useProgress — 在 App / Reader 顶层挂载, 订阅 progress + 自动落盘.
 *
 * 不接收 content / headings 等参数; Reader 仍独立调 useScrollSpy 传 headings,
 * useProgress 仅消费 useScrollSpy 的模块级 snapshot.progress.
 */
export function useProgress(options: UseProgressOptions = {}): UseProgressReturn {
  const { scrollContainer } = options;
  // 订阅 useScrollSpy 模块级 snapshot (与 Reader 内部 useScrollSpy 共享).
  const { progress } = useScrollSpy({
    container: scrollContainer ?? null,
    headings: [],
    rootMargin: '0px 0px -60% 0px',
  });

  const lastProgressRef = useRef<number>(0);

  useEffect(() => {
    const pctInt = Math.round(progress * 100);
    if (pctInt === lastProgressRef.current) return;
    lastProgressRef.current = pctInt;
    const currentPath = useDocStore.getState().state.currentPath;
    if (!currentPath) return;
    // 取滚动容器 scrollTop (若有); 否则用估算值 (progress * max).
    const scrollTop =
      scrollContainer instanceof HTMLElement
        ? scrollContainer.scrollTop
        : 0;
    useProgressStore.getState().setProgress(currentPath, pctInt, scrollTop);
  }, [progress, scrollContainer]);

  // 文档切换 (currentPath 变化) → flush 老值, 防止 pending debounce 丢失 (R-04).
  useEffect(() => {
    const unsub = useDocStore.subscribe((state) => {
      const next = state.state.currentPath;
      if (typeof next === 'string' && next.length > 0) {
        // 文档切换时立即 flush 老值 (force=true 取消 pending).
        void useProgressStore.getState().flush(true);
        // 重置 ref, 避免上一次的 pct 残留.
        lastProgressRef.current = -1;
      }
    });
    return () => {
      unsub();
    };
  }, []);

  // onUnmount flush (NFR-Robust-1).
  useEffect(() => {
    return () => {
      void useProgressStore.getState().flush(true);
    };
  }, []);

  return {
    pct: Math.round(progress * 100),
    persistNow() {
      void useProgressStore.getState().flush(true);
    },
  };
}

export default useProgress;

// 显式 re-export 测试用 helpers.
export { __resetScrollSpyForTest };
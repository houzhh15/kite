/**
 * useProgress — T11 阅读进度订阅与防抖落盘 (FR-08 / FR-09, 设计 §3.6.9).
 *
 * 设计依据: docs/design/compiled.md §3.4 + §3.6.9 + 需求 FR-08.
 *
 * 责任:
 *   - 接收 Reader 唯一 ScrollSpy 计算出的 progress (∈[0,1]);
 *   - 当 progress / scrollTop 变化时, 订阅 useDocStore.currentPath, 写入 progressStore;
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
import { useDocStore } from '../stores/docStore';
import { useProgressStore } from '../stores/progressStore';

export interface UseProgressOptions {
  /** 产生该进度样本的文档路径；null 表示尚无可持久化文档。 */
  path: string | null;
  /** Reader 唯一 ScrollSpy 计算出的 0..1 阅读进度。 */
  progress: number;
  /** 同一 Reader 滚动容器的当前位置，用于下次恢复。 */
  scrollTop: number;
}

export interface UseProgressReturn {
  /** 0..100 整数百分比 (与 useScrollSpy.progress 一致). */
  pct: number;
  /** 强制立即落盘 (供 useMarkdownDoc 在 OPEN_OK 后调用). */
  persistNow(): void;
}

/**
 * useProgress — 在 App 顶层挂载，消费 Reader 上报值并自动落盘。
 *
 * 该 Hook 不监听 DOM、不创建 ScrollSpy；Reader 是滚动状态的唯一所有者。
 */
export function useProgress(options: UseProgressOptions): UseProgressReturn {
  const { path, progress, scrollTop } = options;
  const currentPath = useDocStore((state) => state.state.currentPath);
  const lastProgressRef = useRef<number>(-1);

  useEffect(() => {
    const pctInt = Math.round(progress * 100);
    if (pctInt === lastProgressRef.current) return;
    lastProgressRef.current = pctInt;
    // 路径切换时可能仍收到旧 Reader 的最后一个样本，绝不能写入新文档。
    if (!currentPath || path !== currentPath) return;
    useProgressStore.getState().setProgress(currentPath, pctInt, scrollTop);
  }, [currentPath, path, progress, scrollTop]);

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
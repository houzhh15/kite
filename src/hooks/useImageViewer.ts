/**
 * useImageViewer — T08 step-4 (设计 §3.2.2).
 *
 * 责任:
 *   - 单一 ImageViewer 实例入口.
 *   - `current === null` 表示未打开; 否则含 src/alt.
 *   - `open(src, alt?)` 重复调用会**替换** current, 不叠加 (NFR-U-2).
 *   - `close()` 后 current === null.
 *
 * 约束:
 *   - 模块作用域 store, 整个应用共用一份; 调用 `useImageViewer()` 只是订阅,
 *     不创建新实例. 这样保证即使多个组件调用, 状态也一致.
 *   - 不持有图片缓存, 由 imageCache.ts 单独管理.
 */

import { useSyncExternalStore } from 'react';

export interface ImageViewerState {
  src: string;
  alt: string;
}

export interface ImageViewerApi {
  current: ImageViewerState | null;
  open: (src: string, alt?: string) => void;
  close: () => void;
}

// ---- 模块作用域的极简 store ----
let _current: ImageViewerState | null = null;
const _listeners = new Set<() => void>();

function notify(): void {
  for (const l of _listeners) l();
}

function subscribe(cb: () => void): () => void {
  _listeners.add(cb);
  return () => {
    _listeners.delete(cb);
  };
}

function getSnapshot(): ImageViewerState | null {
  return _current;
}

function getServerSnapshot(): ImageViewerState | null {
  return null;
}

function open(src: string, alt?: string): void {
  const next: ImageViewerState = { src, alt: alt ?? src };
  // 重复 open 替换 (不叠加), NFR-U-2.
  _current = next;
  notify();
}

function close(): void {
  if (_current === null) return;
  _current = null;
  notify();
}

export function useImageViewer(): ImageViewerApi {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return { current, open, close };
}

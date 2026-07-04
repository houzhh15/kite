/**
 * src/lib/toast.ts — 极简全局 toast store (NFR-U-01 / 设计 §3.7.2).
 *
 * 设计依据: docs/design/compiled.md §3.7.2 + docs/plan/compiled.md Step 5.
 *
 *   - 仅 zustand, 不引入额外 UI 库.
 *   - 不调用 IPC; 不读 useDocStore, 不动渲染态.
 *   - `pushToast({kind, message})` 立刻追加; 5s 自动清 (在 Toaster.tsx 中实现).
 *   - `clearToast(id)` 允许手动关闭某条 (UI 重试/关闭按钮用).
 */

import { create } from 'zustand';

export type ToastKind = 'info' | 'success' | 'error';

export interface ToastItem {
  /** 本地生成的 nanoid 替身; 同时是 zustand items 的 key. */
  id: string;
  kind: ToastKind;
  message: string;
}

export interface ToastStore {
  items: ToastItem[];
  pushToast(input: Omit<ToastItem, 'id'>): void;
  clearToast(id: string): void;
}

let counter = 0;
/** 简易 id 生成 (替代 nanoid 以避免新增依赖). */
function nextId(): string {
  counter += 1;
  return `t-${Date.now().toString(36)}-${counter}`;
}

export const useToastStore = create<ToastStore>((set) => ({
  items: [],
  pushToast(input) {
    const item: ToastItem = { id: nextId(), ...input };
    set((s) => ({ items: [...s.items, item] }));
  },
  clearToast(id) {
    set((s) => ({ items: s.items.filter((t) => t.id !== id) }));
  },
}));

/** 便捷 API: 跳过 store 选择器, 直接 push. */
export function pushToast(input: { kind: ToastKind; message: string }): void {
  useToastStore.getState().pushToast(input);
}

/** 便捷 API: 按 id 关闭. */
export function clearToast(id: string): void {
  useToastStore.getState().clearToast(id);
}

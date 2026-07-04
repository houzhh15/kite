/**
 * layoutStore — T15 (FR-01) 布局级 UI 状态.
 *
 * 责任:
 *   - treeOpen: 目录树抽屉可见性.
 *   - toggleTree / setTreeOpen: 切换 / 设置.
 *   - 不持久化 (UI 级状态, 不属于 preferences).
 *   - 不调 IPC.
 *
 * 设计依据: docs/design/compiled.md §3.4 / 需求 FR-01 / AC-01-1.
 */

import { create } from 'zustand';

export interface LayoutState {
  /** 目录树抽屉是否可见. */
  treeOpen: boolean;
}

export interface LayoutStore extends LayoutState {
  /** 切换 treeOpen (Ctrl/Cmd+T / Toolbar.tree 按钮). */
  toggleTree(): void;
  /** 显式设置 treeOpen. */
  setTreeOpen(open: boolean): void;
}

export const useLayoutStore = create<LayoutStore>((set) => ({
  treeOpen: false,
  toggleTree() {
    set((s) => ({ treeOpen: !s.treeOpen }));
  },
  setTreeOpen(open: boolean) {
    set(() => ({ treeOpen: open }));
  },
}));

/** 等价访问器. */
export function isTreeOpen(): boolean {
  return useLayoutStore.getState().treeOpen;
}

/** 切换 treeOpen. 模块级函数, 便于 useKeyboard 注册. */
export function toggleTree(): void {
  useLayoutStore.getState().toggleTree();
}

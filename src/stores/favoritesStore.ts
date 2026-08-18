/**
 * favoritesStore.ts — 收藏 (favorites) 状态.
 *
 * 设计:
 *   - 数据唯一来源: Rust 端 favorites.json (src-tauri/src/services/favorites.rs).
 *   - 变更类 IPC 统一返回"变更后整包快照", 本 store 直接替换 snapshot —
 *     不做增量合并, 失败时本地状态自动保持原样 (无需回滚逻辑).
 *   - pendingKeys: 进行中的操作 key (如 `fav:<path>`, `folder:<id>`),
 *     防止双击星标等竞态; UI 据此禁用按钮.
 *   - web 模式 (无 Tauri) / IPC 失败 → snapshot 留空 + loaded=true, UI 不崩.
 */

import { create } from 'zustand';

import i18n from '../i18n';
import { tauri } from '../lib/tauri';
import type {
  FavoriteFile,
  FavoriteFolder,
  FavoritesSnapshot,
} from '../lib/tauri';
import { pushToast } from '../lib/toast';

/** 空快照 (web 模式 / IPC 不可用时的兜底). */
export const EMPTY_FAVORITES_SNAPSHOT: FavoritesSnapshot = Object.freeze({
  version: 1,
  folders: [],
  files: [],
}) as FavoritesSnapshot;

export interface FavoritesStoreState {
  snapshot: FavoritesSnapshot;
  /** load() 完成 (成功或兜底) — 未完成前 UI 应禁用收藏操作. */
  loaded: boolean;
  /** 进行中的操作 key 集合 (字符串数组, 便于不可变更新). */
  pendingKeys: string[];
}

export interface FavoritesStoreActions {
  load(): Promise<void>;
  addFavorite(path: string, parentId?: string | null): Promise<boolean>;
  removeFavorite(fileId: string): Promise<boolean>;
  createFolder(parentId: string | null, name: string): Promise<boolean>;
  renameFolder(folderId: string, name: string): Promise<boolean>;
  moveNode(nodeId: string, targetParentId: string | null): Promise<boolean>;
  deleteFolder(folderId: string, recursive: boolean): Promise<boolean>;
}

export type FavoritesStore = FavoritesStoreState & FavoritesStoreActions;

/** 收藏路径的 pending key — 大小写归一, 避免 Windows/macOS 路径大小写差异. */
export function pendingKeyForPath(path: string): string {
  return `fav:${path.toLowerCase()}`;
}

export function folderPendingKey(id: string): string {
  return `folder:${id}`;
}

function isPending(pendingKeys: readonly string[], key: string): boolean {
  return pendingKeys.includes(key);
}

function fail(messageKey = 'favorites.opFailed'): void {
  pushToast({ kind: 'error', message: i18n.t(messageKey) });
}

/**
 * 前端目录名预校验 (与 Rust validate_folder_name 对齐, 给即时反馈).
 * 返回 true=合法.
 */
export function isValidFolderName(name: string): boolean {
  const n = name.trim();
  if (!n || n.includes('\0')) return false;
  if (n.includes('/') || n.includes('\\')) return false;
  if ([...n].length > 100) return false;
  return true;
}

const useFavoritesStore = create<FavoritesStore>((set, get) => {
  /** 变更类操作统一流程: 挂 key → IPC(整包快照) → 替换 snapshot → 解 key. */
  async function runMutation(
    key: string,
    call: () => Promise<FavoritesSnapshot>,
  ): Promise<boolean> {
    if (isPending(get().pendingKeys, key)) return false;
    set((s) => ({ pendingKeys: [...s.pendingKeys, key] }));
    try {
      const snap = await call();
      set({ snapshot: normalizeSnapshot(snap) });
      return true;
    } catch (err) {
      console.warn('[favorites] mutation failed', err);
      fail();
      return false;
    } finally {
      set((s) => ({ pendingKeys: s.pendingKeys.filter((k) => k !== key) }));
    }
  }

  return {
    snapshot: EMPTY_FAVORITES_SNAPSHOT,
    loaded: false,
    pendingKeys: [],

    async load() {
      try {
        const snap = await tauri.getFavorites();
        set({ snapshot: normalizeSnapshot(snap), loaded: true });
      } catch (err) {
        // web 模式 / IPC 不可用 → 空收藏兜底, UI 不崩.
        console.warn('[favorites] load failed', err);
        set({ snapshot: EMPTY_FAVORITES_SNAPSHOT, loaded: true });
      }
    },

    async addFavorite(path, parentId = null) {
      if (!path || !isValidPathForAdd(path)) return false;
      return runMutation(pendingKeyForPath(path), () =>
        tauri.addFavorite(path, parentId),
      );
    },

    async removeFavorite(fileId) {
      return runMutation(folderPendingKey(fileId), () =>
        tauri.removeFavorite(fileId),
      );
    },

    async createFolder(parentId, name) {
      if (!isValidFolderName(name)) {
        fail('favorites.nameInvalid');
        return false;
      }
      return runMutation(folderPendingKey(`new:${parentId ?? 'root'}`), () =>
        tauri.createFavoriteFolder(parentId, name.trim()),
      );
    },

    async renameFolder(folderId, name) {
      if (!isValidFolderName(name)) {
        fail('favorites.nameInvalid');
        return false;
      }
      return runMutation(folderPendingKey(folderId), () =>
        tauri.renameFavoriteFolder(folderId, name.trim()),
      );
    },

    async moveNode(nodeId, targetParentId) {
      return runMutation(folderPendingKey(nodeId), () =>
        tauri.moveFavoriteNode(nodeId, targetParentId),
      );
    },

    async deleteFolder(folderId, recursive) {
      const ok = await runMutation(folderPendingKey(folderId), () =>
        tauri.deleteFavoriteFolder(folderId, recursive),
      );
      if (ok) {
        pushToast({ kind: 'success', message: i18n.t('favorites.removedToast') });
      }
      return ok;
    },
  };
});

export default useFavoritesStore;

// ─────────────────────────────────────────────────────────────────
// 纯函数助手 (组件渲染/测试共用)
// ─────────────────────────────────────────────────────────────────

function isValidPathForAdd(path: string): boolean {
  return typeof path === 'string' && path.trim().length > 0;
}

/** IPC 返回防御: 字段缺失/类型错误 → 兜底为空结构. */
export function normalizeSnapshot(snap: unknown): FavoritesSnapshot {
  const s = (snap ?? {}) as Partial<FavoritesSnapshot>;
  return {
    version: typeof s.version === 'number' ? s.version : 1,
    folders: Array.isArray(s.folders) ? s.folders : [],
    files: Array.isArray(s.files) ? s.files : [],
  };
}

/**
 * 路径等价比较 — 与 Rust 端 `services/favorites.rs::path_eq` 严格对齐.
 *
 * 为什么用 ascii 而不是 Unicode-aware toLowerCase:
 *   - ID / canonical path 不是用户展示文本;
 *   - 复杂 Unicode 大小写 (Turkish dotless i 等) 在路径中实际场景罕见;
 *   - 与后端保持完全一致, 避免后端去重后前端又生成重复项.
 */
export function pathEq(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a === b || a.toLowerCase() === b.toLowerCase();
}

/** @deprecated 改用 `pathEq` — 与 Rust 端命名一致, 语义不变. */
export const matchPath = pathEq;

/** 查某路径的收藏条目 (全局唯一, Rust 端保证). */
export function favoriteForPath(
  snapshot: FavoritesSnapshot,
  path: string | null,
): FavoriteFile | undefined {
  if (!path) return undefined;
  return snapshot.files.find((f) => pathEq(f.path, path));
}

/** 某父级 (null=根) 下的目录列表. */
export function childrenFolders(
  snapshot: FavoritesSnapshot,
  parentId: string | null,
): FavoriteFolder[] {
  return snapshot.folders.filter((f) => f.parentId === parentId);
}

/** 某父级 (null=根) 下的收藏文件列表. */
export function childrenFiles(
  snapshot: FavoritesSnapshot,
  parentId: string | null,
): FavoriteFile[] {
  return snapshot.files.filter((f) => f.parentId === parentId);
}

/** 某目录子树的规模统计 (用于删除确认文案). */
export function countDescendants(
  snapshot: FavoritesSnapshot,
  folderId: string,
): { folders: number; files: number } {
  const children = new Map<string, FavoriteFolder[]>();
  for (const f of snapshot.folders) {
    const key = f.parentId ?? '__root__';
    const arr = children.get(key) ?? [];
    arr.push(f);
    children.set(key, arr);
  }
  let folders = 0;
  let files = 0;
  const stack: string[] = [folderId];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    for (const kid of children.get(id) ?? []) {
      folders += 1;
      stack.push(kid.id);
    }
    files += snapshot.files.filter((f) => f.parentId === id).length;
  }
  return { folders, files };
}

/** 平铺所有目录 (深度优先序), 用于"移动到…"菜单. excludeId=自身(及其后代)时调用方自行过滤. */
export function allFoldersFlat(snapshot: FavoritesSnapshot): FavoriteFolder[] {
  const out: FavoriteFolder[] = [];
  const walk = (parentId: string | null): void => {
    for (const f of childrenFolders(snapshot, parentId)) {
      out.push(f);
      walk(f.id);
    }
  };
  walk(null);
  return out;
}

/** 某目录的全部后代 ID (移动校验: 禁止移入自身后代). */
export function descendantIds(
  snapshot: FavoritesSnapshot,
  folderId: string,
): Set<string> {
  const children = new Map<string, FavoriteFolder[]>();
  for (const f of snapshot.folders) {
    if (!f.parentId) continue;
    const arr = children.get(f.parentId) ?? [];
    arr.push(f);
    children.set(f.parentId, arr);
  }
  const out = new Set<string>();
  const stack: string[] = [folderId];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    for (const kid of children.get(id) ?? []) {
      if (!out.has(kid.id)) {
        out.add(kid.id);
        stack.push(kid.id);
      }
    }
  }
  return out;
}

/**
 * recentDirsStore — 最近目录列表 (F-27 / T25).
 *
 * 设计依据: docs/design/compiled.md §3.2.1 / §3.3.1 / FR-02 + docs/plan/compiled.md Step 2.
 *
 *   - 状态: items (按 lastOpenedAt 倒序) + loaded (hydrate 完成标记) + maxItems.
 *   - load(): 启动时由 App.tsx mount 调用一次, 从 Rust 拉取 → items;
 *     失败 items=[] 且 loaded=true (NFR-S-01 不白屏, AC-02-6 兼容损坏 JSON).
 *   - push(path): 同步本地乐观更新 (去重 + 置顶 + 截断到 MAX_RECENT_DIRS=8);
 *     异步 fire-and-forget 通知 Rust, 失败仅 console.warn + toast (NFR-S-01).
 *   - remove(path): 快照 prev → 更新 → IPC 失败回滚到 prev + toast (NFR-M-01).
 *   - clear(): 快照 prev → items=[] → IPC 失败回滚 + toast.
 *
 * 纪律:
 *   - IPC 出口统一走 src/lib/tauri.ts (R-04 单一来源).
 *   - MAX_RECENT_DIRS 与 Rust 端 MAX_RECENT_DIRS 严格相等
 *     (CI check-contract.mjs 同步校验).
 *   - 与 F-03 的 useRecentStore 完全独立, 不互相 import.
 */

import { create } from 'zustand';

import type { RecentDir } from '../lib/tauri';
import { tauri } from '../lib/tauri';
import { pushToast } from '../lib/toast';
import i18n from '../i18n';

/** 最近目录最大条目数; 必须 == Rust 端 MAX_RECENT_DIRS=8. */
export const MAX_RECENT_DIRS = 8;

export interface RecentDirsState {
  /** 按 lastOpenedAt 倒序, 头部最新. */
  items: RecentDir[];
  /** hydrate 是否完成 (供 UI 区分「加载中」与「空」). */
  loaded: boolean;
  /** = MAX_RECENT_DIRS, 暴露给 UI 读取. */
  maxItems: number;
}

export interface RecentDirsStore extends RecentDirsState {
  /** 启动时由 App.tsx mount 调用一次; 成功 → items + loaded=true; 失败 → items=[] + loaded=true + console.warn. */
  load(): Promise<void>;
  /**
   * 推入新条目. 重复 path 提到首位, 之后截断到 MAX_RECENT_DIRS.
   * 先更新本地 state (乐观), 再 fire-and-forget invoke, 失败仅 console.warn + toast.
   * 来自 RecentDirList 点击的 path **不** 应调用本方法 (避免重复写入).
   */
  push(path: string): void;
  /**
   * 删除单条. 快照 prev → 更新本地 → IPC 失败回滚到 prev + toast.
   */
  remove(path: string): Promise<void>;
  /**
   * 清空. 快照 prev → items=[] → IPC 失败回滚 + toast.
   */
  clear(): Promise<void>;
}

export const useRecentDirsStore = create<RecentDirsStore>((set, get) => ({
  items: [],
  loaded: false,
  maxItems: MAX_RECENT_DIRS,

  async load() {
    try {
      const remote = await tauri.getRecentDirs();
      // 长度截断 (NFR-04 双重防御).
      const items = Array.isArray(remote) ? remote.slice(0, MAX_RECENT_DIRS) : [];
      set({ items, loaded: true });
    } catch (err) {
      // NFR-S-01 / AC-02-6: hydrate 失败不阻塞首屏; UI 仍渲染 + 显示空状态.
      console.warn('[recentDirsStore] hydrate failed:', err);
      set({ items: [], loaded: true });
    }
  },

  push(path) {
    if (!path || typeof path !== 'string') return;
    // 重复 path (大小写不敏感) 提到首位.
    const lower = path.toLowerCase();
    const filtered = get().items.filter((it) => it.path.toLowerCase() !== lower);
    const next: RecentDir[] = [
      { path, lastOpenedAt: new Date().toISOString(), displayName: deriveDisplayName(path) },
      ...filtered,
    ].slice(0, MAX_RECENT_DIRS);
    set({ items: next });

    // 后台通知 Rust; 失败仅 console.warn + toast, 不阻塞 UI (NFR-S-01).
    // 测试或非 Tauri 环境 (如 SSR / jsdom) 中 tauri 可能为 undefined; 保护性检查.
    try {
      const maybeAdd = (tauri as { addRecentDir?: unknown })?.addRecentDir;
      if (typeof maybeAdd === 'function') {
        void (maybeAdd as (p: string) => Promise<void>)(path).catch((err: unknown) => {
          console.warn('[recentDirsStore] addRecentDir failed:', err);
          pushToast({ kind: 'error', message: i18n.t('recentDir.recordFailedToast') });
        });
      }
    } catch {
      // 忽略 (mock 环境或 Tauri 未注入).
    }
  },

  async remove(path) {
    if (!path || typeof path !== 'string') return;
    const lower = path.toLowerCase();
    const prev = get().items;
    const next = prev.filter((it) => it.path.toLowerCase() !== lower);
    // 已经在本地 items 中找不到, 仍然尝试调 IPC (Rust 端幂等), 不报错.
    set({ items: next });
    try {
      await tauri.removeRecentDir(path);
    } catch (err) {
      console.warn('[recentDirsStore] removeRecentDir failed:', err);
      // NFR-M-01: 回滚到 prev.
      set({ items: prev });
      pushToast({ kind: 'error', message: i18n.t('recentDir.deleteFailedToast') });
    }
  },

  async clear() {
    const prev = get().items;
    set({ items: [] }); // 立即清空 UI (乐观).
    try {
      await tauri.clearRecentDirs();
      pushToast({ kind: 'success', message: i18n.t('recentDir.clearedToast') });
    } catch (err) {
      console.warn('[recentDirsStore] clearRecentDirs failed:', err);
      set({ items: prev }); // NFR-M-01: 回滚.
      pushToast({ kind: 'error', message: i18n.t('recentDir.clearFailedToast') });
    }
  },
}));

/** 兜底 display_name: 取 basename (同时支持 POSIX '/' 与 Windows '\'). */
function deriveDisplayName(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return i >= 0 ? path.slice(i + 1) : path;
}

export default useRecentDirsStore;

/**
 * recentStore — 最近文件列表 (F-03 / T06 + T18 FR-02).
 *
 * 设计依据: docs/design/compiled.md §3.5 + docs/plan/compiled.md Step 4.
 *
 *   - 状态: items (按 lastOpenedAt 倒序) + loaded (hydrate 完成标记).
 *   - load(): 启动时 main.tsx 调用一次, 从 Rust 拉取 → items; 失败 items=[]
 *     且 loaded=true (AC-08 不白屏).
 *   - pushRecent(path, title): 同步本地乐观更新 (去重 + 置顶 + 截断到 MAX_RECENT);
 *     异步 fire-and-forget 通知 Rust, 失败仅 console.warn + toast (AC-05 不阻塞).
 *   - clearRecent(): 先 items=[] 立即清空 UI → await invoke; 失败回滚 prev + toast.
 *
 * T18 (FR-02):
 *   - 3 处 toast 字符串替换为 i18n.t('recent.*'). store 直接调用 i18n.t
 *     (非 React 上下文, 走 i18next 单例). 该调用发生在用户操作后,
 *     UI 已渲染, 不需要 react-i18next 订阅.
 *
 * 纪律:
 *   - IPC 出口统一走 src/lib/tauri.ts (R-04 单一来源).
 *   - MAX_RECENT 与 Rust 端 MAX_RECENT_ITEMS 严格相等 (CI check-contract 校验).
 */

import { create } from 'zustand';

import type { RecentItem } from '../lib/tauri';
import { tauri } from '../lib/tauri';
import { pushToast } from '../lib/toast';
import i18n from '../i18n';

/** 最近列表最大条目数; 必须 == Rust 端 MAX_RECENT_ITEMS. */
export const MAX_RECENT = 10;

export interface RecentStoreState {
  items: RecentItem[];
  loaded: boolean;
}

export interface RecentStore extends RecentStoreState {
  /** 启动时由 main.tsx 调用一次; 成功 → items + loaded=true; 失败 → items=[] + loaded=true + console.warn (AC-08). */
  load(): Promise<void>;
  /**
   * 推入新条目. 重复 path 提到首位, 之后截断到 MAX_RECENT.
   * 先更新本地 state (乐观), 再 fire-and-forget invoke, 失败仅 console.warn + toast (AC-05).
   */
  pushRecent(path: string, title: string): void;
  /**
   * 清空本地 + 通知 Rust. 先 items=[] 立即清空 UI → await invoke;
   * 成功 toast; 失败回滚到 prev + toast (NFR-05).
   */
  clearRecent(): Promise<void>;
}

/** 兜底 title: 取 basename (同时支持 POSIX '/' 与 Windows '\'). */
function deriveTitle(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const stem = i >= 0 ? path.slice(i + 1) : path;
  const dot = stem.lastIndexOf('.');
  return dot > 0 ? stem.slice(0, dot) : stem;
}

export const useRecentStore = create<RecentStore>((set, get) => ({
  items: [],
  loaded: false,

  async load() {
    try {
      const remote = await tauri.getRecentFiles();
      // 长度截断 (NFR-04 双重防御).
      const items = Array.isArray(remote) ? remote.slice(0, MAX_RECENT) : [];
      set({ items, loaded: true });
    } catch (err) {
      // AC-08: hydrate 失败不阻塞首屏; UI 仍渲染 + 显示空状态.
      console.warn('[recentStore] hydrate failed:', err);
      set({ items: [], loaded: true });
    }
  },

  pushRecent(path, title) {
    if (!path || typeof path !== 'string') return;
    const safeTitle = title && title.trim().length > 0 ? title : deriveTitle(path);
    const next: RecentItem[] = [
      { path, title: safeTitle, lastOpenedAt: new Date().toISOString() },
      ...get().items.filter((it) => it.path !== path),
    ].slice(0, MAX_RECENT);
    set({ items: next });

    // 后台通知 Rust; 失败仅 console.warn + toast, 不阻塞 UI (AC-05).
    // 测试或非 Tauri 环境 (如 SSR / jsdom) 中 tauri 可能为 undefined; 保护性检查.
    try {
      const maybeAdd = (tauri as { addRecentFile?: unknown })?.addRecentFile;
      if (typeof maybeAdd === 'function') {
        void (maybeAdd as (p: string, t: string) => Promise<void>)(path, safeTitle).catch(
          (err: unknown) => {
            console.warn('[recentStore] addRecentFile failed:', err);
            pushToast({ kind: 'error', message: i18n.t('recent.recordFailed') });
          },
        );
      }
    } catch {
      // 忽略 (mock 环境或 Tauri 未注入).
    }
  },

  async clearRecent() {
    const prev = get().items;
    set({ items: [] }); // 立即清空 UI (乐观).
    try {
      await tauri.clearRecentFiles();
      pushToast({ kind: 'success', message: i18n.t('recent.clearedToast') });
    } catch (err) {
      console.warn('[recentStore] clear failed:', err);
      set({ items: prev }); // NFR-05: 回滚.
      pushToast({ kind: 'error', message: i18n.t('recent.clearFailed') });
    }
  },
}));

export default useRecentStore;
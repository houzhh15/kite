/**
 * progressStore — 阅读进度持久化 (T11, FR-09 / FR-10 / FR-11 / FR-12).
 *
 * 设计依据: docs/design/compiled.md §3.4 + §3.6.2..3.6.4 + 需求 FR-09..FR-12.
 *
 * 责任:
 *   - 内存态: { lastPath, perFile, seenShortcutsHint, hydrated }
 *   - sanitize: pct / scrollTop / updatedAt 范围校验
 *   - flush: 300ms debounce → tauri.saveProgress; 失败保留 dirty=true
 *   - 损坏数据恢复: resetCorrupted → 清空 + toast「进度数据已重置」
 *   - pagehide / visibilitychange→hidden 同步 flush
 *
 * 纪律:
 *   - IPC 出口走 src/lib/tauri.ts (R-04 单一来源).
 *   - 模块级 _dirty / _flushTimer 在 store 外部维护, action 触发它们.
 *   - hydrate 失败 → resetCorrupted(reason), 不抛错 (AC-09-2).
 */
import { create } from 'zustand';

import type { ProgressEntry, ProgressState } from '../lib/tauri';
import { tauri } from '../lib/tauri';
import { pushToast } from '../lib/toast';
import i18n from '../i18n';

const DEBOUNCE_MS = 300;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function sanitizePct(n: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    console.warn('[progressStore] sanitizePct: non-finite input, fallback to 0');
    return 0;
  }
  if (n < 0) {
    console.warn(`[progressStore] sanitizePct: out-of-range ${n}, clamp to 0`);
    return 0;
  }
  if (n > 100) {
    console.warn(`[progressStore] sanitizePct: out-of-range ${n}, clamp to 100`);
    return 100;
  }
  return Math.round(n);
}

function sanitizeScrollTop(n: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    console.warn('[progressStore] sanitizeScrollTop: non-finite input, fallback to 0');
    return 0;
  }
  if (n < 0) {
    console.warn(`[progressStore] sanitizeScrollTop: negative ${n}, clamp to 0`);
    return 0;
  }
  return Math.floor(n);
}

function sanitizeUpdatedAt(n: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return nowSeconds();
  if (n < 0) return 0;
  return Math.floor(n);
}

function sanitizePath(p: string | null | undefined): string | null {
  if (typeof p !== 'string') return null;
  const t = p.trim();
  return t.length > 0 ? t : null;
}

export interface ProgressStoreState {
  /** 当前打开文档的绝对路径, 或 null. */
  lastPath: string | null;
  /** 路径 → 进度. */
  perFile: Record<string, ProgressEntry>;
  /** 是否已看过快捷键速查 (FR-12). */
  seenShortcutsHint: boolean;
  /** 是否 hydrate 完毕. 未 hydrate 时 App 不调 tryRestoreLastPath. */
  hydrated: boolean;
}

export interface ProgressStore extends ProgressStoreState {
  /**
   * 一次性合并 partial + 设 hydrated=true.
   * 字段缺失 → 保持当前值; perFile 字段级 sanitize.
   * 损坏 (perFile 非对象 / 缺关键字段) → resetCorrupted, 设 hydrated=true.
   */
  hydrate(raw: Partial<ProgressState> | null | undefined): void;
  /** 设置 lastPath; 立即触发 dirty + flush. */
  setLastPath(path: string | null): void;
  /**
   * 写入单文档进度.
   * - pct ∉ [0,100] → clamp; 非数字 → 0; console.warn.
   * - scrollTop < 0 / NaN → 0; console.warn.
   */
  setProgress(path: string, pct: number, scrollTop: number): void;
  /** 取单文档进度. */
  getProgress(path: string): ProgressEntry | null;
  /** 删除单文档进度 (启动恢复失败时调用). */
  removeProgress(path: string): void;
  /** 设置 seenShortcutsHint, 触发 flush. */
  setSeenShortcutsHint(v: boolean): void;
  /**
   * 启动恢复: 读 lastPath; 调用方读取后自行决定是否消费.
   * 这里只读不消费; 若需要"消费一次后清空"语义由调用方调用 setLastPath(null).
   */
  consumeLastPath(): string | null;
  /** 清空损坏数据, 触发 toast; 设 hydrated=true. */
  resetCorrupted(reason: string): void;
  /**
   * 同步 flush.
   * - force=true: 取消 pending debounce, 立即调 IPC.
   * - dirty=false + force=false: 立即 resolve, 不发 IPC (NFR-1 优化).
   */
  flush(force?: boolean): Promise<void>;
}

/* -------------------------------------------------------------------------- */
/* 模块级 flush 状态                                                          */
/* -------------------------------------------------------------------------- */

let _dirty = false;
let _flushTimer: ReturnType<typeof setTimeout> | null = null;
let _lastSnapshot: { lastPath: string | null; perFile: Record<string, ProgressEntry>; seenShortcutsHint: boolean } | null =
  null;

function cancelTimer(): void {
  if (_flushTimer !== null) {
    clearTimeout(_flushTimer);
    _flushTimer = null;
  }
}

function scheduleFlush(): void {
  if (_flushTimer !== null) clearTimeout(_flushTimer);
  _flushTimer = setTimeout(() => {
    _flushTimer = null;
    void useProgressStore.getState().flush(false);
  }, DEBOUNCE_MS);
}

async function performSave(state: ProgressStoreState): Promise<void> {
  const payload = {
    lastPath: state.lastPath,
    perFile: state.perFile,
    seenShortcutsHint: state.seenShortcutsHint,
  };
  // 与上次快照一致 → 跳过 IO (幂等保护).
  if (
    _lastSnapshot &&
    _lastSnapshot.lastPath === payload.lastPath &&
    _lastSnapshot.seenShortcutsHint === payload.seenShortcutsHint &&
    shallowEqualPerFile(_lastSnapshot.perFile, payload.perFile)
  ) {
    _dirty = false;
    return;
  }
  try {
    await tauri.saveProgress(payload);
    _lastSnapshot = payload;
    _dirty = false;
  } catch (err) {
    console.warn('[progressStore] saveProgress failed:', err);
    // 保留 _dirty=true → 下次静置 300ms 自动重试 (NFR-Robust-1).
  }
}

function shallowEqualPerFile(
  a: Record<string, ProgressEntry>,
  b: Record<string, ProgressEntry>,
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    const ea = a[k];
    const eb = b[k];
    if (!eb) return false;
    if (ea.pct !== eb.pct || ea.scrollTop !== eb.scrollTop || ea.updatedAt !== eb.updatedAt) {
      return false;
    }
  }
  return true;
}

/* -------------------------------------------------------------------------- */
/* Store                                                                      */
/* -------------------------------------------------------------------------- */

export const useProgressStore = create<ProgressStore>((set, get) => ({
  lastPath: null,
  perFile: {},
  seenShortcutsHint: false,
  hydrated: false,

  hydrate(raw) {
    if (!raw || typeof raw !== 'object') {
      // null / 非对象 → 视为损坏.
      get().resetCorrupted('hydrate received non-object');
      return;
    }
    let perFile: Record<string, ProgressEntry> = {};
    if (raw.perFile && typeof raw.perFile === 'object' && !Array.isArray(raw.perFile)) {
      for (const [path, entry] of Object.entries(raw.perFile)) {
        if (!entry || typeof entry !== 'object') continue;
        const e = entry as Partial<ProgressEntry>;
        if (typeof e.pct !== 'number' || typeof e.scrollTop !== 'number' || typeof e.updatedAt !== 'number') {
          console.warn(`[progressStore] perFile["${path}"] invalid, skip`);
          continue;
        }
        perFile[path] = {
          pct: sanitizePct(e.pct),
          scrollTop: sanitizeScrollTop(e.scrollTop),
          updatedAt: sanitizeUpdatedAt(e.updatedAt),
        };
      }
    } else if (raw.perFile !== undefined && raw.perFile !== null) {
      // perFile 存在但不是对象 → 字段级 fallback.
      console.warn('[progressStore] perFile is not an object, resetting');
      perFile = {};
    }
    const lastPath = sanitizePath(raw.lastPath);
    const seenShortcutsHint = raw.seenShortcutsHint === true;
    set({ lastPath, perFile, seenShortcutsHint, hydrated: true });
    // hydrate 不触发 dirty (内存态从磁盘同步).
    _lastSnapshot = { lastPath, perFile, seenShortcutsHint };
  },

  setLastPath(path) {
    const next = sanitizePath(path);
    const prev = get().lastPath;
    if (prev === next) return;
    set({ lastPath: next });
    _dirty = true;
    scheduleFlush();
  },

  setProgress(path, pct, scrollTop) {
    const trimmed = typeof path === 'string' ? path.trim() : '';
    if (trimmed.length === 0) return;
    const p = sanitizePct(pct);
    const s = sanitizeScrollTop(scrollTop);
    const entry: ProgressEntry = { pct: p, scrollTop: s, updatedAt: nowSeconds() };
    const prev = get().perFile[trimmed];
    if (
      prev &&
      prev.pct === entry.pct &&
      prev.scrollTop === entry.scrollTop
      // updatedAt 强制刷新, 不去重
    ) {
      // 完全相同 → 不写盘, 避免无意义 IO.
      return;
    }
    set((s) => ({
      perFile: { ...s.perFile, [trimmed]: entry },
    }));
    _dirty = true;
    scheduleFlush();
  },

  getProgress(path) {
    if (typeof path !== 'string') return null;
    return get().perFile[path] ?? null;
  },

  removeProgress(path) {
    if (typeof path !== 'string') return;
    const trimmed = path.trim();
    if (trimmed.length === 0) return;
    if (!(trimmed in get().perFile)) return;
    set((s) => {
      const next = { ...s.perFile };
      delete next[trimmed];
      return { perFile: next };
    });
    _dirty = true;
    scheduleFlush();
  },

  setSeenShortcutsHint(v) {
    if (get().seenShortcutsHint === !!v) return;
    set({ seenShortcutsHint: !!v });
    _dirty = true;
    scheduleFlush();
  },

  consumeLastPath() {
    return get().lastPath;
  },

  resetCorrupted(reason) {
    console.warn(`[progressStore] reset corrupted: ${reason}`);
    set({ lastPath: null, perFile: {}, seenShortcutsHint: false, hydrated: true });
    // 不主动 flush (保留损坏数据在磁盘, 便于排错). 下次任意 progress 变更整体覆盖.
    // T18 (FR-02): 进度数据已重置 → i18n.t('app.progressReset').
    pushToast({ kind: 'info', message: i18n.t('app.progressReset') });
  },

  async flush(force = false) {
    if (!force && !_dirty) {
      return;
    }
    cancelTimer();
    const state = get();
    if (!state.hydrated) {
      // 未 hydrate → 不写盘 (避免空数据覆盖磁盘).
      return;
    }
    _dirty = false;
    await performSave(state);
    // 若 performSave 失败 → _dirty 已保持为 true; 下次 scheduleFlush 触发重试.
  },
}));

/* -------------------------------------------------------------------------- */
/* 启动绑定: pagehide / visibilitychange 同步 flush                            */
/* -------------------------------------------------------------------------- */

let _lifecycleBound = false;

function bindLifecycle(): void {
  if (_lifecycleBound) return;
  if (typeof window === 'undefined') return;
  const onHide = (): void => {
    void useProgressStore.getState().flush(true);
  };
  const onVisibility = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') onHide();
  };
  window.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onHide);
  _lifecycleBound = true;
}

// 立即绑定 (模块加载即生效, 与 usePreferences 同模式).
bindLifecycle();

/** 测试用: 重置模块级状态. */
export function __resetProgressStoreForTest(): void {
  cancelTimer();
  _dirty = false;
  _lastSnapshot = null;
  useProgressStore.setState({
    lastPath: null,
    perFile: {},
    seenShortcutsHint: false,
    hydrated: false,
  });
}

export default useProgressStore;
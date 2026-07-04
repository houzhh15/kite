/**
 * persist.ts — T12 偏好持久化工具 (设计 §3.4 / FR-04 / AC-FR04-1..3).
 *
 * 责任:
 *   - 提供 debouncedPersist(fn, ms): 返回 debounced 函数; 300ms 内的连续调用合并为单次.
 *   - 提供 loadAndHydrate(): 启动时调 loadPreferences() → prefStore.hydrate().
 *   - 损坏路径: loadPreferences reject → console.warn + hydrate 默认 + toast '偏好已重置'.
 *
 * 纪律:
 *   - 不依赖 React; 不依赖 store 类型 (避免循环); 接受回调注入.
 *   - flush() 提供给 usePreferences 的 pagehide 钩子 (强制同步).
 *   - 测试场景用 fake timers + ms=300 验证合流.
 */

import type { Preferences as RustPreferences } from './tauri';
import { usePrefStore } from '../stores/prefStore';
import { loadPreferences, savePreferences } from './tauri';
import { pushToast } from './toast';
import i18n from '../i18n';

const DEFAULT_DEBOUNCE_MS = 300;

/**
 * 防抖持久化: 连续调用在 ms 毫秒内合并, 仅最后一次生效.
 * 返回 { flush, cancel } 句柄: flush 立即同步触发未执行的保存; cancel 取消待执行的保存.
 */
export interface DebouncedPersistHandle {
  (): void;
  flush(): void;
  cancel(): void;
}

export function debouncedPersist(
  fn: () => void,
  ms: number = DEFAULT_DEBOUNCE_MS,
): DebouncedPersistHandle {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending = false;

  const wrapped = (): void => {
    pending = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      pending = false;
      try {
        fn();
      } catch (err) {
        console.warn('[debouncedPersist] fn threw:', err);
      }
    }, ms);
  };

  wrapped.flush = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending) {
      pending = false;
      try {
        fn();
      } catch (err) {
        console.warn('[debouncedPersist] flush threw:', err);
      }
    }
  };

  wrapped.cancel = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    pending = false;
  };

  return wrapped;
}

/**
 * loadAndHydrate — 启动加载 + 容错 + toast 提示 (设计 §3.4.2 / FR-01).
 *
 * 成功 → prefStore.hydrate(p).
 * 失败 → console.warn + prefStore.hydrate() 默认 + toast「偏好已重置」.
 */
export async function loadAndHydrate(): Promise<void> {
  try {
    const p = await loadPreferences();
    usePrefStore.getState().hydrate(p);
  } catch (err) {
    console.warn('[loadAndHydrate] loadPreferences failed:', err);
    usePrefStore.getState().hydrate();
    if (typeof window !== 'undefined') {
      pushToast({ kind: 'info', message: i18n.t('message.prefsReset') });
    }
  }
}

/**
 * saveNow — fire-and-forget 同步保存.
 * 错误仅 console.warn, 不阻塞 UI (NFR-03).
 */
export function saveNow(prefs: RustPreferences): void {
  void savePreferences(prefs).then(
    () => {
      // 成功 — 由 usePreferences 维护 lastSavedRef
    },
    (err) => {
      console.warn('[saveNow] savePreferences failed:', err);
    },
  );
}
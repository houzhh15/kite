/**
 * usePreferences — 启动 hydrate + 变更 debounced save + flush on hide.
 *
 * 设计依据: docs/design/compiled.md §3.4 / FR-01 / FR-04 / FR-08 / NFR-01.
 *
 * 调用方: <App /> 顶层挂载一次, 单例.
 *
 * 行为:
 *   1. 挂载 → loadPreferences() → prefStore.hydrate() (FR-01)
 *   2. 订阅 prefs 变化 → setProperty('--kite-font-size/line-height') (FR-08)
 *   3. 订阅 prefs 变化 → 300ms debounce → savePreferences() (FR-04, NFR-01)
 *   4. visibilitychange→hidden / pagehide → 取消 debounce + 同步 save (AC-FR04-3)
 *   5. T17-P2 (F-21/F-22): hydrate 完成后调用 featureFlags.hydrateFlags
 *      把 mermaidEnabled / katexEnabled 同步到内存 flag (设计 §3.2.2).
 *
 * 纪律:
 *   - 不在 React 渲染期间调 IPC; 全部放进 useEffect.
 *   - lastSavedRef + shallowEqual 短路: hydrate 后无变更不调 save.
 *   - 错误全部 console.warn, 不抛到 UI 树 (NFR-03).
 *   - 调用 savePreferences 时显式覆盖 T01 placeholder (setWindowTitle 不依赖此 hook).
 */
import { useEffect, useRef } from 'react';

import { usePrefStore, type Prefs } from '../stores/prefStore';
import { loadPreferences, savePreferences } from '../lib/tauri';
import { hydrateFlags as hydrateFeatureFlags } from '../lib/featureFlags';

const DEBOUNCE_MS = 300;

export interface UsePreferencesReturn {
  hydrated: boolean;
  preferences: Prefs;
}

function shallowEqual(a: Prefs, b: Prefs): boolean {
  return (
    a.theme === b.theme &&
    a.fontSize === b.fontSize &&
    a.lineHeight === b.lineHeight &&
    a.codeBlockTheme === b.codeBlockTheme &&
    a.mermaidEnabled === b.mermaidEnabled &&
    a.katexEnabled === b.katexEnabled
  );
}

export function usePreferences(): UsePreferencesReturn {
  const hydrated = usePrefStore((s) => s.hydrated);
  const prefs = usePrefStore((s) => s.prefs);
  const lastSavedRef = useRef<Prefs | null>(null);

  // 1) 启动 hydrate (一次)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await loadPreferences();
        if (cancelled) return;
        usePrefStore.getState().hydrate(p);
        // T17-P2 (F-21/F-22): hydrate 完成后把 mermaid/katex 持久化值同步到内存 flag.
        const cur = usePrefStore.getState().prefs;
        hydrateFeatureFlags({ mermaid: cur.mermaidEnabled, katex: cur.katexEnabled });
        lastSavedRef.current = cur;
      } catch (err) {
        if (cancelled) return;
        console.warn('[usePreferences] loadPreferences failed:', err);
        // FR-01 / AC-FR01-3: fallback 默认
        usePrefStore.getState().hydrate();
        const cur = usePrefStore.getState().prefs;
        hydrateFeatureFlags({ mermaid: cur.mermaidEnabled, katex: cur.katexEnabled });
        lastSavedRef.current = cur;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 2) CSS 变量同步 (订阅 prefs 变化 → 同帧反映).
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.style.setProperty('--kite-font-size', `${prefs.fontSize}px`);
    root.style.setProperty('--kite-line-height', String(prefs.lineHeight));
  }, [prefs.fontSize, prefs.lineHeight]);

  // 3) 订阅 store → debounced save.
  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      const cur = usePrefStore.getState().prefs;
      if (lastSavedRef.current && shallowEqual(lastSavedRef.current, cur)) return;
      // fire-and-forget; 错误不抛到 UI 树 (NFR-03).
      savePreferences(cur as never).then(
        () => {
          lastSavedRef.current = cur;
        },
        (err) => {
          console.warn('[usePreferences] savePreferences failed:', err);
        },
      );
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [hydrated, prefs.theme, prefs.fontSize, prefs.lineHeight, prefs.codeBlockTheme, prefs.mermaidEnabled, prefs.katexEnabled]);

  // 4) pagehide / visibilitychange→hidden 同步 flush (AC-FR04-3).
  useEffect(() => {
    const onHide = (): void => {
      const cur = usePrefStore.getState().prefs;
      if (lastSavedRef.current && shallowEqual(lastSavedRef.current, cur)) return;
      // 不 await; fire-and-forget; 错误 console.warn 不阻塞关窗.
      savePreferences(cur as never).then(
        () => {
          lastSavedRef.current = cur;
        },
        (err) => {
          console.warn('[usePreferences] flush-on-hide failed:', err);
        },
      );
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') onHide();
    };
    window.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onHide);
    };
  }, []);

  return { hydrated, preferences: prefs };
}

export default usePreferences;
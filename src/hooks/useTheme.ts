/**
 * src/hooks/useTheme.ts — 主题订阅 hook (T03 step-07).
 *
 * 设计依据: docs/design/compiled.md §3.4 / FR-04 / NFR-02.
 *
 * 责任:
 *   - 返回 { theme, appliedTheme, setTheme }, 组件消费方受控订阅.
 *   - theme === 'system' 时挂 matchMedia('(prefers-color-scheme: dark)') 'change' 监听器.
 *   - 切档 (theme !== 'system') 时**先 removeEventListener 再不挂新监听器**.
 *   - 严配对: cleanup 函数引用与 addEventListener 完全一致 (避免泄漏).
 *   - matchMedia 不可用 → console.warn + 降级 'light', 不抛 (AC-04-3).
 *
 * T04 增量: hydrate 后主题通过 prefStore 自动反映; API 不变.
 *   - 数据源 = prefStore (T03 已落地), 不持有自有持久 state.
 *   - usePreferences 在 App 顶层挂载 → prefStore.hydrate() → prefStore.theme 更新
 *     → useTheme 订阅触发 appliedTheme 重算.
 *
 * 纪律:
 *   - 不调 IPC.
 *   - 不修改 prefStore 默认值之外的其它字段.
 *   - 不引入 React Context; 全部走 Zustand 订阅.
 */

import { useEffect, useState } from 'react';

import { computeAppliedTheme } from '../lib/applyInitialTheme';
import { cycleTheme as cycleThemeAction, usePrefStore } from '../stores/prefStore';
import type { AppliedTheme, Theme } from '../lib/theme-types';

export interface UseThemeReturn {
  /** 用户当前选择的三档之一 (Theme). */
  theme: Theme;
  /** 解析后的实际档 (排除 'system'). */
  appliedTheme: AppliedTheme;
  /** 与 prefStore.setTheme 等价的便捷 setter, 受控源仍是 store. */
  setTheme: (theme: Theme) => void;
  /** T11: 三档循环 light → dark → system → light (设计 §3.6.6). */
  cycleTheme: () => void;
}

function getInitialAppliedTheme(theme: Theme, matchMediaFn: typeof window.matchMedia | null): AppliedTheme {
  if (theme !== 'system') return theme;
  if (!matchMediaFn) return 'light';
  try {
    return computeAppliedTheme(theme, matchMediaFn);
  } catch {
    return 'light';
  }
}

/**
 * useTheme — 消费方组件订阅主题状态.
 *
 *   - 挂载时: 读 prefStore.theme 与 OS prefers-color-scheme, 计算 appliedTheme.
 *   - theme === 'system' 时注册 matchMedia 'change' 监听器; unmount 时 cleanup 严格配对.
 *   - theme 变化时: 先 removeEventListener (若已挂) 再决定是否 add.
 *   - 任何时刻 setTheme 都触发重新订阅 (state.doc + DOM class 更新).
 */
export function useTheme(): UseThemeReturn {
  const theme = usePrefStore((s) => s.prefs.theme);
  const setTheme = usePrefStore((s) => s.setTheme);

  const matchMediaFn: typeof window.matchMedia | null =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia.bind(window)
      : null;

  // 计算 appliedTheme 作为组件内部 state, 跟随 theme 与 matchMedia 事件更新.
  const [appliedTheme, setAppliedTheme] = useState<AppliedTheme>(() =>
    getInitialAppliedTheme(theme, matchMediaFn),
  );

  // 同步: theme 变化时立即重算 (供 setTheme 调用同步刷新).
  useEffect(() => {
    const next = getInitialAppliedTheme(theme, matchMediaFn);
    setAppliedTheme(next);
    if (!matchMediaFn && theme === 'system') {
      console.warn('[useTheme] matchMedia unavailable, fallback to light');
    }
  }, [theme, matchMediaFn]);

  // 监听: theme === 'system' 时挂 matchMedia 'change' 监听器, 严配对 cleanup.
  useEffect(() => {
    if (theme !== 'system' || !matchMediaFn) {
      return undefined;
    }
    let mql: MediaQueryList | null = null;
    try {
      mql = matchMediaFn('(prefers-color-scheme: dark)');
    } catch {
      console.warn('[useTheme] matchMedia unavailable, fallback to light');
      return undefined;
    }

    // 监听器引用保存, 让 cleanup 能用同一引用 removeEventListener (NFR-02).
    const onChange = (e: MediaQueryListEvent): void => {
      setAppliedTheme(e.matches ? 'dark' : 'light');
    };

    mql.addEventListener('change', onChange);
    return () => {
      if (mql) {
        mql.removeEventListener('change', onChange);
      }
    };
  }, [theme, matchMediaFn]);

  // DOM 副作用: appliedTheme 变化时同步 toggle html.dark 类.
  // useEffect 在 commit 后跑, 不影响首帧 (由 applyInitialTheme 在 createRoot 前已设).
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.classList.toggle('dark', appliedTheme === 'dark');
  }, [appliedTheme]);

  return { theme, appliedTheme, setTheme, cycleTheme: cycleThemeAction };
}

export default useTheme;

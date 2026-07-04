/**
 * src/lib/applyInitialTheme.ts — 启动期同步应用主题 (T03 step-06).
 *
 * 设计依据: docs/design/compiled.md §3.3 / FR-08.
 *
 * 责任:
 *   - 在 main.tsx import 链 (createRoot 之前) 同步执行.
 *   - 读取 prefStore.prefs.theme, 计算 appliedTheme, 把 'dark' 类同步设到 <html>.
 *   - matchMedia 不可用 → 降级到 'light' 且 console.warn, 不抛.
 *
 * 纪律:
 *   - 不调 IPC (T03 不引入持久化, T04 接管).
 *   - 不挂任何 addEventListener (运行时监听由 useTheme 接管).
 *   - 不触发 React 渲染.
 *   - 幂等: 重复调用 classList.toggle 同一状态不会破坏.
 */

import { usePrefStore } from '../stores/prefStore';
import type { AppliedTheme } from './theme-types';

export interface ApplyInitialThemeOptions {
  /**
   * 可选注入: 测试用. 默认值 `typeof window.matchMedia`.
   * 传入 mock 时, 用于覆盖 'system' 档下的 prefers-color-scheme 解析.
   */
  matchMedia?: typeof window.matchMedia;
}

/**
 * 计算 appliedTheme (FR-01 / AC-01-2):
 *   'system' → 看 OS prefers-color-scheme (若 matchMedia 不可用则 'light');
 *   其它 → 直接取 theme 本身.
 */
export function computeAppliedTheme(
  theme: 'light' | 'dark' | 'system',
  matchMediaFn?: typeof window.matchMedia | null,
): AppliedTheme {
  if (theme !== 'system') {
    return theme;
  }
  if (typeof matchMediaFn !== 'function') {
    return 'light';
  }
  try {
    const mq = matchMediaFn('(prefers-color-scheme: dark)');
    return mq && mq.matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/**
 * 应用主题到 <html>: dark 类 toggle 同步生效.
 * 不抛, 不阻塞模块加载.
 */
export function applyInitialTheme(opts: ApplyInitialThemeOptions = {}): void {
  if (typeof document === 'undefined') {
    // 非浏览器环境 (SSR / 测试边界): 直接返回.
    return;
  }
  const theme = usePrefStore.getState().prefs.theme;
  const matchMediaFn =
    opts.matchMedia ??
    (typeof window !== 'undefined' ? window.matchMedia : null);
  let applied: AppliedTheme;
  try {
    applied = computeAppliedTheme(
      theme,
      matchMediaFn === null ? undefined : matchMediaFn,
    );
  } catch {
    console.warn('[applyInitialTheme] compute failure, fallback to light');
    applied = 'light';
  }
  if (!matchMediaFn && theme === 'system') {
    console.warn('[applyInitialTheme] matchMedia unavailable, fallback to light');
  }
  document.documentElement.classList.toggle('dark', applied === 'dark');
}

/**
 * 默认导出: 自执行版本. 允许调用方 `import './lib/applyInitialTheme';`
 * 触发副作用而无需显式调用; 也可显式 `applyInitialTheme()` 调用, 幂等.
 */
export default applyInitialTheme;

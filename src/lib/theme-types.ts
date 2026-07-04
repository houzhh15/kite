/**
 * src/lib/theme-types.ts — 主题相关共享类型 (T03 step-01).
 *
 * 设计依据: docs/design/compiled.md §3.1.
 *
 * 责任:
 *   - 单一来源导出 `Theme` 联合类型 (UI 表达档位).
 *   - 单一来源导出 `AppliedTheme` 联合类型 (运行时实际档位, 排除 'system').
 *   - 单一来源导出 `THEME_OPTIONS` 固定顺序常量, 用于 ThemeSwitcher 渲染.
 *
 * 纪律:
 *   - `'sepia'` 在类型层面有意不暴露 (AC-05-3 / 设计 §1.2:
 *     sepia 仅作接口预留, UI 不渲染). 注释里记录这一点.
 *   - 该文件无副作用; 仅类型与常量. 单测覆盖 import + 数组顺序.
 */

/** 用户可选择的主题档位 (UI 展示). 'sepia' 在本任务中**不在 UI 暴露** —— 仅保留为未来扩展类型占位. */
export type Theme = 'light' | 'dark' | 'system';

/** 已经解析出的运行时主题 (排除了 'system' 这个跟随档). */
export type AppliedTheme = 'light' | 'dark';

/**
 * ThemeSwitcher 渲染的固定选项顺序 (设计 §3.1).
 * labelKey 走 i18n 字典键, 与本任务解耦; 当前阶段 ThemeSwitcher 直接本地化显示.
 */
export interface ThemeOption {
  /** 档位值. */
  value: Theme;
  /** i18n 字典键 (本任务内本地映射, 与设计 §1.2 一致). */
  labelKey: string;
}

export const THEME_OPTIONS: ReadonlyArray<ThemeOption> = [
  { value: 'light', labelKey: 'theme.light' },
  { value: 'dark', labelKey: 'theme.dark' },
  { value: 'system', labelKey: 'theme.system' },
] as const;

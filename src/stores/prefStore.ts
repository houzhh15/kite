/**
 * prefStore — 用户偏好 (FR-07 / F-33 / F-09 / F-10).
 *
 * T04 增量 (设计 §3.3):
 *   - 新增 state.prefs.fontSize / lineHeight / state.hydrated.
 *   - 新增 action: setFontSize(n) (clamp 12..24) / setLineHeight(n) (三档离散)
 *     / hydrate(p) (一次性合并 partial, 设 hydrated=true).
 *   - 保留 T01 的 setTheme (含 isTheme 校验 + console.warn/TypeError 行为).
 *   - 保留 T01 的 load() / update() / codeBlockTheme 字段 (兼容 T05/T13 后续接入).
 *   - IPC 仍由 usePreferences hook 触发, 本 store 不主动调 IPC (NFR-MAINT-02).
 *
 * T12 增量 (设计 §3.6):
 *   - 新增 cycleFontSize / cycleLineHeight / resetReadingPrefs / setCodeFontSize
 *     离散档位 actions (与 reader-prefs.ts 协同).
 *   - 保留 T04 setFontSize(number) / setLineHeight(float) 兼容面; 新档位 actions
 *     内部走 reader-prefs 工具 + setFontSize(number) 写回.
 */
import { create } from 'zustand';

import i18n from '../i18n';
import type { Preferences as RustPreferences } from '../lib/tauri';
import type { Theme } from '../lib/theme-types';
import {
  FONT_SIZES,
  LINE_HEIGHTS,
  type CodeFontSize,
  type FontSize,
  type LineHeight as LineHeightId,
  cycleFontSize as cycleFontSizeFn,
  cycleLineHeight as cycleLineHeightFn,
  codeFontSizeFromPx,
  CODE_FONT_SIZE_PX,
  fontSizeFromPx,
  getFontSizePx,
  getLineHeightValue,
  isFontSize,
  isLineHeightId,
  lineHeightFromNumber,
} from '../lib/reader-prefs';

export type LineHeight = 1.4 | 1.6 | 1.8;

/** T15 (FR-05): 支持的语言. 与 src/i18n/index.ts 的 SupportedLng 同步. */
export type Language = 'zh-CN' | 'en-US';

/** Prefs — 内存态, 单一数据源. */
export interface Prefs {
  theme: Theme;
  fontSize: number; // 12..24, 默认 16
  lineHeight: LineHeight; // 默认 1.6
  codeBlockTheme: string;
  /** T12: 字号离散档位 (sm/md/lg/xl/2xl). 与 fontSize 冗余, 便于 UI radiogroup 直接消费. */
  fontSizeId: FontSize;
  /** T12: 行高离散档位 (compact/cozy/comfortable). 与 lineHeight 冗余. */
  lineHeightId: LineHeightId;
  /** T12: 代码块字号离散档位 (xs/sm/md/lg). */
  codeFontSizeId: CodeFontSize;
  /** T15 (FR-05): 用户界面语言. 默认 zh-CN. */
  language: Language;
  /** T17-P2 (F-21): mermaid 图表渲染开关. 默认 false. */
  mermaidEnabled: boolean;
  /** T17-P2 (F-22): KaTeX 公式渲染开关. 默认 false. */
  katexEnabled: boolean;
}

export interface PrefState {
  prefs: Prefs;
  /** T04: hydrate 是否完成. 未完成时 UI 显示默认 (防闪). */
  hydrated: boolean;
  /** T01 兼容字段: 是否走过 load() (legacy). */
  loaded: boolean;
}

export interface PrefStore extends PrefState {
  /** T03: 同步写 theme 到内存态. */
  setTheme(theme: Theme): void;
  /** T04: 夹紧 12..24 写入 prefs.fontSize. */
  setFontSize(n: number): void;
  /** T04: 三档离散校验 + 写入 prefs.lineHeight. */
  setLineHeight(n: LineHeight): void;
  /** T04: 一次性合并 partial prefs + 设 hydrated=true. */
  hydrate(p?: Partial<RustPreferences>): void;
  /** T01 placeholder — 由 usePreferences hook 接管 (T05 兼容). */
  load(): Promise<void>;
  /** T01 placeholder — 由 usePreferences hook 接管 (T05 兼容). */
  update(patch: Partial<RustPreferences>): Promise<void>;
  /** T12: 直接写入离散档位 (sm/md/lg/xl/2xl). */
  setFontSizeId(id: FontSize): void;
  /** T12: 直接写入离散档位 (compact/cozy/comfortable). */
  setLineHeightId(id: LineHeightId): void;
  /** T12: 代码块字号离散档位写入. */
  setCodeFontSize(id: CodeFontSize): void;
  /** T12: 升 / 降一档字号; delta=0 重置到默认 md. */
  cycleFontSize(delta: 1 | -1 | 0): void;
  /** T12: 升 / 降一档行高; delta=0 重置到默认 cozy. */
  cycleLineHeight(delta: 1 | -1 | 0): void;
  /** T12: 重置阅读偏好 (字号 / 行高 / 代码块字号) 回默认. */
  resetReadingPrefs(): void;
  /** T15 (FR-05): 设置界面语言. 写内存态; 持久化由 usePreferences debounce 自动触发. */
  setLanguage(lng: Language): void;
  /** T17-P2 (F-21): mermaid 图表渲染开关. clamp boolean 后写入内存态; 持久化由 usePreferences debounce 自动触发. */
  setMermaidEnabled(v: boolean): void;
  /** T17-P2 (F-22): KaTeX 公式渲染开关. clamp boolean 后写入内存态; 持久化由 usePreferences debounce 自动触发. */
  setKatexEnabled(v: boolean): void;
}

const defaults: Prefs = {
  theme: 'system',
  fontSize: 16,
  lineHeight: 1.6,
  codeBlockTheme: 'github',
  fontSizeId: 'md',
  lineHeightId: 'cozy',
  codeFontSizeId: 'md',
  language: 'zh-CN',
  mermaidEnabled: false,
  katexEnabled: false,
};

/** 校验 Theme 三档 union. */
function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system';
}

/** T15 (FR-05): 校验 Language union. */
function isLanguage(value: unknown): value is Language {
  return value === 'zh-CN' || value === 'en-US';
}

/** clamp 12..24 整数; 非法 (NaN) → 16. */
function clampFontSize(n: number): number {
  if (typeof n !== 'number' || Number.isNaN(n)) {
    console.warn('[prefStore] invalid fontSize, fallback to 16');
    return 16;
  }
  return Math.max(12, Math.min(24, Math.round(n)));
}

/** 三档离散校验. */
function isLineHeight(n: unknown): n is LineHeight {
  return n === 1.4 || n === 1.6 || n === 1.8;
}

export const usePrefStore = create<PrefStore>((set, get) => ({
  prefs: { ...defaults },
  hydrated: false,
  loaded: false,

  // T03 step-02 (保持不变 — 不破坏 T03 行为).
  setTheme(theme) {
    if (theme === null || typeof theme !== 'string') {
      console.log('[prefStore] theme must be \'light\' | \'dark\' | \'system\'');
      throw new TypeError("theme must be 'light' | 'dark' | 'system'");
    }
    if (!isTheme(theme)) {
      console.warn(`[prefStore] invalid theme: ${theme}`);
      return;
    }
    set((s) => ({ prefs: { ...s.prefs, theme } }));
  },

  // T04 新增: 字号 clamp + set.
  setFontSize(n) {
    const v = clampFontSize(n);
    set((s) => ({
      prefs: {
        ...s.prefs,
        fontSize: v,
        fontSizeId: fontSizeFromPx(v),
      },
    }));
  },

  // T04 新增: 行高三档校验 + set.
  setLineHeight(n) {
    if (!isLineHeight(n)) {
      console.warn(`[prefStore] invalid lineHeight: ${n}`);
      return;
    }
    set((s) => ({
      prefs: {
        ...s.prefs,
        lineHeight: n,
        lineHeightId: lineHeightFromNumber(n),
      },
    }));
  },

  // T12 新增: 字号离散档位写入.
  setFontSizeId(id) {
    if (!isFontSize(id)) {
      console.warn(`[prefStore] invalid fontSizeId: ${id}`);
      return;
    }
    set((s) => ({
      prefs: { ...s.prefs, fontSizeId: id, fontSize: getFontSizePx(id) },
    }));
  },

  // T12 新增: 行高离散档位写入.
  setLineHeightId(id) {
    if (!isLineHeightId(id)) {
      console.warn(`[prefStore] invalid lineHeightId: ${id}`);
      return;
    }
    set((s) => ({
      prefs: {
        ...s.prefs,
        lineHeightId: id,
        lineHeight: getLineHeightValue(id) as LineHeight,
      },
    }));
  },

  // T12 新增: 代码块字号离散档位写入.
  setCodeFontSize(id) {
    if (!['xs', 'sm', 'md', 'lg'].includes(id)) {
      console.warn(`[prefStore] invalid codeFontSizeId: ${id}`);
      return;
    }
    set((s) => ({ prefs: { ...s.prefs, codeFontSizeId: id } }));
  },

  // T12 新增: 循环字号; delta=0 → 重置到默认 md.
  cycleFontSize(delta) {
    if (delta === 0) {
      get().setFontSizeId('md');
      return;
    }
    const cur = get().prefs.fontSizeId;
    const next = cycleFontSizeFn(cur, delta);
    get().setFontSizeId(next);
  },

  // T12 新增: 循环行高; delta=0 → 重置到默认 cozy.
  cycleLineHeight(delta) {
    if (delta === 0) {
      get().setLineHeightId('cozy');
      return;
    }
    const cur = get().prefs.lineHeightId;
    const next = cycleLineHeightFn(cur, delta);
    get().setLineHeightId(next);
  },

  // T12 新增: 重置阅读偏好.
  resetReadingPrefs() {
    set((s) => ({
      prefs: {
        ...s.prefs,
        fontSize: defaults.fontSize,
        lineHeight: defaults.lineHeight,
        fontSizeId: defaults.fontSizeId,
        lineHeightId: defaults.lineHeightId,
        codeFontSizeId: defaults.codeFontSizeId,
        language: s.prefs.language,
      },
    }));
  },

  // T15 (FR-05): setLanguage. 内存态写入 + 同步触发 i18n.changeLanguage
  // 实现即时 UI 切换 (AC-03-1); 持久化 (debounce 300ms) 由 usePreferences
  // hook 统一负责. 非法值: console.warn 后忽略 (保持当前值).
  setLanguage(lng) {
    if (!isLanguage(lng)) {
      console.warn(`[prefStore] invalid language: ${String(lng)}`);
      return;
    }
    set((s) => ({ prefs: { ...s.prefs, language: lng } }));
    void i18n.changeLanguage(lng).catch((err) => {
      console.warn('[prefStore] changeLanguage failed:', err);
    });
  },

  // T17-P2 (F-21): mermaidEnabled setter. clamp boolean 后写内存态.
  // 持久化由 usePreferences 300ms debounce 自动触发; 非法值 → console.warn + 忽略.
  setMermaidEnabled(v) {
    if (typeof v !== 'boolean') {
      console.warn(`[prefStore] invalid mermaidEnabled: ${String(v)}`);
      return;
    }
    set((s) => ({ prefs: { ...s.prefs, mermaidEnabled: v } }));
  },

  // T17-P2 (F-22): katexEnabled setter. clamp boolean 后写内存态.
  // 持久化由 usePreferences 300ms debounce 自动触发; 非法值 → console.warn + 忽略.
  setKatexEnabled(v) {
    if (typeof v !== 'boolean') {
      console.warn(`[prefStore] invalid katexEnabled: ${String(v)}`);
      return;
    }
    set((s) => ({ prefs: { ...s.prefs, katexEnabled: v } }));
  },

  // T04 新增: 一次性合并 partial + 设 hydrated=true.
  // 缺失字段保持当前值; 字段 clamp/校验与 setter 等价 (防脏数据).
  // T15 (FR-05): language 字段若 patch 提供但非法, 视为缺省值 'zh-CN' (AC-05-2).
  // T15 (AC-03-2 / AC-05-1): hydrate 完成后同步 i18n.changeLanguage,
  //   让 store 持久化的语言在首屏即时生效 (避免闪烁回退到默认).
  // T17-P2 (F-21/F-22): mermaidEnabled / katexEnabled 字段若 patch 提供但非法, 保持当前值.
  hydrate(p) {
    const patch = p ?? {};
    const sanitizedFontSize =
      patch.fontSize !== undefined ? clampFontSize(patch.fontSize) : undefined;
    const sanitizedLineHeight =
      patch.lineHeight !== undefined && isLineHeight(patch.lineHeight)
        ? patch.lineHeight
        : undefined;
    const sanitizedMermaidEnabled =
      typeof (patch as { mermaidEnabled?: unknown }).mermaidEnabled === 'boolean'
        ? (patch as { mermaidEnabled: boolean }).mermaidEnabled
        : undefined;
    const sanitizedKatexEnabled =
      typeof (patch as { katexEnabled?: unknown }).katexEnabled === 'boolean'
        ? (patch as { katexEnabled: boolean }).katexEnabled
        : undefined;
    set((s) => {
      const nextFontSize =
        sanitizedFontSize !== undefined ? sanitizedFontSize : s.prefs.fontSize;
      const nextLineHeight =
        sanitizedLineHeight !== undefined ? sanitizedLineHeight : s.prefs.lineHeight;
      // T15 (FR-05): 区分两种语义.
      //   1) patch.language 完全未提供 (undefined) → 保持当前值 (其它字段同理).
      //   2) patch.language 提供但非法值 (fr-FR 等) → 重置为 'zh-CN' (AC-05-2).
      let nextLanguage: Language = s.prefs.language;
      if ('language' in patch) {
        nextLanguage = isLanguage(patch.language) ? patch.language : 'zh-CN';
      }
      return {
        prefs: {
          theme: isTheme(patch.theme) ? patch.theme : s.prefs.theme,
          fontSize: nextFontSize,
          lineHeight: nextLineHeight,
          codeBlockTheme:
            typeof patch.codeBlockTheme === 'string'
              ? patch.codeBlockTheme
              : s.prefs.codeBlockTheme,
          fontSizeId: fontSizeFromPx(nextFontSize),
          lineHeightId: lineHeightFromNumber(nextLineHeight),
          codeFontSizeId: s.prefs.codeFontSizeId,
          language: nextLanguage,
          mermaidEnabled:
            sanitizedMermaidEnabled !== undefined
              ? sanitizedMermaidEnabled
              : s.prefs.mermaidEnabled,
          katexEnabled:
            sanitizedKatexEnabled !== undefined
              ? sanitizedKatexEnabled
              : s.prefs.katexEnabled,
        },
        hydrated: true,
      };
    });
    // T15 (AC-03-2): 启动 hydrate 时若语言字段存在 (合法值), 立即切换 i18n.
    if ('language' in (p ?? {})) {
      const lang = (p as { language?: unknown }).language;
      if (isLanguage(lang)) {
        void i18n.changeLanguage(lang).catch((err) => {
          console.warn('[prefStore] hydrate changeLanguage failed:', err);
        });
      }
    }
  },

  // T01 placeholder — usePreferences 接管 (保留兼容调用面).
  async load() {
    set(() => ({ loaded: true }));
    throw new Error('prefStore.load() is not implemented; use usePreferences hook');
  },
  async update(patch) {
    const sanitizedFontSize =
      typeof patch.fontSize === 'number' ? clampFontSize(patch.fontSize) : undefined;
    const sanitizedLineHeight =
      patch.lineHeight !== undefined && isLineHeight(patch.lineHeight)
        ? patch.lineHeight
        : undefined;
    set((s) => {
      const nextFontSize =
        sanitizedFontSize !== undefined ? sanitizedFontSize : s.prefs.fontSize;
      const nextLineHeight =
        sanitizedLineHeight !== undefined ? sanitizedLineHeight : s.prefs.lineHeight;
      return {
        prefs: {
          ...s.prefs,
          ...(patch.theme && isTheme(patch.theme) ? { theme: patch.theme } : {}),
          ...(typeof patch.fontSize === 'number'
            ? { fontSize: nextFontSize, fontSizeId: fontSizeFromPx(nextFontSize) }
            : {}),
          ...(patch.lineHeight !== undefined && isLineHeight(patch.lineHeight)
            ? { lineHeight: nextLineHeight, lineHeightId: lineHeightFromNumber(nextLineHeight) }
            : {}),
          ...(typeof patch.codeBlockTheme === 'string'
            ? { codeBlockTheme: patch.codeBlockTheme }
            : {}),
        },
      };
    });
    throw new Error('prefStore.update() is not implemented; use usePreferences hook');
  },
}));

/** 等价访问器 (设计 §3.2). */
export function getTheme(): Theme {
  return usePrefStore.getState().prefs.theme;
}

/**
 * cycleTheme — 三档循环 (T11, 设计 §3.6.6 / §3.4).
 *
 *   light → dark → system → light
 *
 * 损坏 theme 兜底: 与 'system' 同义 → light.
 * 不修改其它字段; 落盘由 usePreferences 300ms debounce 自动触发.
 */
export function cycleTheme(): void {
  const cur = usePrefStore.getState().prefs.theme;
  const next: Theme =
    cur === 'light' ? 'dark' : cur === 'dark' ? 'system' : 'light';
  usePrefStore.getState().setTheme(next);
}

// Re-export 离散档位常量, 便于外部一处 import.
export { FONT_SIZES, LINE_HEIGHTS };
export type { FontSize, LineHeightId, CodeFontSize };
export { CODE_FONT_SIZE_PX, codeFontSizeFromPx };
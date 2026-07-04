/**
 * reader-prefs.ts — T12 字号 / 行高离散档位 token (设计 §3.6 / FR-01~FR-05).
 *
 * 责任:
 *   - 定义 5 档正文字号 FONT_SIZES (sm / md / lg / xl / 2xl) 与 3 档行高
 *     LINE_HEIGHTS (compact / cozy / comfortable).
 *   - 提供 cycleFontSize / cycleLineHeight 用于 Cmd± / Cmd+0 / Cmd+Shift+L 等
 *     快捷键与键盘焦点环行为.
 *   - 提供 FontSize / LineHeight 类型守卫与元数据查表.
 *
 * T18 (FR-02):
 *   - label 字段仍保留作为 fallback; 但 Settings 组件应优先使用 i18n 键:
 *     settings.fontSize.<id> / settings.lineHeight.<id>.
 *   - 此模块不直接调用 i18n (无 React 上下文), 由调用方注入.
 *
 * 纪律:
 *   - 纯常量 + 纯函数; 不依赖 React / 不依赖 store; 不调 IPC.
 *   - 不破坏 T04 既有 Prefs 形状 (fontSize: number, lineHeight: 1.4|1.6|1.8).
 *     T12 的 FontSize / LineHeight 是新的"档位 token", T04 的 number 是"px 值";
 *     通过 getFontSizePx / getLineHeightNumber 在两套视图之间互转.
 *   - clamp / cycle 行为: 上下限保持当前档 (不越界).
 */

/* -------------------------------------------------------------------------- */
/* 字号 — 5 档 (设计 §3.6.1)                                                    */
/* -------------------------------------------------------------------------- */

export const FONT_SIZES = ['sm', 'md', 'lg', 'xl', '2xl'] as const;
export type FontSize = (typeof FONT_SIZES)[number];

export interface FontSizeMeta {
  /** 字号 token 名称 (sm/md/lg/xl/2xl). */
  id: FontSize;
  /** 字号 px 值 (与 T04 Prefs.fontSize number 兼容). */
  px: number;
  /** 中文 fallback label (UI 展示). T18: 优先使用 i18n 键 `settings.fontSize.<id>`. */
  label: string;
  /** 调试用 — 视觉对应 A-/A/A+/A++ (NFR-A-02). */
  hint: string;
}

const FONT_SIZE_META: Record<FontSize, FontSizeMeta> = {
  // T18 (FR-02): label 是 fallback; Settings.tsx 优先用 t('settings.fontSizes.<id>')
  // 取值. 此处用英文短语作为 lib 层 fallback (无 React 上下文).
  sm: { id: 'sm', px: 14, label: 'Small', hint: 'A-' },
  md: { id: 'md', px: 16, label: 'Standard', hint: 'A' },
  lg: { id: 'lg', px: 18, label: 'Medium', hint: 'A+' },
  xl: { id: 'xl', px: 20, label: 'Large', hint: 'A++' },
  '2xl': { id: '2xl', px: 24, label: 'Extra Large', hint: 'A+++' },
};

/** 取档位元数据 (默认 fallback 到 md). */
export function getFontSizeMeta(id: FontSize): FontSizeMeta {
  return FONT_SIZE_META[id];
}

/** 取档位对应的 px 值 (默认 16). */
export function getFontSizePx(id: FontSize): number {
  return getFontSizeMeta(id).px;
}

/** 类型守卫: unknown 是否为合法 FontSize. */
export function isFontSize(value: unknown): value is FontSize {
  return typeof value === 'string' && (FONT_SIZES as readonly string[]).includes(value);
}

/** 上下限钳制 — 越界返回最近合法档. */
export function clampFontSize(id: FontSize): FontSize {
  if (isFontSize(id)) return id;
  return 'md';
}

/** 单向循环 — delta=1 → 升一档; delta=-1 → 降一档; 上下限钳制. */
export function cycleFontSize(id: FontSize, delta: 1 | -1): FontSize {
  const idx = FONT_SIZES.indexOf(id);
  if (idx < 0) return 'md';
  const next = idx + delta;
  if (next < 0) return FONT_SIZES[0]!;
  if (next >= FONT_SIZES.length) return FONT_SIZES[FONT_SIZES.length - 1]!;
  return FONT_SIZES[next]!;
}

/** 重置到默认档 (md). */
export function defaultFontSize(): FontSize {
  return 'md';
}

/* -------------------------------------------------------------------------- */
/* 行高 — 3 档 (设计 §3.6.2)                                                    */
/* -------------------------------------------------------------------------- */

export const LINE_HEIGHTS = ['compact', 'cozy', 'comfortable'] as const;
export type LineHeight = (typeof LINE_HEIGHTS)[number];

export interface LineHeightMeta {
  /** 行高 token 名称. */
  id: LineHeight;
  /** 行高浮点值 (与 T04 Prefs.lineHeight 1.4/1.6/1.8 兼容). */
  value: number;
  /** 中文标签 (UI 展示). */
  label: string;
}

const LINE_HEIGHT_META: Record<LineHeight, LineHeightMeta> = {
  // T18 (FR-02): label 是 fallback; Settings.tsx 优先用 t('settings.lineHeights.<id>')
  // 取值. 此处用英文短语作为 lib 层 fallback (无 React 上下文).
  compact: { id: 'compact', value: 1.4, label: 'Compact' },
  cozy: { id: 'cozy', value: 1.6, label: 'Cozy' },
  comfortable: { id: 'comfortable', value: 1.8, label: 'Comfortable' },
};

/** 取档位元数据 (默认 fallback 到 cozy). */
export function getLineHeightMeta(id: LineHeight): LineHeightMeta {
  return LINE_HEIGHT_META[id];
}

/** 取档位对应的浮点值 (默认 1.6). */
export function getLineHeightValue(id: LineHeight): number {
  return getLineHeightMeta(id).value;
}

/** 类型守卫: unknown 是否为合法 LineHeight. */
export function isLineHeightId(value: unknown): value is LineHeight {
  return typeof value === 'string' && (LINE_HEIGHTS as readonly string[]).includes(value);
}

/** T04 兼容: 数字 → LineHeight (最近匹配, ties → 偏小档). */
export function lineHeightFromNumber(n: number): LineHeight {
  let best: LineHeight = 'cozy';
  let bestDiff = Infinity;
  // 正序遍历: 平局时先写者赢, 即偏小档.
  for (const id of LINE_HEIGHTS) {
    const diff = Math.abs(LINE_HEIGHT_META[id].value - n);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = id;
    }
  }
  return best;
}

/** T04 兼容: px → FontSize (最近匹配, ties → 偏小档). */
export function fontSizeFromPx(px: number): FontSize {
  let best: FontSize = 'md';
  let bestDiff = Infinity;
  // 正序遍历: 平局时先写者赢, 即偏小档.
  for (const id of FONT_SIZES) {
    const diff = Math.abs(FONT_SIZE_META[id].px - px);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = id;
    }
  }
  return best;
}

/** 单向循环 — delta=1 → 升一档; delta=-1 → 降一档; 上下限钳制. */
export function cycleLineHeight(id: LineHeight, delta: 1 | -1 = 1): LineHeight {
  const idx = LINE_HEIGHTS.indexOf(id);
  if (idx < 0) return 'cozy';
  const next = idx + delta;
  if (next < 0) return LINE_HEIGHTS[0]!;
  if (next >= LINE_HEIGHTS.length) return LINE_HEIGHTS[LINE_HEIGHTS.length - 1]!;
  return LINE_HEIGHTS[next]!;
}

/** 重置到默认档 (cozy). */
export function defaultLineHeight(): LineHeight {
  return 'cozy';
}

/* -------------------------------------------------------------------------- */
/* 代码块字号 (设计 §3.6.3)                                                    */
/* -------------------------------------------------------------------------- */

export const CODE_FONT_SIZES = ['xs', 'sm', 'md', 'lg'] as const;
export type CodeFontSize = (typeof CODE_FONT_SIZES)[number];

export const CODE_FONT_SIZE_PX: Record<CodeFontSize, number> = {
  xs: 12,
  sm: 13,
  md: 14,
  lg: 16,
};

/** T04 兼容: px → CodeFontSize (最近匹配). */
export function codeFontSizeFromPx(px: number): CodeFontSize {
  let best: CodeFontSize = 'md';
  let bestDiff = Infinity;
  for (const id of CODE_FONT_SIZES) {
    const diff = Math.abs(CODE_FONT_SIZE_PX[id] - px);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = id;
    }
  }
  return best;
}

/** 默认代码块字号. */
export function defaultCodeFontSize(): CodeFontSize {
  return 'md';
}
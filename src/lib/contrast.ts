/**
 * contrast.ts — WCAG 2.1 相对亮度 & 对比度公式工具 (设计 §3.7 / FR-08 / NFR-A-03).
 *
 * 责任:
 *   - 提供 sRGB 反伽马 (linearize) + 相对亮度 (relativeLuminance).
 *   - 提供 contrastRatio(fg, bg) — 两组 [r,g,b] 8-bit 色.
 *   - 提供 judgeContrast(ratio, level) — 返回 'AAA' | 'AA' | 'AA-large' | 'fail'.
 *
 * 参考:
 *   https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 *   https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
 *
 * 纪律:
 *   - 纯函数; 不依赖 DOM; 不调 IPC.
 *   - 输入容错: 浮点 / 越界值都按规范折算 (clamp 0..255 + 取整).
 *   - 输出精度 0.01 (round-half-up), 足够 UI 提示.
 */

export type Rgb = readonly [number, number, number];

export type ContrastLevel = 'AAA' | 'AA' | 'AA-large' | 'fail';

/** 把 8-bit sRGB 通道折算到 0..1 浮点. */
function srgbChannelToLinear(c8: number): number {
  const c = Math.min(255, Math.max(0, c8)) / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * 相对亮度 (WCAG 2.1).
 * 输入: [r, g, b] ∈ 0..255 (越界自动钳制).
 * 输出: 0..1 浮点.
 */
export function relativeLuminance(rgb: Rgb): number {
  const [r, g, b] = rgb;
  const R = srgbChannelToLinear(r);
  const G = srgbChannelToLinear(g);
  const B = srgbChannelToLinear(b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/**
 * 对比度比值 (WCAG 2.1).
 * ratio = (L_lighter + 0.05) / (L_darker + 0.05).
 * 输入任意两组 RGB; 输出 ≥ 1 的浮点比值.
 */
export function contrastRatio(fg: Rgb, bg: Rgb): number {
  const L1 = relativeLuminance(fg);
  const L2 = relativeLuminance(bg);
  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * 按 WCAG 2.1 判定对比度等级.
 *   - 7.0+   → AAA
 *   - 4.5+   → AA
 *   - 3.0+   → AA-large (粗体 18pt+ 或普通 24pt+)
 *   - < 3.0  → fail
 */
export function judgeContrast(ratio: number): ContrastLevel {
  if (ratio >= 7) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  if (ratio >= 3) return 'AA-large';
  return 'fail';
}

/** 便捷判定: 是否达到 AA 标准 (正文小字 4.5:1). */
export function meetsAA(ratio: number): boolean {
  return ratio >= 4.5;
}

/** 便捷判定: 是否达到 AAA 标准 (7:1). */
export function meetsAAA(ratio: number): boolean {
  return ratio >= 7;
}

/** 把 24-bit hex (#rrggbb) 转 [r,g,b] tuple. */
export function hexToRgb(hex: string): Rgb | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m || !m[1]) return null;
  const s = m[1];
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  return [r, g, b];
}

/** 把 [r,g,b] 0..255 转 24-bit hex (小写). */
export function rgbToHex(rgb: Rgb): string {
  const toHex = (n: number): string => {
    const v = Math.min(255, Math.max(0, Math.round(n)));
    return v.toString(16).padStart(2, '0');
  };
  return `#${toHex(rgb[0])}${toHex(rgb[1])}${toHex(rgb[2])}`;
}
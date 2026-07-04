/**
 * reader-prefs.test.ts — T12 字号 / 行高离散档位单元测试.
 *
 * 覆盖 (设计 §3.6.1 + §3.6.2):
 *   - FONT_SIZES / LINE_HEIGHTS 常量值与顺序.
 *   - getFontSizePx('md') === 16 等.
 *   - cycleFontSize 上下限钳制.
 *   - fontSizeFromPx / lineHeightFromNumber 最近匹配.
 *   - clampFontSize 防御性 fallback.
 */
import { describe, expect, it } from 'vitest';

import {
  FONT_SIZES,
  LINE_HEIGHTS,
  cycleFontSize,
  cycleLineHeight,
  clampFontSize,
  fontSizeFromPx,
  getFontSizeMeta,
  getFontSizePx,
  getLineHeightMeta,
  getLineHeightValue,
  isFontSize,
  isLineHeightId,
  lineHeightFromNumber,
} from '../reader-prefs';

describe('FONT_SIZES — 5 档 token', () => {
  it('contains exactly [sm, md, lg, xl, 2xl] in order', () => {
    expect(FONT_SIZES).toEqual(['sm', 'md', 'lg', 'xl', '2xl']);
  });

  it('getFontSizePx returns [14, 16, 18, 20, 24]', () => {
    expect(getFontSizePx('sm')).toBe(14);
    expect(getFontSizePx('md')).toBe(16);
    expect(getFontSizePx('lg')).toBe(18);
    expect(getFontSizePx('xl')).toBe(20);
    expect(getFontSizePx('2xl')).toBe(24);
  });

  it('getFontSizeMeta returns id / px / label / hint', () => {
    const meta = getFontSizeMeta('md');
    expect(meta.id).toBe('md');
    expect(meta.px).toBe(16);
    expect(meta.label).toBeTruthy();
    expect(meta.hint).toBeTruthy();
  });

  it('isFontSize narrows type', () => {
    expect(isFontSize('md')).toBe(true);
    expect(isFontSize('xxl')).toBe(false);
    expect(isFontSize(null)).toBe(false);
    expect(isFontSize(16)).toBe(false);
  });
});

describe('cycleFontSize — 单向循环 + 上下限钳制', () => {
  it('forward cycles through the table', () => {
    expect(cycleFontSize('sm', 1)).toBe('md');
    expect(cycleFontSize('md', 1)).toBe('lg');
    expect(cycleFontSize('lg', 1)).toBe('xl');
    expect(cycleFontSize('xl', 1)).toBe('2xl');
  });

  it('backward cycles through the table', () => {
    expect(cycleFontSize('2xl', -1)).toBe('xl');
    expect(cycleFontSize('xl', -1)).toBe('lg');
    expect(cycleFontSize('lg', -1)).toBe('md');
    expect(cycleFontSize('md', -1)).toBe('sm');
  });

  it('clamps at the upper bound (2xl stays 2xl)', () => {
    expect(cycleFontSize('2xl', 1)).toBe('2xl');
  });

  it('clamps at the lower bound (sm stays sm)', () => {
    expect(cycleFontSize('sm', -1)).toBe('sm');
  });

  it('falls back to md on unknown input', () => {
    expect(cycleFontSize('invalid' as never, 1)).toBe('md');
  });
});

describe('clampFontSize — 防御性 fallback', () => {
  it('returns valid ids unchanged', () => {
    expect(clampFontSize('md')).toBe('md');
    expect(clampFontSize('2xl')).toBe('2xl');
  });

  it('returns md on invalid input', () => {
    expect(clampFontSize('xxl' as never)).toBe('md');
    expect(clampFontSize('' as never)).toBe('md');
  });
});

describe('fontSizeFromPx — T04 number → T12 token', () => {
  it('exact match wins', () => {
    expect(fontSizeFromPx(14)).toBe('sm');
    expect(fontSizeFromPx(16)).toBe('md');
    expect(fontSizeFromPx(18)).toBe('lg');
    expect(fontSizeFromPx(20)).toBe('xl');
    expect(fontSizeFromPx(24)).toBe('2xl');
  });

  it('nearest match wins for in-between values', () => {
    expect(fontSizeFromPx(15)).toBe('sm'); // 15 equidistant (14 vs 16); ties → smaller 'sm'
    expect(fontSizeFromPx(17)).toBe('md'); // 17 equidistant (16 vs 18); ties → smaller 'md'
    expect(fontSizeFromPx(19)).toBe('lg'); // 19 closer to 18 than 20
    expect(fontSizeFromPx(22)).toBe('xl'); // 22 equidistant (20 vs 24); ties → smaller 'xl'
    expect(fontSizeFromPx(23)).toBe('2xl'); // 23 closer to 24 than 20
  });
});

describe('LINE_HEIGHTS — 3 档 token', () => {
  it('contains exactly [compact, cozy, comfortable] in order', () => {
    expect(LINE_HEIGHTS).toEqual(['compact', 'cozy', 'comfortable']);
  });

  it('getLineHeightValue returns [1.4, 1.6, 1.8]', () => {
    expect(getLineHeightValue('compact')).toBe(1.4);
    expect(getLineHeightValue('cozy')).toBe(1.6);
    expect(getLineHeightValue('comfortable')).toBe(1.8);
  });

  it('getLineHeightMeta returns id / value / label', () => {
    const meta = getLineHeightMeta('cozy');
    expect(meta.id).toBe('cozy');
    expect(meta.value).toBe(1.6);
    // T18 (FR-02): meta.label 是 lib 层英文 fallback; 真实 UI 文案走 settings.lineHeights.<id>.
    expect(meta.label).toBe('Cozy');
  });

  it('isLineHeightId narrows type', () => {
    expect(isLineHeightId('cozy')).toBe(true);
    expect(isLineHeightId('wide')).toBe(false);
    expect(isLineHeightId(1.6)).toBe(false);
  });
});

describe('cycleLineHeight — 单向循环', () => {
  it('forward cycles', () => {
    expect(cycleLineHeight('compact', 1)).toBe('cozy');
    expect(cycleLineHeight('cozy', 1)).toBe('comfortable');
  });

  it('backward cycles', () => {
    expect(cycleLineHeight('comfortable', -1)).toBe('cozy');
    expect(cycleLineHeight('cozy', -1)).toBe('compact');
  });

  it('clamps at upper bound', () => {
    expect(cycleLineHeight('comfortable', 1)).toBe('comfortable');
  });

  it('clamps at lower bound', () => {
    expect(cycleLineHeight('compact', -1)).toBe('compact');
  });
});

describe('lineHeightFromNumber — T04 number → T12 token', () => {
  it('exact match wins', () => {
    expect(lineHeightFromNumber(1.4)).toBe('compact');
    expect(lineHeightFromNumber(1.6)).toBe('cozy');
    expect(lineHeightFromNumber(1.8)).toBe('comfortable');
  });

  it('nearest match wins for in-between values', () => {
    expect(lineHeightFromNumber(1.5)).toBe('compact'); // 1.5 equidistant (1.4 vs 1.6); ties → smaller 'compact'
    expect(lineHeightFromNumber(1.7)).toBe('cozy'); // 1.7 equidistant (1.6 vs 1.8); ties → smaller 'cozy'
  });
});
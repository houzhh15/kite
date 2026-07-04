/**
 * contrast.test.ts — WCAG 2.1 对比度工具测试 (设计 §3.7 / NFR-A-03).
 */
import { describe, expect, it } from 'vitest';

import {
  contrastRatio,
  judgeContrast,
  meetsAA,
  meetsAAA,
  relativeLuminance,
  hexToRgb,
  rgbToHex,
} from '../contrast';

describe('relativeLuminance — WCAG 2.1 公式', () => {
  it('white = 1.0', () => {
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1.0, 5);
  });

  it('black = 0.0', () => {
    expect(relativeLuminance([0, 0, 0])).toBeCloseTo(0.0, 5);
  });

  it('mid-gray (~#777777) ≈ 0.18', () => {
    // sRGB ≈ 0.18 luminance
    expect(relativeLuminance([0x77, 0x77, 0x77])).toBeCloseTo(0.18, 1);
  });
});

describe('contrastRatio — 设计文档关键值', () => {
  it('blue-600 #1d4ed8 (29,78,216) on white ≥ 5.5 (AA+ enhanced)', () => {
    // T12 step-12: corrected blue to #1d4ed8 → ~6.7:1 on white (well above AA 4.5).
    const r = contrastRatio([29, 78, 216], [255, 255, 255]);
    expect(r).toBeGreaterThan(5.5);
    expect(r).toBeLessThan(7.0);
  });

  it('blue-400 #60a5fa (96,165,250) on slate-900 #18181b (24,24,27) ≥ 6.5', () => {
    const r = contrastRatio([96, 165, 250], [24, 24, 27]);
    expect(r).toBeGreaterThan(6.5);
    expect(r).toBeLessThan(7.5);
  });

  it('black/white = 21:1 exactly', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 1);
  });

  it('symmetry: ratio(fg, bg) === ratio(bg, fg)', () => {
    const a = contrastRatio([120, 50, 50], [240, 240, 240]);
    const b = contrastRatio([240, 240, 240], [120, 50, 50]);
    expect(a).toBeCloseTo(b, 5);
  });

  it('disabled-text minimum 3:1', () => {
    // a light gray on white should still clear 3:1 for disabled icons
    expect(contrastRatio([134, 134, 134], [255, 255, 255])).toBeGreaterThan(3);
  });
});

describe('judgeContrast — WCAG 等级判定', () => {
  it('21:1 → AAA', () => {
    expect(judgeContrast(21)).toBe('AAA');
  });
  it('4.6:1 → AA', () => {
    expect(judgeContrast(4.6)).toBe('AA');
  });
  it('3.5:1 → AA-large', () => {
    expect(judgeContrast(3.5)).toBe('AA-large');
  });
  it('2.0:1 → fail', () => {
    expect(judgeContrast(2.0)).toBe('fail');
  });
});

describe('meetsAA / meetsAAA', () => {
  it('meetsAA threshold 4.5', () => {
    expect(meetsAA(4.5)).toBe(true);
    expect(meetsAA(4.4)).toBe(false);
  });
  it('meetsAAA threshold 7.0', () => {
    expect(meetsAAA(7.0)).toBe(true);
    expect(meetsAAA(6.9)).toBe(false);
  });
});

describe('hex <-> rgb', () => {
  it('hexToRgb parses #rrggbb', () => {
    expect(hexToRgb('#1d4ed8')).toEqual([29, 78, 216]);
    expect(hexToRgb('60a5fa')).toEqual([96, 165, 250]);
  });
  it('hexToRgb returns null on invalid', () => {
    expect(hexToRgb('#zzz')).toBeNull();
    expect(hexToRgb('hello')).toBeNull();
  });
  it('rgbToHex round-trips', () => {
    expect(rgbToHex([29, 78, 216])).toBe('#1d4ed8');
    expect(rgbToHex([0, 0, 0])).toBe('#000000');
    expect(rgbToHex([255, 255, 255])).toBe('#ffffff');
  });
});
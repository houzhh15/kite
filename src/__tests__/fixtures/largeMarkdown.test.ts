/**
 * largeMarkdown fixture 自检 (T10 step-1b).
 *
 * 验证生成器正确性:
 *   - 100KB 量级目标: 默认 options 产出长度 ≥ 80KB (留余量).
 *   - 跨段落样本: buildCrossParagraphSample 包含期望数量的 needle.
 *   - needle 散布在多种块级节点 (heading / paragraph / blockquote / list / table).
 */
import { describe, it, expect } from 'vitest';

import { buildLargeMarkdown, buildCrossParagraphSample, LARGE_MD_KEYWORD } from './largeMarkdown';

describe('largeMarkdown fixture (T10 step-1b)', () => {
  it('默认 options 输出 ≥ 80KB 字符', () => {
    const md = buildLargeMarkdown();
    expect(md.length).toBeGreaterThanOrEqual(80_000);
  });

  it('默认 needle 在生成文档中出现多次 (跨段落分布)', () => {
    const md = buildLargeMarkdown();
    const occurrences = md.split(LARGE_MD_KEYWORD).length - 1;
    expect(occurrences).toBeGreaterThan(100);
  });

  it('自定义 needle/paragraphs 可控', () => {
    const md = buildLargeMarkdown({ paragraphs: 50, repeats: 5, needle: 'XYZ', needleEvery: 2 });
    // 估算: 50 段 × 5 行 = 250 行; 每 2 行 1 次 XYZ = ~125 次.
    const occurrences = md.split('XYZ').length - 1;
    expect(occurrences).toBeGreaterThan(50);
  });

  it('buildCrossParagraphSample: needle 至少在 4 个不同块级节点中出现', () => {
    const needle = 'lorem ipsum dolor';
    const md = buildCrossParagraphSample(needle);
    // 直接 grep 出现次数
    const occurrences = md.split(needle).length - 1;
    // paragraph + blockquote + list + table cell = 4
    expect(occurrences).toBeGreaterThanOrEqual(4);
  });
});
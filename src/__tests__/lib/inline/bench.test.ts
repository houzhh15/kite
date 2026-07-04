/**
 * bench.test.ts — 性能基准 (AC-11-4 / AC-14-6).
 *
 *   - 10000 次 urlSafe < 1 s
 *   - 1000 次 slugify < 50 ms
 *
 * 该测试是性能门槛; 如退化请先确认是否新增了 regex 回溯 / URL 解析路径.
 */
import { describe, expect, it } from 'vitest';

import { urlSafe } from '../../../lib/inline/urlSafe';
import { slugify } from '../../../lib/inline/slugify';

describe('bench — urlSafe', () => {
  it('10000 次调用 < 1s (AC-14-6)', () => {
    const inputs = [
      'https://example.com',
      '#section',
      'mailto:a@b.com',
      'javascript:alert(1)',
      'data:image/png;base64,xxx',
      './img/a.png',
      'tel:+1-555-0100',
      '',
    ];
    const start = Date.now();
    for (let i = 0; i < 10000; i++) {
      const input = inputs[i % inputs.length];
      if (input !== undefined) urlSafe(input);
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1000);
  });
});

describe('bench — slugify', () => {
  it('1000 次调用 < 50ms (AC-11-4)', () => {
    const inputs: string[] = [];
    for (let i = 0; i < 1000; i++) {
      inputs.push(`Section ${i} 标题 ${i}`);
    }
    const start = Date.now();
    for (const s of inputs) slugify(s);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(50);
  });
});
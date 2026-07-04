/**
 * T13 parserThreshold.test.ts — T13 step-16b (I-02)
 *
 * 覆盖:
 *   - PARSER_WORKER_THRESHOLD_BYTES === 256 * 1024 = 262144
 *   - PARSER_WORKER_THRESHOLD_MB 数值正确
 *   - 同比常用样本 (10MB, 50KB) 与阈值的比较关系
 */
import { describe, expect, it } from 'vitest';

import {
  PARSER_WORKER_THRESHOLD_BYTES,
  PARSER_WORKER_THRESHOLD_MB,
} from '../parserThreshold';

describe('parserThreshold — T13 step-10a / I-02', () => {
  it('PARSER_WORKER_THRESHOLD_BYTES === 262144', () => {
    expect(PARSER_WORKER_THRESHOLD_BYTES).toBe(256 * 1024);
    expect(PARSER_WORKER_THRESHOLD_BYTES).toBe(262144);
  });

  it('PARSER_WORKER_THRESHOLD_MB === 0.25', () => {
    expect(PARSER_WORKER_THRESHOLD_MB).toBeCloseTo(0.25, 6);
  });

  it('threshold 与典型样本比较关系', () => {
    const t = PARSER_WORKER_THRESHOLD_BYTES;
    expect(50 * 1024).toBeLessThan(t);          // 50 KB < 256 KB
    expect(256 * 1024).toBe(t);                  // 256 KB == threshold
    expect(10 * 1024 * 1024).toBeGreaterThan(t); // 10 MB > threshold (走 Worker)
  });
});

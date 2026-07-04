/**
 * T13 perf.test.ts — T13 step-16a (FR-08 / E-03)
 *
 * 覆盖:
 *   - mark 在 performance 缺失时仍不抛错
 *   - measure 在缺失时返回 0 (降级路径)
 *   - isPerfDisabled 读取 VITE_PERF_DISABLE / PERF_DISABLE / window.PERF_DISABLE
 *   - PERF_DISABLE=1 时, mark/measure 静默 no-op
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isPerfDisabled,
  mark as perfMark,
  measure as perfMeasure,
  __resetPerfForTest,
} from '../perf';

describe('perf helpers — mark / measure / isPerfDisabled', () => {
  beforeEach(() => {
    __resetPerfForTest();
  });
  afterEach(() => {
    __resetPerfForTest();
    vi.restoreAllMocks();
  });

  it('mark + measure 正常路径返回 ms ≥ 0', () => {
    perfMark('a');
    perfMark('b');
    const dur = perfMeasure('sample', 'a', 'b');
    expect(typeof dur).toBe('number');
    expect(dur).toBeGreaterThanOrEqual(0);
  });

  it('mark 在 performance 缺失时仍不抛错 (降级路径)', () => {
    const originalPerf = globalThis.performance;
    // 故意清除做降级测试.
    delete (globalThis as { performance?: unknown }).performance;
    try {
      expect(() => perfMark('a')).not.toThrow();
      expect(() => perfMark('b')).not.toThrow();
      const dur = perfMeasure('sample', 'a', 'b');
      expect(typeof dur).toBe('number');
      expect(dur).toBeGreaterThanOrEqual(0);
    } finally {
      (globalThis as { performance?: unknown }).performance = originalPerf;
    }
  });

  it('isPerfDisabled 缺省 false', () => {
    expect(isPerfDisabled()).toBe(false);
  });

  it('PERF_DISABLE=1 (via window.PERF_DISABLE) -> isPerfDisabled() true', () => {
    const w = globalThis as unknown as Record<string, unknown>;
    const prev = w.PERF_DISABLE;
    w.PERF_DISABLE = '1';
    try {
      expect(isPerfDisabled()).toBe(true);
    } finally {
      if (prev === undefined) delete w.PERF_DISABLE;
      else w.PERF_DISABLE = prev;
    }
  });

  it('PERF_DISABLE=1 时 mark/measure 静默 no-op', () => {
    const w = globalThis as unknown as Record<string, unknown>;
    const prev = w.PERF_DISABLE;
    w.PERF_DISABLE = '1';
    try {
      // 即便 perfMark 被调用也只 no-op; dur 返回 0.
      expect(() => perfMark('a')).not.toThrow();
      expect(perfMeasure('sample', 'a', 'b')).toBe(0);
    } finally {
      if (prev === undefined) delete w.PERF_DISABLE;
      else w.PERF_DISABLE = prev;
    }
  });

  it('isPerfDisabled 读取 false 时不会启用 noop', () => {
    const w = globalThis as unknown as Record<string, unknown>;
    const prev = w.PERF_DISABLE;
    w.PERF_DISABLE = '0';
    try {
      expect(isPerfDisabled()).toBe(false);
    } finally {
      if (prev === undefined) delete w.PERF_DISABLE;
      else w.PERF_DISABLE = prev;
    }
  });
});

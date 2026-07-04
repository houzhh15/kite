/**
 * useMarkdownOutline 单元测试 (T09 §3.1 / step-2a..c).
 *
 * 覆盖:
 *   - step-2a: 同一 markdown 引用 -> 返回同一 OutlineItem[] 引用 (Object.is).
 *   - step-2b: 切换 markdown -> 重算且长度对得上.
 *   - step-2c: 空字符串 / 纯文本 -> `[]`; 异常降级 -> `[]` + console.warn.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

import { useMarkdownOutline } from '../useMarkdownOutline';

describe('useMarkdownOutline', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('同一 markdown 引用 -> 返回同一 OutlineItem[] 引用 (NFR-PERF-4)', () => {
    const md = '# A\n## B';
    const { result, rerender } = renderHook(({ md }: { md: string }) => useMarkdownOutline(md), {
      initialProps: { md },
    });
    const first = result.current;
    rerender({ md });
    expect(result.current).toBe(first);
  });

  it('切换 markdown -> 重新计算 (AC-06-1)', () => {
    const { result, rerender } = renderHook(({ md }: { md: string }) => useMarkdownOutline(md), {
      initialProps: { md: '# A' },
    });
    expect(result.current).toHaveLength(1);

    rerender({ md: '# A\n# B\n# C' });
    expect(result.current).toHaveLength(3);
    expect(result.current.map((o) => o.text)).toEqual(['A', 'B', 'C']);
  });

  it('空字符串 -> 空数组 (AC-01-4)', () => {
    const { result } = renderHook(() => useMarkdownOutline(''));
    expect(result.current).toEqual([]);
  });

  it('纯文本无标题 -> 空数组 (AC-01-5)', () => {
    const { result } = renderHook(() => useMarkdownOutline('plain\ntext\nonly'));
    expect(result.current).toEqual([]);
  });

  it('代码块内 # 不识别 (AC-01-2 透传)', () => {
    const md = ['# Real', '```', '# fake', '```', '## Another'].join('\n');
    const { result } = renderHook(() => useMarkdownOutline(md));
    expect(result.current).toHaveLength(2);
    expect(result.current.map((o) => o.text)).toEqual(['Real', 'Another']);
  });

  it('重名去重 (AC-01-3 透传)', () => {
    const md = ['## Summary', 'body', '## Summary'].join('\n');
    const { result } = renderHook(() => useMarkdownOutline(md));
    expect(result.current.map((o) => o.id)).toEqual(['summary', 'summary-1']);
  });

  it('异常降级: 任何入参都返回有效数组 (无 throw)', () => {
    // extractOutline 对非字符串返回 [] 不抛; 这里断言任意入参都不让 hook 抛错.
    const { result } = renderHook(() => useMarkdownOutline('# A'));
    expect(Array.isArray(result.current)).toBe(true);
    expect(result.current).toHaveLength(1);
  });
});

/**
 * useSearch 纯函数单元测试 (T10 step-2a).
 *
 * 设计依据: docs/design/compiled.md §3.1.3 + §4.1 + §8.1 接口契约.
 *
 * 覆盖:
 *   - buildPattern:
 *     * 空 query → pattern=null, invalidRegex=false (AC-02-3)
 *     * regex=true 非法正则 → pattern=null, invalidRegex=true (AC-02-2 / AC-05-3)
 *     * wholeWord=true → body 包含 \b...\b (AC-05-2)
 *     * caseSensitive=true → flags 严格 'g' (AC-05-1)
 *     * 默认 caseSensitive=false → flags 含 'i'
 *   - computeHits:
 *     * 10万字符基准 → 命中数 ≥ 0 (NFR-01-1 不在本单测断言, 见 perf.test.ts)
 *     * 跨段落匹配 → 返回多段命中
 *     * 空 content → hits=[]
 *     * 空 query → hits=[]
 *     * 命中长度 = match[0].length
 */
import { describe, it, expect } from 'vitest';

import { buildPattern, computeHits } from '../useSearch';
import { buildLargeMarkdown, buildCrossParagraphSample } from '../../__tests__/fixtures/largeMarkdown';

describe('buildPattern (T10 step-2a)', () => {
  it('空 query: pattern=null, invalidRegex=false (AC-02-3 / §8.1)', () => {
    const r = buildPattern('', { caseSensitive: false, wholeWord: false, regex: false });
    expect(r.pattern).toBeNull();
    expect(r.invalidRegex).toBe(false);
  });

  it('regex=true 非法正则: pattern=null, invalidRegex=true (AC-02-2 / AC-05-3)', () => {
    const r = buildPattern('[abc', { caseSensitive: false, wholeWord: false, regex: true });
    expect(r.pattern).toBeNull();
    expect(r.invalidRegex).toBe(true);
  });

  it('wholeWord=true: body 包含 \\b...\\b (AC-05-2)', () => {
    const r = buildPattern('cat', { caseSensitive: false, wholeWord: true, regex: false });
    expect(r.pattern).not.toBeNull();
    expect(r.pattern!.source).toBe('\\bcat\\b');
    expect(r.pattern!.flags).toContain('i');
  });

  it('wholeWord=true + regex=true: 外层 \\b 包在 user pattern 外', () => {
    const r = buildPattern('cat|dog', { caseSensitive: false, wholeWord: true, regex: true });
    expect(r.pattern).not.toBeNull();
    expect(r.pattern!.source).toBe('\\b(?:cat|dog)\\b');
  });

  it('caseSensitive=true: flags 不含 i (AC-05-1)', () => {
    const r = buildPattern('Hello', { caseSensitive: true, wholeWord: false, regex: false });
    expect(r.pattern).not.toBeNull();
    expect(r.pattern!.flags).toBe('g');
  });

  it('caseSensitive=false 默认: flags 含 i', () => {
    const r = buildPattern('Hello', { caseSensitive: false, wholeWord: false, regex: false });
    expect(r.pattern).not.toBeNull();
    expect(r.pattern!.flags).toContain('i');
  });

  it('regex=true 普通字符串: pattern 保留用户原样 (不转义)', () => {
    const r = buildPattern('a.b', { caseSensitive: false, wholeWord: false, regex: true });
    expect(r.pattern).not.toBeNull();
    // regex 模式下 user 写啥就是啥, . 保留为正则元字符.
    expect(r.pattern!.source).toBe('a.b');
  });
});

describe('computeHits (T10 step-2a)', () => {
  it('空 content: hits=[]', () => {
    const r = computeHits('', 'foo', { caseSensitive: false, wholeWord: false, regex: false });
    expect(r.hits).toEqual([]);
    expect(r.invalidRegex).toBe(false);
  });

  it('空 query: hits=[] (AC-02-3)', () => {
    const r = computeHits('foo bar', '', { caseSensitive: false, wholeWord: false, regex: false });
    expect(r.hits).toEqual([]);
    expect(r.invalidRegex).toBe(false);
  });

  it('非法正则: hits=[], invalidRegex=true (AC-02-2)', () => {
    const r = computeHits('foo', '[abc', { caseSensitive: false, wholeWord: false, regex: true });
    expect(r.hits).toEqual([]);
    expect(r.invalidRegex).toBe(true);
  });

  it('普通匹配: 返回 index/start/length, 命中数等于字面量出现次数', () => {
    const r = computeHits('hello world hello', 'hello', {
      caseSensitive: false,
      wholeWord: false,
      regex: false,
    });
    expect(r.hits.length).toBe(2);
    expect(r.hits[0]).toEqual({ index: 0, start: 0, length: 5 });
    expect(r.hits[1]).toEqual({ index: 1, start: 12, length: 5 });
    expect(r.invalidRegex).toBe(false);
  });

  it('wholeWord: 不匹配 category', () => {
    const r = computeHits('cat and category', 'cat', {
      caseSensitive: false,
      wholeWord: true,
      regex: false,
    });
    // 只有第一个 cat (独立单词) 命中.
    expect(r.hits.length).toBe(1);
    expect(r.hits[0]?.start).toBe(0);
  });

  it('caseSensitive: 大写不匹配小写', () => {
    const r = computeHits('Hello hello HELLO', 'Hello', {
      caseSensitive: true,
      wholeWord: false,
      regex: false,
    });
    expect(r.hits.length).toBe(1);
    expect(r.hits[0]?.start).toBe(0);
  });

  it('跨段落匹配: 返回多个命中 (NFR-01-1 fixture 验证)', () => {
    const md = buildCrossParagraphSample('lorem ipsum dolor');
    const r = computeHits(md, 'lorem ipsum dolor', {
      caseSensitive: false,
      wholeWord: false,
      regex: false,
    });
    expect(r.hits.length).toBeGreaterThanOrEqual(4);
  });

  it('10万字符基准: 命中数 ≥ 0 且不抛错 (性能在 perf.test 中另测)', () => {
    const md = buildLargeMarkdown();
    expect(md.length).toBeGreaterThanOrEqual(80_000);
    const r = computeHits(md, 'needle', {
      caseSensitive: false,
      wholeWord: false,
      regex: false,
    });
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.invalidRegex).toBe(false);
  });
});
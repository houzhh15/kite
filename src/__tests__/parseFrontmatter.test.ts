/**
 * src/__tests__/parseFrontmatter.test.ts — T26 (F-28) 解析器单元测试.
 *
 * 设计依据: docs/design/compiled.md §5.1 + 需求 FR-1 / FR-4 / FR-5.
 *
 * 覆盖 (UT-P-01 ~ UT-P-19):
 *   - 正常/异常路径、CRLF/BOM、block/flow 数组、嵌套对象、缺闭合、
 *     恶意值 XSS、重复 key、性能基准、empty frontmatter.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import {
  parseFrontmatter,
  FrontmatterParseError,
} from '../lib/frontmatter/parseFrontmatter';
import type { ParseFrontmatterResult } from '../lib/frontmatter/types';

describe('parseFrontmatter — T26 (F-28) YAML 子集解析器', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // UT-P-01
  it('UT-P-01: 解析标准 Obsidian frontmatter', () => {
    const raw = [
      '---',
      'title: 笔记标题',
      'tags: [a, b, c]',
      'source_count: 12',
      '---',
      '',
      '# 正文',
    ].join('\n');
    const r = parseFrontmatter(raw);
    expect(r.meta.title).toBe('笔记标题');
    expect(r.meta.tags).toEqual(['a', 'b', 'c']);
    expect(r.meta.source_count).toBe(12);
    expect(r.body).toContain('# 正文');
    expect(r.body).not.toContain('source_count: 12');
  });

  // UT-P-02 — 中文 tags
  it('UT-P-02: 中文 tags 流式数组', () => {
    const raw = ['---', 'tags: [随笔, 工具]', '---', '', '正文'].join('\n');
    const r = parseFrontmatter(raw);
    expect(r.meta.tags).toEqual(['随笔', '工具']);
  });

  // UT-P-03 — flow 数组含引号
  it('UT-P-03: flow 数组元素含双引号和单引号', () => {
    const raw = ['---', 'tags: ["a, b", \'c d\']', '---', '', '正文'].join('\n');
    const r = parseFrontmatter(raw);
    expect(r.meta.tags).toEqual(['a, b', 'c d']);
  });

  // UT-P-04 — block 数组
  it('UT-P-04: block 数组 (缩进条目)', () => {
    const raw = [
      '---',
      'tags:',
      '  - alpha',
      '  - beta',
      '  - gamma',
      '---',
      '',
      '正文',
    ].join('\n');
    const r = parseFrontmatter(raw);
    expect(r.meta.tags).toEqual(['alpha', 'beta', 'gamma']);
  });

  // UT-P-05 — 嵌套对象按字符串原样保留
  it('UT-P-05: 嵌套对象按字符串原样保留 (不递归解析)', () => {
    const raw = [
      '---',
      'cover: { url: https://x.com/a.png, alt: 演示 }',
      '---',
      '',
      '正文',
    ].join('\n');
    const r = parseFrontmatter(raw);
    const coverVal = r.meta.cover;
    expect(typeof coverVal).toBe('string');
    expect(String(coverVal)).toContain('{ url: https://x.com/a.png');
  });

  // UT-P-06 — 注释行
  it('UT-P-06: 跳过纯注释行', () => {
    const raw = ['---', '# 头注释', 'title: A', '# 尾注释', '---', '', 'B'].join('\n');
    const r = parseFrontmatter(raw);
    expect(r.meta.title).toBe('A');
    expect(Object.keys(r.meta)).toEqual(['title']);
  });

  // UT-P-07 — 双引号标量解析
  it('UT-P-07: 双引号包裹 + 转义', () => {
    const raw = ['---', 's: "a\\"b"', '---', '', 'x'].join('\n');
    const r = parseFrontmatter(raw);
    expect(r.meta.s).toBe('a"b');
  });

  // UT-P-08 — number 标量
  it('UT-P-08: number 标量解析 (含科学记数)', () => {
    const raw = ['---', 'n: 1.2e3', '---', '', 'x'].join('\n');
    const r = parseFrontmatter(raw);
    expect(r.meta.n).toBe(1200);
  });

  // UT-P-09 — bool 标量
  it('UT-P-09: bool 标量解析 (yes/no)', () => {
    const raw = ['---', 'b: yes', 'c: no', '---', '', 'x'].join('\n');
    const r = parseFrontmatter(raw);
    expect(r.meta.b).toBe(true);
    expect(r.meta.c).toBe(false);
  });

  // UT-P-10 — 空值不入 meta
  it('UT-P-10: 空值键不入 meta', () => {
    const raw = ['---', 'a: ', 'b: x', '---', '', 'y'].join('\n');
    const r = parseFrontmatter(raw);
    expect('a' in r.meta).toBe(false);
    expect(r.meta.b).toBe('x');
  });

  // UT-P-11 — 缺闭合
  it('UT-P-11: 缺闭合 --- 抛 FrontmatterParseError(no-closing-fence)', () => {
    const raw = ['---', 'title: x', '# 正文'].join('\n');
    expect(() => parseFrontmatter(raw)).toThrowError(FrontmatterParseError);
    try {
      parseFrontmatter(raw);
    } catch (err) {
      expect(err).toBeInstanceOf(FrontmatterParseError);
      expect((err as FrontmatterParseError).code).toBe('no-closing-fence');
    }
  });

  // UT-P-12 — 非 frontmatter 文档
  it('UT-P-12: 非 frontmatter 文档返回原 body, 不抛错', () => {
    const raw = '# 标题\n\n段落';
    const r: ParseFrontmatterResult = parseFrontmatter(raw);
    expect(r.meta).toEqual({});
    expect(r.body).toBe(raw);
  });

  // UT-P-13 — 空 frontmatter
  it('UT-P-13: 空 frontmatter (只有 --- ... --- 含空白)', () => {
    const raw = ['---', '', '---', '', '# 正文'].join('\n');
    const r = parseFrontmatter(raw);
    expect(r.meta).toEqual({});
    expect(r.body).toContain('# 正文');
  });

  // UT-P-14 — BOM 剥离
  it('UT-P-14: BOM 剥离后正常解析', () => {
    const raw = '\uFEFF---\ntitle: A\n---\n\n# 正文';
    const r = parseFrontmatter(raw);
    expect(r.meta.title).toBe('A');
  });

  // UT-P-15 — CRLF 行尾
  it('UT-P-15: CRLF 行尾正常解析', () => {
    const raw = '---\r\ntitle: A\r\n---\r\n\r\n# 正文';
    const r = parseFrontmatter(raw);
    expect(r.meta.title).toBe('A');
  });

  // UT-P-16 — 超大 frontmatter 保护
  it('UT-P-16: 超过 200 行的无闭合文档抛 no-closing-fence', () => {
    const lines = ['---', 'title: x'];
    for (let i = 0; i < 250; i++) lines.push(`dummy: ${i}`);
    const raw = lines.join('\n'); // 无闭合
    expect(() => parseFrontmatter(raw)).toThrowError(FrontmatterParseError);
  });

  // UT-P-17 — 恶意值原样保留
  it('UT-P-17: 恶意值 (XSS / 模板插值) 原样字符串保留', () => {
    const raw = [
      '---',
      'evil: <script>alert(1)</script>',
      'tmpl: {{evil}}',
      'env: ${process.env.X}',
      '---',
      '',
      'x',
    ].join('\n');
    const r = parseFrontmatter(raw);
    expect(r.meta.evil).toBe('<script>alert(1)</script>');
    expect(r.meta.tmpl).toBe('{{evil}}');
    expect(r.meta.env).toBe('${process.env.X}');
  });

  // UT-P-18 — 重复 key 后者覆盖
  it('UT-P-18: 重复 key 后者覆盖', () => {
    const raw = ['---', 'a: 1', 'a: 2', '---', '', 'x'].join('\n');
    const r = parseFrontmatter(raw);
    expect(r.meta.a).toBe(2);
  });

  // UT-P-19 — 性能基准
  it('UT-P-19: 1 KB frontmatter x 1000 次解析平均 < 1ms', () => {
    // 构造约 1KB 的有效 frontmatter
    const parts = ['---'];
    for (let i = 0; i < 30; i++) parts.push(`field_${i}: value_${i}_${'x'.repeat(20)}`);
    parts.push('tags: [a, b, c, d, e]');
    parts.push('count: 42');
    parts.push('---');
    parts.push('');
    parts.push('# 正文');
    const raw = parts.join('\n');

    // 预热
    for (let i = 0; i < 100; i++) parseFrontmatter(raw);

    const N = 1000;
    const start = performance.now();
    for (let i = 0; i < N; i++) parseFrontmatter(raw);
    const elapsed = performance.now() - start;
    const avg = elapsed / N;

    // 平均 < 1 ms (留 0.05ms 余量, 测试环境 jimp jitter)
    expect(avg).toBeLessThan(1.05);
  });
});

/**
 * slugify.test.ts — 锚点 id 生成 (契约 2 / AC-11-1..4).
 *
 * 设计依据: docs/design/compiled.md §3.3.2 + §3.8 契约 2.
 * 覆盖:
 *   - `Quick Start` → `quick-start` (AC-11-1)
 *   - `安装指南` → `安装指南` (NFKD 保留 unicode, AC-11-2)
 *   - 纯空白 / 纯标点 → `` (AC-11-3)
 *   - 1000 次 < 50 ms (AC-11-4)
 *   - 数字保留
 *   - 大写变小写
 *   - 连续空白折叠为单个 `-`
 */
import { describe, expect, it } from 'vitest';

import { slugify } from '../../../lib/inline/slugify';

describe('slugify — 契约 2', () => {
  it('Quick Start → quick-start (AC-11-1)', () => {
    expect(slugify('Quick Start')).toBe('quick-start');
  });

  it('安装指南 → 安装指南 (中文保留, AC-11-2)', () => {
    expect(slugify('安装指南')).toBe('安装指南');
  });

  it('Hello World!! → hello-world (标点去除)', () => {
    expect(slugify('Hello World!!')).toBe('hello-world');
  });

  it('纯空白 → ``', () => {
    expect(slugify('   ')).toBe('');
  });

  it('纯标点 → ``', () => {
    expect(slugify('!@#$%^&*()')).toBe('');
  });

  it('空字符串 → ``', () => {
    expect(slugify('')).toBe('');
  });

  it('数字保留', () => {
    expect(slugify('1000 个标题')).toBe('1000-个标题');
  });

  it('大写变小写', () => {
    expect(slugify('FooBar')).toBe('foobar');
  });

  it('混合中英文', () => {
    expect(slugify('Quick Start 安装')).toBe('quick-start-安装');
  });

  it('性能: 1000 次调用 < 50 ms (AC-11-4)', () => {
    const inputs: string[] = [];
    for (let i = 0; i < 1000; i++) {
      inputs.push(`Section ${i} 标题 ${i}`);
    }
    const start = Date.now();
    for (const s of inputs) slugify(s);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(50);
  });

  it('连字符 / 下划线保留', () => {
    // 内部 - 与 _ 保留
    expect(slugify('Quick-Start')).toBe('quick-start');
    expect(slugify('Quick_Start')).toBe('quick_start');
  });

  it('前后空格 trim 后折叠', () => {
    expect(slugify('  hello  world  ')).toBe('hello-world');
  });

  it('换行/制表折叠为 -', () => {
    expect(slugify('foo\nbar\tbaz')).toBe('foo-bar-baz');
  });
});
/**
 * src/__tests__/renderMeta.test.ts — T26 (F-28) renderMeta 单元测试.
 *
 * 设计依据: docs/design/compiled.md §5.2 (renderMeta) + AC-FR-2-* / AC-FR-3-*.
 */

import { describe, expect, it } from 'vitest';

import { renderMeta } from '../lib/frontmatter/renderMeta';
import type { FrontmatterMeta } from '../lib/frontmatter/types';

describe('renderMeta — T26 (F-28) meta → RenderRow[]', () => {
  it('AC-FR-2-1: title/tags/source_count 三行映射正确', () => {
    const meta: FrontmatterMeta = {
      title: '笔记',
      tags: ['a', 'b', 'c'],
      source_count: 12,
    };
    const rows = renderMeta(meta);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ key: 'title', icon: 'heading-1', display: '笔记' });
    expect(rows[1]).toMatchObject({
      key: 'tags',
      icon: 'tag',
      tags: ['a', 'b', 'c'],
    });
    // tags 行 display 未使用, 但若存在应是空.
    expect(rows[1].display).toBe('');
    expect(rows[2]).toMatchObject({ key: 'source_count', icon: 'hash', display: '12' });
  });

  it('AC-FR-2-2: categories 数组 join 空格斜杠空格', () => {
    const meta: FrontmatterMeta = { categories: ['随笔', '工具'] };
    const rows = renderMeta(meta);
    expect(rows[0]).toMatchObject({ key: 'categories', icon: 'folder', display: '随笔 / 工具' });
    expect(rows[0].tags).toBeUndefined();
  });

  it('AC-FR-2-3: 空 meta 返回 []', () => {
    expect(renderMeta({})).toEqual([]);
  });

  it('AC-FR-2-4: 嵌套对象键值保留原始字符串 (list 兜底)', () => {
    const meta: FrontmatterMeta = { cover: '{ url: x.png, alt: 演示 }' };
    const rows = renderMeta(meta);
    expect(rows[0]).toMatchObject({
      key: 'cover',
      icon: 'list',
      display: '{ url: x.png, alt: 演示 }',
    });
  });

  it('AC-FR-3-2: tags 空数组 → tags 行不入数组', () => {
    const meta: FrontmatterMeta = { title: 'x', tags: [] };
    const rows = renderMeta(meta);
    // 只有 title 一行.
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe('title');
  });

  it('AC-FR-3-3: tags 是字符串 → 普通单值 (不拆 chip)', () => {
    const meta: FrontmatterMeta = { tags: 'a, b, c' };
    const rows = renderMeta(meta);
    // tags='a, b, c' 是字符串, 非数组 → 走 list 兜底, display 显示.
    expect(rows[0]).toMatchObject({ key: 'tags', icon: 'list', display: 'a, b, c' });
    expect(rows[0].tags).toBeUndefined();
  });

  it('未知 key 走 list 兜底 (新增字段无需修改渲染)', () => {
    const meta: FrontmatterMeta = { totally_new: 42 };
    const rows = renderMeta(meta);
    expect(rows[0]).toMatchObject({ key: 'totally_new', icon: 'list', display: '42' });
  });

  it('布尔与 null 值格式化', () => {
    const meta: FrontmatterMeta = { published: true, draft: null };
    const rows = renderMeta(meta);
    const map = new Map(rows.map((r) => [r.key, r]));
    expect(map.get('published')?.display).toBe('true');
    // null 折叠: 不入行
    expect(map.has('draft')).toBe(false);
  });

  it('aliases → folder (与 categories 同 icon)', () => {
    const meta: FrontmatterMeta = { aliases: ['foo'] };
    const rows = renderMeta(meta);
    expect(rows[0]).toMatchObject({ key: 'aliases', icon: 'folder' });
  });

  it('id / hash 走 hash icon', () => {
    const meta: FrontmatterMeta = { id: 'abc', hash: '0x1' };
    const rows = renderMeta(meta);
    expect(rows[0]?.icon).toBe('hash');
    expect(rows[1]?.icon).toBe('hash');
  });
});

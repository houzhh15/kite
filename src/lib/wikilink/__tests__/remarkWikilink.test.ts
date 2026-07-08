/**
 * remarkWikilink 单测 — T28 / F-46 / FR-01 / AC-01-1..4.
 *
 * 设计依据: docs/design/compiled.md §3.1.2 + §3.6.1.
 *
 * 覆盖:
 *   - 4 种基础语法 (AC-01-1/2): [[t]] / [[t|a]] / [[t#h]] / [[t#h|a]]
 *   - 异常: [[]] / [[|alias]] / [[invalid:colon]] / [[../escape]] 保留原文 (AC-01-3/4)
 *   - 边界: 嵌入行内代码 / 嵌入围栏代码块 / 同一 text 多个 wikilink / 空 Root
 *   - 切分算法不依赖 parseWikilink 内部 (通过 options.parse 注入 mock parser)
 */
import { describe, it, expect, vi } from 'vitest';
import type { Root, Text, PhrasingContent } from 'mdast';
import { remarkWikilink } from '../remarkWikilink';

/** 构造单 text 节点的 mdast. */
function rootWithText(value: string): Root {
  return {
    type: 'root',
    children: [
      {
        type: 'paragraph',
        children: [{ type: 'text', value }],
      },
    ],
  };
}

/** 从 tree 提取 paragraph children (flatten). */
function flatChildren(tree: Root): PhrasingContent[] {
  return tree.children.flatMap((c) => {
    if ('children' in c && Array.isArray((c as { children: unknown[] }).children)) {
      return (c as { children: PhrasingContent[] }).children;
    }
    return [];
  });
}

/** 找到第一个 wikilink 节点. */
function findWikilink(tree: Root) {
  const segs = flatChildren(tree);
  const found = segs.find((s) => (s as { type: string }).type === 'wikilink');
  if (!found) return undefined;
  const wn = found as unknown as {
    type: 'wikilink';
    data?: {
      hProperties?: Record<string, string | undefined>;
    };
    children: PhrasingContent[];
  };
  return wn;
}

describe('remarkWikilink (T28 / FR-01 / AC-01-1..4)', () => {
  describe('基础 4 种语法 (AC-01-1/2)', () => {
    it('AC-01-1: [[target]] 改写为 wikilink 节点', () => {
      const tree = rootWithText('visit me [[wiki/sources/foo]] now');
      remarkWikilink()(tree);
      const segs = flatChildren(tree);
      // 前缀 text + wikilink + 后缀 text
      expect(segs.length).toBe(3);
      expect(segs[0]).toMatchObject({ type: 'text', value: 'visit me ' });
      const wn = segs[1] as {
        type: 'wikilink';
        data: { hName: string; hProperties: Record<string, string> };
        children: PhrasingContent[];
      };
      expect(wn.type).toBe('wikilink');
      expect(wn.data.hName).toBe('span');
      expect(wn.data.hProperties['data-wikilink']).toBe('wiki/sources/foo');
      expect(wn.data.hProperties['data-anchor']).toBeUndefined();
      expect(wn.data.hProperties['data-alias']).toBeUndefined();
      expect((wn.children[0] as Text).value).toBe('wiki/sources/foo');
      expect(segs[2]).toMatchObject({ type: 'text', value: ' now' });
    });

    it('AC-01-2: [[target|alias]] data.alias 设置 + children 为 alias', () => {
      const tree = rootWithText('see [[foo|the foo]] here');
      remarkWikilink()(tree);
      const wn = findWikilink(tree);
      expect(wn).toBeDefined();
      expect(wn?.data?.hProperties?.['data-wikilink']).toBe('foo');
      expect(wn?.data?.hProperties?.['data-alias']).toBe('the foo');
      expect((wn?.children[0] as Text).value).toBe('the foo');
    });

    it('AC-01-1/2: [[target#heading|别名]] data.target + data.anchor + data.alias', () => {
      const tree = rootWithText('jump [[foo#heading|别名]] now');
      remarkWikilink()(tree);
      const wn = findWikilink(tree);
      expect(wn).toBeDefined();
      expect(wn?.data?.hProperties?.['data-wikilink']).toBe('foo');
      expect(wn?.data?.hProperties?.['data-anchor']).toBe('heading');
      expect(wn?.data?.hProperties?.['data-alias']).toBe('别名');
      expect((wn?.children[0] as Text).value).toBe('别名');
    });

    it('AC-01-1: [[target#anchor]] children 为 target (无 alias)', () => {
      const tree = rootWithText('see [[foo#第一章]] page');
      remarkWikilink()(tree);
      const wn = findWikilink(tree);
      expect(wn?.data?.hProperties?.['data-wikilink']).toBe('foo');
      expect(wn?.data?.hProperties?.['data-anchor']).toBe('第一章');
      expect(wn?.data?.hProperties?.['data-alias']).toBeUndefined();
      expect((wn?.children[0] as Text).value).toBe('foo');
    });
  });

  describe('异常路径 (AC-01-3/4)', () => {
    it('AC-01-3: [[]] 保留原文不抛错', () => {
      const tree = rootWithText('see [[]] here');
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      remarkWikilink()(tree);
      const segs = flatChildren(tree);
      // 不应改写; 整段仍为 text
      expect(segs.length).toBe(1);
      expect((segs[0] as Text).value).toBe('see [[]] here');
      expect(errSpy).not.toHaveBeenCalled();
      errSpy.mockRestore();
    });

    it('AC-01-3: [[|alias]] 保留原文不抛错', () => {
      const tree = rootWithText('see [[|alias]] here');
      remarkWikilink()(tree);
      const segs = flatChildren(tree);
      const wikilinks = segs.filter((s) => s.type === 'wikilink');
      expect(wikilinks.length).toBe(0);
      const joined = segs.map((s) => ('value' in s ? s.value : '')).join('');
      expect(joined).toBe('see [[|alias]] here');
    });

    it('AC-01-3: [[invalid:colon]] 保留原文 (parseWikilink 拒绝冒号)', () => {
      const tree = rootWithText('see [[invalid:colon]] here');
      remarkWikilink()(tree);
      const segs = flatChildren(tree);
      const wikilinks = segs.filter((s) => s.type === 'wikilink');
      expect(wikilinks.length).toBe(0);
      const joined = segs.map((s) => ('value' in s ? s.value : '')).join('');
      expect(joined).toBe('see [[invalid:colon]] here');
    });

    it('AC-01-4: [[../escape]] 仍被改写 (解析层不阻拦, resolveWikilinkTarget 拦截)', () => {
      const tree = rootWithText('see [[../escape]] here');
      remarkWikilink()(tree);
      const wn = findWikilink(tree);
      expect(wn).toBeDefined();
      expect(wn?.data?.hProperties?.['data-wikilink']).toBe('../escape');
    });
  });

  describe('边界', () => {
    it('嵌入行内代码 `[[x]]` 不被切分', () => {
      const tree: Root = {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [
              { type: 'inlineCode', value: '[[x]]' },
              { type: 'text', value: ' real [[y]] ' },
            ],
          },
        ],
      };
      remarkWikilink()(tree);
      const para = tree.children[0] as { children: PhrasingContent[] };
      // inlineCode 不变; text 被切分为 [prefix-empty, wikilink, suffix]
      const wn = para.children.find((c) => c.type === 'wikilink');
      expect(wn).toBeDefined();
      expect((wn as { data: { hProperties: Record<string, string> } }).data.hProperties['data-wikilink']).toBe('y');
    });

    it('围栏代码块 (code 节点) 内 [[x]] 不被切分', () => {
      const tree: Root = {
        type: 'root',
        children: [
          {
            type: 'code',
            lang: 'markdown',
            value: '[[x]] [[y]]',
          } as unknown as PhrasingContent,
          {
            type: 'paragraph',
            children: [{ type: 'text', value: 'real [[z]] end' }],
          },
        ],
      };
      remarkWikilink()(tree);
      const codeBlock = tree.children[0] as { value: string };
      expect(codeBlock.value).toBe('[[x]] [[y]]'); // 完全不变
      const para = tree.children[1] as { children: PhrasingContent[] };
      const wn = para.children.find((c) => c.type === 'wikilink');
      expect(wn).toBeDefined();
    });

    it('同一 text 节点中两个 wikilink 都被切分', () => {
      const tree = rootWithText('a [[one]] b [[two|dos]] c');
      remarkWikilink()(tree);
      const segs = flatChildren(tree);
      const wikilinks = segs.filter((s) => s.type === 'wikilink');
      expect(wikilinks.length).toBe(2);
      expect(
        (wikilinks[0] as { data: { hProperties: Record<string, string> } }).data.hProperties[
          'data-wikilink'
        ],
      ).toBe('one');
      expect(
        (wikilinks[1] as { data: { hProperties: Record<string, string> } }).data.hProperties[
          'data-wikilink'
        ],
      ).toBe('two');
      expect(
        (wikilinks[1] as { data: { hProperties: Record<string, string> } }).data.hProperties[
          'data-alias'
        ],
      ).toBe('dos');
    });

    it('空 Root 不报错', () => {
      const tree: Root = { type: 'root', children: [] };
      expect(() => remarkWikilink()(tree)).not.toThrow();
      expect(tree.children.length).toBe(0);
    });

    it('无 wikilink 的纯文本不变', () => {
      const tree = rootWithText('plain text only');
      remarkWikilink()(tree);
      const segs = flatChildren(tree);
      expect(segs.length).toBe(1);
      expect((segs[0] as Text).value).toBe('plain text only');
    });
  });

  describe('options.parse 注入 (测试隔离)', () => {
    it('自定义 parser 可被调用且不依赖默认 parseWikilink', () => {
      const customParse = vi.fn((raw: string) => ({
        target: raw.toUpperCase(),
        alias: 'X',
      }));
      const tree = rootWithText('see [[a]] here');
      remarkWikilink({ parse: customParse })(tree);
      expect(customParse).toHaveBeenCalledWith('[[a]]');
      const wn = findWikilink(tree);
      expect(wn?.data?.hProperties?.['data-wikilink']).toBe('[[A]]');
      expect(wn?.data?.hProperties?.['data-alias']).toBe('X');
    });

    it('自定义 parser 返回 null 时保留原文', () => {
      const customParse = vi.fn(() => null);
      const tree = rootWithText('see [[any]] here');
      remarkWikilink({ parse: customParse })(tree);
      const segs = flatChildren(tree);
      const wikilinks = segs.filter((s) => s.type === 'wikilink');
      expect(wikilinks.length).toBe(0);
      const joined = segs.map((s) => ('value' in s ? s.value : '')).join('');
      expect(joined).toBe('see [[any]] here');
    });
  });
});
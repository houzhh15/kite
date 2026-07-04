/**
 * remarkInlineMarks.test.ts — 自研 remark 插件 (契约 3 / AC-04 / AC-05).
 *
 * 设计依据: docs/design/compiled.md §3.2 + §3.8 契约 3.
 * 覆盖:
 *   - highlight + '==key==' → mark 节点 (AC-04-1)
 *   - highlight off + '==key==' → text 节点 (AC-04-2)
 *   - '== unmatched' → text 节点, 无 mark (AC-04-3)
 *   - subSup + 'H~2~O' → sub 节点 (AC-05-1)
 *   - subSup + 'x^2^' → sup 节点 (AC-05-2)
 *   - 'H~2 O~' (含空白) → text 节点, 无 sub (AC-05-3)
 *   - subSup off + 'H~2~O' → text 节点 (AC-05-4)
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';

import { remarkInlineMarks } from '../../../lib/inline/remarkInlineMarks';
import { resetFlags, setFlags } from '../../../lib/featureFlags';

function parse(md: string) {
  const processor = unified().use(remarkParse).use(remarkInlineMarks);
  return processor.runSync(processor.parse(md));
}

function findTextNodes(tree: unknown): Array<{ value: string; type: string }> {
  const out: Array<{ value: string; type: string }> = [];
  function getValue(n: { value?: string; children?: unknown[] }): string {
    if (typeof n.value === 'string') return n.value;
    if (Array.isArray(n.children)) {
      return (n.children as Array<{ value?: string; children?: unknown[] }>)
        .map((c) => getValue(c))
        .join('');
    }
    return '';
  }
  function walk(n: unknown): void {
    if (!n || typeof n !== 'object') return;
    const node = n as { type?: string; value?: string; children?: unknown[] };
    if (node.type === 'text' || node.type === 'mark' || node.type === 'sub' || node.type === 'sup') {
      out.push({ type: node.type, value: getValue(node) });
    }
    if (Array.isArray(node.children)) {
      for (const c of node.children) walk(c);
    }
  }
  walk(tree);
  return out;
}

beforeEach(() => {
  resetFlags();
});

describe('remarkInlineMarks — 契约 3', () => {
  it('highlight on + ==key== → mark 节点 (AC-04-1)', () => {
    setFlags({ highlight: true, subSup: false });
    const nodes = findTextNodes(parse('hello ==world== there'));
    const marks = nodes.filter((n) => n.type === 'mark');
    expect(marks.length).toBeGreaterThanOrEqual(1);
    expect(marks[0]?.value).toBe('world');
  });

  it('highlight off + ==key== → 文本保持原样 (AC-04-2)', () => {
    setFlags({ highlight: false, subSup: false });
    const nodes = findTextNodes(parse('hello ==world== there'));
    const marks = nodes.filter((n) => n.type === 'mark');
    expect(marks.length).toBe(0);
    // 原字符串被保留
    const allText = nodes.map((n) => n.value).join('');
    expect(allText).toContain('==world==');
  });

  it('未闭合 == unmatched → 无 mark 节点 (AC-04-3)', () => {
    setFlags({ highlight: true, subSup: false });
    const nodes = findTextNodes(parse('hello == unmatched'));
    const marks = nodes.filter((n) => n.type === 'mark');
    expect(marks.length).toBe(0);
    const allText = nodes.map((n) => n.value).join('');
    expect(allText).toContain('== unmatched');
  });

  it('subSup on + H~2~O → sub 节点 (AC-05-1)', () => {
    setFlags({ highlight: false, subSup: true });
    const nodes = findTextNodes(parse('H~2~O'));
    const subs = nodes.filter((n) => n.type === 'sub');
    expect(subs.length).toBeGreaterThanOrEqual(1);
    expect(subs[0]?.value).toBe('2');
  });

  it('subSup on + x^2^ → sup 节点 (AC-05-2)', () => {
    setFlags({ highlight: false, subSup: true });
    const nodes = findTextNodes(parse('x^2^'));
    const sups = nodes.filter((n) => n.type === 'sup');
    expect(sups.length).toBeGreaterThanOrEqual(1);
    expect(sups[0]?.value).toBe('2');
  });

  it('subSup on + H~2 O~ (含空白) → 无 sub 节点 (AC-05-3)', () => {
    setFlags({ highlight: false, subSup: true });
    const nodes = findTextNodes(parse('H~2 O~'));
    const subs = nodes.filter((n) => n.type === 'sub');
    expect(subs.length).toBe(0);
    const allText = nodes.map((n) => n.value).join('');
    expect(allText).toContain('H~2 O~');
  });

  it('subSup off + H~2~O → 字面文本 (AC-05-4)', () => {
    setFlags({ highlight: false, subSup: false });
    const nodes = findTextNodes(parse('H~2~O'));
    const subs = nodes.filter((n) => n.type === 'sub');
    const sups = nodes.filter((n) => n.type === 'sup');
    expect(subs.length).toBe(0);
    expect(sups.length).toBe(0);
    const allText = nodes.map((n) => n.value).join('');
    expect(allText).toContain('H~2~O');
  });

  it('sub 节点不能为空', () => {
    setFlags({ highlight: false, subSup: true });
    const nodes = findTextNodes(parse('a~~b'));
    const subs = nodes.filter((n) => n.type === 'sub' && n.value === '');
    expect(subs.length).toBe(0);
  });

  it('同时启用 highlight + subSup 时同段落共存', () => {
    setFlags({ highlight: true, subSup: true });
    const nodes = findTextNodes(parse('==k== and H~2~O and x^3^'));
    expect(nodes.filter((n) => n.type === 'mark').length).toBeGreaterThanOrEqual(1);
    expect(nodes.filter((n) => n.type === 'sub').length).toBeGreaterThanOrEqual(1);
    expect(nodes.filter((n) => n.type === 'sup').length).toBeGreaterThanOrEqual(1);
  });
});
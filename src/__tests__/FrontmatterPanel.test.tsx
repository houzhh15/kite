/**
 * src/__tests__/FrontmatterPanel.test.tsx — T26 (F-28) 面板组件单元测试.
 *
 * 设计依据: docs/design/compiled.md §5.2 + 需求 AC-FR-2-* / AC-FR-3-*.
 */

import { describe, expect, it, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';

import i18n from '../i18n';
import FrontmatterPanel from '../components/FrontmatterPanel';
import type { RenderRow } from '../lib/frontmatter/types';

function wrap(node: JSX.Element): JSX.Element {
  return <I18nextProvider i18n={i18n}>{node}</I18nextProvider>;
}

describe('FrontmatterPanel — T26 (F-28) 面板组件', () => {
  afterEach(() => {
    cleanup();
  });

  it('UT-F-01: rows 空数组不挂 DOM', () => {
    const { container } = render(wrap(<FrontmatterPanel rows={[]} />));
    expect(container.querySelector('[data-testid="frontmatter-panel"]')).toBeNull();
  });

  it('UT-F-02: 3 行渲染 (title/tags/source_count)', () => {
    const rows: RenderRow[] = [
      { key: 'title', icon: 'heading-1', display: '笔记标题' },
      { key: 'tags', icon: 'tag', display: '', tags: ['a', 'b', 'c'] },
      { key: 'source_count', icon: 'hash', display: '12' },
    ];
    const { container } = render(wrap(<FrontmatterPanel rows={rows} />));
    expect(container.querySelector('[data-testid="frontmatter-panel"]')).toBeTruthy();
    const rowEls = container.querySelectorAll('.frontmatter-row');
    expect(rowEls.length).toBe(3);
  });

  it('UT-F-03: tags 行 chip 数 === tags.length, 含 aria-hidden × 元素', () => {
    const rows: RenderRow[] = [
      { key: 'tags', icon: 'tag', display: '', tags: ['a', 'b', 'c'] },
    ];
    const { container } = render(wrap(<FrontmatterPanel rows={rows} />));
    const chips = container.querySelectorAll('.frontmatter-chip');
    expect(chips.length).toBe(3);
    for (const chip of Array.from(chips)) {
      const close = chip.querySelector('.frontmatter-chip-close');
      expect(close?.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('UT-F-04: 空 tags 数组 → chip 数 = 0', () => {
    const rows: RenderRow[] = [
      { key: 'tags', icon: 'tag', display: '', tags: [] },
    ];
    const { container } = render(wrap(<FrontmatterPanel rows={rows} />));
    const chips = container.querySelectorAll('.frontmatter-chip');
    expect(chips.length).toBe(0);
  });

  it('UT-F-05: tags 字符串 → 普通单值, 无 chip', () => {
    const rows: RenderRow[] = [
      { key: 'tags', icon: 'list', display: 'a, b, c' },
    ];
    const { container } = render(wrap(<FrontmatterPanel rows={rows} />));
    expect(container.querySelectorAll('.frontmatter-chip').length).toBe(0);
    const valueEl = container.querySelector('.frontmatter-value');
    expect(valueEl?.textContent).toContain('a, b, c');
  });

  it('UT-F-06: dt 节点含 kite-muted 类', () => {
    const rows: RenderRow[] = [
      { key: 'title', icon: 'heading-1', display: '笔记' },
    ];
    const { container } = render(wrap(<FrontmatterPanel rows={rows} />));
    const dt = container.querySelector('dt.frontmatter-key');
    expect(dt).toBeTruthy();
    expect(dt?.classList.contains('kite-muted')).toBe(true);
  });

  it('UT-F-07: i18n 标题走 zh-CN t(frontmatter.title) = "笔记属性"', () => {
    const rows: RenderRow[] = [
      { key: 'title', icon: 'heading-1', display: '笔记' },
    ];
    const { container } = render(wrap(<FrontmatterPanel rows={rows} />));
    const title = container.querySelector('.frontmatter-title');
    expect(title?.textContent).toBe('笔记属性');
  });

  it('UT-F-08: 同一 rows 引用不引发多余 DOM, × 元素无 role=button', () => {
    const rows: RenderRow[] = [
      { key: 'title', icon: 'heading-1', display: '笔记' },
    ];
    const { container, rerender } = render(wrap(<FrontmatterPanel rows={rows} />));
    rerender(wrap(<FrontmatterPanel rows={rows} />));
    expect(container.querySelectorAll('.frontmatter-row').length).toBe(1);
    const closeEls = container.querySelectorAll('.frontmatter-chip-close');
    for (const el of Array.from(closeEls)) {
      expect(el.getAttribute('role')).not.toBe('button');
    }
  });
});

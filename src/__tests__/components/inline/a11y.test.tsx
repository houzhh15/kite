/**
 * a11y.test.tsx — T07 行内可达性 / Tab 顺序 / 焦点环 / 语义节点 (AC-15 / NFR-A).
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import MarkdownRenderer from '../../../components/MarkdownRenderer';

describe('a11y — 行内可达性 (AC-15)', () => {
  it('链接默认 tabindex=0 (AC-15-1)', () => {
    const { container } = render(
      <MarkdownRenderer content="[a](https://a.com) [b](https://b.com)" />,
    );
    const links = container.querySelectorAll('a');
    expect(links.length).toBe(2);
    // 默认 anchor 不带 tabindex 属性, 浏览器视为 tabindex=0 (可聚焦).
    links.forEach((a) => {
      const tabindex = a.getAttribute('tabindex');
      expect(tabindex === null || Number(tabindex) >= 0).toBe(true);
    });
  });

  it('行内 <code> 不进入 Tab 序列 (AC-15-3)', () => {
    const { container } = render(<MarkdownRenderer content="text `code` more" />);
    const codes = container.querySelectorAll('code');
    codes.forEach((c) => {
      const tabindex = c.getAttribute('tabindex');
      // tabindex 未设或 < 0 表示不可 Tab 进入.
      expect(tabindex === null || Number(tabindex) < 0).toBe(true);
    });
  });

  it('链接带 rel="noopener noreferrer" (AC-14-5 / NFR-S-03)', () => {
    const { container } = render(
      <MarkdownRenderer content="[ext](https://example.com)" />,
    );
    const a = container.querySelector('a');
    const rel = a?.getAttribute('rel') ?? '';
    expect(rel).toContain('noopener');
    expect(rel).toContain('noreferrer');
  });

  it('链接带 target="_blank" (外链)', () => {
    const { container } = render(
      <MarkdownRenderer content="[ext](https://example.com)" />,
    );
    const a = container.querySelector('a');
    expect(a?.getAttribute('target')).toBe('_blank');
  });
});
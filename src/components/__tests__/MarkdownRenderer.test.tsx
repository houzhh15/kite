import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import MarkdownRenderer from '../MarkdownRenderer';

describe('MarkdownRenderer', () => {
  it('renders GFM tables (AC-04-1)', () => {
    const md = `| A | B |
| --- | --- |
| 1 | 2 |`;
    const { container } = render(<MarkdownRenderer content={md} />);
    expect(container.querySelector('table')).not.toBeNull();
    expect(container.querySelectorAll('tr').length).toBeGreaterThanOrEqual(2);
  });

  it('renders GFM task lists with disabled checkboxes (AC-04-1)', () => {
    const md = `- [x] done
- [ ] todo`;
    const { container } = render(<MarkdownRenderer content={md} />);
    const boxes = container.querySelectorAll('input[type="checkbox"]');
    expect(boxes.length).toBeGreaterThanOrEqual(2);
    expect((boxes[0] as HTMLInputElement).checked).toBe(true);
    expect((boxes[1] as HTMLInputElement).checked).toBe(false);
    // html 规范: react-markdown 强制 disabled 防用户切换.
    expect((boxes[0] as HTMLInputElement).disabled).toBe(true);
  });

  it('escapes <script> so it never enters DOM (AC-04-2 / F-32)', () => {
    const md = "hi <script>alert('xss')</script> there";
    const { container, getByText } = render(<MarkdownRenderer content={md} />);
    expect(container.querySelector('script')).toBeNull();
    // 文本节点必须包含原始 alert 字符串 (说明它是纯文本输出).
    expect(getByText(/alert\('xss'\)/)).toBeTruthy();
  });

  it('renders strikethrough with <s> / <del>', () => {
    const md = '~~deleted~~';
    const { container } = render(<MarkdownRenderer content={md} />);
    const struck = container.querySelector('s, del');
    expect(struck).not.toBeNull();
    expect(struck?.textContent).toBe('deleted');
  });

  it('renders autolinks as anchor tags', () => {
    const md = 'visit https://example.com please';
    const { container } = render(<MarkdownRenderer content={md} />);
    const a = container.querySelector('a[href="https://example.com"]');
    expect(a).not.toBeNull();
  });
});

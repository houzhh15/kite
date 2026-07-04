/**
 * with-script.spec.ts — T07 AC-14-1 自动化.
 *
 * 渲染 samples/with-script.md 等价内容, 断言 DOM 中 <script> 元素数 = 0.
 *
 * 不依赖 fs/path; fixture 字符串内联, 满足 check-contract.
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import MarkdownRenderer from '../../components/MarkdownRenderer';

const WITH_SCRIPT_FIXTURE = [
  '# XSS smoke test',
  '',
  'The following line must NOT execute in the rendered DOM:',
  '',
  "<script>alert('xss')</script>",
  '',
  'It should appear as plain text in the rendered article.',
  '',
  'Inline `code <script>x</script>` should also remain inert.',
  '',
].join('\n');

describe('AC-14-1: <script> 字面输出不进入 DOM', () => {
  it('渲染 with-script.md → 无 <script> 元素', () => {
    const { container } = render(<MarkdownRenderer content={WITH_SCRIPT_FIXTURE} />);
    const scripts = container.querySelectorAll('script');
    expect(scripts.length).toBe(0);
  });

  it('行内 code 内 <script> 仍以字面文本呈现', () => {
    const { container, getByText } = render(<MarkdownRenderer content={WITH_SCRIPT_FIXTURE} />);
    expect(container.querySelector('script')).toBeNull();
    // 行内 code 文本应保留 '<script>' 字面
    expect(getByText(/<script>x<\/script>/)).toBeTruthy();
  });

  it('alert 字符串以纯文本形式出现', () => {
    const { container, getByText } = render(<MarkdownRenderer content={WITH_SCRIPT_FIXTURE} />);
    expect(container.querySelector('script')).toBeNull();
    expect(getByText(/alert\('xss'\)/)).toBeTruthy();
  });
});
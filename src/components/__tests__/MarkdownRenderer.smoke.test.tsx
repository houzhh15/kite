/**
 * AC-04-2 验证: 模拟 samples/with-script.md 内容, 渲染后 DOM 中
 * 不出现 <script> 元素, 且 alert 字符串以文本节点呈现.
 *
 * 注意: 此文件**不** import node:fs, 直接把 fixture 内容内联,
 *       满足 check-contract.mjs 与 eslint no-restricted-imports.
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import MarkdownRenderer from '../MarkdownRenderer';

// 与 samples/with-script.md 完全一致 (节点测试可独立运行, 无 Node 依赖).
const WITH_SCRIPT_FIXTURE = [
  '# XSS smoke test',
  '',
  "The following line must NOT execute in the rendered DOM:",
  '',
  "<script>alert('xss')</script>",
  '',
  'It should appear as plain text in the rendered article.',
  '',
  'Inline `code <script>x</script>` should also remain inert.',
  '',
].join('\n');

describe('AC-04-2 fixture verification (with-script.md content)', () => {
  it('renders <script> string as text, no DOM <script> element', () => {
    expect(WITH_SCRIPT_FIXTURE).toContain("<script>alert('xss')</script>");

    const { container, getByText } = render(<MarkdownRenderer content={WITH_SCRIPT_FIXTURE} />);

    // AC-04-2 核心断言: DOM 中**不**存在 <script> 元素.
    expect(container.querySelector('script')).toBeNull();

    // 文本节点包含 alert 字符串 (说明它作为纯文本呈现).
    expect(getByText(/alert\('xss'\)/)).toBeTruthy();
  });
});
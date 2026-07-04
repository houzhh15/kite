/**
 * InlineCode.test.tsx — 行内/块级 code 分支 (FR-03 / AC-03-1/2/3).
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import InlineCode from '../../../components/inline/InlineCode';

describe('InlineCode — 行内/块级分支', () => {
  it('行内: 默认渲染 <code class="kite-code">', () => {
    const { container } = render(<InlineCode>foo()</InlineCode>);
    const code = container.querySelector('code');
    expect(code).not.toBeNull();
    expect(code?.className).toContain('kite-code');
    expect(code?.className).not.toContain('language-');
  });

  it('块级: 含 language- className 时透传, 不加 kite-code', () => {
    const { container } = render(
      <InlineCode className="language-ts">const x = 1;</InlineCode>,
    );
    const code = container.querySelector('code');
    expect(code).not.toBeNull();
    expect(code?.className).toContain('language-ts');
    expect(code?.className).not.toContain('kite-code');
  });

  it('块级: language-python 等任意 language- 都透传', () => {
    const { container } = render(
      <InlineCode className="language-python">print(1)</InlineCode>,
    );
    const code = container.querySelector('code');
    expect(code?.className).toContain('language-python');
  });

  it('保留 children 文本不被 HTML 解析', () => {
    const { container, getByText } = render(<InlineCode>{'<script>'}</InlineCode>);
    expect(container.querySelector('script')).toBeNull();
    expect(getByText('<script>')).toBeTruthy();
  });
});
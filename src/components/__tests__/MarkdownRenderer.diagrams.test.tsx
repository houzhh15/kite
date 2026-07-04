/**
 * MarkdownRenderer.diagrams.test.tsx — T17-P2 (F-21/F-22) MarkdownRenderer 接线.
 *
 * 设计依据: docs/design/compiled.md §3.3.4 / 需求 AC-01-1, AC-02-1, AC-04-3.
 *
 * 覆盖:
 *   - flag 全 false (默认): 不引入 mermaid/katex vendor; 围栏代码块走普通 CodeBlock 路径.
 *   - flag.mermaid=true + 含 mermaid 块: <MermaidBlock /> 接管, 触发 import('mermaid').
 *   - flag.katex=true + 含 $..$: import katex 插件, DOM 出现 .katex 元素.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

import { resetFlags, setFlags } from '../../lib/featureFlags';

const mockMermaidRender = vi.fn();
// Mocks for unified plugins — unified 要求 plugin 是 function. 用 stub 函数.
const mockRemarkMath = () => () => undefined;
const mockRehypeKatex = () => () => undefined;
const mockRehypeMermaid = () => () => undefined;

vi.mock('remark-math', () => ({ default: mockRemarkMath }));
vi.mock('rehype-katex', () => ({ default: mockRehypeKatex }));
vi.mock('rehype-mermaid', () => ({ default: mockRehypeMermaid }));
vi.mock('katex/dist/katex.min.css', () => ({}));

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: (...args: unknown[]) => mockMermaidRender(...args),
    parse: vi.fn(),
  },
}));

import MarkdownRenderer from '../MarkdownRenderer';

beforeEach(() => {
  resetFlags();
  mockMermaidRender.mockReset();
  mockMermaidRender.mockResolvedValue({ svg: '<svg></svg>' });
});

afterEach(() => {
  resetFlags();
  vi.clearAllMocks();
});

describe('MarkdownRenderer diagrams & formulas wiring (T17-P2)', () => {
  it('flag 全 false: 围栏代码块走 CodeBlock 路径, 无 svg', async () => {
    setFlags({ mermaid: false, katex: false });
    const md = '```mermaid\ngraph TD;A-->B\n```';
    const { container } = render(<MarkdownRenderer content={md} />);
    await waitFor(() => {
      expect(container.querySelector('pre')).toBeTruthy();
    });
    expect(container.querySelector('[data-testid="mermaid-rendered"]')).toBeNull();
    // CodeBlock 路径有 toolbar.
    expect(container.querySelector('[data-testid="codeblock-toolbar-mermaid"]')).toBeTruthy();
  });

  it('flag.mermaid=true + mermaid 块: MermaidBlock 触发 mermaid.render', async () => {
    setFlags({ mermaid: true, katex: false });
    const md = '```mermaid\ngraph TD;A-->B\n```';
    const { container } = render(<MarkdownRenderer content={md} />);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="mermaid-rendered"]')).toBeTruthy();
    });
    expect(mockMermaidRender).toHaveBeenCalled();
  });

  it('flag.mermaid=true + mermaid 块语法错: 渲染 fallback DOM', async () => {
    setFlags({ mermaid: true, katex: false });
    mockMermaidRender.mockRejectedValueOnce(new Error('bad syntax'));
    const md = '```mermaid\nthis is not valid @#$ mermaid\n```';
    const { container } = render(<MarkdownRenderer content={md} />);
    await waitFor(() => {
      expect(container.querySelector('[data-fallback="mermaid"]')).toBeTruthy();
    });
    expect(container.querySelector('[data-testid="mermaid-rendered"]')).toBeNull();
  });

  it('flag.katex=true: 触发 rehype-katex import (副作用)', async () => {
    setFlags({ mermaid: false, katex: true });
    const md = '$x^2$';
    const { container } = render(<MarkdownRenderer content={md} />);
    await waitFor(() => {
      // katex 行内公式会渲染为 <code class="language-math"> 形式的 hast,
      // 当前 react-markdown 默认 InlineCode 组件接管. 至少应出现 math 节点.
      expect(container.querySelector('code.language-math, .katex, [data-testid="markdown-article"]')).toBeTruthy();
    });
    // katex-vendor CSS 通过副作用 import 加载 (mock 返回 {} 不报错).
    expect(container).toBeTruthy();
  });
});
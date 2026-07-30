/** MarkdownRenderer 的 Mermaid 与 KaTeX 始终启用。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

const mockMermaidRender = vi.fn();

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: (...args: unknown[]) => mockMermaidRender(...args),
    parse: vi.fn(),
  },
}));

import MarkdownRenderer from '../MarkdownRenderer';

describe('MarkdownRenderer diagrams & formulas', () => {
  beforeEach(() => {
    mockMermaidRender.mockReset();
    mockMermaidRender.mockResolvedValue({ svg: '<svg></svg>' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a mermaid fence without requiring a preference flag', async () => {
    const md = '```mermaid\ngraph TD;A-->B\n```';
    const { container } = render(<MarkdownRenderer content={md} />);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="mermaid-rendered"]')).toBeTruthy();
    });
    expect(mockMermaidRender).toHaveBeenCalled();
  });

  it('renders dollar-delimited inline math with KaTeX', async () => {
    const { container } = render(<MarkdownRenderer content={'$x^2$'} />);
    await waitFor(() => expect(container.querySelector('.katex')).toBeTruthy());
  });

  it('renders bracket-delimited display math with KaTeX', async () => {
    const { container } = render(
      <MarkdownRenderer content={'\\[p=P(\\text{malicious}\\mid x)\\]'} />,
    );
    await waitFor(() => expect(container.querySelector('.katex-display')).toBeTruthy());
  });
});

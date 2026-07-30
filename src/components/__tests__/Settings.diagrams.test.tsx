/** 图表与公式已改为 Markdown 内建能力，不再暴露设置开关。 */
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

import { Settings } from '../Settings';

describe('Settings diagrams & formulas', () => {
  it('does not expose obsolete Mermaid or KaTeX switches', () => {
    const { queryByTestId } = render(<Settings open={true} onClose={vi.fn()} />);
    expect(queryByTestId('settings-diagrams')).toBeNull();
    expect(queryByTestId('settings-mermaid')).toBeNull();
    expect(queryByTestId('settings-katex')).toBeNull();
  });
});

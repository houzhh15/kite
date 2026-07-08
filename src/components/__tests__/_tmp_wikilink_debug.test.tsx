import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import MarkdownRenderer from '../MarkdownRenderer';

describe('debug', () => {
  it('shows innerHTML', () => {
    const md = '(来源：[[sources/pinecone-nexus-rag-end]])';
    const { container } = render(<MarkdownRenderer content={md} />);
    console.log('=== INNER HTML ===');
    console.log(container.innerHTML);
    console.log('=== TEXT ===');
    console.log(container.textContent);
    expect(true).toBe(true);
  });
});

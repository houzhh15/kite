import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import MarkdownRenderer from '../MarkdownRenderer';

const BADGES = [
  '[![Go](https://img.shields.io/badge/Go-1.22-blue)](https://go.dev)',
  '[![Node](https://img.shields.io/badge/Node-18-green)](https://nodejs.org)',
].join('\n');

describe('MarkdownRenderer badges', () => {
  it('keeps linked badge images inline while preserving intrinsic width', () => {
    const { container } = render(<MarkdownRenderer content={BADGES} />);
    const images = container.querySelectorAll('p > a > img');
    expect(images).toHaveLength(2);
    const paragraph = images[0]?.parentElement?.parentElement;
    expect(paragraph?.tagName).toBe('P');
    expect(paragraph?.querySelectorAll(':scope > a > img')).toHaveLength(2);
  });
});

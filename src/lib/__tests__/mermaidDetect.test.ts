/**
 * mermaidDetect.test.ts — T17-P2 (F-21) mermaid 围栏识别工具.
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';

import { isMermaidBlock } from '../mermaidDetect';

describe('isMermaidBlock (T17-P2)', () => {
  it('detects code with language-mermaid class', () => {
    const children = createElement(
      'code',
      { className: 'language-mermaid hljs' },
      'graph TD;A-->B',
    );
    expect(isMermaidBlock(children)).toBe(true);
  });

  it('returns false for non-mermaid language (rust)', () => {
    const children = createElement(
      'code',
      { className: 'language-rust hljs' },
      'fn main() {}',
    );
    expect(isMermaidBlock(children)).toBe(false);
  });

  it('returns false when there is no code element', () => {
    const children = createElement('span', null, 'just text');
    expect(isMermaidBlock(children)).toBe(false);
  });

  it('returns false for empty children', () => {
    expect(isMermaidBlock(null)).toBe(false);
    expect(isMermaidBlock(undefined)).toBe(false);
  });

  it('detects mermaid inside nested children', () => {
    const children = [
      createElement('code', { className: 'language-rust' }, 'rust'),
      createElement('code', { className: 'language-mermaid' }, 'graph'),
    ];
    expect(isMermaidBlock(children)).toBe(true);
  });
});
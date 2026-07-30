import { describe, expect, it } from 'vitest';

import { sanitizeSvg } from '../svgSanitizer';

describe('Mermaid SVG label security contract', () => {
  it('keeps safe SVG text while stripping HTML foreignObject labels', () => {
    const clean = sanitizeSvg(`
      <svg xmlns="http://www.w3.org/2000/svg">
        <text><tspan>LLM 服务</tspan></text>
        <foreignObject><div xmlns="http://www.w3.org/1999/xhtml">unsafe label</div></foreignObject>
      </svg>
    `);
    const document = new DOMParser().parseFromString(clean, 'image/svg+xml');
    expect(document.querySelectorAll('foreignObject')).toHaveLength(0);
    expect(document.documentElement.textContent).toContain('LLM 服务');
    expect(document.documentElement.textContent).not.toContain('unsafe label');
  });
});

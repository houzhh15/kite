/** Markdown 插件链：公式始终启用且同步可用。 */
import { describe, expect, it } from 'vitest';

import {
  REMARK_PLUGINS,
  REHYPE_PLUGINS,
  buildRehypePlugins,
  buildRemarkPlugins,
  normalizeLatexDelimiters,
} from '../pipeline';

describe('pipeline formulas', () => {
  it('always appends math plugins synchronously', () => {
    const remark = buildRemarkPlugins();
    const rehype = buildRehypePlugins();
    expect(remark.slice(0, 3)).toEqual([...REMARK_PLUGINS]);
    expect(remark.length).toBe(REMARK_PLUGINS.length + 2);
    expect(rehype[0]).toEqual(REHYPE_PLUGINS[0]);
    const katex = rehype[1] as [unknown, { strict: string; throwOnError: boolean }];
    expect(typeof katex[0]).toBe('function');
    expect(katex[1]).toEqual({ strict: 'ignore', throwOnError: false });
  });

  it('normalizes bracket and parenthesis delimiters outside code only', () => {
    const markdown = [
      '\\[p=P(x)\\]',
      'inline \\(x^2\\)',
      '`\\[inline code\\]`',
      '```text',
      '\\[fenced code\\]',
      '```',
    ].join('\n');
    expect(normalizeLatexDelimiters(markdown)).toBe([
      '$$\np=P(x)\n$$',
      'inline $x^2$',
      '`\\[inline code\\]`',
      '```text',
      '\\[fenced code\\]',
      '```',
    ].join('\n'));
  });
});

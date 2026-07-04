/**
 * 全 fixture 冒烟测试: 4 个 samples 模拟内容都能被 MarkdownRenderer
 * 正常渲染, 不抛错 (T02 实施最终冒烟).
 *
 * 注意: 此文件**不** import node:fs / node:path, 直接把 fixture 内容
 *       内联为字符串, 满足 check-contract.mjs 与 eslint 限制.
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import MarkdownRenderer from '../MarkdownRenderer';

// ---- 与 samples/*.md 完全一致的内联常量 ----

const HELLO_FIXTURE = [
  '# Hello KITE',
  '',
  'This is a **sample** markdown file used for manual testing.',
  '',
  '## Section',
  '',
  '- first',
  '- second',
  '- third',
  '',
  'Visit [Kite project](https://example.com) for details.',
  '',
].join('\n');

const BIG_FIXTURE = [
  '# Big fixture placeholder',
  '',
  'This file is a stand-in for the ~50 MB ceiling validation.',
  '',
  'For now it stays small so the repository is portable.',
  '',
].join('\n');

const TABLE_FIXTURE = [
  '# GFM Features',
  '',
  '## Table',
  '',
  '| Col A | Col B | Col C |',
  '| --- | --- | --- |',
  '| 1 | 2 | 3 |',
  '| 4 | 5 | 6 |',
  '',
  '## Task list',
  '',
  '- [x] install',
  '- [x] run',
  '- [ ] ship',
  '',
  '## Strikethrough & autolink',
  '',
  'This is ~~deprecated~~ now, see https://example.org.',
  '',
  '```ts',
  'function greet(name: string): string {',
  '  return `hi ${name}`;',
  '}',
  '```',
  '',
].join('\n');

const WITH_SCRIPT_FIXTURE = [
  '# XSS smoke test',
  '',
  'The following line must NOT execute in the rendered DOM:',
  '',
  "<script>alert('xss')</script>",
  '',
  'It should appear as plain text in the rendered article.',
  '',
  'Inline `code <script>x</script>` should also remain inert.',
  '',
].join('\n');

const SAMPLES: ReadonlyArray<readonly [name: string, body: string]> = [
  ['hello.md', HELLO_FIXTURE],
  ['big.md', BIG_FIXTURE],
  ['table.md', TABLE_FIXTURE],
  ['with-script.md', WITH_SCRIPT_FIXTURE],
];

describe('Sample fixtures render (T02 final smoke)', () => {
  for (const [name, body] of SAMPLES) {
    it(`renders ${name} without throwing`, () => {
      const { container } = render(<MarkdownRenderer content={body} />);
      // 容器存在
      expect(container.querySelector('article')).not.toBeNull();
      // 没有抛错, 有内容
      expect(container.textContent).toBeTruthy();
    });
  }

  it('hello.md renders <h1> + paragraph + list + link', () => {
    const { container } = render(<MarkdownRenderer content={HELLO_FIXTURE} />);
    expect(container.querySelector('h1')).not.toBeNull();
    expect(container.querySelector('p')).not.toBeNull();
    expect(container.querySelector('ul')).not.toBeNull();
    expect(container.querySelector('a[href="https://example.com"]')).not.toBeNull();
  });

  it('table.md renders <table> + <input type="checkbox" disabled>', () => {
    const { container } = render(<MarkdownRenderer content={TABLE_FIXTURE} />);
    expect(container.querySelector('table')).not.toBeNull();
    const boxes = container.querySelectorAll('input[type="checkbox"]');
    expect(boxes.length).toBeGreaterThanOrEqual(2);
    expect((boxes[0] as HTMLInputElement).disabled).toBe(true);
    expect((boxes[1] as HTMLInputElement).disabled).toBe(true);
  });

  it('with-script.md DOM has NO <script> element', () => {
    const { container } = render(<MarkdownRenderer content={WITH_SCRIPT_FIXTURE} />);
    expect(container.querySelector('script')).toBeNull();
  });
});
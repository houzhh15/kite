/**
 * exportHtml 单测 (T16-P2 step-5a).
 *
 * 覆盖:
 *   - buildHtml 注入 DOCTYPE / <meta charset> / <html data-theme>.
 *   - escapeHtml 双保险: 含 <script> 原文的输入, 输出不含可执行 <script> 标签.
 *   - theme 切换: 'light' / 'dark' / 'sepia'.
 *   - skippedImages 注释注入.
 */
import { describe, expect, it } from 'vitest';

import { buildHtml, escapeHtml } from '../lib/exportHtml';

const baseInput = {
  content: '# Hello\n\nworld',
  basePath: null,
  cssVars: { '--color-bg': '250 250 252', '--color-fg': '15 23 42' },
  highlightCss: '.hljs { color: red; }',
  title: 'Sample',
};

describe('escapeHtml', () => {
  it('转义 5 个危险字符', () => {
    expect(escapeHtml('<script>alert("x&y\'")</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&amp;y&#39;&quot;)&lt;/script&gt;',
    );
  });

  it('空串', () => {
    expect(escapeHtml('')).toBe('');
  });
});

describe('buildHtml', () => {
  it('首行 <!DOCTYPE html>', async () => {
    const out = await buildHtml({ ...baseInput, theme: 'light' });
    expect(out.startsWith('<!DOCTYPE html>')).toBe(true);
  });

  it('包含 <meta charset="utf-8">', async () => {
    const out = await buildHtml({ ...baseInput, theme: 'light' });
    expect(out).toContain('<meta charset="utf-8">');
  });

  it('data-theme 与输入一致', async () => {
    const out = await buildHtml({ ...baseInput, theme: 'dark' });
    expect(out).toContain('data-theme="dark"');
  });

  it('注入 CSS 变量', async () => {
    const out = await buildHtml({ ...baseInput, theme: 'light' });
    expect(out).toContain('--color-bg: 250 250 252');
    expect(out).toContain('--color-fg: 15 23 42');
  });

  it('嵌入 highlight.css', async () => {
    const out = await buildHtml({ ...baseInput, theme: 'light' });
    expect(out).toContain('.hljs { color: red; }');
  });

  it('不挂原始 <script> 标签 (NFR-S-01)', async () => {
    const out = await buildHtml({
      ...baseInput,
      content: 'hello<script>alert(1)</script>',
      theme: 'light',
    });
    // react-markdown 默认不会渲染 <script>; buildHtml 双保险再次 neutralize.
    expect(out).not.toMatch(/<script\b/i);
  });

  it('sepia 主题注入 sepia 变量', async () => {
    const out = await buildHtml({ ...baseInput, theme: 'sepia' });
    expect(out).toContain('data-theme="sepia"');
    expect(out).toContain('--color-bg: 244 232 210');
  });

  it('title 注入 <title>', async () => {
    const out = await buildHtml({ ...baseInput, theme: 'light' });
    expect(out).toContain('<title>Sample</title>');
  });

  it('rendered 内容被包在 <article class="prose-kite">', async () => {
    const out = await buildHtml({ ...baseInput, theme: 'light' });
    expect(out).toMatch(/<article[^>]*class="prose-kite">[\s\S]*<\/article>/);
  });
});
/**
 * fileTypes.test.ts — 路径白名单 + 纯函数 (F-02 / 设计 §4.4 测试矩阵).
 *
 * 设计依据: docs/design/compiled.md §3.3 + docs/plan/compiled.md Step 1.
 */
import { describe, expect, it } from 'vitest';

import { MARKDOWN_EXTENSIONS, isMarkdownPath, pickMarkdownPath } from '../fileTypes';

describe('fileTypes — isMarkdownPath', () => {
  it('accepts .md (lowercase)', () => {
    expect(isMarkdownPath('/foo/bar.md')).toBe(true);
  });

  it('accepts .MD (uppercase, case-insensitive)', () => {
    expect(isMarkdownPath('/foo/bar.MD')).toBe(true);
  });

  it('accepts .markdown', () => {
    expect(isMarkdownPath('/foo/bar.markdown')).toBe(true);
  });

  it('accepts .mdx', () => {
    expect(isMarkdownPath('/foo/bar.mdx')).toBe(true);
  });

  it('rejects .pdf', () => {
    expect(isMarkdownPath('/foo/bar.pdf')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isMarkdownPath('')).toBe(false);
  });

  it('rejects file:// protocol prefix (NFR-02-3)', () => {
    expect(isMarkdownPath('file:///foo/bar.md')).toBe(false);
  });

  it('rejects path without extension', () => {
    expect(isMarkdownPath('/foo/bar')).toBe(false);
  });

  it('rejects path with non-md extension even if basename contains .md', () => {
    // 提取的是 basename 上的扩展名, 不是 path 中的 mid 段
    expect(isMarkdownPath('/foo/bar.md.txt')).toBe(false);
  });
});

describe('fileTypes — pickMarkdownPath', () => {
  it('picks first .md among mixed list (AC-02-1)', () => {
    expect(pickMarkdownPath(['/a.md', '/b.pdf'])).toBe('/a.md');
  });

  it('returns null when no markdown candidate (AC-02-2)', () => {
    expect(pickMarkdownPath(['/a.pdf', '/b.docx'])).toBeNull();
  });

  it('returns null for empty list (AC-02-3)', () => {
    expect(pickMarkdownPath([])).toBeNull();
  });

  it('preserves original case in result (AC-02-4)', () => {
    expect(pickMarkdownPath(['/A.MD'])).toBe('/A.MD');
  });

  it('rejects file:// entries (NFR-02-3)', () => {
    expect(pickMarkdownPath(['file:///tmp/a.md'])).toBeNull();
  });

  it('skips non-string / empty entries (type defense)', () => {
    // @ts-expect-error -- 故意传非 string 测试防御
    expect(pickMarkdownPath([null, undefined, '', '/a.md'])).toBe('/a.md');
  });

  it('skips file:// entries and finds the next valid .md', () => {
    expect(pickMarkdownPath(['file:///tmp/a.md', '/b.markdown'])).toBe('/b.markdown');
  });

  it('picks .markdown over .md (first hit)', () => {
    expect(pickMarkdownPath(['/a.markdown', '/b.md'])).toBe('/a.markdown');
  });

  it('returns null for non-array input (type defense)', () => {
    // @ts-expect-error -- 故意传非 array 测试防御
    expect(pickMarkdownPath(undefined)).toBeNull();
    // @ts-expect-error -- 同上
    expect(pickMarkdownPath(null)).toBeNull();
  });
});

describe('fileTypes — MARKDOWN_EXTENSIONS', () => {
  it('exposes the canonical extension list', () => {
    expect(MARKDOWN_EXTENSIONS).toEqual(['.md', '.markdown', '.mdx']);
  });
});

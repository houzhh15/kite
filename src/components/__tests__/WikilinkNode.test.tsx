/**
 * WikilinkNode 单测 — T28 / F-46 / FR-02 / AC-02-1..4.
 *
 * 设计依据: docs/design/compiled.md §3.2 + §3.6.2.
 *
 * 覆盖:
 *   - 可点击态 + 有 alias (AC-02-1)
 *   - 可点击态 + 无 anchor (AC-02-2)
 *   - 降级态 (root=null) (AC-02-3)
 *   - useVaultRoot 抛错 mock (AC-02-4)
 *   - useVaultRoot 返回 root=null 时仍渲染降级
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

import { setWikilinkLoadFile } from '../../lib/wikilink/loadFileRef';

// mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh-CN', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children: React.ReactNode }) => children,
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

// mock useVaultRoot (单一返回 root 字段; 其他字段保留为 noop).
let mockRoot: string | null = '/Users/me/notes';
const useVaultRootMock = vi.fn(() => ({
  root: mockRoot,
  mode: 'follow-current' as const,
  setMode: vi.fn(),
  setCustomPath: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('../../lib/wikilink/vaultRoot', () => ({
  useVaultRoot: () => useVaultRootMock(),
  deriveVaultRoot: (mode: unknown, customPath: unknown, currentPath: unknown) => {
    if (mode === 'custom' && typeof customPath === 'string') return customPath;
    if (typeof currentPath === 'string') return currentPath.replace(/\/[^/]+$/, '');
    return null;
  },
}));

import { WikilinkNode } from '../WikilinkNode';

describe('WikilinkNode (T28 / FR-02 / AC-02-1..4)', () => {
  beforeEach(() => {
    mockRoot = '/Users/me/notes';
    setWikilinkLoadFile(null);
    useVaultRootMock.mockClear();
  });

  it('AC-02-1: root 非空 + 有 alias → 渲染 <button> 带 data-wikilink', () => {
    const { container } = render(
      <WikilinkNode data-wikilink="projects/foo" data-anchor="目标" data-alias="项目计划">
        项目计划
      </WikilinkNode>,
    );
    const btn = container.querySelector('button');
    expect(btn).not.toBeNull();
    expect(btn?.getAttribute('role')).toBe('link');
    expect(btn?.getAttribute('data-wikilink')).toBe('projects/foo');
    expect(btn?.getAttribute('data-anchor')).toBe('目标');
    expect(btn?.getAttribute('data-alias')).toBe('项目计划');
    expect(btn?.getAttribute('aria-disabled')).toBeNull();
    expect(btn?.textContent).toBe('项目计划');
  });

  it('AC-02-2: root 非空 + 无 anchor → children 为 target', () => {
    const { container } = render(
      <WikilinkNode data-wikilink="foo">foo</WikilinkNode>,
    );
    const btn = container.querySelector('button');
    expect(btn).not.toBeNull();
    expect(btn?.getAttribute('data-wikilink')).toBe('foo');
    expect(btn?.getAttribute('data-anchor')).toBeNull();
    expect(btn?.textContent).toBe('foo');
  });

  it('AC-02-3: root=null → 渲染 <span aria-disabled="true"> + title 提示', () => {
    mockRoot = null;
    const { container } = render(
      <WikilinkNode data-wikilink="projects/foo" data-alias="项目计划">
        项目计划
      </WikilinkNode>,
    );
    const span = container.querySelector('span');
    expect(span).not.toBeNull();
    expect(span?.getAttribute('aria-disabled')).toBe('true');
    expect(span?.getAttribute('data-wikilink')).toBe('projects/foo');
    expect(span?.getAttribute('title')).toBe('toast.wikilink.vaultNotConfigured');
    expect(span?.textContent).toBe('项目计划');
    // 不应是 <button>
    expect(container.querySelector('button')).toBeNull();
  });

  it('AC-02-4: useVaultRoot 抛错 → 渲染降级 + console.error 一次', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    useVaultRootMock.mockImplementationOnce(() => {
      throw new TypeError('mock failure');
    });
    const { container } = render(
      <WikilinkNode data-wikilink="projects/foo">foo</WikilinkNode>,
    );
    const span = container.querySelector('span');
    expect(span).not.toBeNull();
    expect(span?.getAttribute('aria-disabled')).toBe('true');
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(errSpy.mock.calls[0]?.[0]).toContain('[WikilinkNode] useVaultRoot failed');
    errSpy.mockRestore();
  });

  it('data-wikilink 缺失时降级显示纯文本', () => {
    const { container } = render(<WikilinkNode>fallback</WikilinkNode>);
    const span = container.querySelector('span');
    expect(span).not.toBeNull();
    expect(span?.textContent).toBe('fallback');
  });
});
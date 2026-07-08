/**
 * WikilinkNode 单测 — T28 / F-46 / FR-02 / AC-02-1..4.
 *
 * 设计依据: docs/design/compiled.md §3.2 + §3.6.2.
 *
 * 覆盖:
 *   - 可点击态 + 有 alias (AC-02-1)
 *   - 可点击态 + 无 anchor (AC-02-2)
 *   - 始终渲染为可点击 button (AC-02-3) — R-26 修复: 移除 root=null 降级分支,
 *     错误处理下沉到 WikilinkLink.onClick (vaultRoot 缺失时点击 → pushToast).
 *   - 缺 data-wikilink 时降级显示纯文本 (AC-02-4)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

import { setWikilinkLoadFile } from '../../lib/wikilink/loadFileRef';

import { WikilinkNode } from '../WikilinkNode';

describe('WikilinkNode (T28 / FR-02 / AC-02-1..4)', () => {
  beforeEach(() => {
    setWikilinkLoadFile(null);
  });

  it('AC-02-1: 有 alias → 渲染 <button> 带 data-wikilink + data-anchor + data-alias', () => {
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

  it('AC-02-2: 无 anchor → children 为 target', () => {
    const { container } = render(
      <WikilinkNode data-wikilink="foo">foo</WikilinkNode>,
    );
    const btn = container.querySelector('button');
    expect(btn).not.toBeNull();
    expect(btn?.getAttribute('data-wikilink')).toBe('foo');
    expect(btn?.getAttribute('data-anchor')).toBeNull();
    expect(btn?.textContent).toBe('foo');
  });

  it('AC-02-3 (R-26): 始终渲染为可点击 button — 错误处理下沉到 WikilinkLink.onClick', () => {
    // 不再分支: 即使 vaultRoot=null (测试中 useDocStore.currentPath=null + usePrefStore 默认),
    // wikilink 仍渲染为 button[role=link]. 错误处理 (toast 提示) 在 onClick 触发时.
    const { container } = render(
      <WikilinkNode data-wikilink="projects/foo" data-alias="项目计划">
        项目计划
      </WikilinkNode>,
    );
    const btn = container.querySelector('button');
    expect(btn).not.toBeNull();
    expect(btn?.getAttribute('role')).toBe('link');
    // 链接视觉 (不被降级成 text-muted 灰字)
    expect(btn?.className).toContain('text-accent');
    expect(btn?.className).toContain('hover:underline');
    // 不再是 aria-disabled span
    expect(container.querySelector('[aria-disabled]')).toBeNull();
  });

  it('AC-02-4: data-wikilink 缺失时降级显示纯文本 (防御性)', () => {
    const { container } = render(<WikilinkNode>fallback</WikilinkNode>);
    const span = container.querySelector('span');
    expect(span).not.toBeNull();
    expect(span?.textContent).toBe('fallback');
  });
});
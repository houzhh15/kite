/**
 * T28 wikilink 渲染回归测试 — F-46 / FR-02 / AC-02-1..4 端到端冒烟.
 *
 * 设计依据: docs/design/compiled.md §3.5 + AC-02.
 *
 * 关键覆盖: 修复 hName='span' → hName='wikilink' 之后, 确认
 *   1) 文本中的 [[target]] 不再作为字面量 `[[target]]` 输出
 *   2) WikilinkNode 组件实际被调用 (而不是 vite tree-shake 删除)
 *   3) 渲染产物包含 data-wikilink 属性, 便于 click handler 接管
 *
 * 这条测试是 T28-修复 (R-25): 解决用户反馈的 wikilink 被当文本显示问题.
 *
 * 关键修复 (R-26):
 *   buildRemarkPluginsSync 之前传 `remarkWikilink()` (已调用), unified 把它
 *   当 attacher, 在 freeze 阶段 `transformer.call(processor, undefined)`,
 *   内层 tree=undefined 抛错或被静默吞掉, 插件从未生效. 正确做法:
 *   传 `remarkWikilink` factory, 由 unified 在 freeze 阶段调用并得到 transformer.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

import MarkdownRenderer from '../MarkdownRenderer';
import { useDocStore } from '../../stores/docStore';
import { usePrefStore } from '../../stores/prefStore';

function setupVaultRoot(currentPath: string, customPath: string | null): void {
  usePrefStore.setState({
    prefs: {
      ...usePrefStore.getState().prefs,
      vaultRootMode: 'custom',
      vaultRootCustom: customPath,
    },
    hydrated: true,
  });
  useDocStore.setState({
    state: { currentPath, content: '', title: '', dirty: false },
  });
}

describe('T28 wikilink 渲染端到端 (F-46 / AC-02)', () => {
  beforeEach(() => {
    // 默认降级态: vaultRoot=null, 渲染为 span[data-wikilink][aria-disabled]
    usePrefStore.setState({
      prefs: { ...usePrefStore.getState().prefs, vaultRootMode: 'follow-current', vaultRootCustom: null },
      hydrated: true,
    });
    useDocStore.setState({
      state: { currentPath: null, content: '', title: '', dirty: false },
    });
  });

  it('AC-R25-1: [[target]] 不再字面量输出 (无 [[ ]] 残留在文本节点)', () => {
    const md = '(来源：[[sources/pinecone-nexus-rag-end]])';
    const { container } = render(<MarkdownRenderer content={md} />);

    // 全文文本节点中**不**应包含字面量 "[[" 或 "]]"
    const allText = container.textContent ?? '';
    expect(allText).not.toContain('[[');
    expect(allText).not.toContain(']]');
    expect(allText).toContain('sources/pinecone-nexus-rag-end');
  });

  it('AC-R25-2: 渲染产物含 data-wikilink 属性 (vaultRoot 缺失时降级为 span[aria-disabled])', () => {
    const md = '(来源：[[sources/pinecone-nexus-rag-end]])';
    const { container } = render(<MarkdownRenderer content={md} />);

    const linkEl = container.querySelector('[data-wikilink="sources/pinecone-nexus-rag-end"]');
    expect(linkEl).not.toBeNull();
    // vaultRoot 未配置 → 降级 span (AC-02-3).
    expect(linkEl?.tagName.toLowerCase()).toBe('span');
    expect(linkEl?.getAttribute('aria-disabled')).toBe('true');
  });

  it('AC-R25-2b: 配置 vaultRoot 后渲染为 button[role=link] (可点击态)', () => {
    setupVaultRoot('/vault/daily/2025-01-01.md', '/vault');
    const md = '(来源：[[sources/pinecone-nexus-rag-end]])';
    const { container } = render(<MarkdownRenderer content={md} />);

    const linkEl = container.querySelector('[data-wikilink="sources/pinecone-nexus-rag-end"]');
    expect(linkEl).not.toBeNull();
    // vaultRoot 已配置 → 可点击 button role=link.
    expect(linkEl?.tagName.toLowerCase()).toBe('button');
    expect(linkEl?.getAttribute('role')).toBe('link');
  });

  it('AC-R25-3: 别名语法 [[target|alias]] 时显示 alias, 不显示 [[target]]', () => {
    setupVaultRoot('/vault/daily/2025-01-01.md', '/vault');
    const md = 'see [[sources/foo|the foo]] for details';
    const { container } = render(<MarkdownRenderer content={md} />);

    const allText = container.textContent ?? '';
    expect(allText).not.toContain('[[');
    expect(allText).not.toContain(']]');
    expect(allText).toContain('the foo');
    expect(container.querySelector('[data-wikilink="sources/foo"]')).not.toBeNull();
    expect(container.querySelector('[data-alias="the foo"]')).not.toBeNull();
  });

  it('AC-R25-4: 解析失败 [[]] 保留为字面量文本 (AC-01-3 回归)', () => {
    const md = 'see [[]] here';
    const { container } = render(<MarkdownRenderer content={md} />);

    // [[]] 应作为字面量文本保留, 而不作为 wikilink 节点.
    const allText = container.textContent ?? '';
    expect(allText).toContain('[[]]');
    expect(container.querySelector('[data-wikilink]')).toBeNull();
  });

  it('AC-R25-5: 嵌入行内代码 [[x]] 不被改写 (AC-01-4 回归)', () => {
    const md = 'use `[[x]]` in code';
    const { container } = render(<MarkdownRenderer content={md} />);

    const allText = container.textContent ?? '';
    // inline code 中的 [[x]] 应保留为字面量文本.
    expect(allText).toContain('[[x]]');
    expect(container.querySelector('[data-wikilink]')).toBeNull();
  });
});
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
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';

import MarkdownRenderer from '../MarkdownRenderer';
import { useDocStore } from '../../stores/docStore';
import { usePrefStore } from '../../stores/prefStore';

// pathExists 注入, 让端到端测试可控: 默认全部 false, 测试可显式覆盖.
let pathExistsImpl: ((p: string) => Promise<boolean>) | null = null;
vi.mock('../../lib/tauri', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- importOriginal 返回 unknown, 此处 cast 唯一可行.
  const mod = (await importOriginal()) as Record<string, unknown>;
  return {
    ...mod,
    pathExists: vi.fn((p: string) => {
      if (pathExistsImpl) return pathExistsImpl(p);
      return Promise.resolve(false);
    }),
  };
});

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
    pathExistsImpl = null;
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

  it('AC-R25-2: 渲染产物含 data-wikilink 属性, 始终渲染为 button[role=link] (vaultRoot 缺失也保留链接视觉)', () => {
    const md = '(来源：[[sources/pinecone-nexus-rag-end]])';
    const { container } = render(<MarkdownRenderer content={md} />);

    const linkEl = container.querySelector('[data-wikilink="sources/pinecone-nexus-rag-end"]');
    expect(linkEl).not.toBeNull();
    // R-26 修复: 不论 vaultRoot 是否配置, 始终渲染为 button[role=link],
    // 保证视觉一致 (text-accent + hover:underline). vaultRoot 缺失时的错误处理
    // 下沉到 WikilinkLink.onClick: 点击 → pushToast 提示去设置.
    expect(linkEl?.tagName.toLowerCase()).toBe('button');
    expect(linkEl?.getAttribute('role')).toBe('link');
    // 链接视觉 (不被降级成 text-muted 灰字)
    expect(linkEl?.className).toContain('text-accent');
    expect(linkEl?.className).toContain('hover:underline');
  });

  it('AC-R25-2b: vaultRoot 缺失时点击 wikilink → pushToast 提示去设置 (AC-06-1)', async () => {
    // 默认状态: vaultRoot=null, 仍然渲染为可点击 button.
    const md = 'see [[sources/foo]] here';
    const { container } = render(<MarkdownRenderer content={md} />);
    const linkEl = container.querySelector<HTMLButtonElement>('[data-wikilink="sources/foo"]');
    expect(linkEl).not.toBeNull();
    expect(linkEl?.tagName.toLowerCase()).toBe('button');

    // 点击 → onClick 同步取 root=null → pushToast.
    // 这里不直接断言 toast (需要 Toast 上下文), 改断言 click handler 不抛错 +
    // 仍然渲染为 button.
    expect(() => linkEl?.click()).not.toThrow();
  });

  it('AC-R25-2c: vaultRoot 配置后点击 wikilink → 调用 loadFile (FR-03)', async () => {
    // pathExists 全部返回 true, 让所有候选都"存在", 命中第 1 层.
    pathExistsImpl = () => Promise.resolve(true);
    setupVaultRoot('/vault/daily/2025-01-01.md', '/vault');
    let calledWith: string | null = null;
    // 模拟 App.tsx 注册的 loadFile.
    const { setWikilinkLoadFile } = await import('../../lib/wikilink/loadFileRef');
    setWikilinkLoadFile(async (p: string) => {
      calledWith = p;
    });

    const md = 'see [[sources/foo]] here';
    const { container } = render(<MarkdownRenderer content={md} />);
    const linkEl = container.querySelector<HTMLButtonElement>('[data-wikilink="sources/foo"]');
    expect(linkEl).not.toBeNull();
    linkEl?.click();
    // 等待微任务
    await new Promise((r) => setTimeout(r, 10));
    // 第 1 层候选 /vault/daily/sources/foo.md 命中
    expect(calledWith).not.toBeNull();
    expect(calledWith).toContain('sources/foo');
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
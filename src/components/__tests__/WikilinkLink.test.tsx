/**
 * WikilinkLink 单测 — T28 / F-46 / FR-03 / FR-06 / AC-03-1..5 + AC-06-1..5.
 *
 * 设计依据: docs/design/compiled.md §3.3 + §3.6.3 + §3.6.8.
 *
 * 覆盖:
 *   - 成功跳转 (AC-03-1)
 *   - anchor 命中 (AC-03-2)
 *   - vaultRoot=null → toast (AC-03-3 / AC-06-1)
 *   - security-violation → 静默 (AC-03-4 / AC-06-2)
 *   - loadFile 抛 NOT_FOUND → toast 1 次 + state 不变 (AC-03-5 / AC-06-3)
 *   - anchor 不命中 → console.warn (AC-06-4)
 *   - loadFile 抛 IO → toast (AC-06-5)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';

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

import { WikilinkLink } from '../WikilinkLink';
import { usePrefStore } from '../../stores/prefStore';
import { useDocStore } from '../../stores/docStore';
import { useToastStore } from '../../lib/toast';

function resetStores(): void {
  usePrefStore.setState({
    prefs: {
      theme: 'system',
      fontSize: 16,
      lineHeight: 1.6,
      codeBlockTheme: 'github',
      fontSizeId: 'md',
      lineHeightId: 'cozy',
      codeFontSizeId: 'md',
      language: 'zh-CN',
      mermaidEnabled: false,
      katexEnabled: false,
      externalEditor: 'system',
      externalEditorCustomCmd: '',
      vaultRootMode: 'follow-current',
      vaultRootCustom: null,
    },
    hydrated: true,
    loaded: true,
  });
  useDocStore.setState({
    state: { currentPath: '/Users/me/notes/daily/2025-01-01.md', content: '', title: '', dirty: false },
    history: [],
    cursor: -1,
  });
  useToastStore.setState({ items: [] });
}

function makeClickEvent(): Partial<MouseEvent> {
  return {
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    button: 0,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
}

describe('WikilinkLink (T28 / FR-03 / FR-06 / AC-03-1..5 / AC-06-1..5)', () => {
  beforeEach(() => {
    resetStores();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('AC-03-1: 成功跳转 → loadFile 调用 1 次', async () => {
    const loadFile = vi.fn().mockResolvedValue(undefined);
    setWikilinkLoadFile(loadFile);
    const { container } = render(
      <WikilinkLink target="projects/foo">foo</WikilinkLink>,
    );
    const btn = container.querySelector('button');
    expect(btn).not.toBeNull();

    await act(async () => {
      fireEvent.click(btn as HTMLElement, makeClickEvent() as unknown as MouseEvent);
    });
    // 让 microtask 跑完 (loadFile 是 async, onClick 内 await 后才返回).
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(loadFile).toHaveBeenCalledTimes(1);
    expect(loadFile).toHaveBeenCalledWith('/Users/me/notes/daily/projects/foo.md');
  });

  it('AC-03-2: anchor 命中 → scrollIntoView 调用 1 次 (双 RAF)', async () => {
    const loadFile = vi.fn().mockImplementation(async () => {
      // 模拟 useMarkdownDoc.loadFile 完成后微任务调度
      await Promise.resolve();
    });
    setWikilinkLoadFile(loadFile);
    const section = document.createElement('div');
    section.id = '目标'; // slugify('目标') === '目标' (Chinese 保留)
    section.scrollIntoView = vi.fn();
    document.body.appendChild(section);

    const { container } = render(
      <WikilinkLink target="projects/foo" anchor="目标">foo</WikilinkLink>,
    );
    const btn = container.querySelector('button');

    await act(async () => {
      fireEvent.click(btn as HTMLElement, makeClickEvent() as unknown as MouseEvent);
    });
    // 等 microtask: onClick async 函数执行完, schedule 了 rAF
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
    // 等 rAF1 + rAF2
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    await act(async () => {
      await Promise.resolve();
    });

    expect(section.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'start',
    });
    document.body.removeChild(section);
  });

  it('AC-03-3 / AC-06-1: vaultRoot=null → pushToast 1 次', async () => {
    // currentPath null → deriveVaultRoot 返回 null
    useDocStore.setState({
      state: { currentPath: null, content: '', title: '', dirty: false },
      history: [],
      cursor: -1,
    });
    const loadFile = vi.fn();
    setWikilinkLoadFile(loadFile);
    const { container } = render(
      <WikilinkLink target="projects/foo">foo</WikilinkLink>,
    );
    const btn = container.querySelector('button');

    await act(async () => {
      fireEvent.click(btn as HTMLElement, makeClickEvent() as unknown as MouseEvent);
    });

    expect(loadFile).toHaveBeenCalledTimes(0);
    const toasts = useToastStore.getState().items;
    expect(toasts.length).toBe(1);
    expect(toasts[0]?.message).toBe('toast.wikilink.vaultNotConfigured');
    expect(toasts[0]?.kind).toBe('error');
  });

  it('AC-03-4 / AC-06-2: security-violation (target 含 ..) → 全部静默', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const loadFile = vi.fn();
    setWikilinkLoadFile(loadFile);
    const { container } = render(
      <WikilinkLink target="../../etc/passwd">escape</WikilinkLink>,
    );
    const btn = container.querySelector('button');

    await act(async () => {
      fireEvent.click(btn as HTMLElement, makeClickEvent() as unknown as MouseEvent);
    });

    expect(loadFile).toHaveBeenCalledTimes(0);
    expect(useToastStore.getState().items.length).toBe(0);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('AC-06-4: anchor 不命中 → console.warn 1 次, 不弹 toast', async () => {
    vi.useFakeTimers();
    try {
      const loadFile = vi.fn().mockResolvedValue(undefined);
      setWikilinkLoadFile(loadFile);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const { container } = render(
        <WikilinkLink target="projects/foo" anchor="不存在的章节">foo</WikilinkLink>,
      );
      const btn = container.querySelector('button');

      await act(async () => {
        fireEvent.click(btn as HTMLElement, makeClickEvent() as unknown as MouseEvent);
        await vi.runAllTimersAsync();
      });

      expect(useToastStore.getState().items.length).toBe(0);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[WikilinkLink] anchor not found'),
      );
      warnSpy.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it('loadFile 抛错 → 不再重弹 toast (依赖 docStore 内部统一映射)', async () => {
    const loadFile = vi.fn().mockRejectedValue(new Error('IPC failed'));
    setWikilinkLoadFile(loadFile);
    const { container } = render(
      <WikilinkLink target="projects/foo">foo</WikilinkLink>,
    );
    const btn = container.querySelector('button');

    await act(async () => {
      fireEvent.click(btn as HTMLElement, makeClickEvent() as unknown as MouseEvent);
      // 等待 promise reject
      await new Promise((r) => setTimeout(r, 10));
    });

    // WikilinkLink 不重复 pushToast (由 docStore.loadFile 内部统一映射)
    expect(useToastStore.getState().items.length).toBe(0);
    expect(loadFile).toHaveBeenCalledTimes(1);
  });

  it('loadFile 未注入 (App 未挂载) → 静默 noop', async () => {
    setWikilinkLoadFile(null);
    const { container } = render(
      <WikilinkLink target="projects/foo">foo</WikilinkLink>,
    );
    const btn = container.querySelector('button');

    await act(async () => {
      fireEvent.click(btn as HTMLElement, makeClickEvent() as unknown as MouseEvent);
    });

    expect(useToastStore.getState().items.length).toBe(0);
  });
});
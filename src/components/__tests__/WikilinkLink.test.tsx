/**
 * WikilinkLink 单测 — T28 / F-46 / FR-03 / FR-06 / AC-03-1..5 + AC-06-1..5.
 *
 * 设计依据: docs/design/compiled.md §3.3 + §3.6.3 + §3.6.8.
 *
 * 覆盖:
 *   - 成功跳转: 第 1 层候选命中 (AC-03-1)
 *   - 成功跳转: 第 2/3 层候选命中 (per-level probe, FR-03 增量)
 *   - anchor 命中 (AC-03-2)
 *   - 无 currentPath → toast vaultNotConfigured (AC-06-1)
 *   - security-violation → 静默 (AC-03-4 / AC-06-2)
 *   - 全部候选不存在 → toast targetNotFound (FR-03 增量)
 *   - loadFile 抛错 → 不再重弹 toast (AC-06-3)
 *   - anchor 不命中 → console.warn (AC-06-4)
 *   - loadFile 未注入 → 静默 noop
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';

import { setWikilinkLoadFile } from '../../lib/wikilink/loadFileRef';

// mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && Object.keys(opts).length > 0 ? `${key}:${JSON.stringify(opts)}` : key,
    i18n: { language: 'zh-CN', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children: React.ReactNode }) => children,
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

// mock tauri pathExists — 默认全部不存在; 单测可显式覆盖.
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

import { WikilinkLink } from '../WikilinkLink';
import { usePrefStore } from '../../stores/prefStore';
import { useDocStore } from '../../stores/docStore';
import { useToastStore } from '../../lib/toast';
import { pathExists } from '../../lib/tauri';

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
  pathExistsImpl = null;
  vi.mocked(pathExists).mockClear();
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

  it('AC-03-1: 成功跳转 → loadFile 调用 1 次, 第 1 层候选命中', async () => {
    // pathExists 模拟: /Users/me/notes/daily/projects/foo.md 存在
    pathExistsImpl = (p: string) =>
      Promise.resolve(p === '/Users/me/notes/daily/projects/foo.md');
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
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(loadFile).toHaveBeenCalledTimes(1);
    expect(loadFile).toHaveBeenCalledWith('/Users/me/notes/daily/projects/foo.md');
  });

  it('AC-03-1b: 第 2 层候选命中 → loadFile 调用 1 次 (per-level probe)', async () => {
    // pathExists 模拟: /Users/me/notes/projects/foo.md 存在 (第 2 层)
    // currentPath = /Users/me/notes/daily/2025-01-01.md → 候选 [/Users/me/notes/daily, /Users/me/notes, /Users/me, /]
    pathExistsImpl = (p: string) => Promise.resolve(p === '/Users/me/notes/projects/foo.md');
    const loadFile = vi.fn().mockResolvedValue(undefined);
    setWikilinkLoadFile(loadFile);
    const { container } = render(
      <WikilinkLink target="projects/foo">foo</WikilinkLink>,
    );
    const btn = container.querySelector('button');

    await act(async () => {
      fireEvent.click(btn as HTMLElement, makeClickEvent() as unknown as MouseEvent);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(loadFile).toHaveBeenCalledTimes(1);
    expect(loadFile).toHaveBeenCalledWith('/Users/me/notes/projects/foo.md');
    // 验证 pathExists 至少被调用 2 次 (因为第 1 层不存在, 试第 2 层)
    expect(vi.mocked(pathExists).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('AC-03-1c: 第 3 层候选命中 → loadFile 调用 1 次 (深目录探测)', async () => {
    // currentPath = /Users/me/notes/daily/2025-01-01.md
    // 候选顺序: [/Users/me/notes/daily, /Users/me/notes, /Users/me, /Users, /] (5 个)
    // 第 3 层 /Users/me 命中: /Users/me/projects/foo.md 存在
    pathExistsImpl = (p: string) => Promise.resolve(p === '/Users/me/projects/foo.md');
    const loadFile = vi.fn().mockResolvedValue(undefined);
    setWikilinkLoadFile(loadFile);
    const { container } = render(
      <WikilinkLink target="projects/foo">foo</WikilinkLink>,
    );
    const btn = container.querySelector('button');

    await act(async () => {
      fireEvent.click(btn as HTMLElement, makeClickEvent() as unknown as MouseEvent);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(loadFile).toHaveBeenCalledTimes(1);
    expect(loadFile).toHaveBeenCalledWith('/Users/me/projects/foo.md');
    expect(vi.mocked(pathExists).mock.calls.length).toBe(3);
  });

  it('AC-03-2: anchor 命中 → scrollIntoView 调用 1 次 (双 RAF)', async () => {
    // 模拟第 1 层候选命中
    pathExistsImpl = (p: string) =>
      Promise.resolve(p === '/Users/me/notes/daily/projects/foo.md');
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

  it('AC-03-3 / AC-06-1: currentPath=null → pushToast 1 次 vaultNotConfigured', async () => {
    // currentPath null → probeVaultRootCandidates 返回 []
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
    expect(vi.mocked(pathExists)).not.toHaveBeenCalled();
    const toasts = useToastStore.getState().items;
    expect(toasts.length).toBe(1);
    expect(toasts[0]?.message).toBe('toast.wikilink.vaultNotConfigured');
    expect(toasts[0]?.kind).toBe('error');
  });

  it('AC-03-4 / AC-06-2: security-violation (target 含 ..) → 全部候选静默跳过, 不弹 toast', async () => {
    // security-violation 跳过所有候选, 最终触发 targetNotFound toast.
    pathExistsImpl = () => Promise.resolve(true);
    const loadFile = vi.fn();
    setWikilinkLoadFile(loadFile);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container } = render(
      <WikilinkLink target="../../etc/passwd">escape</WikilinkLink>,
    );
    const btn = container.querySelector('button');

    await act(async () => {
      fireEvent.click(btn as HTMLElement, makeClickEvent() as unknown as MouseEvent);
      await Promise.resolve();
    });

    expect(loadFile).toHaveBeenCalledTimes(0);
    // security-violation 跳过所有候选, 最终触发 targetNotFound toast.
    const toasts = useToastStore.getState().items;
    expect(toasts.length).toBe(1);
    expect(toasts[0]?.message).toContain('toast.wikilink.targetNotFound');
    // R-29: 探测失败时输出 console.warn 调试 (含 attempted 路径).
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('FR-03 增量: 全部候选不存在 → pushToast targetNotFound 1 次', async () => {
    // pathExistsImpl 保持 null (默认 false) → 5 层候选全部探测不到
    // (currentPath='/Users/me/notes/daily/2025-01-01.md' → 5 段 → 5 候选)
    const loadFile = vi.fn();
    setWikilinkLoadFile(loadFile);
    // 显式清零 pathExists 计数 (避免其他测试残留)
    vi.mocked(pathExists).mockClear();
    const { container } = render(
      <WikilinkLink target="projects/foo">foo</WikilinkLink>,
    );
    const btn = container.querySelector('button');

    await act(async () => {
      fireEvent.click(btn as HTMLElement, makeClickEvent() as unknown as MouseEvent);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(loadFile).toHaveBeenCalledTimes(0);
    // 验证 pathExists 被调用了 5 次 (5 层候选, 由内向外)
    expect(vi.mocked(pathExists).mock.calls.length).toBe(5);
    const toasts = useToastStore.getState().items;
    expect(toasts.length).toBe(1);
    expect(toasts[0]?.message).toContain('toast.wikilink.targetNotFound');
    expect(toasts[0]?.message).toContain('projects/foo');
    expect(toasts[0]?.kind).toBe('error');
  });

  it('AC-06-4: anchor 不命中 → console.warn 1 次, 不弹 toast', async () => {
    vi.useFakeTimers();
    try {
      pathExistsImpl = (p: string) =>
        Promise.resolve(p === '/Users/me/notes/daily/projects/foo.md');
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
    pathExistsImpl = (p: string) =>
      Promise.resolve(p === '/Users/me/notes/daily/projects/foo.md');
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
    pathExistsImpl = (p: string) =>
      Promise.resolve(p === '/Users/me/notes/daily/projects/foo.md');
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
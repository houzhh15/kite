/**
 * T28 wikilink 端到端集成测试 (覆盖实际 e2e 用户场景).
 *
 * 模拟用户场景:
 *   - 打开 daily/2025.md
 *   - 文件中含 [[projects/foo]] (无扩展名)
 *   - 实际文件在 projects/foo.md (有 .md 扩展名)
 *   - 模拟 pathExists 返回 true (Tauri 环境)
 *   - 验证 loadFile 被调用, 且参数正确
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';

import { setWikilinkLoadFile } from '../../lib/wikilink/loadFileRef';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && Object.keys(opts).length > 0 ? `${key}:${JSON.stringify(opts)}` : key,
    i18n: { language: 'zh-CN', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children: React.ReactNode }) => children,
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

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
import { useDocStore } from '../../stores/docStore';
import { usePrefStore } from '../../stores/prefStore';
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
    state: {
      currentPath: '/Users/me/vault/daily/2025-01-01.md',
      content: '',
      title: '',
      dirty: false,
    },
    history: [],
    cursor: -1,
  });
  useToastStore.setState({ items: [] });
  pathExistsImpl = null;
  vi.mocked(pathExists).mockClear();
}

describe('T28 wikilink 端到端 (e2e 用户场景)', () => {
  beforeEach(() => resetStores());

  it('用户场景 1: daily/2025.md 中点击 [[projects/foo]] → 跳转到 projects/foo.md', async () => {
    // 模拟 Tauri pathExists: 假设 /Users/me/vault/projects/foo.md 存在
    pathExistsImpl = (p: string) => {
      console.log('  pathExists called with:', p);
      return Promise.resolve(p === '/Users/me/vault/projects/foo.md');
    };

    const loadFile = vi.fn().mockResolvedValue(undefined);
    setWikilinkLoadFile(loadFile);

    const { container } = render(
      <WikilinkLink target="projects/foo">projects/foo</WikilinkLink>,
    );
    const btn = container.querySelector('button');
    expect(btn).not.toBeNull();
    console.log('  currentPath:', useDocStore.getState().state.currentPath);

    await act(async () => {
      fireEvent.click(btn as HTMLElement);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    console.log('  loadFile called with:', loadFile.mock.calls);
    console.log('  toasts:', useToastStore.getState().items);
    console.log('  pathExists called with:', vi.mocked(pathExists).mock.calls.map(c => c[0]));

    expect(loadFile).toHaveBeenCalledWith('/Users/me/vault/projects/foo.md');
  });
});

/**
 * R-31 修复验证: 用户的真实 vault 文件 (research-openai-dreaming-memory.md).
 *
 * 历史:
 *   - 用户在 /Users/tshinjeii/Documents/Obsidian Vault/wiki/sources/research-openai-dreaming-memory.md
 *   - 文件含 [[wiki/entities/openai]] (vault-root-relative 写法)
 *   - 旧版: path.posix.join('/vault/wiki/sources', 'wiki/entities/openai.md')
 *     = /vault/wiki/sources/wiki/entities/openai.md (双前缀, 文件不存在)
 *   - R-31 修复: 当 target 第一段 = candidate 末段时, 剥除 target 第一段
 *     candidate=/vault/wiki, target=wiki/entities/openai → joinedTarget=entities/openai
 *     → /vault/wiki/entities/openai.md ✓
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';

import { setWikilinkLoadFile } from '../../lib/wikilink/loadFileRef';
// 在 vitest 环境 (Node) 下使用 fs 检查真实文件存在. 生产环境 (browser) 不进入该代码路径.
// @ts-expect-error -- node:fs 类型在生产环境不可用, 仅 vitest 测试使用.
import { existsSync } from 'node:fs';

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
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
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

const VAULT = '/Users/tshinjeii/Documents/Obsidian Vault';
const CURRENT_FILE = `${VAULT}/wiki/sources/research-openai-dreaming-memory.md`;

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
    state: { currentPath: CURRENT_FILE, content: '', title: '', dirty: false },
    history: [],
    cursor: -1,
  });
  useToastStore.setState({ items: [] });
  pathExistsImpl = null;
  vi.mocked(pathExists).mockClear();
}

describe('T28 R-31 修复: 用户真实 vault 端到端', () => {
  beforeEach(() => resetStores());

  it('sanity: 用户真实文件路径在 fs 中存在', () => {
    // 这是一个 sanity check, 帮助我们确认 vitest 环境能访问用户文件.
    expect(existsSync(CURRENT_FILE)).toBe(true);
  });

  it('user: [[concepts/memory-in-agent]] (无 wiki/ 前缀) → 跳到 wiki/concepts/memory-in-agent.md', async () => {
    const target = 'concepts/memory-in-agent';
    const expectedPath = `${VAULT}/wiki/concepts/memory-in-agent.md`;
    expect(existsSync(expectedPath)).toBe(true);

    // 真实 pathExists (用 fs 替代 mock)
    pathExistsImpl = (p: string) => Promise.resolve(existsSync(p));
    const loadFile = vi.fn().mockResolvedValue(undefined);
    setWikilinkLoadFile(loadFile);

    const { container } = render(<WikilinkLink target={target}>{target}</WikilinkLink>);
    await act(async () => {
      fireEvent.click(container.querySelector('button') as HTMLElement);
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(loadFile).toHaveBeenCalledWith(expectedPath);
  });

  it('user: [[wiki/entities/openai]] (vault-root-relative) → R-31 修复后能跳到 wiki/entities/openai.md', async () => {
    const target = 'wiki/entities/openai';
    const expectedPath = `${VAULT}/wiki/entities/openai.md`;
    expect(existsSync(expectedPath)).toBe(true);

    pathExistsImpl = (p: string) => Promise.resolve(existsSync(p));
    const loadFile = vi.fn().mockResolvedValue(undefined);
    setWikilinkLoadFile(loadFile);

    const { container } = render(<WikilinkLink target={target}>{target}</WikilinkLink>);
    await act(async () => {
      fireEvent.click(container.querySelector('button') as HTMLElement);
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    // 关键: 必须是 /vault/wiki/entities/openai.md, 而不是双前缀的
    // /vault/wiki/sources/wiki/entities/openai.md
    expect(loadFile).toHaveBeenCalledWith(expectedPath);
  });

  it('user: [[raw/research/...md]] (vault root 同级) → 跳到 raw/research/...md', async () => {
    const target = 'raw/research/openai/2026-06-04-dreaming-better-memory-for-a-more-helpful-chatgpt.md';
    const expectedPath = `${VAULT}/${target}`;
    expect(existsSync(expectedPath)).toBe(true);

    pathExistsImpl = (p: string) => Promise.resolve(existsSync(p));
    const loadFile = vi.fn().mockResolvedValue(undefined);
    setWikilinkLoadFile(loadFile);

    const { container } = render(<WikilinkLink target={target}>{target}</WikilinkLink>);
    await act(async () => {
      fireEvent.click(container.querySelector('button') as HTMLElement);
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(loadFile).toHaveBeenCalledWith(expectedPath);
  });
});

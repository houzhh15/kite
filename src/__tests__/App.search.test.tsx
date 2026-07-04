/**
 * App 顶层 Layout 集成测试 (T10 step-7b).
 *
 * 设计依据: docs/design/compiled.md §3.5.1 / 需求 FR-01 + FR-04.
 *
 * 覆盖:
 *   - App 顶层挂载时 useKeyboard 注册 Ctrl/Cmd+F + Esc.
 *   - 任意时刻按 Ctrl+F → SearchBar 浮层出现.
 *   - Esc → SearchBar 关闭.
 *   - 切文档后, 旧 SearchBar 状态被清空.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { useState, type JSX } from 'react';

// 注: vi.mock 会被 hoisted 到 import 之前, 这里放在最上面更显式.
vi.mock('../lib/tauri', () => ({
  readMarkdownFile: vi.fn(),
  getRecentFiles: vi.fn().mockResolvedValue([]),
  addRecentFile: vi.fn().mockResolvedValue(undefined),
  clearRecentFiles: vi.fn().mockResolvedValue(undefined),
  setWindowTitle: vi.fn(() => Promise.resolve()),
  loadPreferences: vi.fn().mockResolvedValue({
    theme: 'system',
    fontSize: 16,
    lineHeight: 1.6,
    codeBlockTheme: 'github',
  }),
  savePreferences: vi.fn(),
  openExternalUrl: vi.fn(),
  resolveImagePath: vi.fn(),
  loadProgress: vi.fn().mockResolvedValue({
    lastPath: null,
    perFile: {},
    seenShortcutsHint: true,
  }),
  saveProgress: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue(null),
}));

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: () => Promise.resolve(() => {}),
  }),
}));

import App from '../App';
import { Reader } from '../components/Reader';
import { SearchBar } from '../components/SearchBar';
import { useDocStore } from '../stores/docStore';
import { __resetSearchForTest } from '../hooks/useSearch';
import { useKeyboard, unregisterSearchShortcuts } from '../hooks/useKeyboard';
import type { MarkdownState } from '../types/markdown';

beforeEach(() => {
  __resetSearchForTest();
  useDocStore.setState({
    state: { currentPath: null, content: '', title: '', dirty: false },
  });
});

afterEach(() => {
  cleanup();
  unregisterSearchShortcuts();
  vi.restoreAllMocks();
});

describe('App + Search (T10 step-7b)', () => {
  it('App 顶层挂载: SearchBar 默认隐藏', async () => {
    const { container } = render(<App />);
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector('[data-testid="search-bar"]')).toBeNull();
  });

  it('Ctrl+F 全局唤起 SearchBar (AC-01-1)', async () => {
    const { container } = render(<App />);
    await new Promise((r) => setTimeout(r, 30));
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'f',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector('[data-testid="search-bar"]')).toBeTruthy();
  });

  it('Esc 全局关闭 SearchBar (AC-04-1)', async () => {
    const { container } = render(<App />);
    await new Promise((r) => setTimeout(r, 30));
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'f',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector('[data-testid="search-bar"]')).toBeTruthy();
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(container.querySelector('[data-testid="search-bar"]')).toBeNull();
  });

  it('切文档: SearchBar 自动关闭 (走 Reader 内部 useSearch)', async () => {
    // 走真实场景: Reader 渲染 + useKeyboard 注册 + useSearch(content) 写 store.
    function KeyboardHost(): JSX.Element {
      useKeyboard();
      return <></>;
    }

    // 单次 render 内通过 state 切 content, 不卸载.
    function App2(): JSX.Element {
      const [content, setContent] = useState('hello world');
      const s: MarkdownState = {
        status: 'ok',
        doc: { content, path: '/x.md', title: 'X' },
        errorMessage: null,
      };
      return (
        <>
          <button type="button" data-testid="switch" onClick={() => setContent('goodbye world')}>
            switch
          </button>
          <Reader
            state={s}
            onRetry={() => undefined}
            onRenderError={() => undefined}
            onOpen={() => undefined}
          />
          <SearchBar />
          <KeyboardHost />
        </>
      );
    }
    const { container, getByTestId } = render(<App2 />);
    await new Promise((r) => setTimeout(r, 50));

    // 唤起 SearchBar.
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'f',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector('[data-testid="search-bar"]')).toBeTruthy();
    const input = container.querySelector('[data-testid="search-input"]') as HTMLInputElement | null;
    expect(input).toBeTruthy();
    if (input) {
      fireEvent.change(input, { target: { value: 'hello' } });
    }
    await new Promise((r) => setTimeout(r, 100));
    // 切文档: 通过 state 触发 Reader.content 变化 → useSearch 写 store → auto close.
    act(() => {
      getByTestId('switch').click();
    });
    await new Promise((r) => setTimeout(r, 100));
    // SearchBar 已被 useSearch 副作用关闭 (isOpen=false → null 渲染).
    expect(container.querySelectorAll('[data-testid="search-input"]').length).toBe(0);
  });
});
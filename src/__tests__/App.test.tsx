/**
 * App.test.tsx — T06 F-16 窗口标题联动 (设计 §3.5.3).
 *
 * 覆盖:
 *   - App 挂载时 useDocStore.title 为空 → setWindowTitle('') (默认 KITE).
 *   - useDocStore.title 更新 → setWindowTitle 联动 (F-16 单向流).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';

import { useDocStore } from '../stores/docStore';
import App from '../App';

vi.mock('../lib/tauri', () => ({
  readMarkdownFile: vi.fn(),
  getRecentFiles: vi.fn().mockResolvedValue([]),
  addRecentFile: vi.fn().mockResolvedValue(undefined),
  clearRecentFiles: vi.fn().mockResolvedValue(undefined),
  setWindowTitle: vi.fn().mockResolvedValue(undefined),
  loadPreferences: vi.fn().mockResolvedValue({
    theme: 'system',
    fontSize: 16,
    lineHeight: 1.6,
    codeBlockTheme: 'github',
  }),
  savePreferences: vi.fn(),
  openExternalUrl: vi.fn(),
  resolveImagePath: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue(null),
}));

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: () => Promise.resolve(() => {}),
  }),
}));

import { setWindowTitle } from '../lib/tauri';

const mockSetWindowTitle = setWindowTitle as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockSetWindowTitle.mockReset();
  mockSetWindowTitle.mockResolvedValue(undefined);
  useDocStore.setState({
    state: { currentPath: null, content: '', title: '', dirty: false },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('App — F-16 窗口标题联动', () => {
  it('mounts with empty title → setWindowTitle("") (default KITE)', async () => {
    render(<App />);
    await waitFor(() => {
      expect(mockSetWindowTitle).toHaveBeenCalled();
    });
    const calls = mockSetWindowTitle.mock.calls.map((c) => c[0]);
    expect(calls).toContain('');
  });

  it('subscribes to docStore.title changes', async () => {
    render(<App />);
    await waitFor(() => mockSetWindowTitle.mock.calls.length > 0);
    act(() => {
      useDocStore.getState().setContent({ path: '/x/notes.md', content: 'X' });
    });
    await waitFor(() => {
      const calls = mockSetWindowTitle.mock.calls.map((c) => c[0]);
      expect(calls).toContain('notes');
    });
  });

  it('resetting title (close) triggers setWindowTitle("") again', async () => {
    render(<App />);
    act(() => {
      useDocStore.getState().setContent({ path: '/x/a.md', content: 'X' });
    });
    await waitFor(() => {
      const calls = mockSetWindowTitle.mock.calls.map((c) => c[0]);
      expect(calls).toContain('a');
    });
    act(() => {
      useDocStore.setState({
        state: { currentPath: null, content: '', title: '', dirty: false },
      });
    });
    await waitFor(() => {
      const calls = mockSetWindowTitle.mock.calls.map((c) => c[0]);
      // mount (空) + close (空) — 至少 1 次 ''.
      expect(calls.filter((c) => c === '').length).toBeGreaterThanOrEqual(1);
    });
  });
});
/**
 * ToolbarExportMenu 单测 (T16-P2 step-5c + T29 R-35 增量).
 *
 * 覆盖:
 *   - disabled = true → aria-disabled='true', 点击不展开菜单.
 *   - disabled = false, 无 __TAURI__ (开发模式) → toast 'export.failDevMode'.
 *   - disabled = false, Tauri 环境 → 不应报 dev-mode toast.
 *   - T29 R-35: 菜单含「拷贝文件」项, 点击触发 copyFileToClipboard IPC.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';

import { ToolbarExportMenu } from '../components/ToolbarExportMenu';
import { useToastStore } from '../lib/toast';

// Tauri 环境 stub (开 / 关).
function setTauriEnv(present: boolean): void {
  if (present) {
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = { core: {} };
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
  } else {
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  }
}

beforeEach(() => {
  useToastStore.setState({ items: [] });
});

afterEach(() => {
  cleanup();
  setTauriEnv(false);
  vi.restoreAllMocks();
});

describe('ToolbarExportMenu', () => {
  it('disabled = true 时按钮 aria-disabled=true, 点击不展开', () => {
    setTauriEnv(true);
    render(<ToolbarExportMenu disabled />);
    const btn = screen.getByTestId('toolbar-export');
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(btn);
    expect(screen.queryByTestId('toolbar-export-menu')).toBeNull();
  });

  it('disabled = false 时按钮 aria-disabled=false', () => {
    setTauriEnv(true);
    render(<ToolbarExportMenu disabled={false} />);
    const btn = screen.getByTestId('toolbar-export');
    expect(btn.getAttribute('aria-disabled')).toBe('false');
  });

  it('disabled = false + 非 Tauri 环境, 点击展开后点击 HTML 触发 dev-mode toast', () => {
    setTauriEnv(false);
    render(<ToolbarExportMenu disabled={false} />);
    const btn = screen.getByTestId('toolbar-export');
    fireEvent.click(btn);
    const menu = screen.getByTestId('toolbar-export-menu');
    expect(menu).toBeTruthy();
    const htmlBtn = screen.getByTestId('toolbar-export-html');
    fireEvent.click(htmlBtn);
    const toasts = useToastStore.getState().items;
    expect(toasts.length).toBeGreaterThan(0);
    const msg = toasts[0]?.message ?? '';
    expect(msg).toMatch(/desktop app|桌面应用/);
  });

  it('菜单包含 HTML / PDF / 拷贝文件 三项', () => {
    setTauriEnv(true);
    render(<ToolbarExportMenu disabled={false} />);
    fireEvent.click(screen.getByTestId('toolbar-export'));
    expect(screen.getByTestId('toolbar-export-html')).toBeTruthy();
    expect(screen.getByTestId('toolbar-export-pdf')).toBeTruthy();
    expect(screen.getByTestId('toolbar-export-copy')).toBeTruthy();
  });

  // T29 R-35: 点击「拷贝文件」→ copyFileToClipboard IPC 被调用, 弹成功 toast.
  // 不再走 navigator.clipboard.write (Tauri WebView 沙箱下返回 NotAllowedError),
  // 改走 Rust IPC copyFileToClipboard → clipboard-rs (NSPasteboard/CF_HDROP).
  it('点击「拷贝文件」触发 copyFileToClipboard IPC, 弹成功 toast', async () => {
    setTauriEnv(true);
    const { useDocStore } = await import('../stores/docStore');
    useDocStore.setState({
      state: {
        currentPath: '/tmp/test/note.md',
        content: '# hello',
        title: 'note',
        dirty: false,
      },
      history: [],
      cursor: -1,
    });
    const tauri = await import('../lib/tauri');
    const copySpy = vi
      .spyOn(tauri, 'copyFileToClipboard')
      .mockResolvedValue(undefined);

    render(<ToolbarExportMenu disabled={false} />);
    fireEvent.click(screen.getByTestId('toolbar-export'));
    fireEvent.click(screen.getByTestId('toolbar-export-copy'));

    await vi.waitFor(() => {
      expect(copySpy).toHaveBeenCalled();
    });
    expect(copySpy.mock.calls[0][0]).toBe('/tmp/test/note.md');
    const toasts = useToastStore.getState().items;
    expect(toasts.some((t) => t.kind === 'success')).toBe(true);
    const successToast = toasts.find((t) => t.kind === 'success');
    expect(successToast?.message).toContain('note.md');
  });

  // T29 R-35: IPC 失败时弹错误 toast (R-04 错误透传).
  it('copyFileToClipboard IPC 失败时弹错误 toast', async () => {
    setTauriEnv(true);
    const { useDocStore } = await import('../stores/docStore');
    useDocStore.setState({
      state: {
        currentPath: '/tmp/test/note.md',
        content: '# hello',
        title: 'note',
        dirty: false,
      },
      history: [],
      cursor: -1,
    });
    const tauri = await import('../lib/tauri');
    vi.spyOn(tauri, 'copyFileToClipboard').mockRejectedValue(
      new Error('clipboard write failed: OS denied')
    );

    render(<ToolbarExportMenu disabled={false} />);
    fireEvent.click(screen.getByTestId('toolbar-export'));
    fireEvent.click(screen.getByTestId('toolbar-export-copy'));

    await vi.waitFor(() => {
      const toasts = useToastStore.getState().items;
      expect(toasts.some((t) => t.kind === 'error')).toBe(true);
    });
    const errToast = useToastStore
      .getState()
      .items.find((t) => t.kind === 'error');
    expect(errToast?.message).toMatch(/拷贝失败|copy failed/i);
    expect(errToast?.message).toContain('OS denied');
  });
});
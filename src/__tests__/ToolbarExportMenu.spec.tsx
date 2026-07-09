/**
 * ToolbarExportMenu 单测 (T16-P2 step-5c + T29 R-35 增量).
 *
 * 覆盖:
 *   - disabled = true → aria-disabled='true', 点击不展开菜单.
 *   - disabled = false, 无 __TAURI__ (开发模式) → toast 'export.failDevMode'.
 *   - disabled = false, Tauri 环境 → 不应报 dev-mode toast.
 *   - T29 R-35: 菜单含「拷贝文件」项, 点击触发 navigator.clipboard.write.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';

import { ToolbarExportMenu } from '../components/ToolbarExportMenu';
import { useToastStore } from '../lib/toast';

// Tauri 环境 stub (开 / 关).
function setTauriEnv(present: boolean): void {
  if (present) {
    // 同时设置 __TAURI__ (旧版标志) 与 __TAURI_INTERNALS__ (v2 标志, isTauri() 检查此标志).
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
    // 展开菜单.
    const menu = screen.getByTestId('toolbar-export-menu');
    expect(menu).toBeTruthy();
    const htmlBtn = screen.getByTestId('toolbar-export-html');
    fireEvent.click(htmlBtn);
    const toasts = useToastStore.getState().items;
    // 应至少有一条 toast, 含 dev-mode 文案.
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
    // T29 R-35: 拷贝文件菜单项.
    expect(screen.getByTestId('toolbar-export-copy')).toBeTruthy();
  });

  // T29 R-35: 拷贝文件点击 → navigator.clipboard.write 被调用, toast 成功.
  it('点击「拷贝文件」触发 navigator.clipboard.write, 弹成功 toast', async () => {
    setTauriEnv(true);
    // mock navigator.clipboard.write, 记录参数.
    const writeMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { write: writeMock },
      configurable: true,
      writable: true,
    });
    // mock ClipboardItem (jsdom 不支持).
    const originalClipboardItem = (globalThis as { ClipboardItem?: unknown }).ClipboardItem;
    (globalThis as { ClipboardItem?: unknown }).ClipboardItem = class {
      constructor(public data: Record<string, Blob>) {}
    };

    // 设置 docStore.currentPath + 注入 docStore.content.
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
    // mock readMarkdownFile IPC: 走 lib/tauri 的 safeInvoke → IPCUnavailableError (非 Tauri 端)
    // 但这里 setTauriEnv(true) 后 __TAURI__ 存在, safeInvoke 会调 invoke. 我们 stub 它.
    const tauri = await import('../lib/tauri');
    vi.spyOn(tauri, 'readMarkdownFile').mockResolvedValue('# hello');

    render(<ToolbarExportMenu disabled={false} />);
    fireEvent.click(screen.getByTestId('toolbar-export'));
    const copyBtn = screen.getByTestId('toolbar-export-copy');
    fireEvent.click(copyBtn);

    // 等待 async handler 完成.
    await vi.waitFor(() => {
      expect(writeMock).toHaveBeenCalled();
    });
    // ClipboardItem 应被构造 (File 对象传给 write).
    expect(writeMock.mock.calls[0][0]).toBeInstanceOf(Array);
    expect((writeMock.mock.calls[0][0] as unknown[]).length).toBe(1);
    // toast 至少一条 success.
    const toasts = useToastStore.getState().items;
    expect(toasts.some((t) => t.kind === 'success')).toBe(true);

    // cleanup.
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    if (originalClipboardItem) {
      (globalThis as { ClipboardItem?: unknown }).ClipboardItem = originalClipboardItem;
    } else {
      delete (globalThis as { ClipboardItem?: unknown }).ClipboardItem;
    }
  });
});
/**
 * ToolbarExportMenu 单测 (T16-P2 step-5c).
 *
 * 覆盖:
 *   - disabled = true → aria-disabled='true', 点击不展开菜单.
 *   - disabled = false, 无 __TAURI__ (开发模式) → toast 'export.failDevMode'.
 *   - disabled = false, Tauri 环境 → 不应报 dev-mode toast.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';

import { ToolbarExportMenu } from '../components/ToolbarExportMenu';
import { useToastStore } from '../lib/toast';

// Tauri 环境 stub (开 / 关).
function setTauriEnv(present: boolean): void {
  if (present) {
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = { core: {} };
  } else {
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
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

  it('菜单包含 HTML 与 PDF 两项', () => {
    setTauriEnv(true);
    render(<ToolbarExportMenu disabled={false} />);
    fireEvent.click(screen.getByTestId('toolbar-export'));
    expect(screen.getByTestId('toolbar-export-html')).toBeTruthy();
    expect(screen.getByTestId('toolbar-export-pdf')).toBeTruthy();
  });
});
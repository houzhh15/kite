/**
 * ToolbarExportMenu — T16-P2 (FR-01 / FR-02 / FR-04) 工具栏「导出」下拉.
 *
 * 设计依据: docs/design/compiled.md §3.3.2 + §3.3.3 + 需求 FR-01 / FR-02 / FR-04.
 *
 * 责任:
 *   - 渲染一个 <button aria-disabled> + 下拉两项 (HTML / PDF).
 *   - props.disabled = true (docStore.content 为空) → 整按钮 opacity 0.5,
 *     cursor not-allowed, aria-disabled='true', 点击 preventDefault + stopPropagation
 *     (AC-04-1).
 *   - props.disabled = false 且处于开发模式 (window.__TAURI__ 缺失)
 *     → 点击 HTML/PDF 直接 toast 'export.failDevMode', 不调任何 IPC (AC-04-2/3).
 *   - props.disabled = false 且 Tauri 环境 → 调用 buildHtml → exportHtml(payload);
 *     成功 toast 'export.successHtml' (FR-01 / AC-01-1).
 *   - PDF 走隐藏 iframe srcdoc + window.print(), 完成后清理 (FR-02 / AC-02-1~4).
 *
 * 边界:
 *   - 取消保存对话框 → 静默, 无 toast.
 *   - 失败 (IO / IO error) → toast 'export.failGeneric', message 来自 Rust.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDocStore } from '../stores/docStore';
import { exportHtml } from '../lib/tauri';
import { isTauri } from '../lib/env';
import { pushToast } from '../lib/toast';
import { buildHtml } from '../lib/exportHtml';

export interface ToolbarExportMenuProps {
  /** 空文档 / 加载中 → 整按钮 disabled 视觉态 (AC-04-1). */
  disabled: boolean;
  /** 主题 — 来自 useTheme; 默认 'light'. */
  theme?: 'light' | 'dark' | 'sepia';
}

export function ToolbarExportMenu({
  disabled,
  theme = 'light',
}: ToolbarExportMenuProps): JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const docStore = useDocStore();

  // 点击外部关闭.
  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent): void => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      if (e.target instanceof Node && wrap.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const showDevModeToast = (): void => {
    pushToast({ kind: 'error', message: t('export.failDevMode') });
  };

  const handleHtml = async (): Promise<void> => {
    setOpen(false);
    if (disabled) return;
    if (!isTauri()) {
      showDevModeToast();
      return;
    }
    // 取 docStore 内容.
    const content = docStore.state.content;
    const basePath = docStore.state.currentPath
      ? docStore.state.currentPath.replace(/[^/\\]+$/, '').replace(/[\/\\]$/, '') || null
      : null;
    const title = docStore.state.title;
    try {
      // 动态 import dialog plugin — 仅 Tauri 环境.
      const { save } = await import('@tauri-apps/plugin-dialog');
      const targetPath = await save({
        defaultPath: `${title || 'document'}.html`,
        filters: [{ name: 'HTML', extensions: ['html'] }],
      });
      if (!targetPath) return; // 用户取消.
      const html = await buildHtml({
        content,
        basePath,
        theme,
        cssVars: {},
        highlightCss: '',
        title,
      });
      await exportHtml({ content: html, targetPath });
      pushToast({
        kind: 'success',
        message: t('export.successHtml', { path: targetPath }),
      });
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === 'string'
            ? err
            : 'unknown';
      pushToast({
        kind: 'error',
        message: t('export.failGeneric', { message: msg }),
      });
    }
  };

  const handlePdf = async (): Promise<void> => {
    setOpen(false);
    if (disabled) return;
    if (!isTauri()) {
      showDevModeToast();
      return;
    }
    const content = docStore.state.content;
    const title = docStore.state.title;
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const targetPath = await save({
        defaultPath: `${title || 'document'}.pdf`,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (!targetPath) return; // 用户取消.

      // 创建隐藏 iframe, srcdoc = 渲染好的 HTML, 然后 contentWindow.print().
      const html = await buildHtml({
        content,
        basePath: null,
        theme,
        cssVars: {},
        highlightCss: '',
        title,
      });
      const iframe = document.createElement('iframe');
      iframe.setAttribute('aria-hidden', 'true');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      iframe.srcdoc = html;
      document.body.appendChild(iframe);

      iframe.addEventListener('load', () => {
        try {
          const cw = iframe.contentWindow;
          if (!cw) throw new Error('iframe contentWindow unavailable');
          const cleanup = (): void => {
            try {
              iframe.remove();
            } catch {
              /* noop */
            }
          };
          iframe.addEventListener('afterprint', cleanup, { once: true });
          cw.focus();
          cw.print();
          pushToast({
            kind: 'info',
            message: t('export.pdfHint', { path: targetPath }),
          });
        } catch (err) {
          try {
            iframe.remove();
          } catch {
            /* noop */
          }
          const msg = err instanceof Error ? err.message : 'print failed';
          pushToast({
            kind: 'error',
            message: t('export.failGeneric', { message: msg }),
          });
        }
      });
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === 'string'
            ? err
            : 'unknown';
      pushToast({
        kind: 'error',
        message: t('export.failGeneric', { message: msg }),
      });
    }
  };

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>): void => {
    if (disabled) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    setOpen((v) => !v);
  };

  const buttonClass =
    'rounded-md border border-fg/30 px-3 py-1.5 text-sm hover:bg-fg/5 ' +
    (disabled ? 'cursor-not-allowed opacity-50' : '');

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        data-testid="toolbar-export"
        aria-label={t('export.menu')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-disabled={disabled}
        disabled={disabled}
        onClick={handleClick}
        className={buttonClass}
      >
        {t('export.menu')}
      </button>
      {open && !disabled && (
        <div
          data-testid="toolbar-export-menu"
          role="menu"
          aria-label={t('export.menu')}
          className="absolute right-0 top-full z-40 mt-2 w-44 rounded-md border border-fg/20 bg-bg p-1 shadow-md"
        >
          <button
            type="button"
            role="menuitem"
            data-testid="toolbar-export-html"
            onClick={() => void handleHtml()}
            className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-fg/5"
          >
            {t('export.html')}
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="toolbar-export-pdf"
            onClick={() => void handlePdf()}
            className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-fg/5"
          >
            {t('export.pdf')}
          </button>
        </div>
      )}
    </div>
  );
}

export default ToolbarExportMenu;
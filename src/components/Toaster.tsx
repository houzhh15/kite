/**
 * Toaster — 全局 toast 列表渲染 (NFR-U-01 + T18 FR-02).
 *
 * 责任:
 *   - 监听 useToastStore.items;
 *   - 渲染一条列表; 每条 toast 5s 自动清;
 *   - error 级别走 `role="alert"`, 其它走 `role="status"`, 都用 aria-live.
 *   - 不调用 IPC, 不读 useMarkdownDoc.
 *
 * T18 (FR-02 / §3.4 P3):
 *   - 关闭按钮 aria-label 取自 t('common.closeNotification').
 *   - toast 文案 (message) 由各组件传入, 已在 Phase 1~2 处理 (t('app.*') / 'recent.*' / 'image.*').
 */

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useToastStore } from '../lib/toast';

const AUTO_DISMISS_MS = 5000;

/** 单条 toast. 自动 dismiss 在父级 Toaster 统一管理, 这里只渲染 + 暴露 close. */
function ToastRow(props: { id: string; kind: 'info' | 'success' | 'error'; message: string; onClose: () => void }): JSX.Element {
  const { kind, message, onClose } = props;
  const { t } = useTranslation();
  // error 立即宣告, info/success 仅 polite.
  const role = kind === 'error' ? 'alert' : 'status';
  const ariaLive = kind === 'error' ? 'assertive' : 'polite';
  const palette =
    kind === 'error'
      ? 'border-red-500 text-red-600'
      : kind === 'success'
        ? 'border-emerald-500 text-emerald-600'
        : 'border-fg/30 text-fg';
  return (
    <div
      data-testid="toast"
      data-toast-id={props.id}
      data-toast-kind={kind}
      role={role}
      aria-live={ariaLive}
      className={`flex items-start gap-3 rounded-md border bg-bg px-4 py-2 text-sm shadow-sm ${palette}`}
    >
      <span className="flex-1">{message}</span>
      <button
        type="button"
        onClick={onClose}
        aria-label={t('common.closeNotification')}
        className="text-xs opacity-60 hover:opacity-100"
      >
        ×
      </button>
    </div>
  );
}

export function Toaster(): JSX.Element {
  const items = useToastStore((s) => s.items);
  const clearToast = useToastStore((s) => s.clearToast);

  // 自动消失: 每条 toast 起一个 5s 定时器清理.
  useEffect(() => {
    if (items.length === 0) return;
    const timers = items.map((it) =>
      setTimeout(() => {
        clearToast(it.id);
      }, AUTO_DISMISS_MS),
    );
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [items, clearToast]);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
    >
      {items.map((it) => (
        <div key={it.id} className="pointer-events-auto">
          <ToastRow id={it.id} kind={it.kind} message={it.message} onClose={() => clearToast(it.id)} />
        </div>
      ))}
    </div>
  );
}

export default Toaster;
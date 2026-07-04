/**
 * useDialogFocusTrap — T12 通用 dialog 焦点陷阱 (设计 §3.6.6 / AC-06-1~3).
 *
 * 责任:
 *   - open=true 时记录 previousActiveElement, 焦点送入 dialog 第一可聚焦元素.
 *   - Tab / Shift+Tab 循环 (焦点不逃出 dialog).
 *   - Esc 触发 onEscape (默认 onClose).
 *   - open=false / 卸载时, 焦点回退到 previousActiveElement.
 *
 * 纪律:
 *   - 通用 hook; 不耦合到具体 store; 通过 containerRef 与 options 注入.
 *   - 与 Settings.tsx 内联实现等价; 此 hook 提供复用面.
 *   - SSR 安全: typeof document === 'undefined' 时直接返回.
 */
import { useEffect } from 'react';

export interface UseDialogFocusTrapOptions {
  /** dialog 容器 ref; null 时 hook 不挂副作用. */
  containerRef: React.RefObject<HTMLElement | null>;
  /** 是否启用陷阱. */
  active: boolean;
  /** Esc 回调; 默认 noop. */
  onEscape?: () => void;
  /** 焦点送入 dialog 时的初始 focus target selector; 默认第一可聚焦元素. */
  initialFocusSelector?: string;
}

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[role="radio"]:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function useDialogFocusTrap(opts: UseDialogFocusTrapOptions): void {
  const { containerRef, active, onEscape, initialFocusSelector } = opts;

  useEffect(() => {
    if (!active) return;
    if (typeof document === 'undefined') return;
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    // 下一帧送入焦点 (保证 dialog 已 commit).
    const raf = requestAnimationFrame(() => {
      let target: HTMLElement | null = null;
      if (initialFocusSelector) {
        target = container.querySelector<HTMLElement>(initialFocusSelector);
      }
      if (!target) {
        const focusables = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
        target = focusables[0] ?? null;
      }
      target?.focus();
    });

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onEscape?.();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusables = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !container.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', onKeyDown);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKeyDown);
      // 焦点回退: dialog 关闭后送回打开前的元素.
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
    };
  }, [active, containerRef, onEscape, initialFocusSelector]);
}

export default useDialogFocusTrap;
/**
 * ImageViewer — T08 step-4 (FR-3 / 设计 §3.2.2 / 计划 Step 4).
 *
 * 责任:
 *   - 全屏 fixed 模态 + Portal 渲染到 document.body
 *   - 监听 keydown: Esc → onClose (AC-3-2)
 *   - 遮罩点击 → onClose; 内部图片/工具栏不触发 (AC-3-2)
 *   - mount 时 body 滚动锁定 (overflow:hidden); unmount 0ms 恢复 (AC-3-2)
 *   - mount 时焦点落入关闭按钮 (NFR-U-2)
 *   - unmount 时焦点回到 previousFocus
 *   - 卸载时移除 keydown 监听与 body 样式 (NFR-U-2)
 *
 * 不依赖:
 *   - 不调 IPC; 不读 useDocStore.
 *   - 不读 imageCache (由父级 ImageHandler 解析后传 data URL).
 */

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

export interface ImageViewerProps {
  src: string;
  alt?: string;
  onClose: () => void;
}

export function ImageViewer(props: ImageViewerProps): JSX.Element | null {
  const { src, alt, onClose } = props;
  const { t } = useTranslation(); // T18 (FR-02 / §3.4 P1): dialog.imageViewer.*
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<Element | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    // 1) 记下触发元素, 用于关闭后恢复焦点 (NFR-U-1).
    previousFocusRef.current = document.activeElement;

    // 2) body 滚动锁定 (AC-3-2).
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // 3) 焦点落入关闭按钮 (NFR-U-2).
    // 等待一帧, 避免 dialog 还没挂载就被 focus 调用打断.
    const raf = requestAnimationFrame(() => {
      closeBtnRef.current?.focus();
    });

    // 4) Esc 键监听 (AC-3-2).
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey);
      // 卸载时 0ms 恢复 (AC-3-2).
      document.body.style.overflow = prevOverflow;
      const prev = previousFocusRef.current as HTMLElement | null;
      if (prev && typeof prev.focus === 'function') {
        prev.focus({ preventScroll: true });
      }
    };
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  // 遮罩点击: 仅当 target === overlay 时关闭; 内部图片 / 工具栏不关闭 (AC-3-2).
  const onOverlayClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (e.target === overlayRef.current) {
      onClose();
    }
  };

  const dialog = (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label={t('dialog.imageViewer.label')}
      data-testid="image-viewer"
      onClick={onOverlayClick}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0,0,0,0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'zoom-out',
      }}
    >
      <img
        src={src}
        alt={alt ?? ''}
        data-testid="image-viewer-img"
        style={{
          maxWidth: '90vw',
          maxHeight: '90vh',
          objectFit: 'contain',
          cursor: 'zoom-out',
        }}
        draggable={false}
        // 阻止图片自身 onClick 冒泡到 overlay 关闭
        onClick={(e) => e.stopPropagation()}
      />
      <button
        ref={closeBtnRef}
        type="button"
        aria-label={t('dialog.imageViewer.close')}
        data-testid="image-viewer-close"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        style={{
          position: 'fixed',
          right: 16,
          bottom: 16,
          zIndex: 10000,
          padding: '0.5em 0.9em',
          borderRadius: 6,
          background: 'rgba(0,0,0,0.7)',
          color: '#fff',
          border: '1px solid rgba(255,255,255,0.4)',
          font: 'inherit',
          cursor: 'pointer',
        }}
      >
        {t('common.close')}
      </button>
    </div>
  );

  return createPortal(dialog, document.body);
}

export default ImageViewer;

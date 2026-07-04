/**
 * DragOverlay — 拖拽覆盖层 (F-02 / 设计 §3.1.3 + T18 FR-02).
 *
 * 设计依据: docs/design/compiled.md §3.1.3 + docs/plan/compiled.md Step 5.
 *
 * 责任:
 *   - 用 MutationObserver 监听 <body> 的 `data-drag-active` 属性 (setDragActiveAttr 写入).
 *   - 属性 = "true" → 显示遮罩 (hidden=false); 属性被移除 → 隐藏 (hidden=true).
 *   - 全屏遮罩, 居中显示"释放以打开 Markdown".
 *
 * T18 (FR-02 / §3.4 P2): JSX 文本节点 `<div>释放以打开 Markdown</div>`
 *   替换为 `<div>{t('common.dropHint')}</div>`.
 *
 * 纪律:
 *   - 无状态 (useState 不必要, 直接走 ref + DOM 切换).
 *   - 单一职责, 不消费 store / toast, 不调用 IPC.
 *   - SSR safe: typeof window === 'undefined' 时直接 return null.
 *   - 不修改 useFileDrop / useMarkdownDoc.
 */

import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

const ATTR = 'data-drag-active';

function readActive(): boolean {
  if (typeof document === 'undefined') return false;
  return document.body.getAttribute(ATTR) === 'true';
}

export function DragOverlay(): JSX.Element | null {
  const ref = useRef<HTMLDivElement | null>(null);
  const { t } = useTranslation();

  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
    const el = ref.current;
    if (!el) return;
    // 初始化态
    if (readActive()) el.removeAttribute('hidden');
    else el.setAttribute('hidden', '');

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type !== 'attributes' || m.attributeName !== ATTR) continue;
        const on = readActive();
        if (on) el.removeAttribute('hidden');
        else el.setAttribute('hidden', '');
      }
    });
    observer.observe(document.body, { attributes: true, attributeFilter: [ATTR] });
    return () => observer.disconnect();
  }, []);

  if (typeof document === 'undefined') return null;

  return (
    <div ref={ref} className="drag-overlay" hidden aria-live="polite" role="status">
      <div>{t('common.dropHint')}</div>
    </div>
  );
}

export default DragOverlay;
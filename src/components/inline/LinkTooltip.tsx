/**
 * LinkTooltip — T07 外链点击瞬时浮层 (FR-17 / AC-17-1..4 + T18 FR-02).
 *
 * 设计依据: docs/design/compiled.md §3.6.2.
 *
 * T18 (FR-02 / §3.4 P2):
 *   - 文案 `'已在系统浏览器打开：${url}'` 替换为
 *     `t('common.externalOpened', { url })` 模板插值.
 *
 * 责任:
 *   - 订阅 useInlineStore.tooltip; 渲染 Portal 浮层到 document.body.
 *   - 位置: 鼠标指针上方 8 px, 水平居中; 右溢出时向左偏移避免越界.
 *   - 文案: 已在系统浏览器打开: {url}; > 60 字符截断 + …
 *   - 自动消失: 1.5 s 后 fade 200ms 然后 dismissTooltip.
 *   - 不重复弹出: tooltip.key 自增触发 React 重挂载 (已由 inlineStore 保证).
 *   - 不影响 preventDefault 逻辑: 仅 UI 反馈, 由 LinkHandler 先 dispatch.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { useInlineStore } from '../../stores/inlineStore';

const VISIBLE_MS = 1_500;
const FADE_MS = 200;
const MAX_URL_LEN = 60;

interface Position {
  x: number;
  y: number;
}

function clampToViewport(x: number, y: number): Position {
  if (typeof window === 'undefined') return { x, y };
  const w = window.innerWidth;
  // 浮层宽度估算: max-width 360px. 简单按 360 做镜像.
  const half = 180;
  let cx = x;
  if (cx + half > w - 8) cx = w - 8 - half;
  if (cx - half < 8) cx = half + 8;
  return { x: cx, y };
}

function truncateUrl(url: string, maxLen = MAX_URL_LEN): string {
  if (url.length <= maxLen) return url;
  return url.slice(0, maxLen) + '…';
}

export function LinkTooltip(): JSX.Element | null {
  const { t } = useTranslation();
  const tooltip = useInlineStore((s) => s.tooltip);
  const dismissTooltip = useInlineStore((s) => s.dismissTooltip);
  const [fading, setFading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!tooltip) {
      setFading(false);
      return;
    }
    // 每次 tooltip 出现, 起 1.5s 显示 + 200ms fade.
    if (timerRef.current) clearTimeout(timerRef.current);
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    setFading(false);
    timerRef.current = setTimeout(() => {
      setFading(true);
      fadeTimerRef.current = setTimeout(() => {
        dismissTooltip();
      }, FADE_MS);
    }, VISIBLE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    };
  }, [tooltip, dismissTooltip]);

  if (!tooltip || typeof document === 'undefined') return null;
  const pos = clampToViewport(tooltip.x, tooltip.y - 8);
  const url = truncateUrl(tooltip.url);

  return createPortal(
    <div
      data-testid="link-tooltip"
      data-fading={fading ? 'true' : 'false'}
      className="kite-link-tooltip"
      style={{
        left: `${pos.x}px`,
        top: `${pos.y}px`,
        transform: 'translate(-50%, calc(-100% - 8px))',
      }}
      role="status"
      aria-live="polite"
    >
      {t('common.externalOpened', { url })}
    </div>,
    document.body,
  );
}

export default LinkTooltip;
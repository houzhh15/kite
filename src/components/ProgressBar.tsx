/**
 * ProgressBar — T09 顶部细条进度指示器 (FR-04 / 设计 §3.5 + T18 FR-02).
 *
 * 设计依据: docs/design/compiled.md §3.5.
 *
 * 责任:
 *   - 渲染 Reader 顶部 2px 进度细条 (transform: scaleX, NFR-PERF-2).
 *   - 只读展示; 不计算进度, 由 useScrollSpy 传入 `value`.
 *   - `role="progressbar"` + `aria-valuemin/max/now` (NFR-A11Y-2).
 *   - `hideWhenIdle=true` 且 `value=0` (文档未溢出) 时返回 null (AC-04-4).
 *
 * T18 (FR-02 / §3.4 P3):
 *   - aria-label 取自 t('statusBar.progressLabel').
 *
 * 主题:
 *   - 颜色走 CSS 变量 `bg-accent`, light/dark/sepia 视觉一致 (NFR-THEME-1).
 *   - 无硬编码颜色.
 */

import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

export interface ProgressBarProps {
  /** 0..1 进度值. */
  value: number;
  /** 当 value=0 时是否隐藏 (默认 true, AC-04-4). */
  hideWhenIdle?: boolean;
  /** 顶部 / 底部 (默认 top). */
  position?: 'top' | 'bottom';
  className?: string;
}

export function ProgressBar({
  value,
  hideWhenIdle = true,
  position = 'top',
  className,
}: ProgressBarProps): JSX.Element | null {
  const { t } = useTranslation();
  const clamped = Math.max(0, Math.min(1, value));
  if (hideWhenIdle && value === 0) return null;

  const isTop = position === 'top';
  const style: CSSProperties = {
    transform: `scaleX(${clamped})`,
    transformOrigin: 'left center',
    willChange: 'transform',
    top: isTop ? 0 : undefined,
    bottom: !isTop ? 0 : undefined,
  };

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
      aria-label={t('statusBar.progressLabel')}
      data-testid="progress-bar"
      data-position={position}
      data-progress={clamped.toFixed(3)}
      className={`kite-progressbar pointer-events-none absolute left-0 right-0 h-0.5 bg-accent ${className ?? ''}`.trim()}
      style={style}
    />
  );
}

export default ProgressBar;
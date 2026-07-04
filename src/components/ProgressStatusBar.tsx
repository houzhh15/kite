/**
 * ProgressStatusBar — T09 状态栏百分比 / 字数 / 行数 (FR-04 / 设计 §3.6 + T18 FR-02).
 *
 * 设计依据: docs/design/compiled.md §3.6.
 *
 * 责任:
 *   - 渲染「进度 42% · 3,250 字 · 128 行」状态栏片段.
 *   - 字数 / 行数在 Markdown 切换时计算一次 (`useMemo`), 不每次滚动重算 (AC-04-3).
 *   - 进度数字取 `progress` 经 `Math.round`, 文档未溢出时进度 0% (AC-04-4).
 *   - 文末判稳由 useScrollSpy 保证 (progress=1 → 100%).
 *
 * T18 (FR-02 / §3.4 P3):
 *   - STATUS_PROGRESS_FMT / WORDS_LINES_FMT 函数替换为
 *     t('statusBar.progressFmt', { n }) / t('statusBar.wordsLinesFmt', { words, lines }).
 *   - 保留 data-testid="progress-status-bar" 兼容 e2e (T18-E03).
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

function formatNumber(n: number): string {
  // 1,000 -> 1,000 ; 3250 -> 3,250
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function countWordsAndLines(md: string): { words: number; lines: number } {
  if (!md) return { words: 0, lines: 0 };
  let words = 0;
  for (const ch of md) {
    if (!/\s/.test(ch)) words += 1;
  }
  const lines = md.split('\n').filter((l) => l.trim().length > 0).length;
  return { words, lines };
}

export interface ProgressStatusBarProps {
  /** 0..1 进度 (来自 useScrollSpy). */
  progress: number;
  /** Markdown 源串 (用于字数 / 行数). */
  content: string;
  /** 自定义 className. */
  className?: string;
}

export function ProgressStatusBar({
  progress,
  content,
  className,
}: ProgressStatusBarProps): JSX.Element {
  const { t } = useTranslation(); // T18 (FR-02 / §3.4 P3): statusBar.*Fmt 模板插值.
  const safeProgress = Math.max(0, Math.min(1, progress));
  const percentInt = Math.round(safeProgress * 100);

  // 字数 / 行数仅在 content 引用变化时计算.
  const { words, lines } = useMemo(() => countWordsAndLines(content), [content]);

  return (
    <span
      data-testid="progress-status-bar"
      data-progress={safeProgress.toFixed(3)}
      aria-live="polite"
      className={`kite-status-progress whitespace-nowrap text-fg/70 ${className ?? ''}`.trim()}
    >
      <span>{t('statusBar.progressFmt', { n: percentInt })}</span>
      <span aria-hidden="true"> · </span>
      <span>{t('statusBar.wordsLinesFmt', { words: formatNumber(words), lines })}</span>
    </span>
  );
}

export default ProgressStatusBar;
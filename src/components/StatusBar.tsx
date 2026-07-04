/**
 * StatusBar — 底部状态栏 (FR-16 容器).
 *
 * 设计依据: docs/design/compiled.md §3.6.1 + FR-16.
 *
 * 当前形态:
 *   - 左侧: <ProgressStatusBar /> (T09 / FR-04).
 *   - 中间: <HistoryIndicator /> (T15 / FR-04) — 显示 cursor+1 / total.
 *   - 右侧: <ExternalDomainChip /> (T07).
 */
import { useTranslation } from 'react-i18next';

import { ExternalDomainChip } from './StatusBar/ExternalDomainChip';
import { ProgressStatusBar } from './ProgressStatusBar';
import { useDocStore } from '../stores/docStore';

export interface StatusBarProps {
  /** 0..1 阅读进度 (来自 useScrollSpy). */
  progress: number;
  /** 当前文档 Markdown 源串 (供字数 / 行数计算). */
  content: string;
}

export function StatusBar({ progress, content }: StatusBarProps): JSX.Element {
  return (
    <footer
      role="contentinfo"
      data-testid="status-bar"
      className="flex shrink-0 items-center justify-between gap-2 border-t border-fg/20 px-4 py-1 text-xs"
    >
      <ProgressStatusBar progress={progress} content={content} />
      <HistoryIndicator />
      <ExternalDomainChip />
    </footer>
  );
}

/** T15 (FR-04) 历史指示器: 显示 cursor+1 / history.length. */
export function HistoryIndicator(): JSX.Element | null {
  const { t } = useTranslation();
  const cursor = useDocStore((s) => s.cursor);
  const historyLength = useDocStore((s) => s.history.length);
  if (historyLength <= 0) return null;
  return (
    <span
      data-testid="history-indicator"
      aria-label="History position"
      className="rounded border border-border px-2 py-0.5 text-muted"
    >
      {t('history.indicator', { current: cursor + 1, total: historyLength })}
    </span>
  );
}

export default StatusBar;

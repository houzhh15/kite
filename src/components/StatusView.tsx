/**
 * StatusView — 4 个状态视图子组件 (设计 §3.3.4).
 *
 *   <EmptyState onOpen>      - 初始空状态, 含次级打开按钮.
 *   <LoadingView>            - 加载中提示.
 *   <ErrorView message onRetry> - 错误提示 + 重试.
 *   <MarkdownView content>   - 渲染器包装 (含 <MarkdownRenderer>).
 *
 * T18 (FR-02 / §3.4 P0):
 *   - 全部文案改用 useTranslation() + t('status.*') 取值.
 *   - 保留 data-testid="empty-state" 兼容 e2e (T18-E01).
 *
 * 纪律:
 *   - 不调 IPC.
 *   - 全部使用 Tailwind 语义化 token.
 */
import { useTranslation } from 'react-i18next';

import MarkdownRenderer from './MarkdownRenderer';

export interface EmptyStateProps {
  onOpen: () => void;
}

export function EmptyState({ onOpen }: EmptyStateProps): JSX.Element {
  const { t } = useTranslation();
  return (
    <section
      data-testid="empty-state"
      role="region"
      aria-label={t('status.emptyTitle')}
      className="flex h-full flex-col items-center justify-center gap-4 text-center"
    >
      <h2 className="text-xl font-medium opacity-80">{t('status.emptyTitle')}</h2>
      <p className="text-sm opacity-60">{t('status.emptySubtitle')}</p>
      <button
        type="button"
        onClick={onOpen}
        aria-label={t('status.emptyOpen')}
        className="rounded-md border border-fg/30 px-4 py-2 text-sm hover:bg-fg/5"
      >
        {t('status.emptyOpen')}
      </button>
    </section>
  );
}

export function LoadingView(): JSX.Element {
  const { t } = useTranslation();
  return (
    <div
      data-testid="loading-view"
      role="status"
      aria-live="polite"
      className="flex h-full items-center justify-center text-sm opacity-70"
    >
      <span className="animate-pulse">{t('status.loading')}</span>
    </div>
  );
}

export interface ErrorViewProps {
  message: string;
  onRetry: () => void;
}

export function ErrorView({ message, onRetry }: ErrorViewProps): JSX.Element {
  const { t } = useTranslation();
  return (
    <section
      data-testid="error-view"
      role="alert"
      aria-live="assertive"
      className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center"
    >
      <div className="rounded-md border border-red-500/60 bg-bg px-4 py-3 text-sm text-red-600 dark:text-red-400">
        {message}
      </div>
      <button
        type="button"
        onClick={onRetry}
        aria-label={t('status.retry')}
        className="rounded-md border border-fg/30 px-4 py-2 text-sm hover:bg-fg/5"
      >
        {t('status.retry')}
      </button>
    </section>
  );
}

export interface MarkdownViewProps {
  content: string;
}

export function MarkdownView({ content }: MarkdownViewProps): JSX.Element {
  return (
    <section data-testid="markdown-view" className="h-full overflow-y-auto">
      <MarkdownRenderer content={content} />
    </section>
  );
}
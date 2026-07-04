/**
 * Reader — 状态分发 (设计 §3.3.3).
 *
 *   - 按 state.status 选择 4 个视图之一.
 *   - ok 态外包 <ErrorBoundary>: 渲染期抛出的 React error (例如插件 panic) 通过
 *     onRenderError 传回 useMarkdownDoc, 由 hook 切到 OPEN_ERR.
 *   - 不调 IPC.
 *   - T07 (FR-11 衍生): 顶层 useEffect 监听 popstate, 初始 hash 触发锚点滚动.
 *   - T09 (FR-02/03/04): MarkdownView 内嵌入 <Outline>, <ProgressBar>,
 *     useMarkdownOutline, useScrollSpy; 暴露 onCurrentChange 供 T11 持久化.
 *   - T10 (FR-11): MarkdownView 用 useSearch(content) 写 store, 用 <SearchHighlight>
 *     包裹 MarkdownRenderer 做命中高亮注入.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ErrorInfo } from 'react';
import { useTranslation } from 'react-i18next';
import type { MarkdownState } from '../types/markdown';
import { EmptyState, ErrorView, LoadingView } from './StatusView';
import { ErrorBoundary } from './ErrorBoundary';
import { slugify } from '../lib/inline/slugify';
import { Outline } from './Outline';
import { ProgressBar } from './ProgressBar';
import { MarkdownRenderer } from './MarkdownRenderer';
import { SearchHighlight } from '../lib/searchHighlight';
import { useMarkdownOutline } from '../hooks/useMarkdownOutline';
import { useScrollSpy } from '../hooks/useScrollSpy';
import { useSearch } from '../hooks/useSearch';
import {
  mark as perfMark,
  measure as perfMeasure,
  isPerfDisabled,
} from '../lib/perf';
import {
  registerOutlineIds,
  clearOutlineIdPool,
} from './inline/HeadingAnchor';

export interface ReaderProps {
  state: MarkdownState;
  onRetry: () => void;
  onRenderError: (err: Error, info: ErrorInfo) => void;
  onOpen: () => void;
  /** T09: 滚动 / current 变化回调, T11 接入 lastPosition. */
  onCurrentChange?: (id: string | null, progress: number) => void;
  /** T09: 文档标题 (用于 Outline 顶部展示, 来自 useDocStore.title). */
  docTitle?: string;
  /** T09: 进度变化回调 (供 StatusBar 复用). */
  onProgressChange?: (progress: number) => void;
  /** T11: 当 OK 状态, Reader 内部 MarkdownView 挂载完成后回调. */
  onMounted?: () => void;
}

/** 滚动到当前 hash 对应的锚点. 静默失败 (无 target 时仅 warn). */
function scrollToHash(): void {
  if (typeof window === 'undefined') return;
  const raw = window.location.hash || '';
  if (!raw || raw === '#') return;
  const id = slugify(raw.slice(1));
  if (!id) return;
  const target = document.getElementById(id);
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else {
    console.warn(`[Reader] initial anchor not found: ${id}`);
  }
}

export function Reader({
  state,
  onRetry,
  onRenderError,
  onOpen,
  onCurrentChange,
  docTitle,
  onProgressChange,
  onMounted,
}: ReaderProps): JSX.Element {
  const { t } = useTranslation(); // T18 (FR-02): 兜底错误文案 t('status.errorUnknown').
  // T07: 初始 hash 触发锚点滚动 + popstate 监听 (FR-11 衍生).
  useEffect(() => {
    if (state.status !== 'ok') return;
    // 等待 markdown 渲染完成一帧再滚动 (目标 id 才存在)
    const id = requestAnimationFrame(() => {
      scrollToHash();
    });
    const onPop = (): void => scrollToHash();
    window.addEventListener('popstate', onPop);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener('popstate', onPop);
    };
  }, [state.status]);

  const errorBoundaryOrPassthrough = (child: JSX.Element): JSX.Element =>
    state.status === 'ok' ? (
      <ErrorBoundary onError={onRenderError}>{child}</ErrorBoundary>
    ) : (
      child
    );

  let view: JSX.Element;
  switch (state.status) {
    case 'ok': {
      const doc = state.doc;
      view = doc ? (
        <MarkdownViewWithOutline
          content={doc.content}
          title={docTitle}
          onCurrentChange={onCurrentChange}
          onProgressChange={onProgressChange}
          onMounted={onMounted}
        />
      ) : (
        <LoadingView />
      );
      break;
    }
    case 'loading':
      view = <LoadingView />;
      break;
    case 'error':
      view = <ErrorView message={state.errorMessage ?? t('status.errorUnknown')} onRetry={onRetry} />;
      break;
    case 'idle':
    default:
      view = <EmptyState onOpen={onOpen} />;
      break;
  }

  return (
    <main
      id="main-content"
      data-testid="reader"
      className="reader flex h-full min-h-0 flex-1 flex-col overflow-hidden"
    >
      {errorBoundaryOrPassthrough(view)}
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/* MarkdownView 包装: 嵌入 Outline + ProgressBar + useMarkdownOutline +       */
/* useScrollSpy + useSearch + SearchHighlight. 拆分到独立组件以隔离 hook 状态. */
/* -------------------------------------------------------------------------- */

interface MarkdownViewWithOutlineProps {
  content: string;
  title?: string;
  onCurrentChange?: (id: string | null, progress: number) => void;
  onProgressChange?: (progress: number) => void;
  onMounted?: () => void;
}

function MarkdownViewInner({
  content,
  title,
  onCurrentChange,
  onProgressChange,
  onMounted,
}: MarkdownViewWithOutlineProps): JSX.Element {
  const outline = useMarkdownOutline(content);

  // 把 outline ids 灌入 HeadingAnchor 共享池, 保证 DOM id 与 outline id 一致.
  useEffect(() => {
    clearOutlineIdPool();
    registerOutlineIds(outline.map((o) => o.id));
    return () => {
      clearOutlineIdPool();
    };
  }, [outline]);

  // T10: useSearch 写入 content 到 store; 命中/hits 在此可消费.
  const { hits, currentIndex, query, options } = useSearch(content);

  // 稳定传给 SearchHighlight 的 props (避免引用每次重建触发 effect).
  const highlightProps = useMemo(
    () => ({
      hits,
      currentIndex,
      patternQuery: query,
      patternCaseSensitive: !!options.caseSensitive,
      patternWholeWord: !!options.wholeWord,
      patternRegex: !!options.regex,
    }),
    [hits, currentIndex, query, options.caseSensitive, options.wholeWord, options.regex],
  );

  const sectionRef = useRef<HTMLElement | null>(null);
  // headings: 收集 article 内的 h1..h6[id]
  const [headings, setHeadings] = useState<HTMLElement[]>([]);

  useEffect(() => {
    const sec = sectionRef.current;
    if (!sec) {
      setHeadings([]);
      return;
    }
    const article = sec.querySelector('article[data-testid="markdown-article"]');
    if (!article) {
      setHeadings([]);
      return;
    }
    const nodes = Array.from(
      article.querySelectorAll<HTMLElement>('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]'),
    );
    setHeadings(nodes);
    // T11: content 渲染完成 + headings 收集完毕 → 通知 App 可执行 scrollTo (FR-10).
    // T13 (FR-08 / D-08): 同帧触发 first_paint 埋点 + measure 'cold_to_paint'.
    if (onMounted || !isPerfDisabled()) {
      // 双 RAF, 等 MarkdownRenderer 的最终 commit + scrollHeight 稳定.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!isPerfDisabled()) {
            perfMark('first_paint');
            const dur = perfMeasure('cold_to_paint', 'cold_start', 'first_paint');
            if (import.meta.env.DEV) {
              console.timeEnd('cold_to_paint');
            }
            if (Number.isFinite(dur) && dur > 0) {
              console.info('[perf] cold_to_paint:', dur.toFixed(1), 'ms');
            }
          }
          if (onMounted) onMounted();
        });
      });
    }
  }, [content, outline, onMounted]);

  const { currentId, progress } = useScrollSpy({
    container: sectionRef.current,
    headings,
    onCurrentChange,
    rootMargin: '0px 0px -60% 0px',
  });

  // 把 progress 透传给 StatusBar 等顶层消费者.
  useEffect(() => {
    if (onProgressChange) onProgressChange(progress);
  }, [progress, onProgressChange]);

  return (
    <section
      ref={sectionRef}
      data-testid="markdown-view"
      className="relative flex h-full min-h-0 w-full overflow-hidden"
    >
      <div className="flex h-full w-full min-h-0">
        <Outline outline={outline} currentId={currentId} title={title} />
        <div className="min-h-0 flex-1 overflow-y-auto" data-testid="reader-scroll-container">
          <SearchHighlight {...highlightProps}>
            <MarkdownRenderer content={content} />
          </SearchHighlight>
        </div>
      </div>
      {/* 顶部细条进度: 覆盖在阅读区顶部 */}
      <ProgressBar value={progress} position="top" />
    </section>
  );
}

function MarkdownViewWithOutline({
  content,
  title,
  onCurrentChange,
  onProgressChange,
  onMounted,
}: MarkdownViewWithOutlineProps): JSX.Element {
  // 用 useMemo 防止父级无关 props 改变时重建 outline/progress 计算.
  const memoContent = useMemo(() => content, [content]);
  return (
    <MarkdownViewInner
      content={memoContent}
      title={title}
      onCurrentChange={onCurrentChange}
      onProgressChange={onProgressChange}
      onMounted={onMounted}
    />
  );
}

export default Reader;

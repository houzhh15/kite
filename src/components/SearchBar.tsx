/**
 * SearchBar — T10 页内查找浮层 UI (设计 §3.2 / §7 / §9.2 + T18 FR-02).
 *
 * 设计依据: docs/design/compiled.md §3.2 + §5 + §7 + 需求 FR-01..06.
 *
 * 责任:
 *   - 浮层结构: 输入框 + 计数 + 上下按钮 + 关闭按钮 + 选项 chips.
 *   - 不接收 props; 内部直接调 useSearch() (单例 store, 多组件共享).
 *     不传 content: SearchBar 是纯消费者, content 由 Reader 持有并写入 store.
 *   - Enter / Shift+Enter 拦截键盘事件, 触发 next / prev.
 *   - isOpen=false 时返回 null, 不挂载到 DOM (AC-04-1 / NFR-04-2).
 *   - 焦点由 SearchBar 自己负责: isOpen=true 时 input 挂载, useEffect 注入 focus + select.
 *     避免 useSearch.open() 通过 ref 同步的时序耦合.
 *   - 选项 chip 非法正则时边框变红 (AC-05-3).
 *
 * T18 (FR-02 / §3.4 P2):
 *   - 删除本地 TEXT 常量, 改为 useTranslation() + t('search.*') 取值.
 *   - countText 通过 t('search.countFmt', { current, total }) 插值.
 *   - 保留 data-testid="search-bar" / "search-input" 兼容 e2e (T18-E04).
 *
 * 可访问性 (AC-06-2 / F-34):
 *   - role="search" / aria-label
 *   - 输入框 aria-label 与 placeholder 都用 t('search.placeholder')
 *   - 按钮 aria-label 使用 t('search.prev/next/close')
 *   - 计数 aria-live="polite"
 *   - tab 顺序: 输入框 → 大小写 → 整词 → 正则 → 上 → 下 → 关闭
 */
import { memo, useEffect, type JSX } from 'react';
import { useTranslation } from 'react-i18next';

import { useSearch } from '../hooks/useSearch';

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

function SearchBarOuter(): JSX.Element | null {
  const {
    query,
    setQuery,
    options,
    setOption,
    count,
    currentIndex,
    isOpen,
    next,
    prev,
    close,
    invalidRegex,
    inputRef,
  } = useSearch();
  const { t } = useTranslation(); // T18 (FR-02 / §3.4 P2): search.*

  // isOpen=false → 不挂载 (NFR-04-2 / AC-04-1).
  if (!isOpen) return null;

  const countText =
    count > 0
      ? t('search.countFmt', { current: currentIndex + 1, total: count })
      : t('search.countFmt', { current: 0, total: 0 });
  const navDisabled = count === 0;

  return (
    <SearchBarInner
      query={query}
      setQuery={setQuery}
      options={options}
      setOption={setOption}
      count={count}
      onNext={next}
      onPrev={prev}
      onClose={close}
      invalidRegex={invalidRegex}
      inputRef={inputRef}
      countText={countText}
      navDisabled={navDisabled}
      t={t}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Inner — 拆出以便 isOpen=true 时挂载, useEffect 自动 focus.                  */
/* -------------------------------------------------------------------------- */

interface SearchBarInnerProps {
  query: string;
  setQuery: (q: string) => void;
  options: { caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean };
  setOption: <K extends keyof SearchBarInnerProps['options']>(k: K, v: boolean) => void;
  count: number;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
  invalidRegex: boolean;
  inputRef: React.RefObject<HTMLInputElement>;
  countText: string;
  navDisabled: boolean;
  /** T18: t 函数由 outer 注入, 避免 inner 重复 useTranslation() hook. */
  t: ReturnType<typeof useTranslation>['t'];
}

function SearchBarInner({
  query,
  setQuery,
  options,
  setOption,
  count,
  invalidRegex,
  inputRef,
  countText,
  navDisabled,
  onNext,
  onPrev,
  onClose,
  t,
}: SearchBarInnerProps): JSX.Element {
  // 挂载后自动 focus + select 输入框 (AC-01-1).
  // 用 useEffect 而非 useLayoutEffect: jsdom 中 useEffect 在 commit 后稳定触发,
  // 真实 WebView 中差别仅几毫秒.
  useEffect(() => {
    const el = inputRef.current;
    if (el) {
      el.focus();
      el.select();
    }
  }, [inputRef]);

  return (
    <div
      role="search"
      aria-label={t('search.containerLabel')}
      data-testid="search-bar"
      data-open="true"
      className="search-bar fixed right-4 top-16 z-50 flex max-w-[90vw] flex-col gap-2 rounded-lg border border-fg/15 bg-bg/95 p-2 shadow-lg backdrop-blur transition-opacity duration-100"
    >
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          type="text"
          aria-label={t('search.inputLabel')}
          aria-invalid={invalidRegex || undefined}
          aria-controls="search-bar-count"
          data-testid="search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (e.shiftKey) onPrev();
              else onNext();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            }
          }}
          placeholder={t('search.placeholder')}
          spellCheck={false}
          autoComplete="off"
          className={`search-bar__input min-w-[12rem] flex-1 rounded border bg-transparent px-2 py-1 text-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${
            invalidRegex ? 'border-red-500' : 'border-fg/20'
          }`}
        />
        <span
          id="search-bar-count"
          aria-live="polite"
          data-testid="search-count"
          className={`search-bar__count min-w-[3.5rem] px-1 text-center text-xs tabular-nums ${
            count > 0 ? 'text-fg' : 'text-fg/50'
          }`}
        >
          {countText}
        </span>
        <button
          type="button"
          aria-label={t('search.prev')}
          data-testid="search-prev"
          onClick={onPrev}
          disabled={navDisabled}
          className="search-bar__btn rounded p-1 text-sm hover:bg-fg/10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          ↑
        </button>
        <button
          type="button"
          aria-label={t('search.next')}
          data-testid="search-next"
          onClick={onNext}
          disabled={navDisabled}
          className="search-bar__btn rounded p-1 text-sm hover:bg-fg/10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          ↓
        </button>
        <button
          type="button"
          aria-label={t('search.close')}
          data-testid="search-close"
          onClick={onClose}
          className="search-bar__btn rounded p-1 text-sm hover:bg-fg/10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
        >
          ×
        </button>
      </div>
      <div role="group" aria-label={t('search.optionGroupLabel')} className="flex items-center gap-1">
        <OptionChip
          active={!!options.caseSensitive}
          label={t('search.caseSensitive')}
          testId="search-case"
          onToggle={() => setOption('caseSensitive', !options.caseSensitive)}
        />
        <OptionChip
          active={!!options.wholeWord}
          label={t('search.wholeWord')}
          testId="search-whole-word"
          onToggle={() => setOption('wholeWord', !options.wholeWord)}
        />
        <OptionChip
          active={!!options.regex}
          label={t('search.regex')}
          testId="search-regex"
          invalid={invalidRegex}
          hint={invalidRegex ? t('search.regexInvalid') : undefined}
          onToggle={() => setOption('regex', !options.regex)}
        />
      </div>
    </div>
  );
}

interface OptionChipProps {
  active: boolean;
  label: string;
  testId: string;
  invalid?: boolean;
  hint?: string;
  onToggle: () => void;
}

function OptionChip({ active, label, testId, invalid, hint, onToggle }: OptionChipProps): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        role="switch"
        aria-checked={active}
        aria-label={label}
        aria-invalid={invalid || undefined}
        data-testid={testId}
        data-active={active ? 'true' : 'false'}
        onClick={onToggle}
        className={`rounded px-2 py-0.5 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${
          active
            ? 'bg-accent text-bg'
            : invalid
              ? 'border border-red-500 text-fg/80 hover:bg-fg/5'
              : 'border border-fg/20 text-fg/80 hover:bg-fg/5'
        }`}
      >
        {label}
      </button>
      {hint ? (
        <span
          data-testid={`${testId}-hint`}
          className="text-[10px] text-red-500"
          role="status"
        >
          {hint}
        </span>
      ) : null}
    </span>
  );
}

export const SearchBar = memo(SearchBarOuter);
export default SearchBar;
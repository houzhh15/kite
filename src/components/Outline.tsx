/**
 * Outline — T09 侧边目录组件 (FR-02 / FR-05 / 设计 §3.4).
 *
 * 设计依据: docs/design/compiled.md §3.4 + docs/plan/compiled.md §4.1.
 *
 * 责任:
 *   - 渲染可折叠的树形侧边目录.
 *   - 缩进按 level 递增 (1..6 → 0..60px).
 *   - 列表项点击 → `document.getElementById(id)?.scrollIntoView` (AC-02-2).
 *   - 当前项高亮 + `aria-current="location"` + accent 左侧条 (AC-02-3).
 *   - 阅读 → 大纲方向: currentId 变化时仅当该项不在 Outline 视口内时才
 *     `scrollIntoView({block:'nearest'})`, 150ms debounce (AC-05-2/3).
 *   - 键盘: ArrowUp/Down/Home/End/Enter/Space 焦点管理 (AC-02-5, AC-05-1).
 *   - ≥ 200 项时启用简单窗口化 (fixed itemHeight=28, ±10 padding), DOM 节点数 ≤ ~50.
 *   - `React.memo` 包裹 (NFR-PERF-4).
 *
 * 文案 i18n 占位 (T15 回填):
 *   - "目录"        → outline.title
 *   - "无目录"      → outline.empty
 *   - "展开/折叠目录" → outline.toggleLabel
 */

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { useTranslation } from 'react-i18next';

import type { OutlineItem } from '../lib/outline';

const ITEM_INDENT_PX = 12;
const MAX_LEVEL_PAD_PX = (6 - 1) * ITEM_INDENT_PX; // 60px
const VIRTUAL_ITEM_HEIGHT = 28; // px
const VIRTUAL_PADDING = 10; // ± 行数
const VIRT_THRESHOLD = 200; // 启用虚拟窗口化的阈值

export interface OutlineProps {
  /** 文档标题 (用于面板顶部显示). */
  title?: string;
  /** 默认宽度 (px), 默认 240. */
  width?: number;
  /** 折叠态非受控初始值 (默认 false = 展开). */
  defaultCollapsed?: boolean;
  /** 折叠态变化回调 (受控模式时使用). */
  onCollapsedChange?: (collapsed: boolean) => void;
  /** currentId (来自 useScrollSpy). */
  currentId: string | null;
  /** 大纲条目. */
  outline: ReadonlyArray<OutlineItem>;
  /** 受控折叠态 (可选). */
  collapsed?: boolean;
  className?: string;
}

/* -------------------------------------------------------------------------- */

function OutlineInner({
  title,
  width = 240,
  defaultCollapsed = false,
  collapsed: collapsedProp,
  onCollapsedChange,
  currentId,
  outline,
  className,
}: OutlineProps): JSX.Element {
  const { t } = useTranslation(); // T18 (FR-02 / §3.4 P0): outline.title / empty / toggleExpand / toggleCollapse.
  const isControlled = collapsedProp !== undefined;
  const [internalCollapsed, setInternalCollapsed] = useState(defaultCollapsed);
  const collapsed = isControlled ? collapsedProp : internalCollapsed;

  const setCollapsed = useCallback(
    (next: boolean) => {
      if (!isControlled) setInternalCollapsed(next);
      onCollapsedChange?.(next);
    },
    [isControlled, onCollapsedChange],
  );

  const toggle = useCallback(() => setCollapsed(!collapsed), [collapsed, setCollapsed]);

  // ----- 键盘 / 焦点管理 -----
  const focusedIndexRef = useRef<number>(-1);
  const itemRefs = useRef<Map<string, HTMLLIElement>>(new Map());
  const listRef = useRef<HTMLUListElement>(null);

  const focusIndex = useCallback(
    (idx: number) => {
      if (outline.length === 0) return;
      const clamped = Math.max(0, Math.min(outline.length - 1, idx));
      focusedIndexRef.current = clamped;
      const item = outline[clamped];
      if (!item) return;
      const el = itemRefs.current.get(item.id);
      if (el) el.focus();
    },
    [outline],
  );

  const scrollToId = useCallback((id: string): void => {
    if (typeof document === 'undefined') return;
    const target = document.getElementById(id);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (typeof window !== 'undefined' && window.history?.replaceState) {
        try {
          window.history.replaceState(null, '', `#${id}`);
        } catch {
          // ignore
        }
      }
    } else {
      console.warn(`[Outline] anchor not found for id: ${id}`);
    }
  }, []);

  const handleItemClick = useCallback(
    (e: MouseEvent<HTMLLIElement>, id: string): void => {
      e.preventDefault();
      scrollToId(id);
    },
    [scrollToId],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLUListElement>): void => {
      const idx = focusedIndexRef.current;
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          focusIndex(idx + 1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          focusIndex(idx - 1);
          break;
        case 'Home':
          e.preventDefault();
          focusIndex(0);
          break;
        case 'End':
          e.preventDefault();
          focusIndex(outline.length - 1);
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          if (idx >= 0 && idx < outline.length) {
            const item = outline[idx];
            if (item) scrollToId(item.id);
          }
          break;
        default:
          break;
      }
    },
    [focusIndex, outline, scrollToId],
  );

  // 当 outline 切换后, 让焦点跟随 currentId.
  useEffect(() => {
    if (!currentId) return;
    const idx = outline.findIndex((i) => i.id === currentId);
    if (idx >= 0) focusedIndexRef.current = idx;
  }, [outline, currentId]);

  // ----- 阅读 → 大纲方向: scrollIntoView 防抖 (150ms) -----
  useEffect(() => {
    if (!currentId) return;
    const list = listRef.current;
    if (!list) return;
    const li = itemRefs.current.get(currentId);
    if (!li) return;

    const id = window.setTimeout(() => {
      // 二次校验 currentId (防抖期间可能又变).
      const cur = itemRefs.current.get(currentId);
      const listEl = listRef.current;
      if (!cur || !listEl) return;
      const lr = listEl.getBoundingClientRect();
      const ir = cur.getBoundingClientRect();
      const fullyVisible = ir.top >= lr.top && ir.bottom <= lr.bottom;
      if (!fullyVisible) {
        cur.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }, 150);
    return () => window.clearTimeout(id);
  }, [currentId]);

  // ----- 虚拟滚动: 计算可视范围 -----
  const useVirtual = outline.length >= VIRT_THRESHOLD;
  const [scrollTop, setScrollTop] = useState(0);
  const viewportRef = useRef<HTMLDivElement>(null);

  const onListScroll = useCallback(() => {
    if (!viewportRef.current) return;
    setScrollTop(viewportRef.current.scrollTop);
  }, []);

  const { first, last, padTop, padBottom } = useMemo(() => {
    if (!useVirtual) {
      return { first: 0, last: outline.length, padTop: 0, padBottom: 0 };
    }
    const vp = viewportRef.current;
    const vpHeight = vp?.clientHeight ?? 0;
    const start = Math.max(0, Math.floor(scrollTop / VIRTUAL_ITEM_HEIGHT) - VIRTUAL_PADDING);
    const end = Math.min(
      outline.length,
      Math.ceil((scrollTop + vpHeight) / VIRTUAL_ITEM_HEIGHT) + VIRTUAL_PADDING,
    );
    return {
      first: start,
      last: end,
      padTop: start * VIRTUAL_ITEM_HEIGHT,
      padBottom: Math.max(0, (outline.length - end) * VIRTUAL_ITEM_HEIGHT),
    };
  }, [useVirtual, scrollTop, outline.length]);

  // ----- 渲染 -----
  const wrapWidth = collapsed ? 32 : width;

  return (
    <aside
      role="tree"
      aria-label={t('outline.title')}
      aria-multiselectable={false}
      data-testid="outline"
      data-collapsed={collapsed}
      data-width={wrapWidth}
      data-count={outline.length}
      className={`kite-outline shrink-0 overflow-hidden border-r border-fg/15 bg-bg text-fg ${className ?? ''}`.trim()}
      style={{ width: wrapWidth, transition: 'width 120ms ease' }}
    >
      <header className="kite-outline__header flex items-center justify-between gap-1 px-2 py-2">
        {!collapsed && (
          <span
            data-testid="outline-title"
            className="truncate text-sm opacity-80"
            title={title ?? t('outline.title')}
          >
            {title ?? t('outline.title')}
          </span>
        )}
        <button
          type="button"
          aria-label={collapsed ? t('outline.toggleExpand') : t('outline.toggleCollapse')}
          aria-expanded={!collapsed}
          aria-controls="kite-outline-list"
          data-testid="outline-toggle"
          onClick={toggle}
          className="rounded p-1 text-sm hover:bg-fg/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {collapsed ? '▶' : '◀'}
        </button>
      </header>

      {!collapsed && (
        <div
          ref={viewportRef}
          onScroll={onListScroll}
          data-testid="outline-viewport"
          className="kite-outline__viewport h-[calc(100%-2.5rem)] overflow-y-auto"
        >
          {outline.length === 0 ? (
            <p
              data-testid="outline-empty"
              className="px-3 py-3 text-xs opacity-60"
              aria-live="polite"
            >
              {t('outline.empty')}
            </p>
          ) : (
            <ul
              id="kite-outline-list"
              ref={listRef}
              role="presentation"
              tabIndex={-1}
              onKeyDown={handleKeyDown}
              data-testid="outline-list"
              className="kite-outline__list"
            >
              {useVirtual && padTop > 0 && (
                <li aria-hidden="true" style={{ height: padTop }} />
              )}
              {outline.slice(first, last).map((item) => {
                const isCurrent = item.id === currentId;
                const padPx = Math.min(MAX_LEVEL_PAD_PX, (item.level - 1) * ITEM_INDENT_PX);
                const style: CSSProperties = { paddingLeft: padPx };
                return (
                  <li
                    key={item.id}
                    ref={(el) => {
                      if (el) itemRefs.current.set(item.id, el);
                      else itemRefs.current.delete(item.id);
                    }}
                    role="treeitem"
                    aria-level={item.level}
                    aria-selected={isCurrent}
                    aria-current={isCurrent ? 'location' : undefined}
                    data-testid="outline-item"
                    data-outline-id={item.id}
                    data-level={item.level}
                    data-current={isCurrent ? 'true' : 'false'}
                    tabIndex={0}
                    onClick={(e) => handleItemClick(e, item.id)}
                    onFocus={() => {
                      focusedIndexRef.current = outline.findIndex(
                        (i) => i.id === item.id,
                      );
                    }}
                    style={style}
                    className={`kite-outline__item flex h-[28px] cursor-pointer items-center truncate border-l-2 border-transparent text-sm outline-none hover:bg-fg/5 focus-visible:bg-fg/10 focus-visible:ring-1 focus-visible:ring-accent ${
                      isCurrent ? 'border-accent font-semibold text-accent' : ''
                    }`}
                  >
                    <span className="truncate" title={item.text}>
                      {item.text}
                    </span>
                  </li>
                );
              })}
              {useVirtual && padBottom > 0 && (
                <li aria-hidden="true" style={{ height: padBottom }} />
              )}
            </ul>
          )}
        </div>
      )}
    </aside>
  );
}

export const Outline = memo(OutlineInner);
export default Outline;

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
 *   - 右侧拖拽手柄: 调整宽度, 持久化到 localStorage (`kite.outline.width`, 160..600 px).
 *   - `React.memo` 包裹 (NFR-PERF-4).
 *
 * 文案 i18n 占位 (T18):
 *   - "目录"        → outline.title
 *   - "无目录"      → outline.empty
 *   - "展开/折叠目录" → outline.toggleExpand / toggleCollapse
 *   - resizeLabel   → outline.resizeLabel (拖拽手柄 aria-label)
 */

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
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

/** Outline 拖拽宽度限制 (px). */
const MIN_OUTLINE_WIDTH = 160;
const MAX_OUTLINE_WIDTH = 600;
const DEFAULT_OUTLINE_WIDTH = 240;
const OUTLINE_WIDTH_STORAGE_KEY = 'kite.outline.width';

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

/** 从 localStorage 读取持久化宽度, 不可用或非法时回退默认值. */
function readStoredWidth(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(OUTLINE_WIDTH_STORAGE_KEY);
    if (!raw) return null;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n)) return null;
    return Math.min(MAX_OUTLINE_WIDTH, Math.max(MIN_OUTLINE_WIDTH, n));
  } catch {
    return null;
  }
}

/** 写入持久化宽度. 失败时静默忽略 (隐私模式 / 配额耗尽 / SSR). */
function writeStoredWidth(width: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(OUTLINE_WIDTH_STORAGE_KEY, String(Math.round(width)));
  } catch {
    // ignore — UI 偏好持久化失败不应阻塞交互
  }
}

function OutlineInner({
  title,
  width: widthProp = DEFAULT_OUTLINE_WIDTH,
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

  // ----- 宽度 (持久化到 localStorage) -----
  const [width, setWidth] = useState<number>(() => {
    const stored = readStoredWidth();
    return stored ?? widthProp;
  });
  const dragOriginRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const onResizePointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      // 仅响应主指针按钮; 防止右键 / 中键误触发.
      if (e.button !== 0) return;
      e.preventDefault();
      dragOriginRef.current = { startX: e.clientX, startWidth: width };
      const target = e.currentTarget;
      try {
        target.setPointerCapture(e.pointerId);
      } catch {
        // 部分环境下 setPointerCapture 抛错, 忽略并不影响后续 move/up.
      }
    },
    [width],
  );

  const onResizePointerMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    const origin = dragOriginRef.current;
    if (!origin) return;
    const delta = e.clientX - origin.startX;
    const next = Math.min(
      MAX_OUTLINE_WIDTH,
      Math.max(MIN_OUTLINE_WIDTH, origin.startWidth + delta),
    );
    setWidth(next);
  }, []);

  const onResizePointerUp = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      const origin = dragOriginRef.current;
      dragOriginRef.current = null;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      if (!origin) return;
      // 仅在发生实际拖动后落盘 (避免 focus-only 误写).
      const delta = e.clientX - origin.startX;
      if (Math.abs(delta) >= 1) {
        const finalWidth = Math.min(
          MAX_OUTLINE_WIDTH,
          Math.max(MIN_OUTLINE_WIDTH, origin.startWidth + delta),
        );
        writeStoredWidth(finalWidth);
      }
    },
    [],
  );

  // 拖拽期间禁用文字选中 / 切换全局 cursor 样式.
  const [isDragging, setIsDragging] = useState(false);
  useEffect(() => {
    if (!isDragging) return;
    const prev = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    return () => {
      document.body.style.userSelect = prev;
      document.body.style.cursor = prevCursor;
    };
  }, [isDragging]);

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
      className={`kite-outline relative shrink-0 overflow-hidden border-r border-fg/15 bg-bg text-fg ${className ?? ''}`.trim()}
      style={{ width: wrapWidth, transition: isDragging ? 'none' : 'width 120ms ease' }}
    >
      <header className="kite-outline__header flex items-center justify-between gap-1 border-b border-fg/15 px-3 py-2">
        {!collapsed && (
          <span
            data-testid="outline-title"
            className="truncate px-1 text-sm opacity-80"
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
              className="ml-2 mr-3 py-3 text-xs opacity-60"
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
                // 8px 视觉内边距, 通过内嵌 span 的 margin 体现 (不污染 paddingLeft,
                // 避免与 Outline.test.tsx 中 `style.paddingLeft === '0px'` 的契约冲突).
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
                    className={`kite-outline__item flex h-[28px] cursor-pointer items-center truncate border-l-2 border-transparent py-1.5 text-sm outline-none hover:bg-fg/5 focus-visible:bg-fg/10 focus-visible:ring-1 focus-visible:ring-accent ${
                      isCurrent ? 'border-accent font-semibold text-accent' : ''
                    }`}
                  >
                    <span className="ml-2 mr-3 truncate" title={item.text}>
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

      {/* 右侧拖拽手柄: 仅展开时显示, 折叠时不占交互位. */}
      {!collapsed && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t('outline.resizeLabel')}
          aria-valuemin={MIN_OUTLINE_WIDTH}
          aria-valuemax={MAX_OUTLINE_WIDTH}
          aria-valuenow={Math.round(width)}
          data-testid="outline-resize-handle"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            setIsDragging(true);
            onResizePointerDown(e);
          }}
          onPointerMove={onResizePointerMove}
          onPointerUp={(e) => {
            setIsDragging(false);
            onResizePointerUp(e);
          }}
          onPointerCancel={(e) => {
            setIsDragging(false);
            dragOriginRef.current = null;
            try {
              e.currentTarget.releasePointerCapture(e.pointerId);
            } catch {
              // ignore
            }
          }}
          className="kite-outline__resize absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize select-none touch-none hover:bg-accent/40 focus:bg-accent/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
      )}
    </aside>
  );
}

export const Outline = memo(OutlineInner);
export default Outline;

/**
 * RecentDirList — T25 (F-27) 最近目录列表组件.
 *
 * 设计依据: docs/design/compiled.md §3.1 / §3.4.2 / FR-04 + docs/plan/compiled.md Step 4.
 *
 * 行为:
 *   - 从 useRecentDirsStore 取 items + loaded.
 *   - items.length === 0 → 整块不渲染 (隐藏标题与列表).
 *   - 否则渲染:
 *       「── 或从历史选择 ──」标题
 *       列表项 (icon + basename + 相对时间 + × 按钮) 按 lastOpenedAt 倒序
 *       底部「清空全部」按钮
 *   - 点击列表项 → 调 onSelect(path) 回调 (父组件 App.tsx 走 setTreeRootPath, 不重复 add).
 *   - × 按钮 → window.confirm 二次确认 → useRecentDirsStore.remove(path).
 *   - 「清空全部」→ window.confirm → useRecentDirsStore.clear().
 *   - 相对时间: useMemo + Intl.RelativeTimeFormat, 阈值表与需求 FR-06 对齐.
 *   - 键盘可达: role="menuitem" + Tab/Enter/Space; title={path} 完整路径 tooltip.
 *
 * 职责: 严格只读 store, 不直接调 IPC; 写操作走 store.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useRecentDirsStore, MAX_RECENT_DIRS } from '../stores/recentDirsStore';
import { usePrefStore } from '../stores/prefStore';
import type { RecentDir } from '../lib/tauri';

export interface RecentDirListProps {
  /** 点击列表项回调 (父组件透传到 App.tsx 的 setTreeRootPath). */
  onSelect: (path: string) => void;
}

/** 阈值 (ms) — 与需求 FR-06 / 设计 §3.4.2 对齐. */
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS; // 设计阈值表用 30 天作为「更早」分界.

interface RelativeResult {
  /** 数字. */
  value: number;
  /** 阈值单位 (Intl.RelativeTimeFormat 接受 'second' | 'minute' | ...). */
  unit: Intl.RelativeTimeFormatUnit;
}

/**
 * 计算相对时间. 返回 { value, unit } 交给 Intl.RelativeTimeFormat 渲染.
 * ≥ 30 天 → 返回 null (调用方回退到绝对日期).
 */
function relativeOf(isoTs: string, now: number = Date.now()): RelativeResult | null {
  const t = Date.parse(isoTs);
  if (Number.isNaN(t)) return null;
  const diff = now - t;
  if (diff < MINUTE_MS) return { value: -Math.round(diff / 1000), unit: 'second' };
  if (diff < HOUR_MS) return { value: -Math.round(diff / MINUTE_MS), unit: 'minute' };
  if (diff < DAY_MS) return { value: -Math.round(diff / HOUR_MS), unit: 'hour' };
  if (diff < WEEK_MS) return { value: -Math.round(diff / DAY_MS), unit: 'day' };
  if (diff < MONTH_MS) return { value: -Math.round(diff / WEEK_MS), unit: 'week' };
  return null; // 调用方回退到绝对日期.
}

/** 简短的绝对日期 (locale-aware). 客户端只展示「月/日」即可. */
function formatAbsolute(isoTs: string, locale: string): string {
  const d = new Date(isoTs);
  if (Number.isNaN(d.getTime())) return isoTs;
  return new Intl.DateTimeFormat(locale, {
    month: 'numeric',
    day: 'numeric',
  }).format(d);
}

export function RecentDirList({ onSelect }: RecentDirListProps): JSX.Element | null {
  const { t } = useTranslation();
  const items = useRecentDirsStore((s) => s.items);
  const loaded = useRecentDirsStore((s) => s.loaded);
  const removeDir = useRecentDirsStore((s) => s.remove);
  const clearDirs = useRecentDirsStore((s) => s.clear);
  const language = usePrefStore((s) => s.prefs.language);

  // 相对时间 formatter (locale 与 store.language 同步; 切换语言时 useMemo 重算).
  const rtf = useMemo(() => {
    return new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
  }, [language]);

  // items 已按 lastOpenedAt 倒序 (Rust 端保证; 前端 push 立即置顶). 防御性再排一次.
  const sorted = useMemo(() => {
    return [...items].sort((a, b) => {
      const ta = Date.parse(a.lastOpenedAt);
      const tb = Date.parse(b.lastOpenedAt);
      return tb - ta;
    });
  }, [items]);

  // 整块隐藏: 未加载完成 或 items 为空.
  if (!loaded || sorted.length === 0) {
    return null;
  }

  const handleItemClick = (item: RecentDir): void => {
    onSelect(item.path);
  };

  const handleItemKey = (e: React.KeyboardEvent, item: RecentDir): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(item.path);
    }
  };

  const handleDeleteClick = (e: React.MouseEvent, item: RecentDir): void => {
    e.stopPropagation(); // 阻止冒泡到外层 item click.
    // 二次确认 (设计 §3.4.3).
    const ok = window.confirm(t('recentDir.deleteConfirm'));
    if (!ok) return;
    void removeDir(item.path);
  };

  const handleClearClick = (): void => {
    const ok = window.confirm(t('recentDir.clearConfirm'));
    if (!ok) return;
    void clearDirs();
  };

  return (
    <div
      data-testid="recent-dir-list"
      role="group"
      aria-label={t('recentDir.title')}
      className="mt-6 w-full max-w-xs"
    >
      <div className="mb-2 flex items-center gap-2 text-xs text-muted">
        <span className="h-px flex-1 bg-fg/15" />
        <span>{t('tree.historySection')}</span>
        <span className="h-px flex-1 bg-fg/15" />
      </div>
      <ul
        data-testid="recent-dir-items"
        className="flex flex-col gap-0.5 text-sm"
      >
        {sorted.map((item) => {
          const rel = relativeOf(item.lastOpenedAt);
          const label = rel
            ? rtf.format(rel.value, rel.unit)
            : formatAbsolute(item.lastOpenedAt, language);
          return (
            <li
              key={item.path}
              role="none"
              data-testid="recent-dir-item"
            >
              <div
                role="menuitem"
                tabIndex={0}
                aria-label={`${t('recentDir.open')} ${item.displayName} (${label})`}
                title={item.path}
                onClick={() => handleItemClick(item)}
                onKeyDown={(e) => handleItemKey(e, item)}
                className="group flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-fg/10 focus:bg-fg/10 focus:outline-none focus:ring-2 focus:ring-fg/40"
              >
                <span className="mr-1 text-muted" aria-hidden="true">📁</span>
                <span className="flex-1 truncate">{item.displayName}</span>
                <span className="shrink-0 text-xs text-muted">{label}</span>
                <button
                  type="button"
                  role="button"
                  data-testid="recent-dir-item-delete"
                  aria-label={`${t('recentDir.delete')} ${item.displayName}`}
                  title={t('recentDir.delete')}
                  onClick={(e) => handleDeleteClick(e, item)}
                  className="ml-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted opacity-60 hover:bg-fg/15 hover:text-red-500 hover:opacity-100 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-fg/40"
                >
                  <span aria-hidden="true">×</span>
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          data-testid="recent-dir-clear"
          onClick={handleClearClick}
          className="rounded-sm px-2 py-1 text-xs text-red-500 hover:bg-red-500/10 dark:text-red-400"
        >
          {t('recentDir.clear')}
        </button>
      </div>
      <div className="sr-only" data-testid="recent-dir-list-cap">
        {sorted.length}/{MAX_RECENT_DIRS}
      </div>
    </div>
  );
}

export default RecentDirList;

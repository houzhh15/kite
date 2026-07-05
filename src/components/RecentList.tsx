/**
 * RecentList — 最近文件列表 UI (F-03 / T06 + T18 FR-02).
 *
 * 设计依据: docs/design/compiled.md §3.6 + docs/plan/compiled.md Step 7.
 *
 * T18 (FR-02):
 *   - 5 处硬编码替换为 useTranslation() + t('recent.*') 取值.
 *   - toast 文案统一在 recentStore 内通过 i18n.t 抛出 (避免组件重复).
 *
 * 行为:
 *   - 从 useRecentStore 取 items + loaded.
 *   - items.length === 0 && loaded: 显示空状态 + 打开文件按钮.
 *   - 否则渲染列表 (行高 32px, hover / focus / role="menuitem" / title={path}).
 *   - 点击列表项 → 复用 useMarkdownDoc.open().
 *   - 底部「清空最近文件」按钮: 空状态时 disabled; 否则触发
 *     window.confirm → 用户确认 → useRecentStore.clearRecent(); 执行中 disabled.
 *   - 键盘可达: 列表项 Tab/Enter; Esc 由外层 Toolbar/Dropdown 处理.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useRecentStore } from '../stores/recentStore';
import { useMarkdownDoc } from '../hooks/useMarkdownDoc';
import type { RecentItem } from '../types/recent';

export interface RecentListProps {
  /** 从外层 (Toolbar/Dropdown) 注入的打开文件回调; 列表项点击时调用. */
  onOpen?: () => void;
}

export function RecentList({ onOpen }: RecentListProps): JSX.Element {
  const { t } = useTranslation();
  const items = useRecentStore((s) => s.items);
  const loaded = useRecentStore((s) => s.loaded);
  const clearRecent = useRecentStore((s) => s.clearRecent);
  // T19: 走 useMarkdownDoc.loadFile 直达 (不再 open() 弹 dialog), 兼顾 history 记录.
  const { open: openFile, loadFile } = useMarkdownDoc();
  const [clearing, setClearing] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Esc 关闭外层抽屉 (NFR-03): 触发自定义事件让父组件监听.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const ev = new CustomEvent('kite:recent-list-escape');
        el.dispatchEvent(ev);
      }
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, []);

  const handleOpen = async (item: RecentItem): Promise<void> => {
    onOpen?.();
    // 关键修复: 把 item.path 交给 useMarkdownDoc.loadFile; 它会复用
    // runOpenRef 链路 (OPEN_START → OPEN_OK → pushRecent → setLastPath)
    // 并额外写 useDocStore.history 使 Toolbar ← → 按钮可导航.
    // 之前 openFile() 总弹 dialog, 用户体验断了.
    await loadFile(item.path);
  };

  const handleClear = async (): Promise<void> => {
    // FR-07 / AC-04: window.confirm 二次确认, 文案固定 (T18 翻译键).
    const ok = window.confirm(t('recent.clearConfirmMessage'));
    if (!ok) return;
    setClearing(true);
    try {
      await clearRecent();
    } finally {
      setClearing(false);
    }
  };

  const isEmpty = items.length === 0;

  return (
    <div
      ref={containerRef}
      data-testid="recent-list"
      role="menu"
      aria-label={t('recent.clearConfirmTitle')}
      className="flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 rounded-md border border-fg/20 bg-bg p-2 shadow-md"
    >
      {loaded && isEmpty ? (
        <div
          data-testid="recent-list-empty"
          role="presentation"
          className="flex flex-col items-center gap-2 px-4 py-6 text-center text-sm opacity-70"
        >
          <span>{t('recent.empty')}</span>
          <button
            type="button"
            role="menuitem"
            data-testid="recent-list-open"
            onClick={() => {
              void openFile();
            }}
            className="rounded-md border border-fg/30 px-3 py-1 text-sm hover:bg-fg/5"
          >
            {t('recent.openFile')}
          </button>
        </div>
      ) : (
        <ul
          data-testid="recent-list-items"
          role="presentation"
          className="flex max-h-80 flex-col gap-0.5 overflow-y-auto"
        >
          {items.map((item) => (
            <li key={item.path} role="none">
              <button
                type="button"
                role="menuitem"
                data-testid="recent-list-item"
                title={item.path}
                onClick={() => {
                  void handleOpen(item);
                }}
                className="flex w-full items-center gap-2 truncate rounded-sm px-2 py-1.5 text-left text-sm hover:bg-fg/5 focus:bg-fg/10 focus:outline-none focus:ring-2 focus:ring-fg/40"
              >
                <span className="truncate">{item.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        data-testid="recent-list-clear"
        aria-label={t('recent.clear')}
        disabled={isEmpty || clearing}
        onClick={() => {
          void handleClear();
        }}
        className="self-end rounded-sm px-2 py-1 text-xs text-red-500 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-400"
      >
        {t('recent.clear')}
      </button>
    </div>
  );
}

export default RecentList;
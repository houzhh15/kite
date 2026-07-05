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
  /**
   * T20 (R-04 关键修复): 列表项点击 → 调用此回调传入选中的 path.
   *
   * **重要**: 必须由父级 (Toolbar → App.tsx) 注入, 不能让 RecentList 自己
   * `useMarkdownDoc()` 拿到一个独立的 hook 实例 —— 每个 useMarkdownDoc() 都有自己的
   * `useReducer` state, 只有 App.tsx 的实例绑定了 Reader 的 props. 之前版本
   * `RecentList` 自己调用 `useMarkdownDoc()` 调 `loadFile(item.path)` 仅更新
   * 自己内部的 reducer, App.tsx 的 reader 永远看不到新 doc, content / outline
   * 都是上一份文件. 修复: Toolbar 转发 App.tsx 的同一份 `loadFile` 下来.
   */
  onLoadFile?: (path: string) => void;
}

export function RecentList({ onOpen, onLoadFile }: RecentListProps): JSX.Element {
  const { t } = useTranslation();
  const items = useRecentStore((s) => s.items);
  const loaded = useRecentStore((s) => s.loaded);
  const clearRecent = useRecentStore((s) => s.clearRecent);
  // T19/20: 不再在 RecentList 内调用 useMarkdownDoc() 拿自己的 hook 实例.
  // 文件加载走 props.onLoadFile (来自 Toolbar → App.tsx 的同一份 loadFile).
  // 空状态"打开文件"按钮需要 dialog 入口, 因此仍保留 useMarkdownDoc() 的 open()
  // 仅用于 dialog 入口 (这一份与 Reader 不耦合, 弹 dialog 与 Reader 重渲染无关).
  const { open: openFile } = useMarkdownDoc();
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

  const handleOpen = (item: RecentItem): void => {
    onOpen?.();
    // T20 关键修复: 调用外层注入的 onLoadFile, 这条链路最终触发 App.tsx 内
    // 唯一一份 useMarkdownDoc 实例的 OPEN_OK dispatch, Reader 才会更新.
    // 之前 RecentList 内部 useMarkdownDoc().loadFile 更新的是 RecentList 自己
    // 的 hook reducer, App.tsx 的 reader 看不到, content/outline 都保留上一份.
    onLoadFile?.(item.path);
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
                  handleOpen(item);
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
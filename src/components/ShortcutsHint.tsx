/**
 * ShortcutsHint — T11 首启速查浮层 (FR-12 / 设计 §3.5 + T18 FR-02).
 *
 * 设计依据: docs/design/compiled.md §3.5 + 需求 FR-12.
 *
 * T18 (FR-02 / §3.4 P3):
 *   - 4 键 TEXT (title/intro/close/dontShowAgain) 全部 t('shortcuts.*').
 *   - 10 行 HINT_ROWS 改为 i18nKey + t() 取值 (i18nKey: 'shortcuts.rows.xxx').
 *   - 保留 SHORTCUTS / isMac / ShortcutId 不动 (快捷键定义本身不带文案).
 *
 * 行为:
 *   - 内部订阅 useProgressStore.hydrated + seenShortcutsHint.
 *   - hydrated=true 且 seenShortcutsHint=false → 展示浮层 (focus 关闭按钮).
 *   - 关闭 + 勾选「不再提示」→ setSeenShortcutsHint(true) + flush.
 *   - 关闭但未勾选 → 不写盘; 下次启动仍弹出.
 *   - 可通过 window CustomEvent `kite:show-shortcuts-hint` 再次触发 (设置菜单入口).
 *
 * 纪律:
 *   - 非阻塞 (浮层形式, 不替换主内容).
 *   - 不持久化"显示/隐藏"状态到 localStorage; 复用 progress.seenShortcutsHint.
 */
import { useEffect, useRef, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';

import { SHORTCUTS, isMac, type ShortcutId } from '../lib/shortcuts';
import { useProgressStore } from '../stores/progressStore';

/** 速查展示顺序 (ShortcutId 子集, 按用户使用频率排序). */
const HINT_IDS: ShortcutId[] = [
  'open',
  'find',
  'zoomIn',
  'zoomOut',
  'zoomReset',
  'cycleTheme',
  'recentDrawer',
  'scrollTop',
  'scrollBottom',
  'closeOverlay',
];

export function ShortcutsHint(): JSX.Element | null {
  const { t } = useTranslation();
  const hydrated = useProgressStore((s) => s.hydrated);
  const seenShortcutsHint = useProgressStore((s) => s.seenShortcutsHint);
  const [visible, setVisible] = useState(false);
  const [dontShow, setDontShow] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  // 首次 hydrate 后, 若 seenShortcutsHint=false → 展示.
  useEffect(() => {
    if (!hydrated) return;
    if (seenShortcutsHint) return;
    setVisible(true);
  }, [hydrated, seenShortcutsHint]);

  // 自定义事件: 外部触发再次展示 (设置菜单入口预留).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onShow = (): void => {
      setDontShow(false);
      setVisible(true);
    };
    window.addEventListener('kite:show-shortcuts-hint', onShow);
    return () => window.removeEventListener('kite:show-shortcuts-hint', onShow);
  }, []);

  // 打开时焦点默认在"关闭"按钮 (AC-12-1).
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 0);
    return () => clearTimeout(t);
  }, [visible]);

  if (!visible) return null;

  const handleClose = (): void => {
    if (dontShow) {
      useProgressStore.getState().setSeenShortcutsHint(true);
      void useProgressStore.getState().flush(true);
    }
    setVisible(false);
  };

  const platform = isMac() ? 'mac' : 'other';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-hint-title"
      data-testid="shortcuts-hint"
      className="shortcuts-hint fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4"
    >
      <div className="shortcuts-hint__panel flex max-h-[80vh] w-full max-w-md flex-col gap-3 rounded-lg border border-fg/20 bg-bg p-4 shadow-lg">
        <header className="flex items-center justify-between gap-2">
          <h2
            id="shortcuts-hint-title"
            className="text-base font-semibold tracking-tight"
          >
            {t('shortcuts.title')}
          </h2>
        </header>
        <p className="text-xs text-fg/70">{t('shortcuts.intro')}</p>
        <ul className="flex flex-col gap-1 overflow-y-auto text-sm">
          {HINT_IDS.map((id) => {
            const def = SHORTCUTS.find((s) => s.id === id);
            if (!def) return null;
            const label = platform === 'mac' ? def.label.mac : def.label.other;
            return (
              <li
                key={id}
                data-testid={`shortcuts-hint-row-${id}`}
                className="flex items-center justify-between gap-3 rounded px-2 py-1 hover:bg-fg/5"
              >
                <span className="text-fg/80">{t(def.i18nKey)}</span>
                <kbd className="shortcuts-hint__kbd min-w-[5rem] rounded border border-fg/20 bg-fg/5 px-2 py-0.5 text-center font-mono text-xs">
                  {label}
                </kbd>
              </li>
            );
          })}
        </ul>
        <label className="mt-1 flex cursor-pointer items-center gap-2 text-xs text-fg/80">
          <input
            type="checkbox"
            data-testid="shortcuts-hint-dont-show"
            checked={dontShow}
            onChange={(e) => setDontShow(e.target.checked)}
            className="h-3.5 w-3.5 cursor-pointer accent-current"
          />
          {t('shortcuts.dontShowAgain')}
        </label>
        <div className="mt-1 flex justify-end gap-2">
          <button
            ref={closeButtonRef}
            type="button"
            data-testid="shortcuts-hint-close"
            onClick={handleClose}
            className="rounded-md bg-accent px-3 py-1 text-sm text-bg hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
          >
            {t('shortcuts.close')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ShortcutsHint;
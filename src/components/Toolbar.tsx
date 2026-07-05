/**
 * Toolbar — 顶栏 (设计 §3.3.1) + T06 「最近文件」下拉菜单 + T12 字号指示器.
 *
 *   - 含品牌 <h1>KITE</h1> (用于 AC-01-1 视觉识别).
 *   - 含受控 "打开" 按钮: aria-label 友好, disabled 跟随 loading.
 *   - 含 "最近" 下拉菜单: 点击切换 open 状态; 内部挂载 <RecentList />.
 *     - Esc 关闭外层抽屉 (NFR-03).
 *     - 失焦自动关闭 (UX 期望).
 *   - 不直接打开 dialog: 由 App.tsx 通过 onOpen 注入, 这样 Toolbar 在路由 / 主题切换时可重用.
 *   - T12 (FR-06 配套): 字号指示器 + tooltip + aria-live.
 *   - T15 (FR-01/FR-04): 新增 TreeButton / BackButton / ForwardButton; i18n 文案.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { RecentList } from './RecentList';
import { usePrefStore } from '../stores/prefStore';
import { useDocStore } from '../stores/docStore';
import { useLayoutStore } from '../stores/layoutStore';
import { useFullscreen } from '../hooks/useFullscreen';
import { useTheme } from '../hooks/useTheme';
import { FullscreenButton } from './FullscreenButton';
import { ToolbarExportMenu } from './ToolbarExportMenu';
import {
  FONT_SIZES,
  getFontSizeMeta,
  type FontSize,
} from '../lib/reader-prefs';
import kiteLogoUrl from '../assets/kite_logo.png';
import kiteLogoDarkUrl from '../assets/kite_logo_dark.png';

export interface ToolbarProps {
  disabled: boolean;
  onOpen: () => void;
  /** T19 (FR-04): Toolbar 后退按钮点击 → 走 useMarkdownDoc.loadFile(history[cursor-1]). */
  onBack?: () => void;
  /** T19 (FR-04): Toolbar 前进按钮点击 → 走 useMarkdownDoc.loadFile(history[cursor+1]). */
  onForward?: () => void;
  /**
   * T20 (R-04 关键修复): RecentList 列表项点击 → 转发到此处传入的 `loadFile`.
   * 必须是 App.tsx 内同一份 `useMarkdownDoc()` 拿到的 `loadFile`, 因为
   * `useMarkdownDoc` 的 reducer state 是局部 React state, 不同组件调用
   * `useMarkdownDoc()` 拿到的是不同实例. 只有 App.tsx 的实例绑定了 Reader.
   */
  onLoadFile?: (path: string) => void;
}

export function Toolbar({
  disabled,
  onOpen,
  onBack,
  onForward,
  onLoadFile,
}: ToolbarProps): JSX.Element {
  const { t } = useTranslation();
  const [recentOpen, setRecentOpen] = useState(false);
  const [fontPickerOpen, setFontPickerOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const fontPickerRef = useRef<HTMLDivElement | null>(null);
  const fontSizeId = usePrefStore((s) => s.prefs.fontSizeId);
  const setFontSizeId = usePrefStore((s) => s.setFontSizeId);
  const lineHeightId = usePrefStore((s) => s.prefs.lineHeightId);
  const fontMeta = getFontSizeMeta(fontSizeId);
  const announcerRef = useRef<HTMLSpanElement | null>(null);

  // T20+ (R-06 修复): useTheme().appliedTheme 用于在 dark 模式下切换
  // Logo 到深色变体 (kite_logo_dark.png), 避免深蓝文字 "kite" 在暗背景上不可读.
  const { appliedTheme } = useTheme();
  const logoSrc = appliedTheme === 'dark' ? kiteLogoDarkUrl : kiteLogoUrl;

  // T15 (FR-01/FR-04): treeOpen 状态 + canGoBack/Forward.
  const treeOpen = useLayoutStore((s) => s.treeOpen);
  const toggleTree = useLayoutStore((s) => s.toggleTree);
  const cursor = useDocStore((s) => s.cursor);
  const historyLength = useDocStore((s) => s.history.length);
  const canGoBack = cursor > 0;
  const canGoForward = cursor >= 0 && cursor < historyLength - 1;

  // T16-P2 (FR-03): useFullscreen 由 Toolbar 顶层挂载, 供按钮调用.
  const fullscreen = useFullscreen();

  // T16-P2 (FR-04): 导出下拉 disabled 判定 (文档未加载 → AC-04-1).
  const docContent = useDocStore((s) => s.state.content);
  const exportDisabled = !docContent || docContent.length === 0;

  // 字号指示器: 字号变化时, 把文本写入 aria-live="polite" 区域, 供屏读器朗读.
  useEffect(() => {
    const el = announcerRef.current;
    if (!el) return;
    el.textContent = `${t('toolbar.fontSizeLabel')} ${fontMeta.label}, ${fontMeta.px} 像素`;
  }, [fontMeta.label, fontMeta.px, t]);

  // Esc 关闭 + 点击外部关闭 (UX 期望).
  useEffect(() => {
    if (!recentOpen) return;
    const onDocDown = (e: MouseEvent): void => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      if (e.target instanceof Node && wrap.contains(e.target)) return;
      setRecentOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setRecentOpen(false);
    };
    const onLocalEsc = (): void => setRecentOpen(false);
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    const el = wrapRef.current;
    el?.addEventListener('kite:recent-list-escape', onLocalEsc);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
      el?.removeEventListener('kite:recent-list-escape', onLocalEsc);
    };
  }, [recentOpen]);

  // T11: 监听 kite:open-recent-drawer / kite:close-recent-drawer (Cmd/Ctrl+Shift+P / Esc).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onOpen = (): void => setRecentOpen(true);
    const onClose = (): void => setRecentOpen(false);
    window.addEventListener('kite:open-recent-drawer', onOpen);
    window.addEventListener('kite:close-recent-drawer', onClose);
    return () => {
      window.removeEventListener('kite:open-recent-drawer', onOpen);
      window.removeEventListener('kite:close-recent-drawer', onClose);
    };
  }, []);

  // T15 (FR-04): BackButton.
  // T19 修复: 之前使用 useDocStore.moveCursor (无副作用同步 Reader), 导致按钮
  // 即便 canGoBack=true, 点击也不渲染新文档. 现在 Toolbar 接收来自 App 的
  // onBack 回调 (内部走 useMarkdownDoc.loadFile 让 Reader 重新挂载).
  const handleBack = (): void => {
    if (onBack) {
      onBack();
    } else {
      // 没注入时退回到 docStore 旧路径 (仅写 history, 不渲染).
      void useDocStore.getState().moveCursor(-1);
    }
  };
  const handleForward = (): void => {
    if (onForward) {
      onForward();
    } else {
      void useDocStore.getState().moveCursor(1);
    }
  };

  // T19 字号选择器: 点击外部 / Esc 关闭 (与「最近文件」下拉一致模式).
  // 仅在打开时挂全局事件, 关闭即卸载以避免性能/串扰.
  useEffect(() => {
    if (!fontPickerOpen) return;
    const onDocDown = (e: MouseEvent): void => {
      const wrap = fontPickerRef.current;
      if (!wrap) return;
      if (e.target instanceof Node && wrap.contains(e.target)) return;
      setFontPickerOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setFontPickerOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [fontPickerOpen]);

  // 打开字号选择器时, 把焦点收到第一个选项, 方便键盘操作.
  useEffect(() => {
    if (!fontPickerOpen) return;
    const wrap = fontPickerRef.current;
    if (!wrap) return;
    const first = wrap.querySelector<HTMLButtonElement>('[data-testid="font-picker-option"]');
    first?.focus();
  }, [fontPickerOpen]);

  const handleSelectFontSize = (id: FontSize): void => {
    setFontSizeId(id);
    setFontPickerOpen(false);
  };

  return (
    <header
      role="banner"
      data-testid="toolbar"
      className="flex shrink-0 flex-row flex-nowrap items-center gap-3 whitespace-nowrap border-b border-fg/20 px-3 py-1.5"
    >
      {/* T19: 应用 Logo (替代原 KITE 文字品牌, 由 src/assets/kite_logo.png 提供).
          源图尺寸 1055×570 ≈ 1.851:1 (已裁剪上下空白 + 背景透明).
          h-9 (36 px) 让 Logo 在 Toolbar 中视觉更突出, w-auto 按 aspect 自动算宽度.
          flex-shrink-0 + whitespace-nowrap + flex-nowrap 保证不被右侧按钮挤到下一行.
          T20+ (R-06): appliedTheme === 'dark' 时切换到 kite_logo_dark.png (浅蓝主题),
          保留原图的 kite 蓝色品牌色但字色反转, 在暗背景上仍然可读. */}
      <img
        src={logoSrc}
        alt="KITE"
        width={1055}
        height={570}
        draggable={false}
        className="kite-toolbar__logo h-9 w-auto flex-shrink-0 select-none"
        data-testid="toolbar-logo"
      />
      {/* ml-auto 把按钮组钉在右侧; flex-shrink-0 + whitespace-nowrap + flex-nowrap
          共同保证按钮组不折行. 与 Logo 严格同一水平行. */}
      <div className="ml-auto flex shrink-0 flex-nowrap items-center justify-end gap-2 whitespace-nowrap">
        <div ref={fontPickerRef} className="relative">
          <button
            type="button"
            data-testid="font-size-indicator"
            // T19: 字号指示器改为下拉触发器.
            //   - 默认 (fontPickerOpen=false) → 显示当前字号 + ▼ 标识.
            //   - 点击后展开 Popover 列出 5 档 (sm/md/lg/xl/2xl), 选中即应用并关闭.
            //   - 键盘可达: aria-haspopup="menu" + aria-expanded, Enter/Space 触发,
            //     Esc / 外部点击关闭 (见上方 effect).
            //   - aria-live 区域依然保留 (屏读器朗读字号变化).
            title={`${t('toolbar.fontSizeLabel')} ${fontMeta.label} (${fontMeta.px}px) · ${lineHeightId}`}
            aria-label={`${t('toolbar.fontSizeLabel')} ${fontMeta.label} (${fontMeta.px}px)${t('toolbar.fontSizeAriaLabelSuffix')}`}
            aria-haspopup="menu"
            aria-expanded={fontPickerOpen}
            onClick={() => setFontPickerOpen((v) => !v)}
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted transition-colors hover:bg-fg/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span className="font-medium text-fg">{fontMeta.hint}</span>
            <span className="ml-1">{fontMeta.px}px</span>
            <span aria-hidden="true" className="ml-1 text-[10px] opacity-60">▾</span>
          </button>
          {fontPickerOpen && (
            <div
              role="menu"
              aria-label={t('toolbar.fontSizeLabel')}
              data-testid="font-picker"
              className="absolute right-0 top-full z-40 mt-2 min-w-[10rem] rounded-md border border-fg/20 bg-bg py-1 shadow-lg"
            >
              {FONT_SIZES.map((id) => {
                const meta = getFontSizeMeta(id);
                const isActive = id === fontSizeId;
                // 优先 i18n 标签 (settings.fontSizes.<id>), 无 i18n 时回退 meta.label
                // (T18 FR-02: 业务 UI 不可硬编码文案).
                const i18nLabel = t(`settings.fontSizes.${id}`, { defaultValue: '' });
                const label = i18nLabel || meta.label;
                return (
                  <button
                    key={id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={isActive}
                    data-testid="font-picker-option"
                    data-font-size-id={id}
                    onClick={() => handleSelectFontSize(id)}
                    className={
                      'flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm transition-colors hover:bg-fg/5 focus:bg-fg/5 focus:outline-none ' +
                      (isActive ? 'bg-accent/10 font-semibold text-accent' : 'text-fg')
                    }
                  >
                    <span className="flex items-center gap-2">
                      <span className="inline-block w-7 text-center text-xs font-medium opacity-70">
                        {meta.hint}
                      </span>
                      <span>{label}</span>
                    </span>
                    <span className="text-xs tabular-nums opacity-60">{meta.px}px</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        {/* 屏读器朗读区: aria-live="polite", 内容由 effect 写入. */}
        <span
          ref={announcerRef}
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
          data-testid="font-size-announcer"
        />
        {/* T15 (FR-04): BackButton. 可达性:
              - aria-label = 后退 (默认) / 禁用原因 (历史栈为空).
              - title 同 aria-label, 鼠标 hover 显示浏览器 tooltip.
              - 视觉禁用: opacity 50% + 边框淡化为 fg/10, 在未打开多文件时让用户
                明确感知按钮处于 disabled 状态, 而非错误地认为按钮彻底失效.
              - 一旦打开 ≥2 个文件, cursor ≥1 时 canGoBack 自动恢复可点. */}
        <button
          type="button"
          data-testid="toolbar-back"
          aria-label={canGoBack ? t('toolbar.back') : `${t('toolbar.back')} — ${t('toolbar.backDisabledHint')}`}
          title={canGoBack ? t('toolbar.back') : t('toolbar.backDisabledHint')}
          disabled={!canGoBack}
          onClick={handleBack}
          className="rounded-md border border-fg/30 px-3 py-1.5 text-sm hover:bg-fg/5 disabled:cursor-not-allowed disabled:border-fg/10 disabled:opacity-50"
        >
          ←
        </button>
        {/* T15 (FR-04): ForwardButton. 可达性同上; canGoForward 还需要
            history[cursor+1] 存在 → 即必须先 back 再 forward (类似浏览器). */}
        <button
          type="button"
          data-testid="toolbar-forward"
          aria-label={canGoForward ? t('toolbar.forward') : `${t('toolbar.forward')} — ${t('toolbar.forwardDisabledHint')}`}
          title={canGoForward ? t('toolbar.forward') : t('toolbar.forwardDisabledHint')}
          disabled={!canGoForward}
          onClick={handleForward}
          className="rounded-md border border-fg/30 px-3 py-1.5 text-sm hover:bg-fg/5 disabled:cursor-not-allowed disabled:border-fg/10 disabled:opacity-50"
        >
          →
        </button>
        {/* T15 (FR-01): TreeButton. */}
        <button
          type="button"
          data-testid="toolbar-tree"
          aria-label={t('toolbar.tree')}
          aria-pressed={treeOpen}
          title={t('toolbar.tree')}
          onClick={toggleTree}
          className={
            'inline-flex items-center justify-center rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-fg/5 ' +
            (treeOpen ? 'border-accent bg-accent/10 font-semibold' : 'border-fg/30')
          }
        >
          {/* inline SVG (Lucide "folder"), 16×16 strokeWidth=2, 颜色走 currentColor. */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
            className={`toolbar-tree__icon${treeOpen ? ' toolbar-tree__icon--open' : ''}`}
          >
            <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 9.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
          </svg>
        </button>
        <div ref={wrapRef} className="relative">
          <button
            type="button"
            data-testid="toolbar-recent"
            aria-label={t('toolbar.recent')}
            aria-haspopup="menu"
            aria-expanded={recentOpen}
            onClick={() => setRecentOpen((v) => !v)}
            className="rounded-md border border-fg/30 px-3 py-1.5 text-sm hover:bg-fg/5"
          >
            {t('toolbar.recent')}
          </button>
          {recentOpen && (
            <div className="absolute right-0 top-full z-40 mt-2">
              <RecentList
                onOpen={() => setRecentOpen(false)}
                // T20: 转发 App.tsx 的同一份 loadFile, 避免在 RecentList
                // 内独立 useMarkdownDoc() 拿到不同的 hook 实例.
                onLoadFile={onLoadFile}
              />
            </div>
          )}
        </div>
        <button
          type="button"
          data-testid="toolbar-open"
          onClick={onOpen}
          disabled={disabled}
          aria-label={t('toolbar.open')}
          className="rounded-md border border-fg/30 px-3 py-1.5 text-sm hover:bg-fg/5 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t('toolbar.open')}
        </button>
        {/* T16-P2 (FR-01 / FR-02): 导出下拉 (FR-04 入口可见性). */}
        <ToolbarExportMenu disabled={exportDisabled} />
        {/* T16-P2 (FR-03 / NFR-U-02): 全屏按钮. */}
        <FullscreenButton
          state={{
            isFullscreen: fullscreen.isFullscreen,
            since: fullscreen.isFullscreen ? Date.now() : null,
          }}
          onToggle={() => void fullscreen.toggle()}
          disabled={!fullscreen.supported}
        />
      </div>
    </header>
  );
}

export default Toolbar;

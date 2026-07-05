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
import { FullscreenButton } from './FullscreenButton';
import { ToolbarExportMenu } from './ToolbarExportMenu';
import { getFontSizeMeta } from '../lib/reader-prefs';
import kiteLogoUrl from '../assets/kite_logo.png';

export interface ToolbarProps {
  disabled: boolean;
  onOpen: () => void;
}

export function Toolbar({ disabled, onOpen }: ToolbarProps): JSX.Element {
  const { t } = useTranslation();
  const [recentOpen, setRecentOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const fontSizeId = usePrefStore((s) => s.prefs.fontSizeId);
  const lineHeightId = usePrefStore((s) => s.prefs.lineHeightId);
  const fontMeta = getFontSizeMeta(fontSizeId);
  const announcerRef = useRef<HTMLSpanElement | null>(null);

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

  return (
    <header
      role="banner"
      data-testid="toolbar"
      className="flex shrink-0 flex-row flex-nowrap items-center gap-3 whitespace-nowrap border-b border-fg/20 px-3 py-1.5"
    >
      {/* T19: 应用 Logo (替代原 KITE 文字品牌, 由 src/assets/kite_logo.png 提供).
          源图为 1055×586 ≈ 1.80:1 (已裁剪上下空白 + 背景统一为 #FAFAFC 与设计
          token --color-bg 对齐). Toolbar 高度 ~46 px, logo 高度 = banner 高度 - 12 px,
          宽度按 aspect 自动, 保留视觉密度. flex-shrink-0 + whitespace-nowrap + flex-nowrap
          保证不被右侧按钮挤到下一行 (Toolbar 父容器为 display: flex, 见
          src/styles/fullscreen.css). */}
      <img
        src={kiteLogoUrl}
        alt="KITE"
        width={1055}
        height={586}
        draggable={false}
        className="kite-toolbar__logo h-7 w-auto flex-shrink-0 select-none"
        data-testid="toolbar-logo"
      />
      {/* ml-auto 把按钮组钉在右侧; flex-shrink-0 + whitespace-nowrap + flex-nowrap
          共同保证按钮组不折行. 与 Logo 严格同一水平行. */}
      <div className="ml-auto flex shrink-0 flex-nowrap items-center justify-end gap-2 whitespace-nowrap">
        <div
          data-testid="font-size-indicator"
          title={`${t('toolbar.fontSizeLabel')} ${fontMeta.label} (${fontMeta.px}px) · ${lineHeightId}`}
          aria-hidden="true"
          className="rounded-md border border-border px-2 py-1 text-xs text-muted"
        >
          <span className="font-medium text-fg">{fontMeta.hint}</span>
          <span className="ml-1">{fontMeta.px}px</span>
        </div>
        {/* 屏读器朗读区: aria-live="polite", 内容由 effect 写入. */}
        <span
          ref={announcerRef}
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
          data-testid="font-size-announcer"
        />
        {/* T15 (FR-04): BackButton. */}
        <button
          type="button"
          data-testid="toolbar-back"
          aria-label={t('toolbar.back')}
          title={t('toolbar.back')}
          disabled={!canGoBack}
          onClick={() => void useDocStore.getState().moveCursor(-1)}
          className="rounded-md border border-fg/30 px-3 py-1.5 text-sm hover:bg-fg/5 disabled:cursor-not-allowed disabled:opacity-40"
        >
          ←
        </button>
        {/* T15 (FR-04): ForwardButton. */}
        <button
          type="button"
          data-testid="toolbar-forward"
          aria-label={t('toolbar.forward')}
          title={t('toolbar.forward')}
          disabled={!canGoForward}
          onClick={() => void useDocStore.getState().moveCursor(1)}
          className="rounded-md border border-fg/30 px-3 py-1.5 text-sm hover:bg-fg/5 disabled:cursor-not-allowed disabled:opacity-40"
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
            'rounded-md border px-3 py-1.5 text-sm hover:bg-fg/5 ' +
            (treeOpen ? 'border-accent bg-accent/10 font-semibold' : 'border-fg/30')
          }
        >
          📂
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
              <RecentList onOpen={() => setRecentOpen(false)} />
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

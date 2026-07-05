/**
 * FullscreenButton — T16-P2 (FR-03 / NFR-U-02) 工具栏全屏按钮.
 *
 * 设计依据: docs/design/compiled.md §3.3.2 + 需求 FR-03 / FR-04 / AC-03-1,2,6.
 *
 * 责任:
 *   - 渲染一个原生 <button>; 受控 props: state, onToggle.
 *   - 默认 (state.isFullscreen=false): aria-label 用 t('fullscreen.enter'), icon=enterGlyph,
 *     文字部分始终使用 t('fullscreen.enter') 标签 (= "全屏" / "Full Screen"), label 不随状态变化.
 *   - 激活 (state.isFullscreen=true): aria-label 用 t('fullscreen.exit'), icon=exitGlyph;
 *     文字部分依然显示 t('fullscreen.enter') (label 跨状态一致, 与导出/打开等
 *     toolbar 按钮形态一致; 仅 icon flip 提示状态变化 — 用户原话 "两项不需要下拉"
 *     + "文字 + icon 始终不过变").
 *   - 图标使用 Unicode ⛶ / ⤡, 不依赖 lucide-react 等额外依赖.
 *
 * 纪律:
 *   - 组件**不**直接调用 Tauri / 浏览器 API; 通过 onToggle 由父级 useFullscreen 驱动.
 *   - Tab 聚焦 / Enter Space 触发 (原生 button 默认行为).
 *   - 视觉: 标签始终显示 + icon flip 提示态, hover 背景凸显; disabled 时 opacity 0.4.
 */

import { useTranslation } from 'react-i18next';

import type { FullscreenState } from '../lib/tauri';

export interface FullscreenButtonProps {
  state: FullscreenState;
  onToggle: () => void;
  /** 可选 disabled (开发模式无全屏支持时使用). */
  disabled?: boolean;
}

export function FullscreenButton({
  state,
  onToggle,
  disabled = false,
}: FullscreenButtonProps): JSX.Element {
  const { t } = useTranslation();
  const isFs = state.isFullscreen;
  const ariaLabel = isFs ? t('fullscreen.exit') : t('fullscreen.enter');
  // icon flip 提示状态变化; label 始终为 "全屏" 让用户快速识别.
  const icon = isFs ? '⤡' : '⛶';

  return (
    <button
      type="button"
      data-testid="toolbar-fullscreen"
      aria-label={ariaLabel}
      aria-pressed={isFs}
      title={ariaLabel}
      onClick={onToggle}
      disabled={disabled}
      className={
        'flex items-center gap-1.5 rounded-md border border-fg/30 px-3 py-1.5 text-sm hover:bg-fg/5 ' +
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ' +
        'disabled:cursor-not-allowed disabled:opacity-40'
      }
    >
      <span aria-hidden="true">{icon}</span>
      <span>{t('fullscreen.enter')}</span>
    </button>
  );
}

export default FullscreenButton;
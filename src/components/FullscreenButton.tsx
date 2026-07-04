/**
 * FullscreenButton — T16-P2 (FR-03 / NFR-U-02) 工具栏全屏图标按钮.
 *
 * 设计依据: docs/design/compiled.md §3.3.2 + 需求 FR-03 / FR-04 / AC-03-1,2,6.
 *
 * 责任:
 *   - 渲染一个原生 <button>; 受控 props: state, onToggle.
 *   - state.isFullscreen === false → aria-label = 'fullscreen.enter', 显示 Maximize 字符 ⛶.
 *   - state.isFullscreen === true  → aria-label = 'fullscreen.exit',  显示 Minimize 字符 ⛶.
 *   - i18n 文案走 t('fullscreen.enter' | 'fullscreen.exit').
 *
 * 纪律:
 *   - 组件**不**直接调用 Tauri / 浏览器 API; 通过 onToggle 由父级 useFullscreen 驱动.
 *   - Tab 聚焦 / Enter Space 触发 (原生 button 默认行为).
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
  // 视觉上 Maximize2 / Minimize2 的等价字符 — 不依赖 lucide-react 等额外依赖.
  // U+1F5D6 (🗖) 用于扩展 / 收起两类含义; 此处用 ⛶ (U+26F6) / ✕ 更直观.
  const icon = isFs ? '⤡' : '⤢';

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
        'rounded-md border border-fg/30 px-3 py-1.5 text-sm hover:bg-fg/5 ' +
        'disabled:cursor-not-allowed disabled:opacity-40'
      }
    >
      <span aria-hidden="true">{icon}</span>
    </button>
  );
}

export default FullscreenButton;
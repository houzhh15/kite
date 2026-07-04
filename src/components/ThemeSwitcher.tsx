/**
 * src/components/ThemeSwitcher.tsx — 三段 radiogroup 按钮 (T03 step-08 + T18 FR-02).
 *
 * 设计依据: docs/design/compiled.md §3.5 / FR-02 / NFR-04.
 *
 * 责任:
 *   - 渲染 3 段按钮组 (light / dark / system), 顺序固定.
 *   - 受控绑定 prefStore.setTheme; 选中段 aria-checked=true + bg-accent text-bg.
 *   - 键盘: Tab 进入组后焦点落到当前选中段; ArrowLeft/Right 循环切换; Space/Enter 触发 click.
 *   - 不依赖 Settings 容器 (ThemeSwitcher 可独立复用).
 *
 * T18 (FR-02):
 *   - 删除本地 LABELS 常量, 改为 useTranslation() + t('theme.light' / 'dark' / 'system' / 'groupLabel').
 *   - 保留 data-testid="theme-switcher" 兼容 e2e (T18-E08).
 *
 * 纪律:
 *   - role="radiogroup" + role="radio"; 不用 aria-pressed (语义冲突).
 *   - 不接收 props; 受控源严格 = useTheme().
 *   - 不引入按钮 label 之外的子元素; 不挂 onClick 之外的额外事件.
 *   - 不渲染 sepia (Theme 类型不包含).
 */

import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { THEME_OPTIONS, type Theme } from '../lib/theme-types';
import { useTheme } from '../hooks/useTheme';

export function ThemeSwitcher(): JSX.Element {
  const { t } = useTranslation();
  const { theme: current, setTheme } = useTheme();
  const groupRef = useRef<HTMLDivElement>(null);

  /**
   * 索引移动: 循环到首/末 (设计 §3.5 / AC-02-3).
   * 复用同一函数引用, 避免 useEffect 内 listener 多次注册.
   */
  const moveSelection = useCallback((dir: 1 | -1) => {
    const total = THEME_OPTIONS.length;
    if (!groupRef.current) return;
    const buttons = groupRef.current.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    if (buttons.length === 0) return;
    const focused = document.activeElement;
    const idx = Array.from(buttons).findIndex((b) => b === focused);
    const cur = idx >= 0 ? idx : THEME_OPTIONS.findIndex((o) => o.value === current);
    const fallback = cur >= 0 ? cur : 0;
    const nextIdx = (fallback + dir + total) % total;
    const nextBtn = buttons[nextIdx];
    if (nextBtn) {
      nextBtn.focus();
      // 同步更新选中档: 方向键立即触发选中变更 (UX)
      const opt = THEME_OPTIONS[nextIdx];
      if (opt) {
        setTheme(opt.value);
      }
    }
  }, [current, setTheme]);

  useEffect(() => {
    // 绑定到 group 容器的 keydown; 仅当焦点在 radiogroup 内时 (target 检查) 触发.
    const node = groupRef.current;
    if (!node) return undefined;
    const handler = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLElement && e.target.getAttribute('role') !== 'radio') return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        moveSelection(1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        moveSelection(-1);
      }
      // Space / Enter 由浏览器默认 click on <button> 处理.
    };
    node.addEventListener('keydown', handler);
    return () => {
      node.removeEventListener('keydown', handler);
    };
  }, [moveSelection]);

  // T18: 取字典化的 label, 对应 theme.light / dark / system.
  const labelMap: Record<Theme, string> = {
    light: t('theme.light'),
    dark: t('theme.dark'),
    system: t('theme.system'),
  };

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={t('theme.groupLabel')}
      data-testid="theme-switcher"
      className="inline-flex rounded-md border border-border"
    >
      {THEME_OPTIONS.map((opt) => {
        const isActive = opt.value === current;
        const value: Theme = opt.value;
        const label = labelMap[value] ?? value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-label={label}
            data-theme={value}
            data-testid={`theme-option-${value}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => setTheme(value)}
            className={
              isActive
                ? 'bg-accent px-3 py-1.5 text-sm text-bg first:rounded-l-md last:rounded-r-md'
                : 'border-r border-border bg-transparent px-3 py-1.5 text-sm text-fg last:border-r-0 hover:bg-fg/5 first:rounded-l-md last:rounded-r-md'
            }
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

export default ThemeSwitcher;
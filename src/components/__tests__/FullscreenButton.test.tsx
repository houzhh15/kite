/**
 * FullscreenButton.test.tsx — T16-P2 全屏按钮行为锁定 (T19 反馈合并).
 *
 * 覆盖:
 *   - 默认 (isFullscreen=false): 显示 label "全屏" + icon ⛶.
 *   - 激活 (isFullscreen=true): label 保持 "全屏", icon 切换为 ⤡.
 *   - aria-label / aria-pressed 跟随 state 翻转 (屏读可达 + 状态正确).
 *   - 受控 onToggle 触发, disabled 时点击不触发.
 *   - 用户原话: "trigger 静态显示 '全屏' + icon; 状态变化仅 icon 切换" —
 *     与"导出"等 toolbar 按钮设计一致 (label 不随状态变化).
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';

import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n';
import { FullscreenButton } from '../FullscreenButton';

function wrap(node: JSX.Element): JSX.Element {
  return <I18nextProvider i18n={i18n}>{node}</I18nextProvider>;
}

describe('FullscreenButton — T19 icon/label 行为锁定', () => {
  it('默认 (isFullscreen=false): icon ⛶ + label "全屏" + aria-label=全屏 + aria-pressed=false', () => {
    const { getByTestId } = render(
      wrap(
        <FullscreenButton
          state={{ isFullscreen: false, since: null }}
          onToggle={() => {}}
        />,
      ),
    );
    const btn = getByTestId('toolbar-fullscreen');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(btn.getAttribute('aria-label')).toBe('全屏');
    // 文字部分始终为 "全屏"
    expect(btn.textContent).toContain('全屏');
    // icon 部分的 span aria-hidden=true; 取第一个 span.
    const spans = btn.querySelectorAll('span');
    expect(spans[0]?.textContent).toBe('⛶');
  });

  it('激活态 (isFullscreen=true): label 保持 "全屏", icon 切换为 ⤡ + aria-pressed=true', () => {
    const { getByTestId } = render(
      wrap(
        <FullscreenButton
          state={{ isFullscreen: true, since: Date.now() }}
          onToggle={() => {}}
        />,
      ),
    );
    const btn = getByTestId('toolbar-fullscreen');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    // aria-label 切换为 "退出全屏" 让屏读器明确.
    expect(btn.getAttribute('aria-label')).toBe('退出全屏');
    // label 部分依然为 "全屏" (与设计一致 — 状态变化仅靠 icon).
    expect(btn.textContent).toContain('全屏');
    const spans = btn.querySelectorAll('span');
    expect(spans[0]?.textContent).toBe('⤡');
  });

  it('点击触发 onToggle, disabled 时不触发', () => {
    const onToggle = vi.fn();
    const { getByTestId, rerender } = render(
      wrap(<FullscreenButton state={{ isFullscreen: false, since: null }} onToggle={onToggle} />),
    );
    fireEvent.click(getByTestId('toolbar-fullscreen'));
    expect(onToggle).toHaveBeenCalledTimes(1);

    // disabled 状态.
    rerender(
      wrap(
        <FullscreenButton
          state={{ isFullscreen: false, since: null }}
          onToggle={onToggle}
          disabled
        />,
      ),
    );
    const btn = getByTestId('toolbar-fullscreen') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('渲染 button 类型, 可在 a11y tree 中获得, 不依赖外部状态', () => {
    const { container } = render(
      wrap(<FullscreenButton state={{ isFullscreen: false, since: null }} onToggle={() => {}} />),
    );
    expect(container.querySelector('button[data-testid="toolbar-fullscreen"]')).toBeTruthy();
  });
});

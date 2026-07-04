/**
 * ProgressBar 单元测试 (T09 / FR-04 / AC-04-*).
 *
 * 覆盖:
 *   - 顶部细条渲染 + transform: scaleX(value).
 *   - role=progressbar + aria-valuemin/max/now.
 *   - hideWhenIdle=true + value=0 -> null (AC-04-4).
 *   - hideWhenIdle=false + value=0 -> 渲染.
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import ProgressBar from '../ProgressBar';

describe('ProgressBar', () => {
  it('value=0.5 -> aria-valuenow=50 + transform: scaleX(0.5)', () => {
    const { container } = render(<ProgressBar value={0.5} />);
    const el = container.querySelector('[data-testid="progress-bar"]') as HTMLElement;
    expect(el).not.toBeNull();
    expect(el.getAttribute('role')).toBe('progressbar');
    expect(el.getAttribute('aria-valuemin')).toBe('0');
    expect(el.getAttribute('aria-valuemax')).toBe('100');
    expect(el.getAttribute('aria-valuenow')).toBe('50');
    expect((el.style as CSSStyleDeclaration).transform).toContain('scaleX(0.5)');
  });

  it('value=1 -> aria-valuenow=100 (文末判稳, AC-04-2)', () => {
    const { container } = render(<ProgressBar value={1} />);
    const el = container.querySelector('[data-testid="progress-bar"]') as HTMLElement;
    expect(el.getAttribute('aria-valuenow')).toBe('100');
  });

  it('hideWhenIdle=true + value=0 -> null (AC-04-4)', () => {
    const { container } = render(<ProgressBar value={0} hideWhenIdle />);
    expect(container.firstChild).toBeNull();
  });

  it('hideWhenIdle=false + value=0 -> 渲染', () => {
    const { container } = render(<ProgressBar value={0} hideWhenIdle={false} />);
    const el = container.querySelector('[data-testid="progress-bar"]');
    expect(el).not.toBeNull();
  });

  it('value > 1 被 clamp 到 1', () => {
    const { container } = render(<ProgressBar value={1.5} />);
    const el = container.querySelector('[data-testid="progress-bar"]') as HTMLElement;
    expect((el.style as CSSStyleDeclaration).transform).toContain('scaleX(1)');
  });

  it('value < 0 被 clamp 到 0', () => {
    const { container } = render(<ProgressBar value={-0.5} />);
    const el = container.querySelector('[data-testid="progress-bar"]') as HTMLElement;
    expect((el.style as CSSStyleDeclaration).transform).toContain('scaleX(0)');
  });

  it('data-progress 记录原始小数 (供测试/debug)', () => {
    const { container } = render(<ProgressBar value={0.42} />);
    const el = container.querySelector('[data-testid="progress-bar"]') as HTMLElement;
    expect(el.getAttribute('data-progress')).toBe('0.420');
  });

  it('position=bottom: data-position=bottom', () => {
    const { container } = render(<ProgressBar value={0.3} position="bottom" />);
    const el = container.querySelector('[data-testid="progress-bar"]') as HTMLElement;
    expect(el.getAttribute('data-position')).toBe('bottom');
  });
});

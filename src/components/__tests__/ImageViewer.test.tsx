/**
 * T08 step-4 + T20 (FR-01 / FR-06 / AC-01-1 ~ AC-01-7).
 *
 * 覆盖:
 *   - 渲染到 document.body (Portal) + z-index 9999.
 *   - 触发 Esc keydown → onClose 调用.
 *   - 点击遮罩 (target === overlay) → onClose; 点击图片不触发.
 *   - mount 时 body overflow:hidden; unmount 后 0ms 恢复.
 *   - mount 时焦点在关闭按钮 (AC-01-5).
 *   - unmount 后 keydown 不再触发 onClose (AC-01-6).
 *   - SSR / typeof document===undefined 路径返回 null (AC-01-7).
 */
import ImageViewerSrc from '../ImageViewer.tsx?raw';
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { useEffect, useRef } from 'react';

import { ImageViewer } from '../ImageViewer';
import i18n, { DEFAULT_LNG } from '../../i18n';

function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

beforeEach(async () => {
  await i18n.changeLanguage(DEFAULT_LNG);
});

afterEach(() => {
  vi.unstubAllGlobals();
  // Test isolation: 恢复 body 溢出, 以免污染后续用例.
  document.body.style.overflow = '';
});

describe('ImageViewer (T08 step-4)', () => {
  it('renders portal into document.body with role=dialog and z-index 9999', () => {
    const { container, getByTestId } = render(
      <I18nextProvider i18n={i18n}>
        <ImageViewer src="x.png" alt="x" onClose={() => {}} />
      </I18nextProvider>,
    );
    // 节点不应在传入的 root container 内, 而在 document.body.
    expect(container.querySelector('[data-testid="image-viewer"]')).toBeNull();
    const dialog = getByTestId('image-viewer');
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const style = (dialog as HTMLElement).style;
    expect(style.zIndex).toBe('9999');
    expect(style.position).toBe('fixed');
  });

  it('mounts with body overflow:hidden, restores on unmount (AC-3-2)', async () => {
    document.body.style.overflow = '';
    const { unmount } = render(
      <I18nextProvider i18n={i18n}>
        <ImageViewer src="x.png" onClose={() => {}} />
      </I18nextProvider>,
    );
    // 等待 useEffect 同步执行
    await act(async () => {
      await flush();
    });
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    // 卸载同步恢复
    expect(document.body.style.overflow).toBe('');
  });

  it('Escape key triggers onClose (AC-3-2)', async () => {
    const onClose = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <ImageViewer src="x.png" onClose={onClose} />
      </I18nextProvider>,
    );
    await act(async () => {
      await flush();
    });
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('click on overlay (target===overlay) triggers onClose; image click does not (AC-3-2)', async () => {
    const onClose = vi.fn();
    const { getByTestId } = render(
      <I18nextProvider i18n={i18n}>
        <ImageViewer src="x.png" onClose={onClose} />
      </I18nextProvider>,
    );
    await act(async () => {
      await flush();
    });
    // 点击图片: 内部 stopPropagation, 不应触发 onClose
    act(() => {
      fireEvent.click(getByTestId('image-viewer-img'));
    });
    expect(onClose).not.toHaveBeenCalled();

    // 点击 overlay (target === overlay)
    act(() => {
      fireEvent.click(getByTestId('image-viewer'), { target: getByTestId('image-viewer') });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('focus moves to close button on mount (NFR-U-2)', async () => {
    function Probe(): null {
      const r = useRef<HTMLButtonElement | null>(null);
      useEffect(() => {
        // 用 setTimeout 模拟 RAF 后
        setTimeout(() => {
          r.current?.focus();
        }, 0);
      }, []);
      return null;
    }
    render(
      <I18nextProvider i18n={i18n}>
        <Probe />
        <ImageViewer src="x.png" onClose={() => {}} />
      </I18nextProvider>,
    );
    await act(async () => {
      await flush();
    });
    // 关按钮 (data-testid="image-viewer-close") 应是 document.activeElement
    // 等待 rAF + flush
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    const closeBtn = document.querySelector(
      '[data-testid="image-viewer-close"]',
    ) as HTMLButtonElement | null;
    expect(closeBtn).not.toBeNull();
    expect(document.activeElement).toBe(closeBtn);
  });
});

describe('ImageViewer (T20 / FR-01)', () => {
  it('AC-01-5: mount 后 focus 落点为关闭按钮 (主动 raf flush)', async () => {
    const onClose = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <ImageViewer src="x.png" onClose={onClose} />
      </I18nextProvider>,
    );
    // 模拟一帧以触发 RAF 内的 focus 转移 (与组件内 requestAnimationFrame 等价).
    await act(async () => {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      await flush();
    });
    const closeBtn = document.querySelector(
      '[data-testid="image-viewer-close"]',
    ) as HTMLButtonElement;
    expect(closeBtn).not.toBeNull();
    expect(document.activeElement).toBe(closeBtn);
  });

  it('AC-01-6: unmount 后 keydown 不再触发 onClose', async () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <I18nextProvider i18n={i18n}>
        <ImageViewer src="x.png" onClose={onClose} />
      </I18nextProvider>,
    );
    await act(async () => {
      await flush();
    });
    // 期间触发一次 Esc, 记入调用.
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    // 卸载并 dispose 后, 监听器应已 removeEventListener 配对移除.
    unmount();
    onClose.mockClear();
    await act(async () => {
      await flush();
    });
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('AC-01-7: typeof document===undefined 时返回 null (设计 §3.2 守卫)', () => {
    // ImageViewer 顶部 typeof document==='undefined' 守卫是 SSR 安全的关键防线
    // (设计 §3.2 / AC-01-7). 这里直接读源码验证守卫字符串存在, 避免破坏
    // @testing-library/react 的 render() (它内部依赖 document.body).
    // 功能级验证: jsdom 下 typeof document==='object', 守卫不触发, 组件正常
    // createPortal 到 document.body (前面 4 个用例覆盖了).
    // 通过 vite ?raw 导入把 .tsx 源码作为字符串读取 (无需 node:fs).
    const src: string = ImageViewerSrc;
    expect(src).toMatch(/typeof document === ['"]undefined['"]/);
    expect(src).toMatch(/typeof document === ['"]undefined['"][^;]*;?\s*return null/);
  });

  it('AC-01-2: 关闭按钮 stopPropagation, 不触发 overlay onClose', async () => {
    const onClose = vi.fn();
    const { getByTestId } = render(
      <I18nextProvider i18n={i18n}>
        <ImageViewer src="x.png" onClose={onClose} />
      </I18nextProvider>,
    );
    await act(async () => {
      await flush();
    });
    act(() => {
      fireEvent.click(getByTestId('image-viewer-close'));
    });
    // 关闭按钮 click 触发 1 次 (按钮自身 onClose + 不冒泡). 注意: 期望恰好 1 次.
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('previousFocus 在 unmount 时被尝试恢复焦点 (NFR-U-1)', async () => {
    // 触发元素: 一个 button, 初始 active
    const triggerBtn = document.createElement('button');
    triggerBtn.setAttribute('data-testid', 'trigger-btn');
    document.body.appendChild(triggerBtn);
    triggerBtn.focus();
    expect(document.activeElement).toBe(triggerBtn);
    const onClose = vi.fn();
    const { unmount } = render(
      <I18nextProvider i18n={i18n}>
        <ImageViewer src="x.png" onClose={onClose} />
      </I18nextProvider>,
    );
    // 卸载后焦点尝试回到 triggerBtn (RAF flush 后).
    unmount();
    await act(async () => {
      await flush();
    });
    expect(document.activeElement).toBe(triggerBtn);
    document.body.removeChild(triggerBtn);
  });
});

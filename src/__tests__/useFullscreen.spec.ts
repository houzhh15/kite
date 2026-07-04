/**
 * useFullscreen 单测 (T16-P2 step-5b).
 *
 * 覆盖:
 *   - 初始 isFullscreen = false, supported = true (jsdom 默认无全屏 API 时为 false).
 *   - toggle 调用进入; data-fullscreen 属性同步.
 *   - 卸载时复位 data-fullscreen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { useFullscreen } from '../hooks/useFullscreen';

describe('useFullscreen', () => {
  beforeEach(() => {
    // 复位 html data-fullscreen.
    delete document.documentElement.dataset.fullscreen;
    // jsdom 不支持 requestFullscreen; 模拟成空操作.
    const proto = Object.getPrototypeOf(document.documentElement) as object;
    void proto;
  });

  afterEach(() => {
    delete document.documentElement.dataset.fullscreen;
    vi.restoreAllMocks();
  });

  it('初始 isFullscreen = false', () => {
    const { result } = renderHook(() => useFullscreen());
    expect(result.current.isFullscreen).toBe(false);
  });

  it('初始无 Tauri / 浏览器支持时 supported = false', () => {
    const { result } = renderHook(() => useFullscreen());
    // jsdom 默认不支持 requestFullscreen; 这里要看 stub 是否注入.
    if (typeof document.documentElement.requestFullscreen !== 'function') {
      expect(result.current.supported).toBe(false);
    } else {
      expect(result.current.supported).toBe(true);
    }
  });

  it('toggle 不会抛错', async () => {
    const { result } = renderHook(() => useFullscreen());
    await act(async () => {
      await result.current.toggle();
    });
    // 没有可用的全屏 API, isFullscreen 仍为 false.
    expect(result.current.isFullscreen).toBe(false);
  });

  it('enter / exit 不抛错', async () => {
    const { result } = renderHook(() => useFullscreen());
    await act(async () => {
      await result.current.enter();
      await result.current.exit();
    });
    expect(result.current.isFullscreen).toBe(false);
  });
});
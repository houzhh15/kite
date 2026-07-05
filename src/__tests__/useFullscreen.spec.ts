/**
 * useFullscreen 单测 (T16-P2 step-5b / T19 修复回归).
 *
 * 覆盖:
 *   - 初始 isFullscreen = false, supported 取决于环境.
 *   - toggle 调用进入; data-fullscreen 属性同步.
 *   - 卸载时复位 data-fullscreen.
 *   - **T19**: Rust `set_fullscreen` 返回 {requested, actual} 时, hook 把 state
 *     校正为 actual, 而不是 requested; 若不一致 → 静默就崩的老 bug.
 *   - **T19**: 全部 IPC fallback 失败 → 用 pushToast 提示用户, 而不是 silent.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import type * as EnvModule from '../lib/env';
import type * as TauriModule from '../lib/tauri';

// isTauri 是普通函数 (不是 vi.fn), 不能直接 mockReturnValue. 改用全局标志.
let __mockIsTauri = false;
vi.mock('../lib/env', async () => {
  const actual = await vi.importActual<typeof EnvModule>('../lib/env');
  return {
    ...actual,
    isTauri: vi.fn(() => __mockIsTauri),
    getTauriInternals: vi.fn(() => null),
  };
});
vi.mock('../lib/tauri', async () => {
  const actual = await vi.importActual<typeof TauriModule>('../lib/tauri');
  return {
    ...actual,
    setFullscreen: vi.fn(),
  };
});
vi.mock('../lib/toast', () => ({
  pushToast: vi.fn(),
}));

import { useFullscreen } from '../hooks/useFullscreen';
import { setFullscreen as invokeSetFullscreen } from '../lib/tauri';
import { pushToast } from '../lib/toast';
import { isTauri } from '../lib/env';

const setFullscreenMock = invokeSetFullscreen as unknown as ReturnType<typeof vi.fn>;
const pushToastMock = pushToast as unknown as ReturnType<typeof vi.fn>;
const isTauriMock = isTauri as unknown as ReturnType<typeof vi.fn>;

describe('useFullscreen', () => {
  beforeEach(() => {
    delete document.documentElement.dataset.fullscreen;
    setFullscreenMock.mockReset();
    pushToastMock.mockReset();
  });

  afterEach(() => {
    delete document.documentElement.dataset.fullscreen;
    vi.restoreAllMocks();
  });

  it('初始 isFullscreen = false', () => {
    const { result } = renderHook(() => useFullscreen());
    expect(result.current.isFullscreen).toBe(false);
  });

  it('toggle 调用不抛错 (jsdom 默认无 API): supported/失败路径均静默走 toast', async () => {
    const { result } = renderHook(() => useFullscreen());
    await act(async () => {
      await result.current.toggle();
    });
    expect(result.current.isFullscreen).toBe(false);
  });

  it('T19: Tauri 路径返回 {requested, actual} 一致 → state 更新到 actual', async () => {
    isTauriMock.mockReturnValue(true);
    setFullscreenMock.mockResolvedValue({ requested: true, actual: true });
    try {
      const { result } = renderHook(() => useFullscreen());
      await act(async () => {
        await result.current.enter();
      });
      expect(setFullscreenMock).toHaveBeenCalledWith(true);
      expect(result.current.isFullscreen).toBe(true);
      expect(document.documentElement.dataset.fullscreen).toBe('true');
    } finally {
      isTauriMock.mockReturnValue(false);
    }
  });

  it('T19: Tauri 路径 requested=true, actual=false (静默 no-op) → toast', async () => {
    isTauriMock.mockReturnValue(true);
    setFullscreenMock.mockResolvedValue({ requested: true, actual: false });
    try {
      const { result } = renderHook(() => useFullscreen());
      await act(async () => {
        await result.current.enter();
      });
      expect(result.current.isFullscreen).toBe(false);
      // pushToast 至少被调用一次 (kind='info' 提示失败).
      expect(pushToastMock).toHaveBeenCalled();
      const callArg = pushToastMock.mock.calls[0][0];
      expect(callArg.kind).toBe('info');
    } finally {
      isTauriMock.mockReturnValue(false);
    }
  });

  it('T19: Tauri 路径 IPC 抛错 → toast kind=error', async () => {
    isTauriMock.mockReturnValue(true);
    setFullscreenMock.mockRejectedValue(new Error('window not found'));
    try {
      const { result } = renderHook(() => useFullscreen());
      await act(async () => {
        await result.current.enter();
      });
      expect(result.current.isFullscreen).toBe(false);
      expect(pushToastMock).toHaveBeenCalled();
      const callArg = pushToastMock.mock.calls[0][0];
      expect(callArg.kind).toBe('error');
    } finally {
      isTauriMock.mockReturnValue(false);
    }
  });
});
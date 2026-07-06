/**
 * useFileChangeReload.test.tsx — T26 (R-12 修复) 单元测试.
 *
 * 覆盖:
 *   - focus 事件触发时, mtime 较新才 dispatch loadFile.
 *   - mtime 一致时, 不 dispatch (防 mid-edit 闪烁).
 *   - idle / loading / error 状态, focus 不触发.
 *   - 手动 reload() 不走 mtime 短路.
 *   - 同一时刻多次 focus 抖动, 只发一次 IPC (in-flight 闸).
 *   - 切换 path, mtime 缓存按 path 隔离.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { useFileChangeReload } from '../useFileChangeReload';
import { useDocStore } from '../../stores/docStore';
import * as tauri from '../../lib/tauri';
import type { MarkdownStatus } from '../../types/markdown';

const FIXTURE_PATH = '/tmp/kite-test-reload.md';

function setDocState(path: string | null, status: MarkdownStatus): void {
  useDocStore.setState((s) => ({
    ...s,
    state: { ...s.state, currentPath: path, status },
  }));
}

function fireWindowFocus(): void {
  act(() => {
    window.dispatchEvent(new Event('focus'));
  });
}

function fireVisibilityVisible(): void {
  act(() => {
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

describe('useFileChangeReload — T26 (R-12 修复)', () => {
  beforeEach(() => {
    useDocStore.setState((s) => ({
      ...s,
      state: { ...s.state, currentPath: null, status: 'idle' as MarkdownStatus },
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('focus + mtime 较新 → 调 loadFile', async () => {
    setDocState(FIXTURE_PATH, 'ok');
    const getFileFresh = vi
      .spyOn(tauri, 'getFileFresh')
      .mockResolvedValue({ mtime: 1234, content: '# new' });
    const loadFile = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() => useFileChangeReload(loadFile, 'ok'));
    fireWindowFocus();

    // 等待 IPC 异步返回 + loadFile 调用
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(getFileFresh).toHaveBeenCalledWith(FIXTURE_PATH);
    expect(loadFile).toHaveBeenCalledWith(FIXTURE_PATH);
    // mtime 已记录
    expect(result.current.getMtime(FIXTURE_PATH)).toBe(1234);
  });

  it('focus + mtime 一致 → 不调 loadFile (防闪烁)', async () => {
    setDocState(FIXTURE_PATH, 'ok');
    vi.spyOn(tauri, 'getFileFresh').mockResolvedValue({ mtime: 1234, content: '# same' });
    const loadFile = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() => useFileChangeReload(loadFile, 'ok'));

    // 预热: 第一次 focus 触发 reload, mtime 写入缓存
    fireWindowFocus();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(loadFile).toHaveBeenCalledTimes(1);

    // 第二次 focus: 同样的 mtime, 不应再 reload
    loadFile.mockClear();
    fireWindowFocus();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(loadFile).not.toHaveBeenCalled();
    expect(result.current.getMtime(FIXTURE_PATH)).toBe(1234);
  });

  it('status 非 ok → focus 不触发', async () => {
    setDocState(FIXTURE_PATH, 'loading');
    const _getFileFresh = vi.spyOn(tauri, 'getFileFresh');
    const loadFile = vi.fn().mockResolvedValue(undefined);

    renderHook(() => useFileChangeReload(loadFile, 'loading'));
    fireWindowFocus();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(_getFileFresh).not.toHaveBeenCalled();
    expect(loadFile).not.toHaveBeenCalled();
  });

  it('currentPath 为空 → focus 不触发', async () => {
    setDocState(null, 'ok');
    const _getFileFresh = vi.spyOn(tauri, 'getFileFresh');
    const loadFile = vi.fn().mockResolvedValue(undefined);

    renderHook(() => useFileChangeReload(loadFile, 'ok'));
    fireWindowFocus();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(_getFileFresh).not.toHaveBeenCalled();
  });

  it('手动 reload() 不走 mtime 短路', async () => {
    setDocState(FIXTURE_PATH, 'ok');
    const getFileFresh = vi.spyOn(tauri, 'getFileFresh');
    const loadFile = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() => useFileChangeReload(loadFile, 'ok'));
    // 强制 reload, 即便没 focus 事件
    act(() => {
      result.current.reload();
    });
    expect(loadFile).toHaveBeenCalledWith(FIXTURE_PATH);
    // 手动 reload 不调 getFileFresh 短路检查
    expect(getFileFresh).not.toHaveBeenCalled();
  });

  it('手动 reload() 完成后, 自动 getFileFresh 同步 mtime', async () => {
    setDocState(FIXTURE_PATH, 'ok');
    // reload 完成后会调一次 getFileFresh 同步 mtime.
    const getFileFresh = vi
      .spyOn(tauri, 'getFileFresh')
      .mockResolvedValue({ mtime: 5678, content: '# manual' });
    const loadFile = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() => useFileChangeReload(loadFile, 'ok'));
    act(() => {
      result.current.reload();
    });
    // 等异步链完成
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(getFileFresh).toHaveBeenCalledWith(FIXTURE_PATH);
    expect(result.current.getMtime(FIXTURE_PATH)).toBe(5678);
  });

  it('多次连续 focus 抖动, 只发一次 IPC (in-flight 闸)', async () => {
    setDocState(FIXTURE_PATH, 'ok');
    let resolveIpc: (v: { mtime: number; content: string }) => void = () => {};
    const getFileFresh = vi.spyOn(tauri, 'getFileFresh').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveIpc = resolve;
        }),
    );
    const loadFile = vi.fn().mockResolvedValue(undefined);

    renderHook(() => useFileChangeReload(loadFile, 'ok'));

    // 第一次 focus: 启动 IPC, 但还没 resolve
    fireWindowFocus();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(getFileFresh).toHaveBeenCalledTimes(1);

    // 后续 3 次 focus: 闸闭, 不应启动新 IPC
    fireWindowFocus();
    fireWindowFocus();
    fireWindowFocus();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(getFileFresh).toHaveBeenCalledTimes(1);

    // resolve IPC, 释放闸
    await act(async () => {
      resolveIpc({ mtime: 1, content: 'a' });
      await new Promise((r) => setTimeout(r, 0));
    });

    // 下一次 focus 应该可以再次启动
    fireWindowFocus();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(getFileFresh).toHaveBeenCalledTimes(2);
  });

  it('visibilitychange=visible 触发同样的检查', async () => {
    setDocState(FIXTURE_PATH, 'ok');
    const getFileFresh = vi
      .spyOn(tauri, 'getFileFresh')
      .mockResolvedValue({ mtime: 100, content: 'x' });
    const loadFile = vi.fn().mockResolvedValue(undefined);

    renderHook(() => useFileChangeReload(loadFile, 'ok'));
    fireVisibilityVisible();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(getFileFresh).toHaveBeenCalledWith(FIXTURE_PATH);
    expect(loadFile).toHaveBeenCalledWith(FIXTURE_PATH);
  });

  it('切换 path: mtime 缓存按 path 隔离, 不串扰', async () => {
    const PATH_A = '/tmp/a.md';
    const PATH_B = '/tmp/b.md';

    // 阶段 1: PATH_A 的 mtime 写入
    setDocState(PATH_A, 'ok');
    const getFileFresh = vi.spyOn(tauri, 'getFileFresh').mockResolvedValue({ mtime: 100, content: 'a' });
    const loadFile = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() => useFileChangeReload(loadFile, 'ok'));
    fireWindowFocus();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(result.current.getMtime(PATH_A)).toBe(100);
    expect(result.current.getMtime(PATH_B)).toBe(0);

    // 阶段 2: 切到 PATH_B, 它的 mtime 是新的
    setDocState(PATH_B, 'ok');
    getFileFresh.mockResolvedValue({ mtime: 200, content: 'b' });
    fireWindowFocus();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(result.current.getMtime(PATH_B)).toBe(200);
    // PATH_A 缓存不变
    expect(result.current.getMtime(PATH_A)).toBe(100);
  });

  it('IPC 失败 → push error toast, 不 throw', async () => {
    setDocState(FIXTURE_PATH, 'ok');
    // 让 lib/tauri getFileFresh 抛 AppError; 真实 pushToast 副作用在测试里不验, 只验
    // loadFile 不被调, hook 不抛.
    vi.spyOn(tauri, 'getFileFresh').mockRejectedValue({
      code: 'NOT_FOUND',
      message: 'not found',
      name: 'AppError',
    });
    const loadFile = vi.fn().mockResolvedValue(undefined);
    // spyOn pushToast 避免 noise
    const toast = await import('../../lib/toast');
    const pushToastSpy = vi.spyOn(toast, 'pushToast').mockImplementation(() => {});

    const { result } = renderHook(() => useFileChangeReload(loadFile, 'ok'));

    // 不应 throw
    expect(() => {
      fireWindowFocus();
    }).not.toThrow();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(loadFile).not.toHaveBeenCalled();
    expect(pushToastSpy).toHaveBeenCalled();
    void result; // silence unused
  });
});

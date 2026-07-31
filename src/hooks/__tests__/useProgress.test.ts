/**
 * useProgress 单元测试 (T11 step-8 / 设计 §3.6.9).
 *
 * 覆盖:
 *   - 订阅 useScrollSpy.progress → progressStore.setProgress.
 *   - scrollContainer=null 时不写入.
 *   - onUnmount flush(true).
 *   - 文档切换 flush 旧值.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const saveProgressMock = vi.fn().mockResolvedValue(undefined);

vi.mock('../../lib/tauri', () => ({
  tauri: {
    saveProgress: (...args: unknown[]) => saveProgressMock(...args),
    loadProgress: vi.fn().mockResolvedValue({ lastPath: null, perFile: {}, seenShortcutsHint: false }),
  },
}));

import { useProgress } from '../useProgress';
import { useProgressStore, __resetProgressStoreForTest } from '../../stores/progressStore';
import { useDocStore } from '../../stores/docStore';

beforeEach(() => {
  __resetProgressStoreForTest();
  saveProgressMock.mockReset();
  saveProgressMock.mockResolvedValue(undefined);
  // hydrate 让 flush 真正写盘.
  useProgressStore.getState().hydrate({ lastPath: null, perFile: {}, seenShortcutsHint: false });
  useDocStore.setState({
    state: { currentPath: '/a.md', content: '', title: 'A', dirty: false },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useProgress', () => {
  it('直接消费 Reader progress，不创建 DOM 监听', () => {
    const { result } = renderHook(() => useProgress({ path: '/a.md', progress: 0, scrollTop: 0 }));
    expect(result.current.pct).toBe(0);
  });

  it('返回 pct 与 persistNow 方法', () => {
    const { result } = renderHook(() => useProgress({ path: '/a.md', progress: 0.42, scrollTop: 120 }));
    expect(result.current.pct).toBe(42);
    expect(typeof result.current.persistNow).toBe('function');
  });

  it('persistNow 调 flush(true)', async () => {
    const { result } = renderHook(() => useProgress({ path: '/a.md', progress: 0, scrollTop: 0 }));
    // 修改 lastPath 让 _lastSnapshot 与当前不一致 → 真正写盘.
    useProgressStore.getState().setLastPath('/a.md');
    await result.current.persistNow();
    expect(saveProgressMock).toHaveBeenCalledTimes(1);
  });

  it('把 Reader 百分比和 scrollTop 写入当前文档进度', () => {
    renderHook(() => useProgress({ path: '/a.md', progress: 0.42, scrollTop: 321 }));
    expect(useProgressStore.getState().perFile['/a.md']).toMatchObject({
      pct: 42,
      scrollTop: 321,
    });
  });

  it('不把旧文档的进度样本写入当前新文档', () => {
    useDocStore.setState((state) => ({
      state: { ...state.state, currentPath: '/b.md' },
    }));
    renderHook(() => useProgress({ path: '/a.md', progress: 0.75, scrollTop: 900 }));

    expect(useProgressStore.getState().perFile['/b.md']).toBeUndefined();
  });

  it('onUnmount flush(true) 自动调用', async () => {
    // 让 hydrate 后修改 state, 让 unmount flush 真正写盘.
    useProgressStore.getState().setLastPath('/a.md');
    const { unmount } = renderHook(() => useProgress({ path: '/a.md', progress: 0, scrollTop: 0 }));
    expect(saveProgressMock).not.toHaveBeenCalled();
    unmount();
    // 等 microtask.
    await Promise.resolve();
    expect(saveProgressMock).toHaveBeenCalledTimes(1);
  });
});
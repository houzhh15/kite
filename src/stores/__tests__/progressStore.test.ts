/**
 * progressStore 单元测试 (T11 step-7 / 设计 §3.6.2..3.6.4).
 *
 * 覆盖:
 *   - sanitize: pct / scrollTop 越界 → clamp.
 *   - hydrate: 正常 partial / 损坏 perFile / 缺字段 / null.
 *   - setProgress / getProgress / removeProgress.
 *   - flush: dirty=false 不发 IPC; dirty=true debounce 300ms 一次 IPC.
 *   - setLastPath: trim + null 处理.
 *   - resetCorrupted: 清空 + hydrated=true + 不立即 flush.
 *   - seenShortcutsHint: setSeenShortcutsHint.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const saveProgressMock = vi.fn();
const loadProgressMock = vi.fn();

vi.mock('../../lib/tauri', () => ({
  tauri: {
    saveProgress: (...args: unknown[]) => saveProgressMock(...args),
    loadProgress: (...args: unknown[]) => loadProgressMock(...args),
  },
  saveProgress: (...args: unknown[]) => saveProgressMock(...args),
  loadProgress: (...args: unknown[]) => loadProgressMock(...args),
}));

import {
  useProgressStore,
  __resetProgressStoreForTest,
} from '../progressStore';

beforeEach(() => {
  __resetProgressStoreForTest();
  saveProgressMock.mockReset();
  saveProgressMock.mockResolvedValue(undefined);
  loadProgressMock.mockReset();
  vi.useRealTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('progressStore.hydrate', () => {
  it('正常 partial: 合并 perFile + lastPath + seenShortcutsHint', () => {
    useProgressStore.getState().hydrate({
      lastPath: '/abs/a.md',
      perFile: {
        '/abs/a.md': { pct: 50, scrollTop: 300, updatedAt: 1700000000 },
      },
      seenShortcutsHint: true,
    });
    const s = useProgressStore.getState();
    expect(s.hydrated).toBe(true);
    expect(s.lastPath).toBe('/abs/a.md');
    expect(s.perFile['/abs/a.md'].pct).toBe(50);
    expect(s.perFile['/abs/a.md'].scrollTop).toBe(300);
    expect(s.seenShortcutsHint).toBe(true);
  });

  it('损坏 perFile (数组) → resetCorrupted', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    useProgressStore.getState().hydrate({ perFile: [] as never });
    const s = useProgressStore.getState();
    expect(s.hydrated).toBe(true);
    expect(s.perFile).toEqual({});
    expect(s.lastPath).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it('perFile 中单条 entry 字段类型错 → 跳过该条', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    useProgressStore.getState().hydrate({
      perFile: {
        '/abs/bad.md': { pct: 'fifty' as never, scrollTop: 0, updatedAt: 0 },
        '/abs/good.md': { pct: 25, scrollTop: 100, updatedAt: 1700000000 },
      },
    });
    const s = useProgressStore.getState();
    expect(s.perFile['/abs/good.md']).toBeDefined();
    expect(s.perFile['/abs/bad.md']).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it('hydrate(null) → resetCorrupted', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    useProgressStore.getState().hydrate(null);
    expect(useProgressStore.getState().hydrated).toBe(true);
    expect(useProgressStore.getState().perFile).toEqual({});
    expect(warn).toHaveBeenCalled();
  });

  it('seenShortcutsHint 缺省 → false', () => {
    useProgressStore.getState().hydrate({ lastPath: null, perFile: {} });
    expect(useProgressStore.getState().seenShortcutsHint).toBe(false);
  });
});

describe('progressStore.sanitize via setProgress', () => {
  it('pct=-10 → 0', () => {
    useProgressStore.getState().setProgress('/a.md', -10, 0);
    expect(useProgressStore.getState().perFile['/a.md'].pct).toBe(0);
  });

  it('pct=150 → 100', () => {
    useProgressStore.getState().setProgress('/a.md', 150, 0);
    expect(useProgressStore.getState().perFile['/a.md'].pct).toBe(100);
  });

  it('scrollTop=-5 → 0', () => {
    useProgressStore.getState().setProgress('/a.md', 50, -5);
    expect(useProgressStore.getState().perFile['/a.md'].scrollTop).toBe(0);
  });

  it('NaN pct / scrollTop → 0 (with warn)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    useProgressStore.getState().setProgress('/a.md', NaN, NaN);
    const e = useProgressStore.getState().perFile['/a.md'];
    expect(e.pct).toBe(0);
    expect(e.scrollTop).toBe(0);
    expect(warn).toHaveBeenCalled();
  });

  it('updatedAt 自动设当前时间 (秒)', () => {
    const before = Math.floor(Date.now() / 1000);
    useProgressStore.getState().setProgress('/a.md', 50, 0);
    const e = useProgressStore.getState().perFile['/a.md'];
    expect(e.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it('空字符串路径 → 不写入', () => {
    useProgressStore.getState().setProgress('', 50, 0);
    expect(useProgressStore.getState().perFile).toEqual({});
  });
});

describe('progressStore.flush', () => {
  beforeEach(() => {
    // hydrate 让 flush 真正写盘 (未 hydrate 时为防覆盖磁盘保留 dirty=true).
    useProgressStore.getState().hydrate({ lastPath: null, perFile: {}, seenShortcutsHint: false });
  });

  it('dirty=false + force=false → 不发 IPC', async () => {
    await useProgressStore.getState().flush(false);
    expect(saveProgressMock).not.toHaveBeenCalled();
  });

  it('dirty=true → 一次 IPC (debounce 后)', async () => {
    vi.useFakeTimers();
    useProgressStore.getState().setProgress('/a.md', 50, 100);
    expect(saveProgressMock).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(saveProgressMock).toHaveBeenCalledTimes(1);
    expect(saveProgressMock).toHaveBeenCalledWith(
      expect.objectContaining({
        perFile: expect.objectContaining({
          '/a.md': expect.objectContaining({ pct: 50, scrollTop: 100 }),
        }),
      }),
    );
  });

  it('连续 100 次 setProgress → 只 1 次 IPC', async () => {
    vi.useFakeTimers();
    for (let i = 0; i < 100; i++) {
      useProgressStore.getState().setProgress('/a.md', i % 101, i);
    }
    await vi.runAllTimersAsync();
    expect(saveProgressMock).toHaveBeenCalledTimes(1);
  });

  it('setLastPath(null) 写盘后 lastPath=null', () => {
    useProgressStore.getState().setLastPath(null);
    expect(useProgressStore.getState().lastPath).toBeNull();
  });

  it('IPC 失败 → 保留 dirty=true (下次静置再试)', async () => {
    vi.useFakeTimers();
    saveProgressMock.mockRejectedValueOnce(new Error('boom'));
    useProgressStore.getState().setProgress('/a.md', 50, 100);
    await vi.runAllTimersAsync();
    expect(saveProgressMock).toHaveBeenCalledTimes(1);
    // 再次 setProgress + flush 应该重试.
    saveProgressMock.mockResolvedValue(undefined);
    useProgressStore.getState().setProgress('/a.md', 51, 101);
    await vi.runAllTimersAsync();
    expect(saveProgressMock).toHaveBeenCalledTimes(2);
  });
});

describe('progressStore.removeProgress', () => {
  it('删除存在的条目 → perFile 不再含该条', () => {
    useProgressStore.getState().hydrate({
      perFile: { '/a.md': { pct: 50, scrollTop: 100, updatedAt: 1 } },
    });
    useProgressStore.getState().removeProgress('/a.md');
    expect(useProgressStore.getState().perFile['/a.md']).toBeUndefined();
  });

  it('删除不存在条目 → no-op', () => {
    useProgressStore.getState().hydrate({
      perFile: { '/a.md': { pct: 50, scrollTop: 100, updatedAt: 1 } },
    });
    useProgressStore.getState().removeProgress('/nonexistent.md');
    expect(useProgressStore.getState().perFile['/a.md']).toBeDefined();
  });
});

describe('progressStore.resetCorrupted', () => {
  it('清空 lastPath/perFile + 设 hydrated=true + 不立即 flush', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    useProgressStore.getState().hydrate({
      lastPath: '/a.md',
      perFile: { '/a.md': { pct: 50, scrollTop: 100, updatedAt: 1 } },
    });
    useProgressStore.getState().resetCorrupted('test');
    const s = useProgressStore.getState();
    expect(s.hydrated).toBe(true);
    expect(s.lastPath).toBeNull();
    expect(s.perFile).toEqual({});
    expect(warn).toHaveBeenCalled();
    // resetCorrupted 不主动 flush.
    expect(saveProgressMock).not.toHaveBeenCalled();
  });
});

describe('progressStore.setSeenShortcutsHint', () => {
  beforeEach(() => {
    useProgressStore.getState().hydrate({ lastPath: null, perFile: {}, seenShortcutsHint: false });
  });

  it('true → 写盘', async () => {
    vi.useFakeTimers();
    useProgressStore.getState().setSeenShortcutsHint(true);
    expect(useProgressStore.getState().seenShortcutsHint).toBe(true);
    await vi.runAllTimersAsync();
    expect(saveProgressMock).toHaveBeenCalledTimes(1);
    expect(saveProgressMock).toHaveBeenCalledWith(
      expect.objectContaining({ seenShortcutsHint: true }),
    );
  });

  it('重复相同值 → no-op', () => {
    useProgressStore.getState().setSeenShortcutsHint(true);
    useProgressStore.getState().setSeenShortcutsHint(true);
    expect(saveProgressMock).not.toHaveBeenCalled();
  });
});

describe('progressStore.consumeLastPath', () => {
  it('读不消费 — 多次读取返回同值', () => {
    useProgressStore.getState().hydrate({ lastPath: '/a.md', perFile: {} });
    expect(useProgressStore.getState().consumeLastPath()).toBe('/a.md');
    expect(useProgressStore.getState().consumeLastPath()).toBe('/a.md');
    expect(useProgressStore.getState().lastPath).toBe('/a.md');
  });
});
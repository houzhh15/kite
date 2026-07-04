/**
 * recentStore.test.ts — Vitest 单元测试 (F-03 / 设计 §5.2 矩阵).
 *
 * 覆盖:
 *   - pushRecent_dedup: 同 path 重复 → length=1, openedAt 更新 (AC-02).
 *   - pushRecent_truncate: 12 条 → length=10, 前 2 条淘汰 (AC-03).
 *   - pushRecent_invokes_add: tauri.addRecentFile 以同参调用一次 (AC-01).
 *   - pushRecent_toast_on_ipc_error: invoke 失败 → toast.error (AC-05).
 *   - load_handles_ipc_error: getRecentFiles 抛错 → items=[], loaded=true (AC-08).
 *   - load_handles_oversized_response: 长度 > 10 → 截断到 10 (NFR-04).
 *   - clearRecent_invokes: 用户确认 → items=[], invoke 一次 (AC-04).
 *   - clearRecent_rollback_on_error: invoke 失败 → items 回滚 + toast.error (NFR-05).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useRecentStore } from '../recentStore';

vi.mock('../../lib/tauri', () => {
  const fn = () => vi.fn().mockResolvedValue(undefined);
  const getRecentFiles = vi.fn();
  const addRecentFile = vi.fn().mockResolvedValue(undefined);
  const clearRecentFiles = vi.fn().mockResolvedValue(undefined);
  return {
    getRecentFiles,
    addRecentFile,
    clearRecentFiles,
    readMarkdownFile: fn(),
    loadPreferences: fn(),
    savePreferences: fn(),
    openExternalUrl: fn(),
    resolveImagePath: fn(),
    setWindowTitle: fn(),
    tauri: {
      getRecentFiles,
      addRecentFile,
      clearRecentFiles,
    },
  };
});

vi.mock('../../lib/toast', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../lib/toast');
  return {
    ...actual,
    pushToast: vi.fn(),
  };
});

import { addRecentFile, clearRecentFiles, getRecentFiles } from '../../lib/tauri';
import { pushToast } from '../../lib/toast';

const mockGet = getRecentFiles as unknown as ReturnType<typeof vi.fn>;
const mockAdd = addRecentFile as unknown as ReturnType<typeof vi.fn>;
const mockClear = clearRecentFiles as unknown as ReturnType<typeof vi.fn>;
const mockPushToast = pushToast as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockGet.mockReset();
  mockAdd.mockReset();
  mockAdd.mockResolvedValue(undefined);
  mockClear.mockReset();
  mockClear.mockResolvedValue(undefined);
  mockPushToast.mockReset();
  useRecentStore.setState({ items: [], loaded: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('recentStore — pushRecent', () => {
  it('dedup: same path twice → length=1 with latest openedAt (AC-02)', () => {
    const firstTimestamp = '2026-01-01T00:00:00.000Z';
    const later = '2026-06-01T00:00:00.000Z';
    useRecentStore.setState({
      items: [{ path: '/a.md', title: 'a', lastOpenedAt: firstTimestamp }],
      loaded: true,
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date(later));
    useRecentStore.getState().pushRecent('/a.md', 'a');
    vi.useRealTimers();
    const items = useRecentStore.getState().items;
    expect(items).toHaveLength(1);
    const head = items[0];
    expect(head?.path).toBe('/a.md');
    // lastOpenedAt 应被更新 (fake timer 驱动 new Date().toISOString() == later).
    expect(head?.lastOpenedAt).toBe(later);
  });

  it('truncate: 12 distinct paths → length=10 (AC-03)', () => {
    for (let i = 0; i < 12; i++) {
      useRecentStore.getState().pushRecent(`/p${i}.md`, `p${i}`);
    }
    const items = useRecentStore.getState().items;
    expect(items).toHaveLength(10);
    // 最新 push 的 p11 应该在最前.
    expect(items[0]?.path).toBe('/p11.md');
    const paths = items.map((it) => it.path);
    expect(paths).not.toContain('/p0.md');
    expect(paths).not.toContain('/p1.md');
  });

  it('invokes addRecentFile with correct args (AC-01)', () => {
    useRecentStore.getState().pushRecent('/x.md', 'x');
    expect(mockAdd).toHaveBeenCalledTimes(1);
    expect(mockAdd).toHaveBeenCalledWith('/x.md', 'x');
  });

  it('derives title from path when title is empty', () => {
    useRecentStore.getState().pushRecent('/foo/bar.md', '');
    const items = useRecentStore.getState().items;
    expect(items[0]?.title).toBe('bar');
    expect(mockAdd).toHaveBeenCalledWith('/foo/bar.md', 'bar');
  });

  it('toasts on invoke error (AC-05)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockAdd.mockImplementationOnce(async () => {
      throw new Error('disk full');
    });
    useRecentStore.getState().pushRecent('/a.md', 'a');
    return Promise.resolve().then(() => {
      expect(warn).toHaveBeenCalled();
      expect(mockPushToast).toHaveBeenCalledTimes(1);
      const arg = mockPushToast.mock.calls[0]?.[0] as { kind: string; message: string };
      expect(arg.kind).toBe('error');
    });
  });

  it('does not call invoke for empty path (FR-02 兜底)', () => {
    useRecentStore.getState().pushRecent('', 'x');
    expect(mockAdd).not.toHaveBeenCalled();
    expect(useRecentStore.getState().items).toHaveLength(0);
  });
});

describe('recentStore — load', () => {
  it('hydrates items on success (AC-10)', async () => {
    mockGet.mockResolvedValue([
      { path: '/a.md', title: 'a', lastOpenedAt: '2026-01-01T00:00:00Z' },
      { path: '/b.md', title: 'b', lastOpenedAt: '2026-01-02T00:00:00Z' },
    ]);
    await useRecentStore.getState().load();
    const s = useRecentStore.getState();
    expect(s.items).toHaveLength(2);
    expect(s.loaded).toBe(true);
  });

  it('handles IPC error with empty items + loaded=true (AC-08)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockGet.mockRejectedValueOnce(new Error('boom'));
    await useRecentStore.getState().load();
    const s = useRecentStore.getState();
    expect(s.items).toEqual([]);
    expect(s.loaded).toBe(true);
    expect(warn).toHaveBeenCalled();
  });

  it('truncates oversized response to MAX_RECENT (NFR-04)', async () => {
    const items = Array.from({ length: 15 }, (_, i) => ({
      path: `/p${i}.md`,
      title: `p${i}`,
      lastOpenedAt: '2026-01-01T00:00:00Z',
    }));
    mockGet.mockResolvedValue(items);
    await useRecentStore.getState().load();
    expect(useRecentStore.getState().items).toHaveLength(10);
  });
});

describe('recentStore — clearRecent', () => {
  it('invokes clearRecentFiles and toasts on success (AC-04)', async () => {
    useRecentStore.setState({
      items: [{ path: '/a.md', title: 'a', lastOpenedAt: 'x' }],
      loaded: true,
    });
    await useRecentStore.getState().clearRecent();
    expect(mockClear).toHaveBeenCalledTimes(1);
    expect(useRecentStore.getState().items).toEqual([]);
    expect(mockPushToast).toHaveBeenCalledTimes(1);
    const arg = mockPushToast.mock.calls[0]?.[0] as { kind: string; message: string };
    expect(arg.kind).toBe('success');
    expect(arg.message).toContain('已清空');
  });

  it('rolls back items on invoke error (NFR-05)', async () => {
    const prev = [{ path: '/a.md', title: 'a', lastOpenedAt: 'x' }];
    useRecentStore.setState({ items: prev, loaded: true });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockClear.mockImplementationOnce(async () => {
      throw new Error('io');
    });
    await useRecentStore.getState().clearRecent();
    const s = useRecentStore.getState();
    expect(s.items).toEqual(prev);
    expect(warn).toHaveBeenCalled();
    expect(mockPushToast).toHaveBeenCalledTimes(1);
    const arg = mockPushToast.mock.calls[0]?.[0] as { kind: string; message: string };
    expect(arg.kind).toBe('error');
  });
});
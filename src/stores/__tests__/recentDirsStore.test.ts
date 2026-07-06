/**
 * recentDirsStore.test.ts — Vitest 单元测试 (F-27 / T25 / 设计 §3.2 / §5.2).
 *
 * 覆盖 (与 recentStore.test.ts 对称, 但覆盖最近目录独立需求):
 *   - load: 成功 → items + loaded=true (AC-02-1 / AC-02-5).
 *   - load_handles_ipc_error: getRecentDirs 抛错 → items=[], loaded=true (NFR-S-01 / AC-02-6).
 *   - load_handles_oversized_response: 长度 > 8 → 截断到 8 (NFR-04 双重防御).
 *   - push_dedup: 同 path 重复 → length=1, 提到首位 (AC-03-3 / AC-03-5).
 *   - push_dedup_case_insensitive: 大小写不敏感去重 (POSIX vs Windows 跨平台).
 *   - push_truncate: 9 条 → length=8, 最新置顶 (AC-03-4).
 *   - push_invokes_addRecentDir: store.push 调用 tauri.addRecentDir 一次 (AC-03-1).
 *   - push_handles_ipc_error: invoke 失败 → toast.error, items 保留 (NFR-S-01).
 *   - remove: items 中存在 → 移除 + invoke 一次 (AC-03-6).
 *   - remove_idempotent: items 中不存在 → 不动 + invoke 仍然 1 次 (幂等).
 *   - remove_rollback_on_error: invoke 失败 → items 回滚 + toast.error (NFR-M-01).
 *   - clear: items=[] + invoke 一次 (AC-03-7).
 *   - clear_rollback_on_error: invoke 失败 → items 回滚 + toast.error (NFR-M-01).
 *   - clear_idempotent_on_empty: 空列表 → invoke 仍然 1 次.
 *   - maxItems_exposed: 8 (与 Rust MAX_RECENT_DIRS=8 双源契约).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 必须在 import store 前 mock 依赖 (i18n / tauri / toast).
vi.mock('../../lib/tauri', () => {
  const fn = () => vi.fn().mockResolvedValue(undefined);
  const getRecentDirs = vi.fn();
  const addRecentDir = vi.fn().mockResolvedValue(undefined);
  const removeRecentDir = vi.fn().mockResolvedValue(undefined);
  const clearRecentDirs = vi.fn().mockResolvedValue(undefined);
  return {
    getRecentDirs,
    addRecentDir,
    removeRecentDir,
    clearRecentDirs,
    readMarkdownFile: fn(),
    loadPreferences: fn(),
    savePreferences: fn(),
    openExternalUrl: fn(),
    resolveImagePath: fn(),
    setWindowTitle: fn(),
    tauri: {
      getRecentDirs,
      addRecentDir,
      removeRecentDir,
      clearRecentDirs,
    },
  };
});

vi.mock('../../lib/toast', () => ({
  pushToast: vi.fn(),
}));

// i18n: stub t() 直接返回 key 名称; 转走 init 跳过 ResourceBundle 加载.
vi.mock('../../i18n', () => ({
  default: { t: (k: string) => k, changeLanguage: vi.fn() },
}));

import { useRecentDirsStore, MAX_RECENT_DIRS } from '../recentDirsStore';
import { tauri } from '../../lib/tauri';
import { pushToast } from '../../lib/toast';

const mockedTauri = tauri as unknown as {
  getRecentDirs: ReturnType<typeof vi.fn>;
  addRecentDir: ReturnType<typeof vi.fn>;
  removeRecentDir: ReturnType<typeof vi.fn>;
  clearRecentDirs: ReturnType<typeof vi.fn>;
};
const mockedPushToast = pushToast as unknown as ReturnType<typeof vi.fn>;

function makeItem(path: string, offsetMinutes = 0): {
  path: string;
  lastOpenedAt: string;
  displayName: string;
} {
  return {
    path,
    lastOpenedAt: new Date(Date.now() + offsetMinutes * 60_000).toISOString(),
    displayName: path.split('/').pop() ?? path,
  };
}

function resetStore(): void {
  // 通过 hydrate 出一个空数组确保 loaded=true, items=[].
  mockedTauri.getRecentDirs.mockReset().mockResolvedValue([]);
  useRecentDirsStore.setState({ items: [], loaded: false });
}

beforeEach(() => {
  resetStore();
  mockedTauri.getRecentDirs.mockReset().mockResolvedValue([]);
  mockedTauri.addRecentDir.mockReset().mockResolvedValue(undefined);
  mockedTauri.removeRecentDir.mockReset().mockResolvedValue(undefined);
  mockedTauri.clearRecentDirs.mockReset().mockResolvedValue(undefined);
  mockedPushToast.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('recentDirsStore (F-27 / T25)', () => {
  it('maxItems_exposed: 8 (与 Rust MAX_RECENT_DIRS=8 双源契约)', () => {
    expect(MAX_RECENT_DIRS).toBe(8);
  });

  it('load: 成功 → items + loaded=true', async () => {
    const remote = [makeItem('/a'), makeItem('/b')];
    mockedTauri.getRecentDirs.mockResolvedValueOnce(remote);
    await useRecentDirsStore.getState().load();
    const state = useRecentDirsStore.getState();
    expect(state.items).toEqual(remote);
    expect(state.loaded).toBe(true);
    expect(state.maxItems).toBe(8);
  });

  it('load_handles_ipc_error: getRecentDirs 抛错 → items=[], loaded=true (NFR-S-01)', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockedTauri.getRecentDirs.mockRejectedValueOnce(new Error('IPC down'));
    await useRecentDirsStore.getState().load();
    const state = useRecentDirsStore.getState();
    expect(state.items).toEqual([]);
    expect(state.loaded).toBe(true);
    expect(consoleWarn).toHaveBeenCalled();
  });

  it('load_handles_oversized_response: 长度 > 8 → 截断到 8 (NFR-04)', async () => {
    const remote = Array.from({ length: 12 }, (_, i) => makeItem(`/dir${i}`));
    mockedTauri.getRecentDirs.mockResolvedValueOnce(remote);
    await useRecentDirsStore.getState().load();
    expect(useRecentDirsStore.getState().items).toHaveLength(8);
  });

  it('load_handles_non_array_response: 非数组 → items=[] (NFR-S-01)', async () => {
    // 防御性: Rust 端保证返回 Vec, 但 mock 环境可能传 null.
    mockedTauri.getRecentDirs.mockResolvedValueOnce(null);
    await useRecentDirsStore.getState().load();
    expect(useRecentDirsStore.getState().items).toEqual([]);
    expect(useRecentDirsStore.getState().loaded).toBe(true);
  });

  it('push_dedup: 同 path 重复 → length=1, 提到首位', () => {
    useRecentDirsStore.setState({ items: [makeItem('/a'), makeItem('/b')], loaded: true });
    useRecentDirsStore.getState().push('/b');
    const items = useRecentDirsStore.getState().items;
    expect(items).toHaveLength(2);
    expect(items[0].path).toBe('/b');
  });

  it('push_dedup_case_insensitive: 大小写不敏感', () => {
    useRecentDirsStore.setState({ items: [makeItem('/Users/Me/Notes')], loaded: true });
    useRecentDirsStore.getState().push('/users/me/notes');
    const items = useRecentDirsStore.getState().items;
    expect(items).toHaveLength(1);
  });

  it('push_truncate: 9 条 → length=8, 最新置顶 (AC-03-4)', () => {
    useRecentDirsStore.setState({ items: [], loaded: true });
    for (let i = 0; i < 9; i++) {
      useRecentDirsStore.getState().push(`/dir${i}`);
    }
    const items = useRecentDirsStore.getState().items;
    expect(items).toHaveLength(8);
    expect(items[0].path).toBe('/dir8');
  });

  it('push_invokes_addRecentDir: store.push 调用 tauri.addRecentDir 一次', async () => {
    useRecentDirsStore.setState({ items: [], loaded: true });
    useRecentDirsStore.getState().push('/foo');
    // fire-and-forget: 等待 microtask 跑完.
    await Promise.resolve();
    await Promise.resolve();
    expect(mockedTauri.addRecentDir).toHaveBeenCalledWith('/foo');
    expect(mockedTauri.addRecentDir).toHaveBeenCalledTimes(1);
  });

  it('push_handles_ipc_error: invoke 失败 → toast.error, items 保留', async () => {
    useRecentDirsStore.setState({ items: [makeItem('/a')], loaded: true });
    mockedTauri.addRecentDir.mockRejectedValueOnce(new Error('disk full'));
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    useRecentDirsStore.getState().push('/b');
    // 等 fire-and-forget 跑完.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(consoleWarn).toHaveBeenCalled();
    expect(mockedPushToast).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'error' }),
    );
    // 乐观更新仍生效.
    expect(useRecentDirsStore.getState().items[0].path).toBe('/b');
  });

  it('push_rejects_invalid_input: 空 / 非字符串 → 静默 no-op', () => {
    useRecentDirsStore.setState({ items: [], loaded: true });
    useRecentDirsStore.getState().push('');
    // @ts-expect-error testing runtime guard
    useRecentDirsStore.getState().push(undefined);
    // @ts-expect-error testing runtime guard
    useRecentDirsStore.getState().push(null);
    expect(useRecentDirsStore.getState().items).toEqual([]);
    expect(mockedTauri.addRecentDir).not.toHaveBeenCalled();
  });

  it('remove: items 中存在 → 移除 + invoke 一次', async () => {
    useRecentDirsStore.setState({
      items: [makeItem('/a'), makeItem('/b'), makeItem('/c')],
      loaded: true,
    });
    await useRecentDirsStore.getState().remove('/b');
    const items = useRecentDirsStore.getState().items;
    expect(items.map((i) => i.path)).toEqual(['/a', '/c']);
    expect(mockedTauri.removeRecentDir).toHaveBeenCalledWith('/b');
  });

  it('remove_idempotent: items 中不存在 → invoke 仍然 1 次 (Rust 幂等)', async () => {
    useRecentDirsStore.setState({ items: [makeItem('/a')], loaded: true });
    await useRecentDirsStore.getState().remove('/missing');
    // items 应保持原样 (lastOpenedAt 时间戳不重置).
    expect(useRecentDirsStore.getState().items).toEqual([makeItem('/a')]);
    expect(mockedTauri.removeRecentDir).toHaveBeenCalledTimes(1);
  });

  it('remove_rollback_on_error: invoke 失败 → items 回滚 + toast.error (NFR-M-01)', async () => {
    useRecentDirsStore.setState({
      items: [makeItem('/a'), makeItem('/b')],
      loaded: true,
    });
    mockedTauri.removeRecentDir.mockRejectedValueOnce(new Error('IO error'));
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await useRecentDirsStore.getState().remove('/a');
    const items = useRecentDirsStore.getState().items;
    expect(items.map((i) => i.path)).toEqual(['/a', '/b']);
    expect(consoleWarn).toHaveBeenCalled();
    expect(mockedPushToast).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'error' }),
    );
  });

  it('clear: items=[] + invoke 一次 (AC-03-7)', async () => {
    useRecentDirsStore.setState({ items: [makeItem('/a')], loaded: true });
    await useRecentDirsStore.getState().clear();
    expect(useRecentDirsStore.getState().items).toEqual([]);
    expect(mockedTauri.clearRecentDirs).toHaveBeenCalledTimes(1);
  });

  it('clear_rollback_on_error: invoke 失败 → items 回滚 + toast.error (NFR-M-01)', async () => {
    const prev = [makeItem('/a'), makeItem('/b')];
    useRecentDirsStore.setState({ items: prev, loaded: true });
    mockedTauri.clearRecentDirs.mockRejectedValueOnce(new Error('IO error'));
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await useRecentDirsStore.getState().clear();
    expect(useRecentDirsStore.getState().items).toEqual(prev);
    expect(consoleWarn).toHaveBeenCalled();
    expect(mockedPushToast).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'error' }),
    );
  });

  it('clear_idempotent_on_empty: 空列表 → invoke 仍然 1 次', async () => {
    useRecentDirsStore.setState({ items: [], loaded: true });
    await useRecentDirsStore.getState().clear();
    expect(mockedTauri.clearRecentDirs).toHaveBeenCalledTimes(1);
  });
});

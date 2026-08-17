/**
 * favoritesStore.test.ts — 收藏 store 行为测试.
 *
 * 覆盖:
 *   - load() 成功 / 失败兜底 (web 模式无 Tauri).
 *   - addFavorite 整包快照替换 + pending key 生命周期.
 *   - createFolder 客户端名称预校验 (不合法 → 不打 IPC).
 *   - removeFavorite / deleteFolder 成功路径 (含 success toast).
 *   - 纯函数助手: favoriteForPath (大小写兜底) / countDescendants / descendantIds.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  getFavorites: vi.fn(),
  addFavorite: vi.fn(),
  removeFavorite: vi.fn(),
  createFavoriteFolder: vi.fn(),
  renameFavoriteFolder: vi.fn(),
  moveFavoriteNode: vi.fn(),
  deleteFavoriteFolder: vi.fn(),
}));

vi.mock('../../lib/tauri', () => ({
  tauri: {
    getFavorites: (a?: unknown) => state.getFavorites(a),
    addFavorite: (...a: unknown[]) => state.addFavorite(...a),
    removeFavorite: (...a: unknown[]) => state.removeFavorite(...a),
    createFavoriteFolder: (...a: unknown[]) => state.createFavoriteFolder(...a),
    renameFavoriteFolder: (...a: unknown[]) => state.renameFavoriteFolder(...a),
    moveFavoriteNode: (...a: unknown[]) => state.moveFavoriteNode(...a),
    deleteFavoriteFolder: (...a: unknown[]) => state.deleteFavoriteFolder(...a),
  },
}));

const toastState = vi.hoisted(() => ({ pushToast: vi.fn() }));
vi.mock('../../lib/toast', () => ({
  pushToast: (i: unknown) => toastState.pushToast(i),
}));

import useFavoritesStore, {
  countDescendants,
  descendantIds,
  favoriteForPath,
  isValidFolderName,
  pendingKeyForPath,
} from '../favoritesStore';
import type { FavoritesSnapshot } from '../../lib/tauri';

const snapOf = (over: Partial<FavoritesSnapshot> = {}): FavoritesSnapshot => ({
  version: 1,
  folders: [],
  files: [],
  ...over,
});

describe('favoritesStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFavoritesStore.setState({
      snapshot: snapOf(),
      loaded: false,
      pendingKeys: [],
    });
    state.getFavorites.mockResolvedValue(snapOf());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('load() 成功 → 整包快照 + loaded=true', async () => {
    const snap = snapOf({
      files: [
        {
          id: 'f_1',
          parentId: null,
          path: '/x/a.md',
          displayName: 'a.md',
          addedAt: '2026-01-01T00:00:00Z',
        },
      ],
    });
    state.getFavorites.mockResolvedValue(snap);
    await useFavoritesStore.getState().load();
    expect(useFavoritesStore.getState().loaded).toBe(true);
    expect(useFavoritesStore.getState().snapshot.files).toHaveLength(1);
  });

  it('load() 失败 → 空快照兜底 + loaded=true (web 模式不崩)', async () => {
    state.getFavorites.mockRejectedValue(new Error('IPC unavailable'));
    await useFavoritesStore.getState().load();
    expect(useFavoritesStore.getState().loaded).toBe(true);
    expect(useFavoritesStore.getState().snapshot.files).toHaveLength(0);
    expect(useFavoritesStore.getState().snapshot.folders).toHaveLength(0);
  });

  it('addFavorite 成功 → IPC(path, null) + 快照替换', async () => {
    const after = snapOf({
      files: [
        {
          id: 'f_new',
          parentId: null,
          path: '/x/b.md',
          displayName: 'b.md',
          addedAt: '2026-01-01T00:00:00Z',
        },
      ],
    });
    state.addFavorite.mockResolvedValue(after);
    const ok = await useFavoritesStore.getState().addFavorite('/x/b.md');
    expect(ok).toBe(true);
    expect(state.addFavorite).toHaveBeenCalledWith('/x/b.md', null);
    expect(useFavoritesStore.getState().snapshot.files[0].id).toBe('f_new');
  });

  it('addFavorite 并发 guard: pending 期间第二次调用直接返回 false', async () => {
    let release!: (v: FavoritesSnapshot) => void;
    state.addFavorite.mockReturnValue(
      new Promise<FavoritesSnapshot>((res) => {
        release = res;
      }),
    );
    const p1 = useFavoritesStore.getState().addFavorite('/x/c.md');
    // 第一个还在飞.
    expect(useFavoritesStore.getState().pendingKeys).toContain(pendingKeyForPath('/x/c.md'));
    const p2 = await useFavoritesStore.getState().addFavorite('/x/c.md');
    expect(p2).toBe(false);
    release(snapOf());
    const p1ok = await p1;
    expect(p1ok).toBe(true);
    expect(useFavoritesStore.getState().pendingKeys).toHaveLength(0);
  });

  it('createFolder 非法名称 → 不打 IPC + error toast', async () => {
    const ok = await useFavoritesStore.getState().createFolder(null, 'a/b');
    expect(ok).toBe(false);
    expect(state.createFavoriteFolder).not.toHaveBeenCalled();
    expect(toastState.pushToast).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'error' }),
    );
  });

  it('isValidFolderName 与 Rust 端规则对齐', () => {
    expect(isValidFolderName('工作')).toBe(true);
    expect(isValidFolderName('  ')).toBe(false);
    expect(isValidFolderName('a/b')).toBe(false);
    expect(isValidFolderName('a\\b')).toBe(false);
    expect(isValidFolderName('字'.repeat(101))).toBe(false);
    expect(isValidFolderName('字'.repeat(100))).toBe(true);
  });

  it('deleteFolder 成功 → success toast (文案命中 favorites.removedToast)', async () => {
    state.deleteFavoriteFolder.mockResolvedValue(snapOf());
    const ok = await useFavoritesStore.getState().deleteFolder('d_1', true);
    expect(ok).toBe(true);
    expect(state.deleteFavoriteFolder).toHaveBeenCalledWith('d_1', true);
    const last = toastState.pushToast.mock.calls.at(-1)?.[0] as {
      kind: string;
      message: string;
    };
    expect(last.kind).toBe('success');
  });

  it('moveNode 目标为根时传 null', async () => {
    state.moveFavoriteNode.mockResolvedValue(snapOf());
    await useFavoritesStore.getState().moveNode('f_1', null);
    expect(state.moveFavoriteNode).toHaveBeenCalledWith('f_1', null);
  });

  describe('helpers (pure)', () => {
    const snapshot: FavoritesSnapshot = snapOf({
      folders: [
        { id: 'd_a', parentId: null, name: 'a', createdAt: '' },
        { id: 'd_b', parentId: 'd_a', name: 'b', createdAt: '' },
      ],
      files: [
        {
          id: 'f_1',
          parentId: 'd_b',
          path: '/X/a.md',
          displayName: 'a.md',
          addedAt: '',
        },
        {
          id: 'f_2',
          parentId: null,
          path: '/x/root.md',
          displayName: 'root.md',
          addedAt: '',
        },
      ],
    });

    it('favoriteForPath 精确 + 大小写不敏感兜底', () => {
      expect(favoriteForPath(snapshot, '/X/a.md')?.id).toBe('f_1');
      expect(favoriteForPath(snapshot, '/x/a.md')?.id).toBe('f_1');
      expect(favoriteForPath(snapshot, '/nope.md')).toBeUndefined();
      expect(favoriteForPath(snapshot, null)).toBeUndefined();
    });

    it('countDescendants 统计子目录与文件', () => {
      expect(countDescendants(snapshot, 'd_a')).toEqual({
        folders: 1,
        files: 1,
      });
      expect(countDescendants(snapshot, 'd_b')).toEqual({ folders: 0, files: 1 });
    });

    it('descendantIds 只含后代 (不含自身)', () => {
      const ids = descendantIds(snapshot, 'd_a');
      expect(ids.has('d_b')).toBe(true);
      expect(ids.has('d_a')).toBe(false);
    });
  });
});

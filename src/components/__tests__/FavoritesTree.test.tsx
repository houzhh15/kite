/**
 * FavoritesTree.test.tsx — 收藏虚拟文件夹树渲染与交互测试.
 *
 * 覆盖:
 *   - 空态文案 + 「＋」按钮存在.
 *   - 目录/文件行渲染; 点击文件 → onOpenFile(path).
 *   - 新建根目录 / 子目录 (草稿输入 → Enter 提交 → IPC 参数正确).
 *   - 重命名 (预填原名).
 *   - 「移动到…」（含根 + 子目录选项, 排除自身后代）.
 *   - 取消收藏; 删除目录 (confirm 流).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import i18n from '../../i18n';

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

vi.mock('../../lib/toast', () => ({
  pushToast: vi.fn(),
}));

import { FavoritesTree } from '../FavoritesTree';
import useFavoritesStore, { EMPTY_FAVORITES_SNAPSHOT } from '../../stores/favoritesStore';
import { useDocStore } from '../../stores/docStore';
import type { FavoritesSnapshot } from '../../lib/tauri';

const snapOf = (over: Partial<FavoritesSnapshot> = {}): FavoritesSnapshot => ({
  version: 1,
  folders: [],
  files: [],
  ...over,
});

function setSnapshot(snap: FavoritesSnapshot): void {
  useFavoritesStore.setState({ snapshot: snap, loaded: true });
}

describe('FavoritesTree', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN');
    vi.clearAllMocks();
    setSnapshot(snapOf());
    state.createFavoriteFolder.mockResolvedValue(snapOf());
    state.renameFavoriteFolder.mockResolvedValue(snapOf());
    state.moveFavoriteNode.mockResolvedValue(snapOf());
    state.deleteFavoriteFolder.mockResolvedValue(snapOf());
    state.removeFavorite.mockResolvedValue(snapOf());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useFavoritesStore.setState({
      snapshot: EMPTY_FAVORITES_SNAPSHOT,
      loaded: false,
      pendingKeys: [],
    });
  });

  it('空态: 显示 section + 空提示 + 新建按钮', () => {
    render(<FavoritesTree onOpenFile={() => {}} />);
    expect(screen.getByTestId('favorites-section')).toBeTruthy();
    expect(screen.getByText(/暂无收藏/)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: '新建目录' }),
    ).toBeTruthy();
  });

  it('渲染目录与文件行; 点击文件 → onOpenFile(path)', () => {
    setSnapshot(
      snapOf({
        folders: [
          { id: 'd_a', parentId: null, name: '工作', createdAt: '' },
        ],
        files: [
          {
            id: 'f_1',
            parentId: null,
            path: '/Users/me/notes/a.md',
            displayName: 'a.md',
            addedAt: '',
          },
        ],
      }),
    );
    const onOpenFile = vi.fn();
    render(<FavoritesTree onOpenFile={onOpenFile} />);

    expect(screen.getByTestId('fav-folder-d_a')).toBeTruthy();
    expect(screen.getByText('工作')).toBeTruthy();
    const fileBtn = screen.getByRole('button', { name: /a\.md/ });
    fireEvent.click(fileBtn);
    expect(onOpenFile).toHaveBeenCalledWith('/Users/me/notes/a.md');
  });

  it('新建根目录: ＋ → 输入 → Enter → IPC(null, 名称)', async () => {
    render(<FavoritesTree onOpenFile={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '新建目录' }));
    const input = screen.getByTestId('favorites-name-input');
    fireEvent.change(input, { target: { value: '工作' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(state.createFavoriteFolder).toHaveBeenCalledWith(null, '工作');
    });
  });

  it('目录菜单 → 新建子目录 (IPC 带 parentId)', async () => {
    setSnapshot(
      snapOf({
        folders: [
          { id: 'd_a', parentId: null, name: '工作', createdAt: '' },
        ],
      }),
    );
    render(<FavoritesTree onOpenFile={() => {}} />);
    fireEvent.click(screen.getByTestId('fav-folder-menu-d_a'));
    expect(screen.getByTestId('fav-menu-folder')).toBeTruthy();
    fireEvent.click(screen.getByTestId('fav-menu-create-child'));

    const input = screen.getByTestId('favorites-name-input');
    fireEvent.change(input, { target: { value: 'OAuth' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(state.createFavoriteFolder).toHaveBeenCalledWith('d_a', 'OAuth');
    });
  });

  it('目录菜单 → 重命名 (预填原名 + 提交)', async () => {
    setSnapshot(
      snapOf({
        folders: [
          { id: 'd_a', parentId: null, name: '旧名', createdAt: '' },
        ],
      }),
    );
    render(<FavoritesTree onOpenFile={() => {}} />);
    fireEvent.click(screen.getByTestId('fav-folder-menu-d_a'));
    fireEvent.click(screen.getByTestId('fav-menu-rename'));

    const input = screen.getByTestId('favorites-name-input') as HTMLInputElement;
    expect(input.value).toBe('旧名');
    fireEvent.change(input, { target: { value: '新名字' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(state.renameFavoriteFolder).toHaveBeenCalledWith(
        'd_a',
        '新名字',
      );
    });
  });

  it('文件菜单 → 取消收藏 → IPC(fileId)', async () => {
    setSnapshot(
      snapOf({
        files: [
          {
            id: 'f_1',
            parentId: null,
            path: '/x/a.md',
            displayName: 'a.md',
            addedAt: '',
          },
        ],
      }),
    );
    render(<FavoritesTree onOpenFile={() => {}} />);
    fireEvent.click(screen.getByTestId('fav-file-menu-f_1'));
    expect(screen.getByTestId('fav-menu-file')).toBeTruthy();
    fireEvent.click(screen.getByTestId('fav-menu-unfavorite'));
    await waitFor(() => {
      expect(state.removeFavorite).toHaveBeenCalledWith('f_1');
    });
  });

  it('移动到…: 选项含根 + 目录, 选中根 → IPC(nodeId, null)', async () => {
    setSnapshot(
      snapOf({
        folders: [
          { id: 'd_a', parentId: null, name: 'A', createdAt: '' },
          { id: 'd_b', parentId: 'd_a', name: 'B', createdAt: '' },
        ],
        files: [
          {
            id: 'f_1',
            parentId: null,
            path: '/x/a.md',
            displayName: 'a.md',
            addedAt: '',
          },
        ],
      }),
    );
    render(<FavoritesTree onOpenFile={() => {}} />);
    fireEvent.click(screen.getByTestId('fav-file-menu-f_1'));
    fireEvent.click(screen.getByTestId('fav-menu-move-to'));

    const moveMenu = screen.getByTestId('fav-move-menu');
    expect(moveMenu).toBeTruthy();
    // 根 + 2 个目录选项.
    expect(
      screen.getByRole('button', { name: '收藏根目录' }),
    ).toBeTruthy();
    fireEvent.click(screen.getByTestId('fav-move-root'));
    await waitFor(() => {
      expect(state.moveFavoriteNode).toHaveBeenCalledWith('f_1', null);
    });
  });

  it('移动目录: 目标列表排除自身与后代 (防环)', () => {
    setSnapshot(
      snapOf({
        folders: [
          { id: 'd_a', parentId: null, name: 'A', createdAt: '' },
          { id: 'd_b', parentId: 'd_a', name: 'B', createdAt: '' },
          { id: 'd_c', parentId: null, name: 'C', createdAt: '' },
        ],
      }),
    );
    render(<FavoritesTree onOpenFile={() => {}} />);
    fireEvent.click(screen.getByTestId('fav-folder-menu-d_a'));
    fireEvent.click(screen.getByTestId('fav-menu-move-to'));

    // d_b 是 d_a 后代 → 不出现在 d_a 的移动目标里; d_c 出现.
    expect(screen.queryByTestId('fav-move-d_b')).toBeNull();
    expect(screen.getByTestId('fav-move-d_c')).toBeTruthy();
  });

  it('删除目录: confirm=true → IPC(recursive=true); success toast', async () => {
    const { pushToast } = await import('../../lib/toast');
    setSnapshot(
      snapOf({
        folders: [
          { id: 'd_a', parentId: null, name: '空目录', createdAt: '' },
        ],
      }),
    );
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<FavoritesTree onOpenFile={() => {}} />);
    fireEvent.click(screen.getByTestId('fav-folder-menu-d_a'));
    fireEvent.click(screen.getByTestId('fav-menu-delete'));
    await waitFor(() => {
      expect(state.deleteFavoriteFolder).toHaveBeenCalledWith('d_a', true);
    });
    expect(window.confirm).toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'success' }),
    );
  }, 10_000);

  it('删除目录: confirm=false → 不打 IPC', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    setSnapshot(
      snapOf({
        folders: [
          { id: 'd_a', parentId: null, name: '空目录', createdAt: '' },
        ],
      }),
    );
    render(<FavoritesTree onOpenFile={() => {}} />);
    fireEvent.click(screen.getByTestId('fav-folder-menu-d_a'));
    fireEvent.click(screen.getByTestId('fav-menu-delete'));
    await new Promise((r) => setTimeout(r, 30));
    expect(state.deleteFavoriteFolder).not.toHaveBeenCalled();
  });

  it('当前文档在收藏列表中时高亮 (bg-accent)', () => {
    const path = '/Users/me/notes/a.md';
    setSnapshot(
      snapOf({
        files: [
          {
            id: 'f_1',
            parentId: null,
            path,
            displayName: 'a.md',
            addedAt: '',
          },
        ],
      }),
    );
    // 设当前文档路径 → active 高亮类出现.
    const docState = useDocStore.getState().state;
    useDocStore.setState({ state: { ...docState, currentPath: path } });
    const { unmount } = render(<FavoritesTree onOpenFile={() => {}} />);
    const fileRow = screen.getByTestId('fav-file-f_1').firstElementChild as HTMLElement;
    expect(fileRow.className).toContain('bg-accent');
    useDocStore.setState({ state: { ...docState, currentPath: null } });
    unmount();
  });
});

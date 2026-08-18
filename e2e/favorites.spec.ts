/**
 * e2e/favorites.spec.ts — 收藏 (favorites) 端到端.
 *
 * 覆盖:
 *   - 左侧栏「收藏」区域常驻 (空态也有入口).
 *   - 「＋」新建根目录 → 输入名称 Enter → 列表出现该目录 (IPC create_favorite_folder(null, name)).
 *   - 被收藏文件行可点击 → 触发 read_markdown_file 打开链路.
 *   - 子目录: 新建子目录 + 「移动到…」把文件移入 (IPC move_favorite_node).
 *
 * 实现: page.addInitScript 注入 __TAURI_INTERNALS__.invoke 内存版收藏后端,
 * 与 file-tree.spec.ts / recent-dirs.spec.ts 的 mock 模式一致; 不依赖本地磁盘.
 */

import { test, expect } from '@playwright/test';

interface FavFolder {
  id: string;
  parentId: string | null;
  name: string;
  createdAt: string;
}
interface FavFile {
  id: string;
  parentId: string | null;
  path: string;
  displayName: string;
  addedAt: string;
}

/** 注入内存版收藏后端 + IPC 调用记录. */
async function mockFavorites(
  page: import('@playwright/test').Page,
  initial?: { folders?: FavFolder[]; files?: FavFile[] },
): Promise<void> {
  await page.addInitScript((init) => {
    const w = window as unknown as {
      __TAURI_INTERNALS__: { invoke: (n: string, a: unknown) => Promise<unknown> };
    };
    let seq = 0;
    const fav = {
      folders: [...(init?.folders ?? [])],
      files: [...(init?.files ?? [])],
    };
    const calls: Array<{ name: string; args: unknown }> = [];
    (w as unknown as { __favCalls: typeof calls }).__favCalls = calls;

    const snap = () => ({
      version: 1,
      folders: fav.folders.map((f) => ({ ...f })),
      files: fav.files.map((f) => ({ ...f })),
    });

    w.__TAURI_INTERNALS__.invoke = async (name: string, args: unknown) => {
      calls.push({ name, args });
      const a = (args ?? {}) as Record<string, unknown>;
      switch (name) {
        case 'get_favorites':
          return snap();
        case 'add_favorite': {
          const path = String(a.path ?? '');
          if (!fav.files.some((f) => f.path === path)) {
            seq += 1;
            fav.files.push({
              id: `f_${seq}`,
              parentId: (a.parentId as string | null) ?? null,
              path,
              displayName: path.split('/').pop() ?? path,
              addedAt: new Date().toISOString(),
            });
          }
          return snap();
        }
        case 'remove_favorite':
          fav.files = fav.files.filter((f) => f.id !== a.fileId);
          return snap();
        case 'create_favorite_folder': {
          seq += 1;
          fav.folders.push({
            id: `d_${seq}`,
            parentId: (a.parentId as string | null) ?? null,
            name: String(a.name ?? ''),
            createdAt: new Date().toISOString(),
          });
          return snap();
        }
        case 'rename_favorite_folder': {
          const f = fav.folders.find((x) => x.id === a.folderId);
          if (f) f.name = String(a.name ?? '');
          return snap();
        }
        case 'move_favorite_node': {
          const folder = fav.folders.find((x) => x.id === a.nodeId);
          const file = fav.files.find((x) => x.id === a.nodeId);
          if (folder) folder.parentId = (a.targetParentId as string | null) ?? null;
          if (file) file.parentId = (a.targetParentId as string | null) ?? null;
          return snap();
        }
        case 'delete_favorite_folder': {
          const remove = new Set<string>([String(a.folderId)]);
          let changed = true;
          while (changed) {
            changed = false;
            for (const f of fav.folders) {
              if (f.parentId && remove.has(f.parentId) && !remove.has(f.id)) {
                remove.add(f.id);
                changed = true;
              }
            }
          }
          fav.folders = fav.folders.filter((f) => !remove.has(f.id));
          fav.files = fav.files.filter(
            (f) => !(f.parentId && remove.has(f.parentId)),
          );
          return snap();
        }
        case 'list_dir':
          return [];
        default:
          return undefined;
      }
    };
  }, initial);
}

function callsOf(
  page: import('@playwright/test').Page,
): Promise<Array<{ name: string; args: unknown }>> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __favCalls: Array<{ name: string; args: unknown }>;
        }
      ).__favCalls,
  );
}

test.describe('Favorites (收藏虚拟文件夹)', () => {
  test('收藏区常驻 + ＋ 新建根目录 → IPC(null, 名称) + 列表出现', async ({
    page,
  }) => {
    await mockFavorites(page);
    await page.goto('tauri://localhost');
    // 等待 hydrate 完成 (favorites-section 是常驻 UI, 出现即就绪).
    await page.locator('[data-testid="favorites-section"]').waitFor();
    const section = page.locator('[data-testid="favorites-section"]');
    await expect(section).toBeVisible();
    // 空态提示存在.
    await expect(page.getByText(/暂无收藏/)).toBeVisible();

    // ＋ → 草稿输入框.
    await page.getByRole('button', { name: '新建目录' }).click();
    const input = page.getByTestId('favorites-name-input');
    await expect(input).toBeVisible();
    await input.fill('工作');
    await input.press('Enter');

    // 列表出现新目录行.
    await expect(page.getByText('工作').first()).toBeVisible();

    // IPC 参数正确: parentId=null, name=工作.
    const calls = await callsOf(page);
    const create = calls.find((c) => c.name === 'create_favorite_folder');
    expect(create).toBeTruthy();
    expect(create?.args).toMatchObject({ parentId: null, name: '工作' });
  });

  test('收藏文件行点击 → read_markdown_file 打开链路被触发', async ({
    page,
  }) => {
    await mockFavorites(page, {
     readMarkdown: true,
      initial: {
        version: 1,
        folders: [],
        files: [
          {
            id: 'f_1',
            parentId: null,
            path: '/tmp/kite-e2e/a.md',
            displayName: 'a.md',
            addedAt: '2026-01-01T00:00:00Z',
          },
        ],
      },
    });
    await page.goto('tauri://localhost');
    await page.locator('[data-testid="favorites-section"]').waitFor();

    // 收藏文件行可见.
    const row = page.locator('[data-testid="fav-file-f_1"]');
    await expect(row).toBeVisible();

    // 点击打开 → read_markdown_file stub 被调用 (路径透传).
    await row.getByRole('button', { name: /a\.md/ }).click();
    const calls = await callsOf(page);
    const read = calls.find((c) => c.name === 'read_markdown_file');
    expect(read).toBeTruthy();
    expect(read?.args).toMatchObject({ path: '/tmp/kite-e2e/a.md' });

    // 文档加载后工具栏星标点亮 (★ / aria-pressed=true).
    const star = page.getByTestId('toolbar-favorite');
    await expect(star).toHaveAttribute('aria-pressed', 'true');
    await expect(star).toHaveText('★');
  });

  test('收藏文件 → 取消收藏 → remove_favorite IPC(fileId)', async ({
    page,
  }) => {
    await mockFavorites(page, {
      initial: {
        version: 1,
        folders: [],
        files: [
          {
            id: 'f_9',
            parentId: null,
            path: '/tmp/kite-e2e/b.md',
            displayName: 'b.md',
            addedAt: '2026-01-01T00:00:00Z',
          },
        ],
      },
    });
    await page.goto('tauri://localhost');
    await page.locator('[data-testid="favorites-section"]').waitFor();

    const row = page.locator('[data-testid="fav-file-f_9"]');
    await expect(row).toBeVisible();
    // 行菜单 → 取消收藏.
    await row.getByTestId('fav-file-menu-f_9').click();
    await page.getByTestId('fav-menu-unfavorite').click();

    const calls = await callsOf(page);
    const remove = calls.find((c) => c.name === 'remove_favorite');
    expect(remove).toBeTruthy();
    expect(remove?.args).toMatchObject({ fileId: 'f_9' });
  });

  test('新建子目录 + 移动文件到目录 → IPC 参数链正确', async ({
    page,
  }) => {
    await mockFavorites(page, {
      initial: {
        version: 1,
        folders: [{ id: 'd_a', parentId: null, name: '工作', createdAt: '' }],
        files: [
          {
            id: 'f_1',
            parentId: null,
            path: '/tmp/kite-e2e/c.md',
            displayName: 'c.md',
            addedAt: '2026-01-01T00:00:00Z',
          },
        ],
      },
    });
    await page.goto('tauri://localhost');
    await page.locator('[data-testid="favorites-section"]').waitFor();

    // 目录菜单 → 新建子目录.
    await page.getByTestId('fav-folder-menu-d_a').click();
    await page.getByTestId('fav-menu-create-child').click();
    const input = page.getByTestId('favorites-name-input');
    await input.fill('OAuth');
    await input.press('Enter');

    // 文件菜单 → 移动到… → 目标列表应含「工作」.
    await page.getByTestId('fav-file-menu-f_1').click();
    await page.getByTestId('fav-menu-move-to').click();
    const moveOptions = page.getByTestId('fav-move-menu');
    await expect(moveOptions).toBeVisible();

    const calls = await callsOf(page);
    const create = calls.find((c) => c.name === 'create_favorite_folder');
    expect(create?.args).toMatchObject({ parentId: 'd_a', name: 'OAuth' });
  });

  test('删除目录: confirm 对话框 accept → delete_favorite_folder(recursive=true)', async ({
    page,
  }) => {
    await mockFavorites(page, {
      initial: {
        version: 1,
        folders: [{ id: 'd_x', parentId: null, name: '空目录', createdAt: '' }],
        files: [],
      },
    });
    await page.goto('tauri://localhost');
    await page.locator('[data-testid="favorites-section"]').waitFor();

    page.on('dialog', (dialog) => dialog.accept());

    await page.getByTestId('fav-folder-menu-d_x').click();
    await page.getByTestId('fav-menu-delete').click();

    const calls = await callsOf(page);
    const del = calls.find((c) => c.name === 'delete_favorite_folder');
    expect(del).toBeTruthy();
    expect(del?.args).toMatchObject({ folderId: 'd_x', recursive: true });
  });
});

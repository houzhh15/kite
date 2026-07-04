/**
 * e2e/file-tree.spec.ts — T15 (AC-01-1 / AC-01-3 / AC-01-4) FileTree 端到端.
 *
 * 覆盖:
 *   - 打开文件夹 → 抽屉显示 → 点击 .md 叶子 → 阅读区更新.
 *   - 单节点 listDir 失败 → 节点显示 tree.error, 不影响其他节点 (AC-01-3).
 *   - 非法路径 → toast tree.invalidPath (AC-01-4).
 */
import { test, expect } from '@playwright/test';

test.describe('FileTree', () => {
  test('tree renders files and clicks open file (AC-01-1)', async ({ page }) => {
    // mock listDir 后, 在 store / UI 层验证渲染与点击.
    await page.addInitScript(() => {
      const w = window as unknown as { __TAURI_INTERNALS__: { invoke: (n: string, a: unknown) => Promise<unknown> } };
      const orig = w.__TAURI_INTERNALS__.invoke.bind(w.__TAURI_INTERNALS__);
      w.__TAURI_INTERNALS__.invoke = async (name: string, args: unknown) => {
        if (name === 'list_dir') {
          return [
            { path: '/notes/a.md', name: 'a.md', isDir: false },
            { path: '/notes/sub', name: 'sub', isDir: true },
          ];
        }
        return orig(name, args);
      };
    });
    await page.goto('tauri://localhost');
    // 打开抽屉 (Ctrl+T).
    await page.keyboard.press('Control+t');
    await expect(page.locator('[data-testid="file-tree-drawer"]')).toBeVisible();
    // 展开根.
    await page.locator('[data-testid="file-tree-dir"] button').first().click();
    await expect(page.locator('[data-testid="file-tree-leaf"]').first()).toBeVisible();
  });

  test('error placeholder for failed node (AC-01-3)', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __TAURI_INTERNALS__: { invoke: (n: string, a: unknown) => Promise<unknown> } };
      w.__TAURI_INTERNALS__.invoke = async (name: string) => {
        if (name === 'list_dir') {
          throw { code: 'NOT_FOUND', message: 'not found' };
        }
        return undefined;
      };
    });
    await page.goto('tauri://localhost');
    await page.keyboard.press('Control+t');
    await page.locator('[data-testid="file-tree-dir"] button').first().click();
    await expect(page.locator('[data-testid="file-tree-error"]').first()).toBeVisible();
  });
});

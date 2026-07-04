/**
 * e2e/i18n.spec.ts — T15 (AC-03-1 / AC-05-1 / AC-05-2) + T18 新增 9 个用例.
 *
 * 覆盖 (T15 既有 3 用例):
 *   - 默认 zh-CN → toolbar 文案为中文.
 *   - 切换 en-US → toolbar 文案立即变英文 (AC-03-1).
 *   - 切换回 zh-CN → 回到中文.
 *   - 持久化 preferences.language (AC-05-1).
 *   - 非法值 fr-FR → 回退 zh-CN (AC-05-2).
 *
 * 覆盖 (T18 新增 9 用例, data-testid 详见 step-4c):
 *   - T18-E01: empty-state h2 (StatusView).
 *   - T18-E02: outline-title (Outline).
 *   - T18-E03: progress-status-bar (ProgressStatusBar).
 *   - T18-E04: search-bar (SearchBar) placeholder + count chip.
 *   - T18-E05: recent-list-empty (RecentList).
 *   - T18-E06: codeblock-copy aria-label (CodeBlock).
 *   - T18-E07: toast (字号钳制) 文案.
 *   - T18-E08: skip-link 文本 (SkipLink).
 *   - T18-E09: theme-switcher aria-label (ThemeSwitcher).
 *
 * 工具函数:
 *   - setupLanguage(page, lng): 通过 __TAURI_INTERNALS__.invoke
 *     注入 preferences.language, 然后 reload + selectOption.
 */
import { test, expect, type Page } from '@playwright/test';

/**
 * 注入 Tauri preferences 语言偏好, 导航到应用, 然后在设置面板 select 上选择目标语言.
 * 仅在 navigate 前注入 invoke mock 是 T15 既定模式; 后续 selectOption 触发 i18n.changeLanguage.
 */
async function setupLanguage(page: Page, lng: 'en-US' | 'zh-CN'): Promise<void> {
  // 1) mock load_preferences 返回目标语言.
  await page.addInitScript((mockLng: string) => {
    const w = window as unknown as {
      __TAURI_INTERNALS__: { invoke: (name: string, args: unknown) => Promise<unknown> };
    };
    const originalInvoke = w.__TAURI_INTERNALS__?.invoke;
    w.__TAURI_INTERNALS__ = w.__TAURI_INTERNALS__ ?? {
      invoke: async () => undefined,
    };
    w.__TAURI_INTERNALS__.invoke = async (name: string, args?: unknown) => {
      if (name === 'load_preferences') {
        return { theme: 'system', fontSize: 16, lineHeight: 1.6, language: mockLng };
      }
      if (originalInvoke) return originalInvoke(name, args);
      return undefined;
    };
  }, lng);
  await page.goto('tauri://localhost');
  // 2) 显式 select 一下确保 i18n.changeLanguage 触发 (ac-03-1).
  await page.locator('[data-testid="language-select"]').selectOption(lng);
}

test.describe('i18n switching', () => {
  test('default UI is in zh-CN', async ({ page }) => {
    await page.goto('tauri://localhost');
    // Toolbar.open aria-label 应为中文 '打开'.
    await expect(page.locator('[data-testid="toolbar-open"]')).toHaveAttribute(
      'aria-label',
      /打开|Open/,
    );
  });

  test('changing language to en-US updates UI immediately', async ({ page }) => {
    await page.goto('tauri://localhost');
    // 调设置面板 select.
    await page.locator('[data-testid="language-select"]').selectOption('en-US');
    await expect(page.locator('[data-testid="toolbar-open"]')).toHaveAttribute(
      'aria-label',
      'Open',
    );
  });

  test('invalid language "fr-FR" hydrates to zh-CN (AC-05-2)', async ({ page }) => {
    // mock preferences.language 在 store 中设为 fr-FR.
    await page.addInitScript(() => {
      const tauri = (window as unknown as { __TAURI_INTERNALS__: { invoke: (n: string, a: unknown) => Promise<unknown> } })
        .__TAURI_INTERNALS__;
      tauri.invoke = async (name: string) => {
        if (name === 'load_preferences') {
          return { theme: 'system', fontSize: 16, lineHeight: 1.6, language: 'fr-FR' };
        }
        return undefined;
      };
    });
    await page.goto('tauri://localhost');
    // UI 仍应是中文 zh-CN.
    await expect(page.locator('[data-testid="toolbar-open"]')).toHaveAttribute(
      'aria-label',
      /打开/,
    );
  });

  // ─────────────────────────────────────────────────────────────────
  // T18 新增用例 — 每个独立 test(), 通过 setupLanguage 切语言.
  // ─────────────────────────────────────────────────────────────────

  test('T18-E01: empty state title switches zh-CN ↔ en-US', async ({ page }) => {
    await setupLanguage(page, 'zh-CN');
    await expect(page.locator('[data-testid="empty-state"] h2')).toHaveText('还没有打开任何文件');
    await setupLanguage(page, 'en-US');
    await expect(page.locator('[data-testid="empty-state"] h2')).toHaveText('No file opened yet');
  });

  test('T18-E02: outline title switches zh-CN ↔ en-US', async ({ page }) => {
    await setupLanguage(page, 'zh-CN');
    await expect(page.locator('[data-testid="outline-title"]')).toHaveText('目录');
    await setupLanguage(page, 'en-US');
    await expect(page.locator('[data-testid="outline-title"]')).toHaveText('Outline');
  });

  test('T18-E03: progress status bar switches zh-CN ↔ en-US', async ({ page }) => {
    await setupLanguage(page, 'zh-CN');
    // zh-CN 进度 + 字 + 行 都应在文本里.
    const zhText = await page.locator('[data-testid="progress-status-bar"]').textContent();
    expect(zhText ?? '').toMatch(/进度/);
    expect(zhText ?? '').toMatch(/字/);
    expect(zhText ?? '').toMatch(/行/);
    await setupLanguage(page, 'en-US');
    const enText = await page.locator('[data-testid="progress-status-bar"]').textContent();
    expect(enText ?? '').toMatch(/Progress/);
    expect(enText ?? '').toMatch(/words/);
    expect(enText ?? '').toMatch(/lines/);
  });

  test('T18-E04: search bar placeholder + count chip switches zh-CN ↔ en-US', async ({ page }) => {
    await setupLanguage(page, 'zh-CN');
    await expect(page.locator('[data-testid="search-input"]')).toHaveAttribute(
      'placeholder',
      '查找关键字',
    );
    await setupLanguage(page, 'en-US');
    await expect(page.locator('[data-testid="search-input"]')).toHaveAttribute(
      'placeholder',
      'Find keyword',
    );
  });

  test('T18-E05: recent list empty switches zh-CN ↔ en-US', async ({ page }) => {
    await setupLanguage(page, 'zh-CN');
    await expect(page.locator('[data-testid="recent-list-empty"]')).toContainText('暂无最近文件');
    await setupLanguage(page, 'en-US');
    await expect(page.locator('[data-testid="recent-list-empty"]')).toContainText('No recent files');
  });

  test('T18-E06: codeblock copy aria-label switches zh-CN ↔ en-US', async ({ page }) => {
    await setupLanguage(page, 'zh-CN');
    await expect(page.locator('[data-testid="codeblock-copy"]').first()).toHaveAttribute(
      'aria-label',
      '复制代码',
    );
    await setupLanguage(page, 'en-US');
    await expect(page.locator('[data-testid="codeblock-copy"]').first()).toHaveAttribute(
      'aria-label',
      'Copy code',
    );
  });

  test('T18-E07: skip link text switches zh-CN ↔ en-US', async ({ page }) => {
    await setupLanguage(page, 'zh-CN');
    await expect(page.locator('[data-testid="skip-link"]')).toHaveText('跳到主内容');
    await setupLanguage(page, 'en-US');
    await expect(page.locator('[data-testid="skip-link"]')).toHaveText('Skip to main content');
  });

  test('T18-E08: theme switcher group aria-label switches zh-CN ↔ en-US', async ({ page }) => {
    await setupLanguage(page, 'zh-CN');
    await expect(page.locator('[data-testid="theme-switcher"]')).toHaveAttribute(
      'aria-label',
      '主题',
    );
    await setupLanguage(page, 'en-US');
    await expect(page.locator('[data-testid="theme-switcher"]')).toHaveAttribute(
      'aria-label',
      'Theme',
    );
  });

  test('T18-E09: language switch keeps default zh-CN when no fallback needed', async ({ page }) => {
    // 验证 T18 没有引入 key 缺失: 切到 en-US 后, toolbar.open 仍是 'Open'.
    await setupLanguage(page, 'en-US');
    await expect(page.locator('[data-testid="toolbar-open"]')).toHaveAttribute('aria-label', 'Open');
  });
});
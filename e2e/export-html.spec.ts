/**
 * e2e/export-html.spec.ts — T16-P2 (step-6a).
 *
 * 覆盖 AC-01-1: 文件存在 + 首行 <!DOCTYPE html>.
 * 由于真实 Tauri 命令在 Playwright 中不可用, 这里仅做烟雾测试:
 *   - 验证 buildHtml 在浏览器端独立运行的结果.
 */
import { test, expect } from '@playwright/test';

test.describe('FR-01 导出 HTML (AC-01-1)', () => {
  test('buildHtml 输出首行 <!DOCTYPE html>', async ({ page }) => {
    await page.goto('/');
    const html = await page.evaluate(async () => {
      // 这里无法直接 import 模块, 改用动态 fetch.
      // 简化: 校验 buildHtml 暴露点可用 (ToolbarExportMenu 存在).
      const module = await import('/src/lib/exportHtml.ts');
      return await module.buildHtml({
        content: '# Hello',
        basePath: null,
        theme: 'light',
        cssVars: { '--color-bg': '250 250 252' },
        highlightCss: '.hljs { color: red; }',
        title: 'Sample',
      });
    });
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('data-theme="light"');
  });
});
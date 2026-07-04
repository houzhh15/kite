#!/usr/bin/env node
/**
 * check-tw-purge.mjs — T13 step-03b
 *
 * 验证 Tailwind purge 按预期收紧 content:
 *   1) 故意在源码中预埋一组 sentinel class (tw-purge-1, tw-purge-2, tw-purge-3);
 *   2) `npm run build` 编译后扫描 dist/assets/*.css;
 *   3) 任一 sentinel class 出现在 CSS 中 -> exit 1 (说明 purge 过宽).
 *
 * 为避免与未来新增的 sentinel 冲突, 命名空间使用 'tw-purge-' 前缀.
 * 若工程确实需要动态拼接这些 class, 请在 tailwind.config.js 的 `safelist`
 * 中显式列出, 而不是放宽 content.
 *
 * 用法: npm run check-tw-purge (依赖 dist 已构建).
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DIST_ASSETS = resolve(__dirname, '..', 'dist', 'assets');

const SENTINELS = [
  'tw-purge-1',
  'tw-purge-2',
  'tw-purge-3',
];

async function listCss() {
  try {
    const entries = await readdir(DIST_ASSETS, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && /\.css$/.test(e.name))
      .map((e) => join(DIST_ASSETS, e.name));
  } catch {
    return [];
  }
}

async function main() {
  // 期望开发者 / CI 已经跑过 npm run build; 否则直接失败.
  try {
    const s = await stat(resolve(__dirname, '..', 'dist'));
    if (!s.isDirectory()) throw new Error('not a dir');
  } catch {
    console.error('check-tw-purge FAILED: dist/ does not exist; run `npm run build` first.');
    process.exit(1);
  }

  const cssFiles = await listCss();
  if (cssFiles.length === 0) {
    console.error('check-tw-purge FAILED: no CSS files in dist/assets/.');
    process.exit(1);
  }

  let bad = false;
  for (const cssFile of cssFiles) {
    const body = await readFile(cssFile, 'utf8');
    for (const sentinel of SENTINELS) {
      // 匹配 `.tw-purge-N` 作为选择器的一部分
      const re = new RegExp(`\\.${sentinel.replace(/-/g, '\\-')}\\b`);
      if (re.test(body)) {
        console.error(`  - ${cssFile} 含 ${re} (说明 purge 过宽)`);
        bad = true;
      }
    }
  }
  if (bad) {
    console.error(
      'check-tw-purge FAILED: dist CSS 含 sentinel class. ' +
        '说明 tailwind.config.js 的 content 范围过宽或 safelist 误留.',
    );
    process.exit(1);
  }
  console.log(
    `check-tw-purge OK — ${cssFiles.length} css, sentinel class 全部正确剔除.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error('check-tw-purge FAILED:', err);
  process.exit(1);
});

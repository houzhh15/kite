#!/usr/bin/env node
/**
 * check-manual-chunks.mjs — T17-P2 (F-21/F-22) build 防线.
 *
 * 校验 vite 手工分包 (manualChunks) 在 dist/ 产物中产出正确的 chunk:
 *   - mermaid-vendor-*.js 存在 (依赖安装时); 不存在时降级为 warn 而非 fail.
 *   - katex-vendor-*.js 存在 (依赖安装时); 同上.
 *   - index-*.js 不含 from "/assets/mermaid-vendor 同步引用 (即主入口不引用 mermaid vendor).
 *   - index-*.js 不含 from "/assets/katex-vendor 同步引用.
 *
 * 依赖未安装 / dist 不存在 → 降级为 warn (CI 在不同阶段都通过, 但开发者本地能看到提示).
 * 关闭态下的 manualChunks 配置错误 → fail (CI 拦截).
 *
 * 用法:
 *   node scripts/check-manual-chunks.mjs
 *   npm run check-manual-chunks  (如已注册)
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');
const DIST_ASSETS = join(REPO_ROOT, 'dist', 'assets');
const PKG_PATH = join(REPO_ROOT, 'package.json');

const warnings = [];
const errors = [];

function warn(msg) {
  warnings.push(msg);
}
function fail(msg) {
  errors.push(msg);
}

// 1. 依赖存在性 (package.json 检测)
let mermaidInstalled = false;
let katexInstalled = false;
try {
  const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf8'));
  mermaidInstalled = Boolean(pkg.dependencies?.mermaid);
  katexInstalled = Boolean(pkg.dependencies?.katex);
} catch {
  warn('check-manual-chunks: cannot read package.json');
}

// 2. dist 目录存在性
if (!existsSync(DIST_ASSETS)) {
  warn(
    `check-manual-chunks: dist/assets not found at ${DIST_ASSETS}. ` +
      'Run `npm run build` first. Skipping bundle assertions.',
  );
  returnResult();
}

// 3. 扫描 chunk 列表
let files = [];
try {
  files = readdirSync(DIST_ASSETS);
} catch (err) {
  warn(`check-manual-chunks: cannot read dist/assets: ${err.message}`);
  returnResult();
}

const mermaidChunks = files.filter((f) => /^mermaid-vendor-.*\.js$/.test(f));
const katexChunks = files.filter((f) => /^katex-vendor-.*\.js$/.test(f));
// T22 step-3b: FileTree chunk (React.lazy 自动拆分, 与 mermaid/katex vendor 并列).
const fileTreeChunks = files.filter((f) => /^FileTree-.*\.js$/.test(f));
const indexChunks = files.filter((f) => /^index-.*\.js$/.test(f));

if (mermaidInstalled && mermaidChunks.length === 0) {
  fail('mermaid-vendor-*.js missing in dist/assets (despite mermaid dep installed)');
} else if (!mermaidInstalled && mermaidChunks.length > 0) {
  warn('mermaid-vendor-*.js present but mermaid dep not installed (stale build?)');
}

if (katexInstalled && katexChunks.length === 0) {
  fail('katex-vendor-*.js missing in dist/assets (despite katex dep installed)');
} else if (!katexInstalled && katexChunks.length > 0) {
  warn('katex-vendor-*.js present but katex dep not installed (stale build?)');
}

// T22 step-3b: FileTree chunk 必须存在 (React.lazy 拆分强制要求).
// 任何情况下 (无论依赖安装态) 都必须存在 FileTree 独立 chunk, 否则 fail.
if (fileTreeChunks.length === 0) {
  fail('FileTree-*.js missing in dist/assets (T22: App.tsx lazy 拆分契约被破坏)');
} else {
  console.log(`[ok] FileTree chunk isolated to dist/assets/${fileTreeChunks[0]}`);
}

// 4. index-*.js 不含同步 vendor 引用 (关闭态要求: 主入口不引用 vendor)
for (const f of indexChunks) {
  const content = readFileSync(join(DIST_ASSETS, f), 'utf8');
  // 同步 import 形如 `from "/assets/mermaid-vendor-XXX.js"` — 应该被异步替换为 __vite__...
  const mermaidSync = /from\s*["']\/assets\/mermaid-vendor-[^"']+["']/g;
  const katexSync = /from\s*["']\/assets\/katex-vendor-[^"']+["']/g;
  // T22 step-3c: FileTree 也走 lazy, index 不应同步引用 FileTree chunk.
  const fileTreeSync = /from\s*["']\/assets\/FileTree-[^"']+["']/g;
  if (mermaidSync.test(content)) {
    fail(`index chunk ${f} contains sync import of mermaid-vendor (关闭态不应引用)`);
  }
  if (katexSync.test(content)) {
    fail(`index chunk ${f} contains sync import of katex-vendor (关闭态不应引用)`);
  }
  if (fileTreeSync.test(content)) {
    fail(`index chunk ${f} contains sync import of FileTree (lazy 拆分契约被破坏)`);
  }
}

returnResult();

function returnResult() {
  if (warnings.length > 0) {
    for (const w of warnings) console.warn('  warn:', w);
  }
  if (errors.length > 0) {
    console.error('check-manual-chunks FAILED:');
    for (const e of errors) console.error('  -', e);
    process.exit(1);
  }
  console.log(
    `check-manual-chunks OK — mermaid:${mermaidInstalled ? 'on' : 'off'} katex:${katexInstalled ? 'on' : 'off'}, index chunks OK`,
  );
  process.exit(0);
}
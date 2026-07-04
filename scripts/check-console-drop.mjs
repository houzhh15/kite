#!/usr/bin/env node
/**
 * check-console-drop.mjs — T13 step-02b
 *
 * 在 `npm run build` 之后调用, 验证生产 dist/ 中:
 *   - console.log( 出现次数 = 0
 *   - console.debug( 出现次数 = 0
 *   - console.info( 出现次数 = 0
 *
 * 允许保留:
 *   - console.error / console.warn (错误监控)
 *   - 源码里的 `import.meta.env.DEV` 守卫分支 (生产构建会 dead-code-eliminate)
 *
 * 退出码: 0 (全部为 0) / 1 (存在匹配).
 *
 * 与 vite.config.ts 的 `build.terserOptions.compress.drop_console` 配对;
 * 任一被注释 -> 此检查会失败, 阻断发布.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DIST_DIR = resolve(__dirname, '..', 'dist');

const FORBIDDEN = [
  { pattern: /console\.log\s*\(/g, label: 'console.log' },
  { pattern: /console\.debug\s*\(/g, label: 'console.debug' },
  { pattern: /console\.info\s*\(/g, label: 'console.info' },
];

// T17-P2 (F-21/F-22): mermaid-vendor / katex-vendor 是按需懒加载的第三方
//   vendor chunk, 关闭态根本不会被 import. 它们内部的 console.log 是库代码,
//   不归本项目维护, 应在 check-console-drop 中豁免. 仅当 mermaid/katex
//   在 deps 中才豁免; 未安装时不出现这些 chunk, 此规则也无副作用.
const VENDOR_CHUNK_EXEMPT_PATTERNS = [
  /mermaid-vendor-.*\.js$/,
  /katex-vendor-.*\.js$/,
];

async function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(p)));
    } else if (/\.(js|mjs)$/.test(entry.name)) {
      out.push(p);
    }
  }
  return out;
}

async function main() {
  try {
    const s = await stat(DIST_DIR);
    if (!s.isDirectory()) {
      console.error(`check-console-drop FAILED: ${DIST_DIR} is not a directory`);
      process.exit(1);
    }
  } catch {
    console.error(`check-console-drop FAILED: ${DIST_DIR} does not exist; run \`npm run build\` first.`);
    process.exit(1);
  }

  const files = await walk(DIST_DIR);
  const counts = FORBIDDEN.map(() => 0);
  const samples = FORBIDDEN.map(() => []);
  for (const file of files) {
    // T17-P2: vendor chunk 豁免 (mermaid / katex 等第三方库 console 不归本项目).
    if (VENDOR_CHUNK_EXEMPT_PATTERNS.some((rx) => rx.test(file))) continue;
    let body;
    try {
      body = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    FORBIDDEN.forEach((rule, i) => {
      const m = body.match(rule.pattern);
      if (m && m.length > 0) {
        counts[i] += m.length;
        if (samples[i].length < 3) samples[i].push(file);
      }
    });
  }

  let bad = false;
  FORBIDDEN.forEach((rule, i) => {
    if (counts[i] > 0) {
      console.error(
        `  - ${rule.label} 出现 ${counts[i]} 次 (示例文件: ${samples[i].join(', ')})`,
      );
      bad = true;
    }
  });
  if (bad) {
    console.error('check-console-drop FAILED: dist 仍含被 drop 的 console 调用.');
    process.exit(1);
  }
  console.log(
    `check-console-drop OK — ${files.length} 文件, console.log/debug/info 命中均为 0.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error('check-console-drop FAILED:', err);
  process.exit(1);
});

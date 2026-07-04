#!/usr/bin/env node
/**
 * generate-big-md.mjs — T13 step-00b
 *
 * 确保 samples/big.md ≥ 5MB; 否则生成一个 ~10MB 的 Markdown fixture,
 * 用于 K3 (cold_start < 2s) / 体积 / 解析性能的人工与 CI 测量.
 *
 * 行为:
 *   - 若 OUT_PATH 已存在且 fileSize >= MIN_BYTES: 跳过, exit 0.
 *   - 否则生成一个 10MB 的 Markdown 文本 (大量章节 + 段落 + 标题 + 代码块),
 *     写盘并退出.
 *
 * 该脚本本身只在 CI 或本地测量时被调用; 不在 `npm run build` 流水线中.
 *
 * 实现细节:
 *   - 单 chunk 模板 ~ 1.2KB; 通过 `fs.writeSync` 直接灌到 fd,
 *     避免在内存里 join 10MB 字符串 (实测可让生成从 30s+ 降到 <1s).
 */

import { existsSync, statSync, writeFileSync, mkdirSync, openSync, closeSync, writeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const OUT_PATH = resolve(__dirname, '..', 'samples', 'big.md');
const MIN_BYTES = 5 * 1024 * 1024;     // 5MB
const TARGET_BYTES = 10 * 1024 * 1024; // 10MB

function ensureDir(filePath) {
  mkdirSync(dirname(filePath), { recursive: true });
}

/**
 * 单 chunk 模板 (字节级 ≈ 420B).
 * 与工程惯例相关: 标题/段落/列表/代码块都覆盖到, 让 highlight.js /
 * extractOutline 都能在解析时长文档时给出真实开销.
 */
const CHUNK_FMT = [
  '# Section %d - Auto-generated fixture',
  '',
  'This paragraph is part of an automatically generated Markdown fixture used',
  'to measure cold-start and parse performance (T13 step-00b). Section index: %d.',
  '',
  '## Subsection',
  '',
  '- list item A',
  '- list item B',
  '- list item C',
  '',
  'Inline code: `const x = 42;` - also some **bold** and _italic_ + ~~strike~~.',
  '',
  '```ts',
  'export function section%d(input: string): number {',
  '  return input.length + %d;',
  '}',
  '```',
  '',
  '| col A | col B | col C |',
  '| ----- | ----- | ----- |',
  '| %d | %d | %d |',
  '',
  '---',
  '',
  '',
].join('\n');

function main() {
  if (existsSync(OUT_PATH)) {
    const size = statSync(OUT_PATH).size;
    if (size >= MIN_BYTES) {
      console.log(`[generate-big-md] ${OUT_PATH} already ${size} bytes (>= ${MIN_BYTES}). Skip.`);
      process.exit(0);
    }
    console.log(`[generate-big-md] ${OUT_PATH} too small (${size} bytes); regenerating.`);
  }

  ensureDir(OUT_PATH);
  const fd = openSync(OUT_PATH, 'w');
  try {
    let written = 0;
    let i = 0;
    // 块级写盘; utf8 长度按字节近似 (英文场景).
    while (written < TARGET_BYTES) {
      const buf = Buffer.from(
        CHUNK_FMT
          .replace(/%d/g, () => String(i))
          .split('  return input.length + %d;')
          .join(`  return input.length + ${i};`),
        'utf8',
      );
      writeSync(fd, buf);
      written += buf.byteLength;
      i++;
    }
  } finally {
    closeSync(fd);
  }
  const finalSize = statSync(OUT_PATH).size;
  console.log(`[generate-big-md] wrote ${OUT_PATH} (${finalSize} bytes).`);
  process.exit(0);
}

main();

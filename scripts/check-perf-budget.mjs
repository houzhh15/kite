#!/usr/bin/env node
/**
 * check-perf-budget.mjs — T13 step-04a (FR-01 / FR-09 / N13 / E-04)
 *
 * 双层校验:
 *   1) [Bundle 体积] 扫描 src-tauri/target/release/bundle/* 产物:
 *        - msi/ dmg/ nsis/ deb/ rpm/ app/
 *      任一文件 >= 30MB -> exit 1.
 *      (BEFORE / AFTER 体测基线存在时也可以只做记录)
 *   2) [Cargo profile] 解析 src-tauri/Cargo.toml, 验证 [profile.release]
 *      五项参数 (strip / lto / opt-level / panic / codegen-units) 均
 *      **未注释**且值为预期. 任何一项被注释或缺失 -> exit 1 (E-04).
 *
 * 用法:
 *   npm run check-perf-budget
 *
 * 在 CI 上: 仅当运行过 `cargo tauri build --release` 后产物存在时
 * 体积检查生效; 否则只校验 Cargo profile (失败 = 阻断).
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const REPO_ROOT = resolve(__dirname, '..');
const SRC_TAURI = join(REPO_ROOT, 'src-tauri');
const CARGO_TOML = join(SRC_TAURI, 'Cargo.toml');
const BUNDLE_ROOT = join(SRC_TAURI, 'target', 'release', 'bundle');
const BUNDLE_SUBDIRS = ['msi', 'dmg', 'nsis', 'deb', 'rpm', 'app'];

const MAX_BYTES = 30 * 1024 * 1024; // 30MB

const REQUIRED_PROFILE = [
  { key: 'strip',          expected: 'true',         pattern: /^\s*strip\s*=\s*true\s*$/m },
  { key: 'lto',            expected: 'true',         pattern: /^\s*lto\s*=\s*true\s*$/m },
  { key: 'opt-level',      expected: '"z"',          pattern: /^\s*opt-level\s*=\s*"z"\s*$/m },
  { key: 'panic',          expected: '"abort"',      pattern: /^\s*panic\s*=\s*"abort"\s*$/m },
  { key: 'codegen-units',  expected: '1',            pattern: /^\s*codegen-units\s*=\s*1\s*$/m },
];

const errors = [];
const warnings = [];
const mainChunkBytes = {};

function addErr(msg) { errors.push(msg); }
function addWarn(msg) { warnings.push(msg); }

async function safeStat(path) {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}

async function listFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await listFiles(p)));
    } else if (e.isFile()) {
      out.push(p);
    }
  }
  return out;
}

async function checkBundleSize() {
  for (const sub of BUNDLE_SUBDIRS) {
    const dir = join(BUNDLE_ROOT, sub);
    const s = await safeStat(dir);
    if (!s || !s.isDirectory()) continue;
    const files = await listFiles(dir);
    for (const f of files) {
      const st = await stat(f);
      if (st.size >= MAX_BYTES) {
        addErr(
          `Bundle 体积超阈值: ${f.replace(REPO_ROOT + '/', '')} = ${(st.size / 1048576).toFixed(2)} MB (>= 30 MB)`,
        );
      }
    }
  }
}

// T22 step-4b/4c: 扫描 dist/assets/, 读取 index-*.js 字节数, 作为 mainChunkBytes 基线.
//   不修改 30MB 阈值, 仅记录 (NFR-02 / KSI-04).
async function recordMainChunkBytes() {
  const distAssets = join(REPO_ROOT, 'dist', 'assets');
  const s = await safeStat(distAssets);
  if (!s || !s.isDirectory()) {
    addWarn('dist/assets not found (run `npm run build` first); mainChunkBytes unavailable.');
    return;
  }
  const files = await listFiles(distAssets);
  for (const f of files) {
    if (/^index-.*\.js$/.test(f.replace(/\\/g, '/').split('/').pop() ?? '')) {
      const st = await stat(f);
      mainChunkBytes[f.replace(REPO_ROOT + '/', '')] = st.size;
    }
  }
}

async function checkCargoProfile() {
  let body;
  try {
    body = await readFile(CARGO_TOML, 'utf8');
  } catch {
    addErr(`Cargo.toml 不可读: ${CARGO_TOML}`);
    return;
  }

  // 抽 [profile.release] 块. 容忍行尾注释.
  const blockMatch = body.match(/\[profile\.release\][^\[]*?(?=\n\[|\n$|$)/s);
  if (!blockMatch) {
    addErr('Cargo.toml 缺少 [profile.release] 块 (FR-01 / E-04).');
    return;
  }
  const block = blockMatch[0];

  // 砍去行尾注释再核对, 否则 `strip = true # comment` 会匹配但 cancel 出来错误.
  const stripped = block
    .split('\n')
    .map((line) => line.replace(/#.*$/, ''))
    .join('\n');

  for (const rule of REQUIRED_PROFILE) {
    if (!rule.pattern.test(stripped)) {
      addErr(
        `Cargo.toml [profile.release] 缺/错: ${rule.key} (期望 ${rule.expected})`,
      );
    }
  }
}

async function main() {
  await checkBundleSize();
  await checkCargoProfile();
  await recordMainChunkBytes();

  if (warnings.length > 0) {
    console.warn('[check-perf-budget] warnings:');
    for (const w of warnings) console.warn(`  - ${w}`);
  }

  if (errors.length > 0) {
    console.error('[check-perf-budget] FAILED:');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(
    '[check-perf-budget] OK — Cargo profile 完整; 未发现超 30 MB 产物.',
  );
  if (process.argv.includes('--report')) {
    const report = {
      timestamp: new Date().toISOString(),
      mainChunkBytes,
      mainChunkBytesTotal: Object.values(mainChunkBytes).reduce((a, b) => a + b, 0),
    };
    try {
      const { writeFileSync, mkdirSync } = await import('node:fs');
      const { join: pathJoin, dirname: pathDirname } = await import('node:path');
      const reportPath = pathJoin(REPO_ROOT, '.reports', 'check-perf-budget.json');
      mkdirSync(pathDirname(reportPath), { recursive: true });
      writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
      console.log(`[check-perf-budget] report → ${reportPath}`);
    } catch (err) {
      console.error(`[check-perf-budget] report write failed: ${err.message}`);
    }
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('check-perf-budget FAILED:', err);
  process.exit(1);
});

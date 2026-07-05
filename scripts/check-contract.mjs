#!/usr/bin/env node
/**
 * check-contract.mjs — 契约同步守卫 (R-04 / F-32)
 *
 * 规则:
 *   A. src/** 不得直接 import 任何 Node-side API:
 *        - 'fs' / 'node:fs' / 'fs/promises' / 'node:fs/promises'
 *        - 'path' / 'node:path'
 *      例外: src/lib/tauri.ts 允许 import '@tauri-apps/api/core'.
 *      这是 R-04 缓解: 前端永远走 IPC.
 *
 *   B. src/** 除了 src/lib/tauri.ts 不得 import '@tauri-apps/api/core' 中
 *      的 invoke. 允许 import 别名 / 类型, 但不允许出现 'invoke' 标识符.
 *
 *   C. commands.rs 与 tauri.ts 的命令名必须一一对应 (8 个).
 *      - src-tauri/src/commands.rs 出现的 snake_case 命令名集合
 *        必须 == src/lib/tauri.ts 中 invoke<...>('...') 的字符串集合.
 *
 * 用法:
 *   node scripts/check-contract.mjs
 *   npm run check-contract
 */

import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

const errors = [];
async function listTsFiles(dir) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      out.push(...(await listTsFiles(p)));
    } else if (e.isFile() && /\.(ts|tsx)$/.test(e.name) && !/\.test\.ts$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

// ---- A. 禁止前端 fs/path import ----
const FORBIDDEN_IMPORTS = [/from\s+['"]fs['"]/, /from\s+['"]fs\/promises['"]/, /from\s+['"]node:fs['"]/, /from\s+['"]node:fs\/promises['"]/, /from\s+['"]path['"]/, /from\s+['"]node:path['"]/];

for (const file of await listTsFiles(resolve(ROOT, 'src'))) {
  const text = await readFile(file, 'utf8');
  for (const re of FORBIDDEN_IMPORTS) {
    const m = text.match(re);
    if (m) {
      errors.push(`[forbidden-import] ${file.replace(ROOT + '/', '')} matched ${re}`);
    }
  }
}

// ---- B. invoke 只能从 src/lib/tauri.ts 出现 ----
const TAURI_EXIT = 'src/lib/tauri.ts';
for (const file of await listTsFiles(resolve(ROOT, 'src'))) {
  const rel = file.replace(ROOT + '/', '');
  if (rel === TAURI_EXIT) continue;
  const text = await readFile(file, 'utf8');
  // 匹配 import { invoke } from '@tauri-apps/api/core'
  if (/from\s+['"]@tauri-apps\/api\/core['"]/.test(text)) {
    errors.push(
      `[forbidden-invoke-entry] ${rel} imports @tauri-apps/api/core; only ${TAURI_EXIT} is allowed`,
    );
  }
  // 同时禁止裸露 invoke( 出现 (避免手动从别处 re-export)
  if (/\binvoke\s*[<(]/.test(text)) {
    errors.push(`[forbidden-invoke-call] ${rel} calls invoke(...) directly`);
  }
}

// ---- C. 命令名一致性 ----
const commandsFile = resolve(ROOT, 'src-tauri', 'src', 'commands.rs');
const tauriFile = resolve(ROOT, 'src', 'lib', 'tauri.ts');

const rustText = await readFile(commandsFile, 'utf8');
const rustNames = new Set();
for (const m of rustText.matchAll(/#\[tauri::command\][\s\S]*?pub\s+(?:async\s+)?fn\s+([a-z_][a-z0-9_]*)/g)) {
  rustNames.add(m[1]);
}

const tsText = await readFile(tauriFile, 'utf8');
const tsNames = new Set();
// match: invoke<...>('name' | invoke('name' | safeInvoke<...>('name' | safeInvoke('name'
// capture group 1 = snake_case command name
for (const m of tsText.matchAll(/(?:safe)?invoke(?:\s*<[^>]+>)?\s*\(\s*['"]([a-z_][a-z0-9_]*)['"]/gi)) {
  tsNames.add(m[1]);
}

const onlyRust = [...rustNames].filter((n) => !tsNames.has(n));
const onlyTs = [...tsNames].filter((n) => !rustNames.has(n));

if (onlyRust.length > 0 || onlyTs.length > 0) {
  if (onlyRust.length > 0) errors.push(`[contract-drift] commands.rs only: ${onlyRust.join(', ')}`);
  if (onlyTs.length > 0) errors.push(`[contract-drift] tauri.ts only: ${onlyTs.join(', ')}`);
}

// ---- D. 双源常量一致性: MAX_RECENT (Rust + TS) ----
// Rust 端: src-tauri/src/services/recent_files.rs 中 `pub const MAX_RECENT_ITEMS: usize = N;`
// TS   端: src/stores/recentStore.ts 中 `export const MAX_RECENT = N;` (或 `MAX_ITEMS = N`).
const RECENT_FILE_RUST = resolve(ROOT, 'src-tauri', 'src', 'services', 'recent_files.rs');
const RECENT_FILE_TS = resolve(ROOT, 'src', 'stores', 'recentStore.ts');

const rustRecentText = await readFile(RECENT_FILE_RUST, 'utf8');
const rustConstMatch = rustRecentText.match(/pub\s+const\s+MAX_RECENT_ITEMS\s*:\s*usize\s*=\s*(\d+)/);
const rustMax = rustConstMatch ? Number(rustConstMatch[1]) : null;

const tsRecentText = await readFile(RECENT_FILE_TS, 'utf8');
const tsConstMatch =
  tsRecentText.match(/export\s+const\s+MAX_RECENT\s*=\s*(\d+)/) ||
  tsRecentText.match(/export\s+const\s+MAX_ITEMS\s*=\s*(\d+)/);
const tsMax = tsConstMatch ? Number(tsConstMatch[1]) : null;

if (rustMax === null) {
  errors.push('[max-recent-missing] Rust MAX_RECENT_ITEMS not found in recent_files.rs');
}
if (tsMax === null) {
  errors.push('[max-recent-missing] TS MAX_RECENT/MAX_ITEMS not found in recentStore.ts');
}
if (rustMax !== null && tsMax !== null && rustMax !== tsMax) {
  errors.push(`[max-recent-mismatch] Rust=${rustMax} vs TS=${tsMax}; they must be equal`);
}
if (rustMax !== null && rustMax !== 10) {
  errors.push(`[max-recent-value] Rust MAX_RECENT_ITEMS=${rustMax} must be 10 (FR-01 硬约束)`);
}
if (tsMax !== null && tsMax !== 10) {
  errors.push(`[max-recent-value] TS MAX_RECENT=${tsMax} must be 10 (FR-01 硬约束)`);
}

if (errors.length > 0) {
  console.error('check-contract FAILED:');
  for (const e of errors) console.error('  -', e);
  process.exit(1);
}

console.log(
  `check-contract OK — ${rustNames.size} Rust commands ↔ ${tsNames.size} TS methods, no direct fs/path/invoke in src/**, MAX_RECENT=${rustMax ?? tsMax}.`,
);

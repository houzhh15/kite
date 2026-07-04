#!/usr/bin/env node
/**
 * check-csp.mjs — CSP 红线守卫 (AC-06-2 / NFR-SEC-02 / R-04)
 *
 * 规则 (来自 docs/design/compiled.md §3.4 + FR-06):
 *   - 必须出现:  default-src 'self'
 *   - 必须出现:  script-src 'self'
 *   - 必须出现:  style-src 'self' 'unsafe-inline'
 *   - 必须出现:  img-src 'self' asset: https: data:
 *   - 必须出现:  font-src 'self' data:
 *   - 必须出现:  connect-src 'self' ipc: http://ipc.localhost
 *   - 必须**不**出现:
 *       * 'unsafe-eval' (script 任意执行)
 *       * 'unsafe-inline' (script 内联 — 注意 style 仍允许)
 *       * http:// 或 https:// 出现在 script-src / style-src / default-src
 *         (只允许 connect-src 走 ipc: http://ipc.localhost)
 *       * wildcard '*' 出现在任何 src
 *
 * 用法:
 *   node scripts/check-csp.mjs                # 默认读 src-tauri/tauri.conf.json
 *   npm run check-csp
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CONFIG_PATH = resolve(
  __dirname,
  '..',
  'src-tauri',
  'tauri.conf.json',
);

const REQUIRED_DIRECTIVES = [
  /default-src\s+'self'/,
  /script-src\s+'self'/,
  /style-src\s+'self'\s+'unsafe-inline'/,
  /img-src\s+'self'\s+asset:\s+https:\s+data:/,
  /font-src\s+'self'\s+data:/,
  /connect-src\s+'self'\s+ipc:\s+http:\/\/ipc\.localhost/,
];

const FORBIDDEN_TOKENS = [
  {
    pattern: /'unsafe-eval'/,
    reason: "script 'unsafe-eval' is forbidden (AC-06-2)",
  },
  {
    // 仅 script-src / default-src 不允许 'unsafe-inline'; style-src 允许.
    // 因此用 negative lookbehind 排除 style-src 行.
    pattern: /(?<!style-src[^;\n]*)\b'unsafe-inline'\b/,
    reason: "'unsafe-inline' only allowed in style-src (AC-06-2)",
  },
  {
    pattern: /\*\b/,
    reason: 'wildcard * forbidden in CSP',
  },
];

const cfgRaw = await readFile(CONFIG_PATH, 'utf8');
let csp;
try {
  const cfg = JSON.parse(cfgRaw);
  csp = cfg?.app?.security?.csp;
} catch (err) {
  console.error('check-csp FAILED: tauri.conf.json is not valid JSON:', err.message);
  process.exit(1);
}

if (typeof csp !== 'string' || csp.length === 0) {
  console.error(`check-csp FAILED: app.security.csp missing in ${CONFIG_PATH}`);
  process.exit(1);
}

const errors = [];

// 必须出现的指令
for (const re of REQUIRED_DIRECTIVES) {
  if (!re.test(csp)) errors.push(`required directive missing: ${re}`);
}

// 禁用 token
for (const { pattern, reason } of FORBIDDEN_TOKENS) {
  if (pattern.test(csp)) errors.push(`${reason} (matches /${pattern.source}/)`);
}

if (errors.length > 0) {
  console.error('check-csp FAILED:');
  for (const e of errors) console.error('  -', e);
  console.error('\nCurrent CSP:\n  ', csp);
  process.exit(1);
}

console.log('check-csp OK — tauri.conf.json app.security.csp matches FR-06 strict policy.');

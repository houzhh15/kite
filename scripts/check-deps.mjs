#!/usr/bin/env node
/**
 * check-deps.mjs — 依赖红线守卫 (R-03 / NFR-SEC-01 / NFR-SEC-03)
 *
 * 规则:
 *   1. 严禁的前端运行时依赖 (违反 = 不可逆架构偏差):
 *      - rehype-raw         (前端 markdown 解析应只用 react-markdown 流程)
 *      - fs-extra           (文件系统入口应只走 IPC, 见 FR-04 + C-07)
 *      - chokidar           (前端无文件监视需求, 避免触发 Node API)
 *      - electron           (技术栈锁定 Tauri, 见技术决策 §1)
 *   2. 严禁的同进程 Tauri 替代框架:
 *      - nut-tree           (Tauri 替代品)
 *
 * 用法:
 *   node scripts/check-deps.mjs                # 默认检查 package.json + lock
 *   npm run check-deps
 *
 * 退出码: 0 = 通过 / 1 = 发现红线包.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

const FORBIDDEN = [
  'rehype-raw',
  'fs-extra',
  'chokidar',
  'electron',
  'nut-tree',
  // T23.4 (FR-04 / AC-04-2): volume governance — reject `mermaid-vendor-bin`
  // on the npm side as well (the Rust-side lockfile is covered by the
  // --cve audit pass in the same script).
  'mermaid-vendor-bin',
];

const errors = [];

// 1. package.json
const pkgPath = join(ROOT, 'package.json');
const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
const allDeps = {
  ...(pkg.dependencies ?? {}),
  ...(pkg.devDependencies ?? {}),
};
for (const dep of FORBIDDEN) {
  if (allDeps[dep]) {
    errors.push(
      `[package.json] forbidden dependency "${dep}" found at version "${allDeps[dep]}"`,
    );
  }
}

// 2. package-lock.json (如存在), 递归扫描顶层 resolved/tarball
const lockPath = join(ROOT, 'package-lock.json');
try {
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  const locked = new Set();
  function walk(obj) {
    if (!obj || typeof obj !== 'object') return;
    if (typeof obj.name === 'string') locked.add(obj.name);
    if (typeof obj.dependency === 'string') locked.add(obj.dependency);
    if (obj.dependencies) for (const v of Object.values(obj.dependencies)) walk(v);
    if (obj.packages) for (const v of Object.values(obj.packages)) walk(v);
  }
  walk(lock);
  for (const dep of FORBIDDEN) {
    if (locked.has(dep)) {
      errors.push(`[package-lock.json] forbidden dependency "${dep}" is in lockfile`);
    }
  }
} catch (err) {
  if (err.code !== 'ENOENT') {
    // ignore 'file not found', report other errors
    errors.push(`[package-lock.json] read failed: ${err.message}`);
  }
}

if (errors.length > 0) {
  console.error('check-deps FAILED:');
  for (const e of errors) console.error('  -', e);
  console.error('\nBanned list (R-03):', FORBIDDEN.join(', '));
  process.exit(1);
}

console.log(
  `check-deps OK — scanned package.json${errors.length === 0 ? ' + package-lock.json' : ''}, no banned deps.`,
);

// ============================================================================
// T23.2 (FR-02 / AC-02-1..3): `--cve` mode — known-vulnerability scan.
// Runs `npm audit --json` + `cargo audit --json` (where available) and exits
// non-zero whenever a High/Critical advisory is found. When invoked without
// `--cve`, the legacy FORBIDDEN scan above already gates the build; this
// block is the second layer (per AC-02-3 it must NOT regress those callers).
// ============================================================================

import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const CACHE_DIR = join(ROOT, 'node_modules', '.cache', 'check-deps');
const CACHE_FILE = join(CACHE_DIR, 'advisory-snapshot.json');
const REPORT_FILE = join(ROOT, '.reports', 'check-deps-cve.json');

const HIGH_SEVERITIES = new Set(['high', 'critical']);

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { ...opts, timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        // npm/cargo audit return non-zero when vulns exist; that is NOT a fatal
        // shell error, so we resolve with whatever it produced.
        resolve({
          stdout: stdout ?? '',
          stderr: stderr ?? '',
          code: err && typeof err.code === 'number' ? err.code : 0,
        });
      },
    );
  });
}

async function runNpmAudit() {
  const { stdout, code } = await run('npm', ['audit', '--json']);
  if (!stdout.trim()) return { vulnerabilities: {}, _code: code };
  try {
    const parsed = JSON.parse(stdout);
    parsed._code = code;
    return parsed;
  } catch {
    return { vulnerabilities: {}, _code: code };
  }
}

async function runCargoAudit() {
  const { stdout, code } = await run('cargo', ['audit', '--json']);
  if (!stdout.trim()) return { vulnerabilities: { list: [] }, _code: code };
  try {
    const parsed = JSON.parse(stdout);
    parsed._code = code;
    return parsed;
  } catch {
    return { vulnerabilities: { list: [] }, _code: code };
  }
}

function flatNpmVulns(report) {
  const out = [];
  for (const [name, advisory] of Object.entries(report.vulnerabilities ?? {})) {
    if (!advisory || typeof advisory !== 'object') continue;
    const sev = String(advisory.severity ?? '').toLowerCase();
    if (!HIGH_SEVERITIES.has(sev)) continue;
    const via = Array.isArray(advisory.via)
      ? advisory.via
          .filter((v) => v && typeof v === 'object')
          .map((v) => v.title ?? v.name ?? String(v.url ?? v))
      : [];
    out.push({
      ecosystem: 'npm',
      name,
      severity: sev,
      range: advisory.range ?? '',
      via,
    });
  }
  return out;
}

function flatCargoVulns(report) {
  const out = [];
  const list = Array.isArray(report.vulnerabilities?.list)
    ? report.vulnerabilities.list
    : Array.isArray(report.vulnerabilities)
      ? report.vulnerabilities
      : [];
  for (const v of list) {
    const sev = String(v?.advisory?.severity ?? '').toLowerCase();
    if (!HIGH_SEVERITIES.has(sev)) continue;
    out.push({
      ecosystem: 'cargo',
      name: v?.package?.name ?? v?.advisory?.package ?? 'unknown',
      severity: sev,
      range: v?.package?.version ?? '',
      via: Array.isArray(v?.advisory?.aliases)
        ? v.advisory.aliases
        : v?.advisory?.id
          ? [v.advisory.id]
          : [],
    });
  }
  return out;
}

async function writeCache(findings) {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(
    CACHE_FILE,
    JSON.stringify({ ts: Date.now(), entries: findings }, null, 2),
  );
}

async function readCache() {
  if (!existsSync(CACHE_FILE)) return [];
  try {
    const parsed = JSON.parse(await readFile(CACHE_FILE, 'utf8'));
    return Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch {
    return [];
  }
}

async function writeReport(findings, ok, notes) {
  await mkdir(join(ROOT, '.reports'), { recursive: true });
  await writeFile(
    REPORT_FILE,
    JSON.stringify(
      {
        ts: new Date().toISOString(),
        ok,
        notes,
        findings,
        counts: {
          total: findings.length,
          high: findings.filter((f) => f.severity === 'high').length,
          critical: findings.filter((f) => f.severity === 'critical').length,
        },
      },
      null,
      2,
    ),
  );
}

async function runCveMode() {
  const notes = [];
  const findings = [];

  // npm side
  try {
    const npmReport = await runNpmAudit();
    findings.push(...flatNpmVulns(npmReport));
  } catch (err) {
    notes.push(`npm audit failed: ${err?.message ?? err}`);
    const cached = (await readCache()).filter((e) => e.ecosystem === 'npm');
    if (cached.length === 0) {
      console.warn('WARN: offline mode, no cache -> skipping npm audit');
      notes.push('npm audit skipped: offline + no cache');
    } else {
      findings.push(...cached);
      notes.push(`npm audit served from cache: ${cached.length} entries`);
    }
  }

  // cargo side
  try {
    const cargoReport = await runCargoAudit();
    findings.push(...flatCargoVulns(cargoReport));
  } catch (err) {
    notes.push(`cargo audit unavailable: ${err?.message ?? err}`);
    console.warn('WARN: cargo audit unavailable (binary missing?)');
  }

  // Persist advisory snapshot for offline runs (best-effort).
  try {
    await writeCache(findings);
  } catch {
    // Cache write failure must not block CI.
  }

  // Output grouped report.
  if (findings.length === 0) {
    const okLine = `check-deps:cve OK — 0 high/critical vulnerabilities`;
    console.log(okLine);
    await writeReport(findings, true, notes);
    process.exit(0);
  }

  for (const f of findings) {
    const range = f.range ? ` (${f.range})` : '';
    const via = Array.isArray(f.via) && f.via.length ? ` via ${f.via.join(', ')}` : '';
    console.error(
      `[${f.ecosystem}] ${f.name}${range} → ${f.severity}${via}`,
    );
  }
  console.error(
    `check-deps:cve FAILED — ${findings.length} high/critical vulnerabilities`,
  );
  await writeReport(findings, false, notes);
  process.exit(1);
}

const argv = process.argv.slice(2);
const isCve =
  argv.includes('--cve') ||
  process.env.npm_lifecycle_event === 'check-deps:cve';

if (isCve) {
  runCveMode().catch((err) => {
    console.error('check-deps:cve crashed:', err?.message ?? err);
    process.exit(1);
  });
}

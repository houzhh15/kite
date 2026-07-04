#!/usr/bin/env node
/**
 * append-release-notes.mjs — T14 step-6 (C-06 / FR-09 / AC-09-1~3)
 *
 * 扫描 `--artifact-dir` 中的打包产物（*.dmg / *.app / *.msi / *.exe），
 * 计算 SHA256 + Bytes；与 `--version`（默认 package.json version）校验；
 * 汇总 commit range（`git log <prev>..HEAD --oneline`）；追加一段到
 * `docs/release-notes.md`。同时把豁免审计列表（docs/security-audit-exceptions.md
 * 的 Active Exceptions 段）作为 audit ignore 来源附在尾部。
 *
 * 退出码：
 *   0 = 成功
 *   2 = version mismatch（AC-09-3）
 *   3 = artifact missing or empty（AC-06-3）
 *
 * 用法：
 *   node scripts/append-release-notes.mjs \
 *     --version=v0.1.0 \
 *     --artifact-dir=src-tauri/target/release/bundle/macos
 */

import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const REPO_ROOT = resolve(__dirname, '..');
const PKG = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
const RELEASE_NOTES_PATH = join(REPO_ROOT, 'docs', 'release-notes.md');
const AUDIT_EXCEPTIONS_PATH = join(REPO_ROOT, 'docs', 'security-audit-exceptions.md');

const ARTIFACT_GLOBS = ['.dmg', '.app', '.msi', '.exe'];

function parseArgs(argv) {
  const out = {};
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (!m) continue;
    out[m[1]] = m[2] ?? true;
  }
  return out;
}

function readVersion(args) {
  if (typeof args.version === 'string') return args.version.replace(/^v/, '');
  return PKG.version;
}

function previousTag() {
  try {
    const t = execSync('git describe --tags --abbrev=0 HEAD^', {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return t || 'v0.0.0';
  } catch {
    return 'v0.0.0';
  }
}

function commitRange(prev) {
  try {
    const range = `${prev}..HEAD`;
    const out = execSync(`git log ${range} --oneline`, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out || '(no commits)';
  } catch (err) {
    return `(git log failed: ${err.message})`;
  }
}

function sha256(file) {
  return new Promise((resolveP, rejectP) => {
    const hash = createHash('sha256');
    const s = createReadStream(file);
    s.on('error', rejectP);
    s.on('data', (c) => hash.update(c));
    s.on('end', () => resolveP(hash.digest('hex')));
  });
}

async function findArtifacts(dir) {
  let s;
  try {
    s = await stat(dir);
  } catch {
    return [];
  }
  if (!s.isDirectory()) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await findArtifacts(p)));
    } else if (e.isFile() && ARTIFACT_GLOBS.some((suf) => e.name.endsWith(suf))) {
      out.push(p);
    }
  }
  return out;
}

function readAuditExceptions() {
  if (!existsSync(AUDIT_EXCEPTIONS_PATH)) return [];
  const body = readFileSync(AUDIT_EXCEPTIONS_PATH, 'utf8');
  const lines = body.split('\n');
  const rows = [];
  let inTable = false;
  for (const line of lines) {
    if (line.startsWith('| Advisory')) { inTable = true; continue; }
    if (inTable && line.startsWith('|---')) continue;
    if (inTable && line.startsWith('|')) {
      const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
      if (cells.length >= 3 && cells[0] && cells[0] !== '_empty_') {
        const sev = cells[1];
        if (sev && ['Low', 'Medium'].includes(sev)) {
          rows.push({ advisory: cells[0], severity: sev, reason: cells[3] || '' });
        }
      }
    } else if (inTable && line.trim() === '') {
      break;
    }
  }
  return rows;
}

function isoDate(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

async function main() {
  const args = parseArgs(process.argv);
  const version = readVersion(args);
  const pkgVersion = PKG.version;

  // AC-09-3: version 与 package.json 不一致即 exit 2
  if (version !== pkgVersion) {
    console.error(`version mismatch: --version=${version} but package.json=${pkgVersion}`);
    process.exit(2);
  }

  const artifactDirRaw = args['artifact-dir'];
  if (typeof artifactDirRaw !== 'string' || artifactDirRaw.length === 0) {
    console.error('--artifact-dir is required');
    process.exit(3);
  }
  const artifactDir = resolve(REPO_ROOT, artifactDirRaw);

  const artifacts = await findArtifacts(artifactDir);
  if (artifacts.length === 0) {
    console.error(`artifact missing or empty: ${artifactDir}`);
    process.exit(3);
  }

  const prevTag = typeof args['previous-tag'] === 'string'
    ? args['previous-tag']
    : previousTag();

  const commitList = commitRange(prevTag);

  const rows = [];
  for (const a of artifacts) {
    const st = await stat(a);
    const sha = await sha256(a);
    rows.push({
      file: relative(REPO_ROOT, a),
      bytes: st.size,
      sha256: sha,
    });
  }

  const auditExceptions = readAuditExceptions();
  const dateStr = isoDate();
  const heading = `## v${version} (${dateStr})`;

  let md = `\n${heading}\n\n`;
  md += `### Commit range (${prevTag}..HEAD)\n\n`;
  md += '```\n' + commitList + '\n```\n\n';
  md += `### Artifacts\n\n`;
  md += '| File | Bytes | SHA256 |\n| --- | ---: | --- |\n';
  for (const r of rows) {
    md += `| \`${r.file}\` | ${r.bytes} | \`${r.sha256}\` |\n`;
  }
  md += '\n';
  md += `### Audit\n\n`;
  if (auditExceptions.length === 0) {
    md += '_No active audit exceptions recorded. cargo audit + npm audit both gate the release._\n';
  } else {
    md += 'Active audit exceptions (Low / Medium only; High / Critical block release):\n\n';
    md += '| Advisory | Severity | Reason |\n| --- | --- | --- |\n';
    for (const e of auditExceptions) {
      md += `| \`${e.advisory}\` | ${e.severity} | ${e.reason} |\n`;
    }
  }
  md += '\n';

  // append (do NOT touch H1)
  let existing = '';
  if (existsSync(RELEASE_NOTES_PATH)) {
    existing = readFileSync(RELEASE_NOTES_PATH, 'utf8');
    if (!existing.endsWith('\n')) existing += '\n';
  }
  writeFileSync(RELEASE_NOTES_PATH, existing + md, 'utf8');

  // GitHub Actions step summary
  if (process.env.GITHUB_STEP_SUMMARY) {
    let summary = `### Release v${version} (${dateStr})\n\n`;
    summary += `**Artifacts**: ${rows.length}\n\n`;
    for (const r of rows) {
      summary += `- \`${r.file}\` (${r.bytes} B, sha256:${r.sha256.slice(0, 12)}…)\n`;
    }
    summary += `\n_Appended to docs/release-notes.md._\n`;
    try {
      writeFileSync(process.env.GITHUB_STEP_SUMMARY, summary, { flag: 'a' });
    } catch {
      /* non-CI env, ignore */
    }
  }

  console.log(`append-release-notes: appended v${version} (${rows.length} artifacts)`);
  process.exit(0);
}

main().catch((err) => {
  console.error('append-release-notes FAILED:', err);
  process.exit(1);
});
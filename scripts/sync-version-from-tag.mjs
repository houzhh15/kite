#!/usr/bin/env node
/**
 * sync-version-from-tag.mjs — R-41 增量
 *
 * CI 步骤: 从 git tag 同步版本号到构建配置.
 *
 * 触发: .github/workflows/release.yml 在 `cargo tauri build` 之前调用.
 *
 * 输入 (CLI args):
 *   argv[2] = GIT_TAG       例如 "v0.0.2"; 空串表示跳过 (用 committed 版本)
 *   argv[3] = BUILD_NUMBER  例如 "5" (github.run_number); 默认 "1"
 *
 * 同步范围 (4 个文件):
 *   1. src-tauri/tauri.conf.json
 *      - JSON 字段 "version" → tag 去掉 v 前缀
 *      - 这是 Tauri CLI 读取的版本, 也是 macOS About KITE 显示的
 *        CFBundleShortVersionString.
 *   2. src-tauri/Cargo.toml
 *      - TOML 字段 version → tag 去掉 v 前缀
 *      - 与 tauri.conf.json 保持一致, 避免 Tauri CLI 警告.
 *   3. src-tauri/entitlements/Info.plist
 *      - CFBundleShortVersionString → tag 去掉 v 前缀
 *      - CFBundleVersion → BUILD_NUMBER
 *      - macOS About KITE 显示 "X.Y.Z (B)" 中的两个字段.
 *   4. package.json
 *      - JSON 字段 "version" → tag 去掉 v 前缀
 *      - npm 生态一致性, 便于未来 `npm publish`.
 *
 * Tag 格式校验:
 *   - 必须匹配 /^v(\d+\.\d+\.\d+(-[\w.]+)?)$/ (semver + 可选预发布后缀).
 *   - 不匹配 → exit 1, 阻断 CI.
 *
 * 幂等性:
 *   - 已是对的目标版本时, 写入与原内容相同, 无副作用.
 *
 * 跳过条件:
 *   - argv[2] 为空 (workflow_dispatch 且 inputs.version 未填) → 跳过, exit 0.
 *   - 用 committed 版本继续构建.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

const tag = process.argv[2] ?? '';
const buildNumber = process.argv[3] ?? '1';

if (!tag) {
  console.log('[sync-version] GIT_TAG empty, skipping (使用 committed 版本构建)');
  process.exit(0);
}

// Tag 格式校验: vX.Y.Z 或 vX.Y.Z-pre.N
const m = tag.match(/^v(\d+\.\d+\.\d+(-[\w.]+)?)$/);
if (!m) {
  console.error(`[sync-version] Invalid tag format: "${tag}" (expected vX.Y.Z or vX.Y.Z-pre.N)`);
  process.exit(1);
}
const version = m[1];
console.log(`[sync-version] tag=${tag} → version=${version}, build=${buildNumber}`);

/**
 * 通用: 读文件, JSON.parse, 修改, 写回 (保持 2 空格缩进 + 尾换行).
 */
function updateJson(filePath, mutator) {
  const abs = resolve(ROOT, filePath);
  const obj = JSON.parse(readFileSync(abs, 'utf8'));
  const next = mutator(obj) ?? obj;
  writeFileSync(abs, JSON.stringify(next, null, 2) + '\n');
  console.log(`[sync-version]   ✓ ${filePath}`);
}

// 1. tauri.conf.json
updateJson('src-tauri/tauri.conf.json', (c) => {
  c.version = version;
  return c;
});

// 2. Cargo.toml (TOML, 用 regex 替换第一行 version = "...")
{
  const p = resolve(ROOT, 'src-tauri/Cargo.toml');
  const before = readFileSync(p, 'utf8');
  const after = before.replace(/^version\s*=\s*".*"$/m, `version = "${version}"`);
  if (after === before) {
    console.warn(`[sync-version]   ! Cargo.toml version 未找到匹配行, 跳过`);
  } else {
    writeFileSync(p, after);
    console.log(`[sync-version]   ✓ src-tauri/Cargo.toml`);
  }
}

// 3. Info.plist (XML, 用 regex 替换 CFBundleShortVersionString + CFBundleVersion)
{
  const p = resolve(ROOT, 'src-tauri/entitlements/Info.plist');
  const before = readFileSync(p, 'utf8');
  let after = before.replace(
    /(<key>CFBundleShortVersionString<\/key>\s*<string>)[^<]*(<\/string>)/,
    `$1${version}$2`
  );
  after = after.replace(
    /(<key>CFBundleVersion<\/key>\s*<string>)[^<]*(<\/string>)/,
    `$1${buildNumber}$2`
  );
  if (after === before) {
    console.warn(`[sync-version]   ! Info.plist CFBundle* 未找到匹配行, 跳过`);
  } else {
    writeFileSync(p, after);
    console.log(`[sync-version]   ✓ src-tauri/entitlements/Info.plist`);
  }
}

// 4. package.json
updateJson('package.json', (p) => {
  p.version = version;
  return p;
});

console.log(`[sync-version] done. version=${version}, build=${buildNumber}`);

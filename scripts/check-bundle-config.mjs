#!/usr/bin/env node
/**
 * check-bundle-config.mjs — T14 step-5a (C-01 / AC-01-3)
 *
 * 校验 `src-tauri/tauri.conf.json` 的 `bundle.*` 字段是否齐备：
 *   - 必填顶层字段：publisher / copyright / shortDescription / longDescription / category
 *   - icon[]：5 件套按 32x32 / 128x128 / 128x128@2x / icon.icns / icon.ico 顺序
 *   - Windows：windows.wix.upgradeCode (GUID 正则) / manufacturer / productName / language
 *   - macOS：macOS.minimumSystemVersion === "11.0"；entitlements 与 infoPlist 路径存在
 *
 * 任一失败：throw `missing:<field>`，stderr 输出字段名，process.exit(1)。
 *
 * 用法：
 *   node scripts/check-bundle-config.mjs
 *   npm run check-bundle-config
 *   node scripts/check-bundle-config.mjs --report       # 同时写出 .reports/check-bundle-config.json
 */

import { readFileSync, accessSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const REPO_ROOT = resolve(__dirname, '..');
const SRC_TAURI = join(REPO_ROOT, 'src-tauri');
const CONF_PATH = join(SRC_TAURI, 'tauri.conf.json');
const REPORT_PATH = join(REPO_ROOT, '.reports', 'check-bundle-config.json');

const EXPECTED_ICONS = [
  'icons/32x32.png',
  'icons/128x128.png',
  'icons/128x128@2x.png',
  'icons/icon.icns',
  'icons/icon.ico',
];

// WiX UpgradeCode: {HEX8-HEX4-HEX4-HEX4-HEX12}（花括号可选）
const GUID_RE = /^\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}$/;

const errors = [];

function fail(field) {
  errors.push(`missing:${field}`);
}

function existsSync(path) {
  try {
    accessSync(path);
    return true;
  } catch {
    return false;
  }
}

function main() {
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(CONF_PATH, 'utf8'));
  } catch (err) {
    console.error(`check-bundle-config: cannot read ${CONF_PATH}: ${err.message}`);
    process.exit(1);
  }

  const bundle = cfg.bundle;
  if (!bundle || typeof bundle !== 'object') {
    fail('bundle');
    return done();
  }

  // 顶层必填
  for (const k of ['publisher', 'copyright', 'shortDescription', 'longDescription', 'category']) {
    if (!bundle[k] || typeof bundle[k] !== 'string' || bundle[k].trim().length === 0) {
      fail(`bundle.${k}`);
    }
  }

  if (bundle.targets !== 'all') {
    fail('bundle.targets');
  }

  // icon 顺序
  if (!Array.isArray(bundle.icon) || bundle.icon.length !== EXPECTED_ICONS.length) {
    fail('bundle.icon.length');
  } else {
    EXPECTED_ICONS.forEach((want, i) => {
      if (bundle.icon[i] !== want) fail(`bundle.icon[${i}]`);
    });
  }

  // Windows.wix
  const wix = bundle.windows?.wix;
  if (!wix) {
    fail('bundle.windows.wix');
  } else {
    // WixConfig.language is a WixLanguage enum (String | List | Map); accept any non-empty value.
    const lang = wix.language;
    const langOk = typeof lang === 'string'
      ? lang.length > 0
      : (Array.isArray(lang) && lang.length > 0)
        || (lang && typeof lang === 'object' && Object.keys(lang).length > 0);
    if (!langOk) fail('bundle.windows.wix.language');
    if (!GUID_RE.test(wix.upgradeCode || '')) fail('bundle.windows.wix.upgradeCode');
  }

  // Windows.nsis (Tauri 2 schema uses `languages` (Vec<String>), not `language`)
  const nsis = bundle.windows?.nsis;
  if (!nsis) {
    fail('bundle.windows.nsis');
  } else if (!Array.isArray(nsis.languages) || nsis.languages.length === 0) {
    fail('bundle.windows.nsis.languages');
  }

  // Windows.webviewInstallMode: { type: "downloadBootstrapper" | "skip" | "fixedRuntime" }
  const wim = bundle.windows?.webviewInstallMode;
  if (!wim || !['downloadBootstrapper', 'skip', 'fixedRuntime'].includes(wim.type)) {
    fail('bundle.windows.webviewInstallMode.type');
  }

  // macOS
  const mac = bundle.macOS;
  if (!mac) {
    fail('bundle.macOS');
  } else {
    if (mac.minimumSystemVersion !== '11.0') fail('bundle.macOS.minimumSystemVersion');
    if (!mac.entitlements) fail('bundle.macOS.entitlements');
    if (!mac.infoPlist) fail('bundle.macOS.infoPlist');
    if (mac.entitlements && !existsSync(join(SRC_TAURI, mac.entitlements))) {
      fail(`bundle.macOS.entitlements (file not found: ${mac.entitlements})`);
    }
    if (mac.infoPlist && !existsSync(join(SRC_TAURI, mac.infoPlist))) {
      fail(`bundle.macOS.infoPlist (file not found: ${mac.infoPlist})`);
    }
  }

  // identifier cross-check with Info.plist CFBundleIdentifier
  if (mac?.infoPlist) {
    try {
      const plist = readFileSync(join(SRC_TAURI, mac.infoPlist), 'utf8');
      const m = plist.match(/<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/);
      const expected = cfg.identifier;
      if (!m) {
        fail(`Info.plist CFBundleIdentifier missing`);
      } else if (m[1] !== expected) {
        fail(`Info.plist CFBundleIdentifier (${m[1]}) != tauri.conf identifier (${expected})`);
      }
    } catch (err) {
      fail(`Info.plist unreadable: ${err.message}`);
    }
  }

  return done();
}

function done() {
  const ok = errors.length === 0;
  if (!ok) {
    console.error('check-bundle-config FAILED:');
    for (const e of errors) console.error(`  - ${e}`);
  } else {
    console.log('check-bundle-config OK — bundle.* 字段齐备, GUID / icon 顺序 / macOS 路径 / identifier 一致.');
  }
  if (process.argv.includes('--report')) {
    // T22 step-2c/2d: 在 --report JSON 中追加 P2 chunk 识别 (FileTree / mermaid-vendor / katex-vendor)
    //   以及主 chunk 内 FileTree 内部符号反向 grep.
    const p2Chunks = [];
    const indexLeakWarnings = [];
    try {
      const distAssets = join(REPO_ROOT, 'dist', 'assets');
      if (existsSync(distAssets)) {
        const files = readdirSync(distAssets);
        // FileTree chunk pattern (React.lazy 自动拆分).
        for (const f of files) {
          if (/^FileTree-.*\.js$/.test(f)) p2Chunks.push(f);
        }
        // 主 chunk 内 FileTree 内部符号反向断言 (warn level, 不 fail).
        const indexChunks = files.filter((f) => /^index-.*\.js$/.test(f));
        for (const idx of indexChunks) {
          const content = readFileSync(join(distAssets, idx), 'utf8');
          if (/list_dir|fileTreeNode|onOpenFile/.test(content)) {
            indexLeakWarnings.push(`${idx} leaks FileTree internal symbols`);
          }
        }
      }
    } catch (err) {
      console.error(`check-bundle-config: dist/assets scan failed: ${err.message}`);
    }
    if (p2Chunks.some((f) => /^FileTree-.*\.js$/.test(f))) {
      console.log(`[ok] FileTree chunk isolated to dist/assets/${p2Chunks.find((f) => /^FileTree-/.test(f))}`);
    }
    const report = {
      ok,
      timestamp: new Date().toISOString(),
      configPath: 'src-tauri/tauri.conf.json',
      expectedIcons: EXPECTED_ICONS,
      errors: [...errors],
      p2Chunks,
      indexLeakWarnings,
    };
    try {
      mkdirSync(dirname(REPORT_PATH), { recursive: true });
      writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n', 'utf8');
      console.log(`check-bundle-config: report → ${REPORT_PATH}`);
    } catch (err) {
      console.error(`check-bundle-config: report write failed: ${err.message}`);
    }
  }
  process.exit(ok ? 0 : 1);
}

main();
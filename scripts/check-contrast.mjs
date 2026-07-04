#!/usr/bin/env node
/**
 * check-contrast.mjs — T12 对比度 CI 自检 (设计 §3.6.9 / NFR-M-02 / 防回归).
 *
 * 扫描 src/styles/global.css, 解析 --color-bg / --color-fg / --color-accent
 * 三元组 (light + dark), 与 WCAG AA 4.5:1 阈值核对.
 *
 * 用法:
 *   node scripts/check-contrast.mjs                # 默认读 src/styles/global.css
 *   node scripts/check-contrast.mjs --file=path    # 自定义 CSS 路径
 *
 * 退出码:
 *   0  所有 accent 组合 ≥ 4.5:1 (AA pass)
 *   1  任一组合 < 4.5:1
 *   2  文件缺失或解析失败
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

/** 解析 --file=path CLI 参数. */
function getCssPath() {
  const arg = process.argv.find((a) => a.startsWith('--file='));
  if (arg) return resolve(arg.slice('--file='.length));
  return join(REPO_ROOT, 'src', 'styles', 'global.css');
}

/* ---------------- WCAG 2.1 对比度公式 (与 src/lib/contrast.ts 同源) ---------------- */

function srgbChannelToLinear(c8) {
  const c = Math.min(255, Math.max(0, c8)) / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance([r, g, b]) {
  return (
    0.2126 * srgbChannelToLinear(r) +
    0.7152 * srgbChannelToLinear(g) +
    0.0722 * srgbChannelToLinear(b)
  );
}

function contrastRatio(fg, bg) {
  const L1 = relativeLuminance(fg);
  const L2 = relativeLuminance(bg);
  return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
}

/* ---------------- CSS 解析 ---------------- */

/**
 * 解析 CSS 字符串, 提取 :root / .dark 块内的 --color-bg / --color-fg / --color-accent.
 * 返回: { light: { bg, fg, accent }, dark: { bg, fg, accent } }
 */
function parseColors(css) {
  // 1. 去除 /* ... */ 注释 (含多行).
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');

  // 2. 删除 @import / @tailwind 等 @-rules (它们不含我们要的 token).
  const noAtRules = noComments.replace(/@[\w-]+[^;{]*;/g, '');

  // 3. 抓取每个 selector 块的内容 (假设无嵌套 {} — 全局 css 满足).
  const blocks = [];
  const blockRe = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = blockRe.exec(noAtRules))) {
    const selector = m[1].trim();
    blocks.push({ selector, body: m[2] });
  }

  /** 把 '15 23 42 / 0.60' 或 '15 23 42' 解析成 [r,g,b], 忽略 alpha. */
  function extractRgb(body, varName) {
    const re = new RegExp(`${varName}\\s*:\\s*([^;]+);`);
    const mm = re.exec(body);
    if (!mm) return null;
    const parts = mm[1].trim().split(/\s+/);
    if (parts.length < 3) return null;
    return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
  }

  const result = { light: {}, dark: {} };
  for (const { selector, body } of blocks) {
    let target = null;
    if (/^:root\b/.test(selector)) target = 'light';
    else if (/^\.dark\b/.test(selector)) target = 'dark';
    if (!target) continue;

    const bg = extractRgb(body, '--color-bg');
    const fg = extractRgb(body, '--color-fg');
    const accent = extractRgb(body, '--color-accent');
    if (bg) result[target].bg = bg;
    if (fg) result[target].fg = fg;
    if (accent) result[target].accent = accent;
  }
  return result;
}

/* ---------------- 主流程 ---------------- */

const AA_THRESHOLD = 4.5;

async function main() {
  const cssPath = getCssPath();
  let css;
  try {
    css = await readFile(cssPath, 'utf8');
  } catch (err) {
    console.error(`[check-contrast] cannot read ${cssPath}: ${err.message}`);
    process.exit(2);
  }

  const colors = parseColors(css);
  const checks = [];
  for (const theme of ['light', 'dark']) {
    const c = colors[theme];
    if (!c.bg || !c.fg || !c.accent) {
      console.error(
        `[check-contrast] ${theme}: missing --color-bg/--color-fg/--color-accent`,
      );
      process.exit(2);
    }
    checks.push({ theme, kind: 'accent-on-bg', ...c, ratio: contrastRatio(c.accent, c.bg) });
    checks.push({ theme, kind: 'fg-on-bg', ...c, ratio: contrastRatio(c.fg, c.bg) });
  }

  let failed = false;
  for (const r of checks) {
    const pass = r.ratio >= AA_THRESHOLD;
    const tag = pass ? 'PASS' : 'FAIL';
    if (!pass) failed = true;
    console.log(
      `  ${tag}  [${r.theme}] ${r.kind}: ${r.ratio.toFixed(2)}:1 ` +
        `(${r.ratio < AA_THRESHOLD ? '< 4.5' : '≥ 4.5'})`,
    );
  }

  if (failed) {
    console.error('[check-contrast] FAIL: at least one pair below WCAG AA 4.5:1');
    process.exit(1);
  }
  console.log('[check-contrast] PASS: all accent/fg pairs ≥ 4.5:1');
}

main().catch((err) => {
  console.error('[check-contrast] unexpected error:', err);
  process.exit(2);
});
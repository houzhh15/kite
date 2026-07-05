#!/usr/bin/env node
/**
 * check-no-display-revert.mjs — 防回归检查.
 *
 * 防御 src/styles/fullscreen.css 重新引入 `display: revert`,
 * 它会覆盖 Tailwind 的 `flex` 原子类, 把 Toolbar/Outline 等
 * 元素强制回退为 UA 默认的 `display: block`, 导致水平 flex 布局
 * 塌缩成垂直堆叠 (Logo 与按钮上下排列).
 *
 * 退出全屏时的"复位"应交由 `data-fullscreen="true"` 属性移除触发,
 * 不需要再用 CSS 显式改回 display.
 */

import fs from 'node:fs';

const file = 'src/styles/fullscreen.css';
const src = fs.readFileSync(file, 'utf8');

// 跳过注释行 (/* ... */) 后再做匹配.
const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '');
const banned = /display\s*:\s*(revert|revert-layer)\b/;

if (banned.test(stripped)) {
  console.error(`✗ ${file} 仍包含 \`display: revert|revert-layer\` (非注释中):`);
  const line = stripped.split(/\r?\n/).findIndex((l) => banned.test(l)) + 1;
  console.error(`  ${file}:${line}`);
  console.error('  详见 fullscreen.css 顶端的 ⚠ 注释.');
  process.exit(1);
}

console.log('✓ no display: revert/revert-layer in fullscreen.css (excluding comments)');


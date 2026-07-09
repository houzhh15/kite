#!/usr/bin/env node
/**
 * check-i18n-hardcode.mjs — T15 step-7c + T18 upgrade
 *
 * 防回归脚本：扫描 UI 组件中可见文本里出现的硬编码中文字符串，
 * 提示开发者改成 `t('namespace.key')`。
 *
 * 设计原则：
 *   - 扫描范围: src/components + src/stores + src/App.tsx + src/main.tsx.
 *   - 扫描两类硬编码:
 *       ① 字符串字面量中的连续 CJK (≥2 字符) → 视为硬编码 UI 文案.
 *       ② JSX 文本节点中含连续 CJK (≥2 字符) → 视为硬编码 UI 文案.
 *   - 允许豁免：注释、`// i18n:`、`// @i18n-ignore`、**字符串中没有 CJK 字符的**。
 *   - 退出码：0（无命中）/ 1（存在命中，CI 阻断）/ 2（脚本异常，文件读取失败等）。
 *
 * T18 升级（docs/design/compiled.md §3.5）:
 *   - 删除 T15_AFFECTED_FILES 白名单（7 文件）→ 全量扫描 components+stores+App.tsx+main.tsx.
 *   - 递归跳过 src/i18n/** 与 src/__tests__/**（命中 i18n 字典本身会触发误报）.
 *   - 新增 JSX 文本节点扫描：<标签>中文文本</标签>.
 *   - 扩展 REQUIRED_KEYS 至 21 个命名空间的关键键（≥50 个）.
 *   - 改进输出：缺失键独立段；命中按文件分组；OK 行追加命名空间统计.
 */

import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

/**
 * R-39 修复: 把任意分隔符的绝对路径转成相对 ROOT 的 POSIX 路径.
 *   Windows 上 path.join 用 '\\', 但下面的硬编码字面量都是 '/',
 *   跨平台时 endsWith/startsWith 全失效. 这里统一转 POSIX 形式.
 *   注意 ROOT 本身仍可保留平台原生分隔符, 因为 ROOT.length 截的是
 *   绝对路径, 与 rel 用的字面量无关.
 */
function toPosixRel(absPath) {
  return absPath.slice(ROOT.length + 1).split(sep).join('/');
}

// T18 升级：扫描目录. 'src' 单文件入口; 其它是目录, 递归 walk 跳过 i18n/__tests__.
const SCAN_DIRS = [
  'src/components',
  'src/stores',
  'src', // 仅顶层 App.tsx / main.tsx; 递归跳过 src/i18n 与 src/__tests__.
];
const SCAN_TOP_LEVEL_FILES = ['App.tsx', 'main.tsx']; // 在 src/ 下扫描的文件白名单
const EXTENSIONS = new Set(['.ts', '.tsx']);
// 连续两个以上 CJK 字符视为硬编码文本。
const CJK_PATTERN = /[\u3400-\u9fff]{2,}/g;
// JSX 文本节点中的 CJK, 例如 <div>中文</div> 或 <h2>中文标题</h2>.
// 捕获 > 后到 < 前的所有内容（不含 JSX 表达式）。
const JSX_TEXT_PATTERN = />([^<{]*?[\u3400-\u9fff]{2,}[^<]*?)</g;

/** 已知无害的"运行时拼接单位/技术字面量"，不视为硬编码 UI 文案. */
const RUNTIME_LITERAL_EXCEPTIONS = [
  /像素/,
];

/**
 * T18 静态键完整性校验. 覆盖 21 个命名空间的关键键 (≥50 个).
 * 保留 T17-P2 既有 8 键; 新增 outline/status/statusBar/recent/codeBlock/
 * search/shortcuts/theme/dialog/image/app/skipLink 的关键键.
 */
const REQUIRED_KEYS = [
  // T17-P2 既有 (保留)
  'settings.section.diagrams',
  'settings.mermaidEnable',
  'settings.mermaidDesc',
  'settings.katexEnable',
  'settings.katexDesc',
  'toast.mermaidBundleHint',
  'toast.mermaidLoadFailed',
  'fallback.mermaidError',
  // T18 新增 — outline / status / statusBar
  'outline.title',
  'outline.empty',
  'status.emptyTitle',
  'status.emptySubtitle',
  'status.emptyOpen',
  'status.loading',
  'status.retry',
  'status.errorUnknown',
  'statusBar.progressFmt',
  'statusBar.wordsLinesFmt',
  'statusBar.progressLabel',
  // T18 新增 — recent / codeBlock
  'recent.empty',
  'recent.clear',
  'recent.recordFailed',
  'recent.clearedToast',
  'recent.clearFailed',
  'recent.clearConfirmTitle',
  'recent.clearConfirmMessage',
  // T25 (F-27): recentDir namespace + tree additions.
  'recentDir.title',
  'recentDir.open',
  'recentDir.delete',
  'recentDir.clear',
  'recentDir.clearConfirm',
  'recentDir.deleteConfirm',
  'recentDir.clearedToast',
  'recentDir.clearFailedToast',
  'recentDir.deleteFailedToast',
  'recentDir.recordFailedToast',
  'recentDir.relative.justNow',
  'recentDir.relative.minutesAgo',
  'recentDir.relative.hoursAgo',
  'recentDir.relative.daysAgo',
  'recentDir.relative.weeksAgo',
  'tree.reselect',
  'tree.reselectConfirmTitle',
  'tree.reselectConfirmMsg',
  'tree.historySection',
  'tree.historyEmpty',
  'codeBlock.copy',
  'codeBlock.copySuccess',
  'codeBlock.copyFail',
  'codeBlock.fold',
  'codeBlock.unfold',
  // T18 新增 — search / shortcuts
  'search.placeholder',
  'search.countFmt',
  'search.optionGroupLabel',
  'search.caseSensitive',
  'search.wholeWord',
  'search.regex',
  'search.regexInvalid',
  'shortcuts.title',
  'shortcuts.intro',
  'shortcuts.close',
  'shortcuts.dontShowAgain',
  'shortcuts.doneAck',
  // T18 新增 — theme / dialog / image
  'theme.light',
  'theme.dark',
  'theme.system',
  'theme.groupLabel',
  'dialog.imageViewer.label',
  'dialog.imageViewer.close',
  'dialog.treeDrawer.label',
  'image.loadFail',
  // T18 新增 — app / skipLink / common
  'app.fontSizeMax',
  'app.fontSizeMin',
  'app.historyStart',
  'app.historyEnd',
  'app.progressCorrupted',
  'skipLink.label',
  'common.dropHint',
  'common.closeNotification',
  'common.externalOpened',
];

async function walk(dir, baseDir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    // R-39 修复: 统一把 rel 中的分隔符转成 POSIX '/', 否则 Windows 上
    // rel === 'src\\i18n' 与硬编码 'src/i18n' 不匹配, 会误进 i18n 字典
    // 目录, 扫描 zh-CN.ts 时报出 ~225 条假阳性 (CI 报 227 处).
    const rel = full.slice(ROOT.length + 1).split(sep).join('/');
    if (e.isDirectory()) {
      // T18 升级: 跳过 i18n 字典与 __tests__.
      if (rel === 'src/i18n' || rel.startsWith('src/i18n/')) continue;
      if (rel === 'src/__tests__' || rel.startsWith('src/__tests__/')) continue;
      if (e.name === '__tests__' || e.name === 'node_modules' || e.name.startsWith('.')) continue;
      out.push(...(await walk(full, baseDir)));
    } else if (e.isFile()) {
      // 在 src 根下只扫描白名单文件 (App.tsx + main.tsx), 跳过其它 .ts.
      const relParent = rel.split('/').slice(0, -1).join('/');
      if (relParent === 'src') {
        if (!SCAN_TOP_LEVEL_FILES.includes(e.name)) continue;
      }
      const dot = e.name.lastIndexOf('.');
      if (dot === -1) continue;
      const ext = e.name.slice(dot);
      if (EXTENSIONS.has(ext)) out.push(full);
    }
  }
  return out;
}

function isCommentLine(line) {
  const t = line.trim();
  return (
    t.startsWith('//') ||
    t.startsWith('*') ||
    t.startsWith('/*') ||
    t.startsWith('// i18n:') ||
    t.includes('// @i18n-ignore')
  );
}

/**
 * 扫描单个文件的硬编码 CJK 命中.
 * 同时扫描: 字符串字面量 + JSX 文本节点.
 *
 * R-38 修复: 跨行追踪 JSX 块注释的开闭.
 *   旧逻辑只检测行级 // 注释, 漏掉 JSX 内嵌块注释 (例如 CodeBlock.tsx L157
 *   的注释, 里面含 "复制" 等 CJK 字符), 导致误报. 现改为:
 *     - 维护 inJsxBlock 标志, 进入 [JSX-OPEN] 时打开, 遇到 [JSX-CLOSE] 时关闭.
 *     - 在 JSX 块注释内的行直接 skip.
 *   注意: 嵌套 JSX 块注释不被支持 (JSX 规范也不支持), 单层即可.
 *   标记说明: [JSX-OPEN] = 形如 left-curly slash-asterisk 的序列;
 *             [JSX-CLOSE] = 形如 asterisk slash right-curly 的序列.
 */
function findHits(content, filePath) {
  // R-39 修复: 提前把 filePath 转成 POSIX rel, 给 scanLineForHits 用.
  //   旧逻辑在文件里 endsWith('/i18n/zh-CN.ts') 硬编码 '/', Windows 上
  //   全部不匹配, 误进 i18n 字典目录扫出 ~225 条假阳性 (CI 报 227 处).
  const rel = toPosixRel(filePath);
  const hits = [];
  const lines = content.split('\n');
  let inJsxBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // R-38: 跨行 JSX 块注释状态机.
    if (inJsxBlock) {
      const closeIdx = line.indexOf('*/}');
      if (closeIdx === -1) continue;
      inJsxBlock = false;
      // 同一行关闭后, 关闭符之后的内容仍需扫描.
      const after = line.slice(closeIdx + 3);
      const tailHits = scanLineForHits(after, i + 1, rel);
      hits.push(...tailHits);
      continue;
    }
    // 检查是否进入新的 JSX 块注释.
    const openIdx = line.indexOf('{/*');
    if (openIdx !== -1) {
      // 同行内可能有 */} 关闭 (单行块注释).
      const closeIdx = line.indexOf('*/}', openIdx);
      if (closeIdx !== -1) {
        // 单行块注释, 跳过 {/* ... */} 之间的内容, 扫描前后.
        const before = line.slice(0, openIdx);
        const after = line.slice(closeIdx + 3);
        const beforeHits = scanLineForHits(before, i + 1, rel);
        const afterHits = scanLineForHits(after, i + 1, rel);
        hits.push(...beforeHits, ...afterHits);
        continue;
      }
      // 多行块注释开始, 扫描 {/* 之前的内容, 之后的内容在后续行检查.
      inJsxBlock = true;
      const before = line.slice(0, openIdx);
      const beforeHits = scanLineForHits(before, i + 1, rel);
      hits.push(...beforeHits);
      continue;
    }
    if (isCommentLine(line)) continue;
    // 跳过 i18n 字典本身 (zh-CN/en-US 必然含 CJK).
    // R-39 修复: 不再 endsWith 硬编码 '/', 改用 POSIX rel 段比较 (Windows 上 filePath 用 '\\').
    if (rel === 'src/i18n/zh-CN.ts' || rel === 'src/i18n/en-US.ts') continue;
    // 跳过英文文档/UI 测试 (rel 已是 POSIX 形式, 段检测即可).
    if (rel.includes('__tests__/') || rel.endsWith('/__tests__')) continue;
    hits.push(...scanLineForHits(line, i + 1, rel));
  }
  return hits;
}

/**
 * R-38: 单行硬编码 CJK 扫描. 抽出 findHits 主体, 便于跨行块注释复用.
 * 扫描两类硬编码:
 *   ① 字符串字面量中的连续 CJK (≥2 字符) → 视为硬编码 UI 文案.
 *   ② JSX 文本节点中含连续 CJK (≥2 字符) → 视为硬编码 UI 文案.
 */
function scanLineForHits(line, lineNum, filePath) {
  const hits = [];
  if (isCommentLine(line)) return hits;
  // R-39 修复: filePath 已是 POSIX rel (从 findHits 传进来), 不用再 endsWith('/').
  if (filePath === 'src/i18n/zh-CN.ts' || filePath === 'src/i18n/en-US.ts') return hits;
  if (filePath.includes('__tests__/') || filePath.endsWith('/__tests__')) return hits;
  // ① 字符串字面量中的 CJK
  const stringLiterals = line.match(/(['"`])(?:\\.|(?!\1).)*\1/g) ?? [];
  for (const lit of stringLiterals) {
    if (CJK_PATTERN.test(lit)) {
      if (RUNTIME_LITERAL_EXCEPTIONS.some((rx) => rx.test(lit))) {
        CJK_PATTERN.lastIndex = 0;
        continue;
      }
      hits.push({ line: lineNum, text: lit, source: line.trim(), kind: 'literal' });
      CJK_PATTERN.lastIndex = 0;
    }
  }
  // ② JSX 文本节点中的 CJK (例如 <h2>中文</h2>).
  JSX_TEXT_PATTERN.lastIndex = 0;
  let m;
  while ((m = JSX_TEXT_PATTERN.exec(line)) !== null) {
    const text = m[1].trim();
    if (text.length === 0) continue;
    if (CJK_PATTERN.test(text)) {
      CJK_PATTERN.lastIndex = 0;
      hits.push({ line: lineNum, text: JSON.stringify(text), source: line.trim(), kind: 'jsx-text' });
    }
  }
  return hits;
}

/**
 * 收集字典文件中所有点路径 key (如 'outline.title', 'dialog.imageViewer.label').
 * 用于报告字典真实具备的键集合, 配合 REQUIRED_KEYS 输出更可读的统计.
 */
function collectDictKeys(obj, prefix = '', out = new Set()) {
  if (!obj || typeof obj !== 'object') return out;
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.add(path);
    else if (v && typeof v === 'object') collectDictKeys(v, path, out);
  }
  return out;
}

async function main() {
  const zhCNPath = join(ROOT, 'src/i18n/zh-CN.ts');
  const enUSPath = join(ROOT, 'src/i18n/en-US.ts');
  let zhCNContent = '';
  let enUSContent = '';
  try {
    zhCNContent = await readFile(zhCNPath, 'utf8');
    enUSContent = await readFile(enUSPath, 'utf8');
  } catch (err) {
    console.error('[hardcode] cannot read i18n files:', err.message);
    process.exit(2);
  }

  /**
   * 把 'a.b.c' 转成两种字面量形式:
   * ① 点路径 'a.b.c' (react-i18next 接受).
   * ② 末段 'c' (嵌套对象写法 'c:' 会在 zh-CN.ts / en-US.ts 出现).
   */
  function keyVariants(dottedKey) {
    const parts = dottedKey.split('.');
    const variants = [dottedKey];
    if (parts.length > 1) {
      variants.push(parts[parts.length - 1]);
    }
    return variants;
  }

  const missing = [];
  for (const key of REQUIRED_KEYS) {
    const variants = keyVariants(key);
    const hasInZh = variants.some((v) => zhCNContent.includes(v));
    const hasInEn = variants.some((v) => enUSContent.includes(v));
    if (!hasInZh) missing.push(`zh-CN 缺 key: ${key}`);
    if (!hasInEn) missing.push(`en-US 缺 key: ${key}`);
  }
  if (missing.length > 0) {
    console.error('[hardcode] T18 i18n keys 缺失:');
    for (const m of missing) console.error('  -', m);
    process.exit(1);
  }

  // 命名空间统计 (OK 行使用)
  const zhKeys = collectDictKeys(parseExportObject(zhCNContent));
  const enKeys = collectDictKeys(parseExportObject(enUSContent));
  const namespaces = new Set();
  for (const k of zhKeys) namespaces.add(k.split('.')[0]);

  let total = 0;
  const files = [];
  for (const sub of SCAN_DIRS) {
    const abs = join(ROOT, sub);
    const list = await walk(abs, sub);
    files.push(...list);
  }
  if (files.length === 0) {
    console.error('[hardcode] 扫描目录为空, 环境异常.');
    process.exit(2);
  }
  for (const f of files) {
    const content = await readFile(f, 'utf8');
    const hits = findHits(content, f);
    if (hits.length) {
      console.error(`\n[hardcode] ${f.slice(ROOT.length + 1)}`);
      for (const h of hits) {
        console.error(`  L${h.line} (${h.kind}): ${h.text}  ← in: ${h.source.slice(0, 120)}`);
        total++;
      }
    }
  }
  if (total > 0) {
    console.error(
      `\n[hardcode] 全量 UI 文件发现 ${total} 处硬编码 CJK 字符串，请改用 t('namespace.key') 包裹。`,
    );
    process.exit(1);
  }
  console.log(
    `[hardcode] OK: 全量 UI 文件无新硬编码 UI 文本；${
      namespaces.size
    } 个命名空间 ${REQUIRED_KEYS.length}+ key 在双语文件齐备。`,
  );
}

/**
 * 极简解析: 从 zh-CN.ts / en-US.ts 文本中提取 zhCN / enUS 对象字面量.
 * 因为字典结构稳定 (`export const xxx = { ... } as const`), 用正则匹配
 * 花括号配对, 提取后用 eval 转为对象 (仅脚本内部使用).
 * 这样可以拿到完整的嵌套结构, 配合 collectDictKeys 产出命名空间统计.
 */
function parseExportObject(content) {
  const m = content.match(/export const \w+ = (\{[\s\S]*?\}) as const;/);
  if (!m) return {};
  try {
    // 间接 eval, 避免 'use strict' 下的直接 eval 限制.
    const fn = new Function('return (' + m[1] + ')');
    return fn();
  } catch {
    return {};
  }
}

main().catch((err) => {
  console.error('[hardcode] 脚本异常:', err);
  process.exit(2);
});
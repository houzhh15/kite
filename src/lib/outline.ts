/**
 * src/lib/outline.ts — Markdown 标题抽取 (T09 / F-10 / FR-01).
 *
 * 设计依据: docs/design/compiled.md §3.1.
 *
 * 责任:
 *   - 提供**纯函数** `extractOutline(markdown) => OutlineItem[]`, 供
 *     `useMarkdownOutline` 与单元测试共用 (NFR-TEST-1).
 *   - 复用 `lib/inline/slugify` 实现 slug 化 (C-7 / 单一 slugify 实现).
 *   - 封装「重名 disambiguation」逻辑 (AC-01-3), 用 `slugifyWithCounter` 暴露.
 *   - 代码块围栏内行不识别为标题 (AC-01-2).
 *   - h7+ 静默忽略 (FR-01).
 *
 * 算法 (设计 §3.1.3):
 *   1. 按 `\n` 切分, 保留 1-based 行号.
 *   2. 维护 `inFence: boolean` 状态机: ```` ``` ```` 或 `~~~` 翻转.
 *   3. 行正则 `/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/`; h1..h6 命中即抽取.
 *   4. id = `slugifyWithCounter(text, seenIds)`; 同一文本第二次出现为 `text-1`.
 *
 * 纯函数; 不依赖 React / DOM; 可在 Node 单测中直接执行.
 */

import { slugify } from './inline/slugify';

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface OutlineItem {
  /** slug 化后且全文档唯一 (含 `-n` 后缀). */
  id: string;
  level: HeadingLevel;
  /** 去除行尾 `#` 与前后空白后的纯文本. */
  text: string;
  /** 1-based 源行号. */
  line: number;
}

export interface ExtractOptions {
  /** 已存在的 id 集合 (跨调用累计去重). 默认 undefined 视为空集合. */
  seedIds?: ReadonlySet<string>;
}

const HEADING_REGEX = /^ {0,3}(#{1,6})\s+(.+?)\s*$/;
// ``` ``` 或 ~~~ ~~~ (围栏). 至少 3 个反引号或波浪号.
const FENCE_REGEX = /^(```+|~~~+)/;

/**
 * extractOutline — 把 Markdown 源串抽取为 OutlineItem 数组.
 *
 * 契约:
 *   - 输入 `""` -> 返回 `[]`, 永不抛 (AC-01-4).
 *   - 输入不含 `#` 标题行 -> 返回 `[]` (AC-01-5).
 *   - 代码块围栏内行不识别 (AC-01-2).
 *   - 同一文本出现 N 次 -> ids 为 `slug`, `slug-1`, `slug-2`, ... (AC-01-3).
 *   - h7+ 静默忽略, 不抛.
 *
 * @param markdown utf-8 Markdown 源串.
 * @param options 可选; `seedIds` 用于跨文档累计去重 (本任务内通常不传).
 */
export function extractOutline(
  markdown: string,
  options?: ExtractOptions,
): OutlineItem[] {
  if (typeof markdown !== 'string' || markdown.length === 0) return [];

  const seen = new Set<string>(options?.seedIds ? Array.from(options.seedIds) : undefined);
  const out: OutlineItem[] = [];
  let inFence = false;
  let fenceMarker = ''; // 用于记录当前围栏的反引号/波浪号前缀字符.

  const lines = markdown.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const lineNumber = i + 1;

    // 围栏检测优先于标题检测: 即使 ``` 行本身像 `# ````, 也按围栏处理.
    const fenceMatch = FENCE_REGEX.exec(line);
    if (fenceMatch && fenceMatch[1]) {
      const marker = fenceMatch[1];
      const ch = marker[0];
      if (!inFence) {
        inFence = true;
        fenceMarker = ch;
      } else if (ch === fenceMarker) {
        inFence = false;
        fenceMarker = '';
      }
      continue;
    }

    if (inFence) continue;

    const m = HEADING_REGEX.exec(line);
    if (!m) continue;
    const hashes = m[1];
    const text = m[2];
    if (!hashes || !text) continue;
    const level = hashes.length;
    if (level < 1 || level > 6) continue;

    const trimmedText = stripTrailingHashes(text.trim());
    const id = slugifyWithCounter(trimmedText, seen);
    out.push({ id, level: level as HeadingLevel, text: trimmedText, line: lineNumber });
  }

  return out;
}

/**
 * stripTrailingHashes — 剥离 ATX 标题行尾的 ` #` 关闭序列 (CommonMark §4.2).
 *
 * 规则: 仅当尾部是连续的 `#` 且前面至少一个空格时才剥离.
 *   - `Hello` -> `Hello` (无变化)
 *   - `Hello ###` -> `Hello`
 *   - `Hello###` -> `Hello###` (无空隙, 不剥离)
 *   - `Hello ## #` -> `Hello ## #` (不是纯 # 收尾, 不剥离)
 */
function stripTrailingHashes(text: string): string {
  // 末尾形如 " ###" (任意空格 + 至少 1 个 #) 才算关闭.
  const m = /^(.*?)\s+(#+)$/.exec(text);
  if (m && m[1] && m[2]) {
    return m[1];
  }
  return text;
}

/**
 * slugifyWithCounter — 复用 slugify + 处理重名.
 *
 *   - 第一次出现返回 base slug.
 *   - 第二次返回 `${base}-1`, 第三次 `${base}-2`, 以此类推.
 *   - 空文本返回 `""` (调用方按需过滤).
 *   - 不修改传入的 seen (采用递增 Set: seen 内含 base 与所有 `${base}-n`).
 */
export function slugifyWithCounter(text: string, seen: Set<string>): string {
  const base = slugify(text);
  if (base.length === 0) return '';
  if (!seen.has(base)) {
    seen.add(base);
    return base;
  }
  let n = 1;
  let candidate = `${base}-${n}`;
  while (seen.has(candidate)) {
    n += 1;
    candidate = `${base}-${n}`;
  }
  seen.add(candidate);
  return candidate;
}

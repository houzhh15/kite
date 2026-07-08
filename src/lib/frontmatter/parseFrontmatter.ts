/**
 * src/lib/frontmatter/parseFrontmatter.ts — T26 (F-28) YAML 子集解析器.
 *
 * 设计依据: docs/design/compiled.md §3.3 + 需求 FR-1 / FR-4 / FR-5.
 *
 * 范围 (仅为顶层子集):
 *   - 严格 --- 分隔对 (拒绝 *** / ··· 等替代分隔符).
 *   - 顶层标量: string / number / bool / null (YAML 1.2 子集).
 *   - 一级 flow 数组: [a, b, "c, c"].
 *   - 一级 block 数组: key: + 缩进 - 条目.
 *   - 注释行: # 或 # xxx.
 *   - 嵌套对象按字符串原样保留 (不递归解析).
 *   - BOM 剥离 + CRLF/CR 归一化.
 *
 * 防御:
 *   - MAX_FRONT_LINES = 200 (前 N 行扫描保护).
 *   - 任何异常统一抛 FrontmatterParseError, 文案不含原始文件内容.
 *
 * 算法: O(n) 单趟扫. 不用 eval / new Function / vm.
 */

import {
  FrontmatterParseError,
  type FrontmatterMeta,
  type FrontmatterScalar,
  type ParseFrontmatterResult,
} from './types';

const MAX_FRONT_LINES = 200;
const NUMBER_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/** 严格匹配分隔符行: 整行只有 --- + 可选尾随空白. 不允许前导空白. */
function isFenceLine(line: string): boolean {
  return /^---[ \t]*$/.test(line);
}

/** 剥离 BOM (\uFEFF). 仅最前. */
function stripBom(s: string): string {
  return s.length > 0 && s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** 行尾归一: \r\n → \n; 单独 \r → \n. */
function normalizeEol(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 13) {
      out += '\n';
      if (i + 1 < s.length && s.charCodeAt(i + 1) === 10) i++;
    } else if (c === 10) {
      out += '\n';
    } else {
      out += s.charAt(i);
    }
  }
  return out;
}

/** 双引号 unquote: 处理 \" \\ \n \t \uXXXX. */
function unquoteDouble(s: string): string {
  if (s.length < 2 || s.charAt(0) !== '"' || s.charAt(s.length - 1) !== '"') {
    return s;
  }
  let out = '';
  let i = 1;
  const end = s.length - 1;
  while (i < end) {
    const c = s.charAt(i);
    if (c === '\\' && i + 1 < end) {
      const n = s.charAt(i + 1);
      if (n === 'n') out += '\n';
      else if (n === 't') out += '\t';
      else if (n === 'r') out += '\r';
      else if (n === '"') out += '"';
      else if (n === '\\') out += '\\';
      else if (n === '/') out += '/';
      else if (n === 'u' && i + 5 < end) {
        const hex = s.slice(i + 2, i + 6);
        const cp = parseInt(hex, 16);
        if (!Number.isNaN(cp)) {
          out += String.fromCharCode(cp);
          i += 4;
        } else {
          out += n;
        }
      } else {
        out += n;
      }
      i += 2;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** YAML 单引号 unquote: 连续两个 '' → 一个 '. */
function unquoteSingle(s: string): string {
  if (s.length < 2 || s.charAt(0) !== "'" || s.charAt(s.length - 1) !== "'") {
    return s;
  }
  const inner = s.slice(1, -1);
  let out = '';
  let i = 0;
  while (i < inner.length) {
    if (inner.charAt(i) === "'" && i + 1 < inner.length && inner.charAt(i + 1) === "'") {
      out += "'";
      i += 2;
    } else {
      out += inner.charAt(i);
      i++;
    }
  }
  return out;
}

/** 标量解析: 引号/转义/null/bool/number/string. */
function parseScalarValue(raw: string): FrontmatterScalar {
  const s = raw.trim();
  if (s.length === 0) return null;
  if (s.charAt(0) === '"' && s.charAt(s.length - 1) === '"') {
    return unquoteDouble(s);
  }
  if (s.charAt(0) === "'" && s.charAt(s.length - 1) === "'") {
    return unquoteSingle(s);
  }
  if (s === 'null' || s === '~' || s === 'Null' || s === 'NULL') return null;
  if (s === 'true' || s === 'True' || s === 'TRUE' || s === 'yes' || s === 'Yes' || s === 'YES')
    return true;
  if (s === 'false' || s === 'False' || s === 'FALSE' || s === 'no' || s === 'No' || s === 'NO')
    return false;
  if (NUMBER_RE.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) return n;
  }
  return s;
}

/**
 * 扫描值字符串中的 { } 配对, 跳过 " 与 '.
 * 返回 start 到 配对结尾 (含尾字符) 的字符串; 若未闭合返回 null.
 */
function matchBraces(s: string, openIdx: number, open: '{' | '['): string | null {
  let depth = 0;
  let inDouble = false;
  let inSingle = false;
  const close = open === '{' ? '}' : ']';
  for (let i = openIdx; i < s.length; i++) {
    const c = s.charAt(i);
    if (!inDouble && !inSingle && c === '"') inDouble = true;
    else if (!inDouble && !inSingle && c === "'") inSingle = true;
    else if (inDouble && c === '"') inDouble = false;
    else if (inSingle && c === "'") {
      if (i + 1 < s.length && s.charAt(i + 1) === "'") i++;
      else inSingle = false;
    } else if (!inDouble && !inSingle) {
      if (c === open) depth++;
      else if (c === close) {
        depth--;
        if (depth === 0) return s.slice(openIdx, i + 1);
      }
    }
  }
  return null;
}

/**
 * 解析 flow 数组元素.
 * input: "..." 或 '...' 或 普通字符串 (含逗号会被进一步处理).
 * 返回 unquoted 字符串.
 */
function unquoteMaybe(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && t.charAt(0) === '"' && t.charAt(t.length - 1) === '"')
    return unquoteDouble(t);
  if (t.length >= 2 && t.charAt(0) === "'" && t.charAt(t.length - 1) === "'")
    return unquoteSingle(t);
  return t;
}

/**
 * 解析 flow 数组 - 输入是单个完整 [ ... ] 字符串.
 */
function parseFlowArray(s: string): string[] {
  const matched = matchBraces(s, 0, '[');
  if (matched === null) {
    throw new FrontmatterParseError(
      'nested-unterminated',
      'flow array brackets not closed',
    );
  }
  const inner = matched.slice(1, -1).trim();
  if (inner.length === 0) return [];

  // 顶层按 ',' 分隔, 跳过引号内字符.
  const items: string[] = [];
  let buf = '';
  let inDouble = false;
  let inSingle = false;
  let depthSquare = 0;
  let depthBrace = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner.charAt(i);
    if (!inDouble && !inSingle && c === '"') {
      inDouble = true;
      buf += c;
    } else if (!inDouble && !inSingle && c === "'") {
      inSingle = true;
      buf += c;
    } else if (inDouble && c === '"') {
      inDouble = false;
      buf += c;
    } else if (inSingle && c === "'") {
      if (i + 1 < inner.length && inner.charAt(i + 1) === "'") {
        buf += "''";
        i++;
      } else {
        inSingle = false;
        buf += c;
      }
    } else if (!inDouble && !inSingle) {
      if (c === '[') depthSquare++;
      else if (c === ']') depthSquare--;
      else if (c === '{') depthBrace++;
      else if (c === '}') depthBrace--;
      else if (c === ',' && depthSquare === 0 && depthBrace === 0) {
        items.push(buf.trim());
        buf = '';
        continue;
      }
      buf += c;
    } else {
      buf += c;
    }
  }
  if (buf.trim().length > 0) items.push(buf.trim());
  return items.map(unquoteMaybe);
}

/**
 * 将原始 frontmatter 行数组 (从 key: 后开始) 与可能的 block 数组 / 嵌套对象值
 * 一起解析, 返回 (value, nextStartIdx).
 *
 * 优先匹配规则:
 *   - 空值 + 下一行为缩进 (开始为 ' ' 或 '\t'): block 数组.
 *   - 行内 flow 数组完整闭合: 直接按 flow 处理.
 *   - 行内 `{ ... }` 完整闭合: 嵌套对象按字符串原样.
 *   - 否则: 标量值.
 */
function parseEntryValue(
  lines: string[],
  startIdx: number,
  endIndex: number,
  rawValueHead: string,
): { value: FrontmatterScalar | string[]; nextIdx: number } | { nested: string; nextIdx: number } | null {
  // 行内块: rawValueHead 可能是 "", "[...]", "{...}", scalar 等.
  const trimmedHead = rawValueHead.trim();

  // 1) 行内 flow 数组
  if (trimmedHead.charAt(0) === '[') {
    // 如果本行未闭合 → 拼接多行寻找闭合
    let combined = rawValueHead.trim();
    let extra = 0;
    while (matchBraces(combined, 0, '[') === null && startIdx + extra + 1 < endIndex) {
      extra++;
      combined += '\n' + lines[startIdx + extra];
    }
    try {
      const arr = parseFlowArray(combined);
      return { value: arr, nextIdx: startIdx + extra + 1 };
    } catch {
      return null;
    }
  }

  // 2) 行内嵌套对象 - 整体保留为字符串
  if (trimmedHead.charAt(0) === '{') {
    // 尝试单行闭合
    const matched = matchBraces(trimmedHead, 0, '{');
    if (matched !== null) {
      return { nested: matched, nextIdx: startIdx + 1 };
    }
    // 多行嵌套
    let combined = rawValueHead.trim();
    let extra = 0;
    while (matchBraces(combined, 0, '{') === null && startIdx + extra + 1 < endIndex) {
      extra++;
      combined += '\n' + lines[startIdx + extra];
    }
    const m = matchBraces(combined, 0, '{');
    if (m === null) {
      // 嵌套未闭合 → 抛错 (视为解析失败)
      throw new FrontmatterParseError('nested-unterminated', 'nested object not closed');
    }
    return { nested: m, nextIdx: startIdx + extra + 1 };
  }

  // 3) 空值: 试 block 数组
  if (trimmedHead.length === 0) {
    const nextIdx = startIdx + 1;
    if (nextIdx >= endIndex) return null;
    const next = lines[nextIdx];
    // 必须是缩进 (空格或 tab 起始) 才视为 block 数组
    if (
      next.length > 0 &&
      (next.charCodeAt(0) === 32 || next.charCodeAt(0) === 9)
    ) {
      const blockValues: string[] = [];
      let j = nextIdx;
      while (j < endIndex) {
        const ln = lines[j];
        if (ln.trim().length === 0) {
          j++;
          continue;
        }
        if (ln.charCodeAt(0) !== 32 && ln.charCodeAt(0) !== 9) break;
        let v = ln.trim();
        // 去掉前缀 '- '
        if (v.charAt(0) === '-') v = v.slice(1).trim();
        blockValues.push(v);
        j++;
      }
      if (blockValues.length > 0) {
        return { value: blockValues, nextIdx: j };
      }
    }
    return null;
  }

  // 4) 普通标量
  return { value: parseScalarValue(rawValueHead), nextIdx: startIdx + 1 };
}

/**
 * 解析文档顶部 frontmatter 块.
 *
 * 入口约束 (设计 §3.3.1):
 *   - BOM 已剥离 + 行尾已归一化.
 *   - 首字符必须为 '-' (严格 --- 起首), 否则视为无 frontmatter 直接返回原 body.
 *   - 仅识别严格 '---' (任务约束 #3, 拒绝 *** / ···).
 */
export function parseFrontmatter(raw: string): ParseFrontmatterResult {
  try {
    if (typeof raw !== 'string') {
      throw new FrontmatterParseError('invalid-syntax', 'input not a string');
    }
    const normalized = normalizeEol(stripBom(raw));
    if (normalized.length === 0) {
      return { meta: {}, body: raw };
    }
    if (normalized.charAt(0) !== '-') {
      return { meta: {}, body: raw };
    }
    const lines = normalized.split('\n');
    if (lines.length === 0) return { meta: {}, body: raw };

    if (!isFenceLine(lines[0])) {
      return { meta: {}, body: raw };
    }

    // 找闭合
    let endIndex = -1;
    const max = Math.min(lines.length, MAX_FRONT_LINES);
    for (let i = 1; i < max; i++) {
      if (isFenceLine(lines[i])) {
        endIndex = i;
        break;
      }
    }
    if (endIndex === -1) {
      throw new FrontmatterParseError(
        'no-closing-fence',
        'frontmatter open fence not closed',
      );
    }

    // 解析 frontmatter entries.
    const meta: FrontmatterMeta = {};
    let i = 1;
    while (i < endIndex) {
      const line = lines[i];
      // 跳过空行 / 注释行
      if (line.trim().length === 0 || /^\s*#/.test(line)) {
        i++;
        continue;
      }
      // 找第一个 ':' (字符串外)
      let colonIdx = -1;
      {
        let inDouble = false;
        let inSingle = false;
        for (let k = 0; k < line.length; k++) {
          const c = line.charAt(k);
          if (!inDouble && !inSingle && c === '"') inDouble = true;
          else if (!inDouble && !inSingle && c === "'") inSingle = true;
          else if (inDouble && c === '"') inDouble = false;
          else if (inSingle && c === "'") {
            if (k + 1 < line.length && line.charAt(k + 1) === "'") k++;
            else inSingle = false;
          } else if (!inDouble && !inSingle && c === ':') {
            colonIdx = k;
            break;
          }
        }
      }
      if (colonIdx === -1) {
        // 非 key:value — 跳过
        i++;
        continue;
      }
      const key = line.slice(0, colonIdx).trim();
      const rawValue = line.slice(colonIdx + 1);

      // 空值 → 让 parseEntryValue 走 block 数组检测路径 (FR-1 不入 meta 仅适用真正空文档).
      if (key.length === 0) {
        i++;
        continue;
      }

      const parsed = parseEntryValue(lines, i, endIndex, rawValue);
      if (parsed === null) {
        i++;
        continue;
      }
      if ('nested' in parsed) {
        meta[key] = parsed.nested;
      } else {
        meta[key] = parsed.value;
      }
      i = parsed.nextIdx;
    }

    const body = lines.slice(endIndex + 1).join('\n');
    return { meta, body };
  } catch (err) {
    if (err instanceof FrontmatterParseError) throw err;
    throw new FrontmatterParseError('invalid-syntax', 'unexpected parse error');
  }
}

/** 类型守卫 re-export — 便于调用方直接 import. */
export { FrontmatterParseError };
export type { FrontmatterMeta, FrontmatterScalar };

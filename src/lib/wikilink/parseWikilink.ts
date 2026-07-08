/**
 * parseWikilink — Obsidian 风格 wikilink 语法解析 (F-29 / FR-01).
 *
 * 设计依据: docs/design/compiled.md §3.1.
 *
 * 支持的语法 (4 种):
 *   - [[target]]
 *   - [[target|alias]]
 *   - [[target#anchor]]
 *   - [[target#anchor|alias]]
 *
 * 字符白名单 (isValidTarget):
 *   - 允许: Unicode 字母 (\p{L})、数字 (\p{N})、`/`、`-`、`_`、`.`、空格
 *   - 长度: ≤ 512 字符
 *   - 拒绝: 控制字符、`\`、`:` (URL scheme 注入防护)
 *
 * 解析层**不**拒绝路径穿越 (例如 `../../../etc/passwd`),
 * 路径校验由 `resolveWikilinkTarget` 网关拦截 (NFR-05 / AC-02-4).
 *
 * 纪律:
 *   - 纯函数; 无副作用; 不依赖 React / store / IPC.
 *   - 不引入第三方库 (F-31 / F-32).
 */

export interface ParsedWikilink {
  /** vault 相对路径 (不含 `#` 之后、不含 `.md` 后缀、不含 `|` 之后). */
  target: string;
  /** 锚点 (未 slug 化, 调用方决定是否 slug). */
  anchor?: string;
  /** 别名 (显示文本, 可选). */
  alias?: string;
}

/** 单次解析允许的最大字符数 (防御超长 payload). */
export const PARSE_WIKILINK_MAX_LENGTH = 512;

/**
 * 字符白名单校验 — `target` 是否合法.
 *
 * 规则:
 *   - 长度: 1..512
 *   - 允许: Unicode 字母 / 数字 / `/` / `-` / `_` / `.` / 空格
 *   - 拒绝: 反斜杠、冒号、控制字符
 */
export function isValidTarget(target: string): boolean {
  if (typeof target !== 'string' || target.length === 0) return false;
  if (target.length > PARSE_WIKILINK_MAX_LENGTH) return false;
  // 拒绝反斜杠 / 冒号 / 控制字符
  if (/[\\\u0000-\u001f\u007f]/.test(target)) return false;
  if (target.includes(':')) return false;
  // 允许: \p{L} \p{N} / - _ . 空格 | (管道仅用于内部 alias 切分的容错, 解析层不阻拦)
  // eslint-disable-next-line no-misleading-character-class
  return /^[\p{L}\p{N}\/_\-.\s|]+$/u.test(target);
}

/**
 * parseWikilink — 入口.
 *
 * @param raw `[[...]]` 形式字符串
 * @returns 解析结果或 null (非 wikilink)
 *
 * 边界处理:
 *   - 长度 < 4 或不以 `[[` 开头或不以 `]]` 结尾 → null
 *   - `[[]]` / `[[|]]` → null
 *   - target 为空 (`[[#anchor]]`) → null
 *   - target 字符白名单不通过 → null
 *   - `[[foo#]]` / `[[foo#|alias]]` → anchor 视为 undefined
 *   - 多重 `|` 取最后一次切分 (容错: alias 取最后一个 `|` 之后)
 */
export function parseWikilink(raw: string): ParsedWikilink | null {
  if (typeof raw !== 'string') return null;
  if (raw.length < 4) return null;
  if (!raw.startsWith('[[')) return null;
  if (!raw.endsWith(']]')) return null;

  const inner = raw.slice(2, -2);
  if (inner.length === 0) return null;
  if (inner === '|') return null;

  // 多重 '|' 取最后一次切分 (alias 兼容性容错)
  const lastPipe = inner.lastIndexOf('|');
  let targetPart: string;
  let alias: string | undefined;
  if (lastPipe >= 0) {
    targetPart = inner.slice(0, lastPipe).trim();
    const a = inner.slice(lastPipe + 1).trim();
    alias = a.length > 0 ? a : undefined;
  } else {
    targetPart = inner.trim();
    alias = undefined;
  }

  // '#' 切分 target / anchor
  let target: string;
  let anchor: string | undefined;
  const hashIdx = targetPart.indexOf('#');
  if (hashIdx >= 0) {
    target = targetPart.slice(0, hashIdx).trim();
    const a = targetPart.slice(hashIdx + 1).trim();
    anchor = a.length > 0 ? a : undefined;
  } else {
    target = targetPart;
    anchor = undefined;
  }

  if (target.length === 0) return null;
  if (!isValidTarget(target)) return null;

  const out: ParsedWikilink = { target };
  if (alias !== undefined) out.alias = alias;
  if (anchor !== undefined) out.anchor = anchor;
  return out;
}

export default parseWikilink;

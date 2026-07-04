/**
 * src/lib/inline/deburrLite.ts — 极简 NFKD + 去音标 (替代 lodash.deburr).
 *
 * 仅用于 slugify; 不导出 unicode 表全集, 覆盖拉丁扩展 / 拉丁附加常用音标即可.
 * 中文字符在 NFKD 下不变, 因此对中文输入是 identity.
 *
 * 设计依据: docs/design/compiled.md §3.3.2 中文保留策略.
 */

/** 拉丁字母 + 重音字符 → ASCII 字母的映射 (slugify 用). */
const DEBURR_MAP: Record<string, string> = {
  'ª': 'a',
  'º': 'o',
  'À': 'A',
  'Á': 'A',
  'Â': 'A',
  'Ã': 'A',
  'Ä': 'A',
  'Å': 'A',
  'Æ': 'AE',
  'Ç': 'C',
  'È': 'E',
  'É': 'E',
  'Ê': 'E',
  'Ë': 'E',
  'Ì': 'I',
  'Í': 'I',
  'Î': 'I',
  'Ï': 'I',
  'Ð': 'D',
  'Ñ': 'N',
  'Ò': 'O',
  'Ó': 'O',
  'Ô': 'O',
  'Õ': 'O',
  'Ö': 'O',
  'Ø': 'O',
  'Ù': 'U',
  'Ú': 'U',
  'Û': 'U',
  'Ü': 'U',
  'Ý': 'Y',
  'Þ': 'Th',
  'ß': 'ss',
  'à': 'a',
  'á': 'a',
  'â': 'a',
  'ã': 'a',
  'ä': 'a',
  'å': 'a',
  'æ': 'ae',
  'ç': 'c',
  'è': 'e',
  'é': 'e',
  'ê': 'e',
  'ë': 'e',
  'ì': 'i',
  'í': 'i',
  'î': 'i',
  'ï': 'i',
  'ð': 'd',
  'ñ': 'n',
  'ò': 'o',
  'ó': 'o',
  'ô': 'o',
  'õ': 'o',
  'ö': 'o',
  'ø': 'o',
  'ù': 'u',
  'ú': 'u',
  'û': 'u',
  'ü': 'u',
  'ý': 'y',
  'þ': 'th',
  'ÿ': 'y',
};

/** deburr — 用查表替换; 未命中字符保持原值 (中文等非拉丁字符). */
export function deburr(input: string): string {
  let out = '';
  for (const ch of input) {
    const mapped = DEBURR_MAP[ch];
    out += mapped ?? ch;
  }
  return out;
}
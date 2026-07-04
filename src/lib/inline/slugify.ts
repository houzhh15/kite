/**
 * src/lib/inline/slugify.ts — 锚点 id 生成 (契约 2 / 设计 §3.3.2).
 *
 * 设计依据: docs/design/compiled.md §3.3.2 + §3.8 契约 2 + C-07.
 *
 * 责任:
 *   - 把标题文本转换为 HTML 锚点 id.
 *   - 与 F-10 目录共用单一实现 (C-07).
 *   - 小写 + 空格转 `-` + 去除非字母数字.
 *   - 中文标题: NFKD + 去音标后保留 unicode 小写形式 (不引 Pinyin).
 *
 * 行为约定:
 *   - 'Quick Start'  → 'quick-start'
 *   - '安装指南'       → '安装指南' (NFKD 不分解中文)
 *   - '   ' / '!@#'   → ''   (空字符串表示未匹配)
 */

import { deburr } from './deburrLite';

/**
 * slugify — 入口.
 */
export function slugify(input: string): string {
  if (typeof input !== 'string' || input.length === 0) return '';

  // NFKD + 去音标 → 中文不变, 西文重音字符折叠
  let s = deburr(input).normalize('NFKD');

  // 去控制字符 + 转小写
  // 我们保留 unicode 字母 (中文 / 拉丁扩展), 只去掉 ASCII 不可打印 + 标点.
  // 空白 → '-'
  s = s.replace(/\s+/g, '-');

  // 非 [字母数字_-] 删除 (Unicode 字母正则: \p{L}; 数字: \p{N})
  // 使用 u flag.
  s = s.replace(/[^\p{L}\p{N}\-_]/gu, '');

  // 转小写 (包含中文)
  s = s.toLowerCase();

  // 折叠重复 '-'
  s = s.replace(/-+/g, '-');

  // 修剪首尾 '-'
  s = s.replace(/^-+|-+$/g, '');

  return s;
}
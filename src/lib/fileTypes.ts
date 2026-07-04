/**
 * fileTypes — 路径白名单 + 纯函数 (F-02 / 设计 §3.3 接口 2/3/4).
 *
 * 设计依据: docs/design/compiled.md §3.3 + docs/plan/compiled.md Step 1.
 *
 * 纪律:
 *   - 纯函数, 不持有任何可变状态, 不调用 IPC.
 *   - 拒绝 file:// 协议前缀 (NFR-02-3, 防 R-02 SSRF 残留).
 *   - 大小写不敏感命中; 命中时返回原 path (保留大小写供 basename 推导).
 *   - 单元测试见 fileTypes.test.ts (设计 §4.4 测试矩阵).
 */

/** KITE 接受的 Markdown 扩展名白名单. */
export const MARKDOWN_EXTENSIONS: readonly string[] = ['.md', '.markdown', '.mdx'];

/** basename helper — 同时处理 POSIX ('/') 与 Windows ('\\') 分隔符. */
function basename(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i >= 0 ? p.slice(i + 1) : p;
}

/** 提取扩展名 (含点号, 小写). 无法识别时返回空串. */
function extractExt(path: string): string {
  const last = basename(path);
  const dot = last.lastIndexOf('.');
  if (dot <= 0) return '';
  return last.slice(dot).toLowerCase();
}

/**
 * isMarkdownPath — 判断单个路径是否命中白名单.
 *
 * 规则:
 *   - 非 string / 空串 → false (类型防御, 防 R-01 注入).
 *   - 以 `file://` 开头 → false (NFR-02-3).
 *   - 扩展名在 MARKDOWN_EXTENSIONS 中 → true (大小写不敏感).
 */
export function isMarkdownPath(path: string): boolean {
  if (typeof path !== 'string' || path.length === 0) return false;
  if (path.startsWith('file://')) return false;
  return (MARKDOWN_EXTENSIONS as readonly string[]).includes(extractExt(path));
}

/**
 * pickMarkdownPath — 多文件场景下, 挑出第一个 Markdown 候选.
 *
 * 规则:
 *   - 非数组 → null.
 *   - 跳过非 string / 空串 / file:// 前缀.
 *   - 命中白名单 → 返回**原 path** (保留大小写).
 *   - 全部不命中或数组为空 → null.
 *
 * 现状: 多文件命中第一个 .md (设计 §3.5 决议); 后续 F-02b 多文件批量
 *       时再扩展为返回数组.
 */
export function pickMarkdownPath(paths: readonly string[]): string | null {
  if (!Array.isArray(paths)) return null;
  for (const p of paths) {
    if (isMarkdownPath(p)) return p;
  }
  return null;
}

/** pickMarkdownPath 失败时, 拼装面向用户的扩展名提示. */
export function describeAcceptedExts(): string {
  return MARKDOWN_EXTENSIONS.map((e) => e.slice(1)).join(' / ');
}

/**
 * resolveWikilinkTarget — wikilink target 路径解析与安全网关 (F-29 / FR-02 / NFR-05~08).
 *
 * 设计依据: docs/design/compiled.md §3.2 + §4.1.
 *
 * 责任:
 *   - 把 `{ target, vaultRoot, anchor? }` 解析为 vault 内绝对路径.
 *   - 5 道安全网关 (空 / 超长 / 绝对路径 / Windows 盘符 / `..` 段 / 反斜杠 / NUL).
 *   - 自动补 `.md` 后缀.
 *   - 路径规则统一 `path.posix`, 跨平台行为一致 (NFR-18).
 *   - 二次 `path.posix.relative` 校验 (防御性, 正常情况下 step 1 已保证).
 *
 * 纪律:
 *   - 纯函数; 无副作用; 无 IPC; 不依赖 React / store.
 *   - 校验失败返回 `{ ok: false, reason }` 不抛错 (AC-04-4 / AC-06-1~4 静默拒绝语义).
 *   - 调用方负责文件存在性 IPC (NFR-07 复用 read_markdown_file NotFound 通道).
 */

import * as path from 'path';

export type ResolveResult =
  | { ok: true; absPath: string; anchor?: string }
  | { ok: false; reason: 'not-configured' | 'security-violation' };

export interface ResolveInput {
  target: string;
  vaultRoot: string | null;
  anchor?: string;
}

/** target 最大长度 (与 parseWikilink.PARSE_WIKILINK_MAX_LENGTH 对齐). */
export const RESOLVE_TARGET_MAX_LENGTH = 512;

/**
 * 是否绝对路径 (POSIX `/` 开头 或 Windows 盘符 `C:` `c:`).
 *   - POSIX: '/etc/passwd'
 *   - Windows drive: 'C:/Windows' / 'C:\\Windows' / 'c:foo'
 */
function isAbsoluteOrDrive(p: string): boolean {
  if (p.startsWith('/')) return true;
  if (/^[A-Za-z]:[\\/]/.test(p)) return true;
  if (/^[A-Za-z]:[^/\\]/.test(p)) return true;
  return false;
}

/**
 * resolveWikilinkTarget — 入口.
 *
 * @param input { target, vaultRoot, anchor? }
 * @returns ResolveResult
 *
 * 5 道安全网关 (任一命中 → security-violation):
 *   1) 空 target
 *   2) 长度 > 512
 *   3) isAbsoluteOrDrive (绝对路径 / Windows 盘符)
 *   4) 含 `..` 段
 *   5) 含 `\\` 或 `\0`
 *
 * 成功路径:
 *   1) 去除 `./` 前缀
 *   2) 自动补 `.md` 后缀
 *   3) `path.posix.join(vaultRoot, normalized)` 拼接
 *   4) 二次 `path.posix.relative(vaultRoot, absPath)` 校验仍在 vault 内
 */
export function resolveWikilinkTarget(input: ResolveInput): ResolveResult {
  const { target, vaultRoot, anchor } = input;

  // 前置: vaultRoot 必须存在 (AC-03-3 联动)
  if (vaultRoot === null || vaultRoot === undefined) {
    return { ok: false, reason: 'not-configured' };
  }
  if (typeof vaultRoot !== 'string' || vaultRoot.length === 0) {
    return { ok: false, reason: 'not-configured' };
  }

  if (typeof target !== 'string') {
    return { ok: false, reason: 'security-violation' };
  }

  // 网关 1: 空 target
  if (target.length === 0) {
    return { ok: false, reason: 'security-violation' };
  }
  // 网关 2: 超长
  if (target.length > RESOLVE_TARGET_MAX_LENGTH) {
    return { ok: false, reason: 'security-violation' };
  }
  // 网关 3: 绝对路径 / Windows 盘符
  if (isAbsoluteOrDrive(target)) {
    return { ok: false, reason: 'security-violation' };
  }
  // 网关 4: .. 段
  if (target.split('/').some((seg) => seg === '..')) {
    return { ok: false, reason: 'security-violation' };
  }
  // 网关 5: 反斜杠 / NUL
  if (target.includes('\\') || target.includes('\0')) {
    return { ok: false, reason: 'security-violation' };
  }

  // 去除 ./ 前缀
  let normalized = target.replace(/^(\.\/)+/, '');

  // 自动补 .md 后缀
  if (!/\.(md|markdown|mdx)$/i.test(normalized)) {
    normalized = normalized + '.md';
  }

  // posix 拼接 (无论宿主平台, vault 内相对路径用 posix 语义, NFR-18)
  const absPath = path.posix.join(vaultRoot, normalized);

  // 二次校验: 拼接结果必须仍在 vaultRoot 下 (防御性)
  const rel = path.posix.relative(vaultRoot, absPath);
  if (rel.startsWith('..') || path.posix.isAbsolute(rel)) {
    return { ok: false, reason: 'security-violation' };
  }

  if (typeof anchor === 'string' && anchor.length > 0) {
    return { ok: true, absPath, anchor };
  }
  return { ok: true, absPath };
}

export default resolveWikilinkTarget;

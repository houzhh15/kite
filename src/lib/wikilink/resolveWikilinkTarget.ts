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

// eslint-disable-next-line no-restricted-imports -- path.posix 是 vault 内路径跨平台统一语义 (NFR-18), 与 IPC 无关; 不涉及 fs IO.
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
 * probeVaultRootCandidates — 逐层假设 vaultRoot (T28 / F-46 / FR-03 增量).
 *
 * 背景:
 *   wikilink 设计上要求全局配置 vaultRoot, 但实际场景用户常在子目录打开 markdown
 *   而未配置 vaultRoot. 退路: 假设当前文件所在目录就是 vaultRoot, 逐层向上假设.
 *
 * 契约 (AC-03-1 / AC-03-2):
 *   - 入参 currentPath (绝对文件路径, 由 docStore.state.currentPath 提供).
 *   - 返回 string[] 候选 vaultRoot 列表, 顺序由内向外 (最近 → 最远).
 *   - 动态深度 = 路径段数:
 *       /A/B/C/D.md → ['/A/B/C', '/A/B', '/A', '/'] (depth 4)
 *       /foo.md     → ['/'] (depth 1)
 *   - 边界: 已是根 '/' → 返回 ['/'] (depth 1, 防止死循环).
 *   - 路径统一 posix (NFR-18).
 *   - 入参非法 (空 / 非字符串) → 返回 [].
 *
 * 性能: 单次 dirname 调用 O(深度), 总耗时 < 1ms.
 */
export function probeVaultRootCandidates(currentPath: string | null | undefined): string[] {
  if (typeof currentPath !== 'string' || currentPath.length === 0) {
    return [];
  }
  // 截到 basename 之前 (currentPath 可能是文件, 取其所在目录).
  // path.posix.dirname 边界:
  //   dirname('foo.md')  === '.'  → 我们把它当作 '/'
  //   dirname('/')       === '/'
  //   dirname('/A/B/')   === '/A'
  let dir = path.posix.dirname(currentPath);
  if (dir === '.' || dir === '') {
    // 极端边界: 没有目录部分 (例如 'foo.md'), 退路到根.
    dir = '/';
  }
  // 统一末尾无 '/', 便于 path.posix.join 一致行为.
  if (dir !== '/' && dir.endsWith('/')) {
    dir = dir.slice(0, -1);
  }
  const candidates: string[] = [];
  // 防死循环: dirname('/') === '/' 永远不收敛, 上限由段数自然限制.
  const seen = new Set<string>();
  let cur = dir;
  let safetyGuard = 64; // 极端深路径也限制 (1 + 63 = 64, 远大于实际).
  while (safetyGuard-- > 0) {
    if (seen.has(cur)) break;
    seen.add(cur);
    candidates.push(cur);
    if (cur === '/') break; // 已到根, 停止.
    const next = path.posix.dirname(cur);
    if (next === cur) break; // 防御性: 任何平台不收敛情况.
    cur = next;
  }
  return candidates;
}

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

/**
 * src/lib/inline/wikiResolve.ts — Wiki 链接异步探查 (契约 8 / 设计 §3.3.3).
 *
 * 设计依据: docs/design/compiled.md §3.3.3 + §3.8 契约 8 + FR-09.
 *
 * 责任:
 *   - [[Page Name]] → 规范化为 baseDir/{kebab-case}.md
 *   - 异步探查 (走 resolveImagePath IPC, 单源)
 *   - LRU 256 + TTL 30s 缓存, 避免 wiki 链接大量未命中导致 IPC 风暴
 *   - flag wiki = false → short-circuit, 不发 IPC (AC-09-3)
 */

import { resolveImagePath } from '../tauri';
import { getFlags } from '../featureFlags';
import { slugify } from './slugify';

export interface WikiResolveResult {
  found: boolean;
  path?: string;
  reason?: 'disabled' | 'not-found' | 'error';
}

const CACHE_CAPACITY = 256;
const CACHE_TTL_MS = 30_000;

interface CacheEntry {
  result: WikiResolveResult;
  ts: number;
}

/** LRU 缓存 — Map 保持插入序; 命中时删除再插入以移到尾部. */
const cache: Map<string, CacheEntry> = new Map();

/** 规范化 page name → kebab-case 文件名 (不含扩展名转换, 由 slugify 提供). */
function toFileName(name: string): string {
  return slugify(name).replace(/_/g, '-');
}

/** 清空缓存 — 用于测试, 不参与业务路径. */
export function clearWikiCache(): void {
  cache.clear();
}

/**
 * resolveWikiPage — 异步探查 wiki 页面.
 *
 * @param name 页面名 (用户写法: "Getting Started")
 * @param baseDir wiki 根目录 (来自 flags 或 pref)
 */
export async function resolveWikiPage(
  name: string,
  baseDir: string,
): Promise<WikiResolveResult> {
  // AC-09-3: flag 关闭 → short-circuit
  if (!getFlags().wiki) {
    return { found: false, reason: 'disabled' };
  }

  const fileName = toFileName(name);
  const cacheKey = `${baseDir}::${fileName}`;

  // LRU 命中检查
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
    // 移到尾部表示最近使用
    cache.delete(cacheKey);
    cache.set(cacheKey, hit);
    return hit.result;
  }

  // 探查文件
  let result: WikiResolveResult;
  try {
    const path = await resolveImagePath(baseDir, `${fileName}.md`);
    result = { found: true, path };
  } catch (err) {
    // 区分 NOT_FOUND vs 其它错误: 仅 NOT_FOUND 视为「未命中」;
    // 其它错误作为 'error' 返回, 便于上层 toast / 调试.
    const code = (err as { code?: unknown })?.code;
    if (code === 'NOT_FOUND') {
      result = { found: false, reason: 'not-found' };
    } else {
      result = { found: false, reason: 'error' };
    }
  }

  // 写缓存
  cache.set(cacheKey, { result, ts: Date.now() });
  // 容量控制: 超过 256 删最旧
  while (cache.size > CACHE_CAPACITY) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
  return result;
}
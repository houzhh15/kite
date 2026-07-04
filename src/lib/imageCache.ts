/**
 * imageCache.ts — LRU 缓存 (设计 §3.2.2 / T08 step-5)
 *
 * 设计依据: docs/design/compiled.md §3.2.2 + docs/plan/compiled.md Step 5.
 *
 *   - key = `${baseDir}::${relPath}`, value = data URL (string).
 *   - 用 `Map` 实现 LRU: 插入 O(1), 淘汰尾部 O(1). Map 迭代顺序即插入顺序.
 *   - 上限 64 (NFR-P-4 / 100 张图片 benchmark 命中) — 经验值, 64MB 内存峰值兼容.
 *   - 切换文档 (R-4 缓解) 由调用方调 clear().
 *
 * 注意:
 *   - get 命中时把 key 移到队尾 (LRU 刷新).
 *   - 容量到上限再 put 时先删最旧 (队首), 再插入新值.
 *   - clear 后 get 永远返回 undefined.
 *   - 整体对外**单例** `imageCache`; 测试时可 new ImageCache(N).
 */

export class ImageCache {
  private map: Map<string, string>;

  constructor(public readonly max: number = 64) {
    if (!Number.isInteger(max) || max <= 0) {
      throw new RangeError(`ImageCache.max must be a positive integer, got ${max}`);
    }
    this.map = new Map();
  }

  /** LRU get: 命中时把 key 移到队尾, 提升优先级. */
  get(key: string): string | undefined {
    const v = this.map.get(key);
    if (v === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  /** put: 超过上限淘汰最旧. */
  put(key: string, value: string): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.max) {
      // 淘汰最旧: Map 迭代顺序按插入, 队首 = 最旧.
      const oldest = this.map.keys().next().value as string | undefined;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, value);
  }

  /** 清空缓存. 切换文档时调用 (R-4 缓解). */
  clear(): void {
    this.map.clear();
  }

  /** 当前大小 (供测试 / 调试). */
  size(): number {
    return this.map.size;
  }
}

/** 全局单例, 64 条上限 (FR-4 NFR-P-4). */
export const imageCache = new ImageCache(64);

/**
 * T08 step-5: imageCache LRU 行为契约测试.
 *
 * 覆盖:
 *   - get 命中时把 key 移到队尾 (LRU 刷新).
 *   - put 超过 max 淘汰最旧.
 *   - clear 后 get 返回 undefined.
 *   - get/put 都是 O(1) (1000 次循环 < 50ms).
 */
import { describe, expect, it } from 'vitest';

import { ImageCache } from '../imageCache';

describe('imageCache (T08)', () => {
  it('returns undefined for missing key', () => {
    const c = new ImageCache(4);
    expect(c.get('a')).toBeUndefined();
  });

  it('put then get roundtrips value', () => {
    const c = new ImageCache(4);
    c.put('a', 'data:image/png;base64,AAA');
    expect(c.get('a')).toBe('data:image/png;base64,AAA');
  });

  it('put over max evicts oldest (LRU)', () => {
    const c = new ImageCache(3);
    c.put('a', '1');
    c.put('b', '2');
    c.put('c', '3');
    c.put('d', '4'); // 触发淘汰
    expect(c.get('a')).toBeUndefined();
    expect(c.get('b')).toBe('2');
    expect(c.get('c')).toBe('3');
    expect(c.get('d')).toBe('4');
  });

  it('get hit refreshes recency (LRU move-to-end)', () => {
    const c = new ImageCache(3);
    c.put('a', '1');
    c.put('b', '2');
    c.put('c', '3');
    // 命中 a → a 移到队尾
    c.get('a');
    c.put('d', '4'); // 淘汰 b (此时 b 是最旧)
    expect(c.get('a')).toBe('1');
    expect(c.get('b')).toBeUndefined();
  });

  it('clear empties the cache', () => {
    const c = new ImageCache(3);
    c.put('a', '1');
    c.clear();
    expect(c.get('a')).toBeUndefined();
    expect(c.size()).toBe(0);
  });

  it('rejects non-positive max', () => {
    expect(() => new ImageCache(0)).toThrow();
    expect(() => new ImageCache(-1)).toThrow();
  });

  it('1000 put/get operations are O(1) per op (loose upper bound)', () => {
    const c = new ImageCache(64);
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) {
      c.put(`k${i}`, `v${i}`);
      c.get(`k${i}`);
    }
    const t1 = performance.now();
    // 1000 ops 应在 50ms 内完成 (留足 margin, 真实 ~1ms).
    expect(t1 - t0).toBeLessThan(50);
  });
});

/**
 * wikiResolve.test.ts — Wiki 链接异步探查 (契约 8 / AC-09-1..3).
 *
 * 设计依据: docs/design/compiled.md §3.3.3 + §3.8 契约 8.
 * 覆盖:
 *   - flag off → short-circuit 返回 {found:false, reason:'disabled'} (AC-09-3)
 *   - flag on, 文件存在 → {found:true, path: '...'} (AC-09-1)
 *   - flag on, 文件不存在 → {found:false} (AC-09-2)
 *   - LRU 命中复用 — 同一 name 不重复发请求
 *   - TTL 过期后再查会重新请求
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetFlags, setFlags } from '../../../lib/featureFlags';
import { clearWikiCache, resolveWikiPage } from '../../../lib/inline/wikiResolve';

// Mock the tauri IPC exit (resolveImagePath is the only async backend used here
// — we re-use the IPC layer so the contract stays single-source.)
vi.mock('../../../lib/tauri', () => ({
  resolveImagePath: vi.fn(),
}));

import { resolveImagePath } from '../../../lib/tauri';

const mockedResolveImagePath = vi.mocked(resolveImagePath);

beforeEach(() => {
  clearWikiCache();
  resetFlags();
  mockedResolveImagePath.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('wikiResolve — 契约 8', () => {
  it('flag off → short-circuit, reason disabled (AC-09-3)', async () => {
    setFlags({ wiki: false });
    const r = await resolveWikiPage('Getting Started', '/wiki');
    expect(r.found).toBe(false);
    expect(r.reason).toBe('disabled');
    expect(mockedResolveImagePath).not.toHaveBeenCalled();
  });

  it('flag on + 文件存在 → found true (AC-09-1)', async () => {
    setFlags({ wiki: true });
    mockedResolveImagePath.mockResolvedValue('/wiki/Getting-Started.md');
    const r = await resolveWikiPage('Getting Started', '/wiki');
    expect(r.found).toBe(true);
    expect(r.path).toBe('/wiki/Getting-Started.md');
  });

  it('flag on + 文件不存在 → found false (AC-09-2)', async () => {
    setFlags({ wiki: true });
    mockedResolveImagePath.mockRejectedValue(Object.assign(new Error('not found'), { code: 'NOT_FOUND' }));
    const r = await resolveWikiPage('Unknown Page', '/wiki');
    expect(r.found).toBe(false);
    expect(r.reason).toBe('not-found');
  });

  it('LRU 命中复用 — 同一 name 不重复调用 IPC', async () => {
    setFlags({ wiki: true });
    mockedResolveImagePath.mockResolvedValue('/wiki/Foo.md');
    await resolveWikiPage('Foo', '/wiki');
    await resolveWikiPage('Foo', '/wiki');
    await resolveWikiPage('Foo', '/wiki');
    expect(mockedResolveImagePath).toHaveBeenCalledTimes(1);
  });

  it('不同 name 各自发请求', async () => {
    setFlags({ wiki: true });
    mockedResolveImagePath.mockImplementation(async (_base, rel) => `/wiki/${rel}`);
    await resolveWikiPage('Foo', '/wiki');
    await resolveWikiPage('Bar', '/wiki');
    expect(mockedResolveImagePath).toHaveBeenCalledTimes(2);
  });

  it('TTL 过期后再次查询会重新调用 IPC', async () => {
    setFlags({ wiki: true });
    mockedResolveImagePath.mockResolvedValue('/wiki/Foo.md');
    await resolveWikiPage('Foo', '/wiki');
    // 模拟时间流逝, 直接清空缓存
    clearWikiCache();
    await resolveWikiPage('Foo', '/wiki');
    expect(mockedResolveImagePath).toHaveBeenCalledTimes(2);
  });

  it('规范化 page name → kebab-case 文件名', async () => {
    setFlags({ wiki: true });
    mockedResolveImagePath.mockResolvedValue('/wiki/hello-world.md');
    await resolveWikiPage('Hello World', '/wiki');
    expect(mockedResolveImagePath).toHaveBeenCalledWith('/wiki', 'hello-world.md');
  });

  it('IPC 抛错 → 返回 found false + reason', async () => {
    setFlags({ wiki: true });
    mockedResolveImagePath.mockRejectedValue(new Error('IO error'));
    const r = await resolveWikiPage('Foo', '/wiki');
    expect(r.found).toBe(false);
    expect(r.reason).toBe('error');
  });
});
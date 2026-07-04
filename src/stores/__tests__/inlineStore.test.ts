/**
 * inlineStore.test.ts — 契约 6 + 契约 7 / FR-16 + FR-17.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { INLINE_TTL_MS, useInlineStore } from '../inlineStore';

beforeEach(() => {
  useInlineStore.setState({ lastExternal: null, tooltip: null });
});

describe('inlineStore — lastExternal (FR-16)', () => {
  it('写入 host + url → lastExternal 更新', () => {
    useInlineStore.getState().setExternal('example.com', 'https://example.com/x');
    const rec = useInlineStore.getState().lastExternal;
    expect(rec).not.toBeNull();
    if (rec) {
      expect(rec.host).toBe('example.com');
      expect(rec.url).toBe('https://example.com/x');
    }
  });

  it('空 host 跳过更新 (AC-16-3 / AC-16-4)', () => {
    useInlineStore.getState().setExternal('', 'https://example.com');
    expect(useInlineStore.getState().lastExternal).toBeNull();
  });

  it('连续两次不同 host → 切换为新 host (AC-16-2)', () => {
    useInlineStore.getState().setExternal('a.com', 'https://a.com');
    useInlineStore.getState().setExternal('b.org', 'https://b.org/x');
    expect(useInlineStore.getState().lastExternal?.host).toBe('b.org');
  });

  it('5s TTL 后 clearExternalIfStale 清空', () => {
    useInlineStore.getState().setExternal('example.com', 'https://example.com');
    const rec = useInlineStore.getState().lastExternal;
    expect(rec).not.toBeNull();
    if (rec) {
      useInlineStore.getState().clearExternalIfStale(rec.ts + INLINE_TTL_MS + 1);
    }
    expect(useInlineStore.getState().lastExternal).toBeNull();
  });

  it('5s 内调用 clearExternalIfStale 不清空', () => {
    useInlineStore.getState().setExternal('example.com', 'https://example.com');
    const rec = useInlineStore.getState().lastExternal;
    expect(rec).not.toBeNull();
    if (rec) {
      useInlineStore.getState().clearExternalIfStale(rec.ts + 1000);
    }
    expect(useInlineStore.getState().lastExternal).not.toBeNull();
  });

  it('clearExternal 强制清空', () => {
    useInlineStore.getState().setExternal('a.com', 'https://a.com');
    useInlineStore.getState().clearExternal();
    expect(useInlineStore.getState().lastExternal).toBeNull();
  });
});

describe('inlineStore — tooltip (FR-17)', () => {
  it('pushTooltip 设置 x/y/url/key', () => {
    useInlineStore.getState().pushTooltip({ x: 100, y: 200, url: 'https://example.com' });
    const t = useInlineStore.getState().tooltip;
    expect(t).not.toBeNull();
    expect(t?.x).toBe(100);
    expect(t?.y).toBe(200);
    expect(t?.url).toBe('https://example.com');
    expect(typeof t?.key).toBe('number');
  });

  it('连续 push 自增 key (防重复挂载)', () => {
    useInlineStore.getState().pushTooltip({ x: 1, y: 1, url: 'a' });
    const t1 = useInlineStore.getState().tooltip;
    expect(t1).not.toBeNull();
    useInlineStore.getState().pushTooltip({ x: 2, y: 2, url: 'a' });
    const t2 = useInlineStore.getState().tooltip;
    expect(t2).not.toBeNull();
    if (t1 && t2) {
      expect(t2.key).toBeGreaterThan(t1.key);
    }
  });

  it('dismissTooltip 清空', () => {
    useInlineStore.getState().pushTooltip({ x: 1, y: 1, url: 'a' });
    useInlineStore.getState().dismissTooltip();
    expect(useInlineStore.getState().tooltip).toBeNull();
  });
});
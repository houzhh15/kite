/**
 * T13 useMarkdownDoc.worker.test.ts — T13 step-16d (FR-06 / step-12a)
 *
 * 覆盖:
 *   - 大文档 (>256KB) -> parseMarkdown 走 Worker, 监听 ok 事件.
 *   - Worker 构造失败 -> parseMarkdown 回退同步, 触发 fallback listener.
 *   - Worker 上报 error 事件 -> 同步回退不抛错.
 *   - 触发 fallback 时 listener 收到的 reason = 'fallback'.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  parseMarkdown,
  setParserFallbackListener,
} from '../../lib/markdownParser';
import { PARSER_WORKER_THRESHOLD_BYTES } from '../../lib/parserThreshold';

type Listener = Parameters<typeof setParserFallbackListener>[0];

describe('useMarkdownDoc.worker.test — markdownParser fallback', () => {
  let OriginalWorker: typeof globalThis.Worker | undefined;
  let listener: Listener | null = null;

  beforeEach(() => {
    OriginalWorker = globalThis.Worker;
    listener = vi.fn();
    setParserFallbackListener(listener);
  });

  afterEach(() => {
    if (OriginalWorker) globalThis.Worker = OriginalWorker;
    else delete (globalThis as { Worker?: unknown }).Worker;
    setParserFallbackListener(null);
    listener = null;
  });

  it('小文档 (50KB) 走同步路径, 不构造 Worker', async () => {
    const content = '# small\n'.repeat(1024); // ~9 KB
    const wSpy = vi.fn();
    globalThis.Worker = wSpy as unknown as typeof Worker;

    const r = await parseMarkdown(content);
    expect(wSpy).not.toHaveBeenCalled();
    expect(r.viaWorker).toBe(false);
    expect(r.ast).toBeDefined();
    expect(listener).not.toHaveBeenCalled();
  });

  it('大文档 (>=阈值) 走 Worker: mock Worker 成功路径触发 listener(r=ok) 与 AST', async () => {
    const blob = 'A'.repeat(PARSER_WORKER_THRESHOLD_BYTES + 1024);
    type Listener = (ev: { data: unknown }) => void;
    let onmessage: Listener | null = null;
    let lastId = '';
    class MockWorker {
      static lastInstance?: MockWorker;
      constructor(_url: URL | string, _opts?: WorkerOptions) {
        MockWorker.lastInstance = this;
      }
      addEventListener(name: string, cb: Listener) {
        if (name === 'message') onmessage = cb;
        else if (name === 'error') {
          // ignore in success test
        }
      }
      removeEventListener() {/* noop */}
      postMessage(msg: { type: string; id: string }) {
        lastId = msg.id;
        setTimeout(() => {
          onmessage?.({
            data: { type: 'parsed', id: msg.id, ast: { mock: true } },
          });
        }, 0);
      }
      terminate() {/* noop */}
    }
    void MockWorker.lastInstance;
    globalThis.Worker = MockWorker as unknown as typeof Worker;
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const r = await parseMarkdown(blob);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    expect(r.viaWorker).toBe(true);
    expect((r.ast as { mock?: boolean }).mock).toBe(true);
    expect(lastId.length).toBeGreaterThan(0);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'ok' }),
    );
    consoleWarnSpy.mockRestore();
  });

  it('Worker 构造抛错: 回退同步, 触发 listener(r=fallback)', async () => {
    const blob = 'B'.repeat(PARSER_WORKER_THRESHOLD_BYTES + 1024);
    class BrokenWorker {
      constructor() {
        throw new TypeError('mocked worker init failure');
      }
    }
    globalThis.Worker = BrokenWorker as unknown as typeof Worker;
    const r = await parseMarkdown(blob);
    expect(r.viaWorker).toBe(false);
    expect(r.ast).toBeDefined();
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'fallback' }),
    );
  });

  it('Worker 上报 error 事件: 主线程同步回退不抛错', async () => {
    const blob = 'C'.repeat(PARSER_WORKER_THRESHOLD_BYTES + 1024);
    type Listener = (ev: { data: unknown }) => void;
    let onmessage: Listener | null = null;
    class MockWorker {
      static lastInstance?: MockWorker;
      constructor() {
        MockWorker.lastInstance = this;
      }
      addEventListener(name: string, cb: Listener) {
        if (name === 'message') onmessage = cb;
      }
      removeEventListener() {}
      postMessage(msg: { type: string; id: string }) {
        setTimeout(() => {
          onmessage?.({
            data: { type: 'error', id: msg.id, message: 'mocked parse error' },
          });
        }, 0);
      }
      terminate() {}
    }
    void MockWorker.lastInstance;
    globalThis.Worker = MockWorker as unknown as typeof Worker;
    setParserFallbackListener(listener);
    const r = await parseMarkdown(blob);
    expect(r.viaWorker).toBe(false);
    expect(r.ast).toBeDefined();
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'fallback' }),
    );
  });
});

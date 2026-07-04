/**
 * src/lib/markdownParser.ts — T13 step-12a (FR-06)
 *
 * 把"是否走 Worker"封装为单一入口, useMarkdownDoc 用它来异步得到 mdast.
 *
 * 行为 (设计 D-06):
 *   - byteLength < PARSER_WORKER_THRESHOLD_BYTES -> 同步 unified parse.
 *   - byteLength >= 阈值 -> new Worker(...).postMessage; 主线程收到 parsed 后 resolve.
 *   - Worker 构造抛错 (CSP / URL 无效 / 测试环境) -> console.warn + 回退同步.
 *   - Worker 上报 error 事件 -> reject 主线程; 调用方决定是否回退.
 *
 * 返回 Promise<ParseResult>; 调用方负责 dispatch OPEN_OK / 处理 reject.
 *
 * 安全 (N6): Worker 仅做纯文本解析; 调用方需避免把 Tauri API 字符串塞进 content.
 */

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';

import { PARSER_WORKER_THRESHOLD_BYTES } from './parserThreshold';

export interface ParseResult {
  /** mdast root 节点 (unified 输出). */
  ast: unknown;
  /** 解析耗时 (ms). */
  elapsedMs: number;
  /** 是否走了 Worker. */
  viaWorker: boolean;
}

export interface WorkerFallbackEvent {
  reason: 'ok' | 'fallback';
  byteLength?: number;
  cause?: string;
}

/** 主线程可在 fallback 时挂载事件 handler. 仅最近一次构造回退/成功有触发. */
type FallbackListener = (ev: WorkerFallbackEvent) => void;

let fallbackListener: FallbackListener | null = null;
export function setParserFallbackListener(fn: FallbackListener | null): void {
  fallbackListener = fn;
}

function notify(listener: FallbackListener | null, ev: WorkerFallbackEvent): void {
  if (typeof listener !== 'function') return;
  try {
    listener(ev);
  } catch (err) {
    console.warn('[markdownParser] fallback listener threw:', err);
  }
}

function parseSync(content: string): { ast: unknown; elapsedMs: number } {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const ast = unified().use(remarkParse).use(remarkGfm).parse(content);
  const t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  return { ast, elapsedMs: t1 - t0 };
}

/**
 * 在 Worker 里跑解析. 返回 Promise + 暴露 fallback listener 触发.
 * Worker 构造失败 -> resolve 同步结果 + 触发 'fallback' 事件.
 */
export async function parseMarkdown(
  content: string,
): Promise<ParseResult> {
  const byteLength = computeByteLength(content);

  if (byteLength < PARSER_WORKER_THRESHOLD_BYTES) {
    const r = parseSync(content);
    return { ast: r.ast, elapsedMs: r.elapsedMs, viaWorker: false };
  }

  // >= 阈值 -> 尝试 Worker.
  let worker: Worker | null = null;
  try {
    worker = new Worker(
      new URL('../workers/markdownParser.worker.ts', import.meta.url),
      { type: 'module' },
    );
  } catch (err) {
    const cause =
      err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.warn('[parser] worker init failed, fallback to sync:', cause);
    notify(fallbackListener, { reason: 'fallback', byteLength, cause });
    const r = parseSync(content);
    return { ast: r.ast, elapsedMs: r.elapsedMs, viaWorker: false };
  }

  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  return new Promise<ParseResult>((resolve, reject) => {
    let settled = false;
    const w: Worker = worker;
    const cleanup = (): void => {
      try {
        w.removeEventListener('message', onMessage);
        w.removeEventListener('error', onError);
      } catch {
        /* noop */
      }
      try {
        w.terminate();
      } catch {
        /* noop */
      }
    };
    const settle = (result: ParseResult | null, error?: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (result) resolve(result);
      else reject(error ?? new Error('worker parse failed'));
    };

    const onMessage = (ev: MessageEvent): void => {
      const data = ev.data as
        | { type: 'parsed'; id: string; ast: unknown }
        | { type: 'error'; id: string; message: string }
        | { type: 'progress'; id: string; phase: string; elapsedMs: number };
      if (!data || typeof data !== 'object') return;
      if (data.id !== id) return;
      if (data.type === 'parsed') {
        const t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        notify(fallbackListener, { reason: 'ok', byteLength });
        settle({ ast: data.ast, elapsedMs: t1 - t0, viaWorker: true });
      } else if (data.type === 'error') {
        // Worker 内部报错: 不要静默吞掉, 让上层决策 (这里会 fallback).
        console.warn('[parser] worker reported error, fallback to sync:', data.message);
        notify(fallbackListener, {
          reason: 'fallback',
          byteLength,
          cause: data.message,
        });
        try {
          const r = parseSync(content);
          settle({ ast: r.ast, elapsedMs: r.elapsedMs, viaWorker: false });
        } catch (err) {
          settle(null, err instanceof Error ? err : new Error(String(err)));
        }
      }
    };
    const onError = (ev: ErrorEvent): void => {
      console.warn('[parser] worker error, fallback to sync:', ev.message);
      notify(fallbackListener, {
        reason: 'fallback',
        byteLength,
        cause: ev.message,
      });
      try {
        const r = parseSync(content);
        settle({ ast: r.ast, elapsedMs: r.elapsedMs, viaWorker: false });
      } catch (err) {
        settle(null, err instanceof Error ? err : new Error(String(err)));
      }
    };

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.postMessage({ type: 'parse', id, content });
  });
}

function computeByteLength(content: string): number {
  if (typeof TextEncoder !== 'undefined') {
    try {
      return new TextEncoder().encode(content).length;
    } catch {
      /* fall through */
    }
  }
  // 兜底: utf-16 字节近似.
  return content.length * 2;
}

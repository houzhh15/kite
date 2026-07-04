/**
 * src/workers/markdownParser.worker.ts — T13 step-11a (FR-06 / I-01)
 *
 * 在 Web Worker 里跑 Markdown → mdast 解析, 避免主线程阻塞.
 * 触发条件由 src/hooks/useMarkdownDoc.ts 决定 (字节数 >= 阈值).
 *
 * 协议 (I-01):
 *   Main -> Worker:
 *     { type: 'parse', id: string, content: string }
 *   Worker -> Main:
 *     { type: 'progress', id, phase: 'start'|'mid'|'end', elapsedMs: number }
 *     { type: 'parsed',   id, ast: Root }
 *     { type: 'error',    id, message: string }
 *
 * 安全边界 (N6):
 *   - 不 import @tauri-apps/* (Worker 内无 IPC).
 *   - 不调 eval / Function().
 *   - 文件读取在 Rust 侧完成, 本模块只接收 string.
 *
 * 注意: Vite 通过 new Worker(new URL('./xxx.worker.ts', import.meta.url),
 * { type: 'module' }) 编译产物; 这里 self.onmessage 等标准 Worker API.
 */

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';

interface ParseRequest {
  type: 'parse';
  id: string;
  content: string;
}

interface WorkerOutgoing {
  type: 'progress' | 'parsed' | 'error';
  id: string;
  [k: string]: unknown;
}

function send(msg: WorkerOutgoing): void {
  // self 是 DedicatedWorkerGlobalScope (worker 环境). 在浏览器严格类型中不存在,
  // 这里通过 (self as any) 平滑过渡; 运行时检查兜底.
  const s = self as unknown as {
    postMessage?: (msg: WorkerOutgoing) => void;
  };
  if (typeof s.postMessage === 'function') s.postMessage(msg);
}

const tStart = Date.now();

function safeNumber(n: unknown): number {
  return typeof n === 'number' ? n : Date.now() - tStart;
}

async function parseContent(id: string, content: string): Promise<void> {
  send({ type: 'progress', id, phase: 'start', elapsedMs: 0 });

  try {
    const tree = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .parse(content);

    send({
      type: 'progress',
      id,
      phase: 'mid',
      elapsedMs: safeNumber(undefined),
    });

    // remark 解析是同步的; 此处仅做 phase 上报. 保留为占位以便后续大文档场景扩展.
    send({
      type: 'parsed',
      id,
      ast: tree,
    });
    send({
      type: 'progress',
      id,
      phase: 'end',
      elapsedMs: safeNumber(undefined),
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? `${err.name}: ${err.message}`
        : typeof err === 'string'
          ? err
          : 'parse failed';
    send({ type: 'error', id, message });
  }
}

self.onmessage = (event: MessageEvent<ParseRequest>): void => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;
  if (data.type !== 'parse') return;
  if (typeof data.id !== 'string' || typeof data.content !== 'string') return;

  // Fire-and-forget; parseContent 自己通过 postMessage 回主线程.
  void parseContent(data.id, data.content);
};

export {}; // 确保模块作用域.

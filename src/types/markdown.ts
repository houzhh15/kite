/**
 * src/types/markdown.ts — 文档查看器状态机类型
 *
 * 设计依据: docs/design/compiled.md §3.2.2 + §3.2.3.
 *
 *   MarkdownStatus — 状态机 4 个枚举值 (idle | loading | ok | error)
 *   MarkdownDoc    — 单次成功打开的文档快照 (path + title + content)
 *   MarkdownState  — 状态机 + 当前 doc + 错误消息
 *   Action         — reducer 的入参, 由 useMarkdownDoc 派发
 *   WorkerFallback — T13 step-12b: Worker 解析成功/回退事件类型
 *
 * 关键纪律:
 *   - 这些类型必须由 `useMarkdownDoc` reducer / hook 严格使用,
 *     任何变化必须同步 docs/design/compiled.md §3.2 + docs/plan/compiled.md Step 4.
 *   - 不在这里做 IPC; IPC 出口严格只走 src/lib/tauri.ts.
 *   - 不允许 `any`; 缺省值显式声明, 便于测试断言.
 */

export type MarkdownStatus = 'idle' | 'loading' | 'ok' | 'error';

/** 单次成功打开的文档 (FR-02 / 设计 §3.2.2). */
export interface MarkdownDoc {
  /** 文件绝对路径. */
  path: string;
  /** 文档标题 (取自首行或文件名, 由 hook 派生). */
  title: string;
  /** 文件 UTF-8 原文. */
  content: string;
}

/** 状态机完整快照 (设计 §3.2.3). */
export interface MarkdownState {
  status: MarkdownStatus;
  /** 成功态时填入, 其它态可能为 null (失败但前序成功也保留上一份). */
  doc: MarkdownDoc | null;
  /** 当前失败时的可读错误消息; 成功/空闲时为 null. */
  errorMessage: string | null;
}

/** reducer 入参 — 与设计 §3.2.3 表格 1:1. */
export type Action =
  | { type: 'OPEN_START' }
  | { type: 'OPEN_OK'; doc: MarkdownDoc }
  | { type: 'OPEN_ERR'; errorMessage: string }
  | { type: 'RETRY' }
  | { type: 'CLOSE' };

/** T13 step-12b: Worker fallback 事件 (用于测试与未来埋点).
 *  - 'ok': Worker 解析成功.
 *  - 'fallback': Worker 构造失败, 主线程回退同步解析. */
export type WorkerFallbackReason = 'ok' | 'fallback';

export interface WorkerFallbackEvent {
  type: 'fallback';
  reason: WorkerFallbackReason;
  /** 触发 fallback 时 content 字节数; 仅 fallback 下有值. */
  byteLength?: number;
  /** 原始错误 (fallback 才有). */
  cause?: string;
}

export interface WorkerOkEvent {
  type: 'ok';
  byteLength: number;
  elapsedMs: number;
}

/** 状态机初始值 (用于 useReducer / 测试). */
export const initialMarkdownState: MarkdownState = {
  status: 'idle',
  doc: null,
  errorMessage: null,
};

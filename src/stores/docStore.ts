/**
 * docStore — 当前打开的文档状态 (FR-07).
 *
 * T01 阶段: 落地 state 形状 + action 签名, action 体不调用 tauri.*.
 * T04 阶段: 新增 setContent action (FR-07 / F-16), 副作用触发 setWindowTitle.
 *           不修改现有 open / close / updateContent / markSaved.
 * T06 阶段: setContent 不再直接调 setWindowTitle; 由 App.tsx 顶层 useEffect 订阅
 *           title 字段, 实现单一数据源 + 单向流 (F-16).
 * T15 阶段: 增加 history 子模块 (FR-04) — history: string[] + cursor: number.
 *           pushHistory / moveCursor / loadFile 封装.
 *
 * FR-07 schema:
 *   - current: { path, content, title, dirty } 描述当前打开的文档
 *   - actions: open(path) / close() / updateContent(text) / markSaved() / setContent(input)
 *
 * FR-04 schema:
 *   - history: string[] — 文件绝对路径栈 (会话内有效)
 *   - cursor:  number — 当前指向 history 的索引, 初始 -1
 *   - HISTORY_CAPACITY = 50 — 超出截断最早
 *   - actions: pushHistory(file) / moveCursor(delta) / loadFile(path) /
 *              canGoBack / canGoForward
 *
 * 持久化责任:
 *   - docStore **不** 直接持有持久化路径. 由 prefStore (F-33) 与
 *     recentStore (F-03) 分别承担窗口位置/最近列表.
 *   - 文档内容不持久化 (走 IPC 重新读盘), 避免大文件占用 store.
 *   - history 不持久化 (会话内有效).
 */
import { create } from 'zustand';

import i18n from '../i18n';
import { isAppError, readMarkdownFile, type AppError } from '../lib/tauri';
import { pushToast } from '../lib/toast';

export interface DocState {
  /** 当前打开文件的绝对路径. 未打开时为 null. */
  currentPath: string | null;
  /** 当前打开文件的 utf-8 文本内容. */
  content: string;
  /** 文档标题 (供 UI 显示). */
  title: string;
  /** 当前内容与磁盘快照是否一致. */
  dirty: boolean;
}

export interface SetContentInput {
  /** 文件绝对路径; 空串表示关闭文档. */
  path: string;
  /** 可选显式 title; 未提供时从 path 推导. */
  title?: string;
  /** 文档 utf-8 内容. */
  content: string;
}

/** T15 (FR-04): 历史栈上限. 超出截断最早. */
export const HISTORY_CAPACITY = 50;

/** T15 (FR-04): 把 AppError 转为用户可读字符串 (用于 toast). 走 i18n. */
function appErrorMessage(err: AppError): string {
  const t = i18n.t.bind(i18n);
  switch (err.code) {
    case 'NOT_FOUND':
      return t('message.fileNotFound');
    case 'TOO_LARGE':
      return t('message.fileTooLarge');
    case 'ENCODING':
      return t('message.encodingError');
    case 'IO':
      return t('message.ioError');
    case 'INVALID_PATH':
      return t('message.invalidPath');
    case 'NOT_A_DIRECTORY':
      return t('message.notADirectory');
    case 'PERMISSION_DENIED':
      return t('message.permissionDenied');
    case 'UNKNOWN':
    default:
      return err.message || t('message.unknownError');
  }
}

export interface DocStore {
  state: DocState;
  /** T15 (FR-04): 历史路径栈. 空表示未打开任何文件. */
  history: string[];
  /** T15 (FR-04): 指针. -1 表示未打开; 否则 0..history.length-1. */
  cursor: number;
  /**
   * 打开文档. T05 阶段会调用 tauri.readMarkdownFile 并填充 content/title.
   */
  open(path: string): Promise<void>;
  /** 关闭当前文档, 重置 state 为初始. */
  close(): void;
  /** 更新内存中的 content 并把 dirty 置 true. */
  updateContent(text: string): void;
  /** 写入成功后调用, 把 dirty 置 false. */
  markSaved(): void;
  /**
   * T04 新增 / T06 调整: 仅写入 state, 不再直接调 setWindowTitle.
   * 副作用由 App.tsx 顶层 useEffect 订阅 title 触发.
   */
  setContent(input: SetContentInput): void;

  // ---- T15 (FR-04) history actions ----

  /**
   * pushHistory — 推入文件路径到历史栈.
   * - 与 history[cursor] 相同 → 静默忽略.
   * - 与历史中既有路径相同 → 仅移动 cursor; 不重复 push (AC-04-2).
   * - 否则 → 截断 cursor+1 之后的远端条目, push 新路径, cursor++.
   * - 容量超过 HISTORY_CAPACITY → 左移溢出并对应递减 cursor (AC-04-3).
   */
  pushHistory(file: string): void;

  /**
   * moveCursor — 后退 / 前进 (delta = -1 | 1).
   * 边界越界 → 静默 noop (AC-04-4).
   * 否则: cursor ± delta 并异步 loadFile(history[cursor]).
   */
  moveCursor(delta: -1 | 1): Promise<void>;

  /**
   * loadFile — 读取文件 → 写入 useDocStore.setContent → pushHistory.
   * 失败 → toast 错误消息; cursor 不动.
   */
  loadFile(path: string): Promise<void>;

  /** canGoBack — cursor > 0. */
  canGoBack(): boolean;

  /** canGoForward — cursor < history.length - 1. */
  canGoForward(): boolean;
}

/**
 * basename helper — 5 行内联实现 (设计 §3.9 决议: 不新增 lib/path.ts).
 *   - 同时处理 POSIX ('/') 与 Windows ('\\') 分隔符 (跨平台 AC-NFR04-1).
 *   - 去 .md / .markdown / .mdx 后缀 (case-insensitive).
 */
function basename(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  const last = i >= 0 ? p.slice(i + 1) : p;
  return last.replace(/\.(md|markdown|mdx)$/i, '');
}

const initialState: DocState = {
  currentPath: null,
  content: '',
  title: '',
  dirty: false,
};

/**
 * zustand store factory. T01 仅暴露签名, 不在内部调 IPC.
 * T06 起 setContent 不再触发 setWindowTitle; App.tsx 顶层 useEffect 统一负责.
 * T15 起增加 history 子模块 (FR-04) — 含 IPC 调用 readMarkdownFile.
 */
export const useDocStore = create<DocStore>((set, get) => ({
  state: initialState,
  history: [],
  cursor: -1,

  // T01 placeholder — T05 注入 readMarkdownFile 调用.
  async open(_path: string) {
    // TODO[T05]: const text = await tauri.readMarkdownFile(path);
    //            set((s) => ({ state: { ...s.state, currentPath: path, content: text, title: deriveTitle(path), dirty: false } }));
    throw new Error('docStore.open() is not implemented in T01');
  },
  close() {
    set(() => ({ state: initialState }));
  },
  updateContent(text: string) {
    set((s) => ({ state: { ...s.state, content: text, dirty: true } }));
  },
  markSaved() {
    set((s) => ({ state: { ...s.state, dirty: false } }));
  },
  setContent({ path, title, content }) {
    const t = title ?? (path ? basename(path) : '');
    set((s) => ({
      state: {
        ...s.state,
        currentPath: path || null,
        content,
        title: t,
        dirty: false,
      },
    }));
    // T06: 不再在 store 内调 setWindowTitle; 由 App.tsx 顶层 useEffect 订阅 title.
  },

  // -------- T15 (FR-04) history actions --------

  pushHistory(file: string) {
    if (typeof file !== 'string' || file.length === 0) return;
    const cur = get();
    // 1) 与当前 cursor 指向一致 → 静默忽略.
    if (cur.cursor >= 0 && cur.history[cur.cursor] === file) return;

    // 2) 文件已在历史中 (但不是 cursor) → 仅移动 cursor; 不重复 push.
    const existingIdx = cur.history.indexOf(file);
    if (existingIdx >= 0) {
      set(() => ({ cursor: existingIdx }));
      return;
    }

    // 3) 正常 push: 截断 cursor 之后, push, cursor++.
    let nextHistory = cur.history.slice(0, cur.cursor + 1);
    nextHistory = nextHistory.concat(file);

    // 4) 容量截断 (AC-04-3): 超出 HISTORY_CAPACITY, 左移最早条目.
    let nextCursor = nextHistory.length - 1;
    if (nextHistory.length > HISTORY_CAPACITY) {
      const drop = nextHistory.length - HISTORY_CAPACITY;
      nextHistory = nextHistory.slice(drop);
      nextCursor -= drop;
    }

    set(() => ({ history: nextHistory, cursor: nextCursor }));
  },

  canGoBack() {
    const s = get();
    return s.cursor > 0;
  },

  canGoForward() {
    const s = get();
    return s.cursor >= 0 && s.cursor < s.history.length - 1;
  },

  async moveCursor(delta) {
    const s = get();
    const next = s.cursor + delta;
    // AC-04-4: 边界 → 静默 noop.
    if (next < 0 || next >= s.history.length) return;
    const targetFile = s.history[next];
    if (!targetFile) return;
    // 先移动 cursor, 再异步加载.
    set(() => ({ cursor: next }));
    await get().loadFile(targetFile);
  },

  async loadFile(path: string) {
    try {
      const text = await readMarkdownFile(path);
      get().setContent({ path, content: text });
      get().pushHistory(path);
    } catch (err) {
      // T15 (FR-04): 失败 → toast; cursor 不动.
      const message = isAppError(err)
        ? appErrorMessage(err)
        : err instanceof Error
          ? err.message
          : i18n.t('message.loadFailed');
      pushToast({ kind: 'error', message });
      // 不更新 cursor; 让历史栈与当前内容一致.
    }
  },
}));
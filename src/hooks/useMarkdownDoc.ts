/**
 * useMarkdownDoc — Markdown 文档加载 hook (T02 核心入口).
 *
 * 设计依据: docs/design/compiled.md §3.2.3 / §3.2.4 / §3.2.5 +
 *           docs/plan/compiled.md Step 4.
 *
 *   - 状态机 4 个状态: idle / loading / ok / error
 *   - 5 个 action: OPEN_START / OPEN_OK / OPEN_ERR / RETRY / CLOSE
 *   - 并发防护: `inflightRef` 单调递增 stamp, 过期响应直接忽略
 *     (R-05 部分缓解, AC-02-2)
 *   - 错误重试: 通过 `retry()` 复用上次路径
 *   - 数据出口: 成功时把 MarkdownDoc 写入 useDocStore + 自家 state.doc
 *
 * T11 增量 (设计 §3.5 + §3.6.5 + FR-10 / FR-11):
 *   - OPEN_OK 成功后调 progressStore.setLastPath(path) + flush(true) (R-04).
 *   - 新增 tryRestoreLastPath() action: 启动时根据 progressStore.lastPath 自动加载.
 *
 * 纪律:
 *   - 唯一允许 import `@tauri-apps/plugin-dialog` 的 hook;
 *     其它前端代码一律通过 useMarkdownDoc 间接触发 dialog.
 *   - **不** import `invoke`: IPC 出口仍走 src/lib/tauri.ts.
 */

import { useCallback, useEffect, useReducer, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { open as openDialog } from '@tauri-apps/plugin-dialog';

import { initialMarkdownState, type Action, type MarkdownDoc, type MarkdownState } from '../types/markdown';
import { readMarkdownFile } from '../lib/tauri';
import { toErrorMessage } from '../lib/errorMessage';
import { useDocStore } from '../stores/docStore';
import { useRecentStore } from '../stores/recentStore';
import { useProgressStore } from '../stores/progressStore';
import { isAppError } from '../lib/tauri';
import { pushToast } from '../lib/toast';
import { parseMarkdown, setParserFallbackListener } from '../lib/markdownParser';
import { mark as perfMark, measure as perfMeasure } from '../lib/perf';

// ---- reducer 纯函数 (设计 §3.2.3 表格) ----

export function reducer(prev: MarkdownState, action: Action): MarkdownState {
  switch (action.type) {
    case 'OPEN_START': {
      // 任意进入 loading. 若上一态已有 doc, 保留 (避免空白闪烁).
      return { status: 'loading', doc: prev.doc, errorMessage: null };
    }
    case 'OPEN_OK': {
      // 成功: 替换 doc, 清空 errorMessage.
      return { status: 'ok', doc: action.doc, errorMessage: null };
    }
    case 'OPEN_ERR': {
      // 失败: 仅重置 errorMessage; doc 保留前序成功的 (AC-03-2).
      return { status: 'error', doc: prev.doc, errorMessage: action.errorMessage };
    }
    case 'RETRY': {
      // 重试语义: 视作再发起一次 OPEN_START, 但调用方通常会清空 errorMessage
      // 后再 dispatch OPEN_START. 这里保留 prev.doc, 让上一份文件不消失.
      return { status: 'loading', doc: prev.doc, errorMessage: null };
    }
    case 'CLOSE': {
      return { status: 'idle', doc: null, errorMessage: null };
    }
    default:
      // 穷举性: 上面覆盖全部 Action 变体, 这里仅满足 TS exhaustiveness.
      return prev;
  }
}

// ---- hook default export ----

export interface UseMarkdownDocApi {
  state: MarkdownState;
  /** 弹出系统文件选择对话框, 选择 .md 后开始加载. */
  open(): Promise<void>;
  /** 重试最近一次 open 选择的路径. */
  retry(): Promise<void>;
  /** 关闭当前文档, 重置 hook 内部 state + useDocStore. */
  close(): void;
  /**
   * T11 (FR-10): 启动时根据 progressStore.lastPath 自动恢复.
   * - lastPath=null → 立即 resolve, 不弹错.
   * - 不在 recentStore.items → setLastPath(null) + flush; resolve.
   * - readMarkdownFile 抛 NotFound → setLastPath(null) + removeProgress + flush.
   * - 成功 → OPEN_OK 后渲染; MarkdownRenderer 挂载后双 RAF scrollTo.
   *
   * 调用方应在 App 顶层 useEffect 调用一次, 且 progressStore.hydrated=true 后.
   */
  tryRestoreLastPath(): Promise<void>;
  /** T11 (FR-10): 内部用于 lastPath 恢复成功后, Reader 挂载完成时滚动到持久化位置. */
  restoreScrollAfterOpen(): void;
}

/**
 * 把文件绝对路径推导为标题: 取 basename 去扩展名.
 * 例: /foo/Bar.md -> "Bar"; /foo/Baz.markdown -> "Baz".
 *
 * 后续 T05/T06 可替换为"首行 H1 / 用户重命名"等更智能策略.
 */
function deriveTitle(path: string): string {
  const sep = path.lastIndexOf('/');
  const stem = sep >= 0 ? path.slice(sep + 1) : path;
  // 同时兼容 POSIX 与 Windows
  const dot = stem.lastIndexOf('.');
  return dot > 0 ? stem.slice(0, dot) : stem;
}

/**
 * T13 FR-06 (step-12a): 大文档 (>256KB) 由 markdownParser 选择 Worker 解析.
 * 同步路径走 unified, 异步路径走 Worker, 失败回到同步.
 * K6 测量结果通过 perfMark/measure 暴露, console.info 打印供开发期对照.
 *
 * 注意: 解析结果 (`ast`) 当前**未**回传给 MarkdownRenderer — 当前渲染器
 * 由 ReactMarkdown 内部完成 parse; 引入 AST 注入渲染器是后续 PR.
 * 这里覆盖 K3 之外的 K6 解析耗时测量, 并验证 Worker fallback 链路可达.
 */
async function runLargeDocParse(doc: MarkdownDoc): Promise<void> {
  try {
    perfMark('parse_start');
    const r = await parseMarkdown(doc.content);
    perfMark('parse_end');
    const elapsed = perfMeasure('parse_roundtrip', 'parse_start', 'parse_end');
    if (typeof elapsed === 'number' && elapsed > 0) {
      console.info(
        '[parser] K6 parse_ms:',
        elapsed.toFixed(1),
        'via',
        r.viaWorker ? 'worker' : 'sync',
        'bytes=',
        typeof TextEncoder !== 'undefined'
          ? new TextEncoder().encode(doc.content).length
          : doc.content.length,
      );
    }
    // 解除对 doc 的引用, 提示 GC 及时回收 AST.
    void r.ast;
  } catch (err) {
    console.warn('[parser] parseMarkdown failed:', err);
  }
}

export function useMarkdownDoc(): UseMarkdownDocApi {
  const [state, dispatch] = useReducer(reducer, initialMarkdownState);
  const { t } = useTranslation(); // T18 (FR-02): toErrorMessage 返回 i18n key, 此处 t() 渲染.

  // 用于并发出错的 inflight stamp 单调递增. 任意陈旧回调都自检并提前返回.
  const inflightRef = useRef(0);
  // 上次用户选择的路径, 供 retry() 复用.
  const lastPathRef = useRef<string | null>(null);

  // 主体流程在 ref 里以便 retry() 复用 (避免循环依赖).
  const runOpenRef = useRef<(path: string) => Promise<void>>(async () => {});

  // 把内容写入全局 useDocStore (FR-07 schema 不破坏, 见设计决策表).
  const syncDocStore = useCallback((doc: MarkdownDoc | null) => {
    if (doc === null) {
      useDocStore.getState().close();
      return;
    }
    // 注: useDocStore.open 是 T01 placeholder (throw), T02 不调它,
    // 直接用 setState 写入符合 DocState 形状的对象.
    useDocStore.setState(() => ({
      state: {
        currentPath: doc.path,
        content: doc.content,
        title: doc.title,
        dirty: false,
      },
    }));
  }, []);

  // 装载真实 runOpen; 暴露给 useEffect 闭包与 retry.
  useEffect(() => {
    runOpenRef.current = async (path: string) => {
      const stamp = ++inflightRef.current;
      dispatch({ type: 'OPEN_START' });
      try {
        const content = await readMarkdownFile(path);
        if (stamp !== inflightRef.current) return; // 过期, 忽略.
        const doc: MarkdownDoc = { path, title: deriveTitle(path), content };
        dispatch({ type: 'OPEN_OK', doc });
        syncDocStore(doc);
        // T06: FR-04 触发顺序 — 先 syncDocStore → 再 pushRecent (F-03 入列).
        // 失败分支不调用 pushRecent (设计 §3.5.3 硬约束).
        useRecentStore.getState().pushRecent(doc.path, doc.title);
        // T11 (FR-11 / AC-11-1): OPEN_OK 后更新 lastPath + flush (R-04 防 debounce 丢失).
        useProgressStore.getState().setLastPath(doc.path);
        void useProgressStore.getState().flush(true);
        // T13 FR-06 (step-12a): 解析走 Worker 异步触发; 同步路径是 fallback.
        // 该 promise 不阻塞首屏, 仅用于 K6 测量与回退监听.
        void runLargeDocParse(doc);
      } catch (err: unknown) {
        if (stamp !== inflightRef.current) return;
        const key = toErrorMessage(err);
        const msg = t(key);
        dispatch({ type: 'OPEN_ERR', errorMessage: msg });
        // toast 仅通知一次; 不向用户隐藏错误 (NFR-U-01).
        pushToast({ kind: 'error', message: msg });
      }
    };
  }, [syncDocStore]);

  // 注册 fallback 监听 (FR-06 / step-12a).
  // 仅记录在 console; 失败计数将由 K4 测量脚本对照.
  useEffect(() => {
    setParserFallbackListener((ev) => {
      if (ev.reason === 'fallback') {
        console.warn('[parser] fallback: byteLength=', ev.byteLength, 'cause=', ev.cause);
      } else if (ev.reason === 'ok') {
        // 成功路径: 不打日志 (会与 K3 噪音混淆); 真实生产可接埋点.
      }
    });
    return () => {
      setParserFallbackListener(null);
    };
  }, []);

  const open = useCallback(async () => {
    let picked: string | null = null;
    try {
      picked = await openDialog({
        multiple: false,
        directory: false,
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdx'] }],
      });
    } catch (err) {
      // dialog 自身出错, 归一化到 UNKNOWN 通道 (例如权限未授予).
      pushToast({ kind: 'error', message: t(toErrorMessage(err)) });
      return;
    }
    // 用户取消 → 不动状态, 直接退出.
    if (typeof picked !== 'string') return;
    lastPathRef.current = picked;
    await runOpenRef.current(picked);
  }, []);

  const retry = useCallback(async () => {
    const path = lastPathRef.current;
    if (!path) return;
    await runOpenRef.current(path);
  }, []);

  const close = useCallback(() => {
    inflightRef.current += 1; // 让任何陈旧回调都提前 return
    dispatch({ type: 'CLOSE' });
    syncDocStore(null);
  }, [syncDocStore]);

  /**
   * tryRestoreLastPath — T11 (FR-10).
   * 见接口注释.
   *
   * 实现: 直接调 readMarkdownFile(last); NOT_FOUND 时走 reset 分支; 成功时复用 runOpenRef.
   * 这里不用 runOpenRef 是因为它对错误会 pushToast (启动恢复阶段应静默).
   */
  const tryRestoreLastPath = useCallback(async () => {
    const last = useProgressStore.getState().consumeLastPath();
    if (!last) return;
    const items = useRecentStore.getState().items;
    if (!items.some((it) => it.path === last)) {
      // lastPath 不在最近列表 → 清空, 静默退出.
      useProgressStore.getState().setLastPath(null);
      void useProgressStore.getState().flush(true);
      return;
    }
    lastPathRef.current = last;
    let content: string;
    try {
      content = await readMarkdownFile(last);
    } catch (err) {
      if (isAppError(err) && err.code === 'NOT_FOUND') {
        // 启动恢复阶段静默 (不弹 toast).
        useProgressStore.getState().removeProgress(last);
        useProgressStore.getState().setLastPath(null);
        void useProgressStore.getState().flush(true);
      }
      return;
    }
    // 成功: 模拟 OPEN_OK 路径.
    const stamp = ++inflightRef.current;
    const doc: MarkdownDoc = { path: last, title: deriveTitle(last), content };
    dispatch({ type: 'OPEN_OK', doc });
    syncDocStore(doc);
    useRecentStore.getState().pushRecent(doc.path, doc.title);
    useProgressStore.getState().setLastPath(doc.path);
    void useProgressStore.getState().flush(true);
    void stamp;
  }, [syncDocStore]);

  /**
   * restoreScrollAfterOpen — T11 (FR-10 / 设计 §3.5).
   * MarkdownRenderer 挂载完成后, 双 RAF + scrollHeight 校验后 scrollTo 持久化位置.
   */
  const restoreScrollAfterOpen = useCallback(() => {
    const currentPath = useDocStore.getState().state.currentPath;
    if (!currentPath) return;
    const entry = useProgressStore.getState().getProgress(currentPath);
    if (!entry) return;
    if (typeof window === 'undefined') return;
    const tryScroll = (): void => {
      const container = document.querySelector<HTMLElement>(
        '[data-testid="reader-scroll-container"]',
      );
      if (!container) return;
      if (container.scrollHeight <= container.clientHeight) return;
      try {
        container.scrollTo({ top: entry.scrollTop, behavior: 'auto' });
      } catch {
        try {
          container.scrollTop = entry.scrollTop;
        } catch {
          /* ignore */
        }
      }
    };
    // 双 RAF: 第一帧让 MarkdownRenderer commit; 第二帧再 scrollTo.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        tryScroll();
      });
    });
  }, []);

  return {
    state,
    open,
    retry,
    close,
    tryRestoreLastPath,
    restoreScrollAfterOpen,
  };
}

// 为 UI 层提供最便捷的入口: 直接拿 hook 当 default export.
export default useMarkdownDoc;

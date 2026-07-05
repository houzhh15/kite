/**
 * useFileDrop — 拖拽打开 Markdown 副作用 hook (F-02 / T05).
 *
 * 设计依据: docs/design/compiled.md §3.1 + §3.3 + §3.4 + docs/plan/compiled.md Step 2.
 *
 * 责任范围 (R-07 修复后):
 *   - 订阅 Tauri 2 拖拽事件, 维护视觉态 (<body data-drag-active>).
 *   - 把 drop / 错误 (拒识扩展名 / 空 paths) 翻译为业务回调:
 *       onFilePicked(path): 选中的 markdown 路径 — 由调用方 (App.tsx) 注入,
 *         走 useMarkdownDoc.loadFile 标准链路 (OPEN_START / OPEN_OK / OPEN_ERR +
 *         stamp 防护 + pushHistory + setLastPath). 这里**不再**自行调
 *         readMarkdownFile / setContent / addRecentFile: 因为 useMarkdownDoc
 *         是文档加载的唯一状态机入口, 拖拽作为另一种触发方式必须复用同一链路,
 *         否则 Reader 渲染来源 (useMarkdownDoc reducer state) 与 useDocStore
 *         会出现分歧 — 表现为「拖拽了新文件, 窗口仍然显示旧文件内容」(Reader
 *         走 reducer, docStore 已经被改).
 *   - 1s 去重 toast 减少抖动.
 *
 * 不再做:
 *   - readMarkdownFile / setContent / close — 走 onFilePicked 由调用方负责.
 *   - pushRecent / addRecentFile — 由 useMarkdownDoc.loadFile 自动完成.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { getCurrentWebview } from '@tauri-apps/api/webview';

import { pushToast } from '../lib/toast';
import { pickMarkdownPath, describeAcceptedExts } from '../lib/fileTypes';
import {
  firstUnsupportedExt,
  formatDropError,
  basename as fileBasename,
  extractExt as fileExtractExt,
  isAppErrorCode as isCodeSupported,
} from '../lib/fileDropHelpers';
import { isTauri } from '../lib/env';

export type FileDropEvent =
  | { type: 'enter'; paths: string[] }
  | { type: 'over'; paths: string[] }
  | { type: 'drop'; paths: string[] }
  | { type: 'leave'; paths: string[] };

export interface FileDropSource {
  subscribe(handler: (event: FileDropEvent) => void): () => void;
}

/** drop 后, 把选中的 markdown 路径交给调用方. 调用方应完成读文件 / 状态机 / 写最近文件全链路. */
export type FilePickedHandler = (path: string) => void | Promise<void>;

export interface UseFileDropOptions {
  /**
   * 拖拽命中 markdown 文件后调用的回调. 由调用方 (例如 App.tsx) 注入, 通常
   * 直接传 `useMarkdownDoc.loadFile`, 让 reducer state 与 useDocStore 双源保持一致.
   */
  onFilePicked?: FilePickedHandler;
}

const DRAG_ACTIVE_FLAG = 'true';
const DRAG_ACTIVE_ATTR = 'data-drag-active';

export function setDragActiveAttr(on: boolean): void {
  if (typeof document === 'undefined') return;
  if (on) document.body.setAttribute(DRAG_ACTIVE_ATTR, DRAG_ACTIVE_FLAG);
  else document.body.removeAttribute(DRAG_ACTIVE_ATTR);
}

function showDropToast(
  ref: { current: { key: string; ts: number } | null },
  key: string,
  message: string,
): void {
  const now = Date.now();
  const last = ref.current;
  if (last && last.key === key && now - last.ts < 1000) return;
  ref.current = { key, ts: now };
  pushToast({ kind: 'error', message });
}

/**
 * createFileDropSource — 生产实现: 包装 Tauri 2 webview 拖拽事件.
 * 归一化 payload 为 FileDropEvent; 非 enter/over/drop/leave 忽略; paths 类型防御.
 *
 * 浏览器降级 (无 Tauri): 返回 no-op source. useEffect cleanup 调用 unlisten()
 * 是空操作, 不会抛错. 不发任何 handler 事件 → 视觉态 (data-drag-active) 始终
 * false, 浏览器里看起来「不响应拖拽」是预期行为 (无原生桥接).
 */
export function createFileDropSource(): FileDropSource {
  // 浏览器 / 测试场景: 挂 no-op, 让 App 不因为 undefined.metadata 抛同步错误.
  if (!isTauri()) {
    return {
      subscribe(_handler) {
        return () => {
          /* noop */
        };
      },
    };
  }
  return {
    subscribe(handler) {
      let unlisten: (() => void) | null = null;
      let cancelled = false;
      const safe = (fn: () => void, tag: string) => {
        try { fn(); } catch (e) { console.warn(`[useFileDrop] ${tag} failed:`, e); }
      };
      void getCurrentWebview()
        .onDragDropEvent((event) => {
          if (cancelled) return;
          const p = (event as { payload?: unknown }).payload;
          const inner = (p ?? event) as { type?: string; paths?: unknown };
          const paths: string[] = Array.isArray(inner.paths)
            ? (inner.paths as unknown[]).filter((x): x is string => typeof x === 'string')
            : [];
          if (inner.type === 'enter' || inner.type === 'over' || inner.type === 'drop') {
            handler({ type: inner.type, paths });
          } else if (inner.type === 'leave') {
            handler({ type: 'leave', paths });
          }
        })
        .then((fn) => {
          if (cancelled) { safe(fn, 'late unlisten'); return; }
          unlisten = fn;
        })
        .catch((err) => {
          console.warn('[useFileDrop] onDragDropEvent subscribe failed:', err);
        });
      return () => {
        cancelled = true;
        if (unlisten) { safe(unlisten, 'unlisten'); unlisten = null; }
      };
    },
  };
}

/**
 * useFileDrop — 在 App 顶层挂载一次即可.
 *
 * @param sourceFactory  注入 FileDropSource 工厂 (测试用); 默认 = createFileDropSource.
 * @param options.onFilePicked  drop 命中 markdown 时回调; 由调用方完成读文件.
 */
export function useFileDrop(
  sourceFactory: () => FileDropSource = createFileDropSource,
  options: UseFileDropOptions = {},
): void {
  const { t } = useTranslation(); // T18 (FR-02): 拖拽错误文案通过 t() 渲染.
  const enterCounterRef = useRef(0);
  const lastToastRef = useRef<{ key: string; ts: number } | null>(null);
  const source = useMemo(sourceFactory, [sourceFactory]);
  // 把 onFilePicked 稳定下来, 避免 useEffect deps 反复 mount/unmount 拖拽订阅.
  const onFilePickedRef = useRef<FilePickedHandler | undefined>(options.onFilePicked);
  useEffect(() => {
    onFilePickedRef.current = options.onFilePicked;
  }, [options.onFilePicked]);

  useEffect(() => {
    const unlisten = source.subscribe((event) => {
      switch (event.type) {
        case 'enter':
        case 'over': {
          enterCounterRef.current += 1;
          if (enterCounterRef.current === 1) setDragActiveAttr(true);
          return;
        }
        case 'leave': {
          enterCounterRef.current = Math.max(0, enterCounterRef.current - 1);
          if (enterCounterRef.current === 0) setDragActiveAttr(false);
          return;
        }
        case 'drop': {
          enterCounterRef.current = 0;
          setDragActiveAttr(false);
          handleDrop(event.paths);
          return;
        }
      }
    });
    return () => {
      enterCounterRef.current = 0;
      setDragActiveAttr(false);
      unlisten();
    };
  }, [source, t]);

  function handleDrop(paths: string[]): void {
    const rejectWithToast = (code: string, ext: string, key: string): void => {
      showDropToast(lastToastRef, key, t(formatDropError(code, { basename: '', ext })));
    };
    if (!Array.isArray(paths)) {
      rejectWithToast('PAYLOAD', '', 'PAYLOAD');
      return;
    }
    const picked = pickMarkdownPath(paths);
    if (!picked) {
      const ext = firstUnsupportedExt(paths);
      if (ext) {
        const key = `UNSUPPORTED:${ext}`;
        const msg = t(formatDropError('UNSUPPORTED_EXT', { basename: '', ext }), {
          ext,
          accepted: describeAcceptedExts(),
        });
        showDropToast(lastToastRef, key, msg);
      } else {
        rejectWithToast('EMPTY_PATHS', '', 'EMPTY_PATHS');
      }
      return;
    }
    // R-07 修复: 委托调用方 (App.tsx) 处理 — 通常是 useMarkdownDoc.loadFile.
    // 这里不再自行 readMarkdownFile / setContent / pushRecent, 因为 Reader 走 reducer state,
    // 自行写入会出现「docStore 已切换但 reducer 还显示旧文件」的窗口.
    const onFilePicked = onFilePickedRef.current;
    if (!onFilePicked) {
      // App 层未注册回调 — 安静不做事 (开发期 console.warn, 不阻塞 UI).
      console.warn(
        '[useFileDrop] dropped',
        picked,
        'but no onFilePicked handler is registered; pass options.onFilePicked=loadFile.',
      );
      return;
    }
    try {
      void Promise.resolve(onFilePicked(picked)).catch((err) => {
        // 调用方 (loadFile) 一般已经 pushToast 错误; 这里兜底再 toast 一次未知错误, 不重复报错.
        if (isCodeSupported(err)) return;
        const name = fileBasename(picked);
        showDropToast(
          lastToastRef,
          `DROP_ERR:UNKNOWN:${fileExtractExt(picked)}`,
          t(formatDropError('UNKNOWN', { basename: name, ext: fileExtractExt(picked) })),
        );
      });
    } catch (e) {
      console.warn('[useFileDrop] onFilePicked threw synchronously:', e);
    }
  }
}

export default useFileDrop;

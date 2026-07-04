/**
 * useFileDrop — 拖拽打开 Markdown 副作用 hook (F-02 / T05).
 * 设计依据: docs/design/compiled.md §3.1 + §3.3 + §3.4 + docs/plan/compiled.md Step 2.
 * 责任: 订阅 Tauri 2 拖拽事件 / 维护视觉态 / 编排 drop 业务链路 / 1s 去重 toast.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { getCurrentWebview } from '@tauri-apps/api/webview';

import { useDocStore } from '../stores/docStore';
import { useRecentStore } from '../stores/recentStore';
import { addRecentFile, readMarkdownFile } from '../lib/tauri';
import { pushToast } from '../lib/toast';
import { pickMarkdownPath } from '../lib/fileTypes';
import { basename as fileBasename, extractExt as fileExtractExt, firstUnsupportedExt, formatDropError, isAppErrorCode as isCodeSupported } from '../lib/fileDropHelpers';
import { describeAcceptedExts } from '../lib/fileTypes';

export type FileDropEvent =
  | { type: 'enter'; paths: string[] }
  | { type: 'over'; paths: string[] }
  | { type: 'drop'; paths: string[] }
  | { type: 'leave'; paths: string[] };

export interface FileDropSource {
  subscribe(handler: (event: FileDropEvent) => void): () => void;
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
 */
export function createFileDropSource(): FileDropSource {
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

/** useFileDrop — 在 App 顶层挂载一次即可. */
export function useFileDrop(sourceFactory: () => FileDropSource = createFileDropSource): void {
  const { t } = useTranslation(); // T18 (FR-02): 拖拽错误文案通过 t() 渲染.
  const enterCounterRef = useRef(0);
  const lastToastRef = useRef<{ key: string; ts: number } | null>(null);
  const source = useMemo(sourceFactory, [sourceFactory]);

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
    if (!Array.isArray(paths)) {
      showDropToast(lastToastRef, 'PAYLOAD', t(formatDropError('PAYLOAD', { basename: '', ext: '' })));
      return;
    }
    const picked = pickMarkdownPath(paths);
    if (!picked) {
      const ext = firstUnsupportedExt(paths);
      if (ext) {
        showDropToast(
          lastToastRef,
          `UNSUPPORTED:${ext}`,
          t(formatDropError('UNSUPPORTED_EXT', { basename: '', ext }), {
            ext,
            accepted: describeAcceptedExts(),
          }),
        );
      } else {
        showDropToast(lastToastRef, 'EMPTY_PATHS', t(formatDropError('EMPTY_PATHS', { basename: '', ext: '' })));
      }
      return;
    }
    void loadFromPath(picked);
  }

  // AC-04: 同步 close 早于 await readMarkdownFile, 避免 A/B 共存闪烁
  async function loadFromPath(path: string): Promise<void> {
    const name = fileBasename(path);
    useDocStore.getState().close();
    try {
      const content = await readMarkdownFile(path);
      const title = name.replace(/\.(md|markdown|mdx)$/i, '');
      useDocStore.getState().setContent({ path, title, content });
      useRecentStore.getState().pushRecent(path, title);
      addRecentFile(path, title).catch((err) => {
        console.warn('[useFileDrop] addRecentFile best-effort failed:', err);
      });
    } catch (err: unknown) {
      const code = isCodeSupported(err) ? err.code : 'UNKNOWN';
      const ctx = { basename: name, ext: fileExtractExt(path) };
      showDropToast(
        lastToastRef,
        `DROP_ERR:${code}:${ctx.ext}`,
        t(formatDropError(code, ctx), ctx),
      );
    }
  }
}

export default useFileDrop;

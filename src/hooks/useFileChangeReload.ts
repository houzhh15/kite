/**
 * useFileChangeReload — T26 (R-12 修复) "外部编辑器改回后刷新" 链路 hook.
 *
 * 设计依据:
 *   docs/design/compiled.md §3.4 (Reader 状态机) + R-04 (IPC 唯一出口) +
 *   需求 F-26 (Cmd/Ctrl+E 打开外部编辑器) 衍生 — F-26 解决"打开", 本 hook
 *   解决"打开后再回到 Kite 时拿到最新内容".
 *
 * 责任:
 *   - 监听 window 'focus' 事件 + document 'visibilitychange' 事件;
 *     触发时, 若 useDocStore.currentPath 存在, 调 getFileFresh(path) 拿回
 *     mtime + content, 与本地 lastMtimeMap[path] 对比: 磁盘更新才 dispatch
 *     loadFile. 这避免 mid-edit 闪烁 (内容未变不重 render).
 *   - 返回 reload() 给 Toolbar 手动按钮 / Cmd/Ctrl+R 快捷键调用;
 *     手动 reload 不做 mtime 短路检查, 强制 loadFile. loadFile 完成后
 *     自动用 getFileFresh 同步 mtime, 避免下一次 focus 重复刷新.
 *   - 提供 getMtime(path) 给外部测试断言 (test-only) 与未来单元测试.
 *
 * 行为约束 (设计 §3.4 P0):
 *   - 仅在 status === 'ok' (有当前 doc) 时触发; idle / loading / error 状态
 *     不发请求, 避免覆盖用户主动加载的中途态. status 由调用方注入
 *     (App.tsx 内 useMarkdownDoc().state.status), 避免 hook 内部再
 *     useMarkdownDoc() 拿到独立 hook 实例 (R-04 缓解).
 *   - 同一时刻多次 focus 抖动只让一个请求在飞 (useRef 'inflight' 闸);
 *     完成后释放, 下次 focus 再放行.
 *   - 切换文档 (loadFile 走新 path) 时, lastMtimeMap 用 path 隔离, 不需要清.
 *
 * mtime 跟踪策略:
 *   - 不在 docStore 加 mtime 字段 (避免污染现有 reducer / setContent 签名,
 *     减少 cross-file 改动面).
 *   - 改用本地 Map<path, lastMtime> 维护; getFileFresh 拿到的新 mtime 在
 *     触发 reload 后回写.
 *
 * 不在内部调 setContent / useMarkdownDoc.open; 通过传入的 loadFile(path)
 * 回调复用 useMarkdownDoc 已有的 runOpenRef 链路 (OPEN_OK + pushRecent +
 * setLastPath + history). 这保证 reload 行为与点 RecentList 完全一致,
 * 不破坏 Reader 滚动位置 / Outline 状态.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { getFileFresh, isAppError } from '../lib/tauri';
import { useDocStore } from '../stores/docStore';
import { pushToast } from '../lib/toast';
import type { MarkdownStatus } from '../types/markdown';

export interface UseFileChangeReloadApi {
  /**
   * 强制重读当前文档 (忽略 mtime 短路检查).
   * 给 Toolbar "刷新" 按钮 / Cmd/Ctrl+R 快捷键使用.
   * 行为: 若 currentPath 为空 / status !== 'ok' → 静默 no-op.
   * 副作用: loadFile 完成后自动 getFileFresh 同步 mtime, 避免下一次 focus
   * 触发重复刷新.
   */
  reload(): void;
  /**
   * 读取本地缓存的某路径 mtime. 仅供单元测试断言; 业务代码不需要.
   * 路径未访问过 → 返回 0.
   */
  getMtime(path: string): number;
}

export function useFileChangeReload(
  loadFile: (path: string) => Promise<void>,
  /** 当前文档状态. 由调用方 (App.tsx 内 useMarkdownDoc 拿到的 state.status) 注入,
   *  避免 hook 内部重复 useMarkdownDoc 拿到独立 hook 实例 (R-04 缓解). */
  status: MarkdownStatus,
): UseFileChangeReloadApi {
  const { t } = useTranslation();
  // 跟踪 in-flight 请求, 防止 focus 抖动产生并发请求.
  const inflightRef = useRef<Promise<void> | null>(null);
  // 按 path 隔离的 mtime 缓存. useRef (普通对象) 即足够 — 不需要触发 re-render.
  const lastMtimeMapRef = useRef<Map<string, number>>(new Map());

  /**
   * 静默 IPC 检查 + 选择性 loadFile.
   * - 状态非 ok → no-op.
   * - mtime 较新 → loadFile, 并把新 mtime 写回 Map.
   * - 错误 → push error toast; 不 throw.
   */
  const checkAndReload = useCallback(async (): Promise<void> => {
    const currentPath = useDocStore.getState().state.currentPath;
    if (!currentPath) return;
    if (status !== 'ok') return;
    if (inflightRef.current) return; // 闸: 已有请求在飞
    const promise = (async () => {
      try {
        const fresh = await getFileFresh(currentPath);
        const lastMtime = lastMtimeMapRef.current.get(currentPath) ?? 0;
        // mtime 较新才 dispatch. 防御性 > (而不是 !==) 兼容 mtime 精度回退的极端 case
        // (某些 fs 上 mtime 精度低于 1s, 但 as_secs 之后仍单调递增).
        if (fresh.mtime > lastMtime) {
          lastMtimeMapRef.current.set(currentPath, fresh.mtime);
          await loadFile(currentPath);
        }
      } catch (err) {
        // 静默: dev / web 环境下 IPCUnavailableError 不 toast.
        if (err instanceof Error && err.name === 'IPCUnavailableError') {
          return;
        }
        // 真实错误: 提示但不阻塞用户.
        const message = isAppError(err)
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
        pushToast({ kind: 'error', message: t('app.reloadFailed', { message }) });
      } finally {
        inflightRef.current = null;
      }
    })();
    inflightRef.current = promise;
    await promise;
  }, [loadFile, status, t]);

  /**
   * 强制 reload — 忽略 mtime 短路.
   * loadFile 完成后, 调 getFileFresh 同步最新 mtime, 避免下一次 focus
   * 重复刷新. 异步部分吞错 (不向 UI 抛).
   */
  const reload = useCallback((): void => {
    const currentPath = useDocStore.getState().state.currentPath;
    if (!currentPath) return;
    if (status !== 'ok') return;
    void (async () => {
      await loadFile(currentPath);
      // 同步 mtime (吞错: 下次 focus 自然会重新探).
      try {
        const fresh = await getFileFresh(currentPath);
        lastMtimeMapRef.current.set(currentPath, fresh.mtime);
      } catch {
        // ignore — focus 重试时会自己拉
      }
    })();
  }, [loadFile, status]);

  // 测试 / 调试用.
  const getMtime = useCallback((path: string): number => {
    return lastMtimeMapRef.current.get(path) ?? 0;
  }, []);

  // 焦点事件 + visibilitychange 事件. 两个事件覆盖的场景:
  //   - focus: macOS / Windows 用户 alt-tab 切回; linux wm 切回.
  //   - visibilitychange: 浏览器后台 → 前台 (macOS 全屏 app 切桌面时也走这里).
  // 用 useEffect + [checkAndReload] deps: checkAndReload 是稳定 useCallback
  // (loadFile 来自 useMarkdownDoc, 自身稳定), 不需要每 render 重新绑.
  useEffect(() => {
    const onFocus = (): void => {
      void checkAndReload();
    };
    const onVisibility = (): void => {
      // 过滤: 只在切到 visible 时检查; hidden 时跳过 (避免不必要 IPC).
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        void checkAndReload();
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', onFocus);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', onFocus);
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
    };
  }, [checkAndReload]);

  return { reload, getMtime };
}

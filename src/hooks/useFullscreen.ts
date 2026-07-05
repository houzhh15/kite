/**
 * useFullscreen — T16-P2 (FR-03) 全屏状态机.
 *
 * 设计依据: docs/design/compiled.md §3.3.4 + 需求 FR-03 / AC-03-1~5.
 *
 * 责任:
 *   - 内部状态 isFullscreen, 初始 false (不持久化, AC-03-5).
 *   - enter / exit / toggle: 优先 Tauri IPC `set_fullscreen`, 失败回退
 *     document.documentElement.requestFullscreen() (用于纯浏览器调试).
 *   - 同步 document.documentElement.dataset.fullscreen = 'true' | 'false'.
 *   - 监听 fullscreenchange 事件, 把外部切换同步到 hook state.
 *   - supported: 是否至少存在一种可行 API (Tauri IPC 或浏览器 Fullscreen API).
 *
 * 边界:
 *   - SSR / 无 document / 无 element 时返回 supported: false.
 *   - Tauri + 浏览器都不支持 → supported: false (按钮 disabled, AC-03-4).
 *   - 不写 prefStore, 不持久化; 每次启动恢复非全屏.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { FullscreenState } from '../lib/tauri';
import { isTauri } from '../lib/env';
import { setFullscreen as invokeSetFullscreen } from '../lib/tauri';

export interface UseFullscreenApi {
  isFullscreen: boolean;
  /** 切换; 内部按 isFullscreen 分派 enter / exit. */
  toggle: () => Promise<void>;
  enter: () => Promise<void>;
  exit: () => Promise<void>;
  /** 至少存在一种全屏 API (Tauri IPC 或浏览器 requestFullscreen). */
  supported: boolean;
}

function hasElementFullscreen(): boolean {
  if (typeof document === 'undefined') return false;
  const root = document.documentElement;
  return !!(
    root &&
    typeof (root as HTMLElement & { requestFullscreen?: () => Promise<void> })
      .requestFullscreen === 'function'
  );
}

export function useFullscreen(): UseFullscreenApi {
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const supportedRef = useRef<boolean>(true);

  // 初始化 supported: 优先检测 Tauri 运行时, 兜底浏览器 API.
  if (typeof window !== 'undefined' && supportedRef.current === true) {
    // 仅在首次执行时检测, 后续不变.
    supportedRef.current = isTauri() || hasElementFullscreen();
  }

  const setDataAttr = useCallback((val: boolean) => {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.fullscreen = val ? 'true' : 'false';
  }, []);

  const enterViaTauri = useCallback(async (): Promise<boolean> => {
    if (!isTauri()) return false;
    try {
      await invokeSetFullscreen(true);
      return true;
    } catch (e) {
      // safeInvoke rejects 是已知的 IPCUnavailable (浏览器场景已由 isTauri guard 拦
      // 截, 这里只能收到 Rust 真正返回的 AppError). 不抛给上层, 由 toggle 聚合失败.
      if (typeof console !== 'undefined') console.warn('[useFullscreen] tauri set_fullscreen(true) failed:', e);
      return false;
    }
  }, []);

  const enterViaElement = useCallback(async (): Promise<boolean> => {
    if (!hasElementFullscreen()) return false;
    try {
      await document.documentElement.requestFullscreen();
      return true;
    } catch {
      return false;
    }
  }, []);

  const exitViaTauri = useCallback(async (): Promise<boolean> => {
    if (!isTauri()) return false;
    try {
      await invokeSetFullscreen(false);
      return true;
    } catch (e) {
      if (typeof console !== 'undefined') console.warn('[useFullscreen] tauri set_fullscreen(false) failed:', e);
      return false;
    }
  }, []);

  const exitViaElement = useCallback(async (): Promise<boolean> => {
    if (typeof document === 'undefined') return false;
    if (!document.fullscreenElement) return true;
    try {
      await document.exitFullscreen();
      return true;
    } catch {
      return false;
    }
  }, []);

  const enter = useCallback(async (): Promise<void> => {
    if (await enterViaTauri()) {
      setIsFullscreen(true);
      setDataAttr(true);
      return;
    }
    if (await enterViaElement()) {
      setIsFullscreen(true);
      setDataAttr(true);
      return;
    }
    // 全部失败: 保持 false, 不抛错 (前端调用方若想知道可读 supported).
  }, [enterViaTauri, enterViaElement, setDataAttr]);

  const exit = useCallback(async (): Promise<void> => {
    if (await exitViaTauri()) {
      setIsFullscreen(false);
      setDataAttr(false);
      return;
    }
    if (await exitViaElement()) {
      setIsFullscreen(false);
      setDataAttr(false);
      return;
    }
  }, [exitViaTauri, exitViaElement, setDataAttr]);

  const toggle = useCallback(async (): Promise<void> => {
    if (isFullscreen) {
      await exit();
    } else {
      await enter();
    }
  }, [isFullscreen, enter, exit]);

  // 监听 fullscreenchange, 同步外部切换 (如 Esc 退出).
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onChange = (): void => {
      const isFs = !!document.fullscreenElement;
      setIsFullscreen(isFs);
      setDataAttr(isFs);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
    };
  }, [setDataAttr]);

  // 卸载时确保 data-fullscreen 属性复位, 避免残留.
  useEffect(() => {
    return () => {
      setDataAttr(false);
    };
  }, [setDataAttr]);

  return {
    isFullscreen,
    toggle,
    enter,
    exit,
    supported: supportedRef.current,
  };
}

/** 适配 FullscreenState 类型, 方便上层组件按状态机驱动 props. */
export function toFullscreenState(
  api: Pick<UseFullscreenApi, 'isFullscreen'>,
): FullscreenState {
  return {
    isFullscreen: api.isFullscreen,
    since: api.isFullscreen ? Date.now() : null,
  };
}

export default useFullscreen;
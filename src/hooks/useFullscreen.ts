/**
 * useFullscreen — T16-P2 (FR-03) 全屏状态机.
 *
 * 设计依据: docs/design/compiled.md §3.3.4 + 需求 FR-03 / AC-03-1~5.
 *
 * 责任:
 *   - 内部状态 isFullscreen, 初始 false (不持久化, AC-03-5).
 *   - enter / exit / toggle: 优先 Tauri getCurrent().setFullscreen,
 *     try/catch 回退到 document.documentElement.requestFullscreen().
 *   - 同步 document.documentElement.dataset.fullscreen = 'true' | 'false'.
 *   - 监听 fullscreenchange 事件, 把外部切换同步到 hook state.
 *   - supported: 是否至少存在一种可行 API.
 *
 * 边界:
 *   - SSR / 无 document / 无 element 时返回 supported: false.
 *   - Tauri API 不可用 + 浏览器不支持 → supported: false (按钮 disabled, AC-03-4).
 *   - 不写 prefStore, 不持久化; 每次启动恢复非全屏.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { FullscreenState } from '../lib/tauri';

export interface UseFullscreenApi {
  isFullscreen: boolean;
  /** 切换; 内部按 isFullscreen 分派 enter / exit. */
  toggle: () => Promise<void>;
  enter: () => Promise<void>;
  exit: () => Promise<void>;
  /** 至少存在一种全屏 API (Tauri setFullscreen 或浏览器 requestFullscreen). */
  supported: boolean;
}

/** Tauri 2 全局对象 (类型守卫用). */
interface TauriGlobal {
  /** 当前窗口 setFullscreen 调用面 — 仅在 Tauri WebView 中暴露. */
  core?: {
    invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  };
  window?: {
    getCurrent?: () => {
      setFullscreen: (full: boolean) => Promise<void> | void;
    };
  };
}

function getTauriWindowApi(): TauriGlobal['window'] | null {
  if (typeof window === 'undefined') return null;
  // Tauri 2 在 window 上挂 __TAURI__; window.getCurrent() 通过
  // @tauri-apps/api/window 提供. 这里尝试直接读取.
  const t = (window as unknown as { __TAURI__?: TauriGlobal }).__TAURI__;
  return t?.window ?? null;
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

  // 初始化 supported: 优先 Tauri, 兜底浏览器 API.
  if (typeof window !== 'undefined' && supportedRef.current === true) {
    // 仅在首次执行时检测, 后续不变.
    supportedRef.current = !!getTauriWindowApi() || hasElementFullscreen();
  }

  const setDataAttr = useCallback((val: boolean) => {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.fullscreen = val ? 'true' : 'false';
  }, []);

  const enterViaTauri = useCallback(async (): Promise<boolean> => {
    const api = getTauriWindowApi();
    if (!api?.getCurrent) return false;
    try {
      await api.getCurrent().setFullscreen(true);
      return true;
    } catch {
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
    const api = getTauriWindowApi();
    if (!api?.getCurrent) return false;
    try {
      await api.getCurrent().setFullscreen(false);
      return true;
    } catch {
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
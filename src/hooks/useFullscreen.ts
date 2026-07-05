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

/**
 * hasTauriRuntime — 检测当前是否运行在 Tauri 2 原生 WebView 内.
 * v2 在 window 上挂 `__TAURI_INTERNALS__` (私有 IPC 桥); 注意 v1 时代的
 * `window.__TAURI__` 在 v2 默认 withGlobalTauri=false, 不可作为检测标志.
 */
function hasTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  return '__TAURI_INTERNALS__' in (window as unknown as Record<string, unknown>);
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

// Tauri 2 不在 window 上挂 setFullscreen 这种全局 API; 想调用需
// 动态 import @tauri-apps/api/window 的 getCurrentWindow().本期仅做
// 环境检测 + 浏览器回退, 与原行为一致: 即便在原生 WebView 里也走
// requestFullscreen / exitFullscreen. 后续如需真正调用 Tauri 全屏
// API 可作为单独改进 (不在本次 "浏览器调试" scope).
export function useFullscreen(): UseFullscreenApi {
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const supportedRef = useRef<boolean>(true);

  // 初始化 supported: 优先检测 Tauri 运行时, 兜底浏览器 API.
  if (typeof window !== 'undefined' && supportedRef.current === true) {
    // 仅在首次执行时检测, 后续不变.
    supportedRef.current = hasTauriRuntime() || hasElementFullscreen();
  }

  const setDataAttr = useCallback((val: boolean) => {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.fullscreen = val ? 'true' : 'false';
  }, []);

  const enterViaTauri = useCallback(async (): Promise<boolean> => {
    // Tauri 2 不在 window 上挂 setFullscreen 全局 API; 真要调用需动态
    // import @tauri-apps/api/window 的 getCurrentWindow().setFullscreen().
    // 本期 "浏览器调试" scope 不引入该路径; 当前实现等同于直接走 element
    // fallback (即与 v1 时代检测 __TAURI__.window 永远 undefined 时的行为一致).
    // 保留该函数仅为维持 enterViaTauri → enterViaElement 的优先链, 便于后
    // 续单独改进时插入 Tauri 调用面而不破坏调用方.
    return false;
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
    // 同 enterViaTauri: 暂未启用 Tauri 路径.
    return false;
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
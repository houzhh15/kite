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
import { useTranslation } from 'react-i18next';

import type { FullscreenState } from '../lib/tauri';
import { isTauri } from '../lib/env';
import { setFullscreen as invokeSetFullscreen } from '../lib/tauri';
import { pushToast } from '../lib/toast';

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
  const { t } = useTranslation();
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

  /**
   * 把 Rust 实际状态同步到 hook, 并在 requested !== actual 时显式 toast.
   * 单独抽出, enter/exit 都用, 让逻辑一致.
   *
   * @param requested 调用者期望的目标状态 (true=进入全屏 / false=退出全屏).
   * @param actual   Rust 回读的窗口真实状态.
   */
  const applyTauriResult = useCallback(
    (requested: boolean, actual: boolean): boolean => {
      if (actual === requested) {
        setIsFullscreen(actual);
        setDataAttr(actual);
        return true;
      }
      // 平台静默 no-op (典型: macOS 窗口失焦 / 动画期间); 显式告诉用户,
      // 而不是让按钮 aria-pressed 与实际状态错乱.
      setIsFullscreen(actual);
      setDataAttr(actual);
      pushToast({
        kind: 'info',
        message: requested
          ? t('fullscreen.failed.enter')
          : t('fullscreen.failed.exit'),
      });
      return false;
    },
    [setDataAttr, t],
  );

  const enterViaTauri = useCallback(async (): Promise<boolean> => {
    if (!isTauri()) return false;
    try {
      const result = await invokeSetFullscreen(true);
      // result = {requested: true, actual: window.is_fullscreen()}.
      return applyTauriResult(true, result.actual);
    } catch (e) {
      // IPC 报错 (例如窗口未找到 / 权限拒绝), 转换为 user-friendly toast.
      const msg = e instanceof Error ? e.message : String(e);
      pushToast({ kind: 'error', message: t('fullscreen.ipcFailed', { msg }) });
      return false;
    }
  }, [applyTauriResult, t]);

  const enterViaElement = useCallback(async (): Promise<boolean> => {
    if (!hasElementFullscreen()) return false;
    try {
      await document.documentElement.requestFullscreen();
      // 浏览器路径: fullscreenchange 事件后 isFullscreen 才更新, 由监听器负责,
      // 这里只需要返回是否调用成功; 不主动写 state.
      return true;
    } catch {
      pushToast({ kind: 'error', message: t('fullscreen.browserFailed') });
      return false;
    }
  }, [t]);

  const exitViaTauri = useCallback(async (): Promise<boolean> => {
    if (!isTauri()) return false;
    try {
      const result = await invokeSetFullscreen(false);
      return applyTauriResult(false, result.actual);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      pushToast({ kind: 'error', message: t('fullscreen.ipcFailed', { msg }) });
      return false;
    }
  }, [applyTauriResult, t]);

  const exitViaElement = useCallback(async (): Promise<boolean> => {
    if (typeof document === 'undefined') return false;
    if (!document.fullscreenElement) return true;
    try {
      await document.exitFullscreen();
      // browser 路径: fullscreenchange listener 负责 state.
      return true;
    } catch {
      pushToast({ kind: 'error', message: t('fullscreen.browserFailed') });
      return false;
    }
  }, [t]);

  const enter = useCallback(async (): Promise<void> => {
    if (await enterViaTauri()) {
      // hook state 已在 enterViaTauri 内部校正为 Tauri 回读的实际值,
      // 避免与浏览器 fullscreenchange 冲突; 这里不再覆盖.
      return;
    }
    if (await enterViaElement()) {
      // browser 路径: fullscreenchange listener 会负责更新 state.
      setIsFullscreen(true);
      setDataAttr(true);
      return;
    }
    // 全部失败: 显式 toast (此前是 silent, 用户看到按钮没反应).
    pushToast({ kind: 'error', message: t('fullscreen.unsupported') });
  }, [enterViaTauri, enterViaElement, setDataAttr, t]);

  const exit = useCallback(async (): Promise<void> => {
    if (await exitViaTauri()) {
      return;
    }
    if (await exitViaElement()) {
      // browser 路径: fullscreenchange listener 负责.
      setIsFullscreen(false);
      setDataAttr(false);
      return;
    }
    pushToast({ kind: 'error', message: t('fullscreen.unsupported') });
  }, [exitViaTauri, exitViaElement, setDataAttr, t]);

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
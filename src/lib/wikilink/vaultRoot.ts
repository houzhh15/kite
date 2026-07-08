/**
 * useVaultRoot — vault 根路径状态 hook (F-29 / FR-03).
 *
 * 设计依据: docs/design/compiled.md §3.3.
 *
 * 责任:
 *   - 组合 `usePrefStore`(持久化模式) + `useDocStore`(当前文件目录 fallback) 暴露
 *     `{ root, mode, setMode, setCustomPath, refresh }`.
 *   - 派生逻辑 (pure helper `deriveVaultRoot`):
 *       custom 模式 + 合法 customPath → customPath
 *       否则 → path.posix.dirname(currentPath)
 *       都无 → null (降级为不可点链接, AC-03-3).
 *   - 路径语义统一 `path.posix` (NFR-18).
 *
 * 纪律:
 *   - 不直接调 IPC; 持久化由 usePreferences hook 300ms debounce 自动触发.
 *   - 不引入新 store; 沿用 usePrefStore 扩展 (FR-03 / NFR-11).
 */

import { useMemo } from 'react';
import * as path from 'path';

import { usePrefStore, isValidVaultPath } from '../../stores/prefStore';
import { useDocStore } from '../../stores/docStore';

export type VaultRootMode = 'follow-current' | 'custom';

export interface VaultRootApi {
  /** 计算后的有效根路径. custom 模式无合法值时降级为 follow-current; 无当前文件时为 null. */
  root: string | null;
  /** 用户配置的 mode. */
  mode: VaultRootMode;
  /** 切换 mode (T27 内部直接走 usePrefStore.setVaultRootMode). */
  setMode(mode: VaultRootMode): void;
  /**
   * 写入自定义路径. 校验失败 console.warn + 忽略 (AC-03-4).
   * 接受 null 表示清空 (回到 follow-current 模式).
   */
  setCustomPath(p: string | null): void;
  /**
   * 强制从 currentPath 重新派生 (外部修改 currentPath 后无需主动调,
   * 订阅机制自动生效). 保留接口以备未来扩展.
   */
  refresh(): void;
}

/**
 * deriveVaultRoot — 纯函数.
 *
 * @param mode 'follow-current' | 'custom'
 * @param customPath 用户配置的自定义路径 (可空)
 * @param currentPath 当前打开文件的绝对路径 (可空)
 * @returns 计算后的 vault 根路径或 null
 */
export function deriveVaultRoot(
  mode: VaultRootMode,
  customPath: string | null,
  currentPath: string | null,
): string | null {
  if (mode === 'custom' && isValidVaultPath(customPath)) {
    return customPath;
  }
  if (typeof currentPath === 'string' && currentPath.length > 0) {
    const dir = path.posix.dirname(currentPath);
    if (dir && dir !== '/' && dir !== '.') return dir;
    if (dir === '/') return '/';
  }
  return null;
}

/**
 * useVaultRoot — hook 入口.
 */
export function useVaultRoot(): VaultRootApi {
  const mode = usePrefStore((s) => s.prefs.vaultRootMode);
  const customPath = usePrefStore((s) => s.prefs.vaultRootCustom);
  const setMode = usePrefStore((s) => s.setVaultRootMode);
  const setCustomPathAction = usePrefStore((s) => s.setVaultRootCustom);
  const currentPath = useDocStore((s) => s.state.currentPath);

  const root = useMemo(
    () => deriveVaultRoot(mode, customPath, currentPath),
    [mode, customPath, currentPath],
  );

  return {
    root,
    mode,
    setMode,
    setCustomPath: (p: string | null) => setCustomPathAction(p),
    // refresh 占位: useDocStore 订阅已自动触发 useMemo 重算; 保留 API 形态以备未来扩展.
    refresh: () => {
      /* no-op; 订阅机制自动生效 */
    },
  };
}

export default useVaultRoot;

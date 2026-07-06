/**
 * recentDirsService — 最近目录服务入口 (F-27 / T25).
 *
 * 设计依据: docs/design/compiled.md §3.1 / §2.2.3 + docs/plan/compiled.md Step 2.
 *
 * 责任:
 *   - 暴露 `load()` 作为应用启动期 hydrate 入口.
 *   - 封装 store 调用, 让 App.tsx 不直接 import store / tauri.
 *   - 失败仅 console.warn, 不抛错 / 不阻塞首屏 (NFR-S-01).
 *
 * 纪律:
 *   - 不在内部调 IPC, 由 useRecentDirsStore 间接完成 (R-04 单一来源).
 *   - 不持有状态; 仅一次性的 hydrate 包装.
 */

import { useRecentDirsStore } from '../stores/recentDirsStore';

/**
 * load — 启动期 hydrate 最近目录列表.
 *
 * 由 App.tsx 在 useEffect mount 中调用一次; 失败仅 console.warn,
 * 不影响首屏渲染.
 */
export async function load(): Promise<void> {
  await useRecentDirsStore.getState().load();
}

export const recentDirsService = {
  load,
};

export default recentDirsService;

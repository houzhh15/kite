/**
 * src/lib/env.ts — 运行时环境检测 (单一出口)
 *
 * 设计依据: docs/design/compiled.md §3.1 + R-04 单一来源纪律.
 *
 * 为什么需要这个文件:
 *   KITE 在两种宿主里跑同一份前端 bundle:
 *     1. Tauri 2 原生 WebView (生产 / `cargo tauri dev`) —
 *        启动时 Tauri 会往 window 上注入 `window.__TAURI_INTERNALS__`
 *        (v2 的私有 IPC 桥, 包含 invoke / metadata / transformCallback 等).
 *     2. 纯浏览器 (开发者手动打开 http://localhost:1420) —
 *        没有上述全局, `@tauri-apps/api/*` 调用会立刻抛
 *        "Cannot read properties of undefined (reading 'invoke')".
 *
 *   在浏览器场景下, 任何**启动期同步**触发的 IPC 调用 (例如
 *   useFileDrop.subscribe 里的 getCurrentWebview()) 会让 React 整个
 *   App 卸载, 用户看到空白页.
 *
 * 纪律:
 *   - 所有需要环境分支的代码统一走 `isTauri()` 这一处;
 *     不要在业务模块里各自实现 `window.__TAURI__` 检测 (那是 v1 标志,
 *     v2 默认 withGlobalTauri=false, 永远读不到).
 *   - 检测目标固定为 `window.__TAURI_INTERNALS__` (v2 私有但跨 minor
 *     稳定的运行时桥). 后续 Tauri 团队若改名, 只需要改本文件一处.
 *   - 不在本模块里做 IPC 包装: 调用方仍走 src/lib/tauri.ts 里的具名
 *     函数, 由 `lib/tauri.ts` 内部统一调用 `isTauri()` 短路. 这样保
 *     持 R-04 "IPC 唯一出口" 的纪律.
 *
 * 边界:
 *   - SSR / jsdom 等 window 不存在环境: 一律返回 false (按浏览器分支).
 *   - 单元测试里通过 `vi.stubGlobal('window', ...)` 注入自定义 window
 *     时, 应同时按需 stub `__TAURI_INTERNALS__`; 不在本文件里 hack
 *     测试设置, 让 vitest 自然暴露 (想测 Tauri 分支就在 setup 加挂载).
 */

export function isTauri(): boolean {
  if (typeof window === 'undefined') return false;
  return '__TAURI_INTERNALS__' in window;
}

/**
 * Tauri 2 在原生 WebView 启动时注入的运行时桥对象 (私有).
 * 仅用于类型守卫 / 反射; 业务代码不应直接调用其上的方法 (应走
 * @tauri-apps/api/* 包装的具名函数, 由它们在内部读这个对象).
 */
export interface TauriInternals {
  invoke: (cmd: string, args?: Record<string, unknown>, options?: unknown) => Promise<unknown>;
  metadata: { currentWindow: { label: string }; currentWebview: { label: string } };
  transformCallback: <T>(callback: (response: T) => void, once: boolean) => number;
  unregisterCallback: (id: number) => void;
}

/** 强类型守卫: window.__TAURI_INTERNALS__ 存在且形状合理. */
export function getTauriInternals(): TauriInternals | null {
  if (typeof window === 'undefined') return null;
  const internals = (window as unknown as { __TAURI_INTERNALS__?: TauriInternals })
    .__TAURI_INTERNALS__;
  if (!internals || typeof internals.invoke !== 'function') return null;
  return internals;
}

export default isTauri;
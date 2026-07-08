/**
 * src/lib/wikilink/loadFileRef.ts — wikilink 跳转链路共享 loadFile (T28 / F-46 / FR-03).
 *
 * 设计依据: docs/design/compiled.md §3.3.4.
 *
 * 问题:
 *   - `useMarkdownDoc` 是 React hook, reducer state 与 inflightRef 是局部变量.
 *     不同组件调用 `useMarkdownDoc()` 拿到的是不同实例.
 *   - App.tsx 是唯一拥有"绑定到 Reader 的 useMarkdownDoc 实例"的组件.
 *   - WikilinkLink 嵌套在 MarkdownRenderer 内, 无法通过 props 拿到 App 的 loadFile
 *     (要穿透 4+ 层).
 *
 * 解决:
 *   - 在 App.tsx 顶层 useEffect 把 loadFile 写入模块级 ref;
 *   - WikilinkLink onClick 通过 readWikilinkLoadFile() 取.
 *   - 卸载时清空 (防御性).
 *
 * 纪律:
 *   - 模块级单例 ref, 仅作为逃生通道; 不暴露 setter 给业务模块.
 *   - 测试可通过 vi.mock('./loadFileRef', ...) 注入 fake loadFile.
 */

let currentLoadFile: ((path: string) => Promise<void>) | null = null;

/** 设置当前 loadFile (由 App.tsx 顶层 useEffect 调用). */
export function setWikilinkLoadFile(fn: ((path: string) => Promise<void>) | null): void {
  currentLoadFile = fn;
}

/** 读取当前 loadFile. 返回 null 表示 App 尚未挂载 (测试 / SSR 场景). */
export function readWikilinkLoadFile(): ((path: string) => Promise<void>) | null {
  return currentLoadFile;
}
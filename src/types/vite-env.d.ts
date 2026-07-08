/**
 * Vite client types — 仅用于 TypeScript 编译时识别 ?raw 等 Vite 专属后缀.
 *
 * 真正的实现由 Vite 在运行时提供; 这里只是声明 ambient module.
 */
declare module '*.css?raw' {
  const content: string;
  export default content;
}

declare module '*.css' {
  const content: string;
  export default content;
}

// Node 内置模块 'path' 的最小 ambient 声明.
// 项目未安装 @types/node (NFR-13 / 不引入新依赖); 仅声明 wikilink 解析实际
// 调用的方法. 该声明对齐 node:path 形态, 避免 TS 找不到模块错误.
declare module 'path' {
  export function resolve(...segments: string[]): string;
  export function dirname(p: string): string;
  export function relative(from: string, to: string): string;
  export function isAbsolute(p: string): boolean;
  export namespace posix {
    export function join(...segments: string[]): string;
    export function dirname(p: string): string;
    export function relative(from: string, to: string): string;
    export function isAbsolute(p: string): boolean;
  }
}

declare module 'node:fs' {
  export function readFileSync(path: string, encoding: string): string;
}

declare module 'node:path' {
  // 最小集: 仅声明项目 wikilink / F-15 兼容路径实际使用的方法.
  export function resolve(...segments: string[]): string;
  export function dirname(path: string): string;
  export function relative(from: string, to: string): string;
  export function isAbsolute(path: string): boolean;
  // posix 命名空间 (vault 路径跨平台统一语义, NFR-18).
  export namespace posix {
    export function join(...segments: string[]): string;
    export function dirname(path: string): string;
    export function relative(from: string, to: string): string;
    export function isAbsolute(path: string): boolean;
  }
}

declare module '*.png' {
  const src: string;
  export default src;
}
declare module '*.svg' {
  const src: string;
  export default src;
}
declare module '*.jpg' {
  const src: string;
  export default src;
}
declare module '*.jpeg' {
  const src: string;
  export default src;
}
declare module '*.webp' {
  const src: string;
  export default src;
}
declare module '*.gif' {
  const src: string;
  export default src;
}

declare module 'node:url' {
  export function fileURLToPath(url: string): string;
}
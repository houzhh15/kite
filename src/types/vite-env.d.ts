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

declare module 'node:fs' {
  export function readFileSync(path: string, encoding: string): string;
}

declare module 'node:path' {
  export function resolve(...segments: string[]): string;
  export function dirname(path: string): string;
}

declare module 'node:url' {
  export function fileURLToPath(url: string): string;
}
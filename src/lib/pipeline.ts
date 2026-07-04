/**
 * src/lib/pipeline.ts — Markdown 渲染插件链 (T12 → T17-P2 演进)
 *
 * 设计依据: docs/design/compiled.md §3.1 / §3.5 / §3.6.
 *
 *   REMARK_PLUGINS / REHYPE_PLUGINS — 静态常量, default-off 等价物 (T12 baseline).
 *     - remarkGfm + remarkInlineMarks (T07) 恒定.
 *     - rehypeHighlight 14 种语言白名单 (T13 step-05a).
 *     保留目的是: 旧测试 `expect(REMARK_PLUGINS).toEqual([remarkGfm, remarkInlineMarks])`;
 *     MarkdownRenderer 在 flag 尚未注入前的兜底.
 *
 *   buildRemarkPlugins(flags) / buildRehypePlugins(flags) — T17-P2 新增工厂函数.
 *     - 基础链始终存在 (T12 不动).
 *     - flags.katex === true 时动态 import 'remark-math' + 'rehype-katex' + 'katex/dist/katex.min.css'.
 *     - flags.mermaid === true 时动态 import 'rehype-mermaid'.
 *     - 异步返回 Promise<PluggableList>; MarkdownRenderer 通过 useAsyncPluginMemo 缓存,
 *       key={flagsHash} 触发 remount, 重建插件链.
 *
 *   COMMON_LANGS / COMMON_LANG_KEYS — 14 种高亮语言字典 (T13 baseline; alias 转发保持兼容).
 *
 * 关键纪律 (F-32 / AC-04-2 / AC-06-2):
 *   - 此文件 **禁止** import `rehype-raw` 或任何会让原始 HTML 进入 DOM 的插件.
 *     由 scripts/check-deps.mjs + eslint no-restricted-imports 双重保护.
 *   - 动态 import 写在工厂函数体内, 让 vite manualChunks 产出 mermaid-vendor / katex-vendor
 *     独立 chunk, 关闭态主入口不引入这两个 vendor (FR-04 / AC-04-3).
 */

import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import bash from 'highlight.js/lib/languages/bash';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import rust from 'highlight.js/lib/languages/rust';
import python from 'highlight.js/lib/languages/python';
import go from 'highlight.js/lib/languages/go';
import yaml from 'highlight.js/lib/languages/yaml';
import sql from 'highlight.js/lib/languages/sql';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';

import { remarkInlineMarks } from './inline/remarkInlineMarks';
import { urlSafe } from './inline/urlSafe';
import { COMMON_LANG_KEYS as COMMON_LANG_KEYS_SOURCE } from './highlightLanguages';

/** remark 插件链 (mdast 阶段) — T12 baseline, default-off 等价物.
 *  remarkInlineMarks 受 lib/featureFlags 控制 (高亮/上下标), 不需要外部 props. */
export const REMARK_PLUGINS = [remarkGfm, remarkInlineMarks] as const;

/** rehype 插件链 (hast 阶段) — T12 baseline, default-off 等价物.
 *  14 种语言白名单: ts, tsx, js, jsx, json, css, html, md, bash, rust, python, go, yaml, sql */
export const REHYPE_PLUGINS = [
  [
    rehypeHighlight,
    {
      languages: {
        ts: typescript,
        tsx: typescript,
        js: javascript,
        jsx: javascript,
        json,
        css,
        html: xml,
        md: markdown,
        bash,
        rust,
        python,
        go,
        yaml,
        sql,
      },
    },
  ],
] as const;

/** rehypeHighlight 预注册的语言字典; keys 即 markdown ``` 后缀.
 *  共 14 种 (T08 step-0a 落地, FR-1 + 设计 §3.2.2 契约). */
export const COMMON_LANGS = {
  ts: typescript,
  tsx: typescript,
  js: javascript,
  jsx: javascript,
  json,
  css,
  html: xml,
  md: markdown,
  bash,
  rust,
  python,
  go,
  yaml,
  sql,
} as const;

/** 14 种语言的全集 (T13 step-05a 集中; 由 highlightLanguages.ts 派生). */
export const COMMON_LANG_KEYS: ReadonlyArray<keyof typeof COMMON_LANGS> =
  COMMON_LANG_KEYS_SOURCE;

/** T17-P2 (F-21/F-22): 工厂入参. 与 featureFlags 的 mermaid / katex 字段对齐. */
export interface PipelineFlags {
  mermaid: boolean;
  katex: boolean;
}

/** T17-P2 (F-21/F-22): remark 插件工厂.
 *  - 基础链 [remarkGfm, remarkInlineMarks] 恒定.
 *  - flags.katex === true → 追加 remarkMath (动态 import).
 *  返回值类型为 unknown[] 以兼容 react-markdown 的 Pluggable 联合类型. */
export async function buildRemarkPlugins(
  flags: PipelineFlags,
): Promise<unknown[]> {
  const plugins: unknown[] = [remarkGfm, remarkInlineMarks];
  if (flags.katex) {
    const mod = await import('remark-math');
    plugins.push(mod.default);
  }
  return plugins;
}

/** T17-P2 (F-21/F-22): rehype 插件工厂.
 *  - 基础链 [[rehypeHighlight, { languages: COMMON_LANGS }]] 恒定.
 *  - flags.mermaid === true → 追加 rehypeMermaid (动态 import).
 *  - flags.katex === true → 追加 [rehypeKatex, { strict, throwOnError }] + 副作用
 *    动态 import 'katex/dist/katex.min.css' (CSS 注入).
 *  返回值类型为 unknown[] 以兼容 react-markdown 的 Pluggable 联合类型.
 *
 *  关键: 动态 import 在 vite 编译时被识别为 code-split 点, manualChunks 把
 *  mermaid / katex / remark-math / rehype-katex / rehype-mermaid 路由到独立
 *  vendor chunk (vite.config.ts#manualChunks). 由于 import 是动态的, Rollup
 *  不会把 vendor 静态提升到 index 入口 (AC-04-3 关闭态不下载 vendor).
 *  MermaidBlock 同样使用动态 import + new Function('m', 'return import(m)')
 *  包裹确保 mermaid-vendor 也不进 index 入口. */
export async function buildRehypePlugins(
  flags: PipelineFlags,
): Promise<unknown[]> {
  const plugins: unknown[] = [
    [rehypeHighlight, { languages: COMMON_LANGS }],
  ];
  if (flags.mermaid) {
    const mod = await import('rehype-mermaid');
    plugins.push(mod.default);
  }
  if (flags.katex) {
    const mod = await import('rehype-katex');
    plugins.push([
      mod.default,
      { strict: 'ignore', throwOnError: false },
    ]);
    // 副作用: katex CSS 按需注入 (随 chunk 加载, 关闭态不进主入口).
    await import('katex/dist/katex.min.css');
  }
  return plugins;
}

/**
 * T19 (FR-03 / AC-03-1/2/3): react-markdown 的 URL 改写钩子.
 *
 * 在 AST 阶段对所有 `<a href>` / `<img src>` 调用 urlSafe; 危险协议
 * (javascript:/vbscript:/file:/data:text/html…) 已被 urlSafe 改写为 `#`,
 * 形成前端双层防御之一.
 *
 * 契约:
 *   - 输入("https://example.com") → 原样返回
 *   - 输入("javascript:alert(1)") → 返回 "#"
 *   - 输入("data:text/html,...")   → 返回 "#"
 *   - 输入("data:image/png;base64,xxx") → 原样返回 (ImageHandler 接管)
 *   - 输入("#section")             → 原样返回 (锚点)
 *
 * react-markdown v9 字段名为 `urlTransform`; pipeline.ts 同时导出
 * `transformUrl` 别名, 兼容未来 v10+ 重命名为 `transformUrl`.
 */
export function transformUrl(url: string): string {
  return urlSafe(url).href;
}
/**
 * src/lib/pipeline.ts — Markdown 渲染插件链 (T12 → T17-P2 演进)
 *
 * 设计依据: docs/design/compiled.md §3.1 / §3.5 / §3.6.
 *
 *   REMARK_PLUGINS / REHYPE_PLUGINS — 静态常量, default-off 等价物 (T12 baseline).
 *     - remarkGfm + remarkInlineMarks (T07) 恒定.
 *     - rehypeHighlight 14 种语言白名单 (T13 step-05a).
 *     保留目的是: 旧测试 `expect(REMARK_PLUGINS).toEqual([remarkGfm, remarkInlineMarks, remarkHtmlToText])`;
 *     MarkdownRenderer 在 flag 尚未注入前的兜底.
 *
 *   buildRemarkPlugins() / buildRehypePlugins() — 公式始终启用，但 vendor 仍动态加载.
 *     Mermaid 围栏由 MarkdownRenderer 的 lazy MermaidBlock 接管.
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
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
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
import { remarkHtmlToText } from './inline/remarkHtmlToText';
import { urlSafe } from './inline/urlSafe';
import { remarkWikilink } from './wikilink/remarkWikilink';
import { COMMON_LANG_KEYS as COMMON_LANG_KEYS_SOURCE } from './highlightLanguages';

/** remark 插件链 (mdast 阶段) — T12 baseline, default-off 等价物.
 *  remarkInlineMarks 受 lib/featureFlags 控制 (高亮/上下标), 不需要外部 props.
 *  remarkHtmlToText: 把 html 节点 (如 <!-- comment -->) 转为 text 节点,
 *  避免渲染为 DOM Comment (CSS 无法选中). */
export const REMARK_PLUGINS = [remarkGfm, remarkInlineMarks, remarkHtmlToText] as const;

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
/**
 * CommonMark 会在插件阶段前吞掉 `\\[` / `\\(` 的反斜杠，因此在解析边界把它们
 * 规范化为 remark-math 原生分隔符。扫描器跳过 fenced code 与 inline code。
 */
export function normalizeLatexDelimiters(markdown: string): string {
  let fenced = false;
  let fenceChar = '';
  let fenceLength = 0;

  return markdown
    .split('\n')
    .map((line) => {
      const fence = line.match(/^\s*(`{3,}|~{3,})/);
      if (fence) {
        const marker = fence[1];
        if (!fenced) {
          fenced = true;
          fenceChar = marker[0];
          fenceLength = marker.length;
        } else if (marker[0] === fenceChar && marker.length >= fenceLength) {
          fenced = false;
        }
        return line;
      }
      if (fenced) return line;

      const display = line.match(/^(\s*)\\\[([\s\S]*?)\\\]\s*$/);
      if (display) {
        return `${display[1]}$$\n${display[2].trim()}\n${display[1]}$$`;
      }

      let result = '';
      let inlineTicks = 0;
      for (let i = 0; i < line.length; i += 1) {
        if (line[i] === '`') {
          let run = 1;
          while (line[i + run] === '`') run += 1;
          inlineTicks = inlineTicks === 0 ? run : inlineTicks === run ? 0 : inlineTicks;
          result += line.slice(i, i + run);
          i += run - 1;
          continue;
        }
        if (inlineTicks === 0 && line[i] === '\\' && i + 1 < line.length) {
          const delimiter = line[i + 1];
          if (delimiter === '[' || delimiter === ']') {
            result += '$$';
            i += 1;
            continue;
          }
          if (delimiter === '(' || delimiter === ')') {
            result += '$';
            i += 1;
            continue;
          }
        }
        result += line[i];
      }
      return result;
    })
    .join('\n');
}

/** 公式始终启用；同步插件链保证普通 Markdown 首帧无 loading 闪烁。 */
export function buildRemarkPlugins(): unknown[] {
  return [remarkGfm, remarkInlineMarks, remarkHtmlToText, remarkMath, remarkWikilink];
}

/** KaTeX 始终启用；Mermaid 围栏仍由 lazy MermaidBlock 接管。 */
export function buildRehypePlugins(): unknown[] {
  return [
    [rehypeHighlight, { languages: COMMON_LANGS }],
    [rehypeKatex, { strict: 'ignore', throwOnError: false }],
  ];
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
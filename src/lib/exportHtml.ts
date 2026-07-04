/**
 * lib/exportHtml.ts — T16-P2 (FR-01) 前端 HTML 拼装器.
 *
 * 设计依据: docs/design/compiled.md §3.3.3 + 需求 FR-01 / NFR-S-01~03 / AC-01-1,5.
 *
 * 责任:
 *   - buildHtml(input) 把 markdown 原文 + 主题 + 图片 base64 字典
 *     拼成单文件自包含 .html 字符串.
 *   - 模板包含: <!DOCTYPE html>、<meta charset>、<meta viewport>、
 *     <style> 主题 CSS 变量、<style> 高亮 CSS、<article>...</article>、
 *     顶部 <!-- skipped: ... --> 注释.
 *   - 内嵌安全: escapeHtml 双保险, 即便上游漏转义 <script> 也不会执行 (NFR-S-01).
 *
 * 安全 (F-32 / NFR-S-01):
 *   - 不挂 rehype-raw, 不解析原始 HTML.
 *   - escapeHtml 对所有 html content 再转义一次 (双保险).
 *
 * 边界:
 *   - skippedImages: 大于 MAX_IMAGE_BASE64_BYTES 的图片跳过并保留原 URL,
 *     注释注入 HTML <head>.
 *   - 输入 basePath 可空: 远程 / data: / 空 basePath → 不走 IPC 解析,
 *     相对路径在 resolveImages 阶段忽略.
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

import { resolveImagePath } from './tauri';

/** HTML 单文件自包含 payload 体积上限 (设计 §3.4.1 / NFR-P-01). */
export const MAX_HTML_BYTES = 5 * 1024 * 1024;

/** 单张图片 base64 嵌入上限 — 超过则跳过并保留原 URL (设计 §4.3 / NFR-S-03). */
export const MAX_IMAGE_BASE64_BYTES = 5 * 1024 * 1024;

/** Markdown 文档主题 — 与 useTheme theme 同步, 默认 'light'. */
export type ExportTheme = 'light' | 'dark' | 'sepia';

/** BuildHtmlInput — buildHtml 入参 (设计 §3.3.3). */
export interface BuildHtmlInput {
  /** docStore.content — markdown 原文. */
  content: string;
  /** 文档所在目录绝对路径, 用于解析相对图片; 可空. */
  basePath: string | null;
  /** 主题: 'light' | 'dark' | 'sepia'. */
  theme: ExportTheme;
  /** 主题 CSS 变量键值对; 例 { '--color-bg': '...' }. */
  cssVars: Record<string, string>;
  /** highlight.css 内嵌文本. */
  highlightCss: string;
  /** 文档标题 (注入 <title> 与 <h1>). */
  title?: string;
}

/**
 * 已解析的远程 / base64 数据 URI 字典.
 * key 是 markdown 里的原 src 字符串; value 是替换后的 URL.
 */
export type ImageMap = Record<string, string>;

/**
 * escapeHtml — HTML 转义 (NFR-S-01 双保险).
 *
 * 不使用依赖, 内联实现以保证零运行时依赖 + 在 vitest/jsdom 中稳定.
 */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * renderMarkdownToHtml — 把 markdown 原文转成未转义的 HTML 字符串.
 *
 * 使用 react-markdown (default 不挂 rehype-raw) + renderToStaticMarkup.
 * <script> 在源头被 react 自动转义为文本节点.
 */
function renderMarkdownToHtml(md: string): string {
  return renderToStaticMarkup(
    React.createElement(ReactMarkdown, {
      remarkPlugins: [remarkGfm],
      rehypePlugins: [rehypeHighlight],
      children: md,
    }),
  );
}

/**
 * 收集 html 中所有 `<img src="...">` 引用. 远程 / data: / asset: 直接保留.
 */
function collectRelativeImages(html: string): string[] {
  const out: string[] = [];
  const re = /<img[^>]*\ssrc="([^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const src = m[1];
    if (!src) continue;
    if (/^(https?:|data:|asset:)/i.test(src)) continue;
    out.push(src);
  }
  return Array.from(new Set(out));
}

/**
 * resolveImages — 把 html 中的相对路径图片解析为 base64 / data URI.
 *
 * 行为:
 *   - basePath 为空 → 返回空映射 (远程 / data: 图片保留).
 *   - 单张图片 > 5 MB → 跳过, 不进 images map, 返回 skipped 列表.
 *   - 解析失败 (NotFound / 等) → 跳过, 计入 skipped, 保留原 URL.
 */
export async function resolveImages(
  html: string,
  basePath: string | null,
): Promise<{ images: ImageMap; skipped: string[] }> {
  const images: ImageMap = {};
  const skipped: string[] = [];
  const refs = collectRelativeImages(html);
  if (!basePath || refs.length === 0) {
    return { images, skipped };
  }
  for (const rel of refs) {
    try {
      const dataUri = await resolveImagePath(basePath, rel);
      if (dataUri.startsWith('data:')) {
        const approxBytes = dataUri.length;
        if (approxBytes > MAX_IMAGE_BASE64_BYTES) {
          skipped.push(rel);
        } else {
          images[rel] = dataUri;
        }
      } else {
        images[rel] = dataUri;
      }
    } catch {
      skipped.push(rel);
    }
  }
  return { images, skipped };
}

/**
 * injectImages — 把 ImageMap 中的 src 替换到 html 字符串.
 */
function injectImages(html: string, images: ImageMap): string {
  let out = html;
  for (const [src, replacement] of Object.entries(images)) {
    if (!replacement) continue;
    const escaped = src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`src="${escaped}"`, 'g'), `src="${replacement}"`);
  }
  return out;
}

/**
 * buildHtml — 拼装最终 HTML 字符串.
 *
 * 流水线:
 *   1. markdown → html (react-markdown + remark-gfm + rehype-highlight).
 *   2. resolveImages → 收集 relative img src, 走 IPC 拿 base64.
 *   3. injectImages → 替换.
 *   4. neutralizeDangerousTags 双保险 (NFR-S-01): 对 <script>/<iframe> 等
 *      危险开放标签做 escape.
 *   5. 模板包 <!DOCTYPE html><html data-theme><head>...</head><body>...</body></html>.
 */
export async function buildHtml(input: BuildHtmlInput): Promise<string> {
  const { content, basePath, theme, cssVars, highlightCss, title } = input;
  // 1) render markdown -> html
  const rawHtml = renderMarkdownToHtml(content);
  // 2) resolve images
  const { images, skipped } = await resolveImages(rawHtml, basePath);
  // 3) inject image map
  const injected = injectImages(rawHtml, images);
  // 4) 双保险 (NFR-S-01)
  const safeHtml = neutralizeDangerousTags(injected);

  const cssVarLines = Object.entries(cssVars)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n');

  const themeAttr = `data-theme="${escapeHtml(theme)}"`;
  const titleTag = title ? `<title>${escapeHtml(title)}</title>` : '';

  const skippedComment =
    skipped.length > 0
      ? `\n<!-- skipped images (over 5MB or unreadable):\n${skipped
          .map((s) => `  - ${escapeHtml(s)}`)
          .join('\n')}\n-->\n`
      : '';

  return [
    '<!DOCTYPE html>',
    `<html lang="zh-CN" ${themeAttr}>`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    titleTag,
    `<style>:root {\n${cssVarLines}\n}\n${themeCssOverrides(theme)}</style>`,
    `<style>${highlightCss}</style>`,
    '</head>',
    '<body>',
    '<article class="prose-kite">',
    safeHtml,
    '</article>',
    skippedComment,
    '</body>',
    '</html>',
  ].join('\n');
}

/**
 * neutralizeDangerousTags — 把危险开放标签转义掉, 双保险 (NFR-S-01).
 */
function neutralizeDangerousTags(html: string): string {
  const dangerous = /<\s*\/?\s*(script|iframe|object|embed|svg|math)\b[^>]*>/gi;
  return html.replace(dangerous, (m) => escapeHtml(m));
}

/**
 * themeCssOverrides — 按主题覆写 :root 变量.
 */
function themeCssOverrides(theme: ExportTheme): string {
  if (theme === 'dark') {
    return [
      '.dark, [data-theme="dark"] {',
      '  --color-bg: 15 23 42;',
      '  --color-fg: 226 232 240;',
      '  --color-accent: 96 165 250;',
      '}',
    ].join('\n');
  }
  if (theme === 'sepia') {
    return [
      '[data-theme="sepia"] {',
      '  --color-bg: 244 232 210;',
      '  --color-fg: 80 50 30;',
      '  --color-accent: 165 80 30;',
      '}',
    ].join('\n');
  }
  return '';
}

export default buildHtml;
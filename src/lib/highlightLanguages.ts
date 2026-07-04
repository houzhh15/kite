/**
 * src/lib/highlightLanguages.ts — T13 step-05a (FR-04)
 *
 * 集中导出 highlight.js 14 种语言白名单.
 * 由 src/lib/pipeline.ts 引用以组装 rehypeHighlight languages 字典.
 *
 * 设计依据: docs/design/compiled.md §3.2.2 + docs/requirements/compiled.md §FR-04.
 *
 * 14 种语言 (T08 step-0a 已落地):
 *   ts, tsx, js, jsx, json, css, html, md, bash, rust, python, go, yaml, sql
 *
 * 与 architecture_design §10 一致: 仅注册这些语言, 其余视为纯文本.
 * 非白名单语言仍输出 <pre><code> 结构, 不抛错, 但无 token 着色 (AC-04-2).
 *
 * 纪律 (N12):
 *   - 唯一允许新增语言白名单的地方; pipeline.ts 不再内联.
 *   - 不在 CommonLangKey 出现处允许自由合并; 若新增需维护 products/<lang>.d.ts 兼容.
 */
export const COMMON_LANG_KEYS = [
  'ts',
  'tsx',
  'js',
  'jsx',
  'json',
  'css',
  'html',
  'md',
  'bash',
  'rust',
  'python',
  'go',
  'yaml',
  'sql',
] as const;

export type CommonLangKey = (typeof COMMON_LANG_KEYS)[number];

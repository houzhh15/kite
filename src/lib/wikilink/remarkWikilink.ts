/**
 * src/lib/wikilink/remarkWikilink.ts — 自研 remark 插件 (T28 / F-46 / FR-01).
 *
 * 设计依据: docs/design/compiled.md §3.1.
 *
 * 责任 (mdast 阶段):
 *   - 遍历 Root 中的所有 `text` 节点 (递归), 把文本中的 `[[...]]` 字面量
 *     切分为 [前缀 text, wikilink 自定义节点, 后缀 text, ...].
 *   - wikilink 节点 type='wikilink', 通过 data.hName='span' + data.hProperties
 *     把 `data-wikilink` / `data-anchor` / `data-alias` 透传到 hast;
 *     children 显示文本 = alias ?? target.
 *   - 解析失败 (parseWikilink 返回 null) → 该段保留为普通 text 节点,
 *     不抛错、不 console.error (设计 §3.1.2 第 4 步).
 *   - 跳过 `code` / `inlineCode` 节点 (避免切分代码块/行内代码中的 [[...]]).
 *
 * 不引入第三方库 (F-31 / F-32); unist-util-visit 通过 remark-gfm 间接可用.
 *
 * 纪律:
 *   - 纯函数: (options?) => (tree: Root) => void.
 *   - 同步执行 (无 IPC、无异步).
 *   - options.parse 允许注入测试用 parser, 默认 parseWikilink.
 */

import type { Root, Text, PhrasingContent } from 'mdast';

import { parseWikilink, type ParsedWikilink } from './parseWikilink';

/** 自定义 wikilink mdast 节点 (type='wikilink'). */
export interface WikilinkNode extends Parent {
  type: 'wikilink';
  data?: {
    hName: 'span';
    hProperties: {
      'data-wikilink': string;
      'data-anchor'?: string;
      'data-alias'?: string;
    };
  };
  children: PhrasingContent[];
}

/** 插件选项. */
export interface RemarkWikilinkOptions {
  /** 可选 parser 注入 (测试用), 默认 parseWikilink. */
  parse?: (raw: string) => ParsedWikilink | null;
}

/** 匹配 `[[...]]` 字面量 (非贪婪). 注意: `[[` 与 `]]` 之间不允许出现 `[` 或 `]`. */
const WIKILINK_RE = /\[\[([^\[\]]+?)\]\]/g;

/** 把单个 text 节点按 wikilink 切分为 PhrasingContent[]. */
function splitTextByWikilink(textNode: Text, parse: (raw: string) => ParsedWikilink | null): PhrasingContent[] {
  const value = textNode.value;
  if (typeof value !== 'string' || value.length < 4) return [textNode];
  WIKILINK_RE.lastIndex = 0;
  if (!WIKILINK_RE.test(value)) return [textNode];
  WIKILINK_RE.lastIndex = 0;

  const out: PhrasingContent[] = [];
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = WIKILINK_RE.exec(value)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    const raw = m[0];
    // 前缀 text
    if (start > cursor) {
      out.push({ type: 'text', value: value.slice(cursor, start) });
    }
    const parsed = parse(raw);
    if (parsed === null) {
      // 解析失败 → 保留原文不替换, 维持 AC-01-3 语义
      out.push({ type: 'text', value: raw });
    } else {
      const wn: WikilinkNode = {
        type: 'wikilink',
        data: {
          hName: 'span',
          hProperties: {
            'data-wikilink': parsed.target,
            ...(parsed.anchor !== undefined ? { 'data-anchor': parsed.anchor } : {}),
            ...(parsed.alias !== undefined ? { 'data-alias': parsed.alias } : {}),
          },
        },
        children: [{ type: 'text', value: parsed.alias ?? parsed.target }],
      };
      out.push(wn as unknown as PhrasingContent);
    }
    cursor = end;
  }
  // 后缀 text
  if (cursor < value.length) {
    out.push({ type: 'text', value: value.slice(cursor) });
  }
  return out;
}

/**
 * remarkWikilink — 插件入口.
 *
 * 签名: `(options?) => (tree: Root) => void`.
 * 不直接走 unified Plugin<> 复杂签名, 由 pipeline.ts 与 MarkdownRenderer 直接调用.
 */
export function remarkWikilink(options?: RemarkWikilinkOptions): (tree: Root) => void {
  const parse = options?.parse ?? parseWikilink;
  return (tree: Root): void => {
    // 防御性递归: 不依赖 unist-util-visit (它在某些 mdast 形态下会触发 'children' in undefined).
    // 我们只关心 text 节点的 wikilink 切分, 跳过 code/inlineCode 容器即可.
    walk(tree, parse);
  };
}

function walk(node: unknown, parse: (raw: string) => ParsedWikilink | null): void {
  if (node === null || typeof node !== 'object') return;
  const n = node as { type?: string; children?: unknown[]; value?: string };
  if (n.type === 'code' || n.type === 'inlineCode') return; // 跳过代码容器
  if (n.type === 'text' && typeof n.value === 'string') {
    // 已经是 wikilink 节点不再切分 (避免重复).
    const segments = splitTextByWikilink({ type: 'text', value: n.value } as Text, parse);
    if (segments.length === 1 && segments[0] === n) return;
    // 替换当前位置 — 但 walk 中我们没有 parent 引用, 改为原地 mutate.
    // 这里改为只对直接调用方 (Root 顶级) 处理 — Root 的 children 替换是支持的.
    return;
  }
  if (Array.isArray(n.children)) {
    // 收集 text 节点的 segments, 在循环结束后批量替换.
    const children = n.children as unknown[];
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child === null || typeof child !== 'object') continue;
      const c = child as { type?: string; value?: string };
      if (c.type === 'text' && typeof c.value === 'string') {
        const segments = splitTextByWikilink(c as Text, parse);
        if (segments.length > 1 || segments[0] !== c) {
          children.splice(i, 1, ...segments);
          i += segments.length - 1;
        }
      } else {
        // 递归到非 text 容器 (注意: 不要递归到已替换的 wikilink 节点).
        if (c.type !== 'wikilink') {
          walk(child, parse);
        }
      }
    }
  }
}

export default remarkWikilink;
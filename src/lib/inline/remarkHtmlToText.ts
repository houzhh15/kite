/**
 * src/lib/inline/remarkHtmlToText.ts — remark 插件: 把 html 节点转为 text 节点.
 *
 * 背景:
 *   remark-parse 把 markdown 里的 HTML 语法 (如 `<!-- comment -->`) 解析为
 *   mdast `html` 节点. 没有 rehype-raw 时, remark-rehype 把它转成 hast `raw` 节点,
 *   react-markdown 最终渲染成 DOM Comment 节点 (<!-- ... -->).
 *
 *   Comment 节点不是 Element, CSS 选择器无法命中 — T27 (R-14) 的 user-select
 *   白名单对它无效, 导致 `<!-- AUTO:... -->` 这类文字无法选中.
 *
 * 修法:
 *   在 remark 阶段把 `html` 节点转为 `text` 节点. 这样 remark-rehype 把它当
 *   普通文字处理, 最终渲染为 <p> 内的文本节点 — 白名单 .prose-kite p 自然覆盖.
 *
 * 安全:
 *   不引入 rehype-raw, 不执行 HTML. 只是把原始 HTML 字符串当纯文字输出.
 *   与 F-32 / AC-04-2 纪律一致.
 */

import type { Plugin } from 'unified';
import type { Root, Parent, HTML, Text } from 'mdast';

/** 递归遍历 mdast 树, 把所有 html 节点替换为 text 节点. */
function walkAndReplace(node: Root | Parent): void {
  if (!('children' in node) || !Array.isArray(node.children)) return;
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    if (child.type === 'html') {
      // 把 html 节点替换为 text 节点, 原始 HTML 字符串当纯文字.
      node.children[i] = { type: 'text', value: (child as HTML).value } as Text;
    } else if ('children' in child) {
      walkAndReplace(child as Parent);
    }
  }
}

export const remarkHtmlToText: Plugin<[], Root> = () => {
  return (tree: Root) => {
    walkAndReplace(tree);
  };
};

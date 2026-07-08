import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import remarkGfm from 'remark-gfm';
import { visit } from 'unist-util-visit';

import { remarkInlineMarks } from '/Users/tshinjeii/oss/kite/src/lib/inline/remarkInlineMarks.ts';
import { remarkHtmlToText } from '/Users/tshinjeii/oss/kite/src/lib/inline/remarkHtmlToText.ts';
import { remarkWikilink } from '/Users/tshinjeii/oss/kite/src/lib/wikilink/remarkWikilink.ts';

const md = `---
type: entity
title: "AICon"
slug: aicon
---

# AICon

AICon 是一个 AI 技术会议品牌.

## 来自 sources/pinecone-nexus-rag-end

文章末尾推荐了 AICon 上海站 2026.

(来源：[[sources/pinecone-nexus-rag-end]])
`;

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkInlineMarks)
  .use(remarkHtmlToText)
  .use(remarkWikilink);

const mdast = processor.parse(md);
processor.runSync(mdast);

// Dump all wikilink nodes
visit(mdast, (node) => {
  if (node.type === 'wikilink') {
    console.log('Found wikilink:', JSON.stringify(node));
  }
});
console.log('--- DONE ---');

// Also dump the AST for the last paragraph (the one with the wikilink)
const lastPara = mdast.children[mdast.children.length - 1];
console.log('Last paragraph:', JSON.stringify(lastPara, null, 2));

import React from 'react';
import { renderToString } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { remarkInlineMarks } from '/Users/tshinjeii/oss/kite/src/lib/inline/remarkInlineMarks.ts';
import { remarkHtmlToText } from '/Users/tshinjeii/oss/kite/src/lib/inline/remarkHtmlToText.ts';
import { remarkWikilink } from '/Users/tshinjeii/oss/kite/src/lib/wikilink/remarkWikilink.ts';

const StubWikilinkNode = (props) => {
  return React.createElement('button', { type: 'button', className: 'wikilink', 'data-wikilink': props['data-wikilink'] }, props.children);
};

const md = `(来源：[[sources/pinecone-nexus-rag-end]])`;

const html = renderToString(
  React.createElement(ReactMarkdown, {
    remarkPlugins: [remarkGfm, remarkInlineMarks, remarkHtmlToText, remarkWikilink],
    components: {
      wikilink: StubWikilinkNode,
    },
    children: md,
  })
);
console.log('--- RENDERED HTML ---');
console.log(html);

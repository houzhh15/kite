import React from 'react';
import { renderToString } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { remarkInlineMarks } from '/Users/tshinjeii/oss/kite/src/lib/inline/remarkInlineMarks.ts';
import { remarkHtmlToText } from '/Users/tshinjeii/oss/kite/src/lib/inline/remarkHtmlToText.ts';
import { remarkWikilink } from '/Users/tshinjeii/oss/kite/src/lib/wikilink/remarkWikilink.ts';

const md = `(来源：[[sources/pinecone-nexus-rag-end]])`;

// Inline element that logs the props for debugging.
const DebugWikilink = (props) => {
  console.log('[WikilinkNode] props:', JSON.stringify(props, null, 2));
  return React.createElement('button', { type: 'button', className: 'wikilink' }, props.children);
};

const html = renderToString(
  React.createElement(ReactMarkdown, {
    remarkPlugins: [remarkGfm, remarkInlineMarks, remarkHtmlToText, remarkWikilink],
    components: {
      wikilink: DebugWikilink,
    },
    children: md,
  })
);

console.log('--- RENDERED HTML ---');
console.log(html);

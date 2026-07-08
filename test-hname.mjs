import React from 'react';
import { renderToString } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';

const wikilink = () => (tree) => {
  const walk = (node) => {
    if (node.type === 'text' && node.value.includes('[[')) {
      const m = node.value.match(/\[\[([^\[\]]+?)\]\]/);
      if (m) {
        const idx = node.value.indexOf('[[');
        const before = node.value.slice(0, idx);
        const after = node.value.slice(idx + m[0].length);
        const wn = {
          type: 'wikilink',
          data: {
            hName: 'wikilink',
            hProperties: { 'data-wikilink': m[1] }
          },
          children: [{ type: 'text', value: m[1] }],
        };
        const parent = tree;
        const i = parent.children.indexOf(node);
        parent.children.splice(i, 1, { type: 'text', value: before }, wn, { type: 'text', value: after });
      }
    }
    if (node.children) node.children.forEach(walk);
  };
  walk(tree);
};

const DebugWikilink = (props) => {
  return React.createElement('button', { type: 'button', className: 'wikilink' }, '>>', props.children, '<<');
};

const md = `(来源：[[sources/pinecone-nexus-rag-end]])`;
const html = renderToString(
  React.createElement(ReactMarkdown, {
    remarkPlugins: [remarkGfm, wikilink],
    components: { wikilink: DebugWikilink },
    children: md,
  })
);
console.log('--- RENDERED HTML ---');
console.log(html);

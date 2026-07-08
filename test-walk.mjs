import { remarkWikilink } from '/Users/tshinjeii/oss/kite/src/lib/wikilink/remarkWikilink.ts';

const tree = {
  type: 'root',
  children: [
    {
      type: 'paragraph',
      children: [
        { type: 'text', value: '(来源：[[sources/pinecone-nexus-rag-end]])' },
      ],
    },
  ],
};

remarkWikilink()(tree);
console.log('After walk, tree:', JSON.stringify(tree, null, 2));

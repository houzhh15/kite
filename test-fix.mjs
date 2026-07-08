import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import remarkGfm from 'remark-gfm';

import { remarkWikilink } from '/Users/tshinjeii/oss/kite/src/lib/wikilink/remarkWikilink.ts';

const md = `(来源：[[sources/pinecone-nexus-rag-end]])`;

const hast = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkWikilink)
  .use(remarkRehype, { allowDangerousHtml: false })
  .runSync(unified().use(remarkParse).use(remarkGfm).parse(md));

console.log(JSON.stringify(hast, null, 2));

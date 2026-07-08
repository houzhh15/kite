import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { remarkInlineMarks } from '/Users/tshinjeii/oss/kite/src/lib/inline/remarkInlineMarks.ts';
import { remarkHtmlToText } from '/Users/tshinjeii/oss/kite/src/lib/inline/remarkHtmlToText.ts';
import { remarkWikilink } from '/Users/tshinjeii/oss/kite/src/lib/wikilink/remarkWikilink.ts';

const md = '(来源：[[sources/pinecone-nexus-rag-end]])';
const mdast = unified().use(remarkParse).use(remarkGfm).use(remarkInlineMarks).use(remarkHtmlToText).use(remarkWikilink).runSync(unified().use(remarkParse).use(remarkGfm).parse(md));
console.log('=== full chain ===');
console.log(JSON.stringify(mdast, null, 2));

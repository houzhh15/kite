import { describe, it, expect } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import remarkGfm from 'remark-gfm';

import { remarkInlineMarks } from '../../lib/inline/remarkInlineMarks';
import { remarkHtmlToText } from '../../lib/inline/remarkHtmlToText';
import { remarkWikilink } from '../../lib/wikilink/remarkWikilink';

describe('pipeline debug', () => {
  it('runs the same plugin chain as MarkdownRenderer', async () => {
    const md = '(来源：[[sources/pinecone-nexus-rag-end]])';

    const processor = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkInlineMarks)
      .use(remarkHtmlToText)
      .use(remarkWikilink);

    const mdast = processor.parse(md);
    await processor.run(mdast);
    console.log('=== mdast ===');
    console.log(JSON.stringify(mdast, null, 2));

    const hast = await unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkInlineMarks)
      .use(remarkHtmlToText)
      .use(remarkWikilink)
      .use(remarkRehype)
      .run(processor.parse(md));

    console.log('=== hast ===');
    console.log(JSON.stringify(hast, null, 2));

    expect(true).toBe(true);
  });
});

/**
 * T10 DOM diff 解耦验证 (step-8d).
 *
 * 设计依据: docs/design/compiled.md §3.3.3 + 需求 FR-06 / AC-02-3 / NFR-04-2.
 *
 * 覆盖:
 *   - 关键字为空 → DOM 中无 <mark>, 与无 wrapper 基线 hash 一致.
 *   - hits 为空数组 → 同上.
 *   - 切换 query 从非空到空 → 自动清除 mark, DOM 回到基线.
 *   - remarkPlugins / rehypePlugins 未改 (NFR-04-2): 通过表格 / 代码块渲染验证.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useState, type JSX } from 'react';

import { SearchHighlight } from '../searchHighlight';
import { useSearch, __resetSearchForTest } from '../../hooks/useSearch';

afterEach(() => {
  cleanup();
  __resetSearchForTest();
});

describe('DOM diff 解耦验证 (step-8d)', () => {
  it('query="" 时: 渲染无 <mark>, 与无 SearchHighlight 等价 (DOM 结构稳定)', () => {
    const content = 'hello world';

    // 基线: 不挂 SearchHighlight
    const baseline = render(
      <article data-testid="article">
        <ReactMarkdown>{content}</ReactMarkdown>
      </article>,
    );
    const baselineHTML = baseline.container.innerHTML;
    baseline.unmount();

    // 受测: 挂 SearchHighlight 但 query=""
    const { container: c2 } = render(
      <SearchHighlight hits={[]} currentIndex={0} patternQuery="">
        <article data-testid="article">
          <ReactMarkdown>{content}</ReactMarkdown>
        </article>
      </SearchHighlight>,
    );
    // 受测不应引入 <mark.search-hit>.
    expect(c2.querySelectorAll('mark.search-hit').length).toBe(0);
    // 内部 article 内容应当与基线完全一致 (DOM hash 一致, AC-02-3).
    // baselineHTML 是 article 的 outerHTML, 我们用 innerHTML 对齐.
    const baselineInner = baselineHTML.replace(/^<article[^>]*>/, '').replace(/<\/article>$/, '');
    const wrappedArticle = c2.querySelector('[data-testid="article"]')?.innerHTML ?? '';
    expect(wrappedArticle).toBe(baselineInner);
  });

  it('hits=[] 时: 渲染无 <mark>', () => {
    const content = 'hello world';
    const { container } = render(
      <SearchHighlight hits={[]} currentIndex={0} patternQuery="hello">
        <article>
          <ReactMarkdown>{content}</ReactMarkdown>
        </article>
      </SearchHighlight>,
    );
    expect(container.querySelectorAll('mark.search-hit').length).toBe(0);
  });

  it('query 非空 → 命中段包裹; query 清空 → mark 自动清除', () => {
    function Harness(): JSX.Element {
      const [q, setQ] = useState('hello');
      const hits = q === '' ? [] : [{ index: 0, start: 0, length: 5 }];
      return (
        <>
          <button type="button" data-testid="clear" onClick={() => setQ('')}>
            clear
          </button>
          <SearchHighlight hits={hits} currentIndex={0} patternQuery={q}>
            <article>
              <ReactMarkdown>hello world</ReactMarkdown>
            </article>
          </SearchHighlight>
        </>
      );
    }
    const { container, getByText } = render(<Harness />);
    expect(container.querySelectorAll('mark.search-hit').length).toBe(1);
    act(() => {
      getByText('clear').click();
    });
    expect(container.querySelectorAll('mark.search-hit').length).toBe(0);
  });

  it('插件链未改: 表格 + 代码块 正常渲染 (NFR-04-2)', () => {
    const md = [
      '# Title',
      '',
      '| A | B |',
      '| - | - |',
      '| cell1 | cell2 |',
      '',
      '```js',
      'console.log("hi");',
      '```',
    ].join('\n');
    const { container } = render(
      <SearchHighlight hits={[]} currentIndex={0} patternQuery="">
        <article>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown>
        </article>
      </SearchHighlight>,
    );
    expect(container.querySelector('h1')?.textContent).toBe('Title');
    expect(container.querySelector('table')).toBeTruthy();
    expect(container.querySelector('pre')).toBeTruthy();
    expect(container.querySelectorAll('mark.search-hit').length).toBe(0);
  });

  it('与 useSearch 单例 store 联动: query 清空 → wrapper 返回 {} 等价行为', async () => {
    function Harness({ content }: { content: string }): JSX.Element {
      const { hits, currentIndex, query, options } = useSearch(content);
      return (
        <SearchHighlight
          hits={hits}
          currentIndex={currentIndex}
          patternQuery={query}
          patternCaseSensitive={!!options.caseSensitive}
          patternWholeWord={!!options.wholeWord}
          patternRegex={!!options.regex}
        >
          <article>
            <ReactMarkdown>{content}</ReactMarkdown>
          </article>
        </SearchHighlight>
      );
    }
    function QuerySetter({ q }: { q: string }): JSX.Element {
      const { setQuery } = useSearch();
      return (
        <button type="button" data-testid="set" onClick={() => setQuery(q)}>
          set
        </button>
      );
    }
    function App2(): JSX.Element {
      const [q, setQ] = useState('foo');
      return (
        <>
          <button type="button" data-testid="toggle" onClick={() => setQ('')}>
            toggle
          </button>
          <Harness content="foo bar baz" />
          <QuerySetter q={q} />
        </>
      );
    }
    const { container, getByText } = render(<App2 />);
    // set query='foo'
    act(() => {
      getByText('set').click();
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(container.querySelectorAll('mark.search-hit').length).toBeGreaterThanOrEqual(1);
    // 切空
    act(() => {
      getByText('toggle').click();
    });
    act(() => {
      // QuerySetter 也需要被告知清空. 但 QuerySetter 用 props q, 没有监听.
      // 简化: 直接调 useSearch 的 close 也行. 这里我们 toggle 触发 setQ('').
      getByText('set').click(); // 这会让 query 变 ''
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(container.querySelectorAll('mark.search-hit').length).toBe(0);
  });
});
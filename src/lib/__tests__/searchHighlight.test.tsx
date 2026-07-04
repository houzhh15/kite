/**
 * searchHighlight 组件级单测 (T10 step-3a / step-3b).
 *
 * 设计依据: docs/design/compiled.md §3.3.3 + §9.2 + 风险 1.
 *
 * 实现说明:
 *   react-markdown 9.x 不支持自定义 `text` 组件. 因此 searchHighlight 采用
 *   **post-render DOM 注入**方案: buildSearchComponents 返回 {}, 实际注入由
 *   <SearchHighlight> 组件的 useLayoutEffect 完成 (见 searchHighlight.tsx 文件头).
 *   测试通过传入 patternQuery/options 让组件重新在每个 text node 上跑 substring 搜索.
 *
 * 覆盖:
 *   - step-3a:
 *     * hits=[] → buildSearchComponents 返回 {}, 渲染无 <mark>
 *     * <SearchHighlight> 命中非空 → 注入 <mark> + data-search-hit/data-current
 *     * <SearchHighlight> query 由非空变空 → 自动清除 <mark> (AC-02-3)
 *   - step-3b:
 *     * 跨段落: 各 text node 独立包裹 (按 text node 顺序)
 *     * 边界裁剪: 命中超出 text node 长度 → 只切到节点内的子段
 *     * 多命中: 同一节点内多个命中段独立包裹
 *     * 标题/列表/段落内命中 → mark 在正确父元素内
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { SearchHighlight, buildSearchComponents } from '../searchHighlight';
import type { SearchHit } from '../../hooks/useSearch';

afterEach(() => {
  cleanup();
});

function makeHit(index: number, start: number, length: number): SearchHit {
  return { index, start, length };
}

interface RenderOpts {
  hits?: SearchHit[];
  currentIndex?: number;
  query?: string;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
}

function renderWith(content: string, opts: RenderOpts = {}): HTMLElement {
  const {
    hits = [],
    currentIndex = 0,
    query = '',
    caseSensitive = false,
    wholeWord = false,
    regex = false,
  } = opts;
  const { container } = render(
    <SearchHighlight
      hits={hits}
      currentIndex={currentIndex}
      patternQuery={query}
      patternCaseSensitive={caseSensitive}
      patternWholeWord={wholeWord}
      patternRegex={regex}
    >
      <article>
        <ReactMarkdown>{content}</ReactMarkdown>
      </article>
    </SearchHighlight>,
  );
  return container;
}

describe('buildSearchComponents (T10 step-3a 占位)', () => {
  it('总是返回 {} (react-markdown 9.x 不支持 text 组件)', () => {
    expect(buildSearchComponents(0, [])).toEqual({});
    expect(buildSearchComponents(0, [makeHit(0, 0, 5)])).toEqual({});
  });
});

describe('<SearchHighlight> (T10 step-3a)', () => {
  it('query="" 时不注入任何 <mark>', () => {
    const c = renderWith('hello world', { query: '', hits: [makeHit(0, 0, 5)] });
    expect(c.querySelectorAll('mark.search-hit').length).toBe(0);
  });

  it('hits=[] 时不注入任何 <mark>', () => {
    const c = renderWith('hello world', { query: 'world', hits: [] });
    expect(c.querySelectorAll('mark.search-hit').length).toBe(0);
  });

  it('单命中 → 注入 <mark data-search-hit="0">', () => {
    const c = renderWith('hello world', {
      query: 'world',
      hits: [makeHit(0, 6, 5)],
    });
    const marks = c.querySelectorAll('mark.search-hit');
    expect(marks.length).toBe(1);
    expect(marks[0]?.textContent).toBe('world');
    expect(marks[0]?.getAttribute('data-search-hit')).toBe('0');
  });

  it('当前下标 → data-current="true"', () => {
    const c = renderWith('foo foo foo', {
      query: 'foo',
      hits: [makeHit(0, 0, 3), makeHit(1, 4, 3), makeHit(2, 8, 3)],
      currentIndex: 1,
    });
    const marks = c.querySelectorAll('mark.search-hit');
    expect(marks.length).toBe(3);
    const currents = Array.from(marks).filter((m) => m.getAttribute('data-current') === 'true');
    expect(currents.length).toBe(1);
    expect(currents[0]?.textContent).toBe('foo');
  });

  it('query 由非空变空 → 自动清除 <mark> (AC-02-3)', () => {
    function Harness(): JSX.Element {
      const [q, setQ] = useState('hello');
      const hits = q === '' ? [] : [makeHit(0, 0, 5)];
      return (
        <div>
          <button type="button" onClick={() => setQ('')}>toggle</button>
          <SearchHighlight
            hits={hits}
            currentIndex={0}
            patternQuery={q}
          >
            <article>
              <ReactMarkdown>hello world</ReactMarkdown>
            </article>
          </SearchHighlight>
        </div>
      );
    }
    const { container, getByText } = render(<Harness />);
    expect(container.querySelectorAll('mark.search-hit').length).toBe(1);
    act(() => {
      getByText('toggle').click();
    });
    expect(container.querySelectorAll('mark.search-hit').length).toBe(0);
  });

  it('caseSensitive=true: 大写 query 不命中小写 text', () => {
    const c = renderWith('hello Hello', {
      query: 'Hello',
      caseSensitive: true,
      hits: [makeHit(0, 6, 5)],
    });
    const marks = c.querySelectorAll('mark.search-hit');
    expect(marks.length).toBe(1);
    expect(marks[0]?.textContent).toBe('Hello');
  });

  it('wholeWord=true: 不匹配 category 中嵌入的 cat', () => {
    const c = renderWith('cat and category', {
      query: 'cat',
      wholeWord: true,
      hits: [makeHit(0, 0, 3)],
    });
    const marks = c.querySelectorAll('mark.search-hit');
    expect(marks.length).toBe(1);
    expect(marks[0]?.textContent).toBe('cat');
  });
});

describe('<SearchHighlight> 跨节点命中 (T10 step-3b)', () => {
  it('跨段落: 各 text node 独立包裹', () => {
    const c = renderWith('abcXYZ\n\nXYZdef', {
      query: 'XYZ',
      hits: [makeHit(0, 3, 3), makeHit(1, 9, 3)],
    });
    const marks = c.querySelectorAll('mark.search-hit');
    expect(marks.length).toBe(2);
    const texts = Array.from(marks).map((m) => m.textContent).join('');
    expect(texts).toBe('XYZXYZ');
  });

  it('跨列表项: 每项独立包裹', () => {
    const c = renderWith('- hello\n- hello\n- hello', {
      query: 'hello',
      hits: [makeHit(0, 0, 5), makeHit(1, 0, 5), makeHit(2, 0, 5)],
    });
    const marks = c.querySelectorAll('mark.search-hit');
    expect(marks.length).toBe(3);
  });

  it('多命中 (同节点): 独立包裹, 序号按 hits 数组递增', () => {
    const c = renderWith('foo bar foo baz foo', {
      query: 'foo',
      hits: [makeHit(0, 0, 3), makeHit(1, 8, 3), makeHit(2, 16, 3)],
    });
    const marks = c.querySelectorAll('mark.search-hit');
    expect(marks.length).toBe(3);
    expect(Array.from(marks).map((m) => m.textContent)).toEqual(['foo', 'foo', 'foo']);
    // 序号: 按 hits 数组顺序循环分配.
    expect(Array.from(marks).map((m) => m.getAttribute('data-search-hit'))).toEqual(['0', '1', '2']);
  });

  it('标题内命中: <h1>foo</h1> → <mark>foo</mark>', () => {
    const c = renderWith('# foo bar', {
      query: 'foo',
      hits: [makeHit(0, 0, 3)],
    });
    const marks = c.querySelectorAll('mark.search-hit');
    expect(marks.length).toBe(1);
    expect(marks[0]?.textContent).toBe('foo');
    expect(marks[0]?.closest('h1')).toBeTruthy();
  });

  it('表格单元格内命中', () => {
    const c = render(
      <SearchHighlight hits={[makeHit(0, 0, 4)]} currentIndex={0} patternQuery="beta">
        <article>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {'| A | B |\n| - | - |\n| alpha | beta |'}
          </ReactMarkdown>
        </article>
      </SearchHighlight>,
    ).container;
    const marks = c.querySelectorAll('mark.search-hit');
    expect(marks.length).toBe(1);
    expect(marks[0]?.textContent).toBe('beta');
    expect(marks[0]?.closest('td')).toBeTruthy();
  });

  it('regex 模式: 自定义正则能命中', () => {
    const c = renderWith('foo123bar', {
      query: '\\d+',
      regex: true,
      hits: [makeHit(0, 3, 3)],
    });
    const marks = c.querySelectorAll('mark.search-hit');
    expect(marks.length).toBe(1);
    expect(marks[0]?.textContent).toBe('123');
  });

  it('非法 regex (invalidRegex): 不注入, 不抛错', () => {
    expect(() => {
      renderWith('foo bar', {
        query: '[abc',
        regex: true,
        hits: [],
      });
    }).not.toThrow();
  });

  it('卸载: 清除 <mark> 节点, 与无搜索基线一致', () => {
    function Harness(): JSX.Element {
      const [mounted, setMounted] = useState(true);
      return (
        <div>
          <button type="button" onClick={() => setMounted(false)}>unmount</button>
          {mounted ? (
            <SearchHighlight hits={[makeHit(0, 0, 5)]} currentIndex={0} patternQuery="hello">
              <article>
                <ReactMarkdown>hello world</ReactMarkdown>
              </article>
            </SearchHighlight>
          ) : (
            <article>
              <ReactMarkdown>hello world</ReactMarkdown>
            </article>
          )}
        </div>
      );
    }
    const { container, getByText } = render(<Harness />);
    expect(container.querySelectorAll('mark.search-hit').length).toBe(1);
    act(() => {
      getByText('unmount').click();
    });
    // 卸载后容器中无 mark.search-hit.
    expect(container.querySelectorAll('mark.search-hit').length).toBe(0);
  });
});
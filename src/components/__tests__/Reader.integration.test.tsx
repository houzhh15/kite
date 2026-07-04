/**
 * Reader + SearchHighlight 集成测试 (T10 step-7a).
 *
 * 设计依据: docs/design/compiled.md §3.4 + §9.2 + 需求 FR-02 / NFR-04-2.
 *
 * 覆盖:
 *   - Reader ok 态 → MarkdownRenderer 被 SearchHighlight 包裹, hits 注入 mark
 *   - hits 空 → 无 mark (AC-02-3 / NFR-04-2)
 *   - 切换 content → useSearch 单例 store 更新, 旧 mark 自动清除
 *   - 不修改 plugins: 表格 / 标题仍正常渲染 (NFR-04-2)
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { useState, type JSX } from 'react';

import { Reader } from '../Reader';
import { useSearch, __resetSearchForTest } from '../../hooks/useSearch';
import type { MarkdownState } from '../../types/markdown';

afterEach(() => {
  cleanup();
  __resetSearchForTest();
});

function makeOkState(content: string): MarkdownState {
  return {
    status: 'ok',
    doc: { content, path: '/test.md', title: 'Test' },
    errorMessage: null,
  };
}

function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 100));
}

function TypeQ({ q }: { q: string }): JSX.Element {
  const { setQuery } = useSearch();
  return (
    <button type="button" data-testid="type-q" onClick={() => setQuery(q)}>
      type
    </button>
  );
}

describe('Reader + SearchHighlight (T10 step-7a)', () => {
  it('Reader 渲染 MarkdownRenderer, SearchHighlight 包裹成功 (无 hits → 无 mark)', () => {
    const state = makeOkState('hello world');
    const { container } = render(
      <Reader state={state} onRetry={() => undefined} onRenderError={() => undefined} onOpen={() => undefined} />,
    );
    expect(container.querySelectorAll('mark.search-hit').length).toBe(0);
    expect(container.querySelector('[data-testid="markdown-article"]')).toBeTruthy();
  });

  it('设 query 后 SearchHighlight 注入 mark (FR-02 / AC-02-1)', async () => {
    const state = makeOkState('hello world');
    const res = render(
      <>
        <Reader state={state} onRetry={() => undefined} onRenderError={() => undefined} onOpen={() => undefined} />
        <TypeQ q="hello" />
      </>,
    );
    act(() => {
      res.getByTestId('type-q').click();
    });
    await flushAsync();
    const marks = res.container.querySelectorAll('mark.search-hit');
    expect(marks.length).toBeGreaterThanOrEqual(1);
    expect(marks[0]?.textContent).toBe('hello');
  });

  it('切文档 → useSearch 自动 close, mark 清除 (NFR-04-1)', async () => {
    function Harness(): JSX.Element {
      const [content, setContent] = useState('hello world');
      const state: MarkdownState = {
        status: 'ok',
        doc: { content, path: '/a.md', title: 'A' },
        errorMessage: null,
      };
      return (
        <>
          <Reader state={state} onRetry={() => undefined} onRenderError={() => undefined} onOpen={() => undefined} />
          <button type="button" data-testid="switch" onClick={() => setContent('goodbye world')}>
            switch
          </button>
          <TypeQ q="hello" />
        </>
      );
    }
    const res = render(<Harness />);
    act(() => {
      res.getByTestId('type-q').click();
    });
    await flushAsync();
    expect(res.container.querySelectorAll('mark.search-hit').length).toBeGreaterThanOrEqual(1);

    act(() => {
      res.getByTestId('switch').click();
    });
    await flushAsync();
    expect(res.container.querySelectorAll('mark.search-hit').length).toBe(0);
  });

  it('不修改 plugins: 表格 / 标题仍正常渲染 (NFR-04-2)', () => {
    const md = '| A | B |\n| - | - |\n| alpha | beta |\n\n# Hello';
    const state = makeOkState(md);
    const { container } = render(
      <Reader state={state} onRetry={() => undefined} onRenderError={() => undefined} onOpen={() => undefined} />,
    );
    expect(container.querySelector('table')).toBeTruthy();
    expect(container.querySelector('h1')?.textContent).toBe('Hello');
    // hits 空 → 无 mark
    expect(container.querySelectorAll('mark.search-hit').length).toBe(0);
  });
});
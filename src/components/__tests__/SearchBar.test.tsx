/**
 * SearchBar 组件测试 (T10 step-4a / step-4b / step-4c).
 *
 * 设计依据: docs/design/compiled.md §3.2.3 + §9.2 + 需求 FR-01..06.
 *
 * 覆盖:
 *   - step-4a:
 *     * isOpen=false → 不渲染 (NFR-04-2 / AC-04-1)
 *     * open 后渲染浮层 + 输入框 + 计数 + 上下/关闭按钮
 *     * 计数显示 'N / total' 格式
 *     * aria-label 与 data-testid 完备
 *   - step-4b:
 *     * 选项 chips 切换 → state 更新 → count 重算
 *     * 非法正则时 chip 边框变红 + aria-invalid + hint
 *   - step-4c:
 *     * Enter → next
 *     * Shift+Enter → prev
 *     * Esc → close
 *
 * 测试策略: SearchBar 是 useSearch 单例 store 的纯消费者.
 * 为了让 SearchBar 看到非空 hits, 测试用例先用一个临时组件以 useSearch(content)
 * 写入 content, 再渲染 SearchBar (无 content).
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import type { JSX } from 'react';

import { SearchBar } from '../SearchBar';
import { useSearch, __resetSearchForTest } from '../../hooks/useSearch';
import i18n, { DEFAULT_LNG } from '../../i18n';

afterEach(() => {
  cleanup();
  __resetSearchForTest();
});

beforeEach(async () => {
  // T18: 重置 i18next 到 zh-CN 默认, 避免被前一个测试改写.
  await i18n.changeLanguage(DEFAULT_LNG);
});

function flushTimers(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 80));
}

/** 渲染一个 useSearch(content) 驱动器, 用于把 content 写入 store. */
function SearchDriver({ content }: { content: string }): JSX.Element {
  useSearch(content);
  return <></>;
}

/** 渲染 SearchBar + 一个内容驱动器 (T18: 包裹 I18nextProvider). */
function renderSearchBar(content: string): ReturnType<typeof render> {
  return render(
    <I18nextProvider i18n={i18n}>
      <SearchDriver content={content} />
      <SearchBar />
    </I18nextProvider>,
  );
}

describe('SearchBar (T10 step-4a)', () => {
  it('isOpen=false → 不渲染浮层 (NFR-04-2)', () => {
    const { container } = renderSearchBar('hello world');
    expect(container.querySelector('[data-testid="search-bar"]')).toBeNull();
  });

  it('open 后渲染浮层 + 全部控件', () => {
    // 直接用 Opener + SearchDriver 触发 open, 再渲染 SearchBar.
    function Opener(): JSX.Element {
      const { open } = useSearch();
      return <button type="button" data-testid="opener" onClick={() => open()}>open</button>;
    }
    const res = render(
      <I18nextProvider i18n={i18n}>
        <SearchDriver content="hello world" />
        <Opener />
        <SearchBar />
      </I18nextProvider>,
    );
    fireEvent.click(res.getByTestId('opener'));
    expect(res.container.querySelector('[data-testid="search-bar"]')).toBeTruthy();
    expect(res.container.querySelector('[data-testid="search-input"]')).toBeTruthy();
    expect(res.container.querySelector('[data-testid="search-count"]')).toBeTruthy();
    expect(res.container.querySelector('[data-testid="search-prev"]')).toBeTruthy();
    expect(res.container.querySelector('[data-testid="search-next"]')).toBeTruthy();
    expect(res.container.querySelector('[data-testid="search-close"]')).toBeTruthy();
  });

  it('计数显示 "0 / 0" 当无命中', async () => {
    function Opener(): JSX.Element {
      const { open } = useSearch();
      return <button type="button" onClick={() => open()}>open</button>;
    }
    const res = render(
      <I18nextProvider i18n={i18n}>
        <SearchDriver content="hello world" />
        <Opener />
        <SearchBar />
      </I18nextProvider>,
    );
    fireEvent.click(res.getByText('open'));
    expect(res.getByTestId('search-count').textContent).toBe('0 / 0');
  });

  it('计数显示 "1 / N" 当命中存在 + currentIndex=0', async () => {
    function Opener(): JSX.Element {
      const { open, setQuery } = useSearch();
      return (
        <button
          type="button"
          onClick={() => {
            setQuery('hello');
            open();
          }}
        >
          open
        </button>
      );
    }
    const res = render(
      <I18nextProvider i18n={i18n}>
        <SearchDriver content="hello hello world" />
        <Opener />
        <SearchBar />
      </I18nextProvider>,
    );
    fireEvent.click(res.getByText('open'));
    await flushTimers();
    expect(res.getByTestId('search-count').textContent).toBe('1 / 2');
  });

  it('aria-label 与 role 完备 (AC-06-2)', async () => {
    function Opener(): JSX.Element {
      const { open } = useSearch();
      return <button type="button" onClick={() => open()}>open</button>;
    }
    const res = render(
      <I18nextProvider i18n={i18n}>
        <SearchDriver content="hello world" />
        <Opener />
        <SearchBar />
      </I18nextProvider>,
    );
    fireEvent.click(res.getByText('open'));
    expect(res.getByRole('search')).toBeTruthy();
    expect(res.getByLabelText('查找关键字')).toBeTruthy();
    expect(res.getByLabelText('上一个')).toBeTruthy();
    expect(res.getByLabelText('下一个')).toBeTruthy();
    expect(res.getByLabelText('关闭')).toBeTruthy();
  });
});

describe('SearchBar 选项 chips (T10 step-4b)', () => {
  it('点击 chip → state 更新 (data-active="true")', () => {
    function Opener(): JSX.Element {
      const { open } = useSearch();
      return <button type="button" onClick={() => open()}>open</button>;
    }
    const res = render(
      <I18nextProvider i18n={i18n}>
        <SearchDriver content="hello world" />
        <Opener />
        <SearchBar />
      </I18nextProvider>,
    );
    fireEvent.click(res.getByText('open'));
    const caseBtn = res.getByTestId('search-case');
    expect(caseBtn.getAttribute('data-active')).toBe('false');
    fireEvent.click(caseBtn);
    expect(caseBtn.getAttribute('data-active')).toBe('true');
    expect(caseBtn.getAttribute('aria-checked')).toBe('true');
  });

  it('caseSensitive=true: count 立即重算 (Hello → 1, hello → 2)', async () => {
    function Starter(): JSX.Element {
      const { open, setQuery, setOption } = useSearch();
      return (
        <button
          type="button"
          onClick={() => {
            setQuery('Hello');
            open();
            setOption('caseSensitive', true);
          }}
        >
          go
        </button>
      );
    }
    const res = render(
      <I18nextProvider i18n={i18n}>
        <SearchDriver content="Hello hello HELLO" />
        <Starter />
        <SearchBar />
      </I18nextProvider>,
    );
    fireEvent.click(res.getByText('go'));
    await flushTimers();
    // caseSensitive + query="Hello" → 仅 1 处命中
    expect(res.getByTestId('search-count').textContent).toBe('1 / 1');
  });

  it('非法正则时 chip 显示 aria-invalid + hint', () => {
    function Starter(): JSX.Element {
      const { open, setQuery, setOption } = useSearch();
      return (
        <button
          type="button"
          onClick={() => {
            // 先开 SearchBar + 设 query, 再切 regex 选项 (匹配真实用户流).
            open();
            setQuery('[abc');
            setOption('regex', true);
          }}
        >
          go
        </button>
      );
    }
    const res = render(
      <I18nextProvider i18n={i18n}>
        <SearchDriver content="foo bar" />
        <Starter />
        <SearchBar />
      </I18nextProvider>,
    );
    fireEvent.click(res.getByText('go'));
    const regexBtn = res.getByTestId('search-regex');
    expect(regexBtn.getAttribute('aria-invalid')).toBe('true');
    expect(res.getByTestId('search-regex-hint').textContent).toBe('正则非法');
    // 输入框也应当 aria-invalid
    const input = res.getByTestId('search-input');
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });
});

describe('SearchBar 键盘交互 (T10 step-4c)', () => {
  it('Enter → next', async () => {
    function Starter(): JSX.Element {
      const { open, setQuery } = useSearch();
      return (
        <button
          type="button"
          onClick={() => {
            setQuery('foo');
            open();
          }}
        >
          go
        </button>
      );
    }
    const res = render(
      <I18nextProvider i18n={i18n}>
        <SearchDriver content="foo foo foo" />
        <Starter />
        <SearchBar />
      </I18nextProvider>,
    );
    fireEvent.click(res.getByText('go'));
    await flushTimers();
    const input = res.getByTestId('search-input') as HTMLInputElement;
    expect(res.getByTestId('search-count').textContent).toBe('1 / 3');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(res.getByTestId('search-count').textContent).toBe('2 / 3');
  });

  it('Shift+Enter → prev', async () => {
    function Starter(): JSX.Element {
      const { open, setQuery } = useSearch();
      return (
        <button
          type="button"
          onClick={() => {
            setQuery('foo');
            open();
          }}
        >
          go
        </button>
      );
    }
    const res = render(
      <I18nextProvider i18n={i18n}>
        <SearchDriver content="foo foo foo" />
        <Starter />
        <SearchBar />
      </I18nextProvider>,
    );
    fireEvent.click(res.getByText('go'));
    await flushTimers();
    const input = res.getByTestId('search-input') as HTMLInputElement;
    // currentIndex=0, prev → 2
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(res.getByTestId('search-count').textContent).toBe('3 / 3');
  });

  it('Esc → close 浮层', async () => {
    function Starter(): JSX.Element {
      const { open, setQuery } = useSearch();
      return (
        <button
          type="button"
          onClick={() => {
            setQuery('foo');
            open();
          }}
        >
          go
        </button>
      );
    }
    const res = render(
      <I18nextProvider i18n={i18n}>
        <SearchDriver content="foo foo foo" />
        <Starter />
        <SearchBar />
      </I18nextProvider>,
    );
    fireEvent.click(res.getByText('go'));
    await flushTimers();
    expect(res.container.querySelector('[data-testid="search-bar"]')).toBeTruthy();
    const input = res.getByTestId('search-input') as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'Escape' });
    // 关闭后不再挂载浮层
    expect(res.container.querySelector('[data-testid="search-bar"]')).toBeNull();
  });
});
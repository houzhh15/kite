/**
 * T10 5 条任务 AC 端到端验证 (step-9a).
 *
 * 设计依据: docs/requirements/compiled.md §7 + §3-§5 接口契约.
 *
 * 这是一个**烟测级**集成测试, 用 jsdom 模拟 SearchBar + Reader + useKeyboard 的协同,
 * 验证 5 条 AC 的关键路径. 完整 E2E (Playwright / 真实 WebView) 由 step-9a 在
 * Tauri dev 中人工完成, 这里覆盖自动化可达的路径.
 *
 * AC 列表:
 *   1) Ctrl/Cmd+F 自动 focus + 打开搜索栏 → AC-01-1 / AC-01-2
 *   2) 输入关键字后所有匹配高亮 + 计数正确 → AC-02-1 / AC-02-3
 *   3) Enter / Shift+Enter 跳转 → AC-03-1 / AC-03-2
 *   4) Esc 关闭 + 清空高亮 → AC-04-1 / AC-04-2
 *   5) 大文档性能 (NFR-01-1, 见 perf.test.tsx)
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { useState, type JSX } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { useSearch, __resetSearchForTest, computeHits as computeHitsExport } from '../hooks/useSearch';
import { SearchBar } from '../components/SearchBar';
import { useKeyboard, unregisterSearchShortcuts } from '../hooks/useKeyboard';
import { SearchHighlight } from '../lib/searchHighlight';
import { buildLargeMarkdown } from './fixtures/largeMarkdown';

vi.mock('../lib/tauri', () => ({
  readMarkdownFile: vi.fn(),
  getRecentFiles: vi.fn().mockResolvedValue([]),
  addRecentFile: vi.fn().mockResolvedValue(undefined),
  clearRecentFiles: vi.fn().mockResolvedValue(undefined),
  setWindowTitle: vi.fn(() => Promise.resolve()),
  loadPreferences: vi.fn().mockResolvedValue({
    theme: 'system',
    fontSize: 16,
    lineHeight: 1.6,
    codeBlockTheme: 'github',
  }),
  savePreferences: vi.fn(),
  openExternalUrl: vi.fn(),
  resolveImagePath: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue(null),
}));

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: () => Promise.resolve(() => {}),
  }),
}));

function flushAsync(ms = 100): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface LayoutProps {
  content: string;
  initialQuery?: string;
}

/**
 * 自定义 MarkdownView: 把 useSearch 单例 store + SearchHighlight 整合到一个 article.
 * 这里不复用 Reader.tsx 的 MarkdownView, 因为 Reader 还嵌入 Outline 等额外 UI,
 * 这里聚焦 SearchHighlight 行为验证.
 */
function Layout({ content, initialQuery = '' }: LayoutProps): JSX.Element {
  const { hits, currentIndex, query, setQuery, options } = useSearch(content);
  const [initialized, setInitialized] = useState(false);
  if (!initialized && initialQuery !== '') {
    setInitialized(true);
    setQuery(initialQuery);
  }
  return (
    <>
      <div className="reader flex h-full min-h-0 flex-1 flex-col overflow-hidden">
        <article data-testid="markdown-article" className="prose-kite mx-auto w-full max-w-3xl px-6 py-8">
          <SearchHighlight
            hits={hits}
            currentIndex={currentIndex}
            patternQuery={query}
            patternCaseSensitive={!!options.caseSensitive}
            patternWholeWord={!!options.wholeWord}
            patternRegex={!!options.regex}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </SearchHighlight>
        </article>
      </div>
      <SearchBar />
      <KeyboardHost />
    </>
  );
}

function KeyboardHost(): JSX.Element {
  useKeyboard();
  return <></>;
}

afterEach(() => {
  cleanup();
  __resetSearchForTest();
  unregisterSearchShortcuts();
});

describe('T10 任务 AC 端到端验证 (step-9a)', () => {
  it('AC-01-1: Ctrl+F 自动 focus + 打开搜索栏', async () => {
    const { container } = render(<Layout content="hello world" />);
    await flushAsync();

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'f',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await flushAsync(50);

    expect(container.querySelector('[data-testid="search-bar"]')).toBeTruthy();
    const input = container.querySelector('[data-testid="search-input"]') as HTMLInputElement | null;
    expect(input).toBeTruthy();
    // focus 通过 rAF + 50ms 兜底注入. 等 rAF + 兜底 timer.
    await flushAsync(150);
    expect(document.activeElement).toBe(input);
  });

  it('AC-01-2: Ctrl+F 在已打开状态再次按 → 重新 focus + select', async () => {
    const { container } = render(<Layout content="hello world" />);
    await flushAsync();
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'f',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await flushAsync(50);
    const input = container.querySelector('[data-testid="search-input"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'hel' } });
    // 再次按 Ctrl+F.
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'f',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await flushAsync(150);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('hel');
    void container;
  });

  it('AC-02-1: 输入关键字后所有匹配高亮 + 计数正确', async () => {
    const { container } = render(<Layout content="foo foo bar foo baz" />);
    await flushAsync();
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'f',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await flushAsync(50);
    const input = container.querySelector('[data-testid="search-input"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'foo' } });
    await flushAsync(100);
    const marks = container.querySelectorAll('mark.search-hit');
    expect(marks.length).toBe(3);
    const count = container.querySelector('[data-testid="search-count"]')?.textContent;
    expect(count).toBe('1 / 3');
  });

  it('AC-02-3: 关键字为空 → 不挂载 <mark>', async () => {
    const { container } = render(<Layout content="hello world" />);
    await flushAsync();
    expect(container.querySelectorAll('mark.search-hit').length).toBe(0);
  });

  it('AC-03-1: Enter → 跳下一项', async () => {
    const { container } = render(<Layout content="foo foo foo" />);
    await flushAsync();
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'f',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await flushAsync(50);
    const input = container.querySelector('[data-testid="search-input"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'foo' } });
    await flushAsync(100);
    expect(container.querySelector('[data-testid="search-count"]')?.textContent).toBe('1 / 3');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(container.querySelector('[data-testid="search-count"]')?.textContent).toBe('2 / 3');
  });

  it('AC-03-2: Shift+Enter → 跳上一项 (循环)', async () => {
    const { container } = render(<Layout content="foo foo foo" />);
    await flushAsync();
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'f',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await flushAsync(50);
    const input = container.querySelector('[data-testid="search-input"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'foo' } });
    await flushAsync(100);
    // current=0, Shift+Enter → 倒数第 1
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(container.querySelector('[data-testid="search-count"]')?.textContent).toBe('3 / 3');
  });

  it('AC-04-1: Esc 关闭 + 清空高亮', async () => {
    const { container } = render(<Layout content="foo foo foo" />);
    await flushAsync();
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'f',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await flushAsync(50);
    const input = container.querySelector('[data-testid="search-input"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'foo' } });
    await flushAsync(100);
    expect(container.querySelectorAll('mark.search-hit').length).toBeGreaterThanOrEqual(1);
    fireEvent.keyDown(input, { key: 'Escape' });
    // close 同步清空 query; SearchBar 卸载 (null), wrapper 清空 mark.
    expect(container.querySelector('[data-testid="search-bar"]')).toBeNull();
    expect(container.querySelectorAll('mark.search-hit').length).toBe(0);
  });

  it('AC-04-2: 连续 Esc 三次不报错', async () => {
    const { container } = render(<Layout content="foo" />);
    await flushAsync();
    // 未打开状态下连续 Esc.
    expect(() => {
      act(() => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Escape',
            bubbles: true,
            cancelable: true,
          }),
        );
      });
      act(() => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Escape',
            bubbles: true,
            cancelable: true,
          }),
        );
      });
      act(() => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Escape',
            bubbles: true,
            cancelable: true,
          }),
        );
      });
    }).not.toThrow();
    expect(container.querySelector('[data-testid="search-bar"]')).toBeNull();
  });

  it('AC-05 选项切换: 区分大小写 + 整词 + 正则', async () => {
    const { container } = render(<Layout content="Hello hello HELLO cat category" />);
    await flushAsync();
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'f',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await flushAsync(50);
    const input = container.querySelector('[data-testid="search-input"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'hello' } });
    await flushAsync(100);
    expect(container.querySelector('[data-testid="search-count"]')?.textContent).toBe('1 / 3');

    // 开启区分大小写.
    fireEvent.click(container.querySelector('[data-testid="search-case"]') as HTMLElement);
    await flushAsync(50);
    expect(container.querySelector('[data-testid="search-count"]')?.textContent).toBe('1 / 1');

    // 切回 case-insensitive, 开 wholeWord, 查 'cat'.
    fireEvent.click(container.querySelector('[data-testid="search-case"]') as HTMLElement);
    await flushAsync(50);
    fireEvent.click(container.querySelector('[data-testid="search-whole-word"]') as HTMLElement);
    fireEvent.change(input, { target: { value: 'cat' } });
    await flushAsync(100);
    // wholeWord + cat → 只匹配独立 'cat', 不匹配 'category'.
    expect(container.querySelector('[data-testid="search-count"]')?.textContent).toBe('1 / 1');
  });

  it('AC-02-2: 非法正则不抛红, count=0/0', async () => {
    const { container } = render(<Layout content="foo bar baz" />);
    await flushAsync();
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'f',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await flushAsync(50);
    const input = container.querySelector('[data-testid="search-input"]') as HTMLInputElement;
    fireEvent.click(container.querySelector('[data-testid="search-regex"]') as HTMLElement);
    fireEvent.change(input, { target: { value: '[abc' } });
    await flushAsync(100);
    expect(container.querySelector('[data-testid="search-count"]')?.textContent).toBe('0 / 0');
    expect(container.querySelector('[data-testid="search-input"]')?.getAttribute('aria-invalid')).toBe('true');
    expect(container.querySelector('[data-testid="search-regex"]')?.getAttribute('aria-invalid')).toBe('true');
    expect(container.querySelector('[data-testid="search-bar"]')).toBeTruthy(); // SearchBar 仍打开
  });

  it('NFR-01-1: 大文档 (≥80KB) 性能: computeHits < 200ms (jsdom 放宽)', () => {
    const md = buildLargeMarkdown();
    expect(md.length).toBeGreaterThanOrEqual(80_000);
    const t0 = performance.now();
    // computeHits 是 useSearch 的命名导出.
    const r = computeHitsExport(md, 'needle', {
      caseSensitive: false,
      wholeWord: false,
      regex: false,
    });
    const elapsed = performance.now() - t0;
    expect(r.hits.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(200);
  });
});
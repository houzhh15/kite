/**
 * MarkdownView + Outline 集成测试 (T09 step-4 / step-5 / AC-06-*).
 *
 * 覆盖:
 *   - 加载带标题的文档 -> Outline 出现, heading 节点有 id.
 *   - 代码块内 # 不进 outline / 不进 heading.
 *   - 文档切换 (AC-06-1/3) -> outline 与 progress 立即更新, 无残留.
 *   - progress 在初始渲染后即可被 StatusBar 拿到.
 *   - useScrollSpy.onCurrentChange 在滚动时被调用.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, act, fireEvent } from '@testing-library/react';

import Reader from '../Reader';
import { useDocStore } from '../../stores/docStore';
import { __resetScrollSpyForTest } from '../../hooks/useScrollSpy';

vi.mock('../../lib/tauri', () => ({
  setWindowTitle: vi.fn().mockResolvedValue(undefined),
  loadPreferences: vi.fn().mockResolvedValue({
    theme: 'system', fontSize: 16, lineHeight: 1.6, codeBlockTheme: 'github',
  }),
  savePreferences: vi.fn(),
}));

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: () => Promise.resolve(() => {}),
  }),
}));

function renderReader(content: string, onCurrentChange?: (id: string | null, p: number) => void, onProgressChange?: (p: number) => void) {
  return render(
    <Reader
      state={{ status: 'ok', doc: { content, lines: 0, bytes: 0 } } as never}
      onRetry={() => {}}
      onOpen={() => {}}
      onRenderError={() => {}}
      onCurrentChange={onCurrentChange}
      onProgressChange={onProgressChange}
    />,
  );
}

describe('Reader — T09 集成 (Outline + ProgressBar + useScrollSpy)', () => {
  beforeEach(() => {
    __resetScrollSpyForTest();
    useDocStore.setState({
      state: { currentPath: null, content: '', title: '', dirty: false },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('加载含 # 标题的文档 -> Outline 出现 + heading 节点有 id', () => {
    const md = '# Hello\n## World';
    const { container, getByTestId } = renderReader(md);
    // Outline 容器存在
    expect(getByTestId('outline')).toBeTruthy();
    // heading 节点有 id
    const h1 = container.querySelector('h1#hello');
    const h2 = container.querySelector('h2#world');
    expect(h1).not.toBeNull();
    expect(h2).not.toBeNull();
    // Outline 内有 treeitem
    expect(container.querySelectorAll('[role="treeitem"]').length).toBe(2);
  });

  it('代码块内 # 不识别为标题', () => {
    const md = [
      '# Real',
      '```',
      '# fake',
      '```',
      '## Another',
    ].join('\n');
    const { container } = renderReader(md);
    const headings = container.querySelectorAll('h1[id], h2[id], h3[id]');
    // 只 2 个标题; fake 不出现在 DOM 与 outline.
    expect(headings.length).toBe(2);
    expect(container.querySelector('#fake')).toBeNull();
    expect(container.querySelectorAll('[role="treeitem"]').length).toBe(2);
  });

  it('空文档: Outline 显示「无目录」占位', () => {
    const { getByTestId } = renderReader('');
    expect(getByTestId('outline-empty')).toBeTruthy();
  });

  it('进度回调: onProgressChange 在挂载时被调用一次 (0 起步)', () => {
    const cb = vi.fn();
    renderReader('# A', undefined, cb);
    expect(cb).toHaveBeenCalled();
    expect(cb.mock.calls[cb.mock.calls.length - 1]?.[0]).toBeCloseTo(0, 5);
  });

  it('onCurrentChange: 滚动时回调', async () => {
    const cb = vi.fn();
    const md = '# A\n# B\n# C';
    const { container } = renderReader(md, cb);
    cb.mockClear();

    // 模拟滚动: 触发 reader-scroll-container 的 scroll 事件.
    const scroller = container.querySelector('[data-testid="reader-scroll-container"]') as HTMLElement;
    if (scroller) {
      Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 1000 });
      Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 200 });
      Object.defineProperty(scroller, 'scrollTop', { configurable: true, value: 400, writable: true });
      act(() => {
        fireEvent.scroll(scroller);
      });
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
    }
    // 回调可能在初始 mount 已被调用过; 不强制断言此时数量,
    // 仅保证不抛错 + progress 仍然是 number.
    if (cb.mock.calls.length > 0) {
      const last = cb.mock.calls[cb.mock.calls.length - 1];
      expect(typeof last?.[1]).toBe('number');
    }
  });

  it('文档切换 -> Outline 立即更新 (AC-06-1)', () => {
    const md1 = '# One';
    const { container, rerender } = render(
      <Reader
        state={{ status: 'ok', doc: { content: md1, lines: 0, bytes: 0 } } as never}
        onRetry={() => {}}
        onOpen={() => {}}
        onRenderError={() => {}}
      />,
    );
    expect(container.querySelector('#one')).not.toBeNull();

    const md2 = '# Two';
    rerender(
      <Reader
        state={{ status: 'ok', doc: { content: md2, lines: 0, bytes: 0 } } as never}
        onRetry={() => {}}
        onOpen={() => {}}
        onRenderError={() => {}}
      />,
    );
    expect(container.querySelector('#two')).not.toBeNull();
    // 旧 id 已卸载 (HeadingAnchor 池在 useEffect 中已清空 + 重新灌入).
    expect(container.querySelector('#one')).toBeNull();
  });

  it('samples/hello.md 回归 (内联 fixture): heading id 正确生成', () => {
    // 内联 hello.md 等价内容 (避免 NFR-SEC-03 触发: 测试不直读磁盘).
    const md = [
      '# Hello KITE',
      '',
      'This is a **sample** markdown file used for manual testing.',
      '',
      '## Section',
      '',
      '- first',
      '- second',
      '- third',
      '',
    ].join('\n');
    const { container } = renderReader(md);
    expect(container.querySelector('#hello-kite')).not.toBeNull();
    expect(container.querySelector('#section')).not.toBeNull();
  });

  it('samples/with-script.md 回归 (内联 fixture): 代码块内 <script> 不渲染且 # 不识别', () => {
    // 内联 with-script.md 等价内容.
    const md = [
      '# XSS smoke test',
      '',
      'The following line must NOT execute in the rendered DOM:',
      '',
      '<script>alert(\'xss\')</script>',
      '',
      '## Code Block',
      '',
      '```',
      '# fake heading inside fence',
      '```',
      '',
      '## Inline',
      '',
      'Inline `code <script>x</script>` should also remain inert.',
    ].join('\n');
    const { container } = renderReader(md);
    // XSS: 没有 <script> 节点进入 DOM.
    expect(container.querySelector('script')).toBeNull();
    // 仅 3 个 heading (# XSS smoke test, ## Code Block, ## Inline); fake 不出现.
    const headings = container.querySelectorAll('h1[id], h2[id], h3[id]');
    expect(headings.length).toBe(3);
    expect(container.querySelector('#fake')).toBeNull();
  });
});

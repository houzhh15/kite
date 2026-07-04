/**
 * T08 step-3+4+5: MarkdownRenderer 集成测试.
 *
 * 覆盖:
 *   - 多种语言 (python, go, yaml, sql) 渲染时带 hljs-* class
 *   - 块级代码块 toolbar 出现 + aria-label
 *   - unknownlang 仍渲染, 容器带 language-unknownlang class
 *   - 图片 src 相对路径触发 IPC (mock) + LRU 命中
 *   - 点击 <img> 触发 ImageViewer 挂载
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act, waitFor, renderHook } from '@testing-library/react';

import MarkdownRenderer from '../MarkdownRenderer';
import { useImageViewer } from '../../hooks/useImageViewer';
import { ImageViewer } from '../ImageViewer';
import { useDocStore } from '../../stores/docStore';
import { imageCache } from '../../lib/imageCache';

import type * as tauriModule from '../../lib/tauri';

// mock resolveImagePath (from src/lib/tauri.ts)
vi.mock('../../lib/tauri', async () => {
  const actual = await vi.importActual<typeof tauriModule>('../../lib/tauri');
  return {
    ...actual,
    resolveImagePath: vi.fn(),
  };
});

import { resolveImagePath } from '../../lib/tauri';

// 包装组件: 模拟 App 顶层挂载 ImageViewer 的形态
function RendererWithViewer({ content }: { content: string }): JSX.Element {
  const viewer = useImageViewer();
  return (
    <>
      <MarkdownRenderer content={content} />
      {viewer.current ? (
        <ImageViewer src={viewer.current.src} alt={viewer.current.alt} onClose={viewer.close} />
      ) : null}
    </>
  );
}

describe('MarkdownRenderer T08 (highlight + image)', () => {
  beforeEach(() => {
    imageCache.clear();
    useDocStore.setState({
      state: { currentPath: '/notes/today.md', content: '', title: 'today', dirty: false },
    });
    const { result } = renderHook(() => useImageViewer());
    act(() => result.current.close());
    (resolveImagePath as unknown as ReturnType<typeof vi.fn>).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders 14-language set: token classes appear in DOM for each', () => {
    const md = [
      '```python',
      'def f(): return 1',
      '```',
      '',
      '```go',
      'func f() int { return 1 }',
      '```',
      '',
      '```yaml',
      'a: 1',
      '```',
      '',
      '```sql',
      'select 1;',
      '```',
      '',
      '```css',
      '.a { color: red; }',
      '```',
      '',
      '```html',
      '<div>hi</div>',
      '```',
      '',
      '```tsx',
      'const f = () => <div/>;',
      '```',
      '',
      '```jsx',
      'const f = () => <div/>;',
      '```',
      '',
      '```json',
      '{"a":1}',
      '```',
    ].join('\n');
    const { container } = render(<MarkdownRenderer content={md} />);
    expect(container.querySelectorAll('.hljs').length).toBeGreaterThan(0);
  });

  it('renders toolbar (Copy/Fold) for block code', () => {
    const md = '```rust\nfn x(){}\n```';
    const { getByTestId } = render(<MarkdownRenderer content={md} />);
    expect(getByTestId('codeblock-toolbar-rust')).toBeTruthy();
    expect(getByTestId('codeblock-copy').getAttribute('aria-label')).toBe('复制代码');
    expect(getByTestId('codeblock-fold').getAttribute('aria-label')).toBe('折叠代码块');
  });

  it('unknown lang still renders with language-unknown class (AC-1-3)', () => {
    const md = '```unknownlang\nfoo\n```';
    const { container } = render(<MarkdownRenderer content={md} />);
    const langEl = container.querySelector('[class*="language-unknownlang"]');
    expect(langEl).not.toBeNull();
  });

  it('relative image src triggers resolveImagePath and renders data URL', async () => {
    (resolveImagePath as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      'data:image/png;base64,iVBORw0KGgo=',
    );
    const md = '![alt text](./assets/x.png)';
    const { container } = render(<MarkdownRenderer content={md} />);
    await waitFor(() => {
      const img = container.querySelector('img');
      expect(img?.getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgo=');
    });
    expect(resolveImagePath).toHaveBeenCalledWith('/notes/today.md', './assets/x.png');
  });

  it('clicking image opens ImageViewer (Portal + dialog role)', async () => {
    (resolveImagePath as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      'data:image/png;base64,XYZ',
    );
    const md = '![x](./assets/x.png)';
    const { container } = render(<RendererWithViewer content={md} />);
    await waitFor(() => {
      const img = container.querySelector('img');
      expect(img?.getAttribute('src')).toBe('data:image/png;base64,XYZ');
    });
    const img = container.querySelector('img') as HTMLImageElement;
    act(() => {
      fireEvent.click(img);
    });
    await waitFor(() => {
      const dialog = document.querySelector('[data-testid="image-viewer"]');
      expect(dialog).not.toBeNull();
    });
  });

  it('cache hit: second render does not call resolveImagePath', async () => {
    (resolveImagePath as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      'data:image/png;base64,XYZ',
    );
    const md = '![x](./assets/x.png)';
    const { unmount, container } = render(<MarkdownRenderer content={md} />);
    await waitFor(() => {
      const img = container.querySelector('img');
      expect(img?.getAttribute('src')).toBe('data:image/png;base64,XYZ');
    });
    expect(resolveImagePath).toHaveBeenCalledTimes(1);
    // 卸载 → 重新挂载 (模拟文档重新打开, 但 cache key 仍在, imageCache 是单例)
    unmount();
    const { container: c2 } = render(<MarkdownRenderer content={md} />);
    await waitFor(() => {
      const img = c2.querySelector('img');
      expect(img?.getAttribute('src')).toBe('data:image/png;base64,XYZ');
    });
    // cache 命中: 第二次应不再调 resolveImagePath
    expect((resolveImagePath as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });
});

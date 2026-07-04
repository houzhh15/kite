/**
 * docStore.test.ts — T06 setContent action 纯状态写入 (设计 §3.9.2 + 修订).
 *
 * T06 调整: setContent 不再在内部调 setWindowTitle. 窗口标题联动由 App.tsx
 * 顶层 useEffect 订阅 useDocStore.title 统一负责. 本测试文件仅覆盖 store 自身
 * 行为 (state 写入 + basename 推导), 不再断言 setWindowTitle.
 *
 * 覆盖:
 *   - setContent 写入 state 并按 path 推导 title.
 *   - explicit title 覆盖.
 *   - 扩展名 (.md / .markdown / .mdx) 去除, 大小写不敏感.
 *   - Windows 路径分隔符.
 *   - 空 path → 空 title.
 *   - 边界: title 不解析 HTML.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useDocStore } from '../docStore';

describe('docStore (T06 setContent 纯状态写入)', () => {
  beforeEach(() => {
    useDocStore.setState({
      state: { currentPath: null, content: '', title: '', dirty: false },
    });
  });

  afterEach(() => {
    // no-op
  });

  it('setContent writes state with basename title (AC-FR07-1)', () => {
    useDocStore.getState().setContent({
      path: '/Users/alice/notes/todo.md',
      content: 'X',
    });
    const s = useDocStore.getState().state;
    expect(s.title).toBe('todo');
    expect(s.currentPath).toBe('/Users/alice/notes/todo.md');
    expect(s.content).toBe('X');
    expect(s.dirty).toBe(false);
  });

  it('explicit title overrides basename', () => {
    useDocStore.getState().setContent({
      path: '/x/notes.md',
      title: 'My Notes',
      content: 'X',
    });
    expect(useDocStore.getState().state.title).toBe('My Notes');
  });

  it('strips .mdx extension from basename', () => {
    useDocStore.getState().setContent({ path: '/b/readme.mdx', content: 'X' });
    expect(useDocStore.getState().state.title).toBe('readme');
  });

  it('strips .markdown extension (case-insensitive)', () => {
    useDocStore.getState().setContent({ path: '/c/Guide.MARKDOWN', content: 'X' });
    expect(useDocStore.getState().state.title).toBe('Guide');
  });

  it('handles Windows path separator', () => {
    useDocStore.getState().setContent({ path: 'C:\\Users\\alice\\todo.md', content: 'X' });
    expect(useDocStore.getState().state.title).toBe('todo');
  });

  it('empty path → empty title (AC-FR07-3)', () => {
    useDocStore.getState().setContent({ path: '', content: '' });
    expect(useDocStore.getState().state.title).toBe('');
    expect(useDocStore.getState().state.currentPath).toBeNull();
  });

  it('close() resets state to initial (CLOSE 行为)', () => {
    useDocStore.getState().setContent({ path: '/a.md', content: 'X' });
    useDocStore.getState().close();
    const s = useDocStore.getState().state;
    expect(s.title).toBe('');
    expect(s.currentPath).toBeNull();
    expect(s.content).toBe('');
  });

  it('does not parse HTML in title (NFR-05 / AC-NFR05-1)', () => {
    useDocStore.getState().setContent({
      path: '/x/evil-md.md',
      title: '<script>alert(1)</script>',
      content: 'X',
    });
    const t = useDocStore.getState().state.title;
    expect(t).toBe('<script>alert(1)</script>');
  });
});
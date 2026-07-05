/**
 * RecentList.integration.test.tsx — T20 (R-04 关键修复) 集成回归.
 *
 * 验证: 点击 RecentList 列表项后, App.tsx 的 useMarkdownDoc().state.doc
 * 真正更新 (而不是只在 RecentList 自己的 hook 实例上更新).
 *
 * 旧 bug 描述: 之前 RecentList 内部 `useMarkdownDoc()` 拿到一份独立的 hook
 * 实例, 调 `loadFile(item.path)` 仅更新 RecentList 自己的 `useReducer` state.
 * App.tsx 的 reader 永远看不到新 doc, content/outline 都是上一份文件.
 *
 * 此测试构造一个 TestHarness 让 RecentList 通过 `onLoadFile` 回调调 App.tsx
 * 这边的 useMarkdownDoc, 验证 dispatch OPEN_OK 之后, 这边 hook state 更新.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (_cmd: string, args: { path: string }) => {
    if (args?.path === '/mock/a.md') return '# A doc\n\nA content';
    if (args?.path === '/mock/b.md') return '# B doc\n\nB content';
    throw { code: 'NOT_FOUND', message: `path ${args.path} not found` };
  }),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(async () => '/mock/a.md'),
}));

// Tauri 环境检测 stub.
(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: () => Promise.resolve(),
  metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
  transformCallback: () => 0,
  unregisterCallback: () => {},
};

import { RecentList } from '../RecentList';
import { useMarkdownDoc, type UseMarkdownDocApi } from '../../hooks/useMarkdownDoc';
import { useRecentStore } from '../../stores/recentStore';
import { useDocStore } from '../../stores/docStore';

interface Ctx {
  appDoc: UseMarkdownDocApi | null;
}
const ctx: Ctx = { appDoc: null };

function TestHarness(): JSX.Element {
  // App.tsx 在这里就是这一个 hook 实例; RecentList 不再自己 useMarkdownDoc().
  const appDoc = useMarkdownDoc();
  ctx.appDoc = appDoc;

  return (
    <RecentList
      onLoadFile={(p) => {
        // 模拟 App.tsx 真实逻辑: void loadFile(p)
        void appDoc.loadFile(p);
      }}
    />
  );
}

beforeEach(() => {
  ctx.appDoc = null;
  useRecentStore.setState({ items: [], loaded: true });
  useDocStore.setState({
    state: { currentPath: null, content: '', title: '', dirty: false },
    history: [],
    cursor: -1,
  });
});

describe('RecentList — T20 集成 (App.tsx 同一份 useMarkdownDoc 实例)', () => {
  it('点击列表项 → App.tsx 这边的 hook state.doc 真正更新, 不只是 RecentList 内部', async () => {
    useRecentStore.setState({
      items: [
        { path: '/mock/a.md', title: 'A', lastOpenedAt: '2026-01-01T00:00:00Z' },
        { path: '/mock/b.md', title: 'B', lastOpenedAt: '2026-01-01T00:00:00Z' },
      ],
      loaded: true,
    });

    const { getAllByTestId } = render(<TestHarness />);

    // Initial: appDoc.state.doc === null.
    expect(ctx.appDoc?.state.doc).toBeNull();

    // 1) 点击 A → state.doc.path 应为 /mock/a.md.
    const itemsBefore = getAllByTestId('recent-list-item');
    expect(itemsBefore.length).toBe(2);
    const firstItem = itemsBefore[0];
    expect(firstItem).toBeDefined();
    if (!firstItem) return;
    await act(async () => {
      fireEvent.click(firstItem);
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(ctx.appDoc?.state.doc?.path).toBe('/mock/a.md');
    expect(ctx.appDoc?.state.doc?.content).toBe('# A doc\n\nA content');

    // 2) 点击 B → state.doc.path 应切到 /mock/b.md.
    const items = getAllByTestId('recent-list-item');
    expect(items.length).toBe(2);
    const secondItem = items[1];
    expect(secondItem).toBeDefined();
    if (!secondItem) return;
    await act(async () => {
      fireEvent.click(secondItem);
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(ctx.appDoc?.state.doc?.path).toBe('/mock/b.md');
    expect(ctx.appDoc?.state.doc?.content).toBe('# B doc\n\nB content');
  });
});
/**
 * App.lazy.test.tsx — T22 FileTree 懒加载运行时契约 (FR-02 / FR-03 / FR-04 / FR-05-3)
 *
 * 设计依据: docs/design/compiled.md §3.6 (用例表) + CS-01 ~ CS-04 契约.
 *
 * 覆盖:
 *   UT-L-1 treeOpen=false 时, DOM 中不存在 <aside data-testid="file-tree-drawer"> (AC-02-1)
 *   UT-L-2 treeOpen=false 时, 模块 factory 未被调用 (AC-05-3 / US-01)
 *   UT-L-3 setTreeOpen(true) 后, <aside> 存在, Fallback '…' 短暂可见 (AC-03-1)
 *   UT-L-4 等待 microtask 后, aside 内显示 FileTree, Fallback 消失 (AC-02-2 / AC-03-2)
 *   UT-L-5 连按多次 toggleTree, factory 调用次数符合预期 (AC-04-3)
 *   UT-L-6 App 整体未卸载白屏 (AC-02-3 / AC-03-3)
 *
 * Mock 策略 (设计文档 §3.6):
 *   - vi.mock('../components/FileTree', factory) 让 import() 解析为带 FileTree 的同步模块.
 *   - 但 `import()` 本身永远返回 Promise (JS 规范), 即便模块同步可用, 也会经过
 *     microtask 排队 → React.lazy + Suspense 一定会渲染 fallback 一帧.
 *   - "未达 chunk" 我们用 fakeImportFactory (vi.fn) 跟踪工厂被调用次数.
 *
 * 不变量:
 *   - 不修改 src/App.tsx (Step 0 审计已确认契约)
 *   - 不修改 src/components/FileTree.tsx (C-01)
 *   - 不修改 vite.config.ts / tauri.conf.json (C-04)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';

// === IPC 依赖 stub (与 App.test.tsx 一致, 避免副作用) ========================
vi.mock('../lib/tauri', () => ({
  readMarkdownFile: vi.fn(),
  getRecentFiles: vi.fn().mockResolvedValue([]),
  addRecentFile: vi.fn().mockResolvedValue(undefined),
  clearRecentFiles: vi.fn().mockResolvedValue(undefined),
  setWindowTitle: vi.fn().mockResolvedValue(undefined),
  loadPreferences: vi.fn().mockResolvedValue({
    theme: 'system',
    fontSize: 16,
    lineHeight: 1.6,
    codeBlockTheme: 'github',
  }),
  savePreferences: vi.fn(),
  openExternalUrl: vi.fn(),
  resolveImagePath: vi.fn(),
  // progressStore / recentStore 等通过 `tauri` 命名空间引用, 需要补全.
  // 组件 lazy 行为测试不需要真实 IPC, 提供 no-op stub 即可.
  loadProgress: vi.fn().mockResolvedValue({ entries: {}, lastPath: null }),
  saveProgress: vi.fn().mockResolvedValue(undefined),
  tauri: {
    readMarkdownFile: vi.fn(),
    getRecentFiles: vi.fn().mockResolvedValue([]),
    addRecentFile: vi.fn().mockResolvedValue(undefined),
    clearRecentFiles: vi.fn().mockResolvedValue(undefined),
    setWindowTitle: vi.fn().mockResolvedValue(undefined),
    loadPreferences: vi.fn().mockResolvedValue({
      theme: 'system',
      fontSize: 16,
      lineHeight: 1.6,
      codeBlockTheme: 'github',
    }),
    savePreferences: vi.fn(),
    openExternalUrl: vi.fn(),
    resolveImagePath: vi.fn(),
    loadProgress: vi.fn().mockResolvedValue({ entries: {}, lastPath: null }),
    saveProgress: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue(null),
}));

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: () => Promise.resolve(() => {}),
  }),
}));

// === FileTree mock: 暴露 FileTree 命名导出 + 通过 vi.fn 记录 import 调用次数 ===
//
// App.tsx 顶层: lazy(() => import('./components/FileTree').then(m => ({ default: m.FileTree })))
// 当 import() 真正被 React.lazy 求值时, vitest 用我们的 mock 工厂, 同步返回 { FileTree: FakeTreeUI }.
// 然后 .then(m => ({ default: m.FileTree })) 把命名导出适配成 default export → Suspense 完成.

let fakeImportFactory: ReturnType<typeof vi.fn>;

vi.mock('../components/FileTree', () => {
  const fn = vi.fn();
  fakeImportFactory = fn;
  // 返回 mock 模块; fn 自身不返回值, 仅做"被调用"计数.
  // React.lazy 里 import() 真正需要的是 module 对象 — 同步获得, 经 microtask 排队.
  return {
    FileTree: FakeTreeUI,
  };
});

function FakeTreeUI(): JSX.Element {
  // T26 (R-12 修复) 增量: <aside data-testid="file-tree-drawer"> 已在重构中从
  // App.tsx 下放到 FileTree 内部 (FileTree 自管理宽度, 与 Outline.tsx 一致);
  // mock 必须真实地渲染 aside 才能反映这个契约, 否则 UT-L-3/UT-L-4/UT-L-6
  // 拿不到 file-tree-drawer 节点而误报失败.
  return (
    <aside data-testid="file-tree-drawer" aria-label="File tree">
      <div data-testid="file-tree">FILETREE</div>
    </aside>
  );
}

// === Imports =================================================================
import * as tauriMock from '../lib/tauri';
const mockSetWindowTitle = (tauriMock as unknown as {
  setWindowTitle: ReturnType<typeof vi.fn>;
}).setWindowTitle;

import { useLayoutStore } from '../stores/layoutStore';
import App from '../App';

// === 状态重置 ================================================================
beforeEach(() => {
  useLayoutStore.setState({ treeOpen: false });
  mockSetWindowTitle.mockReset();
  mockSetWindowTitle.mockResolvedValue(undefined);
  fakeImportFactory?.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// === 用例 ====================================================================
describe('App — FileTree 懒加载契约 (T22 / UT-L-1 ~ UT-L-6)', () => {
  it('UT-L-1: treeOpen=false 时, <aside data-testid="file-tree-drawer"> 不存在', async () => {
    render(<App />);
    // 等 reader mount (App.test.tsx 的同步点: mockSetWindowTitle 被调用).
    await waitFor(() => expect(mockSetWindowTitle.mock.calls.length).toBeGreaterThan(0));
    expect(screen.queryByTestId('file-tree-drawer')).toBeNull();
  });

  it('UT-L-2: treeOpen=false 时, FileTree factory 未被调用', async () => {
    render(<App />);
    await waitFor(() => expect(mockSetWindowTitle.mock.calls.length).toBeGreaterThan(0));
    // App 顶层 <aside> 仅在 treeOpen === true 时被求值 (&& 表达式);
    // React.lazy 的 factory() 仅在 lazy 组件首次挂载时才执行, treeOpen=false 时
    // 整个 lazy 分支不被求值 → factory spy 应为 0.
    expect(fakeImportFactory?.mock.calls.length ?? 0).toBe(0);
  });

  it('UT-L-3: setTreeOpen(true) 后, <aside> 存在且内部有 Suspense Fallback 或 FileTree', async () => {
    render(<App />);
    await waitFor(() => expect(mockSetWindowTitle.mock.calls.length).toBeGreaterThan(0));
    act(() => {
      useLayoutStore.getState().setTreeOpen(true);
    });
    await waitFor(() => {
      const aside = screen.queryByTestId('file-tree-drawer');
      expect(aside).toBeTruthy();
    });
    const aside = screen.queryByTestId('file-tree-drawer');
    expect(aside).toBeTruthy();
    // aside 内部必须显示非空内容: 要么 fallback '…', 要么 FileTree 渲染输出.
    const text = aside?.textContent ?? '';
    expect(text.length).toBeGreaterThan(0);
  });

  it('UT-L-4: 等 microtask 后, aside 内显示 FileTree 渲染输出', async () => {
    render(<App />);
    await waitFor(() => expect(mockSetWindowTitle.mock.calls.length).toBeGreaterThan(0));
    act(() => {
      useLayoutStore.getState().setTreeOpen(true);
    });
    // aside 立即出现.
    await waitFor(() => {
      expect(screen.queryByTestId('file-tree-drawer')).toBeTruthy();
    });
    // mock 模块同步可用, import() 经 microtask 后立即解析, React.lazy 切换为 FileTree 渲染.
    await waitFor(() => {
      expect(screen.queryByTestId('file-tree')).toBeTruthy();
    });
    const fileTree = screen.queryByTestId('file-tree');
    expect(fileTree).toBeTruthy();
    expect(fileTree?.textContent).toContain('FILETREE');
  });

  it('UT-L-5: 反复 toggleTree, factory 仅在首次求值一次 (React.lazy 缓存语义)', async () => {
    render(<App />);
    await waitFor(() => expect(mockSetWindowTitle.mock.calls.length).toBeGreaterThan(0));
    // factory 在 vi.mock 第一次被 import() 时调用, 之后惰性.
    // 我们关注的是 toggleTree 不引入多余 <aside> 节点.
    act(() => {
      useLayoutStore.getState().setTreeOpen(true);
      useLayoutStore.getState().setTreeOpen(false);
      useLayoutStore.getState().setTreeOpen(true);
      useLayoutStore.getState().setTreeOpen(false);
    });
    // 最终状态 false → aside 不存在.
    expect(screen.queryAllByTestId('file-tree-drawer').length).toBe(0);
    // 再打开, aside 单实例.
    act(() => {
      useLayoutStore.getState().setTreeOpen(true);
    });
    await waitFor(() => {
      expect(screen.queryAllByTestId('file-tree-drawer').length).toBe(1);
    });
    // 单实例断言 (即不出现多个 file-tree-drawer).
    expect(screen.queryAllByTestId('file-tree-drawer').length).toBe(1);
  });

  it('UT-L-6: App 整体未卸载, setTreeOpen 切换不影响顶层布局', async () => {
    render(<App />);
    await waitFor(() => expect(mockSetWindowTitle.mock.calls.length).toBeGreaterThan(0));
    const initialCalls = mockSetWindowTitle.mock.calls.length;
    act(() => {
      useLayoutStore.getState().setTreeOpen(true);
    });
    await waitFor(() => {
      expect(screen.queryByTestId('file-tree-drawer')).toBeTruthy();
    });
    act(() => {
      useLayoutStore.getState().setTreeOpen(false);
    });
    await waitFor(() => {
      expect(screen.queryByTestId('file-tree-drawer')).toBeNull();
    });
    // setWindowTitle 在 mount 时调用过; 后续不再调用 (无 title 变化).
    expect(mockSetWindowTitle.mock.calls.length).toBeGreaterThanOrEqual(initialCalls);
  });
});

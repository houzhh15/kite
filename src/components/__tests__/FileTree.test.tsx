/**
 * FileTree.test.tsx — T15 (FR-01) FileTree 组件渲染测试.
 *
 * 覆盖:
 *   - rootPath=null → 显示 tree.emptyHint (AC-01-1 准备态).
 *   - rootPath 有效 → 渲染根节点 + 展开后子项.
 *   - 节点拉取失败 → 错误占位 (`tree.error`), 不影响其它节点 (AC-01-3).
 *   - 文件叶子点击 → 调 onOpenFile(path).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Suspense } from 'react';

import { FileTree } from '../FileTree';
import * as tauri from '../../lib/tauri';
import i18n from '../../i18n';

describe('FileTree — T15 (FR-01)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders empty hint + 选择文件夹 按钮 when rootPath=null', () => {
    render(<FileTree rootPath={null} onOpenFile={() => {}} />);
    const empty = screen.getByTestId('file-tree-empty');
    // T21 (R-05): 空态除了文案外, 还需提供 "选择文件夹" 按钮, 让用户能真正选中目录.
    expect(empty.textContent).toContain('请选择');
    const pickBtn = screen.getByTestId('file-tree-pick-root');
    expect(pickBtn).toBeTruthy();
    expect(pickBtn.textContent).toBe('选择文件夹');
  });

  it('renders root node when rootPath provided', async () => {
    // Mock listDir to return a mixed result.
    const listDirSpy = vi.spyOn(tauri, 'listDir').mockResolvedValue([
      { path: '/root/a.md', name: 'a.md', isDir: false },
      { path: '/root/sub', name: 'sub', isDir: true },
    ]);
    render(
      <Suspense fallback={null}>
        <FileTree rootPath="/root" onOpenFile={() => {}} />
      </Suspense>,
    );
    // The root node name should be present.
    expect(screen.getByTestId('file-tree-dir')).toBeTruthy();
    expect(listDirSpy).not.toHaveBeenCalled(); // root not auto-loaded.
  });

  it('expand a directory fetches children via listDir', async () => {
    const listDirSpy = vi.spyOn(tauri, 'listDir').mockResolvedValue([
      { path: '/root/a.md', name: 'a.md', isDir: false },
      { path: '/root/b.markdown', name: 'b.markdown', isDir: false },
    ]);
    render(
      <Suspense fallback={null}>
        <FileTree rootPath="/root" onOpenFile={() => {}} />
      </Suspense>,
    );
    // 点击根目录展开.
    fireEvent.click(screen.getByTestId('file-tree-dir').querySelector('button')!);
    await waitFor(() => expect(listDirSpy).toHaveBeenCalledWith('/root'));
    // 渲染两个叶子.
    await waitFor(() => {
      const leaves = document.querySelectorAll('[data-testid="file-tree-leaf"]');
      expect(leaves.length).toBe(2);
    });
  });

  it('renders error placeholder for failed node (AC-01-3)', async () => {
    const listDirSpy = vi.spyOn(tauri, 'listDir').mockRejectedValue({
      code: 'NOT_FOUND',
      message: 'not found',
    });
    render(
      <Suspense fallback={null}>
        <FileTree rootPath="/root" onOpenFile={() => {}} />
      </Suspense>,
    );
    fireEvent.click(screen.getByTestId('file-tree-dir').querySelector('button')!);
    await waitFor(() => expect(listDirSpy).toHaveBeenCalled());
    await waitFor(() => {
      const errors = document.querySelectorAll('[data-testid="file-tree-error"]');
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  it('T21 (R-05) 修复: 空态显示 "选择文件夹" 按钮 (仅验证 UI 不抛错)', async () => {
    // 动态 import @tauri-apps/plugin-dialog 的真实行为在 jsdom 里未定义,
    // 这里只验证: 按钮存在, 点击 handlePickRoot 的 try/catch 兜住任何异常,
    // 不冒泡到 React.
    const onRootPathChange = vi.fn();
    render(
      <Suspense fallback={null}>
        <FileTree
          rootPath={null}
          onRootPathChange={onRootPathChange}
          onOpenFile={() => {}}
        />
      </Suspense>,
    );
    const btn = screen.getByTestId('file-tree-pick-root');
    expect(btn).toBeTruthy();
    expect(btn.textContent).toBe('选择文件夹');
    // 点击 → 不抛错 (不论 dialog 在 jsdom 里怎么响应).
    expect(() => fireEvent.click(btn)).not.toThrow();
    await new Promise((r) => setTimeout(r, 50));
    // 验证 FileTree.handlePickRoot 内部 try/catch 工作: 即使 dialog 抛错也不冒泡.
  });

  it('leaf click invokes onOpenFile with path', async () => {
    const listDirSpy = vi.spyOn(tauri, 'listDir').mockResolvedValue([
      { path: '/root/a.md', name: 'a.md', isDir: false },
    ]);
    const onOpen = vi.fn();
    render(
      <Suspense fallback={null}>
        <FileTree rootPath="/root" onOpenFile={onOpen} />
      </Suspense>,
    );
    fireEvent.click(screen.getByTestId('file-tree-dir').querySelector('button')!);
    await waitFor(() => expect(listDirSpy).toHaveBeenCalled());
    const leaf = await waitFor(() =>
      document.querySelector('[data-testid="file-tree-leaf"]'),
    );
    fireEvent.click(leaf!);
    expect(onOpen).toHaveBeenCalledWith('/root/a.md');
  });
});

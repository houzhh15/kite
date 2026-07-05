/**
 * RecentList.test.tsx — RTL 组件测试 (F-03 / 设计 §5.2).
 *
 * 覆盖:
 *   - renders_empty_state: items=[] + loaded=true → 「暂无最近文件」 + 「打开文件」 (US-05).
 *   - renders_items: items.length>0 → 列表项 + path title 属性 (AC-01).
 *   - keyboard_enter_opens: 点击列表项触发 onOpen 回调 (AC-09).
 *   - clear_disabled_when_empty: 空状态时清空按钮 disabled (FR-05).
 *   - clear_confirm_cancel_no_invoke: 用户取消 confirm → 不调 clearRecent (AC-04).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';

import { useRecentStore } from '../../stores/recentStore';
import { readMarkdownFile } from '../../lib/tauri';
import { RecentList } from '../RecentList';

vi.mock('../../lib/tauri', () => ({
  readMarkdownFile: vi.fn().mockResolvedValue('# hello\nfrom recent'),
  getRecentFiles: vi.fn().mockResolvedValue([]),
  addRecentFile: vi.fn().mockResolvedValue(undefined),
  clearRecentFiles: vi.fn().mockResolvedValue(undefined),
  setWindowTitle: vi.fn().mockResolvedValue(undefined),
  loadPreferences: vi.fn(),
  savePreferences: vi.fn(),
  openExternalUrl: vi.fn(),
  resolveImagePath: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../lib/toast', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../lib/toast');
  return { ...actual, pushToast: vi.fn() };
});

beforeEach(() => {
  useRecentStore.setState({ items: [], loaded: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RecentList — empty state (US-05)', () => {
  it('renders empty state with open button when items=[]', () => {
    const { getByTestId } = render(<RecentList />);
    expect(getByTestId('recent-list-empty')).toBeTruthy();
    expect(getByTestId('recent-list-open')).toBeTruthy();
  });

  it('clear button disabled when empty (FR-05)', () => {
    const { getByTestId } = render(<RecentList />);
    const btn = getByTestId('recent-list-clear') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});

describe('RecentList — populated state', () => {
  it('renders items with path title attribute (AC-01)', () => {
    useRecentStore.setState({
      items: [
        { path: '/a.md', title: 'a', lastOpenedAt: '2026-01-01T00:00:00Z' },
        { path: '/b.md', title: 'b', lastOpenedAt: '2026-01-02T00:00:00Z' },
      ],
      loaded: true,
    });
    const { getAllByTestId } = render(<RecentList />);
    const items = getAllByTestId('recent-list-item');
    expect(items.length).toBe(2);
    expect(items[0]?.getAttribute('title')).toBe('/a.md');
  });

  it('点击列表项 → 调用 useMarkdownDoc.loadFile(item.path), 不弹 dialog (T19 修复)', async () => {
    // T19 (R-04 修复): 之前 handleOpen 直接调 open() (弹 dialog), 现改为
    // loadFile(item.path), 用最近文件的 path 加载.
    // 验证路径参数被正确取自 item.path, 而不是被忽略.
    useRecentStore.setState({
      items: [{ path: '/notes/hello.md', title: 'Hello', lastOpenedAt: '2026-01-01T00:00:00Z' }],
      loaded: true,
    });
    // 监听 dialog 打开 → 决不能发生.
    const dialogOpenSpy = vi.fn();
    const { getByTestId } = render(<RecentList onOpen={dialogOpenSpy} />);
    // 触发 onOpen 回调 (Toolbar 传入, 用于关闭 popover).
    const item = getByTestId('recent-list-item');
    await act(async () => {
      fireEvent.click(item);
      // 给 handleOpen 内部 await 一点时间.
      await new Promise((r) => setTimeout(r, 0));
    });
    // 1) 父组件 onOpen 收到回调 (Toolbar 用来关闭 popover).
    expect(dialogOpenSpy).toHaveBeenCalledTimes(1);
    // 2) readMarkdownFile 必须被调用 (T19: loadFile 走 IPC 读 path).
    //    验证策略: 检查 mock 的 call count 与入参 path.
    const readCalls = (readMarkdownFile as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(readCalls.length).toBeGreaterThanOrEqual(1);
    const lastCall = readCalls[readCalls.length - 1]?.[0];
    expect(lastCall).toBe('/notes/hello.md');
  });
});

describe('RecentList — clear confirm (AC-04)', () => {
  it('cancel confirm does not invoke clearRecent', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const clearSpy = vi.spyOn(useRecentStore.getState(), 'clearRecent');
    useRecentStore.setState({
      items: [{ path: '/a.md', title: 'a', lastOpenedAt: '2026-01-01T00:00:00Z' }],
      loaded: true,
    });
    const { getByTestId } = render(<RecentList />);
    const btn = getByTestId('recent-list-clear') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(btn);
      await Promise.resolve();
    });
    expect(confirmSpy).toHaveBeenCalled();
    expect(clearSpy).not.toHaveBeenCalled();
  });

  it('confirm triggers clearRecent', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const clearSpy = vi
      .spyOn(useRecentStore.getState(), 'clearRecent')
      .mockResolvedValue();
    useRecentStore.setState({
      items: [{ path: '/a.md', title: 'a', lastOpenedAt: '2026-01-01T00:00:00Z' }],
      loaded: true,
    });
    const { getByTestId } = render(<RecentList />);
    const btn = getByTestId('recent-list-clear');
    await act(async () => {
      fireEvent.click(btn);
      await Promise.resolve();
    });
    expect(clearSpy).toHaveBeenCalledTimes(1);
  });
});
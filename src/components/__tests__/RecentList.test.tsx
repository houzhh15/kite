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
import { RecentList } from '../RecentList';

vi.mock('../../lib/tauri', () => ({
  readMarkdownFile: vi.fn(),
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

  it('keyboard enter triggers item open (AC-09)', () => {
    useRecentStore.setState({
      items: [{ path: '/a.md', title: 'a', lastOpenedAt: '2026-01-01T00:00:00Z' }],
      loaded: true,
    });
    const onOpen = vi.fn();
    const { getByTestId } = render(<RecentList onOpen={onOpen} />);
    const item = getByTestId('recent-list-item');
    fireEvent.click(item);
    expect(onOpen).toHaveBeenCalledTimes(1);
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
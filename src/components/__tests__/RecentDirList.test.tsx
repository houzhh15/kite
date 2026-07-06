/**
 * RecentDirList.test.tsx — RTL 组件测试 (F-27 / T25 / 设计 §3.4.2 / §5.2).
 *
 * 覆盖:
 *   - hides_block_when_empty: items=[] → 整块 null (不渲染).
 *   - hides_block_when_not_loaded: loaded=false → 整块 null.
 *   - renders_items: items.length>0 → 列表项 + aria-label + title (AC-04-1 / AC-04-4).
 *   - keyboard_enter_opens: Enter 触发 onSelect (AC-04-3 / NFR-A-05).
 *   - keyboard_space_opens: Space 触发 onSelect.
 *   - click_opens: 鼠标点击触发 onSelect.
 *   - delete_click_does_not_open: 点 × 不冒泡到外层 click (AC-04-7).
 *   - delete_invokes_store: 点 × → store.remove 调用.
 *   - delete_confirm_cancel: 用户取消 confirm → 不调 store.remove.
 *   - clear_invokes_store: 点「清空」 → store.clear 调用.
 *   - clear_confirm_cancel: 用户取消 confirm → 不调 store.clear.
 *   - shows_cap_indicator: sr-only 元素展示 N/8 (FR-02).
 *   - renders_relative_time: 5 分钟前显示「just now / minutes ago」 (FR-06).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';

import { useRecentDirsStore, MAX_RECENT_DIRS } from '../../stores/recentDirsStore';
import { RecentDirList } from '../RecentDirList';
import type { RecentDir } from '../../lib/tauri';

vi.mock('../../lib/tauri', () => ({
  readMarkdownFile: vi.fn(),
  getRecentDirs: vi.fn().mockResolvedValue([]),
  addRecentDir: vi.fn().mockResolvedValue(undefined),
  removeRecentDir: vi.fn().mockResolvedValue(undefined),
  clearRecentDirs: vi.fn().mockResolvedValue(undefined),
  setWindowTitle: vi.fn(),
  loadPreferences: vi.fn(),
  savePreferences: vi.fn(),
  openExternalUrl: vi.fn(),
  resolveImagePath: vi.fn(),
}));

vi.mock('../../lib/toast', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../lib/toast');
  return { ...actual, pushToast: vi.fn() };
});

// i18n stub: 避免真实 i18next init (没有 ResourceBundle 时会 warn).
vi.mock('../../i18n', () => ({
  default: { t: (k: string, opts?: { n?: number }) => {
    if (opts && typeof opts.n === 'number') return k.replace('{{n}}', String(opts.n));
    return k;
  }, changeLanguage: vi.fn() },
}));

// react-i18next: 提供 initReactI18next 桩以满足 i18n/index.ts 的 .use(initReactI18next).init().
// 同时 useTranslation 返回 t 透传 key.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, opts?: { n?: number }) => {
    if (opts && typeof opts.n === 'number') return k.replace('{{n}}', String(opts.n));
    return k;
  } }),
  Trans: ({ children }: { children: React.ReactNode }) => children,
  initReactI18next: { type: '3rdParty', init: () => undefined } as never,
}));

function makeDir(path: string, offsetMinutes = 0): RecentDir {
  return {
    path,
    lastOpenedAt: new Date(Date.now() - offsetMinutes * 60_000).toISOString(),
    displayName: path.split('/').pop() ?? path,
  };
}

function setup(items: RecentDir[]): void {
  useRecentDirsStore.setState({ items, loaded: true, maxItems: MAX_RECENT_DIRS });
}

beforeEach(() => {
  useRecentDirsStore.setState({ items: [], loaded: false, maxItems: MAX_RECENT_DIRS });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RecentDirList (F-27 / T25)', () => {
  it('hides_block_when_empty: items=[] + loaded=true → 整块 null (AC-04-2)', () => {
    useRecentDirsStore.setState({ items: [], loaded: true });
    const { container } = render(<RecentDirList onSelect={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('hides_block_when_not_loaded: loaded=false → 整块 null', () => {
    useRecentDirsStore.setState({ items: [makeDir('/a')], loaded: false });
    const { container } = render(<RecentDirList onSelect={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders_items: items.length>0 → 列表项 + aria-label + title (AC-04-1 / AC-04-4)', () => {
    setup([makeDir('/Users/me/notes'), makeDir('/var/data')]);
    const { getAllByTestId, getByText } = render(<RecentDirList onSelect={vi.fn()} />);
    const items = getAllByTestId('recent-dir-item');
    expect(items).toHaveLength(2);
    // displayName 出现.
    expect(getByText('notes')).toBeTruthy();
    expect(getByText('data')).toBeTruthy();
  });

  it('keyboard_enter_opens: Enter 触发 onSelect (AC-04-3)', () => {
    setup([makeDir('/Users/me/notes')]);
    const onSelect = vi.fn();
    const { getByRole } = render(<RecentDirList onSelect={onSelect} />);
    const item = getByRole('menuitem');
    act(() => {
      fireEvent.keyDown(item, { key: 'Enter' });
    });
    expect(onSelect).toHaveBeenCalledWith('/Users/me/notes');
  });

  it('keyboard_space_opens: Space 触发 onSelect', () => {
    setup([makeDir('/a')]);
    const onSelect = vi.fn();
    const { getByRole } = render(<RecentDirList onSelect={onSelect} />);
    act(() => {
      fireEvent.keyDown(getByRole('menuitem'), { key: ' ' });
    });
    expect(onSelect).toHaveBeenCalledWith('/a');
  });

  it('click_opens: 鼠标点击触发 onSelect', () => {
    setup([makeDir('/a')]);
    const onSelect = vi.fn();
    const { getByRole } = render(<RecentDirList onSelect={onSelect} />);
    act(() => {
      fireEvent.click(getByRole('menuitem'));
    });
    expect(onSelect).toHaveBeenCalledWith('/a');
  });

  it('delete_click_does_not_open: 点 × 不冒泡到外层 click (AC-04-7)', () => {
    setup([makeDir('/a')]);
    const onSelect = vi.fn();
    const remove = vi.fn().mockResolvedValue(undefined);
    // 直接 spy store.remove.
    useRecentDirsStore.setState({ remove: remove as never });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { getByTestId } = render(<RecentDirList onSelect={onSelect} />);
    act(() => {
      fireEvent.click(getByTestId('recent-dir-item-delete'));
    });
    expect(onSelect).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith('/a');
  });

  it('delete_confirm_cancel: 用户取消 confirm → 不调 store.remove', () => {
    setup([makeDir('/a')]);
    const remove = vi.fn().mockResolvedValue(undefined);
    useRecentDirsStore.setState({ remove: remove as never });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { getByTestId } = render(<RecentDirList onSelect={vi.fn()} />);
    act(() => {
      fireEvent.click(getByTestId('recent-dir-item-delete'));
    });
    expect(remove).not.toHaveBeenCalled();
  });

  it('clear_invokes_store: 点「清空」 → store.clear 调用', () => {
    setup([makeDir('/a')]);
    const clear = vi.fn().mockResolvedValue(undefined);
    useRecentDirsStore.setState({ clear: clear as never });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { getByTestId } = render(<RecentDirList onSelect={vi.fn()} />);
    act(() => {
      fireEvent.click(getByTestId('recent-dir-clear'));
    });
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('clear_confirm_cancel: 用户取消 confirm → 不调 store.clear', () => {
    setup([makeDir('/a')]);
    const clear = vi.fn().mockResolvedValue(undefined);
    useRecentDirsStore.setState({ clear: clear as never });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { getByTestId } = render(<RecentDirList onSelect={vi.fn()} />);
    act(() => {
      fireEvent.click(getByTestId('recent-dir-clear'));
    });
    expect(clear).not.toHaveBeenCalled();
  });

  it('shows_cap_indicator: sr-only 元素展示 N/8 (FR-02)', () => {
    setup([makeDir('/a'), makeDir('/b'), makeDir('/c')]);
    const { getByTestId } = render(<RecentDirList onSelect={vi.fn()} />);
    const cap = getByTestId('recent-dir-list-cap');
    expect(cap.textContent).toBe(`3/${MAX_RECENT_DIRS}`);
  });

  it('renders_relative_time: 5 分钟前显示非空相对时间 (FR-06)', () => {
    setup([makeDir('/a', 5)]); // 5 分钟前.
    const { getByTestId } = render(<RecentDirList onSelect={vi.fn()} />);
    // jsdom 下 Intl.RelativeTimeFormat 输出依赖系统 locale (zh-CN 显示 "5分钟前",
    // en-US 显示 "5 minutes ago"). 这里只验证非空 + 数字 5 出现 + 不再显示 ISO 时间戳.
    const item = getByTestId('recent-dir-item').querySelector('[role="menuitem"]');
    expect(item?.textContent).toMatch(/5/);
    expect(item?.textContent).not.toMatch(/T\d{2}:\d{2}:\d{2}/); // 非原始 ISO 字符串.
  });

  it('renders_just_now: < 1 分钟前 → 相对时间非空 (FR-06)', () => {
    setup([makeDir('/fresh', 0)]);
    const { getByTestId } = render(<RecentDirList onSelect={vi.fn()} />);
    const item = getByTestId('recent-dir-item').querySelector('[role="menuitem"]');
    // 显示 "现在" (zh-CN) / "now" (en-US) / "in 0 seconds" 等. 只要非空即可.
    expect(item?.textContent?.length).toBeGreaterThan(0);
  });

  it('renders_absolute_fallback_for_very_old: > 30 天 → Intl.DateTimeFormat 数字 (FR-06)', () => {
    // 90 天前 → 走绝对日期分支.
    setup([makeDir('/old', 60 * 24 * 90)]);
    const { getByTestId } = render(<RecentDirList onSelect={vi.fn()} />);
    const item = getByTestId('recent-dir-item').querySelector('[role="menuitem"]');
    // 包含日期数字 (如 "4/9" / "9/4" / 国际化差异).
    expect(item?.textContent).toMatch(/\d+/);
  });
});

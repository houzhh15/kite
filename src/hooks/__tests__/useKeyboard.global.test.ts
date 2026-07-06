/**
 * useKeyboard 统一注册表测试 (T11 step-9 / 设计 §3.3).
 *
 * 覆盖:
 *   - 平台修饰键归一化: macOS metaKey / Win/Linux ctrlKey.
 *   - 10 条快捷键匹配: O / F / + / - / 0 / Shift+L / Shift+P / Home / End / Esc.
 *   - 表单守卫: input/textarea 内默认不触发; find/closeOverlay 例外.
 *   - IME 守卫: e.isComposing → 跳过.
 *   - 重复注册不泄漏.
 *   - 重复 key 防止浏览器默认: zoomIn/zoomOut/zoomReset/cycleTheme/recentDrawer/find.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  registerGlobalShortcuts,
  unregisterGlobalShortcuts,
} from '../useKeyboard';

function makeApi(): {
  isSearchOpen: ReturnType<typeof vi.fn>;
  openSearch: ReturnType<typeof vi.fn>;
  closeSearch: ReturnType<typeof vi.fn>;
  closeTopOverlay: ReturnType<typeof vi.fn>;
  openFile: ReturnType<typeof vi.fn>;
  bumpFontSize: ReturnType<typeof vi.fn>;
  cycleTheme: ReturnType<typeof vi.fn>;
  openRecentDrawer: ReturnType<typeof vi.fn>;
  scrollReaderTo: ReturnType<typeof vi.fn>;
  getReaderScrollEl: ReturnType<typeof vi.fn>;
  toggleTree: ReturnType<typeof vi.fn>;
  historyBack: ReturnType<typeof vi.fn>;
  historyForward: ReturnType<typeof vi.fn>;
  toggleFullscreen: ReturnType<typeof vi.fn>;
  // T26 (R-12 修复) — reload mock.
  reload: ReturnType<typeof vi.fn>;
  // T24 (F-26): openExternalEditor mock.
  openExternalEditor: ReturnType<typeof vi.fn>;
} {
  return {
    isSearchOpen: vi.fn(() => false),
    openSearch: vi.fn(),
    closeSearch: vi.fn(() => false),
    closeTopOverlay: vi.fn(() => false),
    openFile: vi.fn(),
    bumpFontSize: vi.fn(),
    cycleTheme: vi.fn(),
    openRecentDrawer: vi.fn(),
    scrollReaderTo: vi.fn(),
    getReaderScrollEl: vi.fn(() => null),
    // T15 (FR-01/FR-04) 新增 mock.
    toggleTree: vi.fn(),
    historyBack: vi.fn(),
    historyForward: vi.fn(),
    // T16-P2 (FR-03) — 全屏切换 mock.
    toggleFullscreen: vi.fn(),
    // T24 (F-26) — openExternalEditor mock.
    openExternalEditor: vi.fn(),
    // T26 (R-12 修复) — reload mock.
    reload: vi.fn(),
  };
}

function setPlatform(value: string): void {
  Object.defineProperty(navigator, 'platform', { value, configurable: true });
  Object.defineProperty(navigator, 'userAgent', {
    value: value.includes('Mac')
      ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    configurable: true,
  });
}

beforeEach(() => {
  unregisterGlobalShortcuts();
  setPlatform('Win32');
});

afterEach(() => {
  unregisterGlobalShortcuts();
  setPlatform('');
  vi.restoreAllMocks();
});

describe('useKeyboard 统一注册表 (T11 step-9)', () => {
  it('Ctrl+O → openFile', () => {
    const api = makeApi();
    registerGlobalShortcuts(api);
    const ev = new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(ev);
    expect(api.openFile).toHaveBeenCalled();
  });

  it('Ctrl+F → openSearch + preventDefault', () => {
    const api = makeApi();
    registerGlobalShortcuts(api);
    const ev = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true });
    const pd = vi.spyOn(ev, 'preventDefault');
    window.dispatchEvent(ev);
    expect(api.openSearch).toHaveBeenCalled();
    expect(pd).toHaveBeenCalled();
  });

  it('Ctrl+= → bumpFontSize(+1)', () => {
    const api = makeApi();
    registerGlobalShortcuts(api);
    const ev = new KeyboardEvent('keydown', { key: '=', ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(ev);
    expect(api.bumpFontSize).toHaveBeenCalledWith(1);
  });

  it('Ctrl+- → bumpFontSize(-1)', () => {
    const api = makeApi();
    registerGlobalShortcuts(api);
    const ev = new KeyboardEvent('keydown', { key: '-', ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(ev);
    expect(api.bumpFontSize).toHaveBeenCalledWith(-1);
  });

  it('Ctrl+0 → bumpFontSize(0)', () => {
    const api = makeApi();
    registerGlobalShortcuts(api);
    const ev = new KeyboardEvent('keydown', { key: '0', ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(ev);
    expect(api.bumpFontSize).toHaveBeenCalledWith(0);
  });

  it('Ctrl+Shift+L → cycleTheme', () => {
    const api = makeApi();
    registerGlobalShortcuts(api);
    const ev = new KeyboardEvent('keydown', {
      key: 'L', shiftKey: true, ctrlKey: true, bubbles: true, cancelable: true,
    });
    window.dispatchEvent(ev);
    expect(api.cycleTheme).toHaveBeenCalled();
  });

  it('Ctrl+Shift+P → openRecentDrawer', () => {
    const api = makeApi();
    registerGlobalShortcuts(api);
    const ev = new KeyboardEvent('keydown', {
      key: 'P', shiftKey: true, ctrlKey: true, bubbles: true, cancelable: true,
    });
    window.dispatchEvent(ev);
    expect(api.openRecentDrawer).toHaveBeenCalled();
  });

  it('Home → scrollReaderTo(top)', () => {
    const api = makeApi();
    registerGlobalShortcuts(api);
    const ev = new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true });
    window.dispatchEvent(ev);
    expect(api.scrollReaderTo).toHaveBeenCalledWith('top');
  });

  it('End → scrollReaderTo(bottom)', () => {
    const api = makeApi();
    registerGlobalShortcuts(api);
    const ev = new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true });
    window.dispatchEvent(ev);
    expect(api.scrollReaderTo).toHaveBeenCalledWith('bottom');
  });

  it('Esc → closeTopOverlay', () => {
    const api = makeApi();
    registerGlobalShortcuts(api);
    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    window.dispatchEvent(ev);
    expect(api.closeTopOverlay).toHaveBeenCalled();
  });
});

describe('useKeyboard 守卫 (T11 step-9)', () => {
  it('IME 组合中 → 全部快捷键跳过', () => {
    const api = makeApi();
    registerGlobalShortcuts(api);
    const ev = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'isComposing', { value: true });
    window.dispatchEvent(ev);
    expect(api.openSearch).not.toHaveBeenCalled();
  });

  it('input 内 (非 find) → 不触发', () => {
    const api = makeApi();
    registerGlobalShortcuts(api);
    const input = document.createElement('input');
    document.body.appendChild(input);
    const ev = new KeyboardEvent('keydown', {
      key: 'o', ctrlKey: true, bubbles: true, cancelable: true,
    });
    Object.defineProperty(ev, 'target', { value: input });
    window.dispatchEvent(ev);
    expect(api.openFile).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it('input 内 + Cmd+F → openSearch 仍触发 (allowInForm)', () => {
    const api = makeApi();
    registerGlobalShortcuts(api);
    const input = document.createElement('input');
    document.body.appendChild(input);
    const ev = new KeyboardEvent('keydown', {
      key: 'f', ctrlKey: true, bubbles: true, cancelable: true,
    });
    Object.defineProperty(ev, 'target', { value: input });
    window.dispatchEvent(ev);
    expect(api.openSearch).toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it('重复注册: 移除旧 listener', () => {
    const api = makeApi();
    registerGlobalShortcuts(api);
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    registerGlobalShortcuts(api);
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true);
  });

  it('unregister 后: 不再响应', () => {
    const api = makeApi();
    registerGlobalShortcuts(api);
    unregisterGlobalShortcuts();
    const ev = new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(ev);
    expect(api.openFile).not.toHaveBeenCalled();
  });
});

describe('useKeyboard 跨平台 (T11 step-9)', () => {
  it('macOS: metaKey 触发, ctrlKey 不触发 (Cmd+O)', () => {
    setPlatform('MacIntel');
    const api = makeApi();
    registerGlobalShortcuts(api);
    const ev = new KeyboardEvent('keydown', { key: 'o', metaKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(ev);
    expect(api.openFile).toHaveBeenCalled();
  });

  it('macOS: ctrlKey 不应触发 (Ctrl+O 在 macOS 被忽略)', () => {
    setPlatform('MacIntel');
    const api = makeApi();
    registerGlobalShortcuts(api);
    const ev = new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(ev);
    expect(api.openFile).not.toHaveBeenCalled();
  });

  it('Windows: ctrlKey 触发, metaKey 不触发', () => {
    setPlatform('Win32');
    const api = makeApi();
    registerGlobalShortcuts(api);
    const ev = new KeyboardEvent('keydown', { key: 'o', metaKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(ev);
    expect(api.openFile).not.toHaveBeenCalled();
  });
});
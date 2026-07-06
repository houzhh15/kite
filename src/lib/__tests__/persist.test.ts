/**
 * persist.test.ts — T12 防抖持久化 + loadAndHydrate 测试.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { debouncedPersist, loadAndHydrate, saveNow } from '../persist';
import * as tauri from '../tauri';
import { usePrefStore } from '../../stores/prefStore';
import { pushToast } from '../toast';

vi.mock('../tauri', async () => {
  const actual = await vi.importActual<typeof tauri>('../tauri');
  return {
    ...actual,
    loadPreferences: vi.fn(),
    savePreferences: vi.fn(),
  };
});

vi.mock('../toast', () => ({
  pushToast: vi.fn(),
}));

describe('debouncedPersist — 300ms 防抖合并', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('连发 5 次在 300ms 内仅触发 1 次', () => {
    const fn = vi.fn();
    const debounced = debouncedPersist(fn, 300);
    debounced();
    debounced();
    debounced();
    debounced();
    debounced();
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('flush 立即触发待执行保存', () => {
    const fn = vi.fn();
    const debounced = debouncedPersist(fn, 300);
    debounced();
    expect(fn).not.toHaveBeenCalled();
    debounced.flush();
    expect(fn).toHaveBeenCalledTimes(1);
    // 后续不再触发
    vi.advanceTimersByTime(300);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('cancel 取消待执行保存', () => {
    const fn = vi.fn();
    const debounced = debouncedPersist(fn, 300);
    debounced();
    debounced.cancel();
    vi.advanceTimersByTime(300);
    expect(fn).not.toHaveBeenCalled();
  });

  it('多次 flush 之间不重复触发', () => {
    const fn = vi.fn();
    const debounced = debouncedPersist(fn, 300);
    debounced();
    debounced.flush();
    debounced.flush();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('loadAndHydrate — 启动加载与容错', () => {
  beforeEach(() => {
    usePrefStore.setState({
      prefs: {
        theme: 'system',
        fontSize: 16,
        lineHeight: 1.6,
        codeBlockTheme: 'github',
        fontSizeId: 'md',
        lineHeightId: 'cozy',
        codeFontSizeId: 'md',
        language: 'zh-CN',
        mermaidEnabled: false,
        katexEnabled: false,
        externalEditor: 'system',
        externalEditorCustomCmd: '',
      },
      hydrated: false,
      loaded: false,
    });
    vi.mocked(tauri.loadPreferences).mockReset();
    vi.mocked(pushToast).mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('成功路径: loadPreferences resolve → hydrate(partial)', async () => {
    vi.mocked(tauri.loadPreferences).mockResolvedValue({
      theme: 'dark',
      fontSize: 20,
      lineHeight: 1.8,
    });
    await loadAndHydrate();
    const s = usePrefStore.getState();
    expect(s.hydrated).toBe(true);
    expect(s.prefs.theme).toBe('dark');
    expect(s.prefs.fontSize).toBe(20);
    expect(s.prefs.fontSizeId).toBe('xl');
  });

  it('失败路径: loadPreferences reject → 默认 + toast', async () => {
    vi.mocked(tauri.loadPreferences).mockRejectedValue(new Error('store corrupt'));
    await loadAndHydrate();
    const s = usePrefStore.getState();
    expect(s.hydrated).toBe(true);
    expect(s.prefs.theme).toBe('system');
    expect(s.prefs.fontSize).toBe(16);
    expect(s.prefs.fontSizeId).toBe('md');
    expect(pushToast).toHaveBeenCalledWith({
      kind: 'info',
      message: '偏好已重置',
    });
  });
});

describe('saveNow — fire-and-forget', () => {
  beforeEach(() => {
    vi.mocked(tauri.savePreferences).mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('成功路径: console 不输出 warn', async () => {
    vi.mocked(tauri.savePreferences).mockResolvedValue(undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    saveNow({ theme: 'dark', fontSize: 20, lineHeight: 1.8 });
    // 等待 microtask 完成
    await Promise.resolve();
    expect(warn).not.toHaveBeenCalled();
  });

  it('失败路径: console.warn 但不抛错', async () => {
    vi.mocked(tauri.savePreferences).mockRejectedValue(new Error('io'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    saveNow({ theme: 'dark' });
    await Promise.resolve();
    await Promise.resolve();
    expect(warn).toHaveBeenCalled();
  });
});
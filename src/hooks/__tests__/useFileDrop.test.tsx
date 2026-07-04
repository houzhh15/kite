/**
 * useFileDrop.test.ts — hook 单测 (F-02 / 设计 §4.4 测试矩阵).
 * 设计依据: docs/design/compiled.md §4.4 + docs/plan/compiled.md Step 3.
 * 覆盖: 正常 / 拒绝 / 空 paths / 大小写 / 视觉态计数 / 去重 / close 顺序 / AppError / Unknown.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';

import { useDocStore } from '../../stores/docStore';
import { useRecentStore } from '../../stores/recentStore';
import { useFileDrop, type FileDropEvent, type FileDropSource } from '../useFileDrop';

vi.mock('../../lib/tauri', () => {
  const fn = () => vi.fn().mockResolvedValue(undefined);
  return {
    readMarkdownFile: vi.fn(),
    addRecentFile: vi.fn().mockResolvedValue(undefined),
    setWindowTitle: vi.fn().mockResolvedValue(undefined),
    loadPreferences: fn(),
    savePreferences: fn(),
    getRecentFiles: vi.fn().mockResolvedValue([]),
    clearRecentFiles: vi.fn().mockResolvedValue(undefined),
    openExternalUrl: fn(),
    resolveImagePath: fn(),
  };
});

vi.mock('../../lib/toast', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../lib/toast');
  return {
    ...actual,
    pushToast: vi.fn(),
  };
});

import { readMarkdownFile, addRecentFile, setWindowTitle } from '../../lib/tauri';
import { pushToast } from '../../lib/toast';

const mockRead = readMarkdownFile as unknown as ReturnType<typeof vi.fn>;
const mockAddRecent = addRecentFile as unknown as ReturnType<typeof vi.fn>;
const mockSetWindowTitle = setWindowTitle as unknown as ReturnType<typeof vi.fn>;
const mockPushToast = pushToast as unknown as ReturnType<typeof vi.fn>;

// ---- mock 事件源工厂 ----

function createMockSource(): FileDropSource & { emit: (e: FileDropEvent) => void; calls: FileDropEvent[] } {
  const calls: FileDropEvent[] = [];
  let handler: ((e: FileDropEvent) => void) | null = null;
  return {
    calls,
    subscribe(h) {
      handler = h;
      return () => { handler = null; };
    },
    emit(e) {
      calls.push(e);
      if (handler) handler(e);
    },
  };
}

function Probe({ source }: { source: FileDropSource }): null {
  useFileDrop(() => source);
  return null;
}

// ---- 公共 setup ----

beforeEach(() => {
  mockRead.mockReset();
  mockAddRecent.mockReset();
  mockAddRecent.mockResolvedValue(undefined);
  mockSetWindowTitle.mockReset();
  mockSetWindowTitle.mockResolvedValue(undefined);
  mockPushToast.mockReset();
  useDocStore.setState({
    state: { currentPath: null, content: '', title: '', dirty: false },
  });
  useRecentStore.setState({ items: [], loaded: true });
  document.body.removeAttribute('data-drag-active');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useFileDrop — happy path', () => {
  it('drops single .md → setContent + pushRecent + addRecentFile (AC-01-1)', async () => {
    const source = createMockSource();
    mockRead.mockResolvedValue('# hello');
    render(<Probe source={source} />);

    await act(async () => {
      source.emit({ type: 'enter', paths: ['/tmp/a.md'] });
      source.emit({ type: 'drop', paths: ['/tmp/a.md'] });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const s = useDocStore.getState().state;
    expect(s.currentPath).toBe('/tmp/a.md');
    expect(s.title).toBe('a');
    expect(s.content).toBe('# hello');
    expect(s.dirty).toBe(false);
    expect(mockRead).toHaveBeenCalledWith('/tmp/a.md');
    const items = useRecentStore.getState().items;
    expect(items[0]).toMatchObject({ path: '/tmp/a.md', title: 'a' });
    expect(mockAddRecent).toHaveBeenCalledWith('/tmp/a.md', 'a');
    expect(mockPushToast).not.toHaveBeenCalled();
  });

  it('preserves case in path (AC-02-4)', async () => {
    const source = createMockSource();
    mockRead.mockResolvedValue('x');
    render(<Probe source={source} />);
    await act(async () => {
      source.emit({ type: 'drop', paths: ['/A.MD'] });
      await Promise.resolve();
    });
    expect(useDocStore.getState().state.currentPath).toBe('/A.MD');
    expect(useDocStore.getState().state.title).toBe('A');
  });
});

describe('useFileDrop — rejection', () => {
  it('rejects .pdf with toast (AC-02-2)', async () => {
    const source = createMockSource();
    render(<Probe source={source} />);
    await act(async () => {
      source.emit({ type: 'drop', paths: ['/x/manual.pdf'] });
      await Promise.resolve();
    });
    expect(mockPushToast).toHaveBeenCalledTimes(1);
    const arg = mockPushToast.mock.calls[0]?.[0] as { kind: string; message: string };
    expect(arg.kind).toBe('error');
    expect(arg.message).toMatch(/\.pdf/);
    expect(arg.message).toMatch(/md/);
    expect(mockRead).not.toHaveBeenCalled();
    expect(useDocStore.getState().state.currentPath).toBeNull();
  });

  it('rejects .docx', async () => {
    const source = createMockSource();
    render(<Probe source={source} />);
    await act(async () => {
      source.emit({ type: 'drop', paths: ['/x/a.docx'] });
      await Promise.resolve();
    });
    expect(mockPushToast).toHaveBeenCalledTimes(1);
    expect(mockRead).not.toHaveBeenCalled();
  });

  it('rejects file:// prefix path (NFR-02-3)', async () => {
    const source = createMockSource();
    render(<Probe source={source} />);
    await act(async () => {
      source.emit({ type: 'drop', paths: ['file:///tmp/a.md'] });
      await Promise.resolve();
    });
    expect(mockPushToast).toHaveBeenCalledTimes(1);
    expect(mockRead).not.toHaveBeenCalled();
  });

  it('handles empty paths array', async () => {
    const source = createMockSource();
    render(<Probe source={source} />);
    await act(async () => {
      source.emit({ type: 'drop', paths: [] });
      await Promise.resolve();
    });
    expect(mockPushToast).toHaveBeenCalledTimes(1);
    expect(mockRead).not.toHaveBeenCalled();
  });
});

describe('useFileDrop — visual state', () => {
  it('toggles body[data-drag-active] on enter / leave (AC-03-1/2)', async () => {
    const source = createMockSource();
    render(<Probe source={source} />);
    await act(async () => {
      source.emit({ type: 'enter', paths: [] });
      await Promise.resolve();
    });
    expect(document.body.getAttribute('data-drag-active')).toBe('true');

    await act(async () => {
      source.emit({ type: 'leave', paths: [] });
      await Promise.resolve();
    });
    expect(document.body.getAttribute('data-drag-active')).toBeNull();
  });

  it('counter: 3 enter + 2 leave still true; 3rd leave → false', async () => {
    const source = createMockSource();
    render(<Probe source={source} />);
    await act(async () => {
      source.emit({ type: 'enter', paths: [] });
      source.emit({ type: 'enter', paths: [] });
      source.emit({ type: 'enter', paths: [] });
      source.emit({ type: 'leave', paths: [] });
      source.emit({ type: 'leave', paths: [] });
      await Promise.resolve();
    });
    expect(document.body.getAttribute('data-drag-active')).toBe('true');
    await act(async () => {
      source.emit({ type: 'leave', paths: [] });
      await Promise.resolve();
    });
    expect(document.body.getAttribute('data-drag-active')).toBeNull();
  });

  it('drop clears visual state', async () => {
    const source = createMockSource();
    mockRead.mockResolvedValue('x');
    render(<Probe source={source} />);
    await act(async () => {
      source.emit({ type: 'enter', paths: [] });
      await Promise.resolve();
    });
    expect(document.body.getAttribute('data-drag-active')).toBe('true');
    await act(async () => {
      source.emit({ type: 'drop', paths: ['/a.md'] });
      await Promise.resolve();
    });
    expect(document.body.getAttribute('data-drag-active')).toBeNull();
  });
});

describe('useFileDrop — dedup & ordering', () => {
  it('1s dedup: same error key within window → pushToast once', async () => {
    const source = createMockSource();
    render(<Probe source={source} />);
    await act(async () => {
      source.emit({ type: 'drop', paths: ['/a.pdf'] });
      source.emit({ type: 'drop', paths: ['/b.pdf'] });
      await Promise.resolve();
    });
    expect(mockPushToast).toHaveBeenCalledTimes(1);
  });

  it('close() runs synchronously before readMarkdownFile (AC-04-2)', async () => {
    const source = createMockSource();
    useDocStore.setState({
      state: { currentPath: '/old.md', content: 'OLD', title: 'old', dirty: false },
    });
    let closeOrder = -1;
    let readOrder = -1;
    const orderRef = { i: 0 };
    const realClose = useDocStore.getState().close;
    useDocStore.setState({
      ...useDocStore.getState(),
      close: () => {
        closeOrder = orderRef.i++;
        realClose();
      },
    });
    mockRead.mockImplementation(async () => {
      readOrder = orderRef.i++;
      return 'NEW';
    });
    render(<Probe source={source} />);
    await act(async () => {
      source.emit({ type: 'drop', paths: ['/new.md'] });
      await Promise.resolve();
    });
    expect(closeOrder).toBeLessThan(readOrder);
    expect(useDocStore.getState().state.content).toBe('NEW');
  });
});

describe('useFileDrop — error paths', () => {
  it('AppError NOT_FOUND → toast + no setContent', async () => {
    const source = createMockSource();
    mockRead.mockRejectedValue({ code: 'NOT_FOUND', message: 'not found' });
    render(<Probe source={source} />);
    await act(async () => {
      source.emit({ type: 'drop', paths: ['/missing.md'] });
      await Promise.resolve();
    });
    expect(mockPushToast).toHaveBeenCalledTimes(1);
    const arg = mockPushToast.mock.calls[0]?.[0] as { kind: string; message: string };
    expect(arg.message).toMatch(/文件不存在/);
    expect(useDocStore.getState().state.currentPath).toBeNull();
  });

  it('Unknown error → toast + no setContent', async () => {
    const source = createMockSource();
    mockRead.mockRejectedValue(new Error('boom'));
    render(<Probe source={source} />);
    await act(async () => {
      source.emit({ type: 'drop', paths: ['/a.md'] });
      await Promise.resolve();
    });
    expect(mockPushToast).toHaveBeenCalledTimes(1);
    const arg = mockPushToast.mock.calls[0]?.[0] as { kind: string; message: string };
    expect(arg.message).toMatch(/打开文件失败/);
  });

  it('addRecentFile failure is logged but does not break flow', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const source = createMockSource();
    // 改写 mock: 用 mockImplementationOnce 仅本次拒绝, 避免清掉其它已登记的实现
    mockRead.mockImplementationOnce(async () => 'x');
    mockAddRecent.mockImplementationOnce(async () => {
      throw new Error('disk full');
    });
    useRecentStore.setState({ items: [], loaded: true });
    render(<Probe source={source} />);
    source.emit({ type: 'drop', paths: ['/a.md'] });
    for (let i = 0; i < 30; i++) {
      await Promise.resolve();
    }
    expect(useDocStore.getState().state.currentPath).toBe('/a.md');
    expect(warn).toHaveBeenCalled();
  });
});

describe('useFileDrop — cleanup', () => {
  it('unmount clears visual state and unsubscribes', async () => {
    const source = createMockSource();
    const { unmount } = render(<Probe source={source} />);
    await act(async () => {
      source.emit({ type: 'enter', paths: [] });
      await Promise.resolve();
    });
    expect(document.body.getAttribute('data-drag-active')).toBe('true');
    await act(async () => {
      unmount();
      await Promise.resolve();
    });
    expect(document.body.getAttribute('data-drag-active')).toBeNull();
  });
});

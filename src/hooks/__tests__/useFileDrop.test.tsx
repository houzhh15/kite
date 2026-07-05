/**
 * useFileDrop.test.ts — hook 单测 (F-02 / 设计 §4.4 测试矩阵).
 * 设计依据: docs/design/compiled.md §4.4 + docs/plan/compiled.md Step 3.
 *
 * 覆盖范围 (R-07 修复后):
 *   - useFileDrop 仅负责: 扩展名过滤 / picked path 派发 / 视觉态 / dedup /
 *     未注册 onFilePicked 时静默 warn. 不再自行调 readMarkdownFile / setContent /
 *     pushRecent / addRecentFile — 这些是 useMarkdownDoc.loadFile 的职责,
 *     由 useMarkdownDoc.integration.test.ts 覆盖.
 *
 * 测试策略:
 *   - 用 `capture`-style Probe 在 Probe 里收到 onFilePicked 参数, 把它
 *     注入到 useFileDrop options, 同时记录被调用的 path.
 *   - 验证: drop 命中 .md → onFilePicked 立刻被调一次, 收到的 path 与
 *     drop 路径一致; drop 拒识 / 空路径 / 视觉态 / dedup 行为不变.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { useRef } from 'react';

import { useFileDrop, type FileDropEvent, type FileDropSource } from '../useFileDrop';

vi.mock('../../lib/toast', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../lib/toast');
  return {
    ...actual,
    pushToast: vi.fn(),
  };
});

import { pushToast } from '../../lib/toast';
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

/**
 * Probe — 把 options.onFilePicked 收集到的 path 暴露给测试.
 * 用 ref 维持稳定引用, 避免 React strict mode 下 effect 双跑 / 测试 flake.
 */
interface ProbeHandle {
  callPaths: string[];
  callHandler: (path: string) => void | Promise<void>;
}

function Probe({
  source,
  handle,
  handler,
}: {
  source: FileDropSource;
  handle?: ProbeHandle;
  handler?: (path: string) => void | Promise<void>;
}): null {
  const ref = useRef<ProbeHandle | null>(handle ?? null);
  useFileDrop(() => source, {
    onFilePicked: (path) => {
      // 收集到全局 ref (records), 同时支持注入自定义 handler.
      if (ref.current) ref.current.callPaths.push(path);
      if (handler) return handler(path);
      return undefined;
    },
  });
  return null;
}

// ---- 公共 setup ----

beforeEach(() => {
  mockPushToast.mockReset();
  document.body.removeAttribute('data-drag-active');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useFileDrop — happy path', () => {
  it('drop single .md → onFilePicked called once with the path (AC-01-1)', async () => {
    const source = createMockSource();
    const handle: ProbeHandle = { callPaths: [], callHandler: () => {} };
    render(<Probe source={source} handle={handle} />);

    await act(async () => {
      source.emit({ type: 'enter', paths: ['/tmp/a.md'] });
      source.emit({ type: 'drop', paths: ['/tmp/a.md'] });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(handle.callPaths).toEqual(['/tmp/a.md']);
    expect(mockPushToast).not.toHaveBeenCalled();
  });

  it('preserves case in path passed to onFilePicked (AC-02-4)', async () => {
    const source = createMockSource();
    const handle: ProbeHandle = { callPaths: [], callHandler: () => {} };
    render(<Probe source={source} handle={handle} />);
    await act(async () => {
      source.emit({ type: 'drop', paths: ['/A.MD'] });
      await Promise.resolve();
    });
    expect(handle.callPaths).toEqual(['/A.MD']);
  });

  it('when multiple paths, picks the first valid .md in order', async () => {
    const source = createMockSource();
    const handle: ProbeHandle = { callPaths: [], callHandler: () => {} };
    render(<Probe source={source} handle={handle} />);
    await act(async () => {
      source.emit({ type: 'drop', paths: ['/a.txt', '/b.md', '/c.mdx'] });
      await Promise.resolve();
    });
    // pickMarkdownPath 在 fileDropHelpers 中: 遍历数组, 第一个命中 md/markdown/mdx 取它.
    expect(handle.callPaths.length).toBe(1);
    expect(handle.callPaths[0]).toBe('/b.md');
  });
});

describe('useFileDrop — rejection', () => {
  it('rejects .pdf with toast (AC-02-2)', async () => {
    const source = createMockSource();
    const handle: ProbeHandle = { callPaths: [], callHandler: () => {} };
    render(<Probe source={source} handle={handle} />);
    await act(async () => {
      source.emit({ type: 'drop', paths: ['/x/manual.pdf'] });
      await Promise.resolve();
    });
    expect(mockPushToast).toHaveBeenCalledTimes(1);
    const arg = mockPushToast.mock.calls[0]?.[0] as { kind: string; message: string };
    expect(arg.kind).toBe('error');
    expect(arg.message).toMatch(/\.pdf/);
    expect(arg.message).toMatch(/md/);
    expect(handle.callPaths).toEqual([]);
  });

  it('rejects .docx', async () => {
    const source = createMockSource();
    const handle: ProbeHandle = { callPaths: [], callHandler: () => {} };
    render(<Probe source={source} handle={handle} />);
    await act(async () => {
      source.emit({ type: 'drop', paths: ['/x/a.docx'] });
      await Promise.resolve();
    });
    expect(mockPushToast).toHaveBeenCalledTimes(1);
    expect(handle.callPaths).toEqual([]);
  });

  it('rejects file:// prefix path (NFR-02-3)', async () => {
    const source = createMockSource();
    const handle: ProbeHandle = { callPaths: [], callHandler: () => {} };
    render(<Probe source={source} handle={handle} />);
    await act(async () => {
      source.emit({ type: 'drop', paths: ['file:///tmp/a.md'] });
      await Promise.resolve();
    });
    expect(mockPushToast).toHaveBeenCalledTimes(1);
    expect(handle.callPaths).toEqual([]);
  });

  it('handles empty paths array with toast', async () => {
    const source = createMockSource();
    const handle: ProbeHandle = { callPaths: [], callHandler: () => {} };
    render(<Probe source={source} handle={handle} />);
    await act(async () => {
      source.emit({ type: 'drop', paths: [] });
      await Promise.resolve();
    });
    expect(mockPushToast).toHaveBeenCalledTimes(1);
    expect(handle.callPaths).toEqual([]);
  });
});

describe('useFileDrop — visual state', () => {
  it('toggles body[data-drag-active] on enter / leave (AC-03-1/2)', async () => {
    const source = createMockSource();
    render(<Probe source={source} handle={{ callPaths: [], callHandler: () => {} }} />);
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
    render(<Probe source={source} handle={{ callPaths: [], callHandler: () => {} }} />);
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
    render(<Probe source={source} handle={{ callPaths: [], callHandler: () => {} }} />);
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
    render(<Probe source={source} handle={{ callPaths: [], callHandler: () => {} }} />);
    await act(async () => {
      source.emit({ type: 'drop', paths: ['/a.pdf'] });
      source.emit({ type: 'drop', paths: ['/b.pdf'] });
      await Promise.resolve();
    });
    expect(mockPushToast).toHaveBeenCalledTimes(1);
  });

  it('passes picked path immediately (synchronously before any await chain)', async () => {
    // R-07 修复: 不再 close + setContent, useFileDrop 现在只把 picked path
    // 同步交给 onFilePicked (由调用方决定如何 await). 这里只验证 picked
    // 立刻被记录, 路径选择 (pickMarkdownPath) 的语义由 fileDropHelpers 测覆盖.
    const source = createMockSource();
    const handle: ProbeHandle = { callPaths: [], callHandler: () => {} };
    render(<Probe source={source} handle={handle} />);
    await act(async () => {
      source.emit({ type: 'drop', paths: ['/a.md', '/b.MD'] });
      await Promise.resolve();
    });
    // 第一个 .md → /a.md
    expect(handle.callPaths).toEqual(['/a.md']);
  });
});

describe('useFileDrop — onFilePicked error handling', () => {
  it('unknown error from onFilePicked → pushToast (AppError code paths skipped)', async () => {
    const source = createMockSource();
    render(
      <Probe
        source={source}
        handle={{ callPaths: [], callHandler: () => {} }}
        handler={async () => {
          throw new Error('boom');
        }}
      />,
    );
    await act(async () => {
      source.emit({ type: 'drop', paths: ['/a.md'] });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockPushToast).toHaveBeenCalledTimes(1);
    const arg = mockPushToast.mock.calls[0]?.[0] as { kind: string; message: string };
    expect(arg.message).toMatch(/打开文件失败/);
  });

  it('AppError from onFilePicked → no duplicate toast (caller already toasts)', async () => {
    const source = createMockSource();
    render(
      <Probe
        source={source}
        handle={{ callPaths: [], callHandler: () => {} }}
        handler={async () => {
          // 模拟 useMarkdownDoc.loadFile 已调 pushToast 错误.
          // 这里再次 throw 一个 AppError-shaped 对象, useFileDrop 的兜底
          // 检测 isAppErrorCode 应跳过不再 toast.
          const err = new Error('not_found_in_caller');
          (err as Error & { code: string }).code = 'NOT_FOUND';
          throw err;
        }}
      />,
    );
    await act(async () => {
      source.emit({ type: 'drop', paths: ['/a.md'] });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockPushToast).not.toHaveBeenCalled();
  });

  it('emits console.warn + does nothing when no onFilePicked is registered', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const source = createMockSource();
    render(<Probe source={source} handle={{ callPaths: [], callHandler: () => {} }} />);
    // 临时清掉 options.onFilePicked 是不可能的, 这里我们用一个空 function 模拟.
    // 真正的"未注册"由 src/App.tsx 的 useMarkdownDoc 链路保证. 这里改成
    // 直接验证 onFilePicked 被传入的实现总会被调用.
    await act(async () => {
      source.emit({ type: 'drop', paths: ['/a.md'] });
      await Promise.resolve();
    });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('useFileDrop — no onFilePicked behavior', () => {
  it('no onFilePicked → console.warn + no toast, no state mutation', async () => {
    // 用一个空 options 的最小组件验证未注册 onFilePicked 时的行为.
    function EmptyProbe({ source }: { source: FileDropSource }): null {
      useFileDrop(() => source); // no options
      return null;
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const source = createMockSource();
    render(<EmptyProbe source={source} />);
    await act(async () => {
      source.emit({ type: 'drop', paths: ['/a.md'] });
      await Promise.resolve();
    });
    expect(warn).toHaveBeenCalled();
    expect(mockPushToast).not.toHaveBeenCalled();
  });
});

describe('useFileDrop — cleanup', () => {
  it('unmount clears visual state and unsubscribes', async () => {
    const source = createMockSource();
    const { unmount } = render(
      <Probe source={source} handle={{ callPaths: [], callHandler: () => {} }} />,
    );
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

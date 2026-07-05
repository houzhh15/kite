/**
 * useMarkdownDoc integration test (NFR-T-02 / Step 9a).
 *
 * 用 vitest 模拟 Tauri IPC:
 *   - mock '@tauri-apps/api/core' 的 invoke → read_markdown_file
 *   - mock '@tauri-apps/plugin-dialog' 的 open → 返回固定路径
 *
 * 验证 happy path: dialog.open → readMarkdownFile → state.status === 'ok' 且
 * useDocStore.getState().state.content 与 fixture 字符串一致.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { useMarkdownDoc } from '../useMarkdownDoc';
import { useDocStore } from '../../stores/docStore';

const FIXTURE_PATH = '/Users/test/sample/hello.md';
const FIXTURE_CONTENT = '# Sample fixture\n\nit works!\n';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (_cmd: string, args: { path: string }) => {
    if (args?.path !== FIXTURE_PATH) {
      // 还原 Rust 错误形状
      throw { code: 'NOT_FOUND', message: `path ${args.path} does not exist` };
    }
    return FIXTURE_CONTENT;
  }),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(async () => FIXTURE_PATH),
}));

// Tauri 环境检测 stub: lib/tauri.ts::safeInvoke 在非 Tauri 环境下会 reject,
// 此测试意图是 "IPC 可用" 场景, 因此把 __TAURI_INTERNALS__ 挂到 window 上.
beforeEach(() => {
  (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {
    invoke: () => Promise.resolve(),
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
  };
});

describe('useMarkdownDoc integration (mocked IPC)', () => {
  beforeEach(() => {
    // 避免上一个用例的副作用影响
    useDocStore.setState({ state: { currentPath: null, content: '', title: '', dirty: false } });
  });

  it('happy path: open -> ok, useDocStore mirrors content', async () => {
    const { result } = renderHook(() => useMarkdownDoc());
    expect(result.current.state.status).toBe('idle');

    await act(async () => {
      await result.current.open();
    });

    expect(result.current.state.status).toBe('ok');
    expect(result.current.state.doc?.content).toBe(FIXTURE_CONTENT);
    expect(result.current.state.doc?.path).toBe(FIXTURE_PATH);

    const stored = useDocStore.getState().state;
    expect(stored.content).toBe(FIXTURE_CONTENT);
    expect(stored.currentPath).toBe(FIXTURE_PATH);
    expect(stored.dirty).toBe(false);
  });

  // T19 (R-04 修复): open() 路径也应写 useDocStore.history, 否则 Toolbar
  // ← → 永远 disabled. 这里验证 open 之后再 loadFile 第二个文件, history 应有 2 项.
  it('T19: 连续 open + loadFile → useDocStore.history 累积, cursor 指向当前', async () => {
    const SECOND_PATH = '/Users/test/sample/big.md';
    const SECOND_CONTENT = '# Big fixture\n';

    // 扩展 invoke mock 支持两个 fixture. useMarkdownDoc 通过 @tauri-apps/api/core
    // 的 invoke 走 IPC, 因此 vi.mock('@tauri-apps/api/core') 是真正的拦截点.
    const { invoke } = await import('@tauri-apps/api/core');
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation(async (_cmd: string, args: { path: string }) => {
      if (args?.path === FIXTURE_PATH) return FIXTURE_CONTENT;
      if (args?.path === SECOND_PATH) return SECOND_CONTENT;
      throw { code: 'NOT_FOUND', message: 'not found' };
    });

    // 清空 history 状态.
    useDocStore.setState({
      history: [],
      cursor: -1,
      state: { currentPath: null, content: '', title: '', dirty: false },
    });

    const { result } = renderHook(() => useMarkdownDoc());

    // 1) dialog → open FIXTURE_PATH
    await act(async () => {
      await result.current.open();
    });
    expect(useDocStore.getState().history).toEqual([FIXTURE_PATH]);
    expect(useDocStore.getState().cursor).toBe(0);

    // 2) 直接 loadFile(第二个文件)
    await act(async () => {
      await result.current.loadFile(SECOND_PATH);
    });
    expect(useDocStore.getState().history).toEqual([FIXTURE_PATH, SECOND_PATH]);
    expect(useDocStore.getState().cursor).toBe(1);
    // canGoBack → true; canGoForward → false (已经在末尾).
    expect(useDocStore.getState().canGoBack()).toBe(true);
    expect(useDocStore.getState().canGoForward()).toBe(false);
  });
});

/**
 * Toolbar.t19.flow.test.tsx — Toolbar + useMarkdownDoc 联动集成测试 (T19).
 *
 * 覆盖:
 *   - open() 后 → history=1, back disabled (cursor=0)
 *   - 连续 open + loadFile(B) → back enabled, forward disabled (修复核心)
 *   - click ← → cursor 回到 0, back 变 disabled, forward enabled
 *
 * 重要: 这是验证"打开多个文件后 ← / → 还是不可点击" 修复 (R-04) 的唯一测试.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, fireEvent } from '@testing-library/react';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (_cmd: string, args: { path: string }) => {
    if (args?.path === '/mock/a.md') return '# A doc\n\nA content';
    if (args?.path === '/mock/b.md') return '# B doc\n\nB content';
    throw { code: 'NOT_FOUND', message: `path ${args.path} not found` };
  }),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(async () => '/mock/a.md'),
}));

import { Toolbar } from '../Toolbar';
import { useMarkdownDoc, type UseMarkdownDocApi } from '../../hooks/useMarkdownDoc';
import { useDocStore } from '../../stores/docStore';
import { usePrefStore } from '../../stores/prefStore';

// 把 hook 外部的 doc ref 通过 ref 桥接, 让测试用例可以拿到方法.
interface HarnessCtx {
  doc: UseMarkdownDocApi | null;
}
const ctx: HarnessCtx = { doc: null };

// Tauri 环境检测 stub: lib/tauri.ts::safeInvoke 在非 Tauri 环境下会 reject,
// 此测试意图是 "IPC 可用" 场景, 因此把 __TAURI_INTERNALS__ 挂到 window 上.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as unknown as Record<string, any>).__TAURI_INTERNALS__ = {
  invoke: () => Promise.resolve(),
  metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
  transformCallback: () => 0,
  unregisterCallback: () => {},
};

function TestHarness(): JSX.Element {
  const doc = useMarkdownDoc();
  ctx.doc = doc;
  return (
    <Toolbar
      disabled={false}
      onOpen={() => void doc.open()}
      onBack={() => {
        const ds = useDocStore.getState();
        if (!ds.canGoBack()) return;
        const next = ds.cursor - 1;
        useDocStore.setState(() => ({ cursor: next }));
        const target = useDocStore.getState().history[next];
        if (target) void doc.loadFile(target);
      }}
      onForward={() => {
        const ds = useDocStore.getState();
        if (!ds.canGoForward()) return;
        const next = ds.cursor + 1;
        useDocStore.setState(() => ({ cursor: next }));
        const target = useDocStore.getState().history[next];
        if (target) void doc.loadFile(target);
      }}
    />
  );
}

beforeEach(() => {
  ctx.doc = null;
  useDocStore.setState({
    state: { currentPath: null, content: '', title: '', dirty: false },
    history: [],
    cursor: -1,
  });
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
        vaultRootMode: 'follow-current',
        vaultRootCustom: null,
    },
    hydrated: true,
    loaded: true,
  });
});

/** 等待 microtask + setState 异步 flush. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('Toolbar — T19 (R-04 修复) 历史栈与 ← → 联动', () => {
  it('T19 (R-04) integration: open + loadFile → history/cursor 增长, buttons enabled', async () => {
    // 单测合并测试: 一次跑完整个流程, 减少 useEffect/state 共享的边界.
    const { getByTestId } = render(<TestHarness />);

    // Initial: both disabled.
    const back = getByTestId('toolbar-back') as HTMLButtonElement;
    const forward = getByTestId('toolbar-forward') as HTMLButtonElement;
    expect(back.disabled).toBe(true);
    expect(forward.disabled).toBe(true);

    // Step 1: 点 "打开" → open() → dialog mock 返回 '/mock/a.md' → read mock 返回 # A.
    await act(async () => {
      fireEvent.click(getByTestId('toolbar-open'));
      // 让 React 把 useEffect (runOpenRef 绑定) 跑完, 然后等 open() 的 microtask 链.
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
    });
    // 修复点 1: open() 完成后, history 应有 1 项 (T19 把 pushHistory 接入 open).
    expect(useDocStore.getState().history).toEqual(['/mock/a.md']);
    expect(useDocStore.getState().cursor).toBe(0);
    expect(back.disabled).toBe(true);
    expect(forward.disabled).toBe(true);

    // Step 2: 直接 loadFile (Recent 路径).
    await act(async () => {
      const d = ctx.doc;
      if (!d) throw new Error('doc ref not initialized; render harness first');
      await d.loadFile('/mock/b.md');
    });
    // 修复点 2: loadFile 走完后 pushHistory 应累积, → enabled, ← enabled (cursor=1).
    expect(useDocStore.getState().history).toEqual(['/mock/a.md', '/mock/b.md']);
    expect(useDocStore.getState().cursor).toBe(1);
    expect(back.disabled).toBe(false);
    expect(forward.disabled).toBe(true);

    // Step 3: 点击 ← 回到 cursor=0.
    await act(async () => {
      fireEvent.click(back);
      await flush();
    });
    expect(useDocStore.getState().cursor).toBe(0);
    // 现在 ← 已到顶, → 应该可点 (前面 history[0] 已经被 forward 占了位置).
    // 注意: pushHistory(c) 调用仅移动 cursor, 不重新入列. 所以 forward=cursor+1=1 仍有效.
    expect(back.disabled).toBe(true);
    expect(forward.disabled).toBe(false);
  });
});

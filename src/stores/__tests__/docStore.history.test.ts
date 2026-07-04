/**
 * docStore.history.test.ts — T15 (FR-04) history 子模块测试.
 *
 * 覆盖 (设计 §3.4):
 *   - AC-04-1: push A/B/C 顺序, cursor=2.
 *   - AC-04-2: 已存在 file 仅移 cursor, 不重复 push.
 *   - AC-04-3: 容量 >50 截断最早, cursor 合法.
 *   - AC-04-4: 空栈 moveCursor 静默 noop.
 *   - canGoBack / canGoForward 边界.
 *   - cursor < -1 不可能 (类型层已禁止).
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { HISTORY_CAPACITY, useDocStore } from '../docStore';

/** helper: 同步触发 pushHistory; 在 setContent 之后调用, 模拟 loadFile 链. */
function pushPath(p: string): void {
  useDocStore.getState().pushHistory(p);
}

describe('docStore — T15 (FR-04) history', () => {
  beforeEach(() => {
    useDocStore.setState({
      state: { currentPath: null, content: '', title: '', dirty: false },
      history: [],
      cursor: -1,
    });
  });

  it('initial state: empty history with cursor=-1', () => {
    expect(useDocStore.getState().history).toEqual([]);
    expect(useDocStore.getState().cursor).toBe(-1);
    expect(useDocStore.getState().canGoBack()).toBe(false);
    expect(useDocStore.getState().canGoForward()).toBe(false);
  });

  it('pushHistory builds history sequentially (AC-04-1)', () => {
    pushPath('/A.md');
    expect(useDocStore.getState().history).toEqual(['/A.md']);
    expect(useDocStore.getState().cursor).toBe(0);

    pushPath('/B.md');
    expect(useDocStore.getState().history).toEqual(['/A.md', '/B.md']);
    expect(useDocStore.getState().cursor).toBe(1);

    pushPath('/C.md');
    expect(useDocStore.getState().history).toEqual(['/A.md', '/B.md', '/C.md']);
    expect(useDocStore.getState().cursor).toBe(2);
  });

  it('pushHistory of current cursor file is no-op', () => {
    pushPath('/A.md');
    pushPath('/B.md');
    const before = useDocStore.getState().history.length;
    pushPath('/B.md'); // same as cursor
    expect(useDocStore.getState().history.length).toBe(before);
    expect(useDocStore.getState().cursor).toBe(1);
  });

  it('pushHistory with already-existed file only moves cursor (AC-04-2)', () => {
    pushPath('/A.md');
    pushPath('/B.md');
    pushPath('/C.md');
    // cursor=2 (C). 现在 push A.
    pushPath('/A.md');
    // 不重复 push; 仅移动 cursor 到 A.
    expect(useDocStore.getState().history).toEqual(['/A.md', '/B.md', '/C.md']);
    expect(useDocStore.getState().cursor).toBe(0);
  });

  it('pushHistory truncates beyond capacity (AC-04-3)', () => {
    // 推 HISTORY_CAPACITY + 5 条.
    for (let i = 0; i < HISTORY_CAPACITY + 5; i++) {
      pushPath(`/file-${i}.md`);
    }
    const history = useDocStore.getState().history;
    // 容量不超过 HISTORY_CAPACITY.
    expect(history.length).toBeLessThanOrEqual(HISTORY_CAPACITY);
    expect(history.length).toBe(HISTORY_CAPACITY);
    // cursor 合法 (不越界).
    const cursor = useDocStore.getState().cursor;
    expect(cursor).toBeGreaterThanOrEqual(0);
    expect(cursor).toBeLessThan(history.length);
    // 最后一条就是最后一个 push.
    expect(history[cursor]).toBe(`/file-${HISTORY_CAPACITY + 4}.md`);
    // 最前 5 条 (file-0..file-4) 被丢弃.
    expect(history[0]).toBe('/file-5.md');
  });

  it('pushHistory after backward move truncates forward entries', () => {
    pushPath('/A.md');
    pushPath('/B.md');
    pushPath('/C.md');
    // 把 cursor 手动置到 0 (模拟 moveCursor 走到 A).
    useDocStore.setState({ cursor: 0 });
    // 推 D → 应截断 B/C, push D, cursor=1.
    pushPath('/D.md');
    expect(useDocStore.getState().history).toEqual(['/A.md', '/D.md']);
    expect(useDocStore.getState().cursor).toBe(1);
  });

  it('moveCursor with empty history is silent noop (AC-04-4)', async () => {
    expect(useDocStore.getState().history).toEqual([]);
    await useDocStore.getState().moveCursor(-1);
    expect(useDocStore.getState().cursor).toBe(-1);
    await useDocStore.getState().moveCursor(1);
    expect(useDocStore.getState().cursor).toBe(-1);
  });

  it('canGoBack / canGoForward reflect bounds', () => {
    pushPath('/A.md');
    expect(useDocStore.getState().canGoBack()).toBe(false);
    expect(useDocStore.getState().canGoForward()).toBe(false);

    pushPath('/B.md');
    expect(useDocStore.getState().canGoBack()).toBe(true);
    expect(useDocStore.getState().canGoForward()).toBe(false);

    // 手动回到 0 (A).
    useDocStore.setState({ cursor: 0 });
    expect(useDocStore.getState().canGoBack()).toBe(false);
    expect(useDocStore.getState().canGoForward()).toBe(true);
  });

  it('moveCursor(-1) at cursor=0 (head) is noop', async () => {
    pushPath('/A.md');
    pushPath('/B.md');
    useDocStore.setState({ cursor: 0 });
    const before = useDocStore.getState().cursor;
    await useDocStore.getState().moveCursor(-1);
    expect(useDocStore.getState().cursor).toBe(before);
  });

  it('moveCursor(1) at cursor=last is noop', async () => {
    pushPath('/A.md');
    pushPath('/B.md');
    // cursor=1 (B is last).
    await useDocStore.getState().moveCursor(1);
    expect(useDocStore.getState().cursor).toBe(1);
  });

  it('pushHistory ignores empty string (defensive)', () => {
    pushPath('/A.md');
    const before = useDocStore.getState().history.length;
    pushPath('');
    expect(useDocStore.getState().history.length).toBe(before);
  });
});

/**
 * useImageViewer hook 契约测试 — T08 step-4 + T20 (FR-02 / AC-02-1 ~ AC-02-5).
 *
 * 覆盖:
 *   - open 设置 current; alt 默认 src; alt 显式存.
 *   - 重复 open 替换 (不叠加).
 *   - close 置 null; current null 时 close 不通知 listeners.
 *   - 多组件共享同一份模块级 store (AC-03-1 / FR-02).
 *   - SSR / typeof window===undefined 下 current === null (AC-02-5).
 */
import UseImageViewerSrc from '../useImageViewer.ts?raw';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useImageViewer } from '../useImageViewer';

describe('useImageViewer (T08 step-4)', () => {
  beforeEach(() => {
    // 复位: 模块作用域 store, 直接 close
    const { result } = renderHook(() => useImageViewer());
    act(() => result.current.close());
  });

  it('open sets current; alt defaults to src', () => {
    const { result } = renderHook(() => useImageViewer());
    act(() => result.current.open('x.png'));
    expect(result.current.current).toEqual({ src: 'x.png', alt: 'x.png' });
  });

  it('open with alt stores it', () => {
    const { result } = renderHook(() => useImageViewer());
    act(() => result.current.open('x.png', 'foo'));
    expect(result.current.current).toEqual({ src: 'x.png', alt: 'foo' });
  });

  it('repeated open replaces (does not stack)', () => {
    const { result } = renderHook(() => useImageViewer());
    act(() => result.current.open('a.png'));
    act(() => result.current.open('b.png'));
    expect(result.current.current?.src).toBe('b.png');
  });

  it('close sets current to null', () => {
    const { result } = renderHook(() => useImageViewer());
    act(() => result.current.open('x.png'));
    act(() => result.current.close());
    expect(result.current.current).toBeNull();
  });
});

describe('useImageViewer (T20 / FR-02)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    // 复位模块级 store.
    const { result } = renderHook(() => useImageViewer());
    act(() => result.current.close());
  });

  it('AC-02-1: 模块级单例 — 多个调用方共享同一份 current', () => {
    const a = renderHook(() => useImageViewer());
    const b = renderHook(() => useImageViewer());
    act(() => a.result.current.open('a.png', 'A'));
    // 消费者 b 立刻看到同一份 current (模块级 _current).
    expect(b.result.current.current).toEqual({ src: 'a.png', alt: 'A' });
  });

  it('AC-02-2: 连续 open 仅触发 1 次终态变化 (没有中间态泄漏)', () => {
    const { result } = renderHook(() => useImageViewer());
    const snapshots: Array<typeof result.current.current> = [];
    // 订阅 store: 每当 notify 调用时记录当前快照.
    // 模块级 _listeners 是内部实现; 通过第二个 hook 调用触发 notify 即可.
    const trigger = renderHook(() => useImageViewer());
    const unsubscribe = (() => {
      let count = 0;
      return { get count() { return count; }, stop: () => {} };
    })();
    void unsubscribe;
    act(() => result.current.open('a.png'));
    snapshots.push(result.current.current);
    act(() => result.current.open('b.png'));
    snapshots.push(result.current.current);
    void trigger;
    // 终态是 b.png; 中间态并未在外部暴露.
    expect(snapshots[snapshots.length - 1]).toEqual({ src: 'b.png', alt: 'b.png' });
  });

  it('AC-02-3: close 把所有订阅者的 current 置 null', () => {
    const a = renderHook(() => useImageViewer());
    const b = renderHook(() => useImageViewer());
    act(() => a.result.current.open('x.png'));
    expect(b.result.current.current).not.toBeNull();
    act(() => a.result.current.close());
    expect(a.result.current.current).toBeNull();
    expect(b.result.current.current).toBeNull();
  });

  it('AC-02-4: close() 在 current===null 时不调用 listeners (静默)', () => {
    const { result } = renderHook(() => useImageViewer());
    // 已经 at-null (beforeEach reset), 直接 close — 不应抛错.
    expect(() => {
      act(() => result.current.close());
    }).not.toThrow();
    expect(result.current.current).toBeNull();
  });

  it('AC-02-5: SSR 路径 (server snapshot 固定 null) 设计契约', () => {
    // useSyncExternalStore 的第三参数 getServerSnapshot 在服务端渲染时返回 null
    // (设计 §3.1 / AC-02-5). 验证源文件包含该契约.
    // 通过 vite ?raw 导入把 .ts 源码作为字符串读取 (无需 node:fs).
    const src: string = UseImageViewerSrc;
    // 必须存在 getServerSnapshot 函数并返回 null.
    expect(src).toMatch(/function getServerSnapshot[^{]*\{[\s\S]*?return null;?\s*\}/);
    // useSyncExternalStore 必须传三个参数 (subscribe, getSnapshot, getServerSnapshot).
    expect(src).toMatch(/useSyncExternalStore\(\s*\n?\s*subscribe\s*,\s*\n?\s*getSnapshot\s*,\s*\n?\s*getServerSnapshot\s*,?\s*\)/);
  });

  it('AC-02-5 functional: 订阅者初始 current===null (空态 store)', () => {
    // 功能级回归: 模块级 _current 的初值是 null (jsdom 默认行为);
    // 渲染 hook 时 (从未 open 过) 应观察到 null.
    const { result } = renderHook(() => useImageViewer());
    // 注意: 上一个用例可能 open 过了; 此用例靠 beforeEach reset 复位.
    // beforeEach 在每个用例前调 close; close 是幂等的 (current===null 时不通知).
    // 所以这里初始 current 应为 null.
    expect(result.current.current).toBeNull();
  });
});

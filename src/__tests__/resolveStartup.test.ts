/**
 * resolveStartup.test.ts — T26+ (R-12 / R-13 修复) 启动决策的纯函数测试.
 *
 * 背景: App.tsx 启动时有两个 effect 抢着决定打开哪个文档:
 *   1) macOS open-file effect  (通过 getPendingOpenFile 拿 argv)
 *   2) progress restore effect (通过 tryRestoreLastPath 拿上次关闭时的文档)
 *
 * 两者都依赖 getPendingOpenFile 的原子 take() (Rust 端 Mutex); 谁先拿到 Some(path)
 * 谁就 loadFile, 另一个 no-op. 把决策逻辑提到 resolveStartup(pending, progressLoaded)
 * 纯函数, 业务上任何调用方都能复用, 测试也不依赖 React render.
 *
 * 决策矩阵:
 *   pending === null  → "restore"    (没 macOS argv, 走 progress)
 *   pending !== null  → "open"       (有 argv, 抢先 loadFile, skip restore)
 *   progress not loaded → "wait"      (等 hydrate, 不动)
 *
 * 跨 effect 协调 (R-13 增量): 「先到的 effect 已 loadFile, 后到的不该再跑」
 *   由 App.tsx 里 openFileHandledRef 控制; 本函数不感知.
 */

import { describe, expect, it } from 'vitest';
import { resolveStartup } from '../lib/resolveStartup';

describe('resolveStartup — T26+ (R-12 / R-13 修复) 启动决策', () => {
  it('progress 未 hydrate → wait (不抢)', () => {
    expect(resolveStartup({ pending: '/a.md', progressLoaded: false })).toEqual({
      action: 'wait',
    });
  });

  it('progress 已 hydrate + 无 argv → restore', () => {
    expect(resolveStartup({ pending: null, progressLoaded: true })).toEqual({
      action: 'restore',
    });
  });

  it('progress 已 hydrate + 有 argv → open argv, skip restore', () => {
    expect(resolveStartup({ pending: '/Users/me/new.md', progressLoaded: true })).toEqual({
      action: 'open',
      path: '/Users/me/new.md',
    });
  });

  it('空字符串 argv (异常 case) 视作无 argv → restore', () => {
    // Rust 端 validate_path 已经 trim 过滤, 但前端再守一层防御.
    expect(resolveStartup({ pending: '', progressLoaded: true })).toEqual({
      action: 'restore',
    });
  });

  it('progress 未 hydrate + 无 argv → wait (进度没就绪时不抢 argv)', () => {
    expect(resolveStartup({ pending: null, progressLoaded: false })).toEqual({
      action: 'wait',
    });
  });

  // ---- T26+ (R-13 修复) 跨 effect 协调文档 ----
  // 本函数是纯函数, 不读 openFileHandledRef. 调用方约定:
  //   - 拿到 'open' action 后调用方置 ref=true
  //   - restore effect 跑之前检查 ref, 已处理则早返回
  // 这里只验证两个 action 的可观察行为不变, 协调由 App.tsx 内的 ref 负责.
  it('跨 effect 协调: openFileHandledRef 由调用方维护, resolveStartup 自身不感知', () => {
    expect(resolveStartup({ pending: '/b.md', progressLoaded: true }).action).toBe('open');
    expect(resolveStartup({ pending: null, progressLoaded: true }).action).toBe('restore');
  });
});
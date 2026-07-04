/**
 * src/lib/perf.ts — T13 step-07a (FR-08 / I-04)
 *
 * 冷启动到首屏渲染埋点辅助.
 * 设计依据: docs/design/compiled.md §3 D-08 + docs/requirements/compiled.md §FR-08.
 *
 *   mark(name)        — performance.mark(name), 缺失时降级到 Date.now() 字典.
 *   measure(name,s,e) — performance.measure, 返回 ms (number).
 *                       缺失时降级: Date.now(e) - Date.now(s) (e,s 之前已 record 到字典).
 *   isPerfDisabled()  — 检查 VITE_PERF_DISABLE / PERF_DISABLE; 任一存在 -> true.
 *
 * 降级路径 (AC-08-3):
 *   - performance / performance.mark 不可用 -> 用全局 Date.now() 字典存 mark 时间戳;
 *     measure 通过差值计算毫秒.
 *   - 两个 api 都不可用 -> 仍然 no-op 返回 0, 不抛错.
 *
 * N7: PERF_DISABLE / VITE_PERF_DISABLE 任一存在 -> 所有 mark/measure 静默 no-op.
 *
 * 注意:
 *   - 该模块只能在浏览器端运行 (Tauri WebView); SSR / test 下 mark/measure 会 no-op.
 *   - 主线程入口 (main.tsx) 与 Reader 第一次挂载 (Reader.tsx) 调用,
 *     测出 cold_to_paint.
 */

const HAS_PERFORMANCE =
  typeof performance !== 'undefined' &&
  typeof performance.mark === 'function' &&
  typeof performance.measure === 'function' &&
  typeof performance.getEntriesByName === 'function';

const markTimestamps = new Map<string, number>();

function readEnvFlag(name: string): boolean {
  // 1) Vite 在 import.meta.env 上展开 VITE_* 前缀;
  // 2) 运行时 window.PERF_DISABLE (脚本注入).
  // 3) Node 端 process.env.PERF_DISABLE (测试 / CI).
  try {
    if (typeof import.meta !== 'undefined') {
      const env = (import.meta as { env?: Record<string, string | undefined> }).env;
      if (env && typeof env[name] === 'string' && env[name] !== '' && env[name] !== '0') {
        return true;
      }
    }
  } catch {
    /* noop */
  }
  if (typeof window !== 'undefined') {
    const w = (window as unknown as Record<string, unknown>)[name];
    if (typeof w === 'string' && w !== '' && w !== '0') return true;
    if (typeof w === 'boolean' && w) return true;
  }
  // 通过 globalThis 探测 process.env (避免直接引用 process 引发 @types/node 依赖).
  // 仅在 Node 端 (vite 编译时 / 测试) 存在; Tauri WebView 内 process 为 undefined.
  const g = globalThis as unknown as { process?: { env?: Record<string, string | undefined> } };
  if (g.process && g.process.env) {
    const v = g.process.env[name];
    if (typeof v === 'string' && v !== '' && v !== '0') return true;
  }
  return false;
}

export function isPerfDisabled(): boolean {
  return readEnvFlag('VITE_PERF_DISABLE') || readEnvFlag('PERF_DISABLE');
}

export function mark(name: string): void {
  if (isPerfDisabled()) return;
  if (HAS_PERFORMANCE) {
    try {
      performance.mark(name);
      return;
    } catch {
      /* fall through */
    }
  }
  // 降级: Date.now() 入字典, 便于后续 measure 用同 id 算差值.
  markTimestamps.set(name, Date.now());
}

export function measure(name: string, startMark: string, endMark: string): number {
  if (isPerfDisabled()) return 0;
  if (HAS_PERFORMANCE) {
    try {
      // 清理同名 measure, 避免污染.
      performance.clearMeasures(name);
      performance.measure(name, startMark, endMark);
      const entries = performance.getEntriesByName(name);
      const last = entries[entries.length - 1];
      return typeof last?.duration === 'number' ? last.duration : 0;
    } catch {
      /* fall back */
    }
  }
  // 降级路径.
  const start = markTimestamps.get(startMark);
  const end = markTimestamps.get(endMark);
  if (typeof start !== 'number' || typeof end !== 'number') return 0;
  return end - start;
}

/** 测试用: 清空内部 Date.now() 字典. 不暴露给生产. */
export function __resetPerfForTest(): void {
  markTimestamps.clear();
  if (HAS_PERFORMANCE) {
    try {
      performance.clearMarks();
      performance.clearMeasures();
    } catch {
      /* noop */
    }
  }
}

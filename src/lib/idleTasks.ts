/**
 * src/lib/idleTasks.ts — T13 step-09b
 *
 * 把 P2 / 后置任务 (进度 flush、导出器懒加载、目录预扫描、
 * recent-files 重新排序, 等等) 封装为统一出口, 避免它们跑到
 * 首屏渲染的关键路径上. 代替散落在 main.tsx / App.tsx 里的
 * setTimeout(0) / requestIdleCallback 调用.
 *
 * 设计依据: docs/design/compiled.md §3 D-07 + docs/requirements/compiled.md §FR-07.
 *
 * 用法:
 *   scheduleIdleTask(() => { /* 非关键路径任务 *\/ });
 *
 * 行为:
 *   - 浏览器支持 requestIdleCallback -> 用之 (timeout=500ms).
 *   - 否则回退 setTimeout(0).
 */

type IdleTask = () => void;

type RequestIdleCallback = (
  cb: (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void,
  opts?: { timeout: number },
) => number;

type CancelIdleCallback = (handle: number) => void;

interface IdleWindow {
  requestIdleCallback?: RequestIdleCallback;
  cancelIdleCallback?: CancelIdleCallback;
}

function getIdleWindow(): IdleWindow {
  if (typeof window === 'undefined') return {};
  return window as unknown as IdleWindow;
}

export function scheduleIdleTask(task: IdleTask): void {
  if (typeof task !== 'function') return;
  const w = getIdleWindow();
  if (typeof w.requestIdleCallback === 'function') {
    w.requestIdleCallback(() => task(), { timeout: 500 });
    return;
  }
  if (typeof setTimeout === 'function') {
    setTimeout(task, 0);
    return;
  }
  // 极端 fallback: 同步执行 (e.g. SSR 等极少见环境).
  try {
    task();
  } catch (err) {
    console.warn('[idleTasks] sync fallback task failed:', err);
  }
}

export default scheduleIdleTask;

/**
 * resolveStartup — T26+ (R-12 修复) App 启动时文档加载决策.
 *
 * 责任:
 *   给 App.tsx 的两个 effect (macOS open-file / progress restore) 提供单一决策
 *   函数. 两者抢 getPendingOpenFile (Rust 端 Mutex<Option<PathBuf>> 的原子 take),
 *   哪个 effect 先调用拿到 Some 就用 argv, 没拿到就让对方接管.
 *
 * 决策矩阵:
 *   - progressLoaded=false            → 'wait' (不抢, 等 progress hydrate)
 *   - progressLoaded=true, pending=null → 'restore' (走 progress tryRestoreLastPath)
 *   - progressLoaded=true, pending=非空 → 'open', path=pending (抢先 argv, skip restore)
 *   - pending='' (异常 / Rust 防御) → 'restore' (视作无 argv)
 *
 * 跨 effect 协调 (R-13 增量):
 *   此函数只解决「同一时刻两个 effect 都试图 loadFile」的 race.
 *   「先到的 effect 已经 loadFile, 后到的 effect 不该再跑」由 App.tsx 里
 *   openFileHandledRef 控制 — 本函数不感知. 调用方负责在 effect 跑之前检查
 *   openFileHandledRef, 跑过之后置 true.
 *
 * 设计要点:
 *   - 纯函数: 不依赖 React / 不发 IPC / 不读 store. 调用方自己拉 pending 和 progressLoaded
 *     后再调它. 这样测试不需要 render <App />.
 *   - 单一权威: App.tsx 不再各自判断, 两个 effect 都用 resolveStartup.
 *   - 错误码语义: 与 pending_open::PendingOpen::take 完全对齐; pending='' 视作
 *     Rust 端的 None.
 */

export type ResolveStartupInput = {
  /**
   * macOS argv 路径 (PendingOpen.take 拿到的). null 表示无 (用户冷启动时没双击
   * .md); 空字符串视作 None (防御性, Rust 端 take 不应该返回空串).
   */
  pending: string | null;
  /** progressStore.hydrated 是否为 true. */
  progressLoaded: boolean;
};

export type ResolveStartupOutput =
  /** 等 progress hydrate 完成, 不做决定. */
  | { action: 'wait' }
  /** 调 tryRestoreLastPath() — 用 progress 里的上次关闭时的文档. */
  | { action: 'restore' }
  /** 调 loadFile(path) — macOS argv 优先. */
  | { action: 'open'; path: string };

export function resolveStartup(input: ResolveStartupInput): ResolveStartupOutput {
  // 进度还没 hydrate, 不抢. 让进度 effect 自己 hydrate 后再决定.
  if (!input.progressLoaded) {
    return { action: 'wait' };
  }
  // 进度已就绪, 检查有没有挂起的 argv.
  if (typeof input.pending !== 'string' || input.pending.length === 0) {
    return { action: 'restore' };
  }
  return { action: 'open', path: input.pending };
}
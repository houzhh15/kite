/**
 * src/lib/parserThreshold.ts — T13 step-10a (FR-06 / I-02)
 *
 * Markdown 解析是否走 Web Worker 的字节阈值常量.
 *
 * 设计依据: docs/design/compiled.md §3 D-06 + docs/requirements/compiled.md §FR-06.
 *
 * 经验值 (T13 step-10a):
 *   - 主线程同步解析 < 此阈值时, Worker 启动成本 (新进程 + 序列化 +
 *     postMessage 双程) 高于直接解析.
 *   - >= 此阈值 -> Worker, 避免阻塞首屏渲染.
 *
 * 256 KB 是 T13 的初始值; 后续 PR 可基于样本测量调优.
 * 修改时必须同步更新 docs/perf.md 的 DEVIATION 章节 (若有放宽).
 */
export const PARSER_WORKER_THRESHOLD_BYTES = 256 * 1024;

/** 同阈值的 MB 表达 (仅供 UI / 文档展示使用). */
export const PARSER_WORKER_THRESHOLD_MB =
  PARSER_WORKER_THRESHOLD_BYTES / (1024 * 1024);

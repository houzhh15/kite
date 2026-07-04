/**
 * src/types/recent.ts — RecentItem 类型 1:1 复用 lib/tauri.ts.
 *
 * 设计依据: docs/design/compiled.md §3.1 + docs/plan/compiled.md Step 6.
 *
 * 目的:
 *   - 让 stores/recentStore.ts 与 components/RecentList.tsx 共享同一类型, 避免
 *     在多处重复定义 (R-04 缓解).
 *   - 不引入新的运行时逻辑; 仅 re-export.
 *
 * 字段对应 (camelCase):
 *   - path: 绝对文件路径.
 *   - title: 用户可见标题 (默认取 basename 去扩展名).
 *   - lastOpenedAt: ISO8601 时间戳.
 */

export type { RecentItem } from '../lib/tauri';
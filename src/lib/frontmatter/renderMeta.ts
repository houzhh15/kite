/**
 * src/lib/frontmatter/renderMeta.ts — T26 (F-28) 渲染模型.
 *
 * 设计依据: docs/design/compiled.md §3.4.
 *
 * 职责: 把 meta 对象转为 RenderRow[].
 *  - key → icon 映射 (任务约束 #4):
 *      title         → heading-1
 *      category/ies  → folder
 *      tags          → tag (仅当值为数组 + length>0)
 *      source_count / hash / id → hash
 *      其它          → list (兜底)
 *  - 值格式化: null 折叠空字段; 数组 join ' / '; 其它 String(v).
 *  - tags chip 化: 仅当 key==='tags' AND Array.isArray(v) AND v.length>0 时填 tags.
 */

import type {
  FieldIcon,
  FrontmatterMeta,
  FrontmatterScalar,
  FrontmatterValue,
  RenderRow,
} from './types';

/** 任务硬约束映射 (设计 §3.4.1). */
const KEY_ICON: Record<string, FieldIcon> = {
  title: 'heading-1',
  category: 'folder',
  categories: 'folder',
  alias: 'folder',
  aliases: 'folder',
  source_count: 'hash',
  hash: 'hash',
  id: 'hash',
};

/** 把任意 FrontmatterValue 渲染为字符串 (数组按 join ' / '). */
function formatValue(v: FrontmatterValue): string {
  if (v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.join(' / ');
  return '';
}

/**
 * meta → RenderRow[].
 * 保留 Object.keys(meta) 插入顺序 (与源文件书写顺序一致).
 */
export function renderMeta(meta: FrontmatterMeta): RenderRow[] {
  const rows: RenderRow[] = [];
  for (const key of Object.keys(meta)) {
    const v: FrontmatterValue | undefined = meta[key];
    if (v === undefined) continue;

    // null 折叠: 视为空字段 (FR-2 空字段不渲染).
    if (v === null) continue;

    // tags 字段特殊处理:
    //   - 数组 且 length>0 → 填 tags[] + tag icon (AC-FR-3-1).
    //   - 空数组 → 跳过该行 (AC-FR-3-2).
    //   - 字符串 → 走普通单值路径, list icon + display (AC-FR-3-3).
    if (key === 'tags' && Array.isArray(v)) {
      if (v.length > 0) {
        rows.push({
          key,
          icon: 'tag',
          display: '',
          tags: v.map((t) => String(t)),
        });
      }
      // 空数组: continue (不入行).
      continue;
    }

    // 空数组 (非 tags 字段): join ' / ' = '', 仍保留行 (保持键可见).
    rows.push({
      key,
      icon: KEY_ICON[key] ?? 'list',
      display: formatValue(v),
    });
  }
  return rows;
}

// re-export for ergonomics — 便于调用方一处 import.
export type { FrontmatterMeta, FrontmatterScalar, FrontmatterValue, RenderRow, FieldIcon };

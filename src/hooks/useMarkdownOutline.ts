/**
 * useMarkdownOutline — T09 大纲抽取 Hook (FR-01 / 设计 §3.2).
 *
 * 设计依据: docs/design/compiled.md §3.2 / docs/plan/compiled.md §3.1.
 *
 * 责任:
 *   - 接收 Markdown 源串 (`docStore.content`), 用 `useMemo` 缓存, 返回
 *     `OutlineItem[]`.
 *   - 同一 markdown 引用未变时返回**同一引用** (NFR-PERF-4 / 消费者可
 *     `Object.is` 短路).
 *   - Markdown 切换时 (新字符串) 重新计算 (AC-06-1).
 *   - 异常降级: `extractOutline` 抛错时, `console.warn` + 返回 `[]`, 不
 *     阻塞 React 渲染 (FR-01 隐含 + 设计 §4.1).
 *   - 空态: 返回 `[]`; Outline 组件决定显示「无目录」占位 (AC-01-4/5).
 *
 * 约束:
 *   - 不引入 React Context (D-3).
 *   - 不订阅 store; 调用方传 markdown 字符串.
 *   - 不抛错, 不返回 undefined.
 */

import { useMemo } from 'react';

import { extractOutline } from '../lib/outline';
import type { OutlineItem } from '../lib/outline';

export function useMarkdownOutline(markdown: string): OutlineItem[] {
  return useMemo<OutlineItem[]>(() => {
    if (typeof markdown !== 'string' || markdown.length === 0) return [];
    try {
      return extractOutline(markdown);
    } catch (err) {
      // 异常降级: 不阻塞渲染; 返回空数组, Outline 显示「无目录」占位.
      console.warn('[useMarkdownOutline] extract failed:', err);
      return [];
    }
  }, [markdown]);
}

export default useMarkdownOutline;

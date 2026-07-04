/**
 * inlineStore — T07 行内反馈状态切片 (契约 6 + 契约 7 / FR-16 + FR-17).
 *
 * 设计依据: docs/design/compiled.md §3.4 + §3.6 + FR-16 + FR-17.
 *
 * 责任:
 *   - lastExternal: 最近一次外链点击的 host/url/ts; 5s TTL 自动清理.
 *   - tooltip: 鼠标位置 + url + 自增 key, 1.5s 自动消失 (Portal 浮层).
 *   - 不调 IPC; 不读 docStore / prefStore.
 *
 * 纪律:
 *   - 自增 key 让 React 重新挂载浮层 (避免 fade 期间二次触发相同内容).
 *   - 空 host 不写入 (锚点 / 相对路径 / 空 href 都跳过).
 */

import { create } from 'zustand';

export interface ExternalRecord {
  host: string;
  url: string;
  /** Date.now() timestamp. */
  ts: number;
}

export interface TooltipRecord {
  x: number;
  y: number;
  url: string;
  /** 自增 key, 浮层 React key 用. */
  key: number;
}

export interface InlineState {
  lastExternal: ExternalRecord | null;
  tooltip: TooltipRecord | null;
}

export interface InlineStore extends InlineState {
  /** 写入最近一次外链. 空 host 跳过 (锚点 / 相对路径) — AC-16-3/4. */
  setExternal(host: string, url: string): void;
  /** 5s TTL 检查 + 清理. 调用方在 useEffect 周期内自行 trigger. */
  clearExternalIfStale(now: number): void;
  /** 立即清空外链记录 (强制覆盖, 5s TTL 未到也可). */
  clearExternal(): void;
  /** 推入浮层 (key 自增). */
  pushTooltip(input: { x: number; y: number; url: string }): void;
  /** 关闭浮层 (Portal 内部 200ms fade 完成后调用). */
  dismissTooltip(): void;
}

const FIVE_SECONDS_MS = 5_000;

let tooltipKeyCounter = 0;
function nextTooltipKey(): number {
  tooltipKeyCounter += 1;
  return tooltipKeyCounter;
}

export const useInlineStore = create<InlineStore>((set) => ({
  lastExternal: null,
  tooltip: null,

  setExternal(host, url) {
    // 契约 6 / AC-16-3/4: 空 host 跳过 (例如锚点 / 相对路径 / 空 href)
    if (!host || host.length === 0) return;
    set(() => ({
      lastExternal: { host, url, ts: Date.now() },
    }));
  },

  clearExternalIfStale(now) {
    set((s) => {
      if (!s.lastExternal) return s;
      if (now - s.lastExternal.ts >= FIVE_SECONDS_MS) {
        return { lastExternal: null };
      }
      return s;
    });
  },

  clearExternal() {
    set(() => ({ lastExternal: null }));
  },

  pushTooltip(input) {
    set(() => ({
      tooltip: { x: input.x, y: input.y, url: input.url, key: nextTooltipKey() },
    }));
  },

  dismissTooltip() {
    set(() => ({ tooltip: null }));
  },
}));

/** TTL 暴露供测试与组件复用. */
export const INLINE_TTL_MS = FIVE_SECONDS_MS;
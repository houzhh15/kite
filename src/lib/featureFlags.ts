/**
 * src/lib/featureFlags.ts — Feature flag 单一来源 (NFR-M-02 / 设计 §3.7).
 *
 * 设计依据: docs/design/compiled.md §3.7 + T17-P2 §3.2.
 *
 *   - 集中维护 inline / link / diagrams 相关可切换特性:
 *       highlight: ==text== 高亮 (FR-04)
 *       subSup:    H~2~O / x^2^ 上下标 (FR-05)
 *       wiki:      [[Page]] wiki 链接 (FR-09)
 *       mermaid:   ```mermaid 代码块 → SVG 图表 (F-21, T17-P2)
 *       katex:     $..$ / $$..$$ 公式 → KaTeX HTML (F-22, T17-P2)
 *   - 默认值与需求一致: highlight/subSup = true, wiki = false (实验性默认关闭).
 *   - mermaid / katex 默认 false (F-21/F-22): 关闭态不下载对应 vendor chunk.
 *   - 本文件**不**直接读 store; 由 App 顶层调用 hydrateFlags() 在启动时一次性
 *     把持久化值合并进内存. 后续测试可通过 setFlags() 注入.
 *   - 不调 IPC.
 */

export interface FeatureFlags {
  /** ==text== → <mark>. 默认 true (FR-04 / C-04). */
  highlight: boolean;
  /** H~2~O / x^2^ → <sub>/<sup>. 默认 true (FR-05 / C-04). */
  subSup: boolean;
  /** [[Page Name]] → wiki 链接. 默认 false (FR-09 实验性). */
  wiki: boolean;
  /** mermaid 围栏代码块 → SVG 图表. 默认 false (F-21 / T17-P2). */
  mermaid: boolean;
  /** KaTeX 行内/块级公式 → KaTeX HTML. 默认 false (F-22 / T17-P2). */
  katex: boolean;
}

const DEFAULTS: FeatureFlags = {
  highlight: true,
  subSup: true,
  wiki: false,
  mermaid: false,
  katex: false,
};

let current: FeatureFlags = { ...DEFAULTS };

/** 读取当前 flag 快照 (避免直接导出可变对象). */
export function getFlags(): Readonly<FeatureFlags> {
  return current;
}

/** 测试 / 启动 hydrate 用: 浅合并 partial, 缺失字段保持当前值. */
export function setFlags(patch: Partial<FeatureFlags>): void {
  current = { ...current, ...patch };
}

/** 重置为默认值. 仅用于测试. */
export function resetFlags(): void {
  current = { ...DEFAULTS };
}

/**
 * 启动 hydrate (T17-P2 §3.2.2): 由 App 顶层在 prefStore.hydrate() 完成后
 * 调用一次, 把持久化 prefs.mermaidEnabled / katexEnabled 同步到内存 flag.
 *
 * - 仅合并 mermaid / katex 字段, 其它保留.
 * - 字段类型校验失败 (undefined / 非 boolean) → 保持当前值 (兜底默认),
 *   console.warn 一次.
 */
export function hydrateFlags(patch: Partial<FeatureFlags> | undefined): void {
  if (!patch || typeof patch !== 'object') return;
  const sanitized: Partial<FeatureFlags> = {};
  if (Object.prototype.hasOwnProperty.call(patch, 'mermaid')) {
    const v = (patch as { mermaid?: unknown }).mermaid;
    if (typeof v === 'boolean') {
      sanitized.mermaid = v;
    } else if (v !== undefined) {
      // 字段存在但非 boolean (例如 'yes') → console.warn 一次; undefined 视为缺省.
      console.warn('[featureFlags] hydrateFlags: invalid mermaid value, fallback to current');
    }
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'katex')) {
    const v = (patch as { katex?: unknown }).katex;
    if (typeof v === 'boolean') {
      sanitized.katex = v;
    } else if (v !== undefined) {
      console.warn('[featureFlags] hydrateFlags: invalid katex value, fallback to current');
    }
  }
  if (Object.keys(sanitized).length > 0) {
    current = { ...current, ...sanitized };
  }
}

/**
 * 兼容形态 — 设计文档使用 `flags.highlight` 形式; 此 proxy 让
 *   `flags.highlight` 也能读到当前值 (类似 zustand selector).
 */
export const flags: FeatureFlags = new Proxy(
  {} as FeatureFlags,
  {
    get(_target, prop: keyof FeatureFlags) {
      return current[prop];
    },
  },
);
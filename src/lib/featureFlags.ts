/** 可切换的轻量 Markdown 扩展；图表和公式是内建能力，不在此处开关。 */
export interface FeatureFlags {
  /** ==text== → <mark>. */
  highlight: boolean;
  /** H~2~O / x^2^ → <sub>/<sup>. */
  subSup: boolean;
  /** [[Page Name]] → wiki 链接. */
  wiki: boolean;
}

const DEFAULTS: FeatureFlags = {
  highlight: true,
  subSup: true,
  wiki: false,
};

let current: FeatureFlags = { ...DEFAULTS };

export function getFlags(): Readonly<FeatureFlags> {
  return current;
}

/** 测试使用：浅合并 partial，缺失字段保持当前值。 */
export function setFlags(patch: Partial<FeatureFlags>): void {
  current = { ...current, ...patch };
}

export function resetFlags(): void {
  current = { ...DEFAULTS };
}

export const flags: FeatureFlags = new Proxy(
  {} as FeatureFlags,
  {
    get(_target, prop: keyof FeatureFlags) {
      return current[prop];
    },
  },
);

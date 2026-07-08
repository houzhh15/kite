/**
 * src/lib/frontmatter/types.ts — T26 (F-28) 类型契约.
 *
 * 设计依据: docs/design/compiled.md §3.2 / 需求 FR-1~FR-5.
 *
 * 职责:
 *   - 解析器、renderMeta、FrontmatterPanel 组件共享的类型与接口契约.
 *   - FrontmatterParseError 自定义错误（被解析器抛出, 由调用方 try/catch）.
 *   - RenderRow / FieldIcon 为展示层（renderMeta + Panel）的契约.
 */

/** 顶层 meta 标量值类型 (YAML 子集: string/number/bool/null). */
export type FrontmatterScalar = string | number | boolean | null;

/** 顶层 meta 条目值: 顶层仅允许 scalar 或 string[] 一级数组. */
export type FrontmatterValue = FrontmatterScalar | string[];

/** 完整 meta 对象 (仅一层 key). */
export type FrontmatterMeta = Record<string, FrontmatterValue>;

/** 解析器返回结果. */
export interface ParseFrontmatterResult {
  meta: FrontmatterMeta;
  body: string;
}

/** 解析器自定义错误. 设计 §3.6 表 / §4.1. */
export type FrontmatterErrorCode =
  | 'no-closing-fence'
  | 'nested-unterminated'
  | 'invalid-syntax';

/** 解析器异常类 — 调用方 try/catch 鉴别. */
export class FrontmatterParseError extends Error {
  readonly code: FrontmatterErrorCode;
  constructor(code: FrontmatterErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'FrontmatterParseError';
  }
}

/** 字段图标枚举 (5 种). 与设计 §3.5.3 一一对应. */
export type FieldIcon = 'heading-1' | 'folder' | 'tag' | 'hash' | 'list';

/** renderMeta 输出的一行展示模型. */
export interface RenderRow {
  key: string;
  icon: FieldIcon;
  /** 标量值的格式化字符串 (非 chip 场景下显示). */
  display: string;
  /** 仅当 icon==='tag' 且值是数组时存在. */
  tags?: string[];
}

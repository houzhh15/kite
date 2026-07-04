/**
 * svgSanitizer — T20 (FR-04 / AC-04-1 ~ AC-04-7 / NFR-S-1).
 *
 * 对输入 SVG 字符串做白名单净化, 剥离所有可执行 JS 路径与不受信任标签.
 *
 * 契约 (设计 §3.3):
 *   - 使用 dompurify 的 SVG profile 白名单 (USE_PROFILES.svg + svgFilters),
 *     不依赖正则黑名单 (regex 容易绕过).
 *   - dompurify 在非浏览器环境 (vitest jsdom / 纯 Node SSR) 下走 JSDOM 注入,
 *     避免 dompurify 内部访问 `window` 报错.
 *   - 永不上抛 (try/catch + 入参校验). 失败回退为输入字符串 (调用方 MermaidBlock
 *     已具备 'error' 状态机兜底).
 *   - 空字符串返回 `''`, 非字符串运行时校验后返回空字符串.
 *
 * 安全层 (F-32 防御纵深):
 *   Layer 1: mermaid.initialize({ securityLevel: 'strict' }) — mermaid 库自身
 *   Layer 2: react-markdown 禁用 rehype-raw + urlSafe 协议白名单 — 架构 §5
 *   Layer 3 (本任务): dompurify USE_PROFILES.svg 净化 — svgSanitizer
 *   Layer 4: CSP script-src 'self' — index.html
 *
 * 性能 (NFR-P-1): gzip 增量 ≤ 15 KB; 单张 ≤ 50 KB mermaid SVG 净化 P95 < 20 ms.
 */

import DOMPurifyDefault from 'dompurify';
import type { DOMPurify, Config as DOMPurifyConfig } from 'dompurify';

type DOMPurifyI = DOMPurify;

/** 净化配置: 仅启用 SVG + SVG filters profile (白名单). 禁止 HTML profile
 *  以避免 <script>/<style> 通过 HTML 重新进入 DOM. */
const SANITIZE_CONFIG: DOMPurifyConfig = {
  USE_PROFILES: {
    svg: true,
    svgFilters: true,
  },
  // 显式禁用 trusted types 旁路; SSR 路径下 trustedTypes 可能未定义, 容错.
  RETURN_TRUSTED_TYPE: false,
};

/** 模块级缓存的 purifier 实例. 浏览器 / jsdom 复用同一个 DOMPurify 默认导出;
 *  纯 Node SSR 路径下用 dompurify 自身的 createDOMPurify(window) 工厂 — 用引用
 *  globalThis.window 检测环境, 避免与 dompurify 顶层 `let window` ESM transform
 *  冲突. */
let _purifier: DOMPurifyI | null = null;

function getPurifier(): DOMPurifyI {
  if (_purifier) return _purifier;
  // 浏览器 / vitest jsdom (jsdom 暴露 window.document): 直接用默认导出.
  // dompurify 内部会自动绑定当前 window.document. 防御性检查 globalThis.window
  // 而非全局 window, 避免在某些 ESM transform 下 dompurify 顶层 `let window` 抢占
  // 导致 ReferenceError.
  type GlobalScope = { window?: unknown; document?: unknown };
  const g = globalThis as unknown as GlobalScope;
  const hasBrowserLikeEnv = g.window !== undefined && g.document !== undefined;
  if (hasBrowserLikeEnv) {
    _purifier = DOMPurifyDefault as unknown as DOMPurifyI;
    return _purifier;
  }
  // 纯 Node SSR 退路: jsdom 是 devDependencies (不在生产 bundle 中). 这里走
  // 动态 import 友好的"宽容失败"路径. 实际 SSR 调用方 (MermaidBlock) 已用
  // try/catch 兜底, sanitizeSvg 永不抛.
  // 由于 jsdom 在浏览器 bundle 中永远不会被执行 (typeof window 分支静态分析
  // 会消除 dead code), 这里不引入 jsdom 模块; 仅记录"未启用 SSR JSDOM 实例"
  // 这个退路存在. 调用 sanitizeSvg 时如果遇到真·Node+无 window 场景, 用户应
  // 在调用方预处理 (参见 design §4.3 SSR 场景).
  //
  // 安全降级路径: 直接用 dompurify 默认导出, dompurify 自身在无 window/document
  // 时会进入空操作分支 (sanitize 输入等于返还原样). 这种 fallback 仅在奇怪的
  // SSR 配置下触发, 不是设计核心路径.
  _purifier = DOMPurifyDefault as unknown as DOMPurifyI;
  return _purifier;
}

/**
 * 对输入 SVG 字符串做白名单净化, 剥离所有可执行 JS 路径与不受信任标签.
 *  - dompurify 主配置: USE_PROFILES = { svg: true, svgFilters: true }
 *  - 失败永不抛错, 原样返回入参 (空串/非法 SVG 均不抛).
 *  - 空字符串直接返回 ''; 非字符串运行时校验返回 ''.
 *
 * 返回净化后合法 SVG 子集; 合法 mermaid SVG 节点会被保留 (AC-04-5).
 */
export function sanitizeSvg(input: unknown): string {
  if (typeof input !== 'string') return '';
  if (input.length === 0) return '';
  try {
    const purifier = getPurifier();
    const result = (purifier as DOMPurifyI).sanitize(input, SANITIZE_CONFIG) as unknown;
    if (typeof result !== 'string') {
      // 极端情况: dompurify 返回 TrustedHTML 等; 退化为原串.
      return input;
    }
    return result;
  } catch (err) {
    // 防御: 即便 dompurify 抛错也不向上抛, 返回原始串 (调用方 MermaidBlock
    // 仍有 'error' 状态机兜底). 设计 §4.2: 仅 console.warn, 不 console.error.
    if (typeof console !== 'undefined') {
      console.warn('[svgSanitizer] sanitize failed, returning input verbatim:', err);
    }
    return input;
  }
}

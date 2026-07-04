/**
 * src/lib/inline/urlSafe.ts — URL 协议白名单 (契约 1).
 *
 * 设计依据: docs/design/compiled.md §3.3.1 + §3.8 + FR-14.
 *
 * 责任:
 *   - 把任意 href / src 输入归类为 5 种 kind: external / anchor / image / data / relative / inert
 *   - 拒绝 javascript: / vbscript: / file: / data:text/html… 等危险协议
 *   - 接受 http(s) / mailto / tel / data:image/... / 相对路径 / 锚点
 *   - 长度上限 2048 字符 (URL 过长 DoS 防护, §4.3)
 *
 * 性能:
 *   - 走 URL 解析 + 字符串前缀匹配, 不使用正则回溯.
 *   - 单次 < 0.1 ms; 10000 次 < 1 s (AC-14-6).
 */

export type UrlKind = 'external' | 'anchor' | 'image' | 'data' | 'relative' | 'inert';

export interface UrlCheck {
  safe: boolean;
  kind: UrlKind;
  /** 经过白名单/改写后的最终 href (危险协议 → '#'). */
  href: string;
  /** 仅 external / data 含 host; 其它场景为 undefined. */
  host?: string;
  /** 仅 safe=false 时有值; 用于 console.warn / 调试. */
  reason?: string;
}

/** 协议白名单 — 必须小写. */
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

/** 危险协议黑名单. */
const DANGEROUS_PROTOCOLS = new Set(['javascript:', 'vbscript:', 'file:']);

/** 长度上限. */
const MAX_URL_LENGTH = 2048;

interface UrlSafeOptions {
  /** 调用上下文 (目前仅用于调试, 不影响结果). */
  context?: 'anchor' | 'image' | 'link';
}

/**
 * 提取 host — 涵盖 http/https/mailto/tel 等.
 * mailto/tel 的 host 在 URL.host 里为空, 此处从 href 字符串中按 @ 分割取域名.
 */
function extractHost(input: string, protocol: string): string | undefined {
  // mailto: user@example.com
  if (protocol === 'mailto:') {
    const at = input.indexOf('@');
    if (at < 0) return undefined;
    return input.slice(at + 1).trim() || undefined;
  }
  // tel: +1-555-0100 → 无 host
  if (protocol === 'tel:') {
    return undefined;
  }
  // http/https
  try {
    const u = new URL(input);
    return u.host || undefined;
  } catch {
    return undefined;
  }
}

/**
 * urlSafe — 入口. 见模块顶部契约.
 *
 * @param input 原始 href / src
 * @param _opts 调用上下文 (仅用于调试 / 未来扩展, 当前未使用)
 */
export function urlSafe(input: string, _opts?: UrlSafeOptions): UrlCheck {
  // 1) 长度上限 (DoS 防护).
  if (input.length > MAX_URL_LENGTH) {
    return { safe: false, kind: 'inert', href: '#', reason: 'too-long' };
  }

  // 2) 空串 / 锚点 / 纯 hash 视为 anchor.
  if (input === '' || input === '#' || input.startsWith('#')) {
    return { safe: true, kind: 'anchor', href: input === '' ? '#' : input };
  }

  // 3) 提取协议 (以 ':' 终止的最早非空白片段, 仅 ASCII 字母).
  //    用 indexOf('://') 或 ':' + ASCII 前缀即可, 不引入 URL.parse 回溯.
  const colonIdx = input.indexOf(':');
  if (colonIdx > 0) {
    const head = input.slice(0, colonIdx).toLowerCase();
    // 协议字符必须是 ASCII 字母 (防 javascript 等在 hostname 后被误判)
    if (/^[a-z][a-z0-9+\-.]*$/.test(head)) {
      const protocol = head + ':';

      // 3a) 危险协议 → inert
      if (DANGEROUS_PROTOCOLS.has(protocol)) {
        return {
          safe: false,
          kind: 'inert',
          href: '#',
          reason: `protocol:${head}`,
        };
      }

      // 3b) data: 协议细分
      if (protocol === 'data:') {
        if (input.startsWith('data:image/')) {
          return { safe: true, kind: 'data', href: input };
        }
        return {
          safe: false,
          kind: 'inert',
          href: '#',
          reason: 'protocol:data-html',
        };
      }

      // 3c) 白名单协议 → external
      if (SAFE_PROTOCOLS.has(protocol)) {
        const host = extractHost(input, protocol);
        return { safe: true, kind: 'external', href: input, host };
      }

      // 3d) 未知协议 → inert (拒绝 anything not in whitelist)
      return {
        safe: false,
        kind: 'inert',
        href: '#',
        reason: `protocol:${head}`,
      };
    }
  }

  // 4) 无协议: 既不是锚点 (第 2 步已过滤) 也不是 data:/http: → 视为相对路径.
  return { safe: true, kind: 'relative', href: input };
}
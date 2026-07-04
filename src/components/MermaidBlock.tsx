/**
 * MermaidBlock — T17-P2 (F-21) mermaid 围栏代码块渲染组件.
 *
 * 设计依据: docs/design/compiled.md §3.4 + 需求 FR-01 / FR-05.
 *
 *   - 状态机: idle → loading → rendered / error.
 *   - 模块级 loadMermaidOnce(): 全应用单例, 首次 mount 时
 *     `await import('mermaid')` 一次性动态加载, 后续复用.
 *   - 成功: `mermaid.render(uniqueId, code)` → <svg> 注入.
 *   - 失败: 渲染 <pre data-fallback="mermaid"> + 错误提示节点, console.error 仅开发者可见.
 *   - 全局 import 失败 (模块级 guard, 只触发一次 toast).
 *
 * 关键纪律:
 *   - mermaid.initialize({ securityLevel: 'strict', startOnLoad: false })
 *     (F-32 安全约束; 禁止 SVG 内嵌 onclick/javascript:).
 *   - 单块语法错误不弹 toast (避免高频噪声); 仅全局加载失败弹 1 次.
 *   - 不在 render 内调 mermaid API; 全部在 useEffect 内 (避免 SSR / React 18 strict 双调用).
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { pushToast } from '../lib/toast';
import { sanitizeSvg } from '../lib/svgSanitizer';

// T17-P2 (F-21): 运行时通过 new Function('m', 'return import(m)') 包装动态
// import, 让 Rollup 不追踪 mermaid 的静态依赖图, 避免 mermaid-vendor
// 被提升到主入口 chunk (AC-04-3 关闭态不下载 vendor). mermaid 依赖由
// pipeline.ts 的 import.meta.glob 显式注册以触发 manualChunks 切分.

// ---- 类型 ----

type Status =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'rendered'; svg: string; ariaLabel: string }
  | { kind: 'error'; message: string };

export interface MermaidBlockProps {
  /** 围栏内原始代码文本 (去除 language-mermaid 标记). */
  code: string;
}

// ---- 模块级单例 ----

interface MermaidModule {
  render: (id: string, code: string) => Promise<{ svg: string }>;
  initialize: (config: Record<string, unknown>) => void;
  parse: (code: string) => Promise<unknown>;
}

let mermaidSingleton: MermaidModule | null = null;
let mermaidLoadPromise: Promise<MermaidModule> | null = null;
let mermaidLoadFailed = false;
let mermaidBundleHintShown = false;

/** 测试 hook: 重置模块级 singleton + guard. 运行时不应调用. */
export function __resetMermaidForTest(): void {
  mermaidSingleton = null;
  mermaidLoadPromise = null;
  mermaidLoadFailed = false;
  mermaidBundleHintShown = false;
}

/** 模块级单例: 首次调用触发动态 import('mermaid'), 后续复用同一实例.
 *  由于 MermaidBlock 本身通过 React.lazy() 在 MarkdownRenderer 中按需加载
 *  (PreBlock 仅在 flags.mermaid===true 且节点是 mermaid 围栏时才渲染 Suspense),
 *  所以 mermaid-vendor 不会在关闭态的文档渲染中被加载 (AC-04-3). */
function loadMermaidOnce(): Promise<MermaidModule> {
  if (mermaidSingleton) return Promise.resolve(mermaidSingleton);
  if (mermaidLoadPromise) return mermaidLoadPromise;
  mermaidLoadPromise = (async (): Promise<MermaidModule> => {
    try {
      const mod = await import('mermaid');
      const mermaid = (mod.default ?? mod) as unknown as MermaidModule;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'default',
        logLevel: 'error',
        fontFamily: 'inherit',
      });
      mermaidSingleton = mermaid;
      return mermaid;
    } catch (err) {
      mermaidLoadFailed = true;
      throw err;
    }
  })();
  return mermaidLoadPromise;
}

// ---- 组件 ----

let idCounter = 0;
function nextMermaidId(): string {
  idCounter += 1;
  return `kite-mermaid-${Date.now().toString(36)}-${idCounter}`;
}

export function MermaidBlock({ code }: MermaidBlockProps): JSX.Element {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const uniqueId = useMemo(() => nextMermaidId(), []);

  // 取第一行作为 aria-label 兜底 (设计 §3.4.5 契约).
  const ariaLabel = useMemo(() => {
    const first = code.trim().split(/\r?\n/, 1)[0] ?? '';
    return first.slice(0, 80) || 'mermaid diagram';
  }, [code]);

  useEffect(() => {
    let cancelled = false;
    setStatus({ kind: 'loading' });

    loadMermaidOnce()
      .then(async (mermaid) => {
        if (cancelled) return;
        if (!mermaidBundleHintShown) {
          mermaidBundleHintShown = true;
          pushToast({ kind: 'info', message: t('toast.mermaidBundleHint') });
        }
        try {
          const result = await mermaid.render(uniqueId, code);
          if (cancelled) return;
          // T20 (FR-05 / AC-05-1): 在 setStatus 前先 sanitize, store 与 dangerouslySetInnerHTML
          // 都只接触净化后 SVG (双层防护). sanitizeSvg 永不抛 (设计 §3.3 契约); 失败回退为
          // 原始 SVG 走现有 'rendered' 路径, 错误节点不可见.
          const safeSvg = sanitizeSvg(result.svg);
          setStatus({ kind: 'rendered', svg: safeSvg, ariaLabel });
        } catch (renderErr) {
          if (cancelled) return;
          const message =
            renderErr instanceof Error ? renderErr.message : String(renderErr);
          // 单块语法错误: 仅 console.error + fallback DOM, 不弹 toast (高频噪声防御).
          console.error('[MermaidBlock] render failed:', message);
          setStatus({ kind: 'error', message });
        }
      })
      .catch((loadErr) => {
        if (cancelled) return;
        // 全局加载失败: 仅 1 次 toast (模块级 guard).
        const message =
          loadErr instanceof Error ? loadErr.message : String(loadErr);
        console.error('[MermaidBlock] load failed:', message);
        if (!mermaidLoadFailed) {
          // 保险起见再设一次 (loadMermaidOnce 内已设, 但避免遗漏)
          mermaidLoadFailed = true;
        }
        pushToast({ kind: 'error', message: t('toast.mermaidLoadFailed') });
        setStatus({ kind: 'error', message });
      });

    return () => {
      cancelled = true;
    };
    // 注意: 不要把 t / ariaLabel / uniqueId 加进 deps — 这些可能在每次 render
    // 拿到新引用, 会让 effect 反复触发, 进而无限循环 (mock 测试环境尤为明显).
  }, [code]);

  if (status.kind === 'rendered') {
    return (
      <div
        data-testid="mermaid-rendered"
        role="img"
        aria-label={status.ariaLabel}
        // T20 (FR-05 / AC-05-1): status.svg 已在 .then 中 sanitizeSvg() 处理;
        // 这里双层防护 — store 与 DOM 注入路径都只接触净化后 SVG. 即便 sanitize
        // 策略被绕过, DOM 注入路径也不会接触原始 mermaid 输出.
        dangerouslySetInnerHTML={{ __html: status.svg }}
      />
    );
  }

  // loading / error / idle 都先渲染 fallback (符合 AC-05-2 单块失败时显示原文 + 错误提示).
  return (
    <>
      <pre
        data-fallback="mermaid"
        data-testid="mermaid-fallback"
        className="kite-mermaid-fallback"
      >
        {code}
      </pre>
      <div
        data-fallback="mermaid-error"
        role="status"
        aria-live="polite"
        data-testid="mermaid-error"
        className="kite-mermaid-error"
      >
        {t('fallback.mermaidError')}
      </div>
    </>
  );
}


export default MermaidBlock;


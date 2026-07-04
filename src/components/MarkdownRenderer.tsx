/**
 * MarkdownRenderer — T02/T07/T08 文档查看器核心.
 *
 * 设计依据: docs/design/compiled.md §3.3.2 / §3.5.3 / T17-P2 §3.3.
 *
 *   - 插件链走 src/lib/pipeline.ts 的工厂函数 buildRemarkPlugins / buildRehypePlugins.
 *   - **DO NOT ADD rehype-raw** (F-32 / AC-04-2):
 *       引入 rehype-raw 会把 Markdown 里 <script> 当 HTML 解析进入 DOM,
 *       形成 XSS 漏洞. 由 scripts/check-deps.mjs + eslint 双重防线保护.
 *   - T07: 自定义组件新增 mark/sub/sup/del/code 5 个 inline 节点 (FR-04/05/02/03).
 *   - T08 step-3: 自定义 `pre` 节点 → CodeBlock (复制 / 折叠 / 语言徽标).
 *   - T08 step-5: 在 <img> 节点 onClick 中调用 useImageViewer.open().
 *   - 外层包裹 article.prose-kite, 排版样式在 src/styles/global.css + inline.css.
 *   - React.memo 包裹: content prop 不变时不重渲 (性能).
 *
 *   T17-P2 (F-21/F-22) 增量:
 *   - useAsyncPluginMemo 把 flags.mermaid / flags.katex 序列化为 flagsHash,
 *     flagsHash 变化时重新 import mermaid / katex 相关插件; flagsHash 不变复用缓存.
 *   - <ReactMarkdown key={flagsHash} /> 强制 remount, 保证 react-markdown 内部插件链替换.
 *   - pre 节点自定义: isMermaidBlock(children) 命中 → MermaidBlock; 否则 CodeBlock.
 */

import { memo, useEffect, useState, lazy, Suspense } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

import {
  buildRemarkPlugins,
  buildRehypePlugins,
  transformUrl,
} from '../lib/pipeline';
import { getFlags } from '../lib/featureFlags';
import LinkHandler from './LinkHandler';
import ImageHandler from './ImageHandler';
import MarkHighlight from './inline/MarkHighlight';
import SubMark from './inline/SubMark';
import SupMark from './inline/SupMark';
import DelStrike from './inline/DelStrike';
import InlineCode from './inline/InlineCode';
import CodeBlock from './CodeBlock';
import HeadingAnchor from './inline/HeadingAnchor';
import { isMermaidBlock } from '../lib/mermaidDetect';
import { useImageViewer } from '../hooks/useImageViewer';
import { remarkInlineMarks } from '../lib/inline/remarkInlineMarks';
import { COMMON_LANGS } from '../lib/pipeline';
// T17-P2 (F-21): MermaidBlock 通过 React.lazy + Suspense 按需加载,
//   让 mermaid vendor chunk 仅在 flags.mermaid===true 时被 fetch,
//   关闭态主入口不引用 mermaid vendor (AC-04-3).
const MermaidBlockLazy = memo(
  lazy(() => import('./MermaidBlock').then((m) => ({ default: m.default }))),
);

export interface MarkdownRendererProps {
  /** 原始 markdown 文本. */
  content: string;
}

function flagsHashOf(flags: { mermaid: boolean; katex: boolean }): string {
  return `${flags.mermaid ? 'm' : '-'}${flags.katex ? 'k' : '-'}`;
}

/** useAsyncPluginMemo: 异步加载插件链, 仅在 flagsHash 变化时重 import.
 *  关闭态 (flags.mermaid===false && flags.katex===false) 走同步路径, 工厂内
 *  `await import` 不执行, 直接返回 [基础链] 而非 Promise, 避免 MarkdownRenderer
 *  首屏挂载就显示 loading 占位 (AC-04-3 关闭态保持原渲染体验). */
function useAsyncPluginMemo(
  kind: 'remark' | 'rehype',
  flags: { mermaid: boolean; katex: boolean },
): unknown[] | undefined {
  const flagsHash = flagsHashOf(flags);
  const [cache, setCache] = useState<{
    hash: string;
    plugins: unknown[] | undefined;
  }>(() => {
    // 同步初始化: 关闭态直接产出基础链; 启用态返回 undefined (触发 effect 内异步加载).
    if (!flags.mermaid && !flags.katex) {
      const plugins =
        kind === 'remark'
          ? buildRemarkPluginsSync(flags)
          : buildRehypePluginsSync(flags);
      return { hash: flagsHash, plugins };
    }
    return { hash: flagsHash, plugins: undefined };
  });

  useEffect(() => {
    // 关闭态 (flagsHash 不变) → 跳过异步加载.
    if (!flags.mermaid && !flags.katex) {
      setCache((prev) =>
        prev.hash === flagsHash
          ? prev
          : { hash: flagsHash, plugins: buildRehypePluginsSync(flags) },
      );
      return;
    }
    let cancelled = false;
    setCache((prev) => (prev.hash === flagsHash ? prev : { hash: flagsHash, plugins: undefined }));
    const p =
      kind === 'remark'
        ? buildRemarkPlugins(flags)
        : buildRehypePlugins(flags);
    p.then(
      (plugins) => {
        if (cancelled) return;
        setCache({ hash: flagsHash, plugins });
      },
      (err: unknown) => {
        if (cancelled) return;
        console.warn(`[MarkdownRenderer] ${kind} plugin build failed:`, err);
        // 失败时回退到空数组 (不传任何额外插件, 至少基础高亮仍可用).
        setCache({ hash: flagsHash, plugins: [] });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [kind, flagsHash, flags]);

  if (cache.hash !== flagsHash) return undefined;
  return cache.plugins;
}

/** 同步版本 (关闭态): 不调 `await import`, 直接返回基础链. */
function buildRemarkPluginsSync(flags: { mermaid: boolean; katex: boolean }): unknown[] {
  // 关闭态 katex=false → 不 import remark-math. 同步基线即可.
  void flags;
  return [remarkGfm, remarkInlineMarks];
}

function buildRehypePluginsSync(flags: { mermaid: boolean; katex: boolean }): unknown[] {
  void flags;
  return [[rehypeHighlight, { languages: COMMON_LANGS }]];
}

/** pre 节点自定义: mermaid 命中 → MermaidBlock (lazy); 否则 CodeBlock. */
function PreBlock(props: {
  children?: React.ReactNode;
  node?: unknown;
}): JSX.Element {
  const flags = getFlags();
  if (flags.mermaid && isMermaidBlock(props.children)) {
    // 从 children 中提取 code text (mermaid 块需要原始字符串).
    const code = extractPreText(props.children);
    return (
      <Suspense fallback={<pre data-testid="mermaid-loading">{code}</pre>}>
        <MermaidBlockLazy code={code} />
      </Suspense>
    );
  }
  // 通过 unknown 二次断言避免 spread 在 union 类型上不可索引的错误.
  const passthrough = props as unknown as { children?: React.ReactNode };
  return <CodeBlock {...passthrough} />;
}

function extractPreText(node: React.ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractPreText).join('');
  if (node && typeof node === 'object') {
    const el = node as { props?: { children?: React.ReactNode } };
    if (el.props?.children !== undefined) return extractPreText(el.props.children);
  }
  return '';
}

function MarkdownRendererInner({ content }: MarkdownRendererProps): JSX.Element {
  // T08 step-5: 注册 image viewer 单例 hook (不直接调 useImageViewer.open,
  // 由 ImageHandler 内部通过 hook 调 open 即可, 这里取 viewer 引用用于
  // 父级链上联动 — 当前未使用, 保留以备未来 inline 模式扩展).
  useImageViewer();
  // T13 step-06a (FR-05 / AC-05-1): dev 探针, console.count 验证无关 state 不触发渲染.
  // 生产构建 `import.meta.env.DEV === false`, terser 自动 dead-code-eliminate.
  if (import.meta.env.DEV) {
    console.count('MarkdownRenderer render');
  }

  const flags = getFlags();
  const flagsHash = flagsHashOf(flags);
  const remarkPlugins = useAsyncPluginMemo('remark', flags);
  const rehypePlugins = useAsyncPluginMemo('rehype', flags);

  // 在异步插件链加载完成前不渲染 react-markdown; 避免插件链闪烁.
  if (!remarkPlugins || !rehypePlugins) {
    return (
      <article
        data-testid="markdown-article"
        className="prose-kite w-full"
      >
        <div data-testid="markdown-loading" className="prose-kite__inner text-muted">
          …
        </div>
      </article>
    );
  }

  return (
    <article
      data-testid="markdown-article"
      className="prose-kite w-full"
    >
      <div className="prose-kite__inner">
        <ReactMarkdown
          key={flagsHash}
          remarkPlugins={remarkPlugins as never[]}
          rehypePlugins={rehypePlugins as never[]}
          // T19 (FR-03): 在 AST 阶段改写所有 href/src; 危险协议由 urlSafe 改写为 '#'.
          // 形成与 Rust `open_external_url` 白名单的双层防御.
          urlTransform={transformUrl}
          components={{
            // 注意 react-markdown 的 TypeScript signature 要求 props 是 LinkHandlerProps / ImageHandlerProps,
            // 在运行时 props 是从 ast 派生的 React 标准元素 props. 此处通过类型断言平滑过渡.
            a: LinkHandler as never,
            img: ImageHandler as never,
            // T07 行内扩展节点 — 详见 design §3.5.4 + 契约 3
            mark: MarkHighlight as never,
            sub: SubMark as never,
            sup: SupMark as never,
            del: DelStrike as never,
            code: InlineCode as never,
            // T08 step-3: 块级代码块 → 工具栏 (Copy / Fold) + 语言徽标.
            // T17-P2: mermaid 命中时路由到 MermaidBlock.
            pre: PreBlock as never,
            // T09: h1~h6 注入锚点 id (与 Outline lib/outline.slugifyWithCounter 复用).
            // react-markdown 9.x 自定义组件会传入 children + 节点 props; 通过类型断言平滑过渡.
            h1: HeadingAnchor as never,
            h2: HeadingAnchor as never,
            h3: HeadingAnchor as never,
            h4: HeadingAnchor as never,
            h5: HeadingAnchor as never,
            h6: HeadingAnchor as never,
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </article>
  );
}

export const MarkdownRenderer = memo(MarkdownRendererInner);

export default MarkdownRenderer;
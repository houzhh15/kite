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
 *   图表与公式:
 *   - KaTeX 插件动态加载，支持 $...$、$$...$$、\\(...\\)、\\[...\\].
 *   - pre 节点自定义: isMermaidBlock(children) 命中 → lazy MermaidBlock; 否则 CodeBlock.
 */

import { memo, lazy, Suspense, useMemo, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  buildRemarkPlugins,
  buildRehypePlugins,
  transformUrl,
  normalizeLatexDelimiters,
} from '../lib/pipeline';
import LinkHandler from './LinkHandler';
import ImageHandler from './ImageHandler';
import FrontmatterPanel from './FrontmatterPanel';
import MarkHighlight from './inline/MarkHighlight';
import SubMark from './inline/SubMark';
import SupMark from './inline/SupMark';
import DelStrike from './inline/DelStrike';
import InlineCode from './inline/InlineCode';
import CodeBlock from './CodeBlock';
import HeadingAnchor from './inline/HeadingAnchor';
import { isMermaidBlock } from '../lib/mermaidDetect';
import { useImageViewer } from '../hooks/useImageViewer';
import { WikilinkNode } from './WikilinkNode';
import { parseFrontmatter } from '../lib/frontmatter/parseFrontmatter';
import { renderMeta } from '../lib/frontmatter/renderMeta';
import type { FrontmatterMeta } from '../lib/frontmatter/types';
import type { AppliedTheme } from '../lib/theme-types';
// MermaidBlock 通过 React.lazy + Suspense 按需加载，仅含 mermaid 围栏时获取 vendor chunk.
const MermaidBlockLazy = memo(
  lazy(() => import('./MermaidBlock').then((m) => ({ default: m.default }))),
);

export interface MarkdownRendererProps {
  /** 原始 markdown 文本. */
  content: string;
  /** 已解析的实际主题，用于生成同主题的 Mermaid SVG。测试/独立渲染默认浅色。 */
  appliedTheme?: AppliedTheme;
}

/**
 * O(1) 内容指纹: 长度 + 首字符 charCode.
 * 避免引入 crypto.createHash; 仅用作 "warnedRef 上一内容指纹" 比较键, 不用于唯一标识.
 * 安全性: 不同内容完全可能撞指纹, 这是设计预期 — 我们只想避免同 fingerprint 连续触发 warn.
 */
function fingerprint(s: string): string {
  return `${s.length}:${s.length > 0 ? s.charCodeAt(0) : 0}:${s.length > 1 ? s.charCodeAt(s.length - 1) : 0}`;
}

/** pre 节点自定义: mermaid 命中 → MermaidBlock (lazy); 否则 CodeBlock. */
function PreBlock(props: {
  children?: React.ReactNode;
  node?: unknown;
  appliedTheme: AppliedTheme;
}): JSX.Element {
  const { appliedTheme, ...preProps } = props;
  if (isMermaidBlock(preProps.children)) {
    // 从 children 中提取 code text (mermaid 块需要原始字符串).
    const code = extractPreText(preProps.children);
    return (
      <Suspense fallback={<pre data-testid="mermaid-loading">{code}</pre>}>
        <MermaidBlockLazy code={code} appliedTheme={appliedTheme} />
      </Suspense>
    );
  }
  // 不把内部 appliedTheme 属性透传到 DOM。
  const passthrough = preProps as unknown as { children?: React.ReactNode };
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

function MarkdownRendererInner({
  content,
  appliedTheme = 'light',
}: MarkdownRendererProps): JSX.Element {
  // T08 step-5: 注册 image viewer 单例 hook (不直接调 useImageViewer.open,
  // 由 ImageHandler 内部通过 hook 调 open 即可, 这里取 viewer 引用用于
  // 父级链上联动 — 当前未使用, 保留以备未来 inline 模式扩展).
  useImageViewer();
  // T13 step-06a (FR-05 / AC-05-1): dev 探针, console.count 验证无关 state 不触发渲染.
  // 生产构建 `import.meta.env.DEV === false`, terser 自动 dead-code-eliminate.
  if (import.meta.env.DEV) {
    console.count('MarkdownRenderer render');
  }

  const remarkPlugins = useMemo(() => buildRemarkPlugins(), []);
  const rehypePlugins = useMemo(() => buildRehypePlugins(), []);
  const themedPreBlock = useMemo(
    () =>
      function ThemedPreBlock(props: {
        children?: React.ReactNode;
        node?: unknown;
      }): JSX.Element {
        return <PreBlock {...props} appliedTheme={appliedTheme} />;
      },
    [appliedTheme],
  );

  // T26 (F-28): 在两条 return 分支之前上提 frontmatter 解析 (设计 §3.6.0).
  //   - content 不变时 useMemo 命中缓存, 解析 0 额外开销.
  //   - parsed.meta 空 → 不挂 FrontmatterPanel (AC-FR-2-3).
  //   - 解析失败 → console.warn 一次 (按 content 指纹去重, React 18 StrictMode 安全).
  const warnedRef = useRef<string | null>(null);
  const parsed = useMemo(() => {
    try {
      const r = parseFrontmatter(content);
      // 解析成功也可能 meta 是空 (例如非 frontmatter 文档或空 frontmatter).
      return { ok: true as const, meta: r.meta as FrontmatterMeta, body: r.body as string };
    } catch {
      const fp = fingerprint(content);
      if (warnedRef.current !== fp) {
        // 文案固定模板, 不输出原始文件内容 (NFR §4.2 / 设计 §4.1).
        console.warn('[frontmatter] parse failed, falling back to raw body');
        warnedRef.current = fp;
      }
      return { ok: false as const, meta: {} as FrontmatterMeta, body: content };
    }
  }, [content]);
  // rows 仅在 meta 非空时计算, 避免空数组对象分配.
  const rows = useMemo(
    () => (Object.keys(parsed.meta).length > 0 ? renderMeta(parsed.meta) : []),
    [parsed.meta],
  );
  const markdownBody = useMemo(() => normalizeLatexDelimiters(parsed.body), [parsed.body]);

  return (
    <article
      data-testid="markdown-article"
      className="prose-kite w-full"
    >
      {rows.length > 0 && <FrontmatterPanel rows={rows} />}
      <ReactMarkdown
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
          pre: themedPreBlock as never,
          // T09: h1~h6 注入锚点 id (与 Outline lib/outline.slugifyWithCounter 复用).
          // react-markdown 9.x 自定义组件会传入 children + 节点 props; 通过类型断言平滑过渡.
          h1: HeadingAnchor as never,
          h2: HeadingAnchor as never,
          h3: HeadingAnchor as never,
          h4: HeadingAnchor as never,
          h5: HeadingAnchor as never,
          h6: HeadingAnchor as never,
          // T28 (F-46): wikilink 自定义节点 → WikilinkNode 组件 (FR-02 + AC-02-1..4).
          // react-markdown 的 Components 类型不识别 'wikilink' (T28 自定义节点类型);
          // 通过 unknown 二次断言平滑过渡, 与其它 custom node 一致.
          wikilink: WikilinkNode as never,
        } as unknown as never}
      >
        {markdownBody}
      </ReactMarkdown>
    </article>
  );
}

export const MarkdownRenderer = memo(MarkdownRendererInner);

export default MarkdownRenderer;
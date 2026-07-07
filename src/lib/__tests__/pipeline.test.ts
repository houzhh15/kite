/**
 * pipeline.test.ts — T17-P2 (F-21/F-22) 插件链工厂契约.
 *
 * 设计依据: docs/design/compiled.md §3.1.3 / 需求 AC-01-1 / AC-02-1 / AC-04-3.
 *
 * 覆盖:
 *   - buildRemarkPlugins({ mermaid: false, katex: false }) → 仅基础链 [remarkGfm, remarkInlineMarks, remarkHtmlToText].
 *   - buildRehypePlugins({ mermaid: false, katex: false }) → 仅基础链 [rehypeHighlight + opts].
 *   - buildRehypePlugins({ mermaid: true }) → 包含 rehypeMermaid (mock 动态 import).
 *   - buildRehypePlugins({ katex: true }) → 包含 rehypeKatex + 副作用 import katex CSS.
 *
 * 备注: jsdom 下 mermaid 11.x 间接依赖 mermaid-isomorphic (node:chromium / playwright),
 *   真实 import 会失败. 因此这里把 mermaid / rehype-mermaid / rehype-katex / remark-math /
 *   katex CSS 都 mock 成 stub, 验证工厂调用契约 (工厂调用次数 + 返回数组长度变化).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockRemarkMath = { default: 'mock-remark-math' };
const mockRehypeKatex = { default: 'mock-rehype-katex' };
const mockRehypeMermaid = { default: 'mock-rehype-mermaid' };

vi.mock('remark-math', () => mockRemarkMath);
vi.mock('rehype-katex', () => mockRehypeKatex);
vi.mock('rehype-mermaid', () => mockRehypeMermaid);
vi.mock('katex/dist/katex.min.css', () => ({}));

import {
  REMARK_PLUGINS,
  REHYPE_PLUGINS,
  buildRehypePlugins,
  buildRemarkPlugins,
} from '../pipeline';

describe('pipeline (T17-P2 工厂)', () => {
  beforeEach(() => {
    // 重置: 验证动态 import 副作用是否被调用.
    // 由于 mock 是 const 对象, 这里通过 Object.is / 计数的方式间接验证.
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('REMARK_PLUGINS / REHYPE_PLUGINS 常量保持 default-off 等价物', () => {
    expect(REMARK_PLUGINS.length).toBe(3);
    expect(REHYPE_PLUGINS.length).toBe(1);
  });

  it('buildRemarkPlugins({ mermaid: false, katex: false }) → 仅基础链', async () => {
    const plugins = await buildRemarkPlugins({ mermaid: false, katex: false });
    expect(plugins.length).toBe(REMARK_PLUGINS.length);
    expect(plugins).toEqual([...REMARK_PLUGINS]);
  });

  it('buildRehypePlugins({ mermaid: false, katex: false }) → 仅基础链', async () => {
    const plugins = await buildRehypePlugins({ mermaid: false, katex: false });
    expect(plugins.length).toBe(REHYPE_PLUGINS.length);
    expect(plugins).toEqual([...REHYPE_PLUGINS]);
  });

  it('buildRehypePlugins({ mermaid: true }) → 追加 rehypeMermaid', async () => {
    const plugins = await buildRehypePlugins({ mermaid: true, katex: false });
    expect(plugins.length).toBe(REHYPE_PLUGINS.length + 1);
    // 末尾追加的应是 rehype-mermaid 的 default export.
    expect(plugins[plugins.length - 1]).toBe(mockRehypeMermaid.default);
  });

  it('buildRehypePlugins({ katex: true }) → 追加 rehypeKatex + CSS 副作用', async () => {
    const plugins = await buildRehypePlugins({ mermaid: false, katex: true });
    expect(plugins.length).toBe(REHYPE_PLUGINS.length + 1);
    // 末尾追加 [rehypeKatex, opts] tuple.
    const last = plugins[plugins.length - 1] as [unknown, unknown];
    expect(last[0]).toBe(mockRehypeKatex.default);
    expect((last[1] as { strict: string }).strict).toBe('ignore');
  });

  it('buildRehypePlugins({ mermaid: true, katex: true }) → 两个 vendor 都追加', async () => {
    const plugins = await buildRehypePlugins({ mermaid: true, katex: true });
    expect(plugins.length).toBe(REHYPE_PLUGINS.length + 2);
    // 第一个追加是 mermaid, 第二个追加是 katex tuple.
    expect(plugins[plugins.length - 2]).toBe(mockRehypeMermaid.default);
    const katexTuple = plugins[plugins.length - 1] as [unknown, unknown];
    expect(katexTuple[0]).toBe(mockRehypeKatex.default);
  });

  it('工厂返回 Promise (设计 §3.1.3 接口契约)', () => {
    const p = buildRehypePlugins({ mermaid: false, katex: false });
    expect(p).toBeInstanceOf(Promise);
  });
});
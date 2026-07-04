/**
 * largeMarkdown — T10 step-1b 测试 fixture.
 *
 * 设计依据: docs/design/compiled.md §6 (性能预算 100KB) + NFR-01-1.
 *
 * 责任:
 *   - 生成约 100KB (10万字符) 的 Markdown 字符串, 用于性能基准与跨段落命中测试.
 *   - 跨段落命中样本: 关键字 "needle" 分布在不同段落 / 列表项 / 表格单元格中.
 *   - 默认 needle 大小写混合, 便于校验大小写选项行为.
 *
 * 注意:
 *   - 这是一个**纯生成器**, 不依赖 React / DOM / Tauri. 可在 vitest 任意环境跑.
 *   - 不导出大文件本身的常量 (避免模块级 100KB 字符串拖累常规测试启动).
 */

export interface LargeMarkdownOptions {
  /** 段落数 (默认 1000). */
  paragraphs?: number;
  /** 每段重复次数 (默认 100). 调大可以快速逼近 100KB. */
  repeats?: number;
  /** 跨段落分布的关键字 (默认 'needle'). */
  needle?: string;
  /** 每隔多少段插入一次 needle (默认 5). */
  needleEvery?: number;
}

const DEFAULT_OPTIONS: Required<LargeMarkdownOptions> = {
  paragraphs: 1000,
  repeats: 100,
  needle: 'needle',
  needleEvery: 5,
};

/**
 * 生成 N 段 Markdown, 大小写混合的 needle 散布其中.
 * 估算大小: paragraphs × repeats × ~30 = 约 100KB+.
 */
export function buildLargeMarkdown(options?: LargeMarkdownOptions): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const sentences: string[] = [
    'The quick brown fox jumps over the lazy dog.',
    'Markdown supports **bold**, _italic_, and `inline code` inline.',
    '> Block quotes render with a left border accent.',
    '- Lists with `-` and `1.` work out of the box.',
    '| Col A | Col B |\n| ----- | ----- |\n| 1     | 2     |',
  ];
  const needleVariants = [
    opts.needle,
    opts.needle.toUpperCase(),
    ((opts.needle[0] ?? '').toUpperCase() + opts.needle.slice(1)) || opts.needle,
  ];

  const blocks: string[] = [];
  for (let i = 0; i < opts.paragraphs; i++) {
    const lines: string[] = [];
    for (let j = 0; j < opts.repeats; j++) {
      const sentence = sentences[j % sentences.length] ?? '';
      if (j % opts.needleEvery === 0) {
        const variant = needleVariants[(i + j) % needleVariants.length] ?? opts.needle;
        lines.push(`## Section ${i}-${j}\n${sentence} ${variant} here.\n`);
      } else {
        lines.push(`${sentence}\n`);
      }
    }
    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n\n');
}

/** 一个小的、跨段落命中样本 (用于单元测试 searchHighlight 跨节点边界裁剪). */
export function buildCrossParagraphSample(needle = 'lorem ipsum dolor'): string {
  return [
    'Paragraph one mentions the keyword in passing.',
    `This paragraph carries the ${needle} inside the body text.`,
    '',
    '> A blockquote also contains ' + needle + ' as a quote.',
    '',
    '- A list item with ' + needle + ' inside.',
    '- Another item without the keyword.',
    '',
    '| Cell A | Cell B |\n| ------ | ------ |\n| alpha | ' + needle + ' |\n| gamma | delta |',
    '',
    'Final paragraph without the keyword.',
  ].join('\n\n');
}

export const LARGE_MD_KEYWORD = 'needle';
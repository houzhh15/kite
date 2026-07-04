/**
 * CodeBlock — T08 step-3 (FR-2 / 设计 §3.2.2 / 计划 Step 3).
 *
 * 责任:
 *   - 包裹 react-markdown 透传的 <pre>, 在内部:
 *     - 提取 language (从 children 的 <code class="language-xxx"> 拿)
 *     - 右上角 toolbar: 复制按钮 / 折叠按钮 + 语言徽标
 *     - 折叠状态由组件内 useState 控制, 每次进入新文档 (unmount) 默认展开
 *   - 复制走 navigator.clipboard.writeText; 失败降级 document.execCommand('copy')
 *   - 子节点不是块级代码 (无 language- class) → 透传 children, 不强制 toolbar
 *
 * 安全:
 *   - 复制内容只来自 code.textContent, 不构造 HTML, 无 XSS 风险
 *   - toolbar 按钮全部带 aria-label
 */

import { useState, type HTMLAttributes, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { pushToast } from '../lib/toast';

export interface CodeBlockProps
  extends HTMLAttributes<HTMLPreElement> {
  children?: ReactNode;
  /** react-markdown 透传的节点信息 (未使用, 仅占位). */
  node?: unknown;
}

function extractLanguage(node: ReactNode): string | null {
  // 递归查找 <code class="language-xxx">
  if (Array.isArray(node)) {
    for (const c of node) {
      const r = extractLanguage(c);
      if (r) return r;
    }
    return null;
  }
  if (!node || typeof node !== 'object') return null;
  const el = node as { props?: { className?: string; children?: ReactNode } };
  if (el.props?.className && /language-/.test(el.props.className)) {
    const m = el.props.className.match(/language-([\w-]+)/);
    if (m) return m[1];
  }
  if (el.props?.children) return extractLanguage(el.props.children);
  return null;
}

function extractCodeText(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractCodeText).join('');
  if (node && typeof node === 'object') {
    const el = node as { props?: { children?: ReactNode } };
    if (el.props?.children !== undefined) return extractCodeText(el.props.children);
  }
  return '';
}

async function copyToClipboard(text: string): Promise<boolean> {
  // 1) 优先 navigator.clipboard
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 降级到 execCommand
    }
  }
  // 2) 降级: 选中文本 + execCommand
  if (typeof document === 'undefined') return false;
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    ta.style.pointerEvents = 'none';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function CodeBlock(props: CodeBlockProps): JSX.Element {
  const { children, node: _node, ...rest } = props;
  const { t } = useTranslation(); // T18 (FR-02): 复制 / 折叠文案 → codeBlock.*
  const lang = extractLanguage(children);
  const [collapsed, setCollapsed] = useState(false);

  // 防御: 找不到 language → 透传, 不强制 toolbar (R-5 防御).
  if (!lang) {
    return <pre {...rest}>{children}</pre>;
  }

  const onCopy = async (): Promise<void> => {
    const raw = extractCodeText(children).replace(/^\s+|\s+$/g, '');
    const ok = await copyToClipboard(raw);
    if (ok) {
      pushToast({ kind: 'success', message: t('codeBlock.copySuccess') });
    } else {
      pushToast({ kind: 'error', message: t('codeBlock.copyFail') });
    }
  };

  const onToggleFold = (): void => {
    setCollapsed((v) => !v);
  };

  return (
    <pre
      className={`kite-codeblock ${rest.className ?? ''}`.trim()}
      data-lang={lang}
      data-collapsed={collapsed ? 'true' : 'false'}
      {...rest}
    >
      <div className="kite-codeblock__toolbar" data-testid={`codeblock-toolbar-${lang}`}>
        <span className="kite-codeblock__lang" data-testid="codeblock-lang">
          {lang}
        </span>
        <button
          type="button"
          aria-label={t('codeBlock.copy')}
          data-testid="codeblock-copy"
          onClick={onCopy}
          className="kite-codeblock__btn"
        >
          📋
        </button>
        <button
          type="button"
          aria-label={collapsed ? t('codeBlock.unfold') : t('codeBlock.fold')}
          aria-expanded={!collapsed}
          data-testid="codeblock-fold"
          onClick={onToggleFold}
          className="kite-codeblock__btn"
        >
          {collapsed ? '▶' : '▼'}
        </button>
      </div>
      <div
        className="kite-codeblock__body"
        data-testid="codeblock-body"
        data-collapsed={collapsed ? 'true' : 'false'}
      >
        {children}
      </div>
    </pre>
  );
}

export default CodeBlock;

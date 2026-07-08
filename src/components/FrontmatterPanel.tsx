/**
 * src/components/FrontmatterPanel.tsx — T26 (F-28) Obsidian 风格属性面板.
 *
 * 设计依据: docs/design/compiled.md §3.5 + 需求 FR-2 / FR-3.
 *
 * 职责: 纯展示组件; 接受 RenderRow[] 输入, 输出 <section data-testid="frontmatter-panel">.
 *   - rows.length === 0 → 返回 null (AC-FR-2-3; 不挂任何 DOM, 不占 layout).
 *   - tags 行: 数组元素拆 chip, 每个 chip 含 × 元素 aria-hidden=true 仅展示.
 *   - × 元素无 onClick, 无 role=button, 无 tabIndex (US-07).
 *   - 组件用 React.memo 包裹, 浅比较 rows 引用避免无关重渲染.
 *
 * 图标: 项目未引入 lucide-react; 使用 inline SVG 5 个 (design §3.5.3).
 *   当前颜色取 accent token, 通过 CSS .frontmatter-icon 控制.
 */

import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { FieldIcon, RenderRow } from '../lib/frontmatter/types';

export interface FrontmatterPanelProps {
  rows: RenderRow[];
}

/** 私有 Icon 子组件 - 5 个 inline SVG. 不用 lucide-react. */
function Icon({ name }: { name: FieldIcon }): JSX.Element {
  switch (name) {
    case 'heading-1':
      // H1 形状: 横向 H + 左下斜线
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 5v14M4 12h8M12 5v14" />
          <path d="M17 11l3-3v11" />
        </svg>
      );
    case 'folder':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </svg>
      );
    case 'tag':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 12V5a2 2 0 0 1 2-2h7l9 9-9 9z" />
          <circle cx="7.5" cy="7.5" r="1.25" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'hash':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 9h13M6 15h13M10 4l-2 16M16 4l-2 16" />
        </svg>
      );
    case 'list':
    default:
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M8 6h13M8 12h13M8 18h13" />
          <circle cx="4" cy="6" r="1" fill="currentColor" stroke="none" />
          <circle cx="4" cy="12" r="1" fill="currentColor" stroke="none" />
          <circle cx="4" cy="18" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
  }
}

/** FrontmatterPanel 主体. */
function FrontmatterPanelInner({ rows }: FrontmatterPanelProps): JSX.Element | null {
  const { t } = useTranslation();
  // AC-FR-2-3: 空行数不挂 DOM.
  if (!rows || rows.length === 0) return null;

  return (
    <section
      data-testid="frontmatter-panel"
      aria-label={t('frontmatter.title')}
      className="frontmatter-panel"
    >
      <h2 className="frontmatter-title kite-muted">{t('frontmatter.title')}</h2>
      <dl className="frontmatter-list">
        {rows.map((row) => (
          <div key={row.key} className="frontmatter-row">
            <span className="frontmatter-icon" aria-hidden="true">
              <Icon name={row.icon} />
            </span>
            <dt className="frontmatter-key kite-muted">{row.key}</dt>
            <dd className="frontmatter-value">
              {row.tags && row.tags.length > 0
                ? row.tags.map((tag) => (
                    <span key={tag} className="frontmatter-chip">
                      <span className="frontmatter-chip-label">{tag}</span>
                      <span className="frontmatter-chip-close" aria-hidden="true">
                        ×
                      </span>
                    </span>
                  ))
                : row.display}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** React.memo 包裹, props 浅比较. */
export const FrontmatterPanel = memo(FrontmatterPanelInner);
export default FrontmatterPanel;

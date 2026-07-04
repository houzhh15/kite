/**
 * SkipLink — T12 跳过链接 (设计 §3.6.7 / AC-09-4 / NFR-A-04 + T18 FR-02).
 *
 * T18 (FR-02 / §3.4 P2):
 *   - 默认 label 取自 t('skipLink.label'); props.label 作为 override.
 *   - 保留 data-testid="skip-link" 兼容 e2e (T18-E07).
 *
 * 责任:
 *   - 提供 "跳到主内容" 链接, Tab 1 聚焦时显示, Enter 跳转 #main-content.
 *   - 默认隐藏 (视觉上); 聚焦后显示.
 *   - 不影响键盘焦点序列外的鼠标用户.
 *
 * 纪律:
 *   - 单一组件; 不调 IPC.
 *   - 跳过的目标 id 默认 'main-content'; 若 Reader 已设置, 复用之.
 */
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';

export interface SkipLinkProps {
  /** 跳转目标元素的 id. 默认 'main-content'. */
  targetId?: string;
  /** 链接文案 override; 默认从 t('skipLink.label') 取值. */
  label?: string;
}

export function SkipLink({
  targetId = 'main-content',
  label,
}: SkipLinkProps): JSX.Element {
  const { t } = useTranslation();
  const resolved = label ?? t('skipLink.label');
  return (
    <a
      href={`#${targetId}`}
      data-testid="skip-link"
      className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded-md focus:border focus:border-accent focus:bg-bg focus:px-3 focus:py-1.5 focus:text-sm focus:text-fg"
    >
      {resolved}
    </a>
  );
}

export default SkipLink;
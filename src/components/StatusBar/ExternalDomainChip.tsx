/**
 * ExternalDomainChip — T07 状态栏右侧外链域反馈 (FR-16 / AC-16-1..5).
 *
 * 设计依据: docs/design/compiled.md §3.6.1.
 *
 * 责任:
 *   - 订阅 useInlineStore.lastExternal;
 *   - 显示 "🔗 {host}"; host 空时整段隐藏;
 *   - 5s TTL 到期自动清理.
 *   - 状态栏高度固定, 不触发阅读区 reflow (AC-16-5).
 */
import { useEffect } from 'react';

import { INLINE_TTL_MS, useInlineStore } from '../../stores/inlineStore';

const TICK_MS = 500;

export function ExternalDomainChip(): JSX.Element | null {
  const lastExternal = useInlineStore((s) => s.lastExternal);
  const clearExternalIfStale = useInlineStore((s) => s.clearExternalIfStale);

  // 周期轮询清理 (避免跨组件写时钟); 500ms 一次, 状态栏级别 reflow 可忽略.
  useEffect(() => {
    if (!lastExternal) return;
    const timer = setInterval(() => {
      clearExternalIfStale(Date.now());
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [lastExternal, clearExternalIfStale]);

  // 兜底: 直接根据 ts + TTL 判断显示, 即使 effect 周期略晚, 也保持正确视觉.
  if (!lastExternal) return null;
  if (Date.now() - lastExternal.ts > INLINE_TTL_MS) return null;
  if (!lastExternal.host) return null;

  return (
    <span
      data-testid="external-domain-chip"
      data-host={lastExternal.host}
      className="kite-external-chip"
      title={lastExternal.url}
    >
      <span aria-hidden="true">🔗</span>
      <span>{lastExternal.host}</span>
    </span>
  );
}

export default ExternalDomainChip;
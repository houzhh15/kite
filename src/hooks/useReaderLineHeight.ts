/**
 * useReaderLineHeight — T12 订阅行高档位 → 写入 --reader-line-height (设计 §3.6.5).
 *
 * 责任:
 *   - 订阅 prefStore.prefs.lineHeight (1.4 | 1.6 | 1.8).
 *   - 副作用: root.style.setProperty('--reader-line-height', String(value)).
 *
 * 纪律:
 *   - 不在 CSS 直接用 px, 行为相对值; 由 prose-kite 类通过 var(--reader-line-height) 引用.
 *   - 不调 IPC.
 */
import { useEffect } from 'react';

import { usePrefStore } from '../stores/prefStore';

export function useReaderLineHeight(): number {
  const lineHeight = usePrefStore((s) => s.prefs.lineHeight);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.style.setProperty('--reader-line-height', String(lineHeight));
    root.style.setProperty('--kite-line-height', String(lineHeight));
  }, [lineHeight]);

  return lineHeight;
}

export default useReaderLineHeight;
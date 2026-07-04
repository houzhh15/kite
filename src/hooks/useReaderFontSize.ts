/**
 * useReaderFontSize — T12 订阅字号档位 → 写入根字号 / CSS 变量 (设计 §3.6.4).
 *
 * 责任:
 *   - 订阅 prefStore.prefs.fontSize (number px).
 *   - 副作用: document.documentElement.style.fontSize = `${fontSize}px`.
 *   - 同时写入 --reader-font-size CSS 变量 (与 T04 usePreferences 一致).
 *   - SSR 安全: typeof document === 'undefined' 时不执行.
 *
 * 纪律:
 *   - 仅订阅 fontSize 字段, 不订阅 theme / lineHeight 避免重复 effect.
 *   - 不在 effect 内读 prefs.fontSizeId (那是 UI 档位, 不直接驱动 px).
 *   - 不调 IPC.
 */
import { useEffect } from 'react';

import { usePrefStore } from '../stores/prefStore';

export function useReaderFontSize(): number {
  const fontSize = usePrefStore((s) => s.prefs.fontSize);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.style.fontSize = `${fontSize}px`;
    root.style.setProperty('--reader-font-size', `${fontSize}px`);
    root.style.setProperty('--kite-font-size', `${fontSize}px`);
  }, [fontSize]);

  return fontSize;
}

export default useReaderFontSize;
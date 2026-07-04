/**
 * useReaderCodeFontSize — T12 订阅代码块字号 → 写入 --code-font-size (设计 §3.6.6).
 *
 * 责任:
 *   - 订阅 prefStore.prefs.codeFontSizeId.
 *   - 副作用: root.style.setProperty('--code-font-size', `${px}px`).
 *
 * 纪律:
 *   - 通过 CODE_FONT_SIZE_PX 查表把 token 转 px.
 *   - 不调 IPC.
 */
import { useEffect } from 'react';

import { usePrefStore } from '../stores/prefStore';
import { CODE_FONT_SIZE_PX } from '../lib/reader-prefs';

export function useReaderCodeFontSize(): number {
  const codeFontSizeId = usePrefStore((s) => s.prefs.codeFontSizeId);
  const px = CODE_FONT_SIZE_PX[codeFontSizeId] ?? 14;

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.style.setProperty('--code-font-size', `${px}px`);
  }, [px]);

  return px;
}

export default useReaderCodeFontSize;
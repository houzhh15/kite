/**
 * src/lib/window.ts — 窗口标题设置工具 (F-16 / T06).
 *
 * 设计依据: docs/design/compiled.md §3.5.3 + docs/plan/compiled.md Step 6.
 *
 * 责任:
 *   - 把传入 title 做本地预先 truncate (≤60 字符 + '…'), 减少 IPC payload.
 *   - 委托 tauri.setWindowTitle; 后端规则: 空串 → "KITE"; 非空 → "${title} - KITE".
 *   - 不解析 HTML / 不进 shell; 仅字符串拼接.
 *   - 调用方负责 catch 错误 (NFR-03 不阻塞 UI).
 */

import { setWindowTitle as setWindowTitleIpc } from './tauri';

/** 应用默认名 (空 title 时还原). 与 Rust commands::set_window_title 一致. */
export const APP_NAME = 'KITE';

/** 单标题截断阈值. 长于此值在尾追加 '…'. */
export const TITLE_MAX = 60;

/**
 * 设置窗口标题.
 *
 * @param title 文档标题 (basename 去扩展名); 空串 → 还原默认 KITE.
 * @returns 返回原 IPC Promise; 调用方按需 .catch(console.warn).
 */
export function setWindowTitle(title: string): Promise<void> {
  const t = title ?? '';
  if (t.length === 0) {
    return setWindowTitleIpc('');
  }
  const truncated = t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX)}…` : t;
  return setWindowTitleIpc(truncated);
}

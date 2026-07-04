/**
 * src/lib/errorMessage.ts — AppError → 用户可读消息.
 *
 * 依赖:
 *   - 复用 src/lib/tauri.ts 的 `isAppError` 类型守卫, 不重复实现 (R-04 缓解).
 *   - 返回纯字符串, UI 层可直接渲染.
 *
 * 设计依据: docs/design/compiled.md §3.7.1 + 需求 AC-03-2 / AC-05-2.
 *
 * T18 (FR-02):
 *   - 不再返回中文硬编码字符串; 改为返回 i18n key 路径, 调用方 (组件) 通过
 *     t(key) 渲染. 这样 lib 层不依赖 React 上下文, 也不污染字典.
 *
 * 错误码 → 翻译键映射 (zh-CN.ts / en-US.ts 的 message.* 命名空间):
 *   NOT_FOUND             → message.fileNotFound
 *   TOO_LARGE             → message.fileTooLargeVerbose  (含 >50 MB 说明)
 *   ENCODING              → message.encodingError
 *   IO                    → message.ioError
 *   INVALID_PATH          → message.invalidPath  (历史简短版)
 *   NOT_A_DIRECTORY       → message.notADirectory
 *   PERMISSION_DENIED     → message.permissionDenied
 *   UNKNOWN               → message.unknownError
 *   PAYLOAD_TOO_LARGE     → message.payloadTooLarge
 *   INVALID_TARGET_PATH   → message.invalidTargetPath
 */

import { isAppError, type AppErrorCode } from './tauri';

/** AppErrorCode → i18n key (设计 §3.7.1 表). */
const KEY_BY_CODE: Record<AppErrorCode, string> = {
  NOT_FOUND: 'message.fileNotFound',
  TOO_LARGE: 'message.fileTooLargeVerbose',
  ENCODING: 'message.encodingError',
  IO: 'message.ioError',
  INVALID_PATH: 'message.invalidPath',
  NOT_A_DIRECTORY: 'message.notADirectory',
  PERMISSION_DENIED: 'message.permissionDenied',
  UNKNOWN: 'message.unknownError',
  // T16-P2 (FR-01) 导出 HTML 相关错误码.
  PAYLOAD_TOO_LARGE: 'message.payloadTooLarge',
  INVALID_TARGET_PATH: 'message.invalidTargetPath',
};

/**
 * toErrorMessage — 把 unknown 归一为 i18n key 字符串.
 *
 * 规则:
 *   - AppError → 按 code 取映射 key.
 *   - 其它 (含 plain Error) → "message.unknownError" (避免把内部 exception 字符串泄露给用户).
 *
 * 调用方:
 *   const { t } = useTranslation();
 *   t(toErrorMessage(err));
 */
export function toErrorMessage(err: unknown): string {
  if (isAppError(err)) {
    return KEY_BY_CODE[err.code];
  }
  return 'message.unknownError';
}
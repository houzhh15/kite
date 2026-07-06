/**
 * openInExternalEditor — T24 (F-26) 前端 IPC 包装.
 *
 * 设计依据: docs/design/compiled.md §3.4 + 需求 FR-05 / FR-08 / 设计 §3.4.
 *
 * 责任:
 *   - safeInvoke 包装 'open_in_external_editor' (R-04 IPC 唯一出口纪律).
 *   - 错误码 → i18n 消息映射 (NOT_FOUND / PERMISSION_DENIED / INVALID_PATH 分支 /
 *     UNKNOWN / 兜底).
 *   - IPCUnavailable 静默 (console.debug) 后 rethrow; 调用方 .catch(console.warn) 即可.
 *   - 失败 toast 走 pushToast (与 exportHtml 等其它命令一致模式).
 *
 * 不依赖 React, 不读 useDocStore (路径由调用方从 useDocStore.state.currentPath 取,
 * 这是为把"读 docStore"与"IPC 包装"解耦 — Toolbar 派发事件, App.tsx 读 docStore 调本文件).
 */
import { isAppError, openInExternalEditor as invokeOpen, type ExternalEditor } from './tauri';
import { usePrefStore } from '../stores/prefStore';
import { pushToast } from './toast';
import i18n from '../i18n';

/**
 * mapErrorToMessage — AppError → i18n 字符串.
 *
 * 规则 (设计 §4.1 错误处理表):
 *   - INVALID_PATH("extension not allowed: ...") → externalEditor.error.invalidExtension
 *   - INVALID_PATH(other) → externalEditor.error.invalidPath
 *   - PERMISSION_DENIED → externalEditor.error.permissionDenied
 *   - NOT_FOUND → externalEditor.error.notFound ({{path}})
 *   - UNKNOWN → externalEditor.error.spawnFailed ({{message}})
 *   - 其它 → externalEditor.error.generic ({{message}})
 *
 * 单元测试覆盖 5 个分支 (step-2d).
 */
export function mapErrorToMessage(err: unknown): string {
  if (!isAppError(err)) {
    return i18n.t('externalEditor.error.generic', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
  switch (err.code) {
    case 'NOT_FOUND':
      return i18n.t('externalEditor.error.notFound', { path: err.message });
    case 'PERMISSION_DENIED':
      return i18n.t('externalEditor.error.permissionDenied');
    case 'INVALID_PATH':
      if (err.message.startsWith('extension not allowed')) {
        return i18n.t('externalEditor.error.invalidExtension');
      }
      return i18n.t('externalEditor.error.invalidPath', { message: err.message });
    case 'UNKNOWN':
      return i18n.t('externalEditor.error.spawnFailed', { message: err.message });
    default:
      return i18n.t('externalEditor.error.generic', { message: err.message });
  }
}

/**
 * openInExternalEditor — IPC 包装函数.
 *
 * 契约 (设计 §3.4):
 *   - 输入: path (绝对文件路径字符串). editor 缺省时从 usePrefStore.prefs.externalEditor 读取.
 *   - 成功 → resolve(void); spawn 成功即视为成功, 无返回值.
 *   - 失败 → reject(err), 同时 push 一条 error toast (IPCUnavailableError 除外).
 *   - IPCUnavailableError: console.debug 后 rethrow; 调用方 .catch(console.warn) 静默.
 */
export async function openInExternalEditor(path: string): Promise<void> {
  const editor: ExternalEditor = usePrefStore.getState().prefs.externalEditor;
  try {
    await invokeOpen(path, editor);
  } catch (err) {
    if (err instanceof Error && err.name === 'IPCUnavailableError') {
      console.debug('[openInExternalEditor] not in Tauri runtime, skip');
      throw err; // 让调用方 .catch(console.warn) 静默
    }
    const message = mapErrorToMessage(err);
    pushToast({ kind: 'error', message });
    throw err;
  }
}

export default openInExternalEditor;

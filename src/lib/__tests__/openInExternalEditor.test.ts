/**
 * openInExternalEditor.test.ts — T24 (F-26) mapErrorToMessage + IPC 包装单元测试.
 *
 * 设计依据: docs/design/compiled.md §3.4 / §4.1 + 需求 AC-04-1~6, AC-06-1~3.
 *
 * 覆盖:
 *   - mapErrorToMessage 5 个 AppError code 分支 + 兜底分支 (AC-04-5/6).
 *   - openInExternalEditor 调用 safeInvoke('open_in_external_editor', { path, editor })
 *     并把 editor 从 usePrefStore.getState().prefs.externalEditor 取 (AC-03-1).
 *   - IPCUnavailableError: console.debug + rethrow (不 pushToast, AC-04-2).
 *   - 其它 AppError: pushToast + rethrow (AC-04-3).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- mocks 必须在 import 之前 ---
vi.mock('../toast', () => ({
  pushToast: vi.fn(),
}));
import type * as TauriModule from '../tauri';

vi.mock('../tauri', async () => {
  // 构造一个真实的 isAppError 实现 (与 src/lib/tauri.ts 同款).
  const actual: typeof TauriModule = await vi.importActual('../tauri');
  return {
    ...actual,
    openInExternalEditor: vi.fn(),
  };
});
vi.mock('../../i18n', () => ({
  default: {
    t: (key: string, opts?: Record<string, unknown>) => {
      // 测试时返回固定格式: `${key}::${JSON.stringify(opts || {})}`.
      return `${key}::${JSON.stringify(opts || {})}`;
    },
  },
}));

import { openInExternalEditor as invokeOpen } from '../tauri';
import { pushToast } from '../toast';
import { usePrefStore } from '../../stores/prefStore';
import {
  mapErrorToMessage,
  openInExternalEditor,
} from '../openInExternalEditor';

interface AppErrorLike {
  code: 'NOT_FOUND' | 'PERMISSION_DENIED' | 'INVALID_PATH' | 'UNKNOWN' | 'IO' | string;
  message: string;
  name: string;
}

function makeAppError(
  code: AppErrorLike['code'],
  message: string,
): AppErrorLike {
  return { code, message, name: 'AppError' };
}

describe('openInExternalEditor (T24 F-26)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePrefStore.setState((s) => ({
      prefs: { ...s.prefs, externalEditor: 'system', externalEditorCustomCmd: '',
        vaultRootMode: 'follow-current',
        vaultRootCustom: null },
      hydrated: true,
      loaded: true,
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---- mapErrorToMessage 5+1 个分支 ----

  describe('mapErrorToMessage', () => {
    it('NOT_FOUND → externalEditor.error.notFound with path', () => {
      const err = makeAppError('NOT_FOUND', '/tmp/missing.md');
      const msg = mapErrorToMessage(err);
      expect(msg).toContain('externalEditor.error.notFound');
      expect(msg).toContain('/tmp/missing.md');
    });

    it('PERMISSION_DENIED → externalEditor.error.permissionDenied', () => {
      const err = makeAppError('PERMISSION_DENIED', 'path traversal blocked');
      const msg = mapErrorToMessage(err);
      expect(msg).toContain('externalEditor.error.permissionDenied');
    });

    it('INVALID_PATH "extension not allowed: <ext>" → externalEditor.error.invalidExtension', () => {
      const err = makeAppError('INVALID_PATH', 'extension not allowed: exe');
      const msg = mapErrorToMessage(err);
      expect(msg).toContain('externalEditor.error.invalidExtension');
    });

    it('INVALID_PATH (其它) → externalEditor.error.invalidPath with message', () => {
      const err = makeAppError('INVALID_PATH', 'not a regular file');
      const msg = mapErrorToMessage(err);
      expect(msg).toContain('externalEditor.error.invalidPath');
      expect(msg).toContain('not a regular file');
    });

    it('UNKNOWN → externalEditor.error.spawnFailed with message', () => {
      const err = makeAppError('UNKNOWN', 'spawn failed: No such file or directory');
      const msg = mapErrorToMessage(err);
      expect(msg).toContain('externalEditor.error.spawnFailed');
      expect(msg).toContain('No such file or directory');
    });

    it('unknown error shape → externalEditor.error.generic (兜底)', () => {
      const msg = mapErrorToMessage(new Error('totally unexpected'));
      expect(msg).toContain('externalEditor.error.generic');
      expect(msg).toContain('totally unexpected');
    });
  });

  // ---- openInExternalEditor IPC 包装 ----

  it('success: calls safeInvoke with path + editor from prefStore', async () => {
    usePrefStore.getState().setExternalEditor('cursor');
    vi.mocked(invokeOpen).mockResolvedValueOnce(undefined);

    await openInExternalEditor('/tmp/notes.md');

    expect(invokeOpen).toHaveBeenCalledTimes(1);
    expect(invokeOpen).toHaveBeenCalledWith('/tmp/notes.md', 'cursor');
    expect(pushToast).not.toHaveBeenCalled();
  });

  it('success: uses default "system" when prefStore holds "system"', async () => {
    vi.mocked(invokeOpen).mockResolvedValueOnce(undefined);

    await openInExternalEditor('/tmp/notes.md');

    expect(invokeOpen).toHaveBeenCalledWith('/tmp/notes.md', 'system');
  });

  it('IPCUnavailableError: console.debug + rethrow + 不 pushToast (AC-04-2)', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const err = new Error('IPC unavailable');
    err.name = 'IPCUnavailableError';
    vi.mocked(invokeOpen).mockRejectedValueOnce(err);

    await expect(openInExternalEditor('/tmp/notes.md')).rejects.toBe(err);
    expect(debug).toHaveBeenCalled();
    expect(pushToast).not.toHaveBeenCalled();
  });

  it('AppError NOT_FOUND: pushToast(error) + rethrow (AC-04-3)', async () => {
    const err = makeAppError('NOT_FOUND', '/tmp/gone.md');
    vi.mocked(invokeOpen).mockRejectedValueOnce(err);

    await expect(openInExternalEditor('/tmp/gone.md')).rejects.toBe(err);
    expect(pushToast).toHaveBeenCalledTimes(1);
    expect(pushToast).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'error',
        message: expect.stringContaining('externalEditor.error.notFound'),
      }),
    );
  });

  it('AppError INVALID_PATH "extension not allowed": invalidExtension toast', async () => {
    const err = makeAppError('INVALID_PATH', 'extension not allowed: sh');
    vi.mocked(invokeOpen).mockRejectedValueOnce(err);

    await expect(openInExternalEditor('/tmp/script.sh')).rejects.toBe(err);
    expect(pushToast).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'error',
        message: expect.stringContaining('externalEditor.error.invalidExtension'),
      }),
    );
  });

  it('AppError UNKNOWN spawn failure: spawnFailed toast', async () => {
    const err = makeAppError('UNKNOWN', 'spawn failed: No such file or directory (os error 2)');
    vi.mocked(invokeOpen).mockRejectedValueOnce(err);

    await expect(openInExternalEditor('/tmp/notes.md')).rejects.toBe(err);
    expect(pushToast).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'error',
        message: expect.stringContaining('externalEditor.error.spawnFailed'),
      }),
    );
  });
});

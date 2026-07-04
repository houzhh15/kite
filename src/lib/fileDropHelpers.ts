/**
 * fileDropHelpers — useFileDrop 用的纯函数 / 错误文案 (F-02 / 设计 §3.3 接口 7).
 * 设计依据: docs/design/compiled.md §3.3 + docs/plan/compiled.md Step 2.
 *
 * T18 (FR-02):
 *   - 错误码 → i18n key 映射. 返回 key 字符串, 调用方 useTranslation() 后 t(key).
 *   - 这样 lib 层不依赖 React 上下文, 也不污染字典.
 *   - UNSUPPORTED_EXT 文案占位符 {{accepted}} 由调用方注入 (useFileDrop 通过
 *     describeAcceptedExts() 传入), 保持 lib 纯函数.
 *
 * 纪律: 不持有状态, 不调用 IPC, 不修改任何 store.
 */

export interface DropErrorCtx { basename: string; ext: string }

const DROP_ERROR_KEYS: Record<string, string> = {
  NOT_FOUND: 'message.dropNotFound',
  TOO_LARGE: 'message.dropTooLarge',
  ENCODING: 'message.dropEncoding',
  IO: 'message.dropIo',
  INVALID_PATH: 'message.dropInvalidPath',
  UNKNOWN: 'message.dropUnknown',
  EMPTY_PATHS: 'message.dropEmptyPaths',
  UNSUPPORTED_EXT: 'message.dropUnsupportedExt',
  PAYLOAD: 'message.dropPayload',
};

/**
 * formatDropError — 把错误码 + 上下文归一为 i18n key.
 *
 * 调用方:
 *   const { t } = useTranslation();
 *   const key = formatDropError(code, { basename, ext });
 *   // 若 key 含占位符, 调用 t(key, { basename, ext, accepted: describeAcceptedExts() })
 *   t(key, { basename, ext, accepted: describeAcceptedExts() });
 *
 * 注意: UNSUPPORTED_EXT 含 {{ext}} / {{accepted}} 占位符; NOT_FOUND / IO 含 {{basename}}.
 */
export function formatDropError(code: string, _ctx: DropErrorCtx): string {
  return DROP_ERROR_KEYS[code] ?? 'message.dropUnknown';
}

export function basename(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i >= 0 ? p.slice(i + 1) : p;
}

export function extractExt(p: string): string {
  const last = basename(p);
  const dot = last.lastIndexOf('.');
  if (dot <= 0) return '';
  return last.slice(dot).toLowerCase();
}

export function firstUnsupportedExt(paths: readonly string[]): string {
  for (const p of paths) {
    if (typeof p !== 'string' || p.length === 0) continue;
    if (p.startsWith('file://')) continue;
    const e = extractExt(p);
    if (e && e !== '.md' && e !== '.markdown' && e !== '.mdx') return e;
  }
  return '';
}

export function isAppErrorCode(err: unknown): err is { code: string } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as { code: unknown }).code === 'string' &&
    (err as { code: string }).code in DROP_ERROR_KEYS
  );
}
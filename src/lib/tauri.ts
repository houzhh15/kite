/**
 * lib/tauri.ts — KITE 唯一 IPC 出口
 *
 * 设计纪律 (R-04 缓解 / FR-04 / 设计 §3.2.3):
 *   1. 这是前端访问 Rust commands 的**唯一**出口.
 *      任何其它源码 (src/**) 都禁止直接
 *      `import { invoke } from '@tauri-apps/api/core'`.
 *   2. 类型 RecentItem / Preferences / AppError 与
 *      src-tauri/src/commands.rs 严格一一对应, 命名保持 camelCase.
 *   3. 修改顺序硬性:
 *      **先改 commands.rs → 再改本文件 → 再改 docs/design/compiled.md §3.2**
 *      反向或在其它地方编辑都会破坏契约, 需要 PR review 拦截.
 *   4. 在 CSP `script-src 'self'` 下, 本文件作为模块被 Vite 打包到
 *      /assets/index-*.js, 不依赖任何 inline script.
 *
 * 在 T01 阶段, 8 个方法都已落地但调用会触发 Rust 侧 unimplemented!() —
 * 这是有意为之, 让消费者可以提前写 IPC 调用代码 (AC-04-1/2).
 */

import { invoke } from '@tauri-apps/api/core'; // eslint-disable-line no-restricted-imports -- single IPC exit
import { isTauri } from './env';

/**
 * safeInvoke — IPC 入口护栏 (Tauri 环境检测).
 *
 * 单一来源: src/lib/env.ts::isTauri(). 浏览器场景下 (无
 * window.__TAURI_INTERNALS__) 所有 IPC 统一 reject 一个
 * IPCUnavailable 错误, 顶层 .catch(console.warn) 消化,
 * 避免 React 树因为 undefined.invoke 抛出同步错误.
 *
 * 设计: 这是 lib/tauri.ts **内部**的私有包装, 不导出给业务层;
 * 业务层继续通过具名函数 (getRecentFiles / setWindowTitle 等)
 * 调用, 保持 R-04 "IPC 唯一出口" 的纪律.
 */
class IPCUnavailableError extends Error {
  constructor(cmd: string) {
    super(`IPC unavailable (not in Tauri): ${cmd}`);
    this.name = 'IPCUnavailableError';
  }
}

function safeInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    return Promise.reject(new IPCUnavailableError(cmd));
  }
  return invoke<T>(cmd, args);
}

// ---- 类型 (与 commands.rs serde rename_all = "camelCase" 严格对齐) ----

/** RecentItem — 最近文件条目. */
export interface RecentItem {
  /** 绝对文件路径. */
  path: string;
  /** 文档标题 (取自首行 / 用户重命名). */
  title: string;
  /** ISO8601 时间戳, 例 "2026-01-30T12:34:56Z". */
  lastOpenedAt: string;
}

/**
 * T25 (F-27) — 最近目录条目.
 *
 * 字段与 src-tauri/src/services/recent_dirs.rs::RecentDir 严格一一对应
 * (serde rename_all = "camelCase").
 *
 *   - path: 目录绝对路径 (来自 dialog 显式选择, 已被 Rust 端 validate_path 校验).
 *   - lastOpenedAt: ISO8601 UTC 时间戳.
 *   - displayName: Rust 端取 basename 写入, 前端只读.
 */
export interface RecentDir {
  /** 目录绝对路径. */
  path: string;
  /** ISO8601 时间戳, 例 "2026-07-06T10:00:00Z". */
  lastOpenedAt: string;
  /** 目录 basename (Rust 端标准化). */
  displayName: string;
}

/** Preferences — 用户偏好. */
export interface Preferences {
  /** 'light' | 'dark' | 'system'. T03 step-03: 由 string 收紧为三档 union,
   *  与 prefStore / theme-types 同步; 字段名保持 'theme' 便于 T04 持久化对接. */
  theme?: 'light' | 'dark' | 'system';
  /** 正文字号 px (T04: 12..24, 默认 16). */
  fontSize?: number;
  /** 行高 (T04: 1.4 | 1.6 | 1.8, 默认 1.6). */
  lineHeight?: number;
  /** 代码块主题: 'github' | 'monokai' | ... */
  codeBlockTheme?: string;
  /** T15 (FR-05): 界面语言. 值域 'zh-CN' | 'en-US'. 缺省/非法回退 zh-CN. */
  language?: 'zh-CN' | 'en-US';
  /** T17-P2 (F-21): mermaid 图表渲染开关. 缺省/非法回退 false. */
  mermaidEnabled?: boolean;
  /** T17-P2 (F-22): KaTeX 公式渲染开关. 缺省/非法回退 false. */
  katexEnabled?: boolean;
  /** T24 (F-26): 外部编辑器预设 (缺省 'system'). */
  externalEditor?: ExternalEditor;
  /** T24 (F-26): 自定义编辑器命令模板 (≤256 字符). */
  externalEditorCustomCmd?: string;
}

/**
 * T24 (F-26) — 外部编辑器预设 union.
 *
 * 与 src/i18n 字典 `externalEditor.settings.<id>` 标签对应; 8 档:
 *   - system    : 系统默认 Markdown 编辑器 (跨平台 spawn).
 *   - code      : VSCode (`code {{path}}`).
 *   - cursor    : Cursor (`cursor {{path}}`).
 *   - subl      : Sublime Text (`subl {{path}}`).
 *   - mate      : TextMate (`mate {{path}}`).
 *   - notepad++ : Notepad++ (仅 Windows).
 *   - typora    : Typora (`typora {{path}}`).
 *   - custom    : 自定义 (externalEditorCustomCmd 模板).
 *
 * Rust 端对未知字符串兜底 'system' (设计 §3.1.3); 前端 setter 非法值 console.warn + 忽略.
 */
export type ExternalEditor =
  | 'system'
  | 'code'
  | 'cursor'
  | 'subl'
  | 'mate'
  | 'notepad++'
  | 'typora'
  | 'custom';

/**
 * ProgressEntry — 单文档阅读进度 (T11, 设计 §3.2.2 / §3.6.10).
 *
 * 字段约束 (sanitize):
 *   - pct ∈ [0,100], 整数百分比.
 *   - scrollTop ≥ 0, 像素.
 *   - updatedAt: Unix seconds (UTC).
 */
export interface ProgressEntry {
  pct: number;
  scrollTop: number;
  updatedAt: number;
}

/**
 * ProgressState — `progress` 顶层键值 (T11, 设计 §3.2.2 / §3.6.10).
 *
 * 键空间: kite.store.json["progress"] = ProgressState.
 * 与 preferences / recents 同级不混用 (架构 §6 T11 演进记录).
 */
export interface ProgressState {
  /** 当前打开文档的绝对路径, 或 null. */
  lastPath: string | null;
  /** 路径 → 进度. */
  perFile: Record<string, ProgressEntry>;
  /** 用户是否已关闭过快捷键速查 (FR-12, 缺省 false). */
  seenShortcutsHint?: boolean;
}

/**
 * AppErrorCode — Rust AppError.code() 返回值 union.
 *
 * Rust 侧用 SCREAMING_SNAKE_CASE 序列化, 顺序固定, 不可新增未登记值
 * (check-contract.mjs 会做静态校验).
 */
export type AppErrorCode =
  | 'NOT_FOUND'
  | 'TOO_LARGE'
  | 'ENCODING'
  | 'IO'
  | 'INVALID_PATH'
  | 'NOT_A_DIRECTORY'
  | 'PERMISSION_DENIED'
  | 'UNKNOWN'
  // T16-P2 (FR-01 导出 HTML) 新增错误码, 与 src-tauri/src/services/exporter.rs 对应.
  | 'PAYLOAD_TOO_LARGE'
  | 'INVALID_TARGET_PATH';

/** AppError — Rust 侧 AppError 序列化后的形状 (FR-05). */
export interface AppError {
  code: AppErrorCode;
  message: string;
}

/** 类型 guard: 判断 unknown 是否为 AppError. */
export function isAppError(err: unknown): err is AppError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    'message' in err &&
    typeof (err as { code: unknown }).code === 'string' &&
    typeof (err as { message: unknown }).message === 'string'
  );
}

/**
 * DirEntry — T15 (FR-02 / FR-01) list_dir 返回条目.
 * 严格 camelCase, 与 commands::DirEntry 序列化形状一致.
 */
export interface DirEntry {
  path: string;
  name: string;
  isDir: boolean;
}

// ---- 9 个 IPC 方法 ----
//
// 名称与 commands.rs 函数名 snake_case 一一对应:
//   read_markdown_file  ↔ readMarkdownFile
//   get_recent_files    ↔ getRecentFiles
//   add_recent_file     ↔ addRecentFile
//   clear_recent_files  ↔ clearRecentFiles
//   load_preferences    ↔ loadPreferences
//   save_preferences    ↔ savePreferences
//   open_external_url   ↔ openExternalUrl
//   resolve_image_path  ↔ resolveImagePath
//   set_window_title    ↔ setWindowTitle (T04 新增, FR-07)

/**
 * readMarkdownFile — F-01/F-02 (AC-04-1)
 *
 * 读 markdown 文件, 返回原始 utf-8 文本.
 *
 * 契约:
 *   - 成功 → Ok(string) 文件原文
 *   - 失败 → reject(AppError), code ∈ {NOT_FOUND, TOO_LARGE, ENCODING, IO, INVALID_PATH}
 *
 * @param path 文件绝对路径
 */
export function readMarkdownFile(path: string): Promise<string> {
  return safeInvoke<string>('read_markdown_file', { path });
}

/**
 * pathExists — T28 (F-46 / FR-03) 增量.
 *
 * 轻量级文件存在性探测, 专供 wikilink 多层 vaultRoot 探测使用.
 *
 * 契约:
 *   - 输入 path, 输出 boolean. 任何错误 (NotFound / PermissionDenied / InvalidPath 等)
 *     一律返回 false (NFR-S-01 静默拒绝, 防探测).
 *   - 成功 → Ok(true|false), true=文件存在且为常规文件
 *   - 当前实现永不 reject (后端 exists 内部静默).
 *
 * 区别于 readMarkdownFile:
 *   - 不读文件内容, 不校验大小, 不校验扩展名白名单, 不做 UTF-8 校验.
 *   - 性能: 单次 fs::metadata 即可, ~4-10ms, 远低于 readMarkdownFile.
 *
 * @param path 文件绝对路径
 */
export function pathExists(path: string): Promise<boolean> {
  return safeInvoke<boolean>('path_exists', { path });
}

/**
 * getRecentFiles — F-03 (AC-07-1)
 *
 * 取最近文件列表 (按 lastOpenedAt 倒序, 长度 0..8).
 */
export function getRecentFiles(): Promise<RecentItem[]> {
  return safeInvoke<RecentItem[]>('get_recent_files');
}

/**
 * addRecentFile — F-03
 *
 * 推入一条最近文件记录 (去重 + 截断到 8 条, 由 Rust 侧保证).
 */
export function addRecentFile(path: string, title: string): Promise<void> {
  return safeInvoke<void>('add_recent_file', { path, title });
}

/**
 * clearRecentFiles — F-03
 *
 * 清空最近文件列表.
 */
export function clearRecentFiles(): Promise<void> {
  return safeInvoke<void>('clear_recent_files');
}

/**
 * loadPreferences — F-33
 *
 * 加载用户偏好, 首次启动返回 defaults.
 */
export function loadPreferences(): Promise<Preferences> {
  return safeInvoke<Preferences>('load_preferences');
}

/**
 * savePreferences — F-33
 *
 * 写用户偏好, 调用者负责合并默认值.
 */
export function savePreferences(prefs: Preferences): Promise<void> {
  return safeInvoke<void>('save_preferences', { prefs });
}

/**
 * openExternalUrl — F-15
 *
 * 打开外部 http/https 链接. Rust 侧对 url 做协议白名单, 任何非 http(s)
 * 都会 reject INVALID_PATH (F-32 / NFR-SEC-04).
 */
export function openExternalUrl(url: string): Promise<void> {
  return safeInvoke<void>('open_external_url', { url });
}

/**
 * openInExternalEditor — T24 (F-26) 在外部编辑器中打开当前文档.
 *
 * 通过 Rust 命令 `open_in_external_editor(path, editor)` 唤起系统 Markdown 编辑器.
 * Rust 端对 path 做五重校验 (空 / 扩展名白名单 / `..` 段 / 存在 / is_file) 与
 * editor 命令拼装 (system / 7 预设 / custom 模板 {{path}} 占位符), 跨平台 spawn.
 *
 * 契约:
 *   - path 为当前已加载 Markdown 绝对路径 (来自 useDocStore.state.currentPath,
 *     已经过 read_markdown_file 校验).
 *   - editor 缺省时 Rust 从 preferences.externalEditor 读取.
 *   - 成功 → resolve(void); 失败 → reject(AppError), code ∈
 *     {NOT_FOUND, PERMISSION_DENIED, INVALID_PATH, UNKNOWN, IO}.
 *
 * @param path 文件绝对路径.
 * @param editor 目标编辑器预设; 缺省时 Rust 从 preferences 读.
 */
export function openInExternalEditor(
  path: string,
  editor?: ExternalEditor,
): Promise<void> {
  return safeInvoke<void>('open_in_external_editor', { path, editor });
}

/**
 * resolveImagePath — F-15 / T08 step-5 (v2)
 *
 * 解析 Markdown 内嵌图片相对路径, 返回可用于 <img src> 的 URL.
 *
 * 契约 (T08 升级, 设计 §3.2.1 / §3.2.2):
 *   - rel 以 http(s):// / data: / asset: 开头 → **前端短路**, Promise.resolve(rel)
 *     (AC-4-2 + NFR-P-4 缓存命中路径)
 *   - rel 为相对路径 + base 不空 → invoke('resolve_image_path', { base, rel })
 *     Rust 端解析后返回 `data:<mime>;base64,...` 字符串
 *   - 文件不存在 → reject(NOT_FOUND) → UI broken-image 占位
 *   - 路径越界 (rel 含 ../ 跳出 base 所在目录) → reject(INVALID_PATH) (NFR-S-1)
 *   - 文件大小 ≥ 10 MB → reject(TOO_LARGE) (AC-4-4)
 *   - 扩展名不在白名单 → reject(INVALID_PATH)
 *   - base 为空 → 前端直接 reject, 不触发 IPC
 */
export function resolveImagePath(base: string, rel: string): Promise<string> {
  // 1) 前端短路: 协议类 URL 不走 IPC.
  if (
    rel.startsWith('http://') ||
    rel.startsWith('https://') ||
    rel.startsWith('data:') ||
    rel.startsWith('asset:')
  ) {
    return Promise.resolve(rel);
  }
  // 2) base 为空 → 前端 guard, 不发 IPC (AC-4-3 失败路径).
  if (!base || base.trim().length === 0) {
    return Promise.reject(new Error('base_path is empty'));
  }
  return safeInvoke<string>('resolve_image_path', { base, rel });
}

/**
 * setWindowTitle — F-16 (T04 新增, AC-FR07-1/2/3 / AC-NFR05-1).
 *
 * 设置窗口标题栏. 后端规则: title 非空 → `{title} - KITE`; 空 → `KITE`.
 * 不会解析 HTML / 不进 shell, 仅字符串拼接.
 *
 * @param title 文档标题 (basename 去扩展名); 空串表示还原默认标题.
 */
export function setWindowTitle(title: string): Promise<void> {
  return safeInvoke<void>('set_window_title', { title });
}

/**
 * loadProgress — T11 (FR-09 / FR-10 / FR-12, 设计 §3.6.7).
 *
 * 读 store key "progress"; 文件不存在 → 返回默认 ProgressState.
 * JSON 损坏 → reject AppError { code: "ENCODING" }, 由前端 resetCorrupted 处理.
 *
 * @returns 完整的 ProgressState (含 lastPath / perFile / seenShortcutsHint).
 */
export function loadProgress(): Promise<ProgressState> {
  return safeInvoke<ProgressState>('load_progress');
}

/**
 * saveProgress — T11 (FR-09 / FR-11 / FR-12, 设计 §3.6.8).
 *
 * 整体覆盖写 store key "progress". 写入前 Rust 端 sanitize.
 *
 * @param payload 完整的 ProgressState; 缺字段默认空.
 */
export function saveProgress(payload: ProgressState): Promise<void> {
  return safeInvoke<void>('save_progress', { payload });
}

/**
 * listDir — T15 (FR-02 / FR-01).
 *
 * 列出指定目录下受支持的 Markdown 条目 (设计 §3.2):
 *   - 文件按扩展名 .md/.markdown/.mdx 过滤 (大小写不敏感).
 *   - 目录保留「含至少一个 md 子项」的.
 *   - 排序: 目录优先 + 字典序.
 *
 * 错误约定:
 *   - NOT_FOUND: 路径不存在.
 *   - NOT_A_DIRECTORY: 路径指向文件.
 *   - PERMISSION_DENIED: 含 `..` 段或不在授权 scope.
 *   - IO: 其它 IO 失败.
 *
 * @param path 目录绝对路径.
 */
export function listDir(path: string): Promise<DirEntry[]> {
  return safeInvoke<DirEntry[]>('list_dir', { path });
}

/**
 * setLanguage — T15 (FR-05) 无 IPC 命令包装 (usePreferences 仍走 save_preferences).
 *
 * 这里保留占位: 实际语言切换走 prefStore.setLanguage + i18n.changeLanguage,
 * 持久化由 usePreferences hook (debounce 300ms) 调 save_preferences 一并写入.
 * 提供 setLanguage 仅为调用面统一.
 */
export function setLanguage(_lng: 'zh-CN' | 'en-US'): void {
  // no-op: 实现在 prefStore.setLanguage().
}

/* -------------------------------------------------------------------------- */
/* T16-P2 (FR-01 导出 HTML) — 类型与 invoke 包装                              */
/* -------------------------------------------------------------------------- */

/**
 * ExportFormat — 导出目标格式 (设计 §3.1).
 *
 * 范围: 'html' | 'pdf'.
 * 当前实现仅 HTML 走 Rust 命令; PDF 走前端 window.print() (FR-02).
 */
export type ExportFormat = 'html' | 'pdf';

/**
 * ExportHtmlArgs — 导出 HTML 的 IPC 参数 (设计 §3.1 / §3.2.3).
 *
 * 字段语义:
 *   - content:  已经拼装好的 UTF-8 HTML 字符串 (含 <!DOCTYPE> / <article>).
 *   - targetPath: 经 tauri-plugin-dialog.save() 确认的绝对路径.
 *
 * 与 Rust 命令 `export_html(content, target_path)` 严格一一对应
 * (Tauri 默认按 camelCase 反序列化).
 */
export interface ExportHtmlArgs {
  content: string;
  targetPath: string;
}

/**
 * ExportResult — 导出结果 (FR-01 / NFR-P-01).
 */
export interface ExportResult {
  ok: true;
  path: string;
  bytes: number;
  durationMs: number;
}

/**
 * FullscreenState — 全屏状态 (FR-03 / AC-03-5).
 *
 * 字段:
 *   - isFullscreen: 当前是否全屏; **不持久化**, 每次启动恢复 false.
 *   - since: 进入全屏的时间戳; 内存态, 退出后置 null.
 */
export interface FullscreenState {
  isFullscreen: boolean;
  since: number | null;
}

/**
 * SetFullscreenResult — T20+ (T19 修复) Rust `set_fullscreen` 命令返回值.
 *
 * Rust 端在执行 `window.set_fullscreen(req)` 之后, 回读 `window.is_fullscreen()`
 * 作为 `actual`, 一并返回. JS 端据此校正 React state, 并在 requested ≠ actual 时
 * 显式提示用户 (Rust 不抛错 ≠ 平台真正生效; macOS 失焦时 `set_fullscreen` 静默
 * no-op 没有任何错误信息).
 */
export interface SetFullscreenResult {
  requested: boolean;
  actual: boolean;
}

/**
 * setFullscreen — T16-P2 (FR-03) 调 Rust 命令 `set_fullscreen`.
 *
 * 与 Tauri 命令 `set_fullscreen(fullscreen: bool)` 一一对应, 改变原生
 * WebView 所在窗口的全屏状态. 因为这是窗口级别 (非 DOM Fullscreen API),
 * 在 Tauri 2 里需要走 `app.get_webview_window().set_fullscreen()` 才会真正生效;
 * 若直接调 `document.documentElement.requestFullscreen()` 在 Tauri WebView
 * 中通常静默失败 (无用户手势所需 top-level browsing context).
 *
 * 契约:
 *   - 成功 → resolve(SetFullscreenResult) — `actual` 即窗口的真实状态.
 *   - 失败 → reject(AppError), code ∈ {IO, UNKNOWN, ...}.
 *
 * @param fullscreen 是否进入全屏; false 表示退出全屏.
 */
export function setFullscreen(fullscreen: boolean): Promise<SetFullscreenResult> {
  // IPC 出口 (R-04): 走 safeInvoke 而不是直连 @tauri-apps/api/window, 与
  // commands.rs 一一对齐, 允许在浏览器模式下走 reject 而不是抛同步错.
  // Rust 侧 (commands.rs) 也提供 `set_fullscreen` 命令, 内部等价于调用
  // `app.get_webview_window().set_fullscreen(fullscreen)` —— Rust 路径可
  // 跨平台工作, 不依赖前端运行时 (Web vs Tauri) 分支.
  return safeInvoke<SetFullscreenResult>('set_fullscreen', { fullscreen });
}

/**
 * exportHtml — T16-P2 (FR-01) 调 Rust 命令 `export_html`.
 *
 * 契约:
 *   - content 长度 ≤ 5 MB 且 targetPath 后缀 .html → resolve(void).
 *   - 错误由 Rust 侧 AppError 序列化后 reject, 形状同 AppError.
 *
 * @param args 见 ExportHtmlArgs.
 */
export function exportHtml(args: ExportHtmlArgs): Promise<void> {
  return safeInvoke<void>('export_html', {
    content: args.content,
    targetPath: args.targetPath,
  });
}

/**
 * getPendingOpenFile — macOS "open with KITE" 启动路径拉取.
 *
 * 来源: 在 macOS 上用户用 Finder "打开方式 → KITE" 打开 .md 文件时,
 * Rust 侧 (main.rs + pending_open.rs) 会把路径先 cache 进 PendingOpen 状态,
 * 这条命令让前端 mount 后主动 pull 一次. 返回 string (文件路径) 或 null.
 *
 * 单次消费: Rust 内部 Mutex<Option<PathBuf>> 的 take() 保证读后即清,
 * 防止二次加载.
 *
 * 注意:
 * - 这是 macOS 专属路径; Windows / Linux 上永远返回 null, 不影响启动流程.
 * - 浏览器场景 (非 Tauri 环境): safeInvoke 会 reject 一个 IPCUnavailableError,
 *   顶层 .catch 静默 — 不要让它把启动 UI 喷红.
 */
export function getPendingOpenFile(): Promise<string | null> {
  return safeInvoke<string | null>('get_pending_open_file');
}

/* -------------------------------------------------------------------------- */
/* T25 (F-27) — 最近目录 IPC 包装                                              */
/* -------------------------------------------------------------------------- */

/**
 * getRecentDirs — F-27 (T25 / FR-02 / AC-02-1 / AC-02-5).
 *
 * 取最近目录列表 (按 lastOpenedAt 倒序, 长度 0..8).
 * - 文件不存在 → `[]`
 * - 文件损坏 → `[]` (Rust 端静默兜底)
 * - 当前实现永不 reject.
 */
export function getRecentDirs(): Promise<RecentDir[]> {
  return safeInvoke<RecentDir[]>('get_recent_dirs');
}

/**
 * addRecentDir — F-27 (T25 / FR-02 / AC-02-2 / AC-03-1~5).
 *
 * 推入一条最近目录 (去重 + 置顶 + 截断到 8 条, 由 Rust 侧保证).
 *
 * 错误约定:
 *   - reject(AppError), code='INVALID_PATH' (空 / `..` 段 / Windows 设备名 / UNC).
 *   - reject(AppError), code='IO' (持久化失败).
 *
 * 注意: 仅当 path 来自用户通过 dialog 显式选择时才调用 (NFR-S-01);
 * 来自 RecentDirList 点击的 path **不** 应再调此方法 (避免重复写入).
 */
export function addRecentDir(path: string): Promise<void> {
  return safeInvoke<void>('add_recent_dir', { path });
}

/**
 * removeRecentDir — F-27 (T25 / FR-02 / AC-03-6 / AC-04-7).
 *
 * 从历史中移除一条目录.
 * - 不存在的 path → 幂等 Ok.
 * - 错误: INVALID_PATH | IO.
 */
export function removeRecentDir(path: string): Promise<void> {
  return safeInvoke<void>('remove_recent_dir', { path });
}

/**
 * clearRecentDirs — F-27 (T25 / FR-02 / AC-03-7 / AC-04-8).
 *
 * 清空所有最近目录. 幂等; 错误 → AppError::Io.
 */
export function clearRecentDirs(): Promise<void> {
  return safeInvoke<void>('clear_recent_dirs');
}

/**
 * copyFileToClipboard — T29 (R-35 / FR-04).
 *
 * 把指定路径的文件写入系统剪贴板, 行为等价 Finder/Explorer 的 Cmd/Ctrl+C.
 * 后端 `commands::copy_file_to_clipboard(path)` 走原生 NSPasteboard (macOS) /
 * CF_HDROP (Windows) / text/uri-list (Linux), 绕过 WebView 沙箱限制.
 *
 * 不能用 Web Clipboard API (navigator.clipboard.write), Tauri WebView 在沙箱
 * 限制下返回 NotAllowedError (macOS WKWebView 已知问题).
 *
 * - Input:  path (绝对路径).
 * - Output: Ok(()), OS 剪贴板已包含文件引用.
 * - Error:
 *   - NOT_FOUND: 文件不存在.
 *   - INVALID_PATH: 不是 regular file.
 *   - IO: 剪贴板写入失败 (clipboard-rs 错误).
 */
export function copyFileToClipboard(path: string): Promise<void> {
  return safeInvoke<void>('copy_file_to_clipboard', { path });
}

/**
 * FileFreshPayload — T26 (R-12 修复) 外部编辑器改回刷新 IPC 返回.
 *
 * 后端 `commands::get_file_fresh(path)` 一次性带回 mtime + content;
 * 前端用 mtime 决定是否需要重新 dispatch OPEN_OK, 避免无谓的
 * 重 render + 滚动位置 / outline / progress 重置.
 *
 * 字段顺序与 camelCase 序列化与 src-tauri/src/services/file_fresh.rs 严格对齐
 * (Rust 侧 #[serde(rename_all = "camelCase")]).
 */
export interface FileFreshPayload {
  /** 自 UNIX 纪元起的秒数 (u64). 0 不会出现 (Rust 侧 mtime 不可读时直接报错). */
  mtime: number;
  /** 完整 UTF-8 内容. */
  content: string;
}

/**
 * getFileFresh — T26 (R-12 修复) IPC 包装.
 *
 * 安全语义:
 *   - safeInvoke 包装, 浏览器环境 reject IPCUnavailableError, 调用方 .catch 静默.
 *   - 错误码 (NOT_FOUND / IO / INVALID_PATH / PERMISSION_DENIED / UNKNOWN) 与
 *     readMarkdownFile / openInExternalEditor 完全一致, 复用同一份 i18n
 *     错误码分支 (msg.* 映射), 不引入新翻译键.
 *
 * 用途:
 *   - useFileChangeReload 在 window.focus / visibilitychange 时拉一次,
 *     对比 lastLoadedMtime, 仅在磁盘比内存新时才 dispatch OPEN_OK.
 *   - Toolbar 手动刷新按钮 (Cmd/Ctrl+R / 按钮点击) 走同一份 IPC.
 */
export function getFileFresh(path: string): Promise<FileFreshPayload> {
  return safeInvoke<FileFreshPayload>('get_file_fresh', { path });
}

/** 默认导出聚合对象 (方便消费者 `import { tauri } from '@/lib/tauri'`). */
export const tauri = {
  readMarkdownFile,
  getRecentFiles,
  addRecentFile,
  clearRecentFiles,
  loadPreferences,
  savePreferences,
  openExternalUrl,
  openInExternalEditor,
  resolveImagePath,
  setWindowTitle,
  loadProgress,
  saveProgress,
  getPendingOpenFile,
  // T25 (F-27): 最近目录 4 个 IPC wrapper.
  getRecentDirs,
  addRecentDir,
  removeRecentDir,
  clearRecentDirs,
  getFileFresh,
  // T29 (R-35): 拷贝文件到系统剪贴板.
  copyFileToClipboard,
};

export default tauri;

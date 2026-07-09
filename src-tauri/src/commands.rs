// src-tauri/src/commands.rs — 13 个 #[tauri::command] 实现
//
// 设计依据: docs/design/compiled.md §3.2 / FR-01 / FR-04 / FR-07.
//
// T04 增量:
//   - load_preferences / save_preferences: 由 T05 占位 → T04 真实实现 (委托 services::preferences).
//   - 新增第 9 个命令 set_window_title (替换原 get_window_title 占位语义).
//   - Preferences DTO 字段: theme / font_size / line_height (T04 锁定).
//
// T06 增量:
//   - get_recent_files / add_recent_file / clear_recent_files:
//     从 T03 占位 unimplemented!() 改为真实委托到 services::recent_files,
//     注入 tauri::State<'_, RecentState> + AppHandle.
//   - RecentItem DTO 保留在 commands.rs 中 (已 camelCase), services 端亦使用
//     同样的字段集合 (lastOpenedAt).
//
// T16-P2 增量 (FR-01):
//   - 第 13 个命令 export_html(content, target_path) -> Result<(), AppError>.
//     签名与架构设计 3.2 / docs/design/compiled.md §3.4.3 一致;
//     内部直接委托 services::exporter::export_html.
//
// 纪律:
//   - 所有错误统一 AppError (R-04 单一来源).
//   - 函数体不使用 unwrap() / panic!() (NFR-RUST-02).
//   - IPC 命名 = snake_case; 前端 tauri.ts 由本文件派生 (scripts/check-contract.mjs 静态校验).

use std::path::PathBuf;

use crate::error::AppError;
use serde::{Deserialize, Serialize};
use tauri::Manager;

// Re-export so commands can name it without full path.
use crate::services::recent_files::{self as recent_svc, RecentItem as ServiceRecentItem};
use crate::services::fs_reader::{self as fs_reader_svc, DirEntry as ServiceDirEntry};

// ----- 数据类型 (设计 §3.2.2) -----

/// RecentItem — 最近文件条目. 在 commands.rs 中独立定义, 与 services 同形.
/// 字段顺序与 camelCase 序列化与前端 `lib/tauri.ts` 中 `RecentItem` 严格对齐.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentItem {
    pub path: String,
    pub title: String,
    pub last_opened_at: String, // ISO8601
}

// From / Into 适配器: services::recent_files::RecentItem <-> commands::RecentItem.
// 两边字段完全一致, 这里通过 TryFrom 模式显式写出便于以后解耦.
impl From<ServiceRecentItem> for RecentItem {
    fn from(it: ServiceRecentItem) -> Self {
        Self {
            path: it.path,
            title: it.title,
            last_opened_at: it.last_opened_at,
        }
    }
}

/// Preferences — 用户偏好 (设计 §3.2.2).
///
/// T04 字段集: theme / font_size / line_height. 严格 DTO, 字段级 fallback 在
/// services::preferences::load 内完成; commands 层只做 serde 通过.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    pub theme: String,
    pub font_size: u8,
    pub line_height: f32,
    /// T15 (FR-05): 语言 ('zh-CN' | 'en-US'). 缺省 'zh-CN'.
    pub language: String,
    /// T24 (F-26): 外部编辑器预设 ('system' | 'code' | 'cursor' | 'subl' |
    ///   'mate' | 'notepad++' | 'typora' | 'custom'). 缺省 'system';
    ///   非枚举值在 services::preferences::load 内回退 'system'.
    pub external_editor: String,
    /// T24 (F-26): 自定义编辑器命令模板. 缺省 '' (≤256 字符).
    /// 长度截断由前端 prefStore.setExternalEditorCustomCmd 保证, Rust 仅做透传.
    pub external_editor_custom_cmd: String,
}

// ---------- 1. read_markdown_file ----------

/// read_markdown_file — F-01/F-02
///
/// - Input:  path (绝对文件路径字符串, 由前端传入)
/// - Output: Ok(String) 文件 UTF-8 内容 / Err(AppError)
/// - Error 约定: NotFound | TooLarge | Encoding | Io | InvalidPath
///   [对应 AC-04-1 / FR-04]
#[tauri::command]
pub async fn read_markdown_file(path: String) -> Result<String, AppError> {
    // T02: 委托 services::markdown_file::read.
    crate::services::markdown_file::read(&PathBuf::from(path)).await
}

// ---------- 1b. path_exists (T28-补充) ----------

/// path_exists — T28 (F-46 / FR-03) 增量.
///
/// 轻量级文件存在性探测, 用于 wikilink 逐层 vaultRoot 假设时的多轮尝试.
/// 区别于 read_markdown_file:
///   - 不读文件内容, 不校验大小, 不校验扩展名白名单, 不做 UTF-8 校验.
///   - 仅 fs::metadata().is_file(), 失败 → false (不抛错).
///   - IO 错误 (PermissionDenied 等非 NotFound) 一律视为不存在,
///     避免探测阶段把权限问题暴露给用户 (NFR-S-01 静默拒绝).
///
/// - Input:  path (绝对文件路径字符串)
/// - Output: Ok(bool) true=文件存在且为常规文件, false=不存在/不是文件/IO 错误
/// - Error 约定: 当前实现永不失败 (返回 Ok(false) 兜底).
///   [对应 wikilink 多层探测场景]
#[tauri::command]
pub async fn path_exists(path: String) -> Result<bool, AppError> {
    Ok(crate::services::markdown_file::exists(&PathBuf::from(path)).await)
}

// ---------- 2. get_recent_files ----------

/// get_recent_files — F-03
///
/// - Input:  无
/// - Output: Ok(Vec<RecentItem>), 数组长度 0..10
/// - Error 约定: 当前实现永不失败 (服务层从内存快照返回).
///   [对应 AC-07-1 / AC-08]
#[tauri::command]
pub async fn get_recent_files(
    state: tauri::State<'_, crate::services::recent_files::RecentState>,
) -> Result<Vec<RecentItem>, AppError> {
    let items = recent_svc::get_recent_files(&state);
    Ok(items.into_iter().map(RecentItem::from).collect())
}

// ---------- 3. add_recent_file ----------

/// add_recent_file — F-03
///
/// - Input:  path (String) / title (String)
/// - Output: Ok(()), 内存 + 磁盘均同步更新
/// - Error 约定: InvalidPath | Io  [对应 AC-04-1 / FR-02 / AC-05]
#[tauri::command]
pub async fn add_recent_file(
    state: tauri::State<'_, crate::services::recent_files::RecentState>,
    app: tauri::AppHandle,
    path: String,
    title: String,
) -> Result<(), AppError> {
    recent_svc::add_recent_file(&state, &app, path, title)
}

// ---------- 4. clear_recent_files ----------

/// clear_recent_files — F-03
///
/// - Input:  无
/// - Output: Ok(()), 清空内存 + 磁盘 store
/// - Error 约定: Io  [对应 AC-07-1 / NFR-05]
#[tauri::command]
pub async fn clear_recent_files(
    state: tauri::State<'_, crate::services::recent_files::RecentState>,
    app: tauri::AppHandle,
) -> Result<(), AppError> {
    recent_svc::clear_recent_files(&state, &app)
}

// ---------- 5. load_preferences (T04 实现) ----------

/// load_preferences — F-33
///
/// - Input:  无
/// - Output: Ok(Preferences), 首次启动返回 defaults; 文件损坏返回 Encoding.
#[tauri::command]
pub async fn load_preferences(app: tauri::AppHandle) -> Result<Preferences, AppError> {
    let p = crate::services::preferences::load(&app)?;
    Ok(Preferences {
        theme: theme_mode_to_str(p.theme).to_string(),
        font_size: p.font_size,
        line_height: p.line_height,
        language: crate::services::preferences::language_to_str(p.language).to_string(),
        // T24 (F-26): 透传外部编辑器字段 (非枚举值已由 services 层兜底).
        external_editor: p.external_editor,
        external_editor_custom_cmd: p.external_editor_custom_cmd,
    })
}

// ---------- 6. save_preferences (T04 实现) ----------

/// save_preferences — F-33
///
/// - Input:  prefs (Preferences)
/// - Output: Ok(()), 持久化.
#[tauri::command]
pub async fn save_preferences(app: tauri::AppHandle, prefs: Preferences) -> Result<(), AppError> {
    let p = crate::services::preferences::Preferences {
        theme: parse_theme_mode(&prefs.theme),
        font_size: prefs.font_size,
        line_height: prefs.line_height,
        language: parse_prefs_language(Some(prefs.language.as_str())),
        // T24 (F-26): 透传外部编辑器字段.
        external_editor: prefs.external_editor,
        external_editor_custom_cmd: prefs.external_editor_custom_cmd,
    };
    crate::services::preferences::save(&app, &p)
}

// ---------- 7. open_external_url (T19 重写) ----------

/// open_external_url — F-15 (T19 重写; 取代 T07 占位 `unimplemented!()`).
///
/// - Input:  url (String, 由前端 invoke 序列化传入)
/// - Output: Ok(()), 调用系统默认浏览器/邮件/电话程序打开.
/// - Error 约定: InvalidPath (协议白名单未命中 / 长度越界 / 空 / shell.open 内部失败)
///   [对应 F-32 + 设计 §5 协议白名单 + 需求 FR-02 / AC-02-1 / AC-02-2 / AC-02-3]
///
/// 实现 (T19): 委托 `services::external::open(&app, url).await`;
/// `app: tauri::AppHandle` 由 Tauri 自动注入, 不增加 IPC 参数列表.
/// 前端 `invoke('open_external_url', { url })` 调用面不变 (签名 `pub async fn
/// open_external_url(app: tauri::AppHandle, url: String)` 仅内部使用,
/// Tauri 通过参数名/类型识别 AppHandle 注入).
#[tauri::command]
pub async fn open_external_url(app: tauri::AppHandle, url: String) -> Result<(), AppError> {
    crate::services::external::open(&app, url).await
}

// ---------- 8. resolve_image_path ----------

/// resolve_image_path — F-15 / T08 step-2b.
///
/// - Input:  base (文档所在目录绝对路径) / rel (Markdown 图片相对路径)
/// - Output: Ok(String)
///     - 若 rel 以 http(s):// / data: / asset: 开头 → 原样返回 (前端短路, 不读文件)
///     - 否则解析为 data:<mime>;base64,... 字符串
/// - Error 约定: NotFound | InvalidPath | TooLarge | Io
///   [对应 AC-4-1..AC-4-4 / NFR-S-1 / 设计 §3.2.1]
#[tauri::command]
pub async fn resolve_image_path(base: String, rel: String) -> Result<String, AppError> {
    use crate::services::markdown_file::resolve_as_data_url;

    // 1) 短路: rel 是 http(s) / data: / asset: 开头 → 原样返回 (AC-4-2 + NFR-P-4).
    if rel.starts_with("http://")
        || rel.starts_with("https://")
        || rel.starts_with("data:")
        || rel.starts_with("asset:")
    {
        return Ok(rel);
    }

    // 2) base 必须是已存在的目录路径字符串 (AC-4-3 失败路径: base 为空).
    if base.trim().is_empty() {
        return Err(AppError::NotFound("base_path is empty".into()));
    }

    // 3) base 可能指向一个文件 (当前 md) 或目录. 统一取父目录作为 base_dir.
    let base_path = std::path::PathBuf::from(&base);
    let base_dir: std::path::PathBuf = if base_path.is_dir() {
        base_path
    } else {
        base_path
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| std::path::PathBuf::from("."))
    };

    // 4) 委托 services::markdown_file::resolve_as_data_url
    let rel_path = std::path::Path::new(&rel);
    match resolve_as_data_url(&base_dir, rel_path).await {
        Ok(data_url) => Ok(data_url),
        Err(e) => Err(AppError::from(e)),
    }
}

// ---------- 9. set_window_title (T04 新增) ----------

/// set_window_title — F-16 (T04 新增).
///
/// - Input:  title (String); 空串 → 还原 "KITE"
/// - Output: Ok(()), 调用 WebviewWindow::set_title.
/// - 错误约定: Unknown (窗口句柄失效 / set_title 失败)
///   [对应 AC-FR07-1, AC-FR07-2, AC-FR07-3, AC-NFR05-1]
///
/// 安全: 仅作字符串拼接; 不解析 HTML / 不进 shell.
#[tauri::command]
pub async fn set_window_title(app: tauri::AppHandle, title: String) -> Result<(), AppError> {
    let final_title = if title.is_empty() {
        "KITE".to_string()
    } else {
        format!("{title} - KITE")
    };
    let window = app
        .get_webview_window("main")
        .or_else(|| app.webview_windows().values().next().cloned())
        .ok_or_else(|| AppError::Unknown("main window not found".into()))?;
    window
        .set_title(&final_title)
        .map_err(|e| AppError::Unknown(format!("set_title failed: {e}")))?;
    Ok(())
}

// ---------- 10. load_progress (T11 新增) ----------

/// load_progress — F-12 (T11 新增, 设计 §3.6.7).
///
/// - Input:  无
/// - Output: Ok(ProgressPayload) — 含 lastPath / perFile / seenShortcutsHint.
/// - 错误约定:
///   - AppError::Encoding: JSON 解析失败 (前端 resetCorrupted 走 toast)
///   - AppError::Unknown: store init 失败
///   [对应 AC-09-2 / AC-12-1]
#[tauri::command]
pub async fn load_progress(
    app: tauri::AppHandle,
) -> Result<crate::services::progress::ProgressStorePayload, AppError> {
    crate::services::progress::load(&app)
}

// ---------- 11. save_progress (T11 新增) ----------

/// save_progress — F-12 (T11 新增, 设计 §3.6.8).
///
/// - Input:  payload (ProgressPayload) — 含 lastPath / perFile / seenShortcutsHint.
/// - Output: Ok(()), 持久化.
/// - 错误约定:
///   - AppError::Encoding: 序列化失败 (兜底)
///   - AppError::Unknown: store init / save 失败
///   [对应 AC-09-1 / AC-11-1 / AC-12-1]
#[tauri::command]
pub async fn save_progress(
    app: tauri::AppHandle,
    payload: crate::services::progress::ProgressStorePayload,
) -> Result<(), AppError> {
    crate::services::progress::save(&app, &payload)
}

// ---------- 12. list_dir (T15 — FR-02) ----------

/// list_dir — F-18 (FR-02 / 设计 §3.2).
///
/// - Input:  path (绝对目录路径字符串).
/// - Output: Ok(Vec<DirEntry>), 长度 0..N.
/// - Error 约定:
///   - NotFound: 路径不存在.
///   - NotADirectory: 路径指向文件.
///   - PermissionDenied: 路径含 `..` 段或不在授权 scope 内.
///   - Io: 其它 IO 失败.
///
/// 安全:
///   - 拒绝任何 `..` 路径段; 防止路径越权 (FR-02 NFR-S-1 / 设计 §3.2).
///   - fs_reader 已做基础守卫; commands 层再次校验, 双重防御.
#[tauri::command]
pub async fn list_dir(path: String) -> Result<Vec<ServiceDirEntry>, AppError> {
    // 守卫: `..` 段 (设计 §3.2 / FR-02 NFR-S-1).
    // 注意: 与 fs_reader::list_dir 同样规则保持一致, 双重防御.
    if path.is_empty() {
        return Err(AppError::InvalidPath("empty path".into()));
    }
    if path.split(['/', '\\']).any(|seg| seg == "..") {
        return Err(AppError::PermissionDenied(format!(
            "path traversal blocked: {path}"
        )));
    }
    let entries = fs_reader_svc::list_dir(&path)?;
    Ok(entries)
}

// ---------- 13. export_html (T16-P2 — FR-01) ----------

/// export_html — F-19 (FR-01 / 设计 §3.4.3 / §3.2.3).
///
/// - Input:  content (String, 已拼装好的 UTF-8 HTML) / target_path (String, 经 dialog.save 确认).
/// - Output: Ok(()).
/// - Error 约定 (AppError code):
///   - PAYLOAD_TOO_LARGE (E001): content 字节数 > 5 MB.
///   - INVALID_TARGET_PATH (E002): 路径非 .html 后缀或位于 /System / /Library /
///     C:\Windows / C:\Program Files.
///   - IO (E003): 底层 fs::write 失败.
///   - EXPORT_ENCODING (E005): content 非 UTF-8.
///
/// 实现: 委托 services::exporter::export_html; commands 层不引入额外 IO/校验.
#[tauri::command]
pub async fn export_html(
    content: String,
    target_path: String,
) -> Result<(), AppError> {
    crate::services::exporter::export_html(content, PathBuf::from(target_path))
}

// ---------- 14. open_in_external_editor (T24 — F-26) ----------

/// open_in_external_editor — F-26 (T24 / 设计 §3.3 / FR-04).
///
/// 在外部 Markdown 编辑器中打开当前已加载的文档. Rust 端做路径校验 (空 / 扩展名
/// 白名单 / 路径穿越 / 存在性 / is_file) 与命令拼装 (system / 7 预设 / custom 模板
/// {{path}} 占位符), 跨平台 spawn. 设计原则 (NFR-SEC-02): argv 数组, 不走 shell.
///
/// - Input:
///   - path (String, 当前文档绝对路径, 已通过 read_markdown_file 校验).
///   - editor (Option<String>): 8 档预设 ('system' | 'code' | 'cursor' | 'subl'
///     | 'mate' | 'notepad++' | 'typora' | 'custom'). 缺省 / null / 空串 → Rust
///     从 preferences.external_editor 读取.
/// - Output: Ok(()), 系统默认 Markdown 编辑器已被唤起.
/// - Error 约定 (AppError code):
///   - INVALID_PATH: 路径为空 / 扩展名不在白名单 / 不是 regular file / custom 模板语法错.
///   - PERMISSION_DENIED: 路径含 `..` 段.
///   - NOT_FOUND: 路径不存在 (文件被外部删除等).
///   - UNKNOWN: spawn 失败 / 平台不支持的 preset (如 notepad++ on macOS).
///   - IO: 底层 fs::metadata 失败.
///
/// 实现: 委托 services::external_editor::open_editor; commands 层不引入额外 IO/校验.
#[tauri::command]
pub async fn open_in_external_editor(
    app: tauri::AppHandle,
    path: String,
    editor: Option<String>,
) -> Result<(), AppError> {
    crate::services::external_editor::open_editor(&app, path, editor).await
}

// ---------- 15. set_fullscreen (T16-P2 — FR-03) ----------

/// set_fullscreen — F-20 (FR-03 / 设计 §3.3.4 / NFR-U-02).
///
/// - Input:  fullscreen (bool) — true 进入全屏, false 退出全屏.
/// - Output: Ok({is_fullscreen}). **返回** 设置后的实际状态, **前端用它把 React state
///   校正到 ground truth**, 而不是依赖 IPC 不抛错就视为成功. macOS 上
///   `WebviewWindow::set_fullscreen` 偶尔在窗口失焦/动画期间静默 no-op, 必须
///   回读 `is_fullscreen()` 才能告诉前端"实际成功没有". 前端 `useFullscreen`
///   看到这个值就同步 hook state; 若 fullscreen=false 但目标 fullscreen=true,
///   前端会显式 toast "全屏切换失败, 请确保窗口已获焦后重试".
///
/// - Error 约定 (AppError code):
///   - IO (E003): 当前窗口不存在 / 底层窗口对象方法调用失败.
///
/// 实现:
///   - 通过 `app.get_webview_window("main")` 拿到主窗口句柄;
///   - 调用 Tauri 2 标准 API `WebviewWindow::set_fullscreen(bool)`,
///     跨平台一致工作 (macOS: native window.fullScreen / Windows: WM_FULLSCREEN /
///     Linux: _NET_WM_STATE_FULLSCREEN).
///   - 之后 `window.is_fullscreen()` 取真实窗口状态, 作为返回值.
///   - 与前端 `FullscreenButton` + `useFullscreen` 共同构成完整 FR-03 闭环 (AC-03-1~5).
///
/// 边界:
///   - 若主窗口 label 不是 "main" (例如多窗口场景), 这里只覆盖默认主窗口.
///     这与设计 §3.3.4 "main window" 限定一致.
#[tauri::command]
pub async fn set_fullscreen(
    app: tauri::AppHandle,
    fullscreen: bool,
) -> Result<SetFullscreenResult, AppError> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| AppError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "main webview window not found",
        )))?;
    window
        .set_fullscreen(fullscreen)
        .map_err(|e| AppError::Io(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("set_fullscreen failed: {e}"),
        )))?;
    // 回读真实状态 (macOS 上 set_fullscreen 偶尔 no-op 而不抛错, 必须核对).
    let actual = window.is_fullscreen().unwrap_or(false);
    Ok(SetFullscreenResult {
        requested: fullscreen,
        actual,
    })
}

/// set_fullscreen 命令返回值 — 与 src/lib/tauri.ts 的 SetFullscreenResult 类型对齐.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetFullscreenResult {
    /// 前端请求的目标状态 (true = 进入, false = 退出).
    pub requested: bool,
    /// 调用后窗口的实际全屏状态. 与 requested 不一致时, 前端必须 toast 提示.
    pub actual: bool,
}

// ---- private helpers ----

fn theme_mode_to_str(m: crate::services::preferences::ThemeMode) -> &'static str {
    use crate::services::preferences::ThemeMode;
    match m {
        ThemeMode::Light => "light",
        ThemeMode::Dark => "dark",
        ThemeMode::System => "system",
    }
}

fn parse_theme_mode(s: &str) -> crate::services::preferences::ThemeMode {
    use crate::services::preferences::ThemeMode;
    match s {
        "light" => ThemeMode::Light,
        "dark" => ThemeMode::Dark,
        _ => ThemeMode::System,
    }
}

/// T15 (FR-05): 解析语言字符串; 非法值回退 ZhCn (AC-05-2).
fn parse_prefs_language(s: Option<&str>) -> crate::services::preferences::Language {
    use crate::services::preferences::Language;
    match s {
        Some("en-US") => Language::EnUs,
        // 包括 None / 'zh-CN' / 其它 → ZhCn
        _ => Language::ZhCn,
    }
}

// ----- macOS 文件打开命令 -----
//
// get_pending_open_file: 前端启动后拉一次.
// - 返回 Option<String>: Some(path) 表示有待打开文件, None 表示无.
// - 读后即清: 内部 Mutex<Option<PathBuf>> 的 take(), 防止二次加载.
// - 错误约定: 永远不返回 Err, 没有 path 也只是 None (避免无文件启动时被 toast 喷).
//
// 反序列化: 返回 Option<String>, serde 自动处理 null.
// Tauri invoke<Option<String>> 在前端直接拿到 string|null, 与 lib/tauri.ts
// 类型契约一致 (let pendingOpenFile: string | null = await getPendingOpenFile()).
#[tauri::command]
pub fn get_pending_open_file(
    state: tauri::State<'_, crate::pending_open::PendingOpen>,
) -> Option<String> {
    state.take().map(|p| p.to_string_lossy().to_string())
}

// ---------- 15b. get_file_fresh (T26 — R-12 修复) ----------
//
// get_file_fresh — 外部编辑器改回后刷新 (focus / 手动).
//
// - Input:  path (绝对文件路径, .md 扩展名).
// - Output: Ok(FileFreshPayload { mtime: u64, content: String }).
//   mtime 是自 UNIX 纪元起的秒数; 前端对比 lastLoadedMtime 决定是否 dispatch OPEN_OK.
//   content 直接带回 (与 read_markdown_file 同源, 字符解码失败 → AppError::Encoding
//   已被底层 read_to_string 退化为 AppError::Io).
// - 错误约定: 复用 external_editor::validate_path 五重防线, 错误码与
//   open_in_external_editor / read_markdown_file 完全一致, 前端 toast 文案
//   命中同一份 i18n 错误码分支, 不增加新翻译键.
//
// 包装层: 委托 services::file_fresh::read_file_fresh; 同步 IO, 不需要 async.
#[tauri::command]
pub fn get_file_fresh(path: String) -> Result<crate::services::file_fresh::FileFreshPayload, AppError> {
    crate::services::file_fresh::read_file_fresh(&path)
}

// ---------- 16. get_recent_dirs (T25 — F-27) ----------
//
// get_recent_dirs — F-27 (T25 / FR-02 / 设计 §3.3).
//
// - Input:  无.
// - Output: Ok(Vec<RecentDir>), 数组长度 0..8, 按 lastOpenedAt 倒序.
// - Error 约定: 当前实现永不失败 (服务层从内存快照返回).
//   [对应 AC-02-1 / AC-02-5]
//
// 包装层: 委托 services::recent_dirs::get_recent_dirs; commands 层不引入额外 IO.
#[tauri::command]
pub async fn get_recent_dirs(
    state: tauri::State<'_, crate::services::recent_dirs::RecentDirsState>,
) -> Result<Vec<crate::services::recent_dirs::RecentDir>, AppError> {
    Ok(crate::services::recent_dirs::get_recent_dirs(&state))
}

// ---------- 17. add_recent_dir (T25 — F-27) ----------
//
// add_recent_dir — F-27 (T25 / FR-02 / 设计 §3.3).
//
// - Input:  path (String, 来自 dialog 显式选择).
// - Output: Ok(()), 内存 + 磁盘均同步更新.
// - Error 约定:
//     - INVALID_PATH: 空 / `..` 段 / Windows 设备名 / UNC 路径.
//     - IO: 持久化失败.
//   [对应 AC-02-2 / AC-03-1 / AC-03-2 / AC-03-3 / AC-03-4 / AC-03-5]
//
// 包装层: 委托 services::recent_dirs::add_recent_dir.
#[tauri::command]
pub async fn add_recent_dir(
    state: tauri::State<'_, crate::services::recent_dirs::RecentDirsState>,
    app: tauri::AppHandle,
    path: String,
) -> Result<(), AppError> {
    crate::services::recent_dirs::add_recent_dir(&state, &app, path)
}

// ---------- 18. remove_recent_dir (T25 — F-27) ----------
//
// remove_recent_dir — F-27 (T25 / FR-02 / 设计 §3.3).
//
// - Input:  path (String).
// - Output: Ok(()), 内存移除 + 持久化; 幂等 (不存在的 path → Ok).
// - Error 约定: INVALID_PATH | IO  [对应 AC-03-6 / AC-04-7]
#[tauri::command]
pub async fn remove_recent_dir(
    state: tauri::State<'_, crate::services::recent_dirs::RecentDirsState>,
    app: tauri::AppHandle,
    path: String,
) -> Result<(), AppError> {
    crate::services::recent_dirs::remove_recent_dir(&state, &app, path)
}

// ---------- 19. clear_recent_dirs (T25 — F-27) ----------
//
// clear_recent_dirs — F-27 (T25 / FR-02 / 设计 §3.3).
//
// - Input:  无.
// - Output: Ok(()), 内存 + 磁盘 (文件置为 {version:1, items:[]}).
// - Error 约定: IO  [对应 AC-03-7 / AC-04-8]
#[tauri::command]
pub async fn clear_recent_dirs(
    state: tauri::State<'_, crate::services::recent_dirs::RecentDirsState>,
    app: tauri::AppHandle,
) -> Result<(), AppError> {
    crate::services::recent_dirs::clear_recent_dirs(&state, &app)
}

// ---------- 20. copy_file_to_clipboard (T29 — R-35 / FR-04) ----------
//
// copy_file_to_clipboard — 把指定路径的文件写入系统剪贴板.
//
// - Input:  path (String, 绝对路径, 必须存在且是 regular file).
// - Output: Ok(()), OS 剪贴板已包含文件引用.
// - 平台行为:
//   - macOS: NSPasteboardTypeFileURL → Finder/Explorer 粘贴时复制文件.
//   - Windows: CF_HDROP → Explorer 粘贴时复制文件.
//   - Linux: text/uri-list → 需要 xclip/xsel/wl-clipboard, 文件管理器粘贴时复制.
// - Error 约定 (AppError code):
//   - IO: 文件不存在 / 不是 regular file / 剪贴板写入失败.
//
// 为什么不用 Web Clipboard API: Tauri WebView (WKWebView on macOS) 在沙箱
// 限制下 navigator.clipboard.write 返回 NotAllowedError, 不可用. clipboard-rs
// 走原生 NSPasteboard/CF_HDROP, 绕过 WebView 权限限制 (R-35 增量).
#[tauri::command]
pub async fn copy_file_to_clipboard(path: String) -> Result<(), AppError> {
    let p = PathBuf::from(path);
    crate::services::clipboard::copy_file_to_clipboard(&p)
}
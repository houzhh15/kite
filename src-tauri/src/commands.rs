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

// ---------- 14. set_fullscreen (T16-P2 — FR-03) ----------

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
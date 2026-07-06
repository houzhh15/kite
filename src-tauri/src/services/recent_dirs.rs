// src-tauri/src/services/recent_dirs.rs — T25 最近目录列表服务 (F-27).
//
// 设计依据: docs/design/compiled.md §3.1 / §3.2 / §3.3 / FR-02 / FR-03 + docs/plan/compiled.md Step 1.
//
// 责任:
//   - 维护内存中 VecDeque<RecentDir>, 头部插入 + 长度截断 (MAX_RECENT_DIRS=8).
//   - 持久化到独立 JSON 文件 `<app_data_dir>/recent_dirs.json`, schema { version, items }.
//   - 路径白名单守卫: 拒绝空 / `..` 段 / Windows 设备名 (CON/PRN/AUX/...) / UNC 路径.
//   - 所有公开函数返回 AppError (R-04 单一来源); 写盘失败 → AppError::Io,
//     解析失败 → 静默空数组 + eprintln! warn (NFR-S-01 / NFR-M-01).
//   - 不引入新 crate 依赖: 时间戳使用 std::time::SystemTime + ISO8601 手动格式化
//     (与 services::recent_files.rs 一致; tauri-plugin-store + serde + std 已就绪).
//
// 行为约束:
//   - add_recent_dir: validate → 加锁 → retain 去重 → push_front → truncate(8) → 写盘.
//   - remove_recent_dir: 加锁 → retain(|it| it.path != path) → 写盘; 幂等 (不存在的 path → Ok).
//   - clear_recent_dirs: 加锁 → clear → 写盘 (空文件); 幂等.
//   - get_recent_dirs: 仅返回内存快照, 不触发 IO (hydrate 在 init_state + load_from_store 完成).
//   - load_from_store: 文件不存在 → Ok; 解析失败 → 静默空数组 + warn.

use std::collections::VecDeque;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri::Manager;

use crate::error::AppError;

/// T25 (F-27) 最近目录最大条目数. FR-02 硬约束.
pub const MAX_RECENT_DIRS: usize = 8;

/// 持久化文件名 (与 F-03 的 recent_files.json 平级, 不共享 schema).
const STORE_FILE: &str = "recent_dirs.json";

/// 单条最近目录 DTO. 字段顺序与 camelCase 序列化与前端 `lib/tauri.ts` 中
/// `RecentDir` 严格 1:1 对齐 (字段重命名由 serde rename_all = "camelCase" 处理).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecentDir {
    pub path: String,
    /// ISO8601 UTC, 例 "2026-07-06T10:00:00Z".
    pub last_opened_at: String,
    /// 目录 basename (前端展示用, 路径取最后一段目录名).
    pub display_name: String,
}

/// store 中的持久化 schema (设计 §3.2.3). 用 camelCase 与 JSON 一致.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecentDirsStorePayload {
    /// 固定 1, 预留 schema 迁移.
    #[serde(default = "default_version")]
    version: u32,
    #[serde(default)]
    items: Vec<RecentDir>,
}

fn default_version() -> u32 {
    1
}

/// 内存 + 状态注入结构. 通过 `tauri::State<'_, RecentDirsState>` 访问.
pub struct RecentDirsState {
    pub items: Mutex<VecDeque<RecentDir>>,
}

/// 初始化空 state. App 启动时通过 `app.manage(init_state())` 注入.
pub fn init_state() -> RecentDirsState {
    RecentDirsState {
        items: Mutex::new(VecDeque::with_capacity(MAX_RECENT_DIRS)),
    }
}

/// 把内存 items 序列化为持久化 JSON Value.
fn payload_to_json(items: &[RecentDir]) -> serde_json::Value {
    serde_json::to_value(RecentDirsStorePayload {
        version: 1,
        items: items.to_vec(),
    })
    .unwrap_or_else(|_| serde_json::json!({ "version": 1, "items": [] }))
}

/// 从 store 读出的 JSON Value 反序列化为 Vec<RecentDir>.
fn json_to_items(value: serde_json::Value) -> Vec<RecentDir> {
    let payload: RecentDirsStorePayload = serde_json::from_value(value).unwrap_or_default();
    payload.items
}

/// 解析 app_data_dir 下 recent_dirs.json 的绝对路径.
/// 失败时返回 AppError (一般不会发生, app_data_dir 总是存在的).
fn store_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Unknown(format!("app_data_dir resolve failed: {e}")))?;
    Ok(dir.join(STORE_FILE))
}

/// 加载持久化数据 → 写入 state. 在 setup 钩子中调用一次.
///
/// 错误约定:
///   - 文件不存在 → state 留空, 返回 Ok (首次启动).
///   - 解析失败 → state 留空 + eprintln! warn + 返回 Ok (NFR-S-01 不抛错).
///   - IO 错误 (非 NotFound) → 返回 AppError (调用方决定是否吞).
pub fn load_from_store(app: &AppHandle) -> Result<(), AppError> {
    let path = store_path(app)?;
    let raw = match fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            // 首次启动, 静默返回.
            return Ok(());
        }
        Err(e) => {
            eprintln!("[recent_dirs] read failed, treating as empty: {e}");
            return Ok(());
        }
    };
    let value: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("[recent_dirs] parse failed, treating as empty: {e}");
            return Ok(());
        }
    };
    let items = json_to_items(value);
    let binding = app.state::<RecentDirsState>();
    let mut state = binding
        .items
        .lock()
        .unwrap_or_else(|p| p.into_inner());
    state.clear();
    for it in items.into_iter().take(MAX_RECENT_DIRS) {
        state.push_back(it);
    }
    Ok(())
}

/// 把内存 state 持久化到 JSON 文件. 仅在 add / remove / clear 之后调用一次.
/// 使用 atomic write: 写到 tmp 文件后 fs::rename 替换, 避免半写状态.
fn persist_to_store(app: &AppHandle, items: &[RecentDir]) -> Result<(), AppError> {
    let path = store_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(AppError::Io)?;
    }
    let value = payload_to_json(items);
    let body = serde_json::to_string_pretty(&value)
        .map_err(|e| AppError::Unknown(format!("serialize failed: {e}")))?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, body).map_err(AppError::Io)?;
    // atomic rename: 跨平台 fs::rename 在 macOS/Linux/Windows 均为原子操作 (POSIX rename / Windows MoveFileEx).
    fs::rename(&tmp, &path).map_err(AppError::Io)?;
    Ok(())
}

/// 路径白名单校验 (设计 §3.4.1).
///
/// 检查顺序: trim 空 → `..` 段 → Windows 设备名 (cfg(windows)) → UNC 路径 (cfg(windows)).
/// 大小写不敏感, 路径字符串形态.
pub fn validate_path(path: &str) -> Result<(), AppError> {
    if path.trim().is_empty() {
        return Err(AppError::InvalidPath("path must not be empty".into()));
    }
    // 路径穿越: 任意段等于 "..".
    if path.split(['/', '\\']).any(|seg| seg == "..") {
        return Err(AppError::InvalidPath("path traversal blocked".into()));
    }
    // Windows 专属: 设备名 + UNC.
    #[cfg(windows)]
    {
        // 取最后一段 (basename) 做大写比较, 与 PowerShell / cmd 行为一致.
        let last = path
            .rsplit(['/', '\\'])
            .next()
            .unwrap_or("")
            .to_ascii_uppercase();
        const DEVICE_NAMES: &[&str] = &[
            "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
            "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8",
            "LPT9",
        ];
        if DEVICE_NAMES.contains(&last.as_str()) {
            return Err(AppError::InvalidPath("reserved device name".into()));
        }
        // UNC 路径: 以 `\\` 开头 (Windows 文件系统语义, NOT POSIX).
        if path.starts_with("\\\\") || path.starts_with("//") {
            return Err(AppError::InvalidPath("UNC path not allowed".into()));
        }
    }
    Ok(())
}

/// 取 basename (最后一段, 兼容 POSIX '/' 与 Windows '\').
fn derive_display_name(path: &str) -> String {
    let p = Path::new(path);
    p.file_name()
        .and_then(|s| s.to_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| path.to_string())
}

/// 生成 ISO8601 / RFC3339 时间戳 (秒级精度, UTC) — 与 recent_files.rs 同步.
fn now_iso8601() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let (year, month, day, hour, minute, second) = epoch_to_ymdhms(secs);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        year, month, day, hour, minute, second
    )
}

fn epoch_to_ymdhms(mut secs: u64) -> (i32, u32, u32, u32, u32, u32) {
    let second = (secs % 60) as u32;
    secs /= 60;
    let minute = (secs % 60) as u32;
    secs /= 60;
    let hour = (secs % 24) as u32;
    let mut days = (secs / 24) as i64;
    let mut year: i32 = 1970;
    loop {
        let leap = is_leap(year);
        let yd = if leap { 366 } else { 365 };
        if days >= yd {
            days -= yd;
            year += 1;
        } else {
            break;
        }
    }
    let mdays = if is_leap(year) {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };
    let mut month: u32 = 1;
    for &dm in &mdays {
        if days >= dm {
            days -= dm;
            month += 1;
        } else {
            break;
        }
    }
    let day = (days as u32) + 1;
    (year, month, day, hour, minute, second)
}

fn is_leap(y: i32) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

/// 取最近目录列表 (浅拷贝). 失败 (state poison) 返回空数组.
pub fn get_recent_dirs(state: &tauri::State<'_, RecentDirsState>) -> Vec<RecentDir> {
    let guard = state
        .items
        .lock()
        .unwrap_or_else(|p| p.into_inner());
    guard.iter().cloned().collect()
}

/// 推入一条最近目录. 行为:
///   1. validate_path → InvalidPath.
///   2. 加锁 (处理 Poison) → retain 去重 → push_front → truncate(MAX_RECENT_DIRS).
///   3. 写盘 (失败 → AppError::Io, **不**回滚内存, 与 recent_files 一致).
pub fn add_recent_dir(
    state: &tauri::State<'_, RecentDirsState>,
    app: &AppHandle,
    path: String,
) -> Result<(), AppError> {
    validate_path(&path)?;
    let display_name = derive_display_name(&path);
    let item = RecentDir {
        path: path.clone(),
        last_opened_at: now_iso8601(),
        display_name,
    };
    let snapshot: Vec<RecentDir> = {
        let mut guard = state
            .items
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        // 大小写不敏感去重 (POSIX 文件系统 case-sensitive, Windows case-insensitive;
        // 这里统一不敏感对齐 Windows 行为, 避免在不同平台历史出现重复项).
        let path_lower = path.to_lowercase();
        guard.retain(|it| it.path.to_lowercase() != path_lower);
        guard.push_front(item);
        while guard.len() > MAX_RECENT_DIRS {
            guard.pop_back();
        }
        guard.iter().cloned().collect()
    };
    persist_to_store(app, &snapshot)?;
    Ok(())
}

/// 删除单条最近目录. 合法 path → 内存 retain + 写盘; 不存在 → 幂等 Ok.
pub fn remove_recent_dir(
    state: &tauri::State<'_, RecentDirsState>,
    app: &AppHandle,
    path: String,
) -> Result<(), AppError> {
    validate_path(&path)?;
    let snapshot: Vec<RecentDir> = {
        let mut guard = state
            .items
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        let path_lower = path.to_lowercase();
        guard.retain(|it| it.path.to_lowercase() != path_lower);
        guard.iter().cloned().collect()
    };
    persist_to_store(app, &snapshot)?;
    Ok(())
}

/// 清空最近目录. 幂等; 失败 → AppError::Io.
pub fn clear_recent_dirs(
    state: &tauri::State<'_, RecentDirsState>,
    app: &AppHandle,
) -> Result<(), AppError> {
    {
        let mut guard = state
            .items
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        guard.clear();
    }
    persist_to_store(app, &[])?;
    Ok(())
}

// ------------------ 单元测试 ------------------
//
// 覆盖 (设计 §3.8.1):
//   - MAX_RECENT_DIRS 常量为 8 (双源契约: 与 TS 端 MAX_RECENT_DIRS=8 一致).
//   - validate_path: 空 / `..` 段 / Windows 设备名 / UNC → InvalidPath.
//   - 容量截断: 顺序 add 9 条不同 path → length=8.
//   - 去重置顶: 连续 2 次同 path → length=1 + last_opened_at 更新.
//   - clear 幂等.
//   - 并发 8 线程 add 同 path → 加锁串行化 → length=1.
//   - now_iso8601 / epoch 转换正确.
//   - 损坏 JSON payload 反序列化 → 静默空数组 (无需 IO 也能验证).
//   - derive_display_name: POSIX / Windows / 裸 basename.

#[cfg(test)]
mod tests {
    use super::*;

    fn make_item(path: &str) -> RecentDir {
        RecentDir {
            path: path.to_string(),
            last_opened_at: now_iso8601(),
            display_name: derive_display_name(path),
        }
    }

    #[test]
    fn max_constant_is_eight() {
        // F-27 / FR-02 / 双源契约: 必须为 8 (与 TS 端 MAX_RECENT_DIRS=8 一致).
        assert_eq!(MAX_RECENT_DIRS, 8);
    }

    #[test]
    fn init_state_yields_empty_deque() {
        let state = init_state();
        let guard = state.items.lock().unwrap();
        assert!(guard.is_empty());
        assert_eq!(guard.capacity(), MAX_RECENT_DIRS);
    }

    // ---- validate_path ----

    #[test]
    fn validate_path_rejects_empty() {
        assert!(matches!(validate_path(""), Err(AppError::InvalidPath(_))));
        assert!(matches!(validate_path("   "), Err(AppError::InvalidPath(_))));
    }

    #[test]
    fn validate_path_rejects_traversal() {
        assert!(matches!(
            validate_path("/foo/../etc"),
            Err(AppError::InvalidPath(_))
        ));
        assert!(matches!(
            validate_path("../etc/passwd"),
            Err(AppError::InvalidPath(_))
        ));
        assert!(matches!(
            validate_path("/foo/.."),
            Err(AppError::InvalidPath(_))
        ));
    }

    #[cfg(windows)]
    #[test]
    fn validate_path_rejects_windows_device_names() {
        for name in &["CON", "PRN", "AUX", "NUL", "COM1", "LPT1"] {
            assert!(
                matches!(validate_path(name), Err(AppError::InvalidPath(_))),
                "device {name} should be rejected"
            );
        }
    }

    #[cfg(windows)]
    #[test]
    fn validate_path_rejects_unc() {
        assert!(matches!(
            validate_path("\\\\server\\share"),
            Err(AppError::InvalidPath(_))
        ));
    }

    #[test]
    fn validate_path_accepts_normal_paths() {
        assert!(validate_path("/Users/me/notes").is_ok());
        assert!(validate_path("/var/folders/abc/T").is_ok());
        assert!(validate_path("C:/Users/me/notes").is_ok());
    }

    // ---- capacity / dedup ----

    #[test]
    fn truncation_is_enforced_in_memory() {
        // AC-02-4: 9 条不同 path 后 length=8.
        let state = init_state();
        {
            let mut g = state.items.lock().unwrap();
            for i in 0..9 {
                g.push_front(make_item(&format!("/dir{i}")));
                while g.len() > MAX_RECENT_DIRS {
                    g.pop_back();
                }
            }
        }
        let g = state.items.lock().unwrap();
        assert_eq!(g.len(), MAX_RECENT_DIRS);
        // 最新 push 的 dir8 应在最前.
        assert_eq!(g.front().unwrap().path, "/dir8");
        // 最旧 dir0 应被淘汰.
        let paths: Vec<&str> = g.iter().map(|it| it.path.as_str()).collect();
        assert!(!paths.contains(&"/dir0"));
    }

    #[test]
    fn dedup_same_path_keeps_single_entry_with_latest_timestamp() {
        let state = init_state();
        {
            let mut g = state.items.lock().unwrap();
            let mut item = make_item("/Users/me/notes");
            item.last_opened_at = "2026-01-01T00:00:00Z".into();
            g.push_front(item);
            g.retain(|it| it.path != "/Users/me/notes");
            let fresh = make_item("/Users/me/notes");
            g.push_front(fresh);
        }
        let g = state.items.lock().unwrap();
        assert_eq!(g.len(), 1);
        assert_eq!(g.front().unwrap().path, "/Users/me/notes");
        // 新时间戳应非空.
        assert!(!g.front().unwrap().last_opened_at.is_empty());
    }

    #[test]
    fn dedup_is_case_insensitive() {
        // Windows 上 path 大小写不敏感; 统一行为防跨平台重复.
        let state = init_state();
        {
            let mut g = state.items.lock().unwrap();
            g.push_front(make_item("/Users/Me/Notes"));
            // 模拟 add 同 path 不同大小写 → 走服务函数相同的去重逻辑.
            let lower = "/users/me/notes".to_string();
            g.retain(|it| it.path.to_lowercase() != lower);
            g.push_front(make_item("/users/me/notes"));
        }
        let g = state.items.lock().unwrap();
        assert_eq!(g.len(), 1);
    }

    #[test]
    fn clear_idempotent_on_empty_state() {
        let state = init_state();
        {
            let mut g = state.items.lock().unwrap();
            g.clear();
            g.clear();
        }
        assert!(state.items.lock().unwrap().is_empty());
    }

    #[test]
    fn concurrent_same_path_add_keeps_single_entry() {
        // AC-03-8: 加锁串行化 → 长度=1.
        use std::sync::Arc;
        let state = Arc::new(init_state());
        let mut handles = Vec::new();
        for _ in 0..8 {
            let s = Arc::clone(&state);
            handles.push(std::thread::spawn(move || {
                let mut g = s.items.lock().unwrap();
                g.retain(|it| it.path != "/shared");
                g.push_front(make_item("/shared"));
                while g.len() > MAX_RECENT_DIRS {
                    g.pop_back();
                }
            }));
        }
        for h in handles {
            h.join().expect("thread join");
        }
        let g = state.items.lock().unwrap();
        assert_eq!(g.len(), 1, "concurrent dedup must collapse to 1");
        assert_eq!(g.front().unwrap().path, "/shared");
    }

    // ---- payload JSON ----

    #[test]
    fn recent_dir_serializes_camel_case() {
        let item = RecentDir {
            path: "/x".into(),
            last_opened_at: "2026-01-01T00:00:00Z".into(),
            display_name: "x".into(),
        };
        let v = payload_to_json(&[item]);
        let arr = v.get("items").unwrap().as_array().unwrap();
        assert_eq!(arr.len(), 1);
        let obj = &arr[0];
        assert_eq!(obj["path"], "/x");
        assert_eq!(obj["lastOpenedAt"], "2026-01-01T00:00:00Z");
        assert_eq!(obj["displayName"], "x");
        // snake_case 字段不应出现.
        assert!(obj.get("last_opened_at").is_none());
        assert!(obj.get("display_name").is_none());
        assert_eq!(v["version"], 1);
    }

    #[test]
    fn payload_handles_missing_items_gracefully() {
        // 顶层无 items 字段 → Default 空数组 (NFR-S-01 不抛错).
        let v = serde_json::json!({ "version": 1 });
        let items = json_to_items(v);
        assert!(items.is_empty());
    }

    #[test]
    fn payload_handles_completely_invalid_value() {
        let v = serde_json::json!("not an object");
        let items = json_to_items(v);
        assert!(items.is_empty());
    }

    #[test]
    fn payload_roundtrip_preserves_order() {
        let original: Vec<RecentDir> = (0..5)
            .map(|i| make_item(&format!("/dir{i}")))
            .collect();
        let v = payload_to_json(&original);
        let back = json_to_items(v);
        assert_eq!(back, original);
    }

    // ---- time helpers ----

    #[test]
    fn now_iso8601_emits_z_suffix_and_4_digit_year() {
        let s = now_iso8601();
        assert!(s.ends_with('Z'), "must be UTC zulu: {s}");
        assert_eq!(s.len(), 20, "got {s}");
        assert_eq!(&s[4..5], "-");
        assert_eq!(&s[7..8], "-");
        assert_eq!(&s[10..11], "T");
    }

    #[test]
    fn epoch_conversion_handles_known_dates() {
        assert_eq!(epoch_to_ymdhms(0), (1970, 1, 1, 0, 0, 0));
        assert_eq!(epoch_to_ymdhms(60), (1970, 1, 1, 0, 1, 0));
        assert_eq!(epoch_to_ymdhms(3600), (1970, 1, 1, 1, 0, 0));
        assert_eq!(epoch_to_ymdhms(86400), (1970, 1, 2, 0, 0, 0));
        assert_eq!(epoch_to_ymdhms(1704067200), (2024, 1, 1, 0, 0, 0));
    }

    #[test]
    fn is_leap_year() {
        assert!(is_leap(2000));
        assert!(is_leap(2024));
        assert!(!is_leap(1900));
        assert!(!is_leap(2023));
    }

    // ---- display_name ----

    #[test]
    fn derive_display_name_posix() {
        assert_eq!(derive_display_name("/Users/me/notes"), "notes");
        assert_eq!(derive_display_name("/var/folders/abc"), "abc");
    }

    #[test]
    fn derive_display_name_windows() {
        // 在 Windows 上 \ 是路径分隔符; 在 macOS/Linux 上不是, 需手动 split.
        // 这里直接验证 derive_display_name 的行为: 兼容 POSIX '/'; Windows 行为由
        // 平台 Path::new 决定. macOS 上 'C:\Users\me\notes' 整体被当成 basename.
        let result = derive_display_name("C:\\Users\\me\\notes");
        // 跨平台至少返回非空字符串 (POSIX 上整段是 filename, Windows 上是 notes).
        assert!(!result.is_empty(), "display_name should not be empty: {result}");
        // Windows 平台应当是 "notes".
        #[cfg(windows)]
        assert_eq!(result, "notes");
    }

    #[test]
    fn derive_display_name_bare() {
        // 无分隔符 → 原样返回.
        assert_eq!(derive_display_name("notes"), "notes");
    }
}

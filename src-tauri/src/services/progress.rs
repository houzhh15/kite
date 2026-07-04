// src-tauri/src/services/progress.rs — T11 阅读进度持久化服务
//
// 设计依据: docs/design/compiled.md §3.4 + §3.6.7 / §3.6.8 + 需求 FR-09 / FR-10.
//
// 责任:
//   - 单一文件 IO: load() 读 store key "progress" + 字段级 fallback default; save() 整体覆盖写.
//   - ProgressStorePayload serde DTO 字段校验: 越界字段 → Default; 不抛错 (前端走 reset 路径).
//   - 用 tauri-plugin-store v2 的 StoreExt::store() 取 Arc<Store> (与 preferences 共用 kite.store.json).
//
// 行为:
//   - 文件不存在 → 返回 ProgressStorePayload::default(), 无错误.
//   - JSON 解析失败 → 返回 AppError::Encoding (前端 resetCorrupted).
//   - 字段越界 (pct ∉ [0,100] / scrollTop < 0) → 字段级 fallback.
//   - 写入失败 → AppError::Unknown.
//
// 键空间:
//   - 文件: "kite.store.json" (与 preferences / recent_files 共用, 架构 §6).
//   - 顶层键: "progress", 值 = ProgressStorePayload { lastPath, perFile, seenShortcutsHint }.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

use crate::error::AppError;

const STORE_FILE: &str = "kite.store.json";
const PROGRESS_KEY: &str = "progress";

const PCT_MIN: i64 = 0;
const PCT_MAX: i64 = 100;
const SCROLL_TOP_MIN: i64 = 0;

/// 单个文档的进度条目 (camelCase JSON).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProgressEntry {
    /// 0..=100, 整数百分比 (clamp 到 [0,100]).
    pub pct: u8,
    /// ≥ 0, 像素 (clamp 到 ≥ 0).
    pub scroll_top: u32,
    /// Unix seconds (UTC). 0 也合法 (sanitize 兜底).
    pub updated_at: i64,
}

/// store key "progress" 的顶层值 (含 lastPath / perFile / seenShortcutsHint).
///
/// 字段约束 (设计 §3.6.7):
///   - last_path: 任意字符串或 null; 空字符串 → null.
///   - per_file: HashMap<path, ProgressEntry>; 单条 sanitize 后保留.
///   - seen_shortcuts_hint: bool; 缺省 → false.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressStorePayload {
    #[serde(default)]
    pub last_path: Option<String>,
    #[serde(default)]
    pub per_file: HashMap<String, ProgressEntry>,
    #[serde(default)]
    pub seen_shortcuts_hint: bool,
}

/// 中间 DTO: 用于松散反序列化, 缺失字段 = None, 再走 sanitize fallback.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawProgressStorePayload {
    last_path: Option<String>,
    per_file: Option<HashMap<String, RawProgressEntry>>,
    seen_shortcuts_hint: Option<bool>,
}

/// 单条 ProgressEntry 的中间 DTO (全字段 Option, 越界值由 sanitize 兜底).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawProgressEntry {
    pct: Option<i64>,
    scroll_top: Option<i64>,
    updated_at: Option<i64>,
}

/// 从 store 读取 progress, 字段级 fallback default. 文件不存在 → Default.
///
/// 错误约定:
///   - AppError::Encoding: JSON 解析失败 (前端 resetCorrupted 走 toast).
///   - AppError::Unknown: store init 失败.
pub fn load(app: &AppHandle) -> Result<ProgressStorePayload, AppError> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| AppError::Unknown(format!("progress store init failed: {e}")))?;

    let value = match store.get(PROGRESS_KEY) {
        Some(v) => v,
        None => return Ok(ProgressStorePayload::default()),
    };

    // per_file 字段缺失或为 null → Raw 全字段 None (Default 兜底).
    let raw: RawProgressStorePayload = serde_json::from_value(value).map_err(|e| {
        AppError::Encoding(format!("progress payload parse failed: {e}"))
    })?;

    Ok(sanitize(raw))
}

/// 把 ProgressStorePayload 写入 store (整体覆盖). 写前 sanitize 一次 (防御性).
///
/// 错误约定:
///   - AppError::Encoding: 序列化失败 (不应发生, 但兜底).
///   - AppError::Unknown: store init / save 失败.
pub fn save(app: &AppHandle, payload: &ProgressStorePayload) -> Result<(), AppError> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| AppError::Unknown(format!("progress store init failed: {e}")))?;

    // 写前 sanitize: 防止调用方传入越界值污染磁盘.
    let sanitized = sanitize_raw(
        &payload.last_path,
        payload.per_file.iter().map(|(k, v)| {
            (
                k.clone(),
                RawProgressEntry {
                    pct: Some(v.pct as i64),
                    scroll_top: Some(v.scroll_top as i64),
                    updated_at: Some(v.updated_at),
                },
            )
        }),
        payload.seen_shortcuts_hint,
    );

    let value = serde_json::to_value(&sanitized)
        .map_err(|e| AppError::Encoding(format!("progress payload serialize failed: {e}")))?;
    store.set(PROGRESS_KEY, value);
    store
        .save()
        .map_err(|e| AppError::Unknown(format!("progress store save failed: {e}")))?;
    Ok(())
}

// ---- 私有 helpers ----

fn sanitize(raw: RawProgressStorePayload) -> ProgressStorePayload {
    sanitize_raw(
        &raw.last_path,
        raw.per_file
            .into_iter()
            .flatten()
            .map(|(k, v)| (k, v)),
        raw.seen_shortcuts_hint.unwrap_or(false),
    )
}

fn sanitize_raw<I>(
    last_path: &Option<String>,
    per_file_iter: I,
    seen_shortcuts_hint: bool,
) -> ProgressStorePayload
where
    I: IntoIterator<Item = (String, RawProgressEntry)>,
{
    let mut per_file = HashMap::new();
    for (path, raw_entry) in per_file_iter {
        let entry = ProgressEntry {
            pct: sanitize_pct(raw_entry.pct.unwrap_or(0)),
            scroll_top: sanitize_scroll_top(raw_entry.scroll_top.unwrap_or(0)),
            updated_at: sanitize_updated_at(raw_entry.updated_at.unwrap_or(0)),
        };
        per_file.insert(path, entry);
    }
    ProgressStorePayload {
        last_path: sanitize_last_path(last_path),
        per_file,
        seen_shortcuts_hint,
    }
}

fn sanitize_pct(n: i64) -> u8 {
    if n < PCT_MIN {
        0
    } else if n > PCT_MAX {
        PCT_MAX as u8
    } else {
        n as u8
    }
}

fn sanitize_scroll_top(n: i64) -> u32 {
    if n < SCROLL_TOP_MIN {
        0
    } else if n > u32::MAX as i64 {
        u32::MAX
    } else {
        n as u32
    }
}

fn sanitize_updated_at(n: i64) -> i64 {
    // 秒级时间戳; 0 视为合法 (旧条目), 负数视为损坏 → 0.
    if n < 0 {
        0
    } else {
        n
    }
}

fn sanitize_last_path(s: &Option<String>) -> Option<String> {
    match s {
        None => None,
        Some(p) => {
            let t = p.trim();
            if t.is_empty() {
                None
            } else {
                Some(t.to_string())
            }
        }
    }
}

// ---- 单元测试 ----

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pct_clamps_to_range() {
        assert_eq!(sanitize_pct(-10), 0);
        assert_eq!(sanitize_pct(0), 0);
        assert_eq!(sanitize_pct(50), 50);
        assert_eq!(sanitize_pct(100), 100);
        assert_eq!(sanitize_pct(150), 100);
    }

    #[test]
    fn scroll_top_clamps_to_non_negative() {
        assert_eq!(sanitize_scroll_top(-5), 0);
        assert_eq!(sanitize_scroll_top(0), 0);
        assert_eq!(sanitize_scroll_top(300), 300);
    }

    #[test]
    fn updated_at_rejects_negative() {
        assert_eq!(sanitize_updated_at(-1), 0);
        assert_eq!(sanitize_updated_at(0), 0);
        assert_eq!(sanitize_updated_at(1_700_000_000), 1_700_000_000);
    }

    #[test]
    fn last_path_treats_empty_as_null() {
        assert!(sanitize_last_path(&None).is_none());
        assert!(sanitize_last_path(&Some(String::new())).is_none());
        assert!(sanitize_last_path(&Some("   ".to_string())).is_none());
        assert_eq!(
            sanitize_last_path(&Some("/abs/foo.md".to_string())).as_deref(),
            Some("/abs/foo.md")
        );
        assert_eq!(
            sanitize_last_path(&Some("  /abs/foo.md  ".to_string())).as_deref(),
            Some("/abs/foo.md")
        );
    }

    #[test]
    fn sanitize_raw_handles_missing_per_file() {
        let raw = RawProgressStorePayload::default();
        let p = sanitize(raw);
        assert!(p.last_path.is_none());
        assert!(p.per_file.is_empty());
        assert!(!p.seen_shortcuts_hint);
    }

    #[test]
    fn sanitize_raw_clamps_out_of_range_entry() {
        let mut per_file = HashMap::new();
        per_file.insert(
            "/abs/a.md".to_string(),
            RawProgressEntry {
                pct: Some(150),
                scroll_top: Some(-5),
                updated_at: Some(-1),
            },
        );
        let raw = RawProgressStorePayload {
            last_path: Some("/abs/a.md".to_string()),
            per_file: Some(per_file),
            seen_shortcuts_hint: Some(true),
        };
        let p = sanitize(raw);
        assert_eq!(p.last_path.as_deref(), Some("/abs/a.md"));
        let entry = p.per_file.get("/abs/a.md").unwrap();
        assert_eq!(entry.pct, 100);
        assert_eq!(entry.scroll_top, 0);
        assert_eq!(entry.updated_at, 0);
        assert!(p.seen_shortcuts_hint);
    }

    #[test]
    fn sanitize_raw_drops_null_per_file() {
        // per_file 为 null → 视为空.
        let raw = RawProgressStorePayload {
            last_path: None,
            per_file: None,
            seen_shortcuts_hint: None,
        };
        let p = sanitize(raw);
        assert!(p.per_file.is_empty());
        assert!(p.last_path.is_none());
        assert!(!p.seen_shortcuts_hint);
    }

    #[test]
    fn payload_serializes_camel_case() {
        let mut per_file = HashMap::new();
        per_file.insert(
            "/abs/a.md".to_string(),
            ProgressEntry {
                pct: 50,
                scroll_top: 300,
                updated_at: 1_700_000_000,
            },
        );
        let p = ProgressStorePayload {
            last_path: Some("/abs/a.md".to_string()),
            per_file,
            seen_shortcuts_hint: true,
        };
        let v = serde_json::to_value(&p).unwrap();
        assert_eq!(v["lastPath"], "/abs/a.md");
        assert_eq!(v["seenShortcutsHint"], true);
        let entry = &v["perFile"]["/abs/a.md"];
        assert_eq!(entry["pct"], 50);
        assert_eq!(entry["scrollTop"], 300);
        assert_eq!(entry["updatedAt"], 1_700_000_000);
        // 字段名应是 camelCase (无 snake_case)
        assert!(v.get("last_path").is_none());
        assert!(v.get("seen_shortcuts_hint").is_none());
        assert!(entry.get("scroll_top").is_none());
        assert!(entry.get("updated_at").is_none());
    }

    #[test]
    fn payload_default_is_empty() {
        let p = ProgressStorePayload::default();
        assert!(p.last_path.is_none());
        assert!(p.per_file.is_empty());
        assert!(!p.seen_shortcuts_hint);
    }

    #[test]
    fn corrupt_json_shape_fails_parse() {
        // 非对象 → parse 失败 → AppError::Encoding.
        let bad = serde_json::json!("not an object");
        let result: Result<RawProgressStorePayload, _> = serde_json::from_value(bad);
        assert!(result.is_err());
    }

    #[test]
    fn empty_object_parses_to_default() {
        let v = serde_json::json!({});
        let raw: RawProgressStorePayload = serde_json::from_value(v).unwrap();
        let p = sanitize(raw);
        assert!(p.last_path.is_none());
        assert!(p.per_file.is_empty());
        assert!(!p.seen_shortcuts_hint);
    }

    #[test]
    fn entry_with_null_fields_yields_zero_defaults() {
        // 全字段 null → 各字段 fallback 到 0.
        let mut per_file = HashMap::new();
        per_file.insert(
            "/abs/a.md".to_string(),
            RawProgressEntry {
                pct: None,
                scroll_top: None,
                updated_at: None,
            },
        );
        let raw = RawProgressStorePayload {
            last_path: None,
            per_file: Some(per_file),
            seen_shortcuts_hint: None,
        };
        let p = sanitize(raw);
        let e = p.per_file.get("/abs/a.md").unwrap();
        assert_eq!(e.pct, 0);
        assert_eq!(e.scroll_top, 0);
        assert_eq!(e.updated_at, 0);
    }
}
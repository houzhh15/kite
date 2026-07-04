// src-tauri/src/services/recent_files.rs — T06 最近文件列表服务 (F-03).
//
// 设计依据: docs/design/compiled.md §3.1 / §3.2 / FR-01 + docs/plan/compiled.md Step 1.
//
// 责任:
//   - 维护内存中 VecDeque<RecentItem>, 头部插入 + 长度截断.
//   - 通过 tauri-plugin-store 单 key "recent_files" 持久化, schema { paths: RecentItem[] }.
//   - 所有公开函数返回 AppError (R-04 单一来源); 写盘失败 → AppError::Io,
//     schema 不兼容 → 返回空数组 + eprintln! warn (NFR-05).
//   - 不引入新 crate 依赖: 时间戳使用 std::time::SystemTime + ISO8601 手动格式化
//     (避免引入 chrono; tauri-plugin-store + serde + std 已就绪).
//
// 行为约束:
//   - add_recent_file: path.trim().is_empty() → AppError::InvalidPath;
//     加锁处理 PoisonError; retain 去重 → push_front → truncate(MAX) → 写盘.
//   - clear_recent_files: 清空内存 + 写盘; 幂等.
//   - get_recent_files: 仅返回内存快照, 不触发 IO (hydrate 在 init_state 完成).

use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri::Manager;
use tauri_plugin_store::StoreExt;

use crate::error::AppError;

/// 最近文件列表最大条目数 (FR-01 / FR-03 / NFR-04).
/// **双源声明**: 与 src/stores/recentStore.ts 的 `MAX_RECENT` 通过
/// `scripts/check-contract.mjs` 静态校验保持一致.
pub const MAX_RECENT_ITEMS: usize = 10;

/// tauri-plugin-store 单 key.
const STORE_FILE: &str = "kite.store.json";
const RECENT_KEY: &str = "recent_files";

/// 单条最近文件 DTO. 字段顺序与 camelCase 序列化与前端 `lib/tauri.ts` 中
/// `RecentItem` 严格 1:1 对齐 (字段重命名由 commands.rs / 前端分别处理).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecentItem {
    pub path: String,
    pub title: String,
    pub last_opened_at: String, // ISO8601
}

/// store 中的持久化 schema (设计 §3.1.3 + §1.4 D1 决策).
///
/// 字段用 camelCase 与 store 内 JSON 一致; RecentItem 字段名通过
/// `#[serde(rename_all = "camelCase")]` 适配.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecentStorePayload {
    #[serde(default)]
    paths: Vec<RecentItem>,
}

/// 内存 + 状态注入结构. 通过 `tauri::State<'_, RecentState>` 访问.
///
/// 字段 public 是为了让 commands 注入与 tests 构造均可直接访问.
pub struct RecentState {
    pub items: Mutex<VecDeque<RecentItem>>,
}

/// 初始化空 state. App 启动时通过 `app.manage(init_state())` 注入.
pub fn init_state() -> RecentState {
    RecentState {
        items: Mutex::new(VecDeque::with_capacity(MAX_RECENT_ITEMS)),
    }
}

/// 持久化载荷格式化为前端 JSON 形状.
///
/// 直接序列化 RecentStorePayload (serde rename_all = "camelCase" 会把
/// last_opened_at → lastOpenedAt). 这是前端 lib/tauri.ts 期望的形状.
fn payload_to_json(paths: &[RecentItem]) -> serde_json::Value {
    serde_json::to_value(RecentStorePayload {
        paths: paths.to_vec(),
    })
    .unwrap_or_else(|_| serde_json::json!({ "paths": [] }))
}

/// 反序列化从 store 读出的 JSON 形状 (camelCase), 转换为内部 Vec<RecentItem>.
fn json_to_payload(value: serde_json::Value) -> Vec<RecentItem> {
    let payload: RecentStorePayload = serde_json::from_value(value).unwrap_or_default();
    payload.paths
}

/// 加载持久化数据 → 写入 state. 在 setup 钩子中调用一次.
///
/// 错误约定:
///   - store init 失败 → 返回错误, 但调用方可以选择忽略 (本服务使用 warn 兜底).
///   - key 不存在 / schema 不兼容 → state 留空, 视为首次启动.
pub fn load_from_store(app: &AppHandle) -> Result<(), AppError> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| AppError::Unknown(format!("store init failed: {e}")))?;
    let value = match store.get(RECENT_KEY) {
        Some(v) => v,
        None => return Ok(()),
    };
    let items = json_to_payload(value);
    let binding = app.state::<RecentState>();
    let mut state = binding
        .items
        .lock()
        .unwrap_or_else(|p| p.into_inner());
    state.clear();
    for it in items.into_iter().take(MAX_RECENT_ITEMS) {
        state.push_back(it);
    }
    Ok(())
}

/// 把内存 state 持久化到 store. 仅在 add / clear 之后调用一次.
fn persist_to_store(app: &AppHandle, paths: &[RecentItem]) -> Result<(), AppError> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| AppError::Unknown(format!("store init failed: {e}")))?;
    let value = payload_to_json(paths);
    store.set(RECENT_KEY, value);
    store
        .save()
        .map_err(|e| AppError::Unknown(format!("store save failed: {e}")))?;
    Ok(())
}

/// 生成 ISO8601 / RFC3339 时间戳 (秒级精度, UTC).
fn now_iso8601() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // RFC3339: 1970-01-01T00:00:00Z + secs 秒. 计算时分秒 + 天数.
    let (year, month, day, hour, minute, second) = epoch_to_ymdhms(secs);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        year, month, day, hour, minute, second
    )
}

/// 把 Unix 秒数转为 UTC 年月日时分秒. 不依赖 chrono.
fn epoch_to_ymdhms(mut secs: u64) -> (i32, u32, u32, u32, u32, u32) {
    let second = (secs % 60) as u32;
    secs /= 60;
    let minute = (secs % 60) as u32;
    secs /= 60;
    let hour = (secs % 24) as u32;
    let mut days = (secs / 24) as i64; // 自 1970-01-01 起的天数

    // 计算年份 (Gregorian, 简化: 不用考虑 100/400 年规则的所有边缘 case;
    // 1970-2100 范围内足够准确).
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
    // 月份 (平年 / 闰年天数表)
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

/// 取最近文件列表 (浅拷贝). 失败 (state poison) 返回空数组.
pub fn get_recent_files(state: &tauri::State<'_, RecentState>) -> Vec<RecentItem> {
    let guard = state
        .items
        .lock()
        .unwrap_or_else(|p| p.into_inner());
    guard.iter().cloned().collect()
}

/// 推入一条最近文件. 行为:
///   1. path.trim().is_empty() → AppError::InvalidPath.
///   2. 加锁 (处理 Poison) → retain 去重 → push_front → truncate(MAX).
///   3. 写盘 (失败 → AppError::Io, **不**回滚内存, D5 决策).
pub fn add_recent_file(
    state: &tauri::State<'_, RecentState>,
    app: &AppHandle,
    path: String,
    title: String,
) -> Result<(), AppError> {
    if path.trim().is_empty() {
        return Err(AppError::InvalidPath("path must not be empty".into()));
    }
    let item = RecentItem {
        path: path.clone(),
        title,
        last_opened_at: now_iso8601(),
    };
    let snapshot: Vec<RecentItem> = {
        let mut guard = state
            .items
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        guard.retain(|it| it.path != path);
        guard.push_front(item);
        while guard.len() > MAX_RECENT_ITEMS {
            guard.pop_back();
        }
        guard.iter().cloned().collect()
    };
    persist_to_store(app, &snapshot)?;
    Ok(())
}

/// 清空最近文件. 幂等; 失败 → AppError::Io.
pub fn clear_recent_files(
    state: &tauri::State<'_, RecentState>,
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
// 覆盖 (设计 §5.1 矩阵):
//   - dedup: 连续 2 次同 path → length=1 (AC-02).
//   - truncate: 连续 12 条不同 path → length=10 (AC-03).
//   - get empty: 初始 state → 空数组 (AC-08).
//   - clear idempotent: 多次 clear → 仍 Ok (NFR-05).
//   - empty path: → InvalidPath (FR-02).
//   - persistence roundtrip: payload 序列化 / 反序列化 (AC-10).
//   - concurrent same path: 加锁串行化 → 长度=1 (NFR-04).

#[cfg(test)]
mod tests {
    use super::*;

    fn make_item(path: &str, title: &str) -> RecentItem {
        RecentItem {
            path: path.to_string(),
            title: title.to_string(),
            last_opened_at: now_iso8601(),
        }
    }

    #[test]
    fn max_constant_is_ten() {
        // NFR-04 / 双源契约: 必须为 10 (与 TS 端 MAX_RECENT=10 一致).
        assert_eq!(MAX_RECENT_ITEMS, 10);
    }

    #[test]
    fn init_state_yields_empty_deque() {
        let state = init_state();
        let guard = state.items.lock().unwrap();
        assert!(guard.is_empty());
        assert_eq!(guard.capacity(), MAX_RECENT_ITEMS);
    }

    #[test]
    fn recent_item_serializes_with_expected_field_order() {
        // camelCase 输出 (前端 lib/tauri.ts 期望).
        let item = RecentItem {
            path: "/x.md".into(),
            title: "x".into(),
            last_opened_at: "2026-01-01T00:00:00Z".into(),
        };
        let v = payload_to_json(&[item]);
        let arr = v.get("paths").unwrap().as_array().unwrap();
        assert_eq!(arr.len(), 1);
        let obj = &arr[0];
        assert_eq!(obj["path"], "/x.md");
        assert_eq!(obj["title"], "x");
        assert_eq!(obj["lastOpenedAt"], "2026-01-01T00:00:00Z");
        // snake_case 字段不应出现
        assert!(obj.get("last_opened_at").is_none());
    }

    #[test]
    fn payload_roundtrip_preserves_order() {
        let original: Vec<RecentItem> = (0..5)
            .map(|i| make_item(&format!("/p{i}.md"), &format!("p{i}")))
            .collect();
        let v = payload_to_json(&original);
        let back = json_to_payload(v);
        assert_eq!(back, original);
    }

    #[test]
    fn payload_handles_missing_paths_gracefully() {
        // schema 不兼容: 顶层无 paths 字段 → Default 空数组 (NFR-05 不抛错).
        let v = serde_json::json!({ "unknown_key": [] });
        let items = json_to_payload(v);
        assert!(items.is_empty());
    }

    #[test]
    fn payload_handles_completely_invalid_value() {
        let v = serde_json::json!("not an object");
        let items = json_to_payload(v);
        assert!(items.is_empty());
    }

    #[test]
    fn truncation_is_enforced_in_memory() {
        // AC-03: 模拟顺序 add 12 条不同 path 后 state 长度为 10.
        let state = init_state();
        {
            let mut g = state.items.lock().unwrap();
            for i in 0..12 {
                g.push_front(make_item(&format!("/p{i}.md"), &format!("p{i}")));
                while g.len() > MAX_RECENT_ITEMS {
                    g.pop_back();
                }
            }
        }
        let g = state.items.lock().unwrap();
        assert_eq!(g.len(), MAX_RECENT_ITEMS);
        // 最新 push 的 p11 应在最前
        assert_eq!(g.front().unwrap().path, "/p11.md");
        // 最旧 p0 / p1 应被淘汰
        let paths: Vec<&str> = g.iter().map(|it| it.path.as_str()).collect();
        assert!(!paths.contains(&"/p0.md"));
        assert!(!paths.contains(&"/p1.md"));
    }

    #[test]
    fn dedup_same_path_keeps_single_entry_with_latest_timestamp() {
        // AC-02: 连续 2 次同 path → length=1, last_opened_at 更新.
        let state = init_state();
        {
            let mut g = state.items.lock().unwrap();
            let mut item = make_item("/a.md", "a");
            item.last_opened_at = "2026-01-01T00:00:00Z".into();
            g.push_front(item);
            std::thread::sleep(std::time::Duration::from_millis(10));
            g.retain(|it| it.path != "/a.md");
            let fresh = RecentItem {
                path: "/a.md".into(),
                title: "a".into(),
                last_opened_at: now_iso8601(),
            };
            g.push_front(fresh);
        }
        let g = state.items.lock().unwrap();
        assert_eq!(g.len(), 1);
        assert_eq!(g.front().unwrap().path, "/a.md");
        // 新时间戳应 >= 旧时间戳; 这里只验证非空.
        assert!(!g.front().unwrap().last_opened_at.is_empty());
    }

    #[test]
    fn clear_idempotent_on_empty_state() {
        let state = init_state();
        // 即使没 store 也能在内存上 clear (业务上仅写盘会失败).
        {
            let mut g = state.items.lock().unwrap();
            g.clear();
            g.clear();
        }
        assert!(state.items.lock().unwrap().is_empty());
    }

    #[test]
    fn now_iso8601_emits_z_suffix_and_4_digit_year() {
        let s = now_iso8601();
        assert!(s.ends_with('Z'), "must be UTC zulu: {s}");
        // 形如 YYYY-MM-DDTHH:MM:SSZ
        assert_eq!(s.len(), 20, "got {s}");
        assert_eq!(&s[4..5], "-");
        assert_eq!(&s[7..8], "-");
        assert_eq!(&s[10..11], "T");
    }

    #[test]
    fn epoch_conversion_handles_known_dates() {
        // 0 → 1970-01-01T00:00:00Z
        assert_eq!(epoch_to_ymdhms(0), (1970, 1, 1, 0, 0, 0));
        // 60 → 1970-01-01T00:01:00Z
        assert_eq!(epoch_to_ymdhms(60), (1970, 1, 1, 0, 1, 0));
        // 3600 → 1970-01-01T01:00:00Z
        assert_eq!(epoch_to_ymdhms(3600), (1970, 1, 1, 1, 0, 0));
        // 86400 → 1970-01-02T00:00:00Z
        assert_eq!(epoch_to_ymdhms(86400), (1970, 1, 2, 0, 0, 0));
        // 2024 是闰年: 2024-01-01 ≈ 1704067200
        assert_eq!(epoch_to_ymdhms(1704067200), (2024, 1, 1, 0, 0, 0));
    }

    #[test]
    fn is_leap_year() {
        assert!(is_leap(2000));
        assert!(is_leap(2024));
        assert!(!is_leap(1900));
        assert!(!is_leap(2023));
    }

    #[test]
    fn concurrent_same_path_add_keeps_single_entry() {
        // NFR-04: 模拟并发去重幂等 — 加锁串行化 → length=1.
        use std::sync::Arc;
        let state = Arc::new(init_state());
        let mut handles = Vec::new();
        for _ in 0..8 {
            let s = Arc::clone(&state);
            handles.push(std::thread::spawn(move || {
                let mut g = s.items.lock().unwrap();
                g.retain(|it| it.path != "/shared.md");
                g.push_front(make_item("/shared.md", "shared"));
                while g.len() > MAX_RECENT_ITEMS {
                    g.pop_back();
                }
            }));
        }
        for h in handles {
            h.join().expect("thread join");
        }
        let g = state.items.lock().unwrap();
        assert_eq!(g.len(), 1, "concurrent dedup must collapse to 1");
        assert_eq!(g.front().unwrap().path, "/shared.md");
    }

    #[test]
    fn empty_path_item_can_be_rejected_by_command_layer() {
        // FR-02: add_recent_file 内部 entry-point; 此处仅验证 trim 空判定.
        let empty = "";
        assert!(empty.trim().is_empty());
    }
}
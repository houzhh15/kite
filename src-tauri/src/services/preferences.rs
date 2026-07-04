// src-tauri/src/services/preferences.rs — T04 偏好持久化服务
//
// 设计依据: docs/design/compiled.md §3.1 / FR-01 / FR-05.
//
// 责任:
//   - 单一文件 IO: load() 读 store + 字段级 fallback default; save() 整体覆盖写.
//   - Preferences serde DTO 字段校验: 越界字段 → Default; 不抛错.
//   - 用 tauri-plugin-store v2 的 StoreExt::store() 取 Arc<Store>.
//
// 行为:
//   - 文件不存在 → 返回 Preferences::default(), 无错误.
//   - JSON 解析失败 → 返回 AppError::Encoding (前端 fallback 默认).
//   - 字段越界 (theme 不识别 / font_size 越界 / line_height 非三档) → 字段级 fallback.
//   - 写入失败 → AppError::Io.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "kite.store.json";
const PREFS_KEY: &str = "preferences";
const FONT_SIZE_MIN: u8 = 12;
const FONT_SIZE_MAX: u8 = 24;
const ALLOWED_LINE_HEIGHTS: [f32; 3] = [1.4, 1.6, 1.8];

/// 主题档位: 与前端 Theme 类型一一对应 (light / dark / system).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ThemeMode {
    Light,
    Dark,
    System,
}

impl Default for ThemeMode {
    fn default() -> Self {
        ThemeMode::System
    }
}

/// T15 (FR-05): 语言档位 (zh-CN / en-US).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum Language {
    #[serde(rename = "zh-CN")]
    ZhCn,
    #[serde(rename = "en-US")]
    EnUs,
}

impl Default for Language {
    fn default() -> Self {
        Language::ZhCn
    }
}

/// 用户偏好 DTO (camelCase JSON).
///
/// 字段约束 (设计 §3.1.1):
///   - theme: 严格三档, 其它值 → System
///   - font_size: 12..=24, 越界 → 16
///   - line_height: 仅 1.4 / 1.6 / 1.8, 其它 → 1.6
///   - language: T15 (FR-05): 仅 zh-CN / en-US, 其它 → ZhCn
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    pub theme: ThemeMode,
    pub font_size: u8,
    pub line_height: f32,
    /// T15 (FR-05): UI 语言. 缺省 zh-CN.
    #[serde(default = "default_language")]
    pub language: Language,
}

fn default_language() -> Language {
    Language::ZhCn
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            theme: ThemeMode::System,
            font_size: 16,
            line_height: 1.6,
            language: Language::ZhCn,
        }
    }
}

/// 中间 DTO: 用于松散反序列化, 缺失字段 = None, 再走 sanitize fallback.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawPreferences {
    theme: Option<String>,
    font_size: Option<i64>,
    line_height: Option<f64>,
    /// T15 (FR-05)
    language: Option<String>,
}

/// T15 (FR-05): 语言字符串 → Language; 非法回退 ZhCn (AC-05-2).
fn parse_language(s: &str) -> Language {
    match s {
        "zh-CN" => Language::ZhCn,
        "en-US" => Language::EnUs,
        _ => Language::ZhCn,
    }
}

/// T15 (FR-05): Language → 字符串.
pub fn language_to_str(l: Language) -> &'static str {
    match l {
        Language::ZhCn => "zh-CN",
        Language::EnUs => "en-US",
    }
}

/// 从 store 读取 preferences, 字段级 fallback default. 文件不存在 → Default.
///
/// 错误约定:
///   - AppError::Encoding: JSON 解析失败
///   - AppError::Io: store 取不到
pub fn load(app: &AppHandle) -> Result<Preferences, crate::error::AppError> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| crate::error::AppError::Unknown(format!("store init failed: {e}")))?;

    let value = match store.get(PREFS_KEY) {
        Some(v) => v,
        None => return Ok(Preferences::default()),
    };

    // 解析失败 → 字段级 Default (不抛错, 让前端 hydrate 仍能正常进入).
    let raw: RawPreferences = serde_json::from_value(value).unwrap_or_default();

    let mut prefs = Preferences::default();
    if let Some(t) = raw.theme.as_deref() {
        prefs.theme = parse_theme_mode(t);
    }
    if let Some(n) = raw.font_size {
        prefs.font_size = clamp_font_size(n);
    }
    if let Some(h) = raw.line_height {
        prefs.line_height = clamp_line_height(h as f32);
    }
    if let Some(l) = raw.language.as_deref() {
        prefs.language = parse_language(l);
    }
    Ok(prefs)
}

/// 把 Preferences 写入 store (整体覆盖).
pub fn save(app: &AppHandle, prefs: &Preferences) -> Result<(), crate::error::AppError> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| crate::error::AppError::Unknown(format!("store init failed: {e}")))?;
    let value = serde_json::to_value(prefs)
        .map_err(|e| crate::error::AppError::Encoding(e.to_string()))?;
    store.set(PREFS_KEY, value);
    store
        .save()
        .map_err(|e| crate::error::AppError::Unknown(format!("store save failed: {e}")))?;
    Ok(())
}

// ---- 私有 helpers ----

fn parse_theme_mode(s: &str) -> ThemeMode {
    match s {
        "light" => ThemeMode::Light,
        "dark" => ThemeMode::Dark,
        "system" => ThemeMode::System,
        _ => ThemeMode::System,
    }
}

fn clamp_font_size(n: i64) -> u8 {
    if n < FONT_SIZE_MIN as i64 {
        FONT_SIZE_MIN
    } else if n > FONT_SIZE_MAX as i64 {
        FONT_SIZE_MAX
    } else {
        n as u8
    }
}

fn clamp_line_height(h: f32) -> f32 {
    ALLOWED_LINE_HEIGHTS
        .iter()
        .copied()
        .min_by(|a, b| {
            (h - a)
                .abs()
                .partial_cmp(&(h - b).abs())
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .unwrap_or(1.6)
}

// ---- 单元测试 ----

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_match_design_spec() {
        let p = Preferences::default();
        assert_eq!(p.theme, ThemeMode::System);
        assert_eq!(p.font_size, 16);
        assert_eq!(p.line_height, 1.6);
    }

    #[test]
    fn theme_mode_parses_known_values() {
        assert_eq!(parse_theme_mode("light"), ThemeMode::Light);
        assert_eq!(parse_theme_mode("dark"), ThemeMode::Dark);
        assert_eq!(parse_theme_mode("system"), ThemeMode::System);
    }

    #[test]
    fn theme_mode_unknown_falls_back_to_system() {
        assert_eq!(parse_theme_mode("sepia"), ThemeMode::System);
        assert_eq!(parse_theme_mode(""), ThemeMode::System);
        assert_eq!(parse_theme_mode("LIGHT"), ThemeMode::System); // case sensitive
    }

    #[test]
    fn font_size_clamps_to_range() {
        assert_eq!(clamp_font_size(11), 12);
        assert_eq!(clamp_font_size(12), 12);
        assert_eq!(clamp_font_size(20), 20);
        assert_eq!(clamp_font_size(24), 24);
        assert_eq!(clamp_font_size(25), 24);
        assert_eq!(clamp_font_size(0), 12);
        assert_eq!(clamp_font_size(100), 24);
        assert_eq!(clamp_font_size(-5), 12);
    }

    #[test]
    fn line_height_picks_nearest_allowed() {
        // 严格三档 → 保持
        assert!((clamp_line_height(1.4) - 1.4).abs() < 1e-3);
        assert!((clamp_line_height(1.6) - 1.6).abs() < 1e-3);
        assert!((clamp_line_height(1.8) - 1.8).abs() < 1e-3);
        // 越界 → 最接近
        assert!((clamp_line_height(2.5) - 1.8).abs() < 1e-3);
        assert!((clamp_line_height(0.5) - 1.4).abs() < 1e-3);
        assert!((clamp_line_height(1.0) - 1.4).abs() < 1e-3);
    }

    #[test]
    fn preferences_serializes_camel_case() {
        let p = Preferences {
            theme: ThemeMode::Dark,
            font_size: 20,
            line_height: 1.8,
            language: Language::EnUs,
        };
        let v = serde_json::to_value(&p).unwrap();
        assert_eq!(v["theme"], "dark");
        assert_eq!(v["fontSize"], 20);
        assert!((v["lineHeight"].as_f64().unwrap() - 1.8).abs() < 1e-6);
        // T15 (FR-05): language 字段 camelCase.
        assert_eq!(v["language"], "en-US");
        // 字段名应是 camelCase (无 snake_case)
        assert!(v.get("font_size").is_none());
        assert!(v.get("line_height").is_none());
    }

    #[test]
    fn language_defaults_to_zh_cn() {
        let p = Preferences::default();
        assert_eq!(p.language, Language::ZhCn);
    }

    #[test]
    fn parse_language_accepts_known_values() {
        assert_eq!(parse_language("zh-CN"), Language::ZhCn);
        assert_eq!(parse_language("en-US"), Language::EnUs);
    }

    #[test]
    fn parse_language_falls_back_to_zh_cn_for_unknown() {
        // T15 (FR-05): AC-05-2 非法值回退.
        assert_eq!(parse_language("fr-FR"), Language::ZhCn);
        assert_eq!(parse_language(""), Language::ZhCn);
        assert_eq!(parse_language("EN-US"), Language::ZhCn); // case sensitive.
    }

    #[test]
    fn raw_preferences_handles_missing_fields() {
        // 部分字段缺失 → Default 填充 (用于 sanitize 前的中间态).
        let raw: RawPreferences = serde_json::from_value(serde_json::json!({})).unwrap();
        assert!(raw.theme.is_none());
        assert!(raw.font_size.is_none());
        assert!(raw.line_height.is_none());
    }

    #[test]
    fn raw_preferences_accepts_unknown_theme_without_error() {
        // 即便 theme 是 "sepia", RawPreferences 也能反序列化 (后续 sanitize 兜底).
        let raw: RawPreferences =
            serde_json::from_value(serde_json::json!({"theme": "sepia"})).unwrap();
        assert_eq!(raw.theme.as_deref(), Some("sepia"));
    }

    #[test]
    fn raw_preferences_accepts_out_of_range_numbers() {
        let raw: RawPreferences = serde_json::from_value(serde_json::json!({
            "theme": "dark",
            "fontSize": 200,
            "lineHeight": 2.5
        }))
        .unwrap();
        assert_eq!(raw.font_size, Some(200));
        assert_eq!(raw.line_height, Some(2.5));
    }

    #[test]
    fn raw_preferences_fails_on_malformed_json() {
        // 非对象 / 字段类型错误应被拒绝 (返回错误 → 触发 Encoding fallback).
        let bad = serde_json::json!("not an object");
        let result: Result<RawPreferences, _> = serde_json::from_value(bad);
        assert!(result.is_err());
    }
}
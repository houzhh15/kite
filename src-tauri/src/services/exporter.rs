// src-tauri/src/services/exporter.rs — T16-P2 (FR-01) 导出 HTML 服务.
//
// 设计依据: docs/design/compiled.md §3.4 + 需求 FR-01 / NFR-S-04.
//
// 责任:
//   - export_html(content, target_path) -> Result<(), AppError>:
//     1) 校验 content 字节数 ≤ MAX_HTML_BYTES (5 MB) → E001.
//     2) validate_target_path 黑名单 (/System, /Library, C:\Windows, C:\Program Files) → E002.
//     3) 扩展名校验 .html → E002.
//     4) std::fs::write 写入, IO 错误映射 E003.
//   - 不读图片; 图片 base64 嵌入由前端 buildHtml 完成 (设计 §3.3.3 流水线).
//
// 错误码 (与 error.rs 一致):
//   - E001 / PAYLOAD_TOO_LARGE: content 超过 5 MB.
//   - E002 / INVALID_TARGET_PATH: 路径非法或系统目录 / 扩展名错.
//   - E003 / IO: 写入失败.
//   - E005 / EXPORT_ENCODING: 字符串非 UTF-8 (无法在 String 上直接表达, 这里靠前置校验保证).

use std::fs;
use std::path::{Path, PathBuf};

use crate::error::AppError;

/// HTML payload 体积上限 (设计 §3.4.1 / NFR-P-01 / 需求 5.2 约束).
pub const MAX_HTML_BYTES: usize = 5 * 1024 * 1024;

/// 公开入口 — 与 commands.rs #[tauri::command] export_html 签名一致.
///
/// 行为契约:
///   - content 长度 ≤ 5 MB, target_path 后缀 .html, 父目录可写 → 写入并返回 Ok(()).
///   - 失败映射为 AppError, code ∈ { PAYLOAD_TOO_LARGE, INVALID_TARGET_PATH, IO, EXPORT_ENCODING }.
pub fn export_html(content: String, target_path: PathBuf) -> Result<(), AppError> {
    // 1) 体积上限.
    if content.len() > MAX_HTML_BYTES {
        return Err(AppError::PayloadTooLarge {
            actual: content.len(),
            limit: MAX_HTML_BYTES,
        });
    }

    // 2) 路径校验: 黑名单 + 扩展名.
    validate_target_path(&target_path)?;

    // 3) UTF-8 校验 (E005). String::from_utf8 验证; 此处 content 已是 String,
    //    但保留一道兜底, 防止未来调用方传 &str 含未校验字节.
    if !is_strict_utf8(content.as_bytes()) {
        return Err(AppError::ExportEncoding("content not strict utf-8".into()));
    }

    // 4) 写入.
    fs::write(&target_path, content.as_bytes())?;
    Ok(())
}

/// validate_target_path — 公开给单测, 内部使用.
///
/// 黑名单:
///   - macOS: /System, /Library
///   - Windows: C:\Windows, C:\Program Files (大小写不敏感)
///   - 扩展名必须 .html (大小写不敏感)
///
/// 实现:
///   - canonicalize 失败 (路径不存在) 时仍允许写入; 只要扩展名匹配.
pub fn validate_target_path(path: &Path) -> Result<(), AppError> {
    // 1) 扩展名校验.
    let ext_ok = path
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.eq_ignore_ascii_case("html"))
        .unwrap_or(false);
    if !ext_ok {
        return Err(AppError::InvalidTargetPath(format!(
            "target extension must be .html (got: {:?})",
            path.extension().and_then(|s| s.to_str())
        )));
    }

    // 2) 黑名单 (canonicalize 优先; 不存在时回退 raw).
    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let raw_str = path.to_string_lossy().to_lowercase();
    let canon_str = canonical.to_string_lossy().to_lowercase();

    let blocked_macos = ["/system", "/library"];
    let blocked_win = ["c:\\windows", "c:\\program files"];

    for prefix in blocked_macos.iter().chain(blocked_win.iter()) {
        if raw_str.starts_with(prefix) || canon_str.starts_with(prefix) {
            return Err(AppError::InvalidTargetPath(format!(
                "target path is blocked: {}",
                path.display()
            )));
        }
    }

    Ok(())
}

/// is_strict_utf8 — 严格 UTF-8 校验 (替代 std::str::from_utf8 unwrap 风格).
fn is_strict_utf8(bytes: &[u8]) -> bool {
    std::str::from_utf8(bytes).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn validate_target_path_accepts_html_extension() {
        let p = PathBuf::from("/tmp/foo.html");
        assert!(validate_target_path(&p).is_ok());
    }

    #[test]
    fn validate_target_path_accepts_uppercase_html_extension() {
        let p = PathBuf::from("/tmp/FOO.HTML");
        assert!(validate_target_path(&p).is_ok());
    }

    #[test]
    fn validate_target_path_rejects_non_html_extension() {
        let p = PathBuf::from("/tmp/foo.txt");
        assert!(validate_target_path(&p).is_err());
    }

    #[test]
    fn validate_target_path_rejects_system_dir_mac() {
        let p = PathBuf::from("/System/foo.html");
        assert!(validate_target_path(&p).is_err());
        let p2 = PathBuf::from("/Library/bar.html");
        assert!(validate_target_path(&p2).is_err());
    }

    #[test]
    fn validate_target_path_rejects_windows_protected_dirs() {
        let p = PathBuf::from("C:\\Windows\\foo.html");
        assert!(validate_target_path(&p).is_err());
        let p2 = PathBuf::from("C:\\Program Files\\bar.html");
        assert!(validate_target_path(&p2).is_err());
    }

    #[test]
    fn export_html_rejects_payload_too_large() {
        // 构造 5 MB + 1 字节.
        let big = "x".repeat(MAX_HTML_BYTES + 1);
        let target = std::env::temp_dir().join(format!(
            "kite-export-{}.html",
            std::process::id()
        ));
        let err = export_html(big, target).expect_err("should reject");
        assert!(matches!(err, AppError::PayloadTooLarge { .. }));
        assert_eq!(err.code(), "PAYLOAD_TOO_LARGE");
    }

    #[test]
    fn export_html_rejects_invalid_target_path() {
        let target = PathBuf::from("/tmp/foo.txt");
        let err = export_html("hello".into(), target).expect_err("should reject");
        assert!(matches!(err, AppError::InvalidTargetPath(_)));
        assert_eq!(err.code(), "INVALID_TARGET_PATH");
    }

    #[test]
    fn export_html_writes_file_when_valid() {
        let target = std::env::temp_dir().join(format!(
            "kite-export-{}-{}.html",
            std::process::id(),
            chrono_like_now()
        ));
        let html = "<!DOCTYPE html><html><body>hi</body></html>";
        export_html(html.into(), target.clone()).expect("should succeed");
        let read_back = std::fs::read_to_string(&target).expect("read");
        assert_eq!(read_back, html);
        // 清理.
        let _ = std::fs::remove_file(&target);
    }

    /// chrono-less now — 用于文件名去重.
    fn chrono_like_now() -> u128 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    }
}
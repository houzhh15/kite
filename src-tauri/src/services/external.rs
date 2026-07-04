// src-tauri/src/services/external.rs (T19 重写)
//
// FR-02 / NFR-S-01: Rust 端协议白名单; 调用 tauri-plugin-shell 的 open 唤起系统默认程序.
//
// 架构依据: docs/architecture_design/compiled.md §3.2/§3.3 + 需求 §3 FR-02 + 设计 §3.7.
//
// 行为契约 (T19):
//   - validate(url) -> Result<Scheme, AppError>
//       Ok(Scheme) 当 scheme ∈ {http, https, mailto, tel}; 否则 Err(InvalidPath).
//   - open(app, url) -> Result<(), AppError>
//       校验 + log + app.shell().open(url, None).
//   - shell.open 不会触达 host 目录, 仅 fork 系统默认 program (macOS `open` / Windows `start` / Linux `xdg-open`).
//
// 约束:
//   - C-01: 复用既有 `AppError::InvalidPath(String)` 携带协议名/reason, 不新增 enum 变体.
//   - C-04: 仅依赖 tauri-plugin-shell (已是 [dependencies] 一项), 无新增 crate.
//   - reason schema 与 TS `urlSafe.reason` 字段保持一致:
//       "protocol:<head>" / "protocol:data-html" / "data:image" / "empty url" / "too-long".

use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

use crate::error::AppError;

/// 最大 URL 长度. 与 TS `urlSafe.MAX_URL_LENGTH` 对齐.
const MAX_URL_LENGTH: usize = 2048;

/// 白名单协议 (小写, 不含冒号).
const SCHEMES: [&str; 4] = ["http", "https", "mailto", "tel"];

/// Scheme 枚举 — 仅在 services 内部使用, 不外暴给 IPC 层.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Scheme {
    Http,
    Https,
    Mailto,
    Tel,
}

/// validate — 协议白名单 + 长度/空串守卫.
///
/// 输入:
///   - url: 原始 URL 字符串 (UTF-8)
/// 输出:
///   - Ok(Scheme) — 白名单命中
///   - Err(AppError::InvalidPath(reason)) — 拒绝, reason 是稳定字符串 schema
///
/// reason schema (与 TS urlSafe 对齐):
///   - "empty url"     — url trim 后为空
///   - "too-long"      — url 长度超过 MAX_URL_LENGTH
///   - "data:image"    — data:image/... (本命令不在白名单, 由 ImageHandler 在 <img> 上下文独立处理)
///   - "protocol:data-html" — data: 非 image 子类型
///   - "protocol:<head>"   — 危险/未知协议, head 取字母前缀
pub fn validate(url: &str) -> Result<Scheme, AppError> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidPath("empty url".into()));
    }
    if trimmed.len() > MAX_URL_LENGTH {
        return Err(AppError::InvalidPath("too-long".into()));
    }

    let lower = trimmed.to_ascii_lowercase();

    // data: 子类型细分: 与 TS urlSafe.ts 一致, 非 data:image/ 全部视为 data-html 拒绝.
    if let Some(rest) = lower.strip_prefix("data:") {
        if rest.starts_with("image/") {
            // data:image 不在本命令白名单 (本命令是 <a> 唤起系统浏览器),
            // 真实 data:image 仅在 <img> 上下文出现, 走 resolve_image_path.
            return Err(AppError::InvalidPath("data:image".into()));
        }
        return Err(AppError::InvalidPath("protocol:data-html".into()));
    }

    // 白名单: `http://` / `https://` / `mailto:` / `tel:` (大小写归一化后)
    // 先尝试带 `://` 的 http(s); 再尝试不带 `://` 的 mailto/tel (mailto:user@host / tel:+1xxx).
    let scheme_str = SCHEMES
        .iter()
        .find(|s| {
            let with_slashes = format!("{}://", s);
            let bare = format!("{}:", s);
            lower.starts_with(&with_slashes) || lower.starts_with(&bare)
        })
        .ok_or_else(|| AppError::InvalidPath(format!("protocol:{}", extract_head(&lower))))?;

    Ok(match *scheme_str {
        "http" => Scheme::Http,
        "https" => Scheme::Https,
        "mailto" => Scheme::Mailto,
        "tel" => Scheme::Tel,
        _ => unreachable!("SCHEMES iter guards length"),
    })
}

/// extract_head — 取首个 `:` 之前的 ASCII 字母片段, 用于 reason.
/// 不可识别时回退 `"unknown"` (与 TS extractHost 一致).
/// 注意: 本函数假定入参已经是小写 (validate 内部将 lower.to_ascii_lowercase() 传入),
/// 以保证 reason schema 在大小写归一化后保持稳定 ("protocol:javascript" 而非 "protocol:JaVaScRiPt").
fn extract_head(input: &str) -> String {
    let head: String = input
        .chars()
        .take_while(|c| c.is_ascii_alphabetic())
        .collect();
    if head.is_empty() {
        "unknown".to_string()
    } else {
        head
    }
}

/// open — 协议校验 + 唤起系统默认程序.
///
/// 流程:
///   1. validate(&url) — 失败立即 Err(InvalidPath(reason))
///   2. log::info/eprintln 记录 scheme + url (供运维审计, NFR-S-01)
///   3. app.shell().open(url, None) — Tauri 把 URL 转发给 OS 默认程序
///
/// 错误映射:
///   - 协议拒绝 → Err(AppError::InvalidPath("protocol:<head>"))
///   - 长度越界 → Err(AppError::InvalidPath("too-long"))
///   - 空串    → Err(AppError::InvalidPath("empty url"))
///   - shell.open 内部失败 → Err(AppError::InvalidPath("shell.open failed: <e>"))
pub async fn open(app: &AppHandle, url: String) -> Result<(), AppError> {
    let scheme = validate(&url)?;
    eprintln!("[external::open] scheme={:?} url={}", scheme, url);
    app.shell()
        .open(url, None)
        .map_err(|e| AppError::InvalidPath(format!("shell.open failed: {e}")))
}

// ---------------------------------------------------------------------------
// 单元测试 (T19 step-3a ~ step-3j)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_https_ok() {
        assert_eq!(validate("https://example.com").unwrap(), Scheme::Https);
    }

    #[test]
    fn validate_http_uppercase_ok() {
        assert_eq!(validate("HTTP://EXAMPLE.COM").unwrap(), Scheme::Http);
    }

    #[test]
    fn validate_http_mixedcase_ok() {
        assert_eq!(validate("Http://Example.com").unwrap(), Scheme::Http);
    }

    #[test]
    fn validate_mailto_ok() {
        assert_eq!(
            validate("mailto:user@example.com").unwrap(),
            Scheme::Mailto
        );
    }

    #[test]
    fn validate_tel_ok() {
        assert_eq!(validate("tel:+1-555-0100").unwrap(), Scheme::Tel);
    }

    #[test]
    fn validate_javascript_rejected() {
        let err = validate("javascript:alert(1)").unwrap_err();
        match err {
            AppError::InvalidPath(reason) => assert_eq!(reason, "protocol:javascript"),
            other => panic!("expected InvalidPath, got {other:?}"),
        }
    }

    #[test]
    fn validate_vbscript_rejected() {
        let err = validate("vbscript:msgbox(1)").unwrap_err();
        match err {
            AppError::InvalidPath(reason) => assert_eq!(reason, "protocol:vbscript"),
            other => panic!("expected InvalidPath, got {other:?}"),
        }
    }

    #[test]
    fn validate_file_rejected() {
        let err = validate("file:///etc/passwd").unwrap_err();
        match err {
            AppError::InvalidPath(reason) => assert_eq!(reason, "protocol:file"),
            other => panic!("expected InvalidPath, got {other:?}"),
        }
    }

    #[test]
    fn validate_data_html_rejected() {
        let err = validate("data:text/html,<script>").unwrap_err();
        match err {
            AppError::InvalidPath(reason) => assert_eq!(reason, "protocol:data-html"),
            other => panic!("expected InvalidPath, got {other:?}"),
        }
    }

    #[test]
    fn validate_data_image_rejected() {
        // open_external_url 不在白名单收 data: 子类型 (image 走 resolve_image_path).
        let err = validate("data:image/png;base64,xxx").unwrap_err();
        match err {
            AppError::InvalidPath(reason) => assert_eq!(reason, "data:image"),
            other => panic!("expected InvalidPath, got {other:?}"),
        }
    }

    #[test]
    fn validate_empty_rejected() {
        let err = validate("").unwrap_err();
        match err {
            AppError::InvalidPath(reason) => assert_eq!(reason, "empty url"),
            other => panic!("expected InvalidPath, got {other:?}"),
        }
    }

    #[test]
    fn validate_whitespace_only_rejected() {
        // trim 后空串, 与空串同 reason (NFR-M-01 schema 稳定).
        let err = validate("   \t\n  ").unwrap_err();
        match err {
            AppError::InvalidPath(reason) => assert_eq!(reason, "empty url"),
            other => panic!("expected InvalidPath, got {other:?}"),
        }
    }

    #[test]
    fn validate_too_long_rejected() {
        let long = "x".repeat(MAX_URL_LENGTH + 1);
        let err = validate(&long).unwrap_err();
        match err {
            AppError::InvalidPath(reason) => assert_eq!(reason, "too-long"),
            other => panic!("expected InvalidPath, got {other:?}"),
        }
    }

    #[test]
    fn validate_too_long_boundary_ok() {
        // 边界: 正好 MAX_URL_LENGTH 字符应通过 (白名单命中).
        // 用 https:// + 填充到 MAX_URL_LENGTH - "https://".len() = 2040.
        let prefix = "https://a";
        let pad = "a".repeat(MAX_URL_LENGTH - prefix.len());
        let url = format!("{prefix}{pad}");
        assert_eq!(url.len(), MAX_URL_LENGTH);
        assert_eq!(validate(&url).unwrap(), Scheme::Https);
    }

    #[test]
    fn validate_unknown_scheme_rejected() {
        let err = validate("ftp://example.com").unwrap_err();
        match err {
            AppError::InvalidPath(reason) => assert_eq!(reason, "protocol:ftp"),
            other => panic!("expected InvalidPath, got {other:?}"),
        }
    }

    #[test]
    fn validate_javascript_capitalization_rejected() {
        // 大小写归一化防御 (FR-02 大小写无关).
        let err = validate("JaVaScRiPt:alert(1)").unwrap_err();
        match err {
            AppError::InvalidPath(reason) => assert_eq!(reason, "protocol:javascript"),
            other => panic!("expected InvalidPath, got {other:?}"),
        }
    }

    #[test]
    fn validate_empty_head_rejected_with_unknown() {
        // 没有 ASCII 字母前缀 (例如 "://example.com") → "protocol:unknown".
        let err = validate("://example.com").unwrap_err();
        match err {
            AppError::InvalidPath(reason) => assert_eq!(reason, "protocol:unknown"),
            other => panic!("expected InvalidPath, got {other:?}"),
        }
    }

    #[test]
    fn extract_head_returns_letters_or_unknown() {
        // 小写后的 javascript 头取字母前缀 = "javascript"
        assert_eq!(extract_head("javascript:alert(1)"), "javascript");
        // 全非字母 (数字开头) → 空 → 兜底 "unknown"
        assert_eq!(extract_head("123abc"), "unknown");
        // 完全空串 → 兜底 "unknown"
        assert_eq!(extract_head(""), "unknown");
        // 小写后 mailto
        assert_eq!(extract_head("mailto:user@example.com"), "mailto");
    }
}
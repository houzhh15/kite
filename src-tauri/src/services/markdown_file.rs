// T08 step-2a — services/markdown_file.rs
//
// 责任:
//   - `read` 读取 markdown 文本, 返回 UTF-8 字符串 (T02 既有).
//   - `resolve_image` 占位 (F-15, T07 阶段保留).
//   - `resolve_as_data_url` (T08 step-2a) — 解析 Markdown 内嵌图片
//     相对路径, 返回 data:<mime>;base64,... 字符串. 完整流程:
//       1. base_dir 必须是目录, 否则 NotFound("base not found")
//       2. target = base_dir.join(rel)
//       3. canonicalize base_dir 与 target 消除 symlink
//       4. 边界校验: target.starts_with(base_dir_canonical) 否则 InvalidPath
//       5. target 扩展名白名单 (png|jpg|jpeg|gif|webp|svg|bmp) 否则 InvalidPath
//       6. metadata().len() <= 10 * 1024 * 1024 否则 TooLarge
//       7. read 失败 → Io; base64 encode → "data:<mime>;base64,..."
//
// 错误码约定 (与 AppError 严格对应, 设计 §3.1.2):
//   - NotFound       → base_dir 不存在 / target 不存在
//   - InvalidPath    → 路径越界 / 扩展名不在白名单
//   - TooLarge       → metadata.len() > IMAGE_LIMIT_BYTES
//   - Io             → 读取失败 (走 #[from] std::io::Error)
//   - Encoding       → base64 编码失败 (本实现用 general_purpose::STANDARD, 极少失败)

use std::path::{Path, PathBuf};

use base64::Engine;
use thiserror::Error;

use crate::error::AppError;

/// 单文件大小硬上限 (markdown 文档). 与需求 NFR-C-02 / 设计 §3.1.2 对齐.
pub const LIMIT_BYTES: u64 = 50 * 1024 * 1024;

/// 图片文件大小硬上限: 10 MB. 防 OOM (设计 §3.2.1 / FR-4 AC-4-4).
pub const IMAGE_LIMIT_BYTES: u64 = 10 * 1024 * 1024;

/// markdown 文档扩展名白名单.
const ALLOWED_EXTS: &[&str] = &["md", "markdown", "mdx"];

/// 图片扩展名白名单. 其它扩展名一律 InvalidPath (FR-4 NFR-S-1).
const IMAGE_ALLOWED_EXTS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"];

/// resolve_as_data_url 的细粒度错误 (内部契约, 由 commands 转为 AppError).
/// 单独枚举便于单元测试和上层消息拼接, 但最终 IPC 出口走 AppError.
#[derive(Debug, Error)]
pub enum ResolveError {
    /// 基础目录不存在或不是目录.
    #[error("base not found: {0}")]
    BaseNotFound(String),
    /// 目标文件不存在.
    #[error("file not found: {0}")]
    FileNotFound(String),
    /// 文件大小超限.
    #[error("image too large: {actual} > {limit} bytes")]
    TooLarge { actual: u64, limit: u64 },
    /// 路径越界 (canonicalize 后不在 base_dir 内).
    #[error("path traversal blocked: {0}")]
    OutsideBaseDir(String),
    /// 扩展名不在白名单内.
    #[error("unsupported extension: {0}")]
    UnsupportedExt(String),
    /// 底层 IO 错误.
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

impl From<ResolveError> for AppError {
    fn from(e: ResolveError) -> Self {
        match e {
            ResolveError::BaseNotFound(p) | ResolveError::FileNotFound(p) => {
                AppError::NotFound(p)
            }
            ResolveError::TooLarge { actual, limit } => {
                AppError::TooLarge { actual, limit }
            }
            ResolveError::OutsideBaseDir(p) => AppError::InvalidPath(format!(
                "path traversal blocked: {p}"
            )),
            ResolveError::UnsupportedExt(ext) => {
                AppError::InvalidPath(format!("extension not allowed: {ext}"))
            }
            ResolveError::Io(e) => AppError::Io(e),
        }
    }
}

/// 扩展名是否在 markdown 白名单内 (大小写不敏感).
fn is_allowed_ext(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|s| {
            let s = s.to_ascii_lowercase();
            ALLOWED_EXTS.iter().any(|a| *a == s.as_str())
        })
        .unwrap_or(false)
}

/// 扩展名是否在图片白名单内 (大小写不敏感).
fn is_image_ext(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|s| {
            let s = s.to_ascii_lowercase();
            IMAGE_ALLOWED_EXTS.iter().any(|a| *a == s.as_str())
        })
        .unwrap_or(false)
}

/// MIME 推断 — 按图片扩展名返回标准 MIME; 找不到返回 None.
fn mime_for_ext(path: &Path) -> Option<&'static str> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())?;
    match ext.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "svg" => Some("image/svg+xml"),
        "bmp" => Some("image/bmp"),
        _ => None,
    }
}

/// 读取 markdown 文件内容.
///
/// 顺序固定, 保证错误信号稳定可测:
///   1. 路径不存在 → NotFound
///   2. 不是常规文件 → InvalidPath
///   3. 扩展名拒绝 → InvalidPath
///   4. metadata → 大小校验
///   5. 读取全量 bytes → 校验 UTF-8
///
/// 整个流程保持 **同步**: Tauri 命令包装为 `async fn` 由 tokio runtime
/// 调度, IO 在 blocking pool 中执行, 不阻塞 UI 渲染.
pub async fn read(path: &Path) -> Result<String, AppError> {
    let metadata = match std::fs::metadata(path) {
        Ok(m) => m,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Err(AppError::NotFound(path.display().to_string()));
        }
        Err(err) => return Err(AppError::Io(err)),
    };

    if !metadata.is_file() {
        return Err(AppError::InvalidPath(format!(
            "path {} is not a regular file",
            path.display()
        )));
    }

    if !is_allowed_ext(path) {
        return Err(AppError::InvalidPath(format!(
            "unsupported extension for {}",
            path.display()
        )));
    }

    let size = metadata.len();
    if size > LIMIT_BYTES {
        return Err(AppError::TooLarge {
            actual: size,
            limit: LIMIT_BYTES,
        });
    }

    let bytes = std::fs::read(path)?;
    let text = String::from_utf8(bytes).map_err(|e| AppError::Encoding(e.to_string()))?;
    Ok(text)
}

/// resolve_image — 占位 (T07 既有, 不删除以防 T07 引用).
pub async fn resolve_image(_base: &Path, _rel: &Path) -> Result<PathBuf, AppError> {
    unimplemented!("resolve_image 计划在 T07 阶段落地 (PathBuf 形态)")
}

/// resolve_as_data_url — T08 step-2a.
///
/// 把 `rel` 相对 `base_dir` 解析为 data URL (`data:<mime>;base64,...`).
/// 安全:
///   - 必须 `canonicalize` 后 `target.starts_with(base_dir_canonical)` 仍成立
///     (NFR-S-1 路径穿越防护).
///   - 扩展名必须在白名单内 (`png|jpg|jpeg|gif|webp|svg|bmp`).
///   - 文件大小 ≤ 10 MB (FR-4 AC-4-4 / NFR-P-4).
pub async fn resolve_as_data_url(
    base_dir: &Path,
    rel: &Path,
) -> Result<String, ResolveError> {
    // 1) base_dir 必须存在且是目录
    let base_meta = std::fs::metadata(base_dir)
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                ResolveError::BaseNotFound(base_dir.display().to_string())
            } else {
                ResolveError::Io(e)
            }
        })?;
    if !base_meta.is_dir() {
        return Err(ResolveError::BaseNotFound(base_dir.display().to_string()));
    }

    // 2) 拼接 + canonicalize (消除 symlink 越界)
    let target = base_dir.join(rel);
    let base_canonical = std::fs::canonicalize(base_dir).map_err(ResolveError::Io)?;
    let target_canonical = std::fs::canonicalize(&target).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            ResolveError::FileNotFound(target.display().to_string())
        } else {
            ResolveError::Io(e)
        }
    })?;

    // 3) 边界校验: target 必须在 base_dir 之内 (NFR-S-1)
    if !target_canonical.starts_with(&base_canonical) {
        return Err(ResolveError::OutsideBaseDir(
            target_canonical.display().to_string(),
        ));
    }

    // 4) 扩展名白名单
    if !is_image_ext(&target_canonical) {
        let ext = target_canonical
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_string();
        return Err(ResolveError::UnsupportedExt(ext));
    }

    // 5) 大小硬上限 (FR-4 AC-4-4)
    let size = std::fs::metadata(&target_canonical)
        .map_err(ResolveError::Io)?
        .len();
    if size > IMAGE_LIMIT_BYTES {
        return Err(ResolveError::TooLarge {
            actual: size,
            limit: IMAGE_LIMIT_BYTES,
        });
    }

    // 6) 读 bytes + base64
    let bytes = std::fs::read(&target_canonical)?;
    let mime = mime_for_ext(&target_canonical)
        .ok_or_else(|| ResolveError::UnsupportedExt("<unknown>".into()))?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{mime};base64,{encoded}"))
}

// ------------------ 单元测试 ------------------
//
// 覆盖 (设计 §3.2.1 + 计划 Step 2a):
//   - read: NotFound / InvalidPath / 正常 / Encoding / 目录
//   - resolve_as_data_url: 正常 PNG / 缺失 / 越界 / 10MB+ / 扩展名拒绝
#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn tmp_dir() -> std::path::PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("kite-t08-{}", std::process::id()));
        std::fs::create_dir_all(&p).expect("create tmp dir");
        p
    }

    fn write_png(path: &Path, size: usize) {
        // 1x1 transparent PNG signature, 之后用 0 填充至 size.
        const SIG: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
        let mut f = std::fs::File::create(path).expect("create png");
        f.write_all(&SIG).expect("write sig");
        let remaining = size.saturating_sub(SIG.len());
        let buf = vec![0u8; remaining];
        f.write_all(&buf).expect("write pad");
        f.sync_all().ok();
    }

    // ---- read 既有测试 (T02 保留) ----

    #[tokio::test(flavor = "current_thread")]
    async fn read_returns_not_found_for_missing_path() {
        let path = tmp_dir().join("__definitely_missing__.md");
        let err = read(&path).await.expect_err("must fail");
        match err {
            AppError::NotFound(_) => {}
            other => panic!("expected NotFound, got {other:?}"),
        }
    }

    #[tokio::test(flavor = "current_thread")]
    async fn read_rejects_non_markdown_extension() {
        let dir = tmp_dir();
        let path = dir.join("note.txt");
        std::fs::File::create(&path).expect("create txt");
        let err = read(&path).await.expect_err("must fail");
        match err {
            AppError::InvalidPath(msg) => assert!(msg.contains("unsupported")),
            other => panic!("expected InvalidPath, got {other:?}"),
        }
    }

    #[tokio::test(flavor = "current_thread")]
    async fn read_returns_text_for_valid_markdown_file() {
        let dir = tmp_dir();
        let path = dir.join("hello.md");
        let body = "# Title\n\nhello, **world**";
        std::fs::write(&path, body).expect("write md");
        let got = read(&path).await.expect("read ok");
        assert_eq!(got, body);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn read_rejects_non_utf8_bytes_as_encoding_error() {
        let dir = tmp_dir();
        let path = dir.join("binary.md");
        let mut f = std::fs::File::create(&path).expect("create");
        f.write_all(&[0xFF, 0xFE, 0xFD]).expect("write bytes");
        f.sync_all().ok();
        let err = read(&path).await.expect_err("must fail");
        match err {
            AppError::Encoding(_) => {}
            other => panic!("expected Encoding, got {other:?}"),
        }
    }

    #[tokio::test(flavor = "current_thread")]
    async fn read_rejects_directory_as_invalid_path() {
        let dir = tmp_dir();
        let err = read(&dir).await.expect_err("directory must not be openable");
        match err {
            AppError::InvalidPath(_) => {}
            other => panic!("expected InvalidPath, got {other:?}"),
        }
    }

    // ---- resolve_as_data_url 测试 (T08 step-2a) ----

    #[tokio::test(flavor = "current_thread")]
    async fn resolve_as_data_url_returns_data_url_for_valid_png() {
        let dir = tmp_dir();
        let assets = dir.join("assets");
        std::fs::create_dir_all(&assets).expect("mkdir assets");
        let png = assets.join("x.png");
        write_png(&png, 256);

        let got = resolve_as_data_url(&dir, Path::new("assets/x.png"))
            .await
            .expect("ok");
        assert!(got.starts_with("data:image/png;base64,"), "got prefix: {got}");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn resolve_as_data_url_rejects_missing_file() {
        let dir = tmp_dir();
        let err = resolve_as_data_url(&dir, Path::new("assets/missing.png"))
            .await
            .expect_err("must fail");
        match err {
            ResolveError::FileNotFound(_) => {}
            other => panic!("expected FileNotFound, got {other:?}"),
        }
    }

    #[tokio::test(flavor = "current_thread")]
    async fn resolve_as_data_url_blocks_path_traversal() {
        let dir = tmp_dir();
        // 构造: 父目录/outside.png 真实存在
        let outside = dir.join("outside.png");
        write_png(&outside, 16);
        // base_dir = dir/sub (sub 不存在, 但我们会 canonicalize base_dir 后再判断)
        let sub = dir.join("sub");
        std::fs::create_dir_all(&sub).expect("mkdir sub");

        // rel = "../outside.png" → 解析后落在 base_dir (sub) 之外
        let err = resolve_as_data_url(&sub, Path::new("../outside.png"))
            .await
            .expect_err("must fail");
        match err {
            ResolveError::OutsideBaseDir(_) => {}
            other => panic!("expected OutsideBaseDir, got {other:?}"),
        }
    }

    #[tokio::test(flavor = "current_thread")]
    async fn resolve_as_data_url_rejects_oversize() {
        let dir = tmp_dir();
        let assets = dir.join("assets");
        std::fs::create_dir_all(&assets).expect("mkdir assets");
        let big = assets.join("big.png");
        // 11 MB > 10 MB 上限
        write_png(&big, 11 * 1024 * 1024);

        let err = resolve_as_data_url(&dir, Path::new("assets/big.png"))
            .await
            .expect_err("must fail");
        match err {
            ResolveError::TooLarge { actual, limit } => {
                assert!(actual > limit, "actual={actual} limit={limit}");
                assert_eq!(limit, IMAGE_LIMIT_BYTES);
            }
            other => panic!("expected TooLarge, got {other:?}"),
        }
    }

    #[tokio::test(flavor = "current_thread")]
    async fn resolve_as_data_url_rejects_disallowed_extension() {
        let dir = tmp_dir();
        let path = dir.join("doc.pdf");
        std::fs::write(&path, b"not an image").expect("write pdf");
        let err = resolve_as_data_url(&dir, Path::new("doc.pdf"))
            .await
            .expect_err("must fail");
        match err {
            ResolveError::UnsupportedExt(_) => {}
            other => panic!("expected UnsupportedExt, got {other:?}"),
        }
    }
}

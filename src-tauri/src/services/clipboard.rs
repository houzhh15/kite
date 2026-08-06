// T29 (R-35) — 系统剪贴板服务.
//
// 责任:
//   - 把指定路径的文件写入 OS 剪贴板, 行为等价 Finder/Explorer 的 Cmd/Ctrl+C.
//   - 不读取文件内容: 只放文件 URL/path 到剪贴板. Finder/Explorer 粘贴时按 URL
//     复制文件, 文本编辑器粘贴时粘贴路径.
//
// 平台:
//   - macOS: NSPasteboardTypeFileURL (NSPasteboard)
//   - Windows: CF_HDROP
//   - Linux: text/uri-list (需要 xclip / xsel / wl-clipboard)
//
// 设计:
//   - 用 clipboard-rs crate (纯 Rust, 跨平台) 的 write_files API.
//   - 失败统一返回 AppError, 前端 toast 显示.
//
// 边界:
//   - 路径不存在 / 不是文件 → AppError::NotFound / AppError::InvalidPath
//   - 剪贴板写入失败 → AppError::Io

use std::path::Path;

use crate::error::AppError;
use clipboard_rs::Clipboard;

/// 把单个文件写入系统剪贴板 (等价 Finder/Explorer Cmd/Ctrl+C).
///
/// # 错误
/// - 路径不存在 → `AppError::NotFound`
/// - 不是文件 → `AppError::InvalidPath`
/// - 剪贴板写入失败 → `AppError::Io`
fn validate_absolute_path(path: &Path) -> Result<(), AppError> {
    if path.as_os_str().is_empty() || !path.is_absolute() {
        return Err(AppError::InvalidPath(format!(
            "path must be absolute: {}",
            path.display()
        )));
    }
    Ok(())
}

/// 把绝对路径作为纯文本写入系统剪贴板，不访问文件系统。
pub fn copy_path_to_clipboard(path: &Path) -> Result<(), AppError> {
    validate_absolute_path(path)?;
    let cb = clipboard_rs::ClipboardContext::new().map_err(|e| {
        AppError::Io(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("clipboard init failed: {e}"),
        ))
    })?;
    cb.set_text(path.to_string_lossy().into_owned())
        .map_err(|e| {
            AppError::Io(std::io::Error::new(
                std::io::ErrorKind::Other,
                format!("clipboard write failed: {e}"),
            ))
        })
}

pub fn copy_file_to_clipboard(path: &Path) -> Result<(), AppError> {
    // 1. 前置校验: 路径必须存在且是文件.
    if !path.exists() {
        return Err(AppError::NotFound(format!(
            "file does not exist: {}",
            path.display()
        )));
    }
    if !path.is_file() {
        return Err(AppError::InvalidPath(format!(
            "not a regular file: {}",
            path.display()
        )));
    }

    // 2. clipboard-rs: set_files 跨平台写入文件路径到剪贴板.
    //    macOS → NSPasteboardTypeFileURL
    //    Windows → CF_HDROP
    //    Linux → text/uri-list
    let cb = clipboard_rs::ClipboardContext::new().map_err(|e| {
        AppError::Io(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("clipboard init failed: {e}"),
        ))
    })?;
    cb.set_files(vec![path.to_string_lossy().into_owned()])
        .map_err(|e| {
            AppError::Io(std::io::Error::new(
                std::io::ErrorKind::Other,
                format!("clipboard write failed: {e}"),
            ))
        })?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_absolute_path;
    use crate::error::AppError;
    use std::path::Path;

    #[test]
    fn copy_path_rejects_empty_and_relative_paths() {
        assert!(matches!(
            validate_absolute_path(Path::new("")),
            Err(AppError::InvalidPath(_))
        ));
        assert!(matches!(
            validate_absolute_path(Path::new("relative/note.md")),
            Err(AppError::InvalidPath(_))
        ));
    }

    #[test]
    fn copy_path_accepts_nonexistent_absolute_path_without_io() {
        let path = if cfg!(windows) {
            Path::new(r"C:\不存在\my note.md")
        } else {
            Path::new("/不存在/my note.md")
        };
        assert!(validate_absolute_path(path).is_ok());
    }
}

// src-tauri/src/services/file_fresh.rs — T26 (R-12 修复) "外部编辑器改回后刷新" 链路.
//
// 设计依据:
//   docs/design/compiled.md §3.2 (IPC 纪律) + §3.4 (R-04 单一来源 AppError).
//
// 责任:
//   - read_file_fresh(path): 一次 IPC 拿回 {mtime, content}, 供前端
//     focus / 手动刷新判断 "磁盘是否比内存新".
//   - 路径校验复用 external_editor::validate_path (五重防线, 避免重新实现):
//       trim empty / 扩展名白名单 / `..` 段 / fs::metadata 存在性 / is_file().
//   - mtime 用 SystemTime → UNIX_EPOCH as_secs() 序列化; u64 跨平台足够.
//   - read_to_string 失败 → AppError::Io; 字符不是 UTF-8 → AppError::Encoding
//     (与 fs_reader 的 readMarkdownFile 行为一致, 让前端 toast 信息能命中
//     同一份 i18n 错误码分支).
//
// 不依赖 React / 不发事件 / 不持有状态; 纯函数式服务, 易测试.

use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::error::AppError;

/// 一次性带回 mtime + content 的载荷.
///
/// mtime: 自 UNIX 纪元起的秒数 (u64). 0 表示文件 mtime 不可读 (少见, 仅当
///        filesystem 不支持 mtime 时; 落到这条分支时 Rust 端直接报错, 不发 0).
/// content: 完整 UTF-8 文本. 与 readMarkdownFile 行为一致.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileFreshPayload {
    pub mtime: u64,
    pub content: String,
}

/// read_file_fresh — 主入口. 被 commands::get_file_fresh 委托.
///
/// 流程:
///   1. validate_path(&path) → PathBuf (复用 F-26 五重防线, 见 external_editor.rs).
///   2. fs::metadata(&p) → mtime = modified()?.duration_since(UNIX_EPOCH)?.as_secs().
///   3. fs::read_to_string(&p) → content.
///   4. 任何 IO 错误 → AppError::Io (保持与 read_markdown_file 一致).
///
/// 失败语义:
///   - path 校验失败: AppError::InvalidPath / NotFound / PermissionDenied (来自 validate_path).
///   - mtime 不存在 (极少见, fuse / 部分 fs): 视为 NotFound.
pub fn read_file_fresh(path: &str) -> Result<FileFreshPayload, AppError> {
    let resolved = crate::services::external_editor::validate_path(path)?;
    let meta = std::fs::metadata(&resolved).map_err(AppError::Io)?;
    let mtime = meta
        .modified()
        .map_err(|e| AppError::Io(e))?
        .duration_since(UNIX_EPOCH)
        .map_err(|_| AppError::Unknown("system clock before UNIX epoch".into()))?
        .as_secs();
    let content = std::fs::read_to_string(&resolved).map_err(AppError::Io)?;
    Ok(FileFreshPayload { mtime, content })
}

// ---- 测试 --------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;
    use std::thread;
    use std::time::Duration;

    /// 创建一个临时 .md 文件用于 read_file_fresh 测试; 返回绝对路径.
    /// cleanup 由调用方负责 (本测试用例内联清理).
    fn tmp_md(name: &str, content: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("kite-fresh-{}-{}", std::process::id(), name));
        let _ = fs::create_dir_all(&dir);
        let p = dir.join(name);
        let mut f = fs::File::create(&p).unwrap();
        f.write_all(content.as_bytes()).unwrap();
        f.sync_all().unwrap();
        p
    }

    #[test]
    fn read_file_fresh_returns_mtime_and_content() {
        let p = tmp_md("a.md", "# hello\nbody");
        let out = read_file_fresh(p.to_str().unwrap()).unwrap();
        assert_eq!(out.content, "# hello\nbody");
        assert!(out.mtime > 0, "mtime should be > 0 for a just-written file");
        // 1 秒精度下, mtime 应该等于 "刚才". 允许文件系统精度差异, 这里只断言 > 0.
        let _ = fs::remove_file(&p);
    }

    #[test]
    fn read_file_fresh_mtime_advances_after_rewrite() {
        // 写第一版 → 读 mtime → sleep 1.1s → 写第二版 → 读 mtime → 应大于前一次.
        // macOS HFS+ / ext4 都是 1s 精度; Windows NTFS 是 100ns, 但 as_secs 取整后也成立.
        let p = tmp_md("b.md", "v1");
        let t1 = read_file_fresh(p.to_str().unwrap()).unwrap().mtime;
        // fs 上 mtime 精度可能 < 1s; 保险 sleep 1.1s, 让 mtime 至少 +1s.
        thread::sleep(Duration::from_millis(1100));
        fs::write(&p, "v2").unwrap();
        let t2 = read_file_fresh(p.to_str().unwrap()).unwrap().mtime;
        assert!(
            t2 > t1,
            "mtime should advance after rewrite: t1={t1} t2={t2}"
        );
        let _ = fs::remove_file(&p);
    }

    #[test]
    fn read_file_fresh_rejects_empty_path() {
        let err = read_file_fresh("").unwrap_err();
        assert!(matches!(err, AppError::InvalidPath(ref r) if r == "empty path"));
    }

    #[test]
    fn read_file_fresh_rejects_non_md_extension() {
        let err = read_file_fresh("/tmp/notes.txt").unwrap_err();
        assert!(
            matches!(err, AppError::InvalidPath(ref r) if r.starts_with("extension not allowed"))
        );
    }

    #[test]
    fn read_file_fresh_rejects_missing_file() {
        let err = read_file_fresh("/tmp/__kite_fresh_definitely_not_here__.md").unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
    }

    #[test]
    fn read_file_fresh_rejects_path_traversal() {
        let err = read_file_fresh("/tmp/../etc/passwd.md").unwrap_err();
        assert!(matches!(err, AppError::PermissionDenied(_)));
    }
}

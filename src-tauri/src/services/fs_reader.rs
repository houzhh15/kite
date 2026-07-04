// T15 — FR-02 services/fs_reader.rs
//
// 责任:
//   - 服务层 list_dir: 给定目录路径, 返回受限的 Markdown 条目 (文件
//     扩展名白名单; 目录保留「含至少一个 md 子项」的)。
//   - 错误码统一 AppError; 路径越权走 PermissionDenied; 非目录
//     NotADirectory; 不存在 NotFound; IO 错误 Io.
//
// 算法 (设计 §3.2):
//   1. 路径校验: 不存在 → NotFound; 是文件 → NotADirectory.
//   2. 遍历一级目录条目 (std::fs::read_dir → 不递归).
//   3. 条目类型分流:
//      - file: 扩展名 .md/.markdown/.mdx (大小写不敏感) → 保留.
//      - dir:  立即一级下钻; 若含至少一个 md 子项 → 保留 (否则丢弃).
//      - 其它 (symlink/特殊文件) → 丢弃.
//   4. 排序: 目录优先 + 名称字典序 (大小写不敏感).
//   5. 返回 Vec<DirEntry { path, name, is_dir }>.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::AppError;

/// markdown 扩展名白名单 (设计 §3.2).
const MD_EXTS: &[&str] = &["md", "markdown", "mdx"];

/// DirEntry — 单条目录内容. Serialize camelCase 与前端 TypeScript 类型
/// `DirEntry` 严格对齐 (R-04 单一来源).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    /// 条目绝对路径字符串.
    pub path: String,
    /// basename (去前缀目录).
    pub name: String,
    /// true 表示目录, false 表示 .md 文件.
    pub is_dir: bool,
}

/// 扩展名是否在 markdown 白名单内 (大小写不敏感).
fn is_md_ext(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|s| MD_EXTS.contains(&s.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// 派生条目 basename. 优先用 Path::file_name; 失败回退原始字符串.
fn entry_name(path: &Path, fallback: &str) -> String {
    path.file_name()
        .and_then(|n| n.to_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| fallback.to_string())
}

/// 目录里**直接**子项是否含至少一个 md 文件 (用于一级下钻保留).
///
/// 实现: 仅扫一级 (不递归); 大小写不敏感命中白名单即视作 "含 md 子项"。
/// 出错 (permission denied 等) 不在 list_dir 主路径触发, 而在该目录的子拉取
/// 路径上; 此处忽略错误, 按空集处理 (保守: 不保留该目录)。
fn dir_has_md_child(dir: &Path) -> bool {
    match std::fs::read_dir(dir) {
        Ok(it) => {
            for ent in it.flatten() {
                let p = ent.path();
                if p.is_file() && is_md_ext(&p) {
                    return true;
                }
            }
            false
        }
        Err(_) => false,
    }
}

/// list_dir — 列出目录下的 Markdown 条目 (设计 §3.2 / FR-02).
///
/// 入参:
///   - path: 目录绝对路径字符串 (前端从用户选择得到)。
///
/// 出参:
///   - Ok(Vec<DirEntry>): 排序后 (目录优先 + 字典序) 的条目列表。
///
/// 错误:
///   - NotFound(path): 路径不存在。
///   - NotADirectory(path): 路径存在但是文件。
///   - PermissionDenied(path): 含 `..` 段 (越权守卫)。
///   - Io(io::Error): 其它 IO 失败。
pub fn list_dir(path: &str) -> Result<Vec<DirEntry>, AppError> {
    if path.is_empty() {
        return Err(AppError::InvalidPath("empty path".into()));
    }
    // 守卫: `..` 段 (含 path 自身或任一段等于 `..`).
    // Note: design §3.2 路径越权走 PermissionDenied. 这里采用 `..` 单段检查;
    // commands 层会有更严 scope 校验。
    if path.split(['/', '\\']).any(|seg| seg == "..") {
        return Err(AppError::PermissionDenied(format!(
            "path traversal blocked: {path}"
        )));
    }

    let p = PathBuf::from(path);

    // 存在性 + 类型校验.
    let meta = match std::fs::metadata(&p) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(AppError::NotFound(path.to_string()));
        }
        Err(e) => return Err(AppError::Io(e)),
    };
    if !meta.is_dir() {
        return Err(AppError::NotADirectory(path.to_string()));
    }

    let read_dir = match std::fs::read_dir(&p) {
        Ok(it) => it,
        Err(e) => return Err(AppError::Io(e)),
    };

    let mut entries: Vec<DirEntry> = Vec::new();
    for ent in read_dir.flatten() {
        let entry_path = ent.path();
        // 跳过隐藏文件 / 目录 (`.` 开头); 减少噪音.
        let name = entry_name(&entry_path, "");
        if name.starts_with('.') {
            continue;
        }
        let meta = match ent.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };

        if meta.is_dir() {
            // 保留条件: 目录直接子项含至少一个 md 文件.
            if dir_has_md_child(&entry_path) {
                entries.push(DirEntry {
                    path: entry_path.to_string_lossy().into_owned(),
                    name,
                    is_dir: true,
                });
            }
        } else if meta.is_file() && is_md_ext(&entry_path) {
            entries.push(DirEntry {
                path: entry_path.to_string_lossy().into_owned(),
                name,
                is_dir: false,
            });
        }
        // 其它 (symlink 等) 跳过.
    }

    // 排序: 目录优先 + 字典序 (大小写不敏感).
    entries.sort_by(|a, b| {
        // 目录 (is_dir=true) 排在文件之前.
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()))
    });

    Ok(entries)
}

// ---------------- 单元测试 ----------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn unique_tmpdir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "kite_fs_reader_{tag}_{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("create tmpdir");
        dir
    }

    #[test]
    fn lists_md_files_and_dirs_with_md_child_ac_02_1() {
        // AC-02-1: /tmp/notes 含 a.md, b.markdown, c.txt, subdir/d.mdx →
        //   返回 a.md, b.markdown, subdir (因含 md); 不含 c.txt.
        let dir = unique_tmpdir("ac02_1");
        fs::write(dir.join("a.md"), "A").unwrap();
        fs::write(dir.join("b.markdown"), "B").unwrap();
        fs::write(dir.join("c.txt"), "C").unwrap();
        let sub = dir.join("sub");
        fs::create_dir(&sub).unwrap();
        fs::write(sub.join("d.mdx"), "D").unwrap();

        let entries = list_dir(dir.to_str().unwrap()).expect("ok");
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["sub", "a.md", "b.markdown"]);

        // subdir 应是 is_dir, 文件是 false.
        let sub_entry = entries.iter().find(|e| e.name == "sub").unwrap();
        assert!(sub_entry.is_dir);
        let a_entry = entries.iter().find(|e| e.name == "a.md").unwrap();
        assert!(!a_entry.is_dir);
        let c_entry = entries.iter().find(|e| e.name == "c.txt");
        assert!(c_entry.is_none(), "c.txt should be filtered out");
    }

    #[test]
    fn not_found_returns_app_error_not_found_ac_02_2() {
        let dir = unique_tmpdir("ac02_2");
        let missing = dir.join("does-not-exist");
        let path = missing.to_str().unwrap().to_string();
        match list_dir(&path) {
            Err(AppError::NotFound(p)) => assert_eq!(p, path),
            other => panic!("expected NotFound, got {other:?}"),
        }
    }

    #[test]
    fn file_path_returns_not_a_directory_ac_02_3() {
        let dir = unique_tmpdir("ac02_3");
        let f = dir.join("file.md");
        fs::write(&f, "X").unwrap();
        let path = f.to_str().unwrap().to_string();
        match list_dir(&path) {
            Err(AppError::NotADirectory(p)) => assert_eq!(p, path),
            other => panic!("expected NotADirectory, got {other:?}"),
        }
    }

    #[test]
    fn rejects_dotdot_segments_as_permission_denied() {
        let bad = "/tmp/../etc";
        match list_dir(bad) {
            Err(AppError::PermissionDenied(_)) => {}
            other => panic!("expected PermissionDenied, got {other:?}"),
        }
    }

    #[test]
    fn extension_check_is_case_insensitive() {
        let dir = unique_tmpdir("case");
        fs::write(dir.join("A.MD"), "x").unwrap();
        fs::write(dir.join("B.Markdown"), "x").unwrap();
        fs::write(dir.join("c.MdX"), "x").unwrap();
        let entries = list_dir(dir.to_str().unwrap()).expect("ok");
        let names: Vec<String> = entries.iter().map(|e| e.name.clone()).collect();
        assert!(names.contains(&"A.MD".to_string()));
        assert!(names.contains(&"B.Markdown".to_string()));
        assert!(names.contains(&"c.MdX".to_string()));
    }

    #[test]
    fn directories_without_md_children_are_filtered() {
        let dir = unique_tmpdir("nomd");
        let empty = dir.join("empty");
        fs::create_dir(&empty).unwrap();
        let with_txt = dir.join("texts");
        fs::create_dir(&with_txt).unwrap();
        fs::write(with_txt.join("note.txt"), "x").unwrap();
        let entries = list_dir(dir.to_str().unwrap()).expect("ok");
        assert!(
            entries.iter().all(|e| e.name != "empty" && e.name != "texts"),
            "directories without md children should be filtered: {:?}",
            entries
        );
    }

    #[test]
    fn hidden_entries_filtered() {
        let dir = unique_tmpdir("hidden");
        fs::write(dir.join(".hidden.md"), "x").unwrap();
        fs::write(dir.join("visible.md"), "x").unwrap();
        let entries = list_dir(dir.to_str().unwrap()).expect("ok");
        let names: Vec<String> = entries.iter().map(|e| e.name.clone()).collect();
        assert_eq!(names, vec!["visible.md"]);
    }
}

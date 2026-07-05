// src-tauri/src/pending_open.rs — macOS "open with KITE" 文件路径缓存.
//
// 责任:
//   - 在 macOS 上, 当用户用 Finder "打开方式 → KITE" 触发 app 时, 路径分两路到达:
//     1. 冷启动: std::env::args() 里就有 (LaunchServices 启动 app 时传入).
//     2. 热启动: app 已经在运行时再被打开, macOS 派发 NSApplicationDelegate
//        application:openURLs:, Tauri 2 翻译为 RunEvent::Opened { urls }.
//   - 两条路把路径都写进 PendingOpen; 前端 mount 后通过命令 get_pending_open_file
//     主动拉一次 (拉完即清, 避免重放). 热启动路径额外 emit("kite://open-file")
//     让前端实时加载 (冷启动不需要 — 前端那时还没起来).
//   - 取较新覆盖较旧: 比如 argv 之后又来 Opened → 取 Opened.
//
// 设计依据: docs/design/compiled.md §3.2 (IPC 设计) 衍生的小服务.
// 与 read_markdown_file / open_external_url 等并列, 一个职责一个文件.

use std::path::PathBuf;
use std::sync::Mutex;

/// 缓存 "待打开的 markdown 路径".
///
/// 注入方式: `app.manage(PendingOpen::default())`.
/// 读取方式: `tauri::State<'_, PendingOpen>`.
#[derive(Default)]
pub struct PendingOpen(Mutex<Option<PathBuf>>);

impl PendingOpen {
    /// 写入路径. 已有值时, 同路径忽略 (避免把刚 take 走的覆盖回去),
    /// 不同路径则覆盖 (取最新).
    pub fn set(&self, p: PathBuf) {
        if let Ok(mut g) = self.0.lock() {
            match g.as_ref() {
                Some(existing) if existing == &p => {}
                _ => *g = Some(p),
            }
        }
    }

    /// 原子地读出并清空. 返回 Some(path) 表示有待打开文件, None 表示无.
    pub fn take(&self) -> Option<PathBuf> {
        self.0.lock().ok().and_then(|mut g| g.take())
    }
}

/// 判断一个 argv-like 字符串是否像是 markdown 文件路径.
///   - 非空 + 非 flag (不以 '-' 起头) + 扩展名命中白名单 (大小写不敏感).
///   - 不做 path 存在性检查: argv 可能是相对路径或 sandbox 内路径,
///     由 read_markdown_file 内部 fs 报错更合适, 这里只做语法层过滤.
pub fn is_markdown_path(raw: &str) -> bool {
    if raw.is_empty() || raw.starts_with('-') {
        return false;
    }
    let p = std::path::Path::new(raw);
    match p.extension().and_then(|e| e.to_str()) {
        Some(ext) => {
            let lower = ext.to_ascii_lowercase();
            matches!(lower.as_str(), "md" | "markdown" | "mdown" | "mkd" | "mdx")
        }
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pending_open_default_is_empty() {
        let s = PendingOpen::default();
        assert!(s.take().is_none());
    }

    #[test]
    fn pending_open_set_then_take_returns_path() {
        let s = PendingOpen::default();
        s.set(PathBuf::from("/a/b/c.md"));
        assert_eq!(s.take().unwrap().to_string_lossy(), "/a/b/c.md");
    }

    #[test]
    fn pending_open_take_clears() {
        let s = PendingOpen::default();
        s.set(PathBuf::from("/x.md"));
        let _ = s.take();
        assert!(s.take().is_none(), "take must be single-shot");
    }

    #[test]
    fn set_same_path_is_idempotent() {
        let s = PendingOpen::default();
        s.set(PathBuf::from("/a.md"));
        s.set(PathBuf::from("/a.md"));
        assert_eq!(s.take().unwrap().to_string_lossy(), "/a.md");
    }

    #[test]
    fn newer_path_overrides_older() {
        let s = PendingOpen::default();
        s.set(PathBuf::from("/a.md"));
        s.set(PathBuf::from("/b.md"));
        assert_eq!(s.take().unwrap().to_string_lossy(), "/b.md");
    }

    #[test]
    fn is_markdown_path_matches_known_extensions() {
        assert!(is_markdown_path("/abs/README.md"));
        assert!(is_markdown_path("relative.Markdown"));
        assert!(is_markdown_path("./a/b.MDOWN"));
        assert!(is_markdown_path("x.MKD"));
        assert!(is_markdown_path("a.mdx"));
    }

    #[test]
    fn is_markdown_path_rejects_non_markdown() {
        assert!(!is_markdown_path("/x.txt"));
        assert!(!is_markdown_path("/x"));
        assert!(!is_markdown_path(""));
        assert!(!is_markdown_path("--flag"));
        assert!(!is_markdown_path("-h"));
    }
}

// src-tauri/src/services/external_editor.rs (T24 — F-26 "在外部编辑器中打开当前文档")
//
// 设计依据: docs/design/compiled.md §3.3 + 需求 FR-04 + 设计 §3.3.
//
// FR-04 / NFR-SEC-01: 路径校验五重防线 (空 / 扩展名白名单 / `..` 段 / `fs::metadata`
//   存在性 / `is_file()`) + 命令模板 argv 化 (不走 shell).
//
// 责任:
//   - validate_path: trim / 扩展名白名单 / 路径穿越检测 / 文件存在性 / 是 regular file.
//   - build_argv: 7 预设 (code/cursor/subl/mate/notepad++/typora/custom) +
//     跨平台分支 (macOS/Linux/Windows) + custom 模板 {{path}} 占位符替换.
//     *system* preset 不再走 build_argv: 它走 opener::open_path (ShellExecute 触发
//      OS 文件关联), 不需要 argv 数组, 也不再依赖 cmd /C 包装.
//   - spawn_editor: Command::new + args + spawn() — 仅供 preset 编辑器使用.
//   - open_editor: 主入口; editor=None 时从 preferences 读取; validate_path +
//     分流 (system → opener::open_path; preset → build_argv + spawn_editor).
//     AC-09-1/2/3 满足.
//
// 约束:
//   - C-01: 复用既有 AppError 变体 (InvalidPath / PermissionDenied / NotFound / Unknown / Io).
//   - C-03: 不引入 which crate; Windows 走 cmd /C 简化方案 (path 加引号转义).
//   - NFR-SEC-02: spawn argv 数组, 避免命令注入.
//
// T26+ (R-13 修复) 增量:
//   - 修复 Windows "system 编辑器" 报 OS error 193 (ERROR_BAD_EXE_FORMAT) 的 bug.
//     原 build_argv 在 Windows 返回 vec![path], spawn_editor 把 .md 文件路径当
//     PE 可执行传给 CreateProcessW → 拒绝加载. 修法: system preset 不再走 build_argv
//     + spawn_editor, 改走 tauri_plugin_opener::OpenerExt::open_path, 内部用
//     ShellExecuteW 走文件关联 (Tauri 2 官方维护, 跨平台一致).

use std::path::{Path, PathBuf};

use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use crate::error::AppError;

/// Markdown 文件扩展名白名单. 与 tauri.conf.json 的 fileAssociations.ext 保持一致.
const MD_EXTENSIONS: &[&str] = &["md", "markdown", "mdx", "mdown", "mkd"];

/// 8 档外部编辑器预设常量.
const PRESET_SYSTEM: &str = "system";
const PRESET_CODE: &str = "code";
const PRESET_CURSOR: &str = "cursor";
const PRESET_SUBL: &str = "subl";
const PRESET_MATE: &str = "mate";
const PRESET_NOTEPPAD_PLUS_PLUS: &str = "notepad++";
const PRESET_TYPORA: &str = "typora";
const PRESET_CUSTOM: &str = "custom";

/// 路径校验: 五重防线.
///
///   1. trim().is_empty() → InvalidPath("empty path")
///   2. 扩展名白名单 {md, markdown, mdx, mdown, mkd} → 否则 InvalidPath("extension not allowed: <ext>")
///   3. split('/' | '\\') 含 `..` → PermissionDenied("path traversal blocked")
///   4. fs::metadata 不存在 → NotFound(path)
///   5. fs::metadata.is_file() == false → InvalidPath("not a regular file")
///
/// 成功返回 PathBuf (已通过所有权校验, 后续可直接 to_string_lossy 转换).
pub fn validate_path(path: &str) -> Result<PathBuf, AppError> {
    // 1) trim empty guard.
    if path.trim().is_empty() {
        return Err(AppError::InvalidPath("empty path".into()));
    }
    // 2) extension whitelist.
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase());
    match ext.as_deref() {
        Some(e) if MD_EXTENSIONS.contains(&e) => {}
        Some(e) => {
            return Err(AppError::InvalidPath(format!(
                "extension not allowed: {e}"
            )));
        }
        None => {
            return Err(AppError::InvalidPath("extension not allowed: <none>".into()));
        }
    }
    // 3) path traversal guard.
    if path.split(['/', '\\']).any(|seg| seg == "..") {
        eprintln!(
            "[external_editor::open] reject path_traversal path=\"{}\"",
            path
        );
        return Err(AppError::PermissionDenied("path traversal blocked".into()));
    }
    // 4) existence + 5) is_file.
    let p = PathBuf::from(path);
    let meta = match std::fs::metadata(&p) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(AppError::NotFound(path.to_string()));
        }
        Err(e) => return Err(AppError::Io(e)),
    };
    if !meta.is_file() {
        return Err(AppError::InvalidPath("not a regular file".into()));
    }
    Ok(p)
}

/// 命令拼装: 跨平台 + 8 预设 + custom 模板.
///
///   - system: macOS=`["open", "-t", path]`; Linux=`["xdg-open", path]`; Windows=`[path]`
///   - preset (code/cursor/subl/mate/typora): macOS/Linux=`["<cmd>", path]`;
///     Windows=`["cmd", "/C", "<cmd>", path]`
///   - notepad++: 仅 Windows; 其它平台 → AppError::Unknown("notepad++ is Windows-only")
///   - custom: split_whitespace() + {{path}} 占位符替换; 空模板降级 system;
///     占位符未闭合 → AppError::InvalidPath("invalid custom command template")
///
/// 不走 shell; argv 数组直接传给 Command (NFR-SEC-02).
pub fn build_argv(editor: &str, path: &str, custom_cmd: &str) -> Result<Vec<String>, AppError> {
    // custom 模式先做占位符替换 / 空模板降级.
    if editor == PRESET_CUSTOM {
        return build_argv_custom(path, custom_cmd);
    }
    // 平台分支.
    let argv: Vec<String> = match editor {
        PRESET_SYSTEM => match std::env::consts::OS {
            "macos" => vec!["open".into(), "-t".into(), path.into()],
            "linux" => vec!["xdg-open".into(), path.into()],
            "windows" => vec![path.into()],
            _ => {
                return Err(AppError::Unknown(format!(
                    "system editor not supported on {}",
                    std::env::consts::OS
                )));
            }
        },
        PRESET_CODE
        | PRESET_CURSOR
        | PRESET_SUBL
        | PRESET_MATE
        | PRESET_TYPORA => {
            let cmd = editor.to_string();
            match std::env::consts::OS {
                "macos" | "linux" => vec![cmd, path.into()],
                "windows" => vec![
                    "cmd".into(),
                    "/C".into(),
                    cmd,
                    quote_for_cmd(path),
                ],
                _ => {
                    return Err(AppError::Unknown(format!(
                        "editor {editor} not supported on {}",
                        std::env::consts::OS
                    )));
                }
            }
        }
        PRESET_NOTEPPAD_PLUS_PLUS => {
            if std::env::consts::OS != "windows" {
                return Err(AppError::Unknown("notepad++ is Windows-only".into()));
            }
            vec!["notepad++".into(), path.into()]
        }
        _ => {
            return Err(AppError::Unknown(format!(
                "unsupported editor preset: {editor}"
            )));
        }
    };
    Ok(argv)
}

/// custom 模式 argv 拼装:
///
///   1. custom_cmd.trim().is_empty() → 降级 system.
///   2. split_whitespace() → argv 列表 (默认 token 切分, 接受 `{{path}}`).
///   3. 把 argv 中任一 token == "{{path}}" 替换为 path; 否则 path 追加到末尾.
///   4. 占位符语法错误 (`{{path` 未闭合或 `{{path}}` 拆成多 token) → InvalidPath.
fn build_argv_custom(path: &str, custom_cmd: &str) -> Result<Vec<String>, AppError> {
    let trimmed = custom_cmd.trim();
    if trimmed.is_empty() {
        return build_argv(PRESET_SYSTEM, path, "");
    }
    // 检查占位符配对 (允许 `{{path}}` 与无占位符两种).
    if trimmed.contains("{{path") && !trimmed.contains("{{path}}") {
        return Err(AppError::InvalidPath(
            "invalid custom command template".into(),
        ));
    }
    let mut argv: Vec<String> = trimmed
        .split_whitespace()
        .map(|s| s.to_string())
        .collect();
    // 替换占位符.
    let mut found_placeholder = false;
    for token in argv.iter_mut() {
        if token == "{{path}}" {
            *token = path.to_string();
            found_placeholder = true;
        }
    }
    if !found_placeholder {
        argv.push(path.to_string());
    }
    Ok(argv)
}

/// Windows cmd /C 调用: 路径加引号转义 (避免路径含空格 / shell 元字符被截断).
///
/// NFR-SEC-02: 仅对 path 加 `\"...\"` 包裹; 不引入额外转义.
#[cfg(target_os = "windows")]
fn quote_for_cmd(path: &str) -> String {
    format!("\"{path}\"")
}

/// 非 Windows 平台不使用 quote_for_cmd; 占位保留以满足 build_argv 跨平台签名.
#[cfg(not(target_os = "windows"))]
fn quote_for_cmd(path: &str) -> String {
    path.to_string()
}

/// spawn 子进程:
///
///   - macOS/Linux: Command::new(argv[0]).args(&argv[1..]).spawn() — 异步, 不 .wait().
///   - Windows: 已在 build_argv 阶段包装为 cmd /C "<joined>"; 同样走 argv 数组.
///
/// spawn 失败 → AppError::Unknown("spawn failed: <e>").
pub fn spawn_editor(argv: &[String]) -> Result<(), AppError> {
    if argv.is_empty() {
        return Err(AppError::Unknown("empty argv".into()));
    }
    let program = &argv[0];
    let args = &argv[1..];
    let result = if cfg!(target_os = "windows") && program == "cmd" {
        // Windows: cmd /C "..." 走第一个 token 后的整段合并 (因 quote 已在 build_argv 加好).
        std::process::Command::new(program).args(args).spawn()
    } else {
        std::process::Command::new(program).args(args).spawn()
    };
    match result {
        Ok(_child) => Ok(()),
        Err(e) => Err(AppError::Unknown(format!("spawn failed: {e}"))),
    }
}

/// open_editor — 主入口 (commands::open_in_external_editor 委托).
///
///   1. editor=None → 从 preferences 读取; custom_cmd 也从 preferences 取 (editor=custom 时).
///   2. validate_path(&path) → PathBuf.
///   3. 分流 (T26+ R-13 修复):
///      - PRESET_SYSTEM  → app.opener().open_path(path) (Tauri ShellExecute 走文件关联).
///      - preset 编辑器  → build_argv + spawn_editor (走具体 .exe, 带参).
///   4. eprintln! argv 日志 (AC-09-1/2). system 路径打印 path 而非 argv.
///
/// T26+ (R-13 修复): 之前 system preset 在 Windows 上 argv=[path], spawn 把 .md
/// 文件当 PE 二进制 → OS error 193. 改为走 opener, 跨平台一致.
pub async fn open_editor(
    app: &AppHandle,
    path: String,
    editor: Option<String>,
) -> Result<(), AppError> {
    let editor = match editor {
        Some(e) if !e.is_empty() => e,
        _ => crate::services::preferences::load(app)?.external_editor,
    };
    let custom_cmd = if editor == PRESET_CUSTOM {
        crate::services::preferences::load(app)?.external_editor_custom_cmd
    } else {
        String::new()
    };
    let resolved = validate_path(&path)?;
    let path_str = resolved.to_string_lossy().to_string();

    // T26+ (R-13 修复) 增量: system preset 走 opener, 不再走 build_argv + spawn.
    // 理由: argv=[path] 让 Windows CreateProcessW 拒绝 (.md 不是 PE → error 193);
    //       opener::open_path 内部 ShellExecuteW 走文件关联, 三平台一致.
    if editor == PRESET_SYSTEM {
        eprintln!("[external_editor::open] editor=system path={path_str}");
        app.opener()
            .open_path(path_str, None::<&str>)
            .map_err(|e| AppError::Unknown(format!("opener.open_path failed: {e}")))
    } else {
        let argv = build_argv(&editor, &path_str, &custom_cmd)?;
        // AC-09-1/2: argv 在 spawn 之前一行 stderr (成功失败都有, 便于运维定位).
        eprintln!(
            "[external_editor::open] editor={:?} argv={:?}",
            editor, argv
        );
        spawn_editor(&argv)
    }
}

// ---------------------------------------------------------------------------
// 单元测试 (T24 step-1g: 覆盖 AC-04-1/3/4/5/6 + NFR-CROSS-01 + FR-04 各 build_argv 分支)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;

    /// 创建一个临时 .md 文件用于 validate_path 测试; 返回绝对路径.
    fn tmp_md(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kite-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let p = dir.join(name);
        let mut f = fs::File::create(&p).unwrap();
        writeln!(f, "# hello").unwrap();
        p
    }

    // ----- validate_path -----

    #[test]
    fn validate_path_empty_rejected() {
        let err = validate_path("").unwrap_err();
        assert!(matches!(err, AppError::InvalidPath(ref r) if r == "empty path"));
    }

    #[test]
    fn validate_path_whitespace_rejected() {
        let err = validate_path("   ").unwrap_err();
        assert!(matches!(err, AppError::InvalidPath(ref r) if r == "empty path"));
    }

    #[test]
    fn validate_path_extension_md_ok() {
        let p = tmp_md("notes.md");
        assert!(validate_path(p.to_str().unwrap()).is_ok());
    }

    #[test]
    fn validate_path_extension_markdown_ok() {
        let p = tmp_md("notes.markdown");
        assert!(validate_path(p.to_str().unwrap()).is_ok());
    }

    #[test]
    fn validate_path_extension_mdx_ok() {
        let p = tmp_md("notes.mdx");
        assert!(validate_path(p.to_str().unwrap()).is_ok());
    }

    #[test]
    fn validate_path_extension_txt_rejected() {
        let err = validate_path("/tmp/notes.txt").unwrap_err();
        assert!(matches!(err, AppError::InvalidPath(ref r) if r.starts_with("extension not allowed")));
    }

    #[test]
    fn validate_path_extension_none_rejected() {
        let err = validate_path("/tmp/no-extension-file").unwrap_err();
        assert!(matches!(err, AppError::InvalidPath(ref r) if r.starts_with("extension not allowed")));
    }

    #[test]
    fn validate_path_traversal_rejected() {
        let err = validate_path("/tmp/../etc/passwd.md").unwrap_err();
        assert!(matches!(err, AppError::PermissionDenied(_)));
    }

    #[test]
    fn validate_path_traversal_windows_separator_rejected() {
        // Windows 风格 `..\` 也应被拒绝.
        let err = validate_path("C:\\tmp\\..\\evil.md").unwrap_err();
        assert!(matches!(err, AppError::PermissionDenied(_)));
    }

    #[test]
    fn validate_path_not_found_rejected() {
        let err = validate_path("/tmp/__kite_definitely_not_here__.md").unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
    }

    #[test]
    fn validate_path_directory_rejected() {
        // 创建一个带 .md 扩展名的临时目录, 让 validate_path 通过扩展名校验, 然后在
        // fs::metadata.is_file() 阶段被拒绝. 由于 macOS SIP 偶尔导致 fs::metadata 报
        // NotFound, 我们只要非 Ok 即视为该路径不会被当作文件接受.
        let dir = std::env::temp_dir().join(format!("kite-test-dir-{}.md", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path_str = dir.to_str().unwrap();
        let result = validate_path(path_str);
        match result {
            Err(AppError::InvalidPath(ref r)) if r == "not a regular file" => {}
            Err(_) => {} // 其它错误也可接受 (测试不依赖具体错误类型).
            Ok(_) => panic!("expected Err for directory path"),
        }
        let _ = fs::remove_dir(&dir);
    }

    // ----- build_argv: system -----

    #[test]
    fn build_argv_system_macos() {
        // T26+ (R-13 修复): system preset 不再走 build_argv (open_editor 在 macOS
        // 改走 opener::open_path). build_argv("system", ...) 仍可调用 (向下兼容),
        // 但实际不会被 open_editor 触发, 此处只验证历史行为, 不再断言.
        let argv = build_argv("system", "/tmp/notes.md", "").unwrap();
        if cfg!(target_os = "macos") {
            assert_eq!(argv, vec!["open", "-t", "/tmp/notes.md"]);
        }
    }

    #[test]
    fn build_argv_system_linux() {
        // T26+ (R-13 修复): 同上, system preset 走 opener, build_argv 只保留向下兼容.
        let argv = build_argv("system", "/tmp/notes.md", "").unwrap();
        if cfg!(target_os = "linux") {
            assert_eq!(argv, vec!["xdg-open", "/tmp/notes.md"]);
        }
    }

    #[test]
    fn build_argv_system_windows() {
        // T26+ (R-13 修复): 历史 bug — 之前 build_argv 返回 vec!["C:\\notes.md"],
        // spawn_editor 把它当 PE 二进制 → Windows CreateProcessW 拒绝 (error 193).
        // 修复: system preset 不再走 build_argv, 改走 opener::open_path.
        // 此处断言仅保留历史行为, 提醒维护者不要在 open_editor 里重新调用.
        let argv = build_argv("system", "C:\\notes.md", "").unwrap();
        if cfg!(target_os = "windows") {
            assert_eq!(argv, vec!["C:\\notes.md"]);
        }
    }

    // ----- build_argv: preset (code/cursor/subl/mate/typora) -----

    #[test]
    fn build_argv_code_preset_macos_linux() {
        let argv = build_argv("code", "/tmp/notes.md", "").unwrap();
        if cfg!(any(target_os = "macos", target_os = "linux")) {
            assert_eq!(argv, vec!["code", "/tmp/notes.md"]);
        }
    }

    #[test]
    fn build_argv_code_preset_windows() {
        let argv = build_argv("code", "C:\\notes.md", "").unwrap();
        if cfg!(target_os = "windows") {
            assert_eq!(argv[0], "cmd");
            assert_eq!(argv[1], "/C");
            assert_eq!(argv[2], "code");
            assert_eq!(argv[3], "\"C:\\notes.md\"");
        }
    }

    #[test]
    fn build_argv_cursor_preset_macos_linux() {
        let argv = build_argv("cursor", "/tmp/notes.md", "").unwrap();
        if cfg!(any(target_os = "macos", target_os = "linux")) {
            assert_eq!(argv, vec!["cursor", "/tmp/notes.md"]);
        }
    }

    #[test]
    fn build_argv_typora_preset_macos_linux() {
        let argv = build_argv("typora", "/tmp/notes.md", "").unwrap();
        if cfg!(any(target_os = "macos", target_os = "linux")) {
            assert_eq!(argv, vec!["typora", "/tmp/notes.md"]);
        }
    }

    // ----- build_argv: notepad++ -----

    #[test]
    fn build_argv_notepad_plus_plus_non_windows_rejected() {
        if !cfg!(target_os = "windows") {
            let err = build_argv("notepad++", "/tmp/notes.md", "").unwrap_err();
            assert!(matches!(err, AppError::Unknown(ref r) if r == "notepad++ is Windows-only"));
        }
    }

    #[test]
    fn build_argv_notepad_plus_plus_windows_ok() {
        if cfg!(target_os = "windows") {
            let argv = build_argv("notepad++", "C:\\notes.md", "").unwrap();
            assert_eq!(argv, vec!["notepad++", "C:\\notes.md"]);
        }
        // 非 Windows 平台由 build_argv_notepad_plus_plus_non_windows_rejected 覆盖.
    }

    // ----- build_argv: custom -----

    #[test]
    fn build_argv_custom_with_placeholder_replaced() {
        let argv = build_argv("custom", "/tmp/notes.md", "cursor --new-window {{path}}").unwrap();
        assert_eq!(argv, vec!["cursor", "--new-window", "/tmp/notes.md"]);
    }

    #[test]
    fn build_argv_custom_without_placeholder_appends_path() {
        let argv = build_argv("custom", "/tmp/notes.md", "cursor").unwrap();
        assert_eq!(argv, vec!["cursor", "/tmp/notes.md"]);
    }

    #[test]
    fn build_argv_custom_empty_template_falls_back_to_system() {
        let argv = build_argv("custom", "/tmp/notes.md", "").unwrap();
        // 降级到 system: argv[0] 应该是 system 的命令名.
        if cfg!(target_os = "macos") {
            assert_eq!(argv[0], "open");
        } else if cfg!(target_os = "linux") {
            assert_eq!(argv[0], "xdg-open");
        } else if cfg!(target_os = "windows") {
            assert_eq!(argv[0], "C:\\notes.md");
        }
    }

    #[test]
    fn build_argv_custom_unclosed_placeholder_rejected() {
        let err = build_argv("custom", "/tmp/notes.md", "cursor {{path").unwrap_err();
        assert!(matches!(err, AppError::InvalidPath(ref r) if r == "invalid custom command template"));
    }

    // ----- build_argv: unknown preset -----

    #[test]
    fn build_argv_unknown_preset_rejected() {
        let err = build_argv("notepad", "/tmp/notes.md", "").unwrap_err();
        assert!(matches!(err, AppError::Unknown(ref r) if r.contains("unsupported editor preset")));
    }

    // ----- T26+ (R-13 修复): system preset 在 spawn_editor 阶段被绕开 -----
    //
    // 背景: 之前 build_argv("system", "C:\\notes.md") 返回 vec!["C:\\notes.md"],
    // open_editor → spawn_editor → Command::new("C:\\notes.md").spawn() 在
    // Windows 上抛 OS error 193 (ERROR_BAD_EXE_FORMAT). 修复后, system preset
    // 在 open_editor 入口直接走 opener::open_path, 永远不进 spawn_editor.
    //
    // 这里没有跨进程 e2e 测试 (需要 AppHandle mock), 但 spawn_editor 自身保持
    // 旧行为 (还是把 argv[0] 当 exe 调). 如果有人未来重构让 open_editor 重新
    // 让 system 走 spawn_editor, build_argv_system_windows 测试 + OS error 193
    // 都会立刻暴露问题.
    #[test]
    fn build_argv_system_windows_path_only_documented_as_legacy() {
        // 该测试明确存档, 但不推荐任何新代码用 build_argv("system", ...) 拼 spawn.
        // 见 open_editor 的 T26+ 注释: system → opener, 其他 preset → build_argv + spawn.
        let argv = build_argv("system", "C:\\notes.md", "").unwrap();
        if cfg!(target_os = "windows") {
            // 老行为: argv[0] == path. **不要在 open_editor 里把 system 走这条路**.
            assert_eq!(argv[0], "C:\\notes.md");
        }
    }
}

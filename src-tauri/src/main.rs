// T06 阶段 main.rs: 注册 dialog / fs / shell / store 四个 Tauri 2 插件
// 并把 commands::read_markdown_file / load_preferences / save_preferences /
// set_window_title / get_recent_files / add_recent_file / clear_recent_files
// 七个命令加入 invoke_handler.
//
// T06 增量:
//   - manage(RecentState) 在 setup 钩子中注入;
//   - load_from_store 在 setup 钩子中调用一次 hydrate (NFR-05).
//   - 在 invoke_handler 中追加 get_recent_files / add_recent_file / clear_recent_files.
//
// T16-P2 增量:
//   - 在 invoke_handler 中追加 export_html (FR-01) + set_fullscreen (FR-03).
//
// macOS 文件打开 (md/markdown) 增量:
//   - 启动时把 std::env::args() 中第一个 .md 路径作为 "启动文件", 在 setup 钩子里
//     cache 到 tauri::State<PendingOpen>. 由 frontend 启动后通过 listen("kite://open-file")
//     主动 invoke 拉取 (GET_OPEN_FILE), 拉完即清, 避免二次加载.
//   - .run() 闭包接管 RunEvent::Opened { urls } (macOS 应用已运行时被 Finder 重新
//     打开), 同样 cache + emit("kite://open-file"), 让前端实时加载.
//
// 注释:
// - 因为 main.rs 是独立二进制 (Cargo.toml `[[bin]]`), 通过 kite_lib::commands
//   引用 lib 模块, 不要绕过 kite_lib (避免双份代码).
// - 不启用 dangerousRemoteUrlIpcAccess / dangerousUseHttpScheme /
//   dangerousDisableAssetCspModifier (NFR-SEC-02).

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;

use kite_lib::commands;
use kite_lib::pending_open::{is_markdown_path, PendingOpen};
use kite_lib::services::recent_files as recent_svc;
use tauri::{Emitter, Manager, RunEvent};

fn main() {
    // 冷启动 argv: argv[0] = 二进制自身, argv[1] = 路径 (macOS Finder 双击时传入).
    // 注意: 多个文件多窗口的 case macOS 不会传, 我们只关心单文件.
    let pending = PendingOpen::default();
    for arg in std::env::args().skip(1).take(1) {
        if is_markdown_path(&arg) {
            pending.set(PathBuf::from(arg));
            break;
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(pending)
        .setup(|app| {
            // T06: 注入 RecentState 并 hydrate.
            app.manage(recent_svc::init_state());
            if let Err(e) = recent_svc::load_from_store(app.handle()) {
                eprintln!("[recent_files] hydrate failed: {e}");
            }

            // T20+ (R-07 修复): dev 模式下运行时设置 Dock / Window 图标.
            // 背景: cargo tauri dev 运行的是裸二进制, macOS Dock 会读链接进二进制的默认
            // Rust/Tauri 图标, 完全忽略 tauri.conf.json::bundle.icon. cargo tauri build 才会
            // 把 bundle.icon 装进 KITE.app/Contents/Resources/. 显式调用 set_icon 让 dev 模式
            // 也立刻显示用户的 kite 图标, 不需要每次打包验证.
            //
            // 实现: 用 include_bytes! 把图标嵌入二进制, 运行时通过 tauri::image::Image::from_bytes
            // 加载. 优势: 与 cargo tauri build 行为一致, 任何 runtime cwd / 安装路径都不会
            // 找不到图标. 失败时 eprintln 但不 panic — 不阻塞 app 启动 (Windows / Linux 上
            // set_icon 是 no-op, macOS 上 dock icon 偶尔因缓存刷新慢需重启, 都不影响功能).
            if let Some(window) = app.get_webview_window("main") {
                let icon_bytes = include_bytes!("../icons/128x128.png");
                match tauri::image::Image::from_bytes(icon_bytes) {
                    Ok(icon) => {
                        if let Err(e) = window.set_icon(icon) {
                            eprintln!("[set_icon] failed: {e}");
                        }
                    }
                    Err(e) => eprintln!("[set_icon] decode failed: {e}"),
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::read_markdown_file,
            commands::load_preferences,
            commands::save_preferences,
            commands::set_window_title,
            commands::get_recent_files,
            commands::add_recent_file,
            commands::clear_recent_files,
            commands::open_external_url,
            commands::resolve_image_path,
            commands::load_progress,
            commands::save_progress,
            commands::list_dir,
            // T16-P2 (FR-01 / FR-03): 必须在这里注册, 否则 Tauri 找不到命令.
            // 用户曾经看到的 "Command set_fullscreen not found" 正是由于遗漏注册.
            commands::export_html,
            commands::set_fullscreen,
            // macOS 文件打开: 前端启动后主动拉一次.
            commands::get_pending_open_file,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // macOS 仅: 应用已运行时, Finder 再次 "打开方式 → KITE" 会派发 Opened.
            // 这里把 URL 缓存 + 向前端 emit, 由前端 loadFile(path) 接管.
            if let RunEvent::Opened { urls } = &event {
                for url in urls {
                    // file:///path/to/foo.md → /path/to/foo.md
                    let path_opt = if url.scheme() == "file" {
                        url.to_file_path().ok()
                    } else {
                        None
                    };
                    let Some(path) = path_opt else { continue };
                    if is_markdown_path(path.to_string_lossy().as_ref()) {
                        if let Some(state) = app_handle.try_state::<PendingOpen>() {
                            state.set(path.clone());
                        }
                        // 广播给前端; 前端 listen("kite://open-file") 会触发 loadFile.
                        if let Err(e) =
                            app_handle.emit("kite://open-file", path.to_string_lossy().to_string())
                        {
                            eprintln!("[file-open] emit failed: {e}");
                        }
                    }
                }
            }
        });
}

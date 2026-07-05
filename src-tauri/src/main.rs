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
// 注释:
// - 因为 main.rs 是独立二进制 (Cargo.toml `[[bin]]`), 通过 kite_lib::commands
//   引用 lib 模块, 不要绕过 kite_lib (避免双份代码).
// - 不启用 dangerousRemoteUrlIpcAccess / dangerousUseHttpScheme /
//   dangerousDisableAssetCspModifier (NFR-SEC-02).

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use kite_lib::commands;
use kite_lib::services::recent_files as recent_svc;
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            // T06: 注入 RecentState 并 hydrate.
            app.manage(recent_svc::init_state());
            if let Err(e) = recent_svc::load_from_store(app.handle()) {
                eprintln!("[recent_files] hydrate failed: {e}");
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

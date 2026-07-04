// src-tauri/src/services 模块树入口
//
// T01 范围: 仅声明 4 个占位子模块, 函数体为空/todo!(), 不能引入任何
// F-01~F-17 功能逻辑.
//
// TODO[T02-Fs-Service]   markdown_file.rs (read/编码/大小校验)
// TODO[T03-Recent-Service] recent_files.rs (tai 磁盘 + List recent)
// TODO[T05-Pref-Service]   preferences.rs (Preferences 加载/保存)
// TODO[T07-External-Service] external.rs (open_external_url scheme 白名单)

pub mod markdown_file;
pub mod preferences;
pub mod progress;
pub mod recent_files;
pub mod external;
pub mod fs_reader;
pub mod exporter;
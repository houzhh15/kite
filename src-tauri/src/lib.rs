// src-tauri/src/lib.rs (T01 阶段)
//
// 这里只放顶层 `mod` 声明, 让 main.rs 通过 `kite_lib::services` 访问.
// 真正的业务逻辑 (commands / error / services) 各自独立模块.

pub mod commands;
pub mod error;
pub mod services;

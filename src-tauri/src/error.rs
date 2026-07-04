// src-tauri/src/error.rs — AppError 公共错误类型
//
// FR-05 要求:
//   - 6 变体: NotFound / TooLarge / Encoding / Io / InvalidPath / Unknown
//   - 序列化为 {code: "<DOMAIN_NAME>", message: "<human readable>"}
//   - Rust 侧命令返回 Result<T, AppError>, 由 Tauri 自动 Serialize 到前端.
//
// 实现选择:
//   - thiserror 提供 Display 与 From<io::Error> (满足 FR-05 6 变体最小集)
//   - 自定义 Serialize 实现保证 JSON 形状稳定 (R-04 单一来源).
//   - code 字段使用 SCREAMING_SNAKE_CASE 与前端 AppErrorCode union 字符串一一对应.
//   - 不使用 crate 级的 #[serde(deny_unknown_fields)] 之类, 因为
//     Tauri 自身会调用 Serialize trait, 序列化策略由本 impl 决定.
//
// 序列化 shape:
//   {"code":"NOT_FOUND","message":"path /a/b/c.md does not exist"}

use serde::{Serialize, Serializer};
use thiserror::Error;

/// AppError 是 KITE 所有 Tauri command 的统一错误返回类型.
///
/// 任意 #[tauri::command] 函数都应该 `-> Result<T, AppError>`。
/// 由 `R-04 单一来源` 规则驱动,任何错误变体的添加都必须
/// 同步到 `src/lib/tauri.ts` 的 `AppErrorCode` union。
#[derive(Debug, Error)]
pub enum AppError {
    /// 文件不存在 (FR-05: NotFound)
    #[error("path {0} does not exist")]
    NotFound(String),

    /// 文件超出大小限制 (FR-04 / FR-05: TooLarge)
    #[error("file size limit exceeded: {actual} > {limit} bytes")]
    TooLarge { actual: u64, limit: u64 },

    /// 文件编码非 UTF-8 (FR-05: Encoding)
    #[error("file is not valid UTF-8: {0}")]
    Encoding(String),

    /// 底层 IO 错误 (FR-05: Io)
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    /// 路径非法 (例如包含 NUL 字节或 symlink 越界) (FR-05: InvalidPath)
    #[error("invalid path: {0}")]
    InvalidPath(String),

    /// T15 (FR-02): path 是文件而非目录, 或目录校验失败.
    #[error("not a directory: {0}")]
    NotADirectory(String),

    /// T15 (FR-02): 路径越权 (含 `..` 段或不在授权 scope 内).
    #[error("permission denied: {0}")]
    PermissionDenied(String),

    /// 未分类错误 (FR-05: Unknown)
    #[error("unknown error: {0}")]
    Unknown(String),

    /// T16-P2 (FR-01 / 设计 §3.4.2): 导出 HTML payload 超过 5 MB 上限 (E001).
    #[error("payload too large ({actual} bytes > {limit} bytes)")]
    PayloadTooLarge { actual: usize, limit: usize },

    /// T16-P2 (FR-01 / NFR-S-04): 目标路径非法或位于系统目录 (E002).
    #[error("invalid target path: {0}")]
    InvalidTargetPath(String),

    /// T16-P2 (FR-01): UTF-8 编码校验失败 (E005).
    #[error("export encoding error: {0}")]
    ExportEncoding(String),
}

impl AppError {
    /// 错误领域标识,与前端 `AppErrorCode` 字符串一一对应.
    pub fn code(&self) -> &'static str {
        match self {
            AppError::NotFound(_) => "NOT_FOUND",
            AppError::TooLarge { .. } => "TOO_LARGE",
            AppError::Encoding(_) => "ENCODING",
            AppError::Io(_) => "IO",
            AppError::InvalidPath(_) => "INVALID_PATH",
            AppError::NotADirectory(_) => "NOT_A_DIRECTORY",
            AppError::PermissionDenied(_) => "PERMISSION_DENIED",
            AppError::Unknown(_) => "UNKNOWN",
            AppError::PayloadTooLarge { .. } => "PAYLOAD_TOO_LARGE",
            AppError::InvalidTargetPath(_) => "INVALID_TARGET_PATH",
            AppError::ExportEncoding(_) => "EXPORT_ENCODING",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        // 形状: {"code": "<CODE>", "message": "<Display>"}
        // 这是契约的一部分,任何改动必须同步 docs/design/compiled.md §3.5 与
        // src/lib/tauri.ts 的 AppErrorCode union.
        use serde::ser::SerializeStruct;
        let mut s = serializer.serialize_struct("AppError", 2)?;
        s.serialize_field("code", self.code())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}

// Compile-time sanity: From<io::Error> 已由 #[from] 自动派生, 满足 FR-05
// 的最小 6 变体集. 不要为本类型实现 custom From 除非新错误类别得到需求
// 文档明文批准 (R-04 单一来源硬约束).
//
// 三条单元测试覆盖序列化形状 (设计 §5 验收项 AC-05-2):
//   1) NotFound code == "NOT_FOUND"
//   2) TooLarge 序列化稳定 {code, message}
//   3) Serialize 输出字段顺序稳定 ("code" 在前, "message" 在后)

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn not_found_serializes_to_expected_code() {
        let err = AppError::NotFound("/a/b/c.md".into());
        assert_eq!(err.code(), "NOT_FOUND");
    }

    #[test]
    fn too_large_serializes_to_two_field_shape() {
        let err = AppError::TooLarge {
            actual: 100,
            limit: 10,
        };
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["code"], "TOO_LARGE");
        assert!(json["message"]
            .as_str()
            .unwrap()
            .contains("100"));
        assert_eq!(json.as_object().unwrap().len(), 2);
    }

    #[test]
    fn serialize_field_order_is_code_then_message() {
        let err = AppError::Unknown("boom".into());
        let json = serde_json::to_string(&err).unwrap();
        // 字段顺序由 SerializeStruct 调用顺序决定
        let code_pos = json.find("\"code\"").unwrap();
        let message_pos = json.find("\"message\"").unwrap();
        assert!(code_pos < message_pos, "code must appear before message");
    }

    #[test]
    fn not_a_directory_serializes_to_expected_code() {
        // T15 (FR-02): 新变体 NotADirectory; 序列化稳定.
        let err = AppError::NotADirectory("/a/b".into());
        assert_eq!(err.code(), "NOT_A_DIRECTORY");
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["code"], "NOT_A_DIRECTORY");
        assert!(json["message"].as_str().unwrap().contains("/a/b"));
    }

    #[test]
    fn permission_denied_serializes_to_expected_code() {
        // T15 (FR-02): 新变体 PermissionDenied; 序列化稳定.
        let err = AppError::PermissionDenied("/x/../etc".into());
        assert_eq!(err.code(), "PERMISSION_DENIED");
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["code"], "PERMISSION_DENIED");
        assert!(json["message"].as_str().unwrap().contains("etc"));
    }
}

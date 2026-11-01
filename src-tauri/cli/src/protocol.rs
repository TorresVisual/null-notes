use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const PROTOCOL_VERSION: u32 = 1;

// A hand-kept copy of src-tauri/src/cli_server/protocol.rs: the CLI links
// nothing from the app, like context-menu-handler.
#[derive(Debug, Serialize)]
pub struct Request {
    pub v: u32,
    pub token: String,
    pub command: String,
    pub workspace: Option<String>,
    pub args: Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    Failed,
    Usage,
    DirtyBuffer,
    VersionMismatch,
    Unauthorized,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ErrorBody {
    pub code: ErrorCode,
    pub message: String,
}

#[derive(Debug, Deserialize)]
pub struct Response {
    pub ok: bool,
    pub result: Option<Value>,
    pub error: Option<ErrorBody>,
}

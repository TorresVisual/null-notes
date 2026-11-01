use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const PROTOCOL_VERSION: u32 = 1;

#[derive(Debug, Serialize, Deserialize)]
pub struct Request {
    pub v: u32,
    pub token: String,
    pub command: String,
    #[serde(default)]
    pub workspace: Option<String>,
    #[serde(default)]
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

#[derive(Debug, Serialize, Deserialize)]
pub struct Response {
    pub ok: bool,
    pub result: Option<Value>,
    pub error: Option<ErrorBody>,
}

impl Response {
    pub fn ok(result: Value) -> Self {
        Self {
            ok: true,
            result: Some(result),
            error: None,
        }
    }

    pub fn err(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            ok: false,
            result: None,
            error: Some(ErrorBody {
                code,
                message: message.into(),
            }),
        }
    }
}

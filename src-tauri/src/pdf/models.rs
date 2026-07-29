use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfPage {
    pub index: usize,
    pub path: String,
    pub width: u32,
    pub height: u32,
}

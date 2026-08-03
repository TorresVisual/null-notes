use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfPage {
    pub index: usize,
    pub path: String,
    pub width: u32,
    pub height: u32,
}

/// One image extracted from a Markdown-mode import, not yet written to
/// disk — `import_pdf_markdown` has no note to write a `.assets/` sidecar
/// into (see the design spec's Background), so the frontend writes this via
/// the existing `write_note_asset` and substitutes `placeholder` in the
/// returned Markdown for the real path it gets back.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingImage {
    pub placeholder: String,
    pub mime: String,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfMarkdownImport {
    pub markdown: String,
    pub images: Vec<PendingImage>,
}

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct NoteMetadata {
    pub id: String,
    pub title: String,
    pub path: String,
    pub workspace: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub path: String,
    pub title: String,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceState {
    pub open_tabs: Vec<String>,
    pub active_tab: Option<String>,
    #[serde(default)]
    pub expanded_folders: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTree {
    pub notes: Vec<NoteMetadata>,
    pub folders: Vec<String>,
}

// The connections graph's raw edges — link/tag resolution into an actual
// node graph happens on the frontend, which already holds the notes list.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphLink {
    pub source_path: String,
    pub target_title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphTag {
    pub note_path: String,
    pub tag: String,
}

/// How an imported PDF becomes a note: page images to write alongside, or the
/// text layer converted to editable Markdown.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum PdfImportMode {
    /// Pages as reference images. The default because it is what the app did
    /// before the choice existed, and it is the mode that works on a scan.
    #[default]
    Pages,
    Markdown,
}

// App-wide preferences, not per-workspace state — lives in the app data dir
// alongside recent-workspaces.json, not inside any one workspace folder.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub autosave_debounce_ms: u64,
    pub editor_max_width_px: u32,
    // Added after settings.json shipped, so it has to tolerate its own absence
    // in a file written by an older build. Off by default, matching the choice
    // the raw editor had already hardcoded; when on it covers prose only —
    // code, maths, diagrams, tags and link targets opt out in the editor.
    #[serde(default)]
    pub spellcheck: bool,
    /// BCP-47 tag the editor puts on its `lang` attribute, which is the only
    /// way to tell the WebView which dictionary to check against. Without it
    /// the note inherits `index.html`'s `lang="en"` and German prose is
    /// checked against English — every word underlined, which reads as the
    /// feature being broken. Whether *any* squiggle appears is still the OS
    /// language pack's call, not this app's.
    #[serde(default = "default_spellcheck_language")]
    pub spellcheck_language: String,
    /// Remembered so the import dialog opens on whichever mode was used last.
    #[serde(default)]
    pub pdf_import_mode: PdfImportMode,
}

fn default_spellcheck_language() -> String {
    "de".to_string()
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            autosave_debounce_ms: 600,
            editor_max_width_px: 800,
            spellcheck: false,
            spellcheck_language: default_spellcheck_language(),
            pdf_import_mode: PdfImportMode::Pages,
        }
    }
}

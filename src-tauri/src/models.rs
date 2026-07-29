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

// App-wide preferences, not per-workspace state — lives in the app data dir
// alongside recent-workspaces.json, not inside any one workspace folder.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub autosave_debounce_ms: u64,
    pub editor_max_width_px: u32,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            autosave_debounce_ms: 600,
            editor_max_width_px: 800,
        }
    }
}

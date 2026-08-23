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

/// A `.md` file under a workspace's `templates/` folder (P6-3). `name` is the
/// filename stem, not derived from the file's own heading — a template's
/// first line is typically a placeholder like `{{course}}`, not a title.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateMetadata {
    pub name: String,
    pub path: String,
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
    /// P6-5: the search box's own recent-queries list, capped and
    /// most-recent-first. Persisted here rather than a new file, the same
    /// choice already made for `open_tabs`/`expanded_folders` — this is
    /// UI state a rebuild of `index.db` has no bearing on.
    #[serde(default)]
    pub recent_searches: Vec<String>,
    // Machine-local: whether this machine should auto-commit here at all (P5).
    // Lives on `WorkspaceState` because `.workspace.json` is already the one
    // workspace-folder file P3-4 gitignores — the exact "per-workspace but
    // stays on this machine" home the config needs, per the storage boundary
    // in CLAUDE.md. Added after `.workspace.json` shipped, so it has to
    // tolerate its own absence in a file an older build wrote.
    #[serde(default)]
    pub git: GitWorkspaceConfig,
}

/// Whether *this machine* should auto-commit in this workspace, and whether
/// it has already been asked. Never populated by detection alone — detecting
/// a repo answers "which mode," not "should we act," and P5-1's guarantee is
/// that no Git command runs until a human has said yes here.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitWorkspaceConfig {
    /// True once the one-time "enable auto-commit?" prompt has been answered,
    /// accepted or declined — distinct from `auto_commit` so declining doesn't
    /// get asked again on every open.
    #[serde(default)]
    pub prompted: bool,
    #[serde(default)]
    pub auto_commit: bool,
    /// Minutes of no new note activity before a pending batch is committed.
    /// Deliberately coarse — far coarser than the 600ms save / 2.5s reindex
    /// debounces (P5-2).
    #[serde(default = "default_idle_minutes")]
    pub idle_minutes: u32,
    /// Per-workspace opt-out of running commit hooks on an auto-commit.
    /// Off by default — silently skipping hooks on someone's behalf is
    /// exactly the decision P5-2 refuses to make for them.
    #[serde(default)]
    pub skip_hooks: bool,
    /// Push after each auto-commit. Consulted for `RepoMode::NotesOnly` and
    /// `RepoMode::NotesMonorepo`; a `CodeRepo` workspace never pushes unless
    /// `allow_code_repo_push` also explicitly says so (P5-3, enforced in
    /// `git.rs` itself).
    #[serde(default = "default_auto_push")]
    pub auto_push: bool,
    /// Explicit per-workspace override for a `CodeRepo` workspace: "I've
    /// checked this repo and it's fine to auto-push here." Off by default
    /// and only ever flipped on through a confirm dialog on the frontend —
    /// `CodeRepo` otherwise never auto-pushes, at any setting.
    #[serde(default)]
    pub allow_code_repo_push: bool,
}

fn default_idle_minutes() -> u32 {
    10
}

fn default_auto_push() -> bool {
    true
}

impl Default for GitWorkspaceConfig {
    fn default() -> Self {
        Self {
            prompted: false,
            auto_commit: false,
            idle_minutes: default_idle_minutes(),
            skip_hooks: false,
            auto_push: default_auto_push(),
            allow_code_repo_push: false,
        }
    }
}

/// Which of P5's Git modes a workspace is in, or absent when it isn't a Git
/// repository at all. `NotesOnly` and `NotesMonorepo` get the same
/// auto-push default; `CodeRepo` never pushes, at any setting.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RepoMode {
    /// The repo root is the workspace itself — this machine's history alone.
    NotesOnly,
    /// The workspace is a subtree of a repo that also holds source other
    /// people read the log of.
    CodeRepo,
    /// The workspace is a subtree of a repo, but every directory between it
    /// and the repo root holds nothing but sibling note-workspaces (each its
    /// own `.workspace.json`) — a multi-course repo, not someone else's
    /// source. Auto-push is as safe here as in `NotesOnly`: see
    /// `is_notes_monorepo` in `commands/git.rs`.
    NotesMonorepo,
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

/// A block-math formula extracted from a note's raw markdown (P9-2), used
/// only to assemble a generated formula sheet — never persisted, unlike
/// `ExtractedTask`. `heading` is the nearest ATX heading above the formula in
/// its source note, `None` if it appears before any heading.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExtractedFormula {
    pub latex: String,
    pub heading: Option<String>,
}

/// A `- [ ]` / `- [x]` checkbox line extracted from a note's raw markdown
/// (P9-1), mirroring how `extract_tags` feeds `note_tags`. `position` is the
/// 0-indexed line number within the note's content — also the key
/// `toggle_task` uses to flip the line back, which is simpler than tracking a
/// stable per-task identity and is correct because a toggle rewrites the file
/// (and reindexes) immediately, so the position is never stale by the time
/// it's used again.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedTask {
    pub text: String,
    pub done: bool,
    pub position: i64,
}

/// One open task joined with the note it lives in, for the workspace-wide
/// task view (P9-1). Only open (`done = 0`) tasks are ever selected into
/// this — a done task has nothing to show in a view whose whole point is
/// "what's left."
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct OpenTask {
    pub note_path: String,
    pub note_title: String,
    pub text: String,
    pub position: i64,
}

/// Which of the two card-authoring forms a line matched (P9-3): a
/// `front :: back` line, or a line containing one or more `{{cloze}}` spans.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CardKind {
    Qa,
    Cloze,
}

/// A review card extracted from a note's raw markdown (P9-3), mirroring how
/// `extract_tasks` feeds `note_tasks`: `position` is the 0-indexed line
/// number of the card itself, the same identity `grade_card` uses to find
/// its schedule-comment line back. `due`/`ease`/`interval`/`reps` come from
/// the `<!-- sr ... -->` comment on the line immediately below, if present —
/// `None` across all four means the card has never been reviewed and is
/// implicitly due today with SM-2 defaults.
#[derive(Debug, Clone, PartialEq)]
pub struct ExtractedCard {
    pub kind: CardKind,
    pub front: String,
    pub back: String,
    pub position: i64,
    pub due: Option<String>,
    pub ease: Option<f64>,
    pub interval: Option<i64>,
    pub reps: Option<i64>,
}

/// One due (or new) review card joined with the note it lives in, for the
/// review session (P9-3). Mirrors `OpenTask`'s shape exactly.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DueCard {
    pub note_path: String,
    pub note_title: String,
    pub kind: String,
    pub front: String,
    pub back: String,
    pub position: i64,
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
    /// The command a code deep link launches, with `{file}` and `{line}`
    /// placeholders. Tokenized before substitution and run without a shell —
    /// see `commands::editor_launch`. Empty means "detect on next load", so a
    /// machine that gains VS Code stops defaulting without the user editing
    /// anything.
    #[serde(default)]
    pub editor_command: String,
    /// The shell a terminal pane spawns, e.g. `powershell` or `wsl -d Ubuntu`.
    /// Tokenized the same way as `editor_command`, run without a shell — see
    /// `commands::terminal`. Empty means "detect on next load."
    #[serde(default)]
    pub terminal_shell: String,
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
            editor_command: String::new(),
            terminal_shell: String::new(),
        }
    }
}

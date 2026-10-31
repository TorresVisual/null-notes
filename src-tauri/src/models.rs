use crate::sm2;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorEntry {
    pub timestamp: String,
    pub source: String,
    pub message: String,
    pub context: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct NoteMetadata {
    pub id: String,
    pub title: String,
    pub path: String,
    pub workspace: String,
    pub updated_at: i64,
}

/// A backlink plus the line it was found on, for the backlinks panel's
/// context snippet — `db::notes::backlinks_for` alone only gives the linking
/// note's own metadata, not where in it the link sits. `snippet` is `None`
/// rather than an error when the file can't be read (deleted since the last
/// scan, a permissions hiccup) — the panel still shows the note, just
/// without a preview line, the same "prefer a miss" posture as every other
/// resolver in this codebase.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BacklinkEntry {
    pub note: NoteMetadata,
    pub snippet: Option<String>,
}

/// A code link reference extracted from a note, including optional line
/// number and content fingerprint captured at index time (issue #52).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeLinkEntry {
    pub target: String,
    pub line: Option<u32>,
    pub fingerprint: Option<String>,
}

/// A code link target requested for resolution.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeLinkTarget {
    pub target: String,
    pub line: Option<u32>,
}

/// The resolution status of a code link (issue #52).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CodeLinkStatus {
    Ok,
    Missing,
    Stale,
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

/// One `.excalidraw`/`.svg` pair found under some note's `*.diagrams/`
/// sidecar, for the "reuse existing diagram" picker (#39). `note_title` is
/// the owning note's sidecar-dir stem, not a DB lookup — this scan doesn't
/// touch the notes table.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagramMetadata {
    pub json_path: String,
    pub svg_path: String,
    pub note_title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub path: String,
    pub title: String,
    pub workspace: String,
    pub updated_at: i64,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchPage {
    pub results: Vec<SearchResult>,
    pub total: i64,
}

#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SearchSort {
    #[default]
    Relevance,
    Modified,
    Name,
}

#[derive(Debug, Clone, Copy)]
pub struct SearchPaging {
    pub sort: SearchSort,
    pub limit: i64,
    pub offset: i64,
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
    // Split-pane editing (#54). Added after `.workspace.json` shipped, so
    // both tolerate their own absence in a file an older build wrote —
    // `None` means "single pane" / "use the default 0.5 ratio", the same
    // posture the frontend already needs for a workspace that was never
    // split at all.
    #[serde(default)]
    pub secondary_tab: Option<String>,
    #[serde(default)]
    pub split_ratio: Option<f64>,
    // Sidebar rail+panel UI state. Both default to false (panel open, Tags
    // section open), which is also what a file from an older build means.
    #[serde(default)]
    pub sidebar_collapsed: bool,
    #[serde(default)]
    pub tags_collapsed: bool,
    // Pinned tabs (#155): a subset of `open_tabs`, which the frontend keeps
    // ordered pinned-first. Absent in a file an older build wrote.
    #[serde(default)]
    pub pinned_tabs: Vec<String>,
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

/// A numbered Theorem/Lemma/Corollary/Definition/Algorithm `Callout` block
/// (P6-1/P6-2) extracted from a note's raw markdown, for the same
/// formula-sheet use as `ExtractedFormula` (#35) — the un-numbered callout
/// kinds (note/tip/warning/…) are commentary, not exam content, so they're
/// never extracted. `body` is the blockquote content with each line's `> `
/// marker already stripped, ready to be re-wrapped on render.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExtractedCallout {
    pub kind: String,
    pub number: Option<String>,
    pub title: Option<String>,
    pub body: String,
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

/// Which of the three card-authoring forms a line matched (P9-3): a
/// `front :: back` line, a line containing one or more `{{cloze}}` spans,
/// or a multiple-choice block.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CardKind {
    Qa,
    Cloze,
    Mc,
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
    pub grade: Option<sm2::Grade>,
    pub streak: Option<i64>,
    pub lapses: Option<i64>,
    pub suspended: bool,
    /// MC option text, in source order. Empty for `Qa`/`Cloze`.
    pub options: Vec<String>,
    /// 0-based indices of the `[x]` lines. Empty for `Qa`/`Cloze`. Never
    /// persisted to the DB and never sent to the frontend for a due card —
    /// see `DueCard`.
    pub correct: Vec<usize>,
}

/// One due (or new) review card joined with the note it lives in, for the
/// review session (P9-3).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DueCard {
    pub note_path: String,
    pub note_title: String,
    pub kind: String,
    pub front: String,
    pub back: String,
    pub position: i64,
    /// MC option text, in source order. Empty for `qa`/`cloze`. The
    /// answer (`correct`) is deliberately absent — resolved server-side at
    /// grading time against a fresh read of the note.
    pub options: Vec<String>,
    pub streak: i64,
}

/// One card for the deck view (browse-all, not just due) — mirrors
/// `DueCard` plus scheduling/tag fields a due-queue card doesn't need.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardSummary {
    pub note_path: String,
    pub note_title: String,
    pub kind: String,
    pub front: String,
    pub back: String,
    pub position: i64,
    pub due: String,
    pub interval: i64,
    pub streak: i64,
    pub lapses: i64,
    pub suspended: bool,
    pub tags: Vec<String>,
}

/// What `grade_mc_card` hands back so the frontend can highlight the right
/// options without having been told the answer up front.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McGradeResult {
    pub correct: Vec<usize>,
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

/// What a Tab keypress inserts inside a code block (P11-3). Space is the
/// default because it matches the behavior every code block already had
/// before this setting existed — a settings.json from before P11-3 loads as
/// `Space`/2 via `#[serde(default)]`, not some other implicit width.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum CodeIndentChar {
    #[default]
    Space,
    Tab,
}

/// Which `.hljs-*` color palette a code block renders with (P11-4). Kebab
/// case so the serialized value matches the CSS `data-code-theme` attribute
/// value directly, with no translation layer between settings and styling.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "kebab-case")]
pub enum CodeTheme {
    /// The one palette every code block already had before this setting
    /// existed — an older settings.json missing the key must load into
    /// exactly this, not some other implicit theme.
    #[default]
    MaterialOcean,
    OneDark,
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
    /// Width of one indent level in a code block, in spaces — ignored when
    /// `code_indent_char` is `Tab`, where one keypress always inserts one
    /// literal tab character regardless of this number.
    #[serde(default = "default_code_indent_width")]
    pub code_indent_width: u32,
    #[serde(default)]
    pub code_indent_char: CodeIndentChar,
    #[serde(default)]
    pub code_theme: CodeTheme,
    /// Independent of the editor's own prose font-size setting — a code
    /// block's `pre` reads this pixel value directly, not an `em` relative
    /// to prose, which is the whole point of the setting existing.
    #[serde(default = "default_code_font_size_px")]
    pub code_font_size_px: u32,
    /// Interpreter for `python` code blocks (P10-2). Same detect-on-empty
    /// shape as `editor_command`. Tokenized and run without a shell — see
    /// `commands::code_run`.
    #[serde(default)]
    pub python_command: String,
    /// Compiler for `cpp`/`c++`/`c` code blocks (P10-2). MSVC's `cl.exe`
    /// isn't probed for — see `docs/specs/code-execution-design.md`.
    #[serde(default)]
    pub cpp_compiler_command: String,
    /// Wall-clock seconds before a running code block is killed
    /// automatically — the only resource limit P10-2 applies.
    #[serde(default = "default_code_run_timeout_secs")]
    pub code_run_timeout_secs: u32,
}

fn default_code_run_timeout_secs() -> u32 {
    10
}

fn default_spellcheck_language() -> String {
    "de".to_string()
}

fn default_code_indent_width() -> u32 {
    2
}

fn default_code_font_size_px() -> u32 {
    13
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
            code_indent_width: default_code_indent_width(),
            code_indent_char: CodeIndentChar::Space,
            code_theme: CodeTheme::MaterialOcean,
            code_font_size_px: default_code_font_size_px(),
            python_command: String::new(),
            cpp_compiler_command: String::new(),
            code_run_timeout_secs: default_code_run_timeout_secs(),
        }
    }
}

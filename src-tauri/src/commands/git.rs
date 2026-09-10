//! P5's Git automation: which repo mode a workspace is in (P5-1, including
//! the `NotesMonorepo` extension for a repo of nothing but sibling course
//! workspaces), batched auto-commit (P5-2), push policy (P5-3),
//! fast-forward-only auto-pull (P5-4), and repo creation (P5-5).
//!
//! Every mutating command here is pathspec-scoped to note paths and backs
//! off quietly on an unsafe repo state — see `unsafe_repo_state` — rather
//! than ever trying to repair one. Shells out to `git` rather than linking
//! `git2`/`gix`: that inherits the user's credential helpers, SSH agent,
//! commit signing and `.gitconfig` for free.
//!
//! Design: `docs/ROADMAP.md` §Phase 5.

use crate::models::RepoMode;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;

/// A `Command` that never flashes a console window when spawned from this
/// GUI app. Windows shows one by default for any child process that has no
/// parent console of its own — every `git`/`gh` call this module makes, run
/// from the built app rather than a terminal, would otherwise pop one.
fn no_window_command(program: &str) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// `git -C <workspace> rev-parse --show-toplevel`, classified against the
/// workspace path itself.
///
/// `Ok(None)` means "not a Git repository at all" — read off git's own exit
/// code, never a parsed error string, so an unusual locale still detects
/// correctly. Both paths go through `canonicalize` before comparing: git
/// normalises its own output to forward slashes even on Windows, so a raw
/// string comparison against the workspace path as given would mismatch on
/// separator style alone.
pub fn detect_repo_mode(workspace: &str) -> anyhow::Result<Option<RepoMode>> {
    let output = no_window_command("git")
        .arg("-C")
        .arg(workspace)
        .arg("rev-parse")
        .arg("--show-toplevel")
        .output()
        .map_err(|e| anyhow::anyhow!("git is not available on PATH: {e}"))?;

    if !output.status.success() {
        return Ok(None);
    }

    let root = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let root_canon = std::fs::canonicalize(Path::new(&root))?;
    let workspace_canon = std::fs::canonicalize(Path::new(workspace))?;

    if root_canon == workspace_canon {
        return Ok(Some(RepoMode::NotesOnly));
    }

    Ok(Some(if is_notes_monorepo(&root_canon, &workspace_canon)? {
        RepoMode::NotesMonorepo
    } else {
        RepoMode::CodeRepo
    }))
}

/// A directory counts as its own note workspace if it directly carries the
/// marker `.workspace.json` P3-4 already gitignores — the same file
/// `useGitConfig` persists into. Written lazily (first session-state save,
/// not on the folder's very first open), so a course folder opened for the
/// first time ever still reads as a plain `CodeRepo` this once; it detects
/// as `NotesMonorepo` from its next open onward.
fn is_workspace_folder(dir: &Path) -> bool {
    dir.join(".workspace.json").is_file()
}

/// True if every entry in `dir`, other than `except` (the child we walked up
/// from), is either itself a workspace folder or a dotfile/`README.md` —
/// i.e. `dir` holds nothing but sibling note-workspaces and repo
/// bookkeeping, never a stray file or an unmarked folder that could be
/// someone else's source.
fn only_holds_workspace_siblings(dir: &Path, except: &Path) -> anyhow::Result<bool> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path == except {
            continue;
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') || name == "README.md" {
            continue;
        }
        if path.is_dir() && is_workspace_folder(&path) {
            continue;
        }
        return Ok(false);
    }
    Ok(true)
}

/// Walks from `workspace` up to `root`: `workspace` itself must be a marked
/// workspace folder, and every directory in between must hold nothing but
/// sibling workspace folders (plus bookkeeping) alongside the path that
/// leads to it — the whole repo is composed of independent note workspaces,
/// never someone else's source living next to yours. Any single foreign
/// entry at any level falls back to the conservative `CodeRepo` reading.
fn is_notes_monorepo(root: &Path, workspace: &Path) -> anyhow::Result<bool> {
    if !is_workspace_folder(workspace) {
        return Ok(false);
    }

    let mut current = workspace.to_path_buf();
    loop {
        let parent = current
            .parent()
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "{} is not under repo root {}",
                    workspace.display(),
                    root.display()
                )
            })?
            .to_path_buf();
        if !only_holds_workspace_siblings(&parent, &current)? {
            return Ok(false);
        }
        if parent == root {
            return Ok(true);
        }
        current = parent;
    }
}

#[tauri::command]
pub async fn detect_repo(workspace: String) -> Result<Option<RepoMode>, String> {
    tokio::task::spawn_blocking(move || detect_repo_mode(&workspace))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// The pieces of Git state that make committing unsafe to attempt right
/// now. "Back off, never repair" (ROADMAP.md §Phase 5) — this only reads
/// state, never fixes it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UnsafeRepoState {
    DetachedHead,
    MergeInProgress,
    CherryPickInProgress,
    RebaseInProgress,
    UnresolvedConflicts,
}

impl UnsafeRepoState {
    pub fn reason(&self) -> &'static str {
        match self {
            UnsafeRepoState::DetachedHead => "HEAD is detached",
            UnsafeRepoState::MergeInProgress => "a merge is in progress",
            UnsafeRepoState::CherryPickInProgress => "a cherry-pick is in progress",
            UnsafeRepoState::RebaseInProgress => "a rebase is in progress",
            UnsafeRepoState::UnresolvedConflicts => "the index has unresolved conflicts",
        }
    }
}

fn absolute_git_dir(workspace: &str) -> anyhow::Result<PathBuf> {
    let output = no_window_command("git")
        .arg("-C")
        .arg(workspace)
        .arg("rev-parse")
        .arg("--absolute-git-dir")
        .output()?;
    if !output.status.success() {
        anyhow::bail!("not a git repository: {workspace}");
    }
    Ok(PathBuf::from(
        String::from_utf8_lossy(&output.stdout).trim().to_string(),
    ))
}

fn has_unresolved_conflicts(workspace: &str) -> anyhow::Result<bool> {
    let output = no_window_command("git")
        .arg("-C")
        .arg(workspace)
        .arg("ls-files")
        .arg("-u")
        .output()?;
    Ok(!output.stdout.is_empty())
}

/// Resolves the git dir with one subprocess call, then answers everything
/// else by reading its contents directly — only the conflict check genuinely
/// needs git's own index parsing (`ls-files -u`).
pub fn unsafe_repo_state(workspace: &str) -> anyhow::Result<Option<UnsafeRepoState>> {
    let git_dir = absolute_git_dir(workspace)?;

    if git_dir.join("MERGE_HEAD").exists() {
        return Ok(Some(UnsafeRepoState::MergeInProgress));
    }
    if git_dir.join("CHERRY_PICK_HEAD").exists() {
        return Ok(Some(UnsafeRepoState::CherryPickInProgress));
    }
    if git_dir.join("rebase-merge").exists() || git_dir.join("rebase-apply").exists() {
        return Ok(Some(UnsafeRepoState::RebaseInProgress));
    }

    let head = std::fs::read_to_string(git_dir.join("HEAD"))?;
    if !head.trim_start().starts_with("ref:") {
        return Ok(Some(UnsafeRepoState::DetachedHead));
    }

    if has_unresolved_conflicts(workspace)? {
        return Ok(Some(UnsafeRepoState::UnresolvedConflicts));
    }

    Ok(None)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CommitOutcome {
    Committed,
    Skipped { reason: String },
    NothingToCommit,
    HookFailed { output: String },
}

fn build_commit_message(paths: &[String]) -> String {
    let names: Vec<String> = paths
        .iter()
        .map(|p| {
            Path::new(p)
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| p.clone())
        })
        .collect();
    let summary = if names.len() > 4 {
        format!("{}, and {} more", names[..4].join(", "), names.len() - 4)
    } else {
        names.join(", ")
    };
    format!("notes: update {summary}")
}

fn resolve(workspace: &str, path: &str) -> PathBuf {
    let p = Path::new(path);
    if p.is_absolute() {
        p.to_path_buf()
    } else {
        Path::new(workspace).join(p)
    }
}

/// Drops any pathspec that `git add` would otherwise choke the *whole batch*
/// on: one that no longer exists on disk and was never tracked (e.g. a
/// pasted-image `.assets` sidecar cleaned up before its batched commit fired).
/// `git add` treats such a pathspec as fatal — "did not match any files" —
/// and stages nothing at all for the call, not just that one path, which is
/// exactly the silent-forever-retry failure this guards against: the caller
/// only gets a `CommitOutcome`, never a chance to drop the one bad entry.
/// A path that used to be tracked but is now deleted is kept — `git add`
/// correctly stages that as a removal.
fn addable_paths(workspace: &str, paths: &[String]) -> anyhow::Result<Vec<String>> {
    if paths.is_empty() {
        return Ok(Vec::new());
    }

    let ls_output = no_window_command("git")
        .arg("-C")
        .arg(workspace)
        .arg("ls-files")
        .arg("--")
        .args(paths)
        .output()?;
    let tracked: std::collections::HashSet<String> = String::from_utf8_lossy(&ls_output.stdout)
        .lines()
        .map(|s| s.replace('\\', "/"))
        .collect();

    let toplevel_output = no_window_command("git")
        .arg("-C")
        .arg(workspace)
        .arg("rev-parse")
        .arg("--show-toplevel")
        .output()?;
    let root = String::from_utf8_lossy(&toplevel_output.stdout)
        .trim()
        .replace('\\', "/");

    Ok(paths
        .iter()
        .filter(|p| {
            if resolve(workspace, p).exists() {
                return true;
            }
            let normalized = p.replace('\\', "/");
            let rel = normalized
                .strip_prefix(&root)
                .map(|s| s.trim_start_matches('/'))
                .unwrap_or(normalized.as_str());
            tracked.contains(rel)
        })
        .cloned()
        .collect())
}

fn has_pending_changes(workspace: &str, paths: &[String]) -> anyhow::Result<bool> {
    if paths.is_empty() {
        return Ok(false);
    }
    let output = no_window_command("git")
        .arg("-C")
        .arg(workspace)
        .arg("status")
        .arg("--porcelain")
        .arg("--")
        .args(paths)
        .output()?;
    Ok(!output.stdout.is_empty())
}

/// Ensures `workspace`'s own `.gitignore` carries every line this app
/// depends on (`NOTES_GITIGNORE`'s `.workspace.json` and `.*.tmp`),
/// appending whichever are missing rather than overwriting the file —
/// `checked_init_notes_repo`'s own "never overwrite an existing .gitignore"
/// guarantee still has to hold for a workspace that already had one before
/// this app ever touched it. Only meaningful for a repo this app treats as
/// its own (`NotesOnly`/`NotesMonorepo`); a `CodeRepo`'s `.gitignore` is
/// shared with people who never opted into this app's automation, so it's
/// never auto-edited. Returns `true` if the file was created or changed, so
/// the caller can fold it into the same commit as the notes that triggered
/// this cycle.
fn ensure_notes_gitignore(workspace: &str) -> anyhow::Result<bool> {
    let gitignore_path = Path::new(workspace).join(".gitignore");
    if !gitignore_path.exists() {
        std::fs::write(&gitignore_path, NOTES_GITIGNORE)?;
        return Ok(true);
    }

    let existing = std::fs::read_to_string(&gitignore_path)?;
    let missing: Vec<&str> = NOTES_GITIGNORE
        .lines()
        .filter(|required| !existing.lines().any(|line| line == *required))
        .collect();
    if missing.is_empty() {
        return Ok(false);
    }

    let mut updated = existing;
    if !updated.is_empty() && !updated.ends_with('\n') {
        updated.push('\n');
    }
    for line in missing {
        updated.push_str(line);
        updated.push('\n');
    }
    std::fs::write(&gitignore_path, updated)?;
    Ok(true)
}

/// Commits only `paths`, never anything else staged in the repo. Backs off
/// quietly on an unsafe repo state; aborts (without committing) if a hook
/// rejects the commit, unless `skip_hooks` opts out of running them at all.
pub fn checked_auto_commit(
    workspace: &str,
    mode: RepoMode,
    paths: &[String],
    skip_hooks: bool,
) -> anyhow::Result<CommitOutcome> {
    if let Some(state) = unsafe_repo_state(workspace)? {
        return Ok(CommitOutcome::Skipped {
            reason: state.reason().to_string(),
        });
    }

    let mut paths = paths.to_vec();
    if mode != RepoMode::CodeRepo && ensure_notes_gitignore(workspace)? {
        paths.push(".gitignore".to_string());
    }
    let paths = addable_paths(workspace, &paths)?;

    if !has_pending_changes(workspace, &paths)? {
        return Ok(CommitOutcome::NothingToCommit);
    }

    let add_status = no_window_command("git")
        .arg("-C")
        .arg(workspace)
        .arg("add")
        .arg("--")
        .args(&paths)
        .status()?;
    if !add_status.success() {
        anyhow::bail!("git add failed for {workspace}");
    }

    let mut commit_cmd = no_window_command("git");
    commit_cmd.arg("-C").arg(workspace).arg("commit");
    if skip_hooks {
        commit_cmd.arg("--no-verify");
    }
    commit_cmd.arg("-m").arg(build_commit_message(&paths));
    commit_cmd.arg("--").args(&paths);
    let output = commit_cmd.output()?;

    if output.status.success() {
        Ok(CommitOutcome::Committed)
    } else {
        Ok(CommitOutcome::HookFailed {
            output: String::from_utf8_lossy(&output.stderr).into_owned(),
        })
    }
}

#[tauri::command]
pub async fn auto_commit(
    workspace: String,
    mode: RepoMode,
    paths: Vec<String>,
    skip_hooks: bool,
) -> Result<CommitOutcome, String> {
    tokio::task::spawn_blocking(move || checked_auto_commit(&workspace, mode, &paths, skip_hooks))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// How many recent commits `list_note_history_at` returns for one note —
/// enough for "did I lose anything recently," not a full audit log.
pub const NOTE_HISTORY_LIMIT: usize = 20;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NoteHistoryEntry {
    pub sha: String,
    pub timestamp_ms: i64,
    pub message: String,
    /// The note's path *as of this commit*, repo-root-relative. `--follow`
    /// means older entries can predate a rename — reading their content
    /// needs the name they had then, not the note's current name, or
    /// `git show` fails with "exists on disk, but not in <sha>" for any
    /// commit before the rename. Feed this straight into
    /// `read_note_at_commit_at`.
    pub path: String,
}

/// A `--format=%H%x1f%at%x1f%s` line: two `\u{1f}` field separators, which
/// a `--name-only` filename line (the line that follows each of these) never
/// contains.
fn parse_commit_meta(line: &str) -> Option<(String, i64, String)> {
    if !line.contains('\u{1f}') {
        return None;
    }
    let mut fields = line.splitn(3, '\u{1f}');
    let sha = fields.next()?.to_string();
    let timestamp_s: i64 = fields.next()?.parse().ok()?;
    let message = fields.next().unwrap_or_default().to_string();
    Some((sha, timestamp_s, message))
}

/// The commits touching `note_path`, newest first, capped at
/// `NOTE_HISTORY_LIMIT`. `--follow` keeps history intact across a rename —
/// history is exactly the case where that must not look like the file's
/// story restarted. `note_path` is the note's ordinary absolute path: a git
/// pathspec resolves an absolute path correctly regardless of `-C`, the
/// same assumption `checked_auto_commit`'s own `paths` argument already
/// relies on. `--name-only` recovers each commit's path-at-that-time (see
/// `NoteHistoryEntry::path`) — already repo-root-relative, exactly what
/// `read_note_at_commit_at`'s `<rev>:<path>` needs, no relativizing here.
pub fn list_note_history_at(
    workspace: &str,
    note_path: &str,
) -> anyhow::Result<Vec<NoteHistoryEntry>> {
    let output = no_window_command("git")
        .arg("-C")
        .arg(workspace)
        .arg("log")
        .arg("--follow")
        .arg("--name-only")
        .arg(format!("-n{NOTE_HISTORY_LIMIT}"))
        .arg("--format=%H%x1f%at%x1f%s")
        .arg("--")
        .arg(note_path)
        .output()?;

    if !output.status.success() {
        anyhow::bail!(
            "git log failed for {note_path}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let mut entries = Vec::new();
    let mut pending: Option<(String, i64, String)> = None;
    for line in text.lines() {
        if let Some(meta) = parse_commit_meta(line) {
            pending = Some(meta);
        } else if !line.is_empty() {
            if let Some((sha, timestamp_s, message)) = pending.take() {
                entries.push(NoteHistoryEntry {
                    sha,
                    timestamp_ms: timestamp_s * 1000,
                    message,
                    path: line.to_string(),
                });
            }
        }
    }
    Ok(entries)
}

#[tauri::command]
pub async fn list_note_history(
    workspace: String,
    note_path: String,
) -> Result<Vec<NoteHistoryEntry>, String> {
    tokio::task::spawn_blocking(move || list_note_history_at(&workspace, &note_path))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// Reads `relative_path`'s content as of `sha`. `relative_path` must already
/// be repo-root-relative — the exact form `NoteHistoryEntry::path` returns —
/// since `git show <rev>:<path>` always resolves `<path>` relative to the
/// repo root, never to `-C`'s working directory, regardless of `workspace`
/// being a subtree of the repo (`RepoMode::CodeRepo`).
pub fn read_note_at_commit_at(
    workspace: &str,
    relative_path: &str,
    sha: &str,
) -> anyhow::Result<String> {
    // sha is interpolated straight into a single `<rev>:<path>` argument below.
    // Without this check a value like "--output=..." would be parsed by git
    // as a flag rather than a revision (M-6) since it's never passed through
    // a shell that would otherwise need escaping.
    if sha.len() < 7 || sha.len() > 40 || !sha.bytes().all(|b| b.is_ascii_hexdigit()) {
        anyhow::bail!("invalid commit sha: {sha}");
    }

    let output = no_window_command("git")
        .arg("-C")
        .arg(workspace)
        .arg("show")
        .arg(format!("{sha}:{relative_path}"))
        .output()?;

    if !output.status.success() {
        anyhow::bail!(
            "git show failed for {sha}:{relative_path}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

#[tauri::command]
pub async fn read_note_at_commit(
    workspace: String,
    relative_path: String,
    sha: String,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || read_note_at_commit_at(&workspace, &relative_path, &sha))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PushOutcome {
    Pushed,
    NoRemote,
    AuthFailed { output: String },
    Rejected { output: String },
}

fn has_remote(workspace: &str) -> anyhow::Result<bool> {
    let output = no_window_command("git")
        .arg("-C")
        .arg(workspace)
        .arg("remote")
        .output()?;
    Ok(!String::from_utf8_lossy(&output.stdout).trim().is_empty())
}

/// Never called for `RepoMode::CodeRepo` from the frontend unless the user
/// has explicitly opted this specific workspace in (`allow_code_repo_push`,
/// set only through a confirm dialog — see `SettingsPanel`), but the guard
/// lives here too — structural, not only a UI-layer check (P5-3).
/// `NotesMonorepo` is never blocked: `is_notes_monorepo` already confirmed
/// the whole repo is nothing but sibling note workspaces, which is exactly
/// `NotesOnly`'s own safety property, just at a different root.
pub fn checked_push(
    workspace: &str,
    mode: RepoMode,
    allow_code_repo_push: bool,
) -> anyhow::Result<PushOutcome> {
    if mode == RepoMode::CodeRepo && !allow_code_repo_push {
        anyhow::bail!(
            "refusing to push a CodeRepo workspace — set allow_code_repo_push to override"
        );
    }
    if !has_remote(workspace)? {
        return Ok(PushOutcome::NoRemote);
    }

    // `-u origin HEAD`, not a bare `push`: a repo `checked_init_notes_repo`
    // just created has a remote but no upstream tracking branch yet (`gh
    // repo create` adds the remote without pushing), so the first
    // auto-commit's push would otherwise fail with "no upstream branch" —
    // silently, since that's a plain rejection, not an auth error. Safe to
    // pass unconditionally: a no-op once tracking already exists.
    let output = no_window_command("git")
        .arg("-C")
        .arg(workspace)
        .arg("push")
        .arg("-u")
        .arg("origin")
        .arg("HEAD")
        .output()?;
    if output.status.success() {
        return Ok(PushOutcome::Pushed);
    }

    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    if stderr.contains("Authentication failed") || stderr.contains("Permission denied") {
        Ok(PushOutcome::AuthFailed { output: stderr })
    } else {
        // Non-fast-forward and everything else — surfaced, never retried,
        // never forced.
        Ok(PushOutcome::Rejected { output: stderr })
    }
}

#[tauri::command]
pub async fn push_notes(
    workspace: String,
    mode: RepoMode,
    allow_code_repo_push: bool,
) -> Result<PushOutcome, String> {
    tokio::task::spawn_blocking(move || checked_push(&workspace, mode, allow_code_repo_push))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PullOutcome {
    UpToDate,
    FastForwarded,
    Diverged { ahead: u32, behind: u32 },
    NoRemote,
}

fn count_commits(workspace: &str, range: &str) -> anyhow::Result<u32> {
    let output = no_window_command("git")
        .arg("-C")
        .arg(workspace)
        .arg("rev-list")
        .arg("--count")
        .arg(range)
        .output()?;
    if !output.status.success() {
        anyhow::bail!("git rev-list --count {range} failed for {workspace}");
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().parse()?)
}

/// Fetches, then either fast-forwards silently or reports a divergence —
/// never a real merge, never a rebase, never `reset --hard`. The resulting
/// file changes (on a fast-forward) are an ordinary external edit from the
/// app's point of view; P0-5's watcher and `useNote`'s existing
/// dirty/conflict handling pick them up with no new logic needed here.
pub fn checked_pull(workspace: &str) -> anyhow::Result<PullOutcome> {
    if !has_remote(workspace)? {
        return Ok(PullOutcome::NoRemote);
    }

    let fetch_status = no_window_command("git")
        .arg("-C")
        .arg(workspace)
        .arg("fetch")
        .status()?;
    if !fetch_status.success() {
        anyhow::bail!("git fetch failed for {workspace}");
    }

    let ahead = count_commits(workspace, "@{u}..HEAD")?;
    let behind = count_commits(workspace, "HEAD..@{u}")?;

    if behind == 0 {
        return Ok(PullOutcome::UpToDate);
    }
    if ahead > 0 {
        return Ok(PullOutcome::Diverged { ahead, behind });
    }

    // `--ff-only`: moves the branch ref if and only if it's a pure
    // fast-forward, and refuses (rather than merging) if a local
    // uncommitted change would be overwritten.
    let merge_status = no_window_command("git")
        .arg("-C")
        .arg(workspace)
        .arg("merge")
        .arg("--ff-only")
        .arg("@{u}")
        .status()?;
    if !merge_status.success() {
        anyhow::bail!("fast-forward merge unexpectedly failed for {workspace}");
    }
    Ok(PullOutcome::FastForwarded)
}

#[tauri::command]
pub async fn fetch_and_compare(workspace: String) -> Result<PullOutcome, String> {
    tokio::task::spawn_blocking(move || checked_pull(&workspace))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// The workspace `.gitignore` this app documents in README.md — kept as one
/// constant so the two never drift apart.
pub const NOTES_GITIGNORE: &str = ".workspace.json\n.*.tmp\n";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RepoInitOutcome {
    /// A private GitHub remote was created and set as `origin`.
    InitializedWithRemote,
    /// `git init` succeeded but there's no remote yet — either `gh` isn't on
    /// `PATH`, a remote wasn't requested, or `gh repo create` itself failed.
    /// `remote_add_command` is the exact command to run by hand; `gh` is
    /// never a hard dependency (P5-5's own DoD).
    InitializedLocalOnly { remote_add_command: String },
}

/// Slugifies a workspace folder name into a valid GitHub repo name
/// component: GitHub only accepts letters, digits, `.`, `_` and `-` — a
/// space, colon or parenthesis in the folder name (`Analysis 2 (2026)`)
/// would otherwise make `gh repo create` reject the name outright. Any run
/// of disallowed characters collapses to a single `-`.
fn slugify(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut last_was_dash = false;
    for c in name.chars() {
        if c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-' {
            out.push(c);
            last_was_dash = c == '-';
        } else if !last_was_dash {
            out.push('-');
            last_was_dash = true;
        }
    }
    out.trim_matches('-').to_string()
}

fn has_gh() -> bool {
    let probe = if cfg!(windows) { "where" } else { "which" };
    no_window_command(probe)
        .arg("gh")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

pub fn checked_init_notes_repo(
    workspace: &str,
    create_github_remote: bool,
) -> anyhow::Result<RepoInitOutcome> {
    let init_status = no_window_command("git")
        .arg("-C")
        .arg(workspace)
        .arg("init")
        .status()?;
    if !init_status.success() {
        anyhow::bail!("git init failed for {workspace}");
    }

    let gitignore_path = Path::new(workspace).join(".gitignore");
    if !gitignore_path.exists() {
        std::fs::write(&gitignore_path, NOTES_GITIGNORE)?;

        // Written to disk is not the same as versioned: a `.gitignore` that
        // stays untracked never travels to a clone on another machine, so
        // the very thing it's meant to hide (`.workspace.json`) is exactly
        // what a second machine would end up tracking instead.
        let add_status = no_window_command("git")
            .arg("-C")
            .arg(workspace)
            .arg("add")
            .arg("--")
            .arg(".gitignore")
            .status()?;
        if !add_status.success() {
            anyhow::bail!("git add .gitignore failed for {workspace}");
        }
        let commit_status = no_window_command("git")
            .arg("-C")
            .arg(workspace)
            .arg("commit")
            .arg("-m")
            .arg("notes: ignore workspace state and temp files")
            .arg("--")
            .arg(".gitignore")
            .status()?;
        if !commit_status.success() {
            anyhow::bail!("git commit of .gitignore failed for {workspace}");
        }
    }

    if create_github_remote && has_gh() {
        // Named explicitly rather than left to gh's own default (the source
        // folder's bare basename) — "null-notes-<folder>" makes a repo
        // created by this app identifiable as one at a glance in the GitHub
        // repo list, without relying on gh to guess a name from a folder
        // that might not even be unique across courses.
        let folder_name = Path::new(workspace)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "workspace".to_string());
        let repo_name = format!("null-notes-{}", slugify(&folder_name));

        // Private by default: lecture notes must not become public by
        // accident.
        let status = no_window_command("gh")
            .arg("repo")
            .arg("create")
            .arg(&repo_name)
            .arg("--source")
            .arg(workspace)
            .arg("--private")
            .arg("--remote")
            .arg("origin")
            .status()?;
        if status.success() {
            return Ok(RepoInitOutcome::InitializedWithRemote);
        }
        // Falls through to local-only on any gh failure.
    }

    Ok(RepoInitOutcome::InitializedLocalOnly {
        remote_add_command: "git remote add origin <your-repo-url>".to_string(),
    })
}

#[tauri::command]
pub async fn init_notes_repo(
    workspace: String,
    create_github_remote: bool,
) -> Result<RepoInitOutcome, String> {
    tokio::task::spawn_blocking(move || checked_init_notes_repo(&workspace, create_github_remote))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    // These tests, and the production code they exercise, both shell out to
    // plain `git commit` — which refuses to commit without a resolvable
    // identity anywhere in the config chain. A developer machine normally has
    // that set globally, masking the dependency; CI runners don't, so every
    // repo this suite creates needs its own local identity rather than
    // relying on one being ambient. `git init`/`git clone` each produce a
    // fresh `.git/config`, so this has to run after every one of them, not
    // just once.
    fn configure_test_identity(dir: &Path) {
        for (key, value) in [
            ("user.name", "Test User"),
            ("user.email", "test@example.com"),
        ] {
            let status = no_window_command("git")
                .arg("-C")
                .arg(dir)
                .arg("config")
                .arg(key)
                .arg(value)
                .status()
                .unwrap();
            assert!(status.success());
        }
    }

    fn git_init(dir: &Path) {
        let status = no_window_command("git")
            .arg("-C")
            .arg(dir)
            .arg("init")
            .arg("-q")
            .status()
            .unwrap();
        assert!(status.success());
        configure_test_identity(dir);
    }

    fn git_clone(remote: &Path, dest: &Path) {
        let status = no_window_command("git")
            .arg("clone")
            .arg("-q")
            .arg(remote)
            .arg(dest)
            .status()
            .unwrap();
        assert!(status.success());
        configure_test_identity(dest);
    }

    fn commit_sha_of_head(dir: &Path) -> String {
        let output = no_window_command("git")
            .arg("-C")
            .arg(dir)
            .arg("rev-parse")
            .arg("HEAD")
            .output()
            .unwrap();
        assert!(output.status.success());
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    fn commit_note_file(dir: &Path, relative_path: &str, content: &str, message: &str) -> String {
        let path = dir.join(relative_path);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(&path, content).unwrap();
        let add_status = no_window_command("git")
            .arg("-C")
            .arg(dir)
            .arg("add")
            .arg("--")
            .arg(relative_path)
            .status()
            .unwrap();
        assert!(add_status.success());
        let commit_status = no_window_command("git")
            .arg("-C")
            .arg(dir)
            .arg("commit")
            .arg("-m")
            .arg(message)
            .status()
            .unwrap();
        assert!(commit_status.success());
        commit_sha_of_head(dir)
    }

    #[test]
    fn list_note_history_returns_commits_touching_the_path_newest_first() {
        let tmp = tempdir().unwrap();
        git_init(tmp.path());
        let note_path = tmp.path().join("Todo.md").to_string_lossy().into_owned();

        let first_sha = commit_note_file(
            tmp.path(),
            "Todo.md",
            "# Todo\n\n- one\n",
            "notes: update Todo",
        );
        let second_sha = commit_note_file(
            tmp.path(),
            "Todo.md",
            "# Todo\n\n- one\n- two\n",
            "notes: update Todo",
        );

        let entries = list_note_history_at(&tmp.path().to_string_lossy(), &note_path).unwrap();

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].sha, second_sha, "newest first");
        assert_eq!(entries[0].message, "notes: update Todo");
        assert_eq!(entries[0].path, "Todo.md");
        assert_eq!(entries[1].sha, first_sha);
        assert_eq!(entries[1].path, "Todo.md");
    }

    #[test]
    fn list_note_history_is_capped_at_the_limit() {
        let tmp = tempdir().unwrap();
        git_init(tmp.path());
        let note_path = tmp.path().join("Todo.md").to_string_lossy().into_owned();

        for i in 0..(NOTE_HISTORY_LIMIT + 5) {
            commit_note_file(
                tmp.path(),
                "Todo.md",
                &format!("edit {i}\n"),
                &format!("edit {i}"),
            );
        }

        let entries = list_note_history_at(&tmp.path().to_string_lossy(), &note_path).unwrap();

        assert_eq!(entries.len(), NOTE_HISTORY_LIMIT);
    }

    #[test]
    fn list_note_history_follows_a_rename() {
        let tmp = tempdir().unwrap();
        git_init(tmp.path());
        let old_sha = commit_note_file(tmp.path(), "Old.md", "# Old\n", "notes: update Old");

        let rename_status = no_window_command("git")
            .arg("-C")
            .arg(tmp.path())
            .arg("mv")
            .arg("Old.md")
            .arg("New.md")
            .status()
            .unwrap();
        assert!(rename_status.success());
        let commit_status = no_window_command("git")
            .arg("-C")
            .arg(tmp.path())
            .arg("commit")
            .arg("-m")
            .arg("rename Old to New")
            .status()
            .unwrap();
        assert!(commit_status.success());
        let rename_sha = commit_sha_of_head(tmp.path());
        let new_path = tmp.path().join("New.md").to_string_lossy().into_owned();

        let entries = list_note_history_at(&tmp.path().to_string_lossy(), &new_path).unwrap();

        assert_eq!(entries.len(), 2, "history must survive the rename");
        assert_eq!(entries[0].sha, rename_sha);
        assert_eq!(entries[0].path, "New.md");
        assert_eq!(entries[1].sha, old_sha);
        assert_eq!(
            entries[1].path, "Old.md",
            "the pre-rename commit's path must be its name at that commit, not the note's current name"
        );
    }

    #[test]
    fn list_note_history_returns_empty_for_a_path_with_no_history() {
        let tmp = tempdir().unwrap();
        git_init(tmp.path());
        commit_note_file(tmp.path(), "Other.md", "# Other\n", "notes: update Other");
        let untouched_path = tmp.path().join("Todo.md").to_string_lossy().into_owned();

        let entries = list_note_history_at(&tmp.path().to_string_lossy(), &untouched_path).unwrap();

        assert!(entries.is_empty());
    }

    #[test]
    fn read_note_at_commit_returns_the_historical_content() {
        let tmp = tempdir().unwrap();
        git_init(tmp.path());
        let first_sha = commit_note_file(
            tmp.path(),
            "Todo.md",
            "# Todo\n\n- one\n",
            "notes: update Todo",
        );
        commit_note_file(
            tmp.path(),
            "Todo.md",
            "# Todo\n\n- one\n- two\n",
            "notes: update Todo",
        );

        let content =
            read_note_at_commit_at(&tmp.path().to_string_lossy(), "Todo.md", &first_sha).unwrap();

        assert_eq!(content, "# Todo\n\n- one\n");
    }

    #[test]
    fn read_note_at_commit_resolves_relative_to_repo_root_regardless_of_workspace() {
        // A RepoMode::CodeRepo shape: the workspace is a subdirectory of the
        // repo, not the repo root itself. `relative_path` is always
        // repo-root-relative (what list_note_history_at hands back), and
        // `-C workspace` must not change how it resolves.
        let tmp = tempdir().unwrap();
        git_init(tmp.path());
        let notes_dir = tmp.path().join("notes");
        std::fs::create_dir(&notes_dir).unwrap();

        let sha = commit_note_file(
            tmp.path(),
            "notes/Todo.md",
            "# Todo\n\n- one\n",
            "notes: update Todo",
        );

        let content =
            read_note_at_commit_at(&notes_dir.to_string_lossy(), "notes/Todo.md", &sha).unwrap();

        assert_eq!(content, "# Todo\n\n- one\n");
    }

    #[test]
    fn read_note_at_commit_uses_the_historical_path_from_before_a_rename() {
        // Reproduces the reported bug: selecting a history entry from
        // before a rename must not try to read the note's *current* name at
        // that old sha — list_note_history_at's per-entry `path` is what
        // makes that possible.
        let tmp = tempdir().unwrap();
        git_init(tmp.path());
        let old_sha = commit_note_file(tmp.path(), "Old.md", "# Old\n", "notes: update Old");
        no_window_command("git")
            .arg("-C")
            .arg(tmp.path())
            .arg("mv")
            .arg("Old.md")
            .arg("New.md")
            .status()
            .unwrap();
        no_window_command("git")
            .arg("-C")
            .arg(tmp.path())
            .arg("commit")
            .arg("-m")
            .arg("rename Old to New")
            .status()
            .unwrap();
        let new_path = tmp.path().join("New.md").to_string_lossy().into_owned();

        let entries = list_note_history_at(&tmp.path().to_string_lossy(), &new_path).unwrap();
        let pre_rename_entry = entries.iter().find(|e| e.sha == old_sha).unwrap();

        let content = read_note_at_commit_at(
            &tmp.path().to_string_lossy(),
            &pre_rename_entry.path,
            &old_sha,
        )
        .unwrap();

        assert_eq!(content, "# Old\n");
    }

    #[test]
    fn read_note_at_commit_rejects_a_sha_that_looks_like_a_flag() {
        let tmp = tempdir().unwrap();
        git_init(tmp.path());
        commit_note_file(tmp.path(), "Todo.md", "# Todo\n", "notes: update Todo");

        let err = read_note_at_commit_at(&tmp.path().to_string_lossy(), "Todo.md", "--output=evil")
            .unwrap_err();

        assert!(err.to_string().contains("invalid commit sha"));
    }

    #[test]
    fn a_plain_folder_is_not_a_repo() {
        let tmp = tempdir().unwrap();

        let mode = detect_repo_mode(&tmp.path().to_string_lossy()).unwrap();

        assert_eq!(mode, None);
    }

    #[test]
    fn the_workspace_at_the_repo_root_is_notes_only() {
        let tmp = tempdir().unwrap();
        git_init(tmp.path());

        let mode = detect_repo_mode(&tmp.path().to_string_lossy()).unwrap();

        assert_eq!(mode, Some(RepoMode::NotesOnly));
    }

    #[test]
    fn a_workspace_inside_a_larger_repo_is_a_code_repo() {
        let tmp = tempdir().unwrap();
        git_init(tmp.path());
        let notes_dir = tmp.path().join("notes");
        std::fs::create_dir(&notes_dir).unwrap();

        let mode = detect_repo_mode(&notes_dir.to_string_lossy()).unwrap();

        assert_eq!(mode, Some(RepoMode::CodeRepo));
    }

    // A workspace two levels under the repo root with no `.workspace.json`
    // anywhere in the chain is still a plain code repo — depth past the root
    // doesn't by itself earn the NotesMonorepo reading.
    #[test]
    fn depth_below_the_repo_root_stays_code_repo() {
        let tmp = tempdir().unwrap();
        git_init(tmp.path());
        let nested = tmp.path().join("courses").join("cs101");
        std::fs::create_dir_all(&nested).unwrap();

        let mode = detect_repo_mode(&nested.to_string_lossy()).unwrap();

        assert_eq!(mode, Some(RepoMode::CodeRepo));
    }

    fn mark_as_workspace(dir: &Path) {
        std::fs::write(dir.join(".workspace.json"), "{}").unwrap();
    }

    // The user's own motivating shape: a "Courses" repo root holding nothing
    // but sibling course workspaces (DSA, Analysis_2), each independently
    // opened and each carrying its own `.workspace.json`.
    #[test]
    fn a_repo_of_nothing_but_sibling_course_workspaces_is_a_notes_monorepo() {
        let tmp = tempdir().unwrap();
        git_init(tmp.path());
        mark_as_workspace(tmp.path());
        let dsa = tmp.path().join("DSA");
        std::fs::create_dir(&dsa).unwrap();
        mark_as_workspace(&dsa);
        let analysis = tmp.path().join("Analysis_2");
        std::fs::create_dir(&analysis).unwrap();
        mark_as_workspace(&analysis);

        let mode = detect_repo_mode(&dsa.to_string_lossy()).unwrap();

        assert_eq!(mode, Some(RepoMode::NotesMonorepo));
    }

    // One stray foreign entry at the repo root — a real source folder sitting
    // next to the course workspaces — must fall back to the conservative
    // CodeRepo reading, not a false-positive NotesMonorepo.
    #[test]
    fn a_foreign_sibling_at_the_repo_root_disqualifies_the_monorepo_reading() {
        let tmp = tempdir().unwrap();
        git_init(tmp.path());
        let dsa = tmp.path().join("DSA");
        std::fs::create_dir(&dsa).unwrap();
        mark_as_workspace(&dsa);
        std::fs::create_dir(tmp.path().join("src")).unwrap();
        std::fs::write(tmp.path().join("src").join("main.rs"), "fn main() {}").unwrap();

        let mode = detect_repo_mode(&dsa.to_string_lossy()).unwrap();

        assert_eq!(mode, Some(RepoMode::CodeRepo));
    }

    // A folder opened for the very first time ever has no `.workspace.json`
    // yet (it's written lazily, on first session-state save) — even with
    // perfectly clean siblings, it must read as CodeRepo this once rather
    // than guessing monorepo from folder shape alone.
    #[test]
    fn a_workspace_not_yet_marked_itself_stays_code_repo_even_with_clean_siblings() {
        let tmp = tempdir().unwrap();
        git_init(tmp.path());
        let dsa = tmp.path().join("DSA");
        std::fs::create_dir(&dsa).unwrap();
        // DSA itself is deliberately left unmarked.
        let analysis = tmp.path().join("Analysis_2");
        std::fs::create_dir(&analysis).unwrap();
        mark_as_workspace(&analysis);

        let mode = detect_repo_mode(&dsa.to_string_lossy()).unwrap();

        assert_eq!(mode, Some(RepoMode::CodeRepo));
    }

    fn commit_file(dir: &Path, name: &str, content: &str) {
        std::fs::write(dir.join(name), content).unwrap();
        let add_status = no_window_command("git")
            .arg("-C")
            .arg(dir)
            .arg("add")
            .arg(name)
            .status()
            .unwrap();
        assert!(add_status.success());
        let commit_status = no_window_command("git")
            .arg("-C")
            .arg(dir)
            .arg("commit")
            .arg("-m")
            .arg(format!("add {name}"))
            .status()
            .unwrap();
        assert!(commit_status.success());
    }

    #[test]
    fn a_clean_repo_is_safe() {
        let tmp = tempdir().unwrap();
        git_init(tmp.path());
        commit_file(tmp.path(), "a.md", "hello");

        assert_eq!(
            unsafe_repo_state(&tmp.path().to_string_lossy()).unwrap(),
            None
        );
    }

    #[test]
    fn a_detached_head_is_unsafe() {
        let tmp = tempdir().unwrap();
        git_init(tmp.path());
        commit_file(tmp.path(), "a.md", "hello");
        let sha = no_window_command("git")
            .arg("-C")
            .arg(tmp.path())
            .arg("rev-parse")
            .arg("HEAD")
            .output()
            .unwrap();
        let sha = String::from_utf8_lossy(&sha.stdout).trim().to_string();
        no_window_command("git")
            .arg("-C")
            .arg(tmp.path())
            .arg("checkout")
            .arg(&sha)
            .status()
            .unwrap();

        assert_eq!(
            unsafe_repo_state(&tmp.path().to_string_lossy()).unwrap(),
            Some(UnsafeRepoState::DetachedHead)
        );
    }

    #[test]
    fn a_merge_in_progress_is_unsafe() {
        let tmp = tempdir().unwrap();
        git_init(tmp.path());
        commit_file(tmp.path(), "a.md", "hello");
        // Simulating the marker file directly is sufficient — this test is
        // about the detection logic, not about provoking a real conflict.
        std::fs::write(tmp.path().join(".git").join("MERGE_HEAD"), "abc123\n").unwrap();

        assert_eq!(
            unsafe_repo_state(&tmp.path().to_string_lossy()).unwrap(),
            Some(UnsafeRepoState::MergeInProgress)
        );
    }

    #[test]
    fn a_cherry_pick_in_progress_is_unsafe() {
        let tmp = tempdir().unwrap();
        git_init(tmp.path());
        commit_file(tmp.path(), "a.md", "hello");
        std::fs::write(tmp.path().join(".git").join("CHERRY_PICK_HEAD"), "abc123\n").unwrap();

        assert_eq!(
            unsafe_repo_state(&tmp.path().to_string_lossy()).unwrap(),
            Some(UnsafeRepoState::CherryPickInProgress)
        );
    }

    #[test]
    fn a_rebase_in_progress_is_unsafe() {
        let tmp = tempdir().unwrap();
        git_init(tmp.path());
        commit_file(tmp.path(), "a.md", "hello");
        std::fs::create_dir(tmp.path().join(".git").join("rebase-merge")).unwrap();

        assert_eq!(
            unsafe_repo_state(&tmp.path().to_string_lossy()).unwrap(),
            Some(UnsafeRepoState::RebaseInProgress)
        );
    }

    // A conflicted `merge` also leaves MERGE_HEAD behind, which
    // unsafe_repo_state checks first — correctly, since "a merge is in
    // progress" is the more specific, more actionable reason. So this test
    // has to reach unresolved conflicts through a path that leaves *no*
    // merge/rebase/cherry-pick marker: a conflicting `stash pop`.
    #[test]
    fn unresolved_conflicts_with_no_in_progress_operation_are_unsafe() {
        let tmp = tempdir().unwrap();
        git_init(tmp.path());
        commit_file(tmp.path(), "a.md", "base\n");

        std::fs::write(tmp.path().join("a.md"), "stashed\n").unwrap();
        no_window_command("git")
            .arg("-C")
            .arg(tmp.path())
            .arg("stash")
            .arg("push")
            .status()
            .unwrap();
        commit_file(tmp.path(), "a.md", "conflicting\n");
        // Expected to fail with a real conflict — that's the point.
        let _ = no_window_command("git")
            .arg("-C")
            .arg(tmp.path())
            .arg("stash")
            .arg("pop")
            .status();

        let git_dir = absolute_git_dir(&tmp.path().to_string_lossy()).unwrap();
        assert!(
            !git_dir.join("MERGE_HEAD").exists(),
            "a stash pop must not set MERGE_HEAD"
        );

        assert_eq!(
            unsafe_repo_state(&tmp.path().to_string_lossy()).unwrap(),
            Some(UnsafeRepoState::UnresolvedConflicts)
        );
    }

    fn write_failing_pre_commit_hook(workspace: &Path) {
        let git_dir = absolute_git_dir(&workspace.to_string_lossy()).unwrap();
        let hooks_dir = git_dir.join("hooks");
        std::fs::create_dir_all(&hooks_dir).unwrap();
        let hook_path = hooks_dir.join("pre-commit");
        std::fs::write(&hook_path, "#!/bin/sh\nexit 1\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&hook_path).unwrap().permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&hook_path, perms).unwrap();
        }
    }

    #[test]
    fn commits_only_the_given_note_paths() {
        let tmp = tempdir().unwrap();
        git_init(tmp.path());
        commit_file(tmp.path(), "src.rs", "fn main() {}\n");
        commit_file(tmp.path(), "note.md", "# Note\n");

        // A staged source change and an unstaged source edit — both must
        // survive the auto-commit byte-for-byte. This is the one
        // unforgivable failure per P5-2's own DoD.
        std::fs::write(tmp.path().join("src.rs"), "fn main() { staged() }\n").unwrap();
        no_window_command("git")
            .arg("-C")
            .arg(tmp.path())
            .arg("add")
            .arg("src.rs")
            .status()
            .unwrap();
        std::fs::write(tmp.path().join("note.md"), "# Note\nmore\n").unwrap();
        std::fs::write(
            tmp.path().join("src.rs"),
            "fn main() { staged() } // unstaged\n",
        )
        .unwrap();

        // Scoped to src.rs specifically — the whole-repo diff listing is
        // *expected* to shrink once note.md's own change is committed, so
        // comparing the unscoped listing before/after would be the wrong
        // assertion. What must be identical is src.rs's own staged and
        // unstaged content.
        let staged_before = no_window_command("git")
            .arg("-C")
            .arg(tmp.path())
            .arg("diff")
            .arg("--cached")
            .arg("--")
            .arg("src.rs")
            .output()
            .unwrap();
        let unstaged_before = no_window_command("git")
            .arg("-C")
            .arg(tmp.path())
            .arg("diff")
            .arg("--")
            .arg("src.rs")
            .output()
            .unwrap();

        let outcome = checked_auto_commit(
            &tmp.path().to_string_lossy(),
            RepoMode::CodeRepo,
            &["note.md".to_string()],
            false,
        )
        .unwrap();

        assert_eq!(outcome, CommitOutcome::Committed);

        let staged_after = no_window_command("git")
            .arg("-C")
            .arg(tmp.path())
            .arg("diff")
            .arg("--cached")
            .arg("--")
            .arg("src.rs")
            .output()
            .unwrap();
        let unstaged_after = no_window_command("git")
            .arg("-C")
            .arg(tmp.path())
            .arg("diff")
            .arg("--")
            .arg("src.rs")
            .output()
            .unwrap();
        assert_eq!(
            staged_before.stdout, staged_after.stdout,
            "src.rs's staged change must be untouched"
        );
        assert_eq!(
            unstaged_before.stdout, unstaged_after.stdout,
            "src.rs's unstaged change must be untouched"
        );

        let last_commit_files = no_window_command("git")
            .arg("-C")
            .arg(tmp.path())
            .arg("show")
            .arg("--stat")
            .arg("--format=")
            .arg("HEAD")
            .output()
            .unwrap();
        let files = String::from_utf8_lossy(&last_commit_files.stdout);
        assert!(files.contains("note.md"));
        assert!(!files.contains("src.rs"));
    }

    // Regression: a pending path for something removed before its batched
    // commit fired (e.g. a pasted-image `.assets` dir cleaned up mid-cycle)
    // must not poison the whole batch — the real, still-pending change has
    // to commit anyway.
    #[test]
    fn a_ghost_path_alongside_a_real_change_still_commits_the_real_change() {
        let tmp = tempdir().unwrap();
        git_init(tmp.path());
        commit_file(tmp.path(), "note.md", "# Note\n");
        std::fs::write(tmp.path().join("note.md"), "# Note\nchanged\n").unwrap();
        let ghost = tmp
            .path()
            .join("never-existed.assets")
            .to_string_lossy()
            .into_owned();

        let outcome = checked_auto_commit(
            &tmp.path().to_string_lossy(),
            RepoMode::CodeRepo,
            &["note.md".to_string(), ghost],
            false,
        )
        .unwrap();

        assert_eq!(outcome, CommitOutcome::Committed);
    }

    #[test]
    fn nothing_to_commit_when_paths_are_unchanged() {
        let tmp = tempdir().unwrap();
        git_init(tmp.path());
        commit_file(tmp.path(), "note.md", "# Note\n");

        let outcome = checked_auto_commit(
            &tmp.path().to_string_lossy(),
            RepoMode::CodeRepo,
            &["note.md".to_string()],
            false,
        )
        .unwrap();

        assert_eq!(outcome, CommitOutcome::NothingToCommit);
    }

    #[test]
    fn a_failing_hook_aborts_the_commit() {
        let tmp = tempdir().unwrap();
        git_init(tmp.path());
        commit_file(tmp.path(), "note.md", "# Note\n");
        write_failing_pre_commit_hook(tmp.path());
        std::fs::write(tmp.path().join("note.md"), "# Note\nchanged\n").unwrap();

        let before = no_window_command("git")
            .arg("-C")
            .arg(tmp.path())
            .arg("rev-list")
            .arg("--count")
            .arg("HEAD")
            .output()
            .unwrap();

        let outcome = checked_auto_commit(
            &tmp.path().to_string_lossy(),
            RepoMode::CodeRepo,
            &["note.md".to_string()],
            false,
        )
        .unwrap();

        assert!(matches!(outcome, CommitOutcome::HookFailed { .. }));
        let after = no_window_command("git")
            .arg("-C")
            .arg(tmp.path())
            .arg("rev-list")
            .arg("--count")
            .arg("HEAD")
            .output()
            .unwrap();
        assert_eq!(
            before.stdout, after.stdout,
            "a failed hook must not leave a commit behind"
        );
    }

    #[cfg(unix)]
    #[test]
    fn skip_hooks_bypasses_a_failing_hook() {
        let tmp = tempdir().unwrap();
        git_init(tmp.path());
        commit_file(tmp.path(), "note.md", "# Note\n");
        write_failing_pre_commit_hook(tmp.path());
        std::fs::write(tmp.path().join("note.md"), "# Note\nchanged\n").unwrap();

        let outcome = checked_auto_commit(
            &tmp.path().to_string_lossy(),
            RepoMode::CodeRepo,
            &["note.md".to_string()],
            true,
        )
        .unwrap();

        assert_eq!(outcome, CommitOutcome::Committed);
    }

    #[test]
    fn an_unsafe_repo_state_is_skipped_with_its_reason() {
        let tmp = tempdir().unwrap();
        git_init(tmp.path());
        commit_file(tmp.path(), "note.md", "# Note\n");
        std::fs::create_dir(tmp.path().join(".git").join("rebase-merge")).unwrap();
        std::fs::write(tmp.path().join("note.md"), "# Note\nchanged\n").unwrap();

        let outcome = checked_auto_commit(
            &tmp.path().to_string_lossy(),
            RepoMode::CodeRepo,
            &["note.md".to_string()],
            false,
        )
        .unwrap();

        assert_eq!(
            outcome,
            CommitOutcome::Skipped {
                reason: "a rebase is in progress".to_string()
            }
        );
    }

    // A bare "remote" plus one clone that already has commits pushed to it —
    // the shared fixture every push/pull test in this file builds on.
    fn bare_remote_with_clone() -> (tempfile::TempDir, tempfile::TempDir) {
        let remote = tempdir().unwrap();
        no_window_command("git")
            .arg("init")
            .arg("--bare")
            .arg("-q")
            .arg(remote.path())
            .status()
            .unwrap();

        let clone = tempdir().unwrap();
        git_clone(remote.path(), clone.path());
        commit_file(clone.path(), "note.md", "# Note\n");
        no_window_command("git")
            .arg("-C")
            .arg(clone.path())
            .arg("push")
            .arg("-q")
            .arg("origin")
            .arg("HEAD")
            .status()
            .unwrap();

        (remote, clone)
    }

    #[test]
    fn pushes_a_notes_only_workspace_with_a_remote() {
        let (_remote, clone) = bare_remote_with_clone();
        commit_file(clone.path(), "note2.md", "# Note 2\n");

        let outcome =
            checked_push(&clone.path().to_string_lossy(), RepoMode::NotesOnly, false).unwrap();

        assert_eq!(outcome, PushOutcome::Pushed);
    }

    // The real-world first-push sequence: `checked_init_notes_repo` runs
    // `git init` and `gh repo create --remote origin` (no `--push`), so by
    // the time the first auto-commit fires there's a remote but no upstream
    // tracking branch yet — a bare `git push` fails here with "no upstream
    // branch", which is exactly the silent failure this test guards against.
    #[test]
    fn pushes_and_sets_upstream_on_a_repo_with_no_tracking_branch_yet() {
        let remote = tempdir().unwrap();
        no_window_command("git")
            .arg("init")
            .arg("--bare")
            .arg("-q")
            .arg(remote.path())
            .status()
            .unwrap();

        let workspace = tempdir().unwrap();
        git_init(workspace.path());
        commit_file(workspace.path(), "note.md", "# Note\n");
        no_window_command("git")
            .arg("-C")
            .arg(workspace.path())
            .arg("remote")
            .arg("add")
            .arg("origin")
            .arg(remote.path())
            .status()
            .unwrap();

        let outcome = checked_push(
            &workspace.path().to_string_lossy(),
            RepoMode::NotesOnly,
            false,
        )
        .unwrap();

        assert_eq!(outcome, PushOutcome::Pushed);
    }

    #[test]
    fn no_remote_is_reported_not_errored() {
        let tmp = tempdir().unwrap();
        git_init(tmp.path());
        commit_file(tmp.path(), "note.md", "# Note\n");

        let outcome =
            checked_push(&tmp.path().to_string_lossy(), RepoMode::NotesOnly, false).unwrap();

        assert_eq!(outcome, PushOutcome::NoRemote);
    }

    #[test]
    fn a_non_fast_forward_push_is_rejected_not_forced() {
        let (remote, clone_a) = bare_remote_with_clone();
        let clone_b = tempdir().unwrap();
        git_clone(remote.path(), clone_b.path());

        commit_file(clone_a.path(), "a.md", "from a\n");
        no_window_command("git")
            .arg("-C")
            .arg(clone_a.path())
            .arg("push")
            .arg("-q")
            .arg("origin")
            .arg("HEAD")
            .status()
            .unwrap();

        commit_file(clone_b.path(), "b.md", "from b\n");
        let outcome = checked_push(
            &clone_b.path().to_string_lossy(),
            RepoMode::NotesOnly,
            false,
        )
        .unwrap();

        assert!(matches!(outcome, PushOutcome::Rejected { .. }));
    }

    #[test]
    fn a_code_repo_workspace_is_refused_by_default() {
        let (_remote, clone) = bare_remote_with_clone();

        let result = checked_push(&clone.path().to_string_lossy(), RepoMode::CodeRepo, false);

        assert!(result.is_err());
    }

    // The explicit escape hatch: a user who has looked at this specific
    // shared repo and decided it's fine can opt in per-workspace — but only
    // through this flag, set only via a confirm dialog on the frontend
    // (SettingsPanel), never a default.
    #[test]
    fn a_code_repo_workspace_pushes_when_explicitly_allowed() {
        let (_remote, clone) = bare_remote_with_clone();
        commit_file(clone.path(), "note2.md", "# Note 2\n");

        let outcome =
            checked_push(&clone.path().to_string_lossy(), RepoMode::CodeRepo, true).unwrap();

        assert_eq!(outcome, PushOutcome::Pushed);
    }

    #[test]
    fn fast_forwards_when_purely_behind() {
        let (remote, clone_a) = bare_remote_with_clone();
        let clone_b = tempdir().unwrap();
        git_clone(remote.path(), clone_b.path());

        commit_file(clone_a.path(), "a.md", "from a\n");
        no_window_command("git")
            .arg("-C")
            .arg(clone_a.path())
            .arg("push")
            .arg("-q")
            .arg("origin")
            .arg("HEAD")
            .status()
            .unwrap();

        let outcome = checked_pull(&clone_b.path().to_string_lossy()).unwrap();

        assert_eq!(outcome, PullOutcome::FastForwarded);
        assert!(clone_b.path().join("a.md").exists());
    }

    #[test]
    fn up_to_date_when_nothing_changed() {
        let (_remote, clone) = bare_remote_with_clone();

        let outcome = checked_pull(&clone.path().to_string_lossy()).unwrap();

        assert_eq!(outcome, PullOutcome::UpToDate);
    }

    #[test]
    fn diverged_reports_counts_and_writes_no_conflict_marker() {
        let (remote, clone_a) = bare_remote_with_clone();
        let clone_b = tempdir().unwrap();
        git_clone(remote.path(), clone_b.path());

        commit_file(clone_a.path(), "a.md", "from a\n");
        no_window_command("git")
            .arg("-C")
            .arg(clone_a.path())
            .arg("push")
            .arg("-q")
            .arg("origin")
            .arg("HEAD")
            .status()
            .unwrap();
        commit_file(clone_b.path(), "b.md", "from b, unpushed\n");

        let outcome = checked_pull(&clone_b.path().to_string_lossy()).unwrap();

        assert_eq!(
            outcome,
            PullOutcome::Diverged {
                ahead: 1,
                behind: 1
            }
        );
        // The whole point of ff-only: a diverged pull must never touch any
        // file's content, so there is nothing to search for a marker in.
        assert!(!clone_b.path().join("a.md").exists());
    }

    #[test]
    fn no_remote_is_reported_not_errored_on_pull() {
        let tmp = tempdir().unwrap();
        git_init(tmp.path());
        commit_file(tmp.path(), "note.md", "# Note\n");

        let outcome = checked_pull(&tmp.path().to_string_lossy()).unwrap();

        assert_eq!(outcome, PullOutcome::NoRemote);
    }

    #[test]
    fn init_creates_a_repo_and_the_documented_gitignore() {
        let tmp = tempdir().unwrap();
        git_init(tmp.path());

        let outcome = checked_init_notes_repo(&tmp.path().to_string_lossy(), false).unwrap();

        assert!(matches!(
            outcome,
            RepoInitOutcome::InitializedLocalOnly { .. }
        ));
        assert!(tmp.path().join(".git").is_dir());
        let gitignore = std::fs::read_to_string(tmp.path().join(".gitignore")).unwrap();
        assert_eq!(gitignore, NOTES_GITIGNORE);
    }

    // Written to disk is not the same as versioned: a `.gitignore` that never
    // gets committed doesn't travel to a clone on another machine, so the
    // very thing it's meant to hide is exactly what a second machine would
    // end up tracking instead.
    #[test]
    fn init_commits_the_gitignore_it_creates() {
        let tmp = tempdir().unwrap();
        git_init(tmp.path());

        checked_init_notes_repo(&tmp.path().to_string_lossy(), false).unwrap();

        let status = no_window_command("git")
            .arg("-C")
            .arg(tmp.path())
            .arg("status")
            .arg("--porcelain")
            .arg("--")
            .arg(".gitignore")
            .output()
            .unwrap();
        assert!(
            status.stdout.is_empty(),
            "the generated .gitignore must be committed, not left untracked: {}",
            String::from_utf8_lossy(&status.stdout)
        );
        let tracked = no_window_command("git")
            .arg("-C")
            .arg(tmp.path())
            .arg("ls-files")
            .arg("--")
            .arg(".gitignore")
            .output()
            .unwrap();
        assert_eq!(
            String::from_utf8_lossy(&tracked.stdout).trim(),
            ".gitignore"
        );
    }

    #[test]
    fn init_does_not_overwrite_an_existing_gitignore() {
        let tmp = tempdir().unwrap();
        std::fs::write(tmp.path().join(".gitignore"), "custom\n").unwrap();

        checked_init_notes_repo(&tmp.path().to_string_lossy(), false).unwrap();

        let gitignore = std::fs::read_to_string(tmp.path().join(".gitignore")).unwrap();
        assert_eq!(gitignore, "custom\n");
    }

    // The far more common real-world case P5-1 was built for: the workspace
    // is already someone's existing repo, never created through this app's
    // own init flow, so nothing has ever written its .gitignore.
    #[test]
    fn auto_commit_adds_missing_gitignore_entries_on_a_pre_existing_notes_repo() {
        let tmp = tempdir().unwrap();
        git_init(tmp.path());
        commit_file(tmp.path(), "note.md", "# Note\n");
        std::fs::write(tmp.path().join("note.md"), "# Note\nchanged\n").unwrap();

        let outcome = checked_auto_commit(
            &tmp.path().to_string_lossy(),
            RepoMode::NotesOnly,
            &["note.md".to_string()],
            false,
        )
        .unwrap();

        assert_eq!(outcome, CommitOutcome::Committed);
        let gitignore = std::fs::read_to_string(tmp.path().join(".gitignore")).unwrap();
        assert_eq!(gitignore, NOTES_GITIGNORE);
        let tracked = no_window_command("git")
            .arg("-C")
            .arg(tmp.path())
            .arg("ls-files")
            .arg("--")
            .arg(".gitignore")
            .output()
            .unwrap();
        assert_eq!(
            String::from_utf8_lossy(&tracked.stdout).trim(),
            ".gitignore"
        );
    }

    // A workspace whose .gitignore already exists (the user's own, or an
    // older one from before this app added the temp-file line) must keep its
    // own content — only the specific lines this app depends on get merged
    // in, never a wholesale overwrite.
    #[test]
    fn auto_commit_merges_missing_lines_into_an_existing_gitignore() {
        let tmp = tempdir().unwrap();
        git_init(tmp.path());
        std::fs::write(tmp.path().join(".gitignore"), "*.pdf\n").unwrap();
        commit_file(tmp.path(), "note.md", "# Note\n");
        std::fs::write(tmp.path().join("note.md"), "# Note\nchanged\n").unwrap();

        checked_auto_commit(
            &tmp.path().to_string_lossy(),
            RepoMode::NotesOnly,
            &["note.md".to_string()],
            false,
        )
        .unwrap();

        let gitignore = std::fs::read_to_string(tmp.path().join(".gitignore")).unwrap();
        assert!(gitignore.contains("*.pdf"));
        assert!(gitignore.contains(".workspace.json"));
        assert!(gitignore.contains(".*.tmp"));
    }

    // The conservative case P5-1's own design insists on: a CodeRepo's
    // .gitignore is shared with people who never opted into this app at
    // all, so it's never auto-edited, missing entries or not.
    #[test]
    fn auto_commit_never_touches_gitignore_in_a_code_repo() {
        let tmp = tempdir().unwrap();
        git_init(tmp.path());
        commit_file(tmp.path(), "src.rs", "fn main() {}\n");
        commit_file(tmp.path(), "note.md", "# Note\n");
        std::fs::write(tmp.path().join("note.md"), "# Note\nchanged\n").unwrap();

        checked_auto_commit(
            &tmp.path().to_string_lossy(),
            RepoMode::CodeRepo,
            &["note.md".to_string()],
            false,
        )
        .unwrap();

        assert!(!tmp.path().join(".gitignore").exists());
    }

    #[test]
    fn declining_the_github_remote_returns_the_exact_command_to_run_by_hand() {
        let tmp = tempdir().unwrap();
        git_init(tmp.path());

        let outcome = checked_init_notes_repo(&tmp.path().to_string_lossy(), false).unwrap();

        match outcome {
            RepoInitOutcome::InitializedLocalOnly { remote_add_command } => {
                assert!(remote_add_command.starts_with("git remote add origin"));
            }
            other => panic!("expected InitializedLocalOnly, got {other:?}"),
        }
    }

    #[test]
    fn slugify_passes_through_an_already_valid_name() {
        assert_eq!(slugify("DSA"), "DSA");
        assert_eq!(slugify("Analysis_2"), "Analysis_2");
    }

    #[test]
    fn slugify_collapses_disallowed_characters_to_a_single_dash() {
        assert_eq!(slugify("Analysis 2 (2026)"), "Analysis-2-2026");
        assert_eq!(slugify("Intro to CS: Fall"), "Intro-to-CS-Fall");
    }

    #[test]
    fn slugify_trims_leading_and_trailing_dashes() {
        assert_eq!(slugify("  DSA  "), "DSA");
        assert_eq!(slugify("(DSA)"), "DSA");
    }
}

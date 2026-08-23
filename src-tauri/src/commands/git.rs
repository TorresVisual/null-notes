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
    let output = Command::new("git")
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
    let output = Command::new("git")
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
    let output = Command::new("git")
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

fn has_pending_changes(workspace: &str, paths: &[String]) -> anyhow::Result<bool> {
    if paths.is_empty() {
        return Ok(false);
    }
    let output = Command::new("git")
        .arg("-C")
        .arg(workspace)
        .arg("status")
        .arg("--porcelain")
        .arg("--")
        .args(paths)
        .output()?;
    Ok(!output.stdout.is_empty())
}

/// Commits only `paths`, never anything else staged in the repo. Backs off
/// quietly on an unsafe repo state; aborts (without committing) if a hook
/// rejects the commit, unless `skip_hooks` opts out of running them at all.
pub fn checked_auto_commit(
    workspace: &str,
    paths: &[String],
    skip_hooks: bool,
) -> anyhow::Result<CommitOutcome> {
    if let Some(state) = unsafe_repo_state(workspace)? {
        return Ok(CommitOutcome::Skipped {
            reason: state.reason().to_string(),
        });
    }
    if !has_pending_changes(workspace, paths)? {
        return Ok(CommitOutcome::NothingToCommit);
    }

    let add_status = Command::new("git")
        .arg("-C")
        .arg(workspace)
        .arg("add")
        .arg("--")
        .args(paths)
        .status()?;
    if !add_status.success() {
        anyhow::bail!("git add failed for {workspace}");
    }

    let mut commit_cmd = Command::new("git");
    commit_cmd.arg("-C").arg(workspace).arg("commit");
    if skip_hooks {
        commit_cmd.arg("--no-verify");
    }
    commit_cmd.arg("-m").arg(build_commit_message(paths));
    commit_cmd.arg("--").args(paths);
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
    paths: Vec<String>,
    skip_hooks: bool,
) -> Result<CommitOutcome, String> {
    tokio::task::spawn_blocking(move || checked_auto_commit(&workspace, &paths, skip_hooks))
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
    let output = Command::new("git")
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
    let output = Command::new("git")
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
    let output = Command::new("git")
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

    let fetch_status = Command::new("git")
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
    let merge_status = Command::new("git")
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
    Command::new(probe)
        .arg("gh")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

pub fn checked_init_notes_repo(
    workspace: &str,
    create_github_remote: bool,
) -> anyhow::Result<RepoInitOutcome> {
    let init_status = Command::new("git")
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
        let status = Command::new("gh")
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

    fn git_init(dir: &Path) {
        let status = Command::new("git")
            .arg("-C")
            .arg(dir)
            .arg("init")
            .arg("-q")
            .status()
            .unwrap();
        assert!(status.success());
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
        Command::new("git")
            .arg("-C")
            .arg(dir)
            .arg("add")
            .arg(name)
            .status()
            .unwrap();
        Command::new("git")
            .arg("-C")
            .arg(dir)
            .arg("commit")
            .arg("-m")
            .arg(format!("add {name}"))
            .status()
            .unwrap();
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
        let sha = Command::new("git")
            .arg("-C")
            .arg(tmp.path())
            .arg("rev-parse")
            .arg("HEAD")
            .output()
            .unwrap();
        let sha = String::from_utf8_lossy(&sha.stdout).trim().to_string();
        Command::new("git")
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
        Command::new("git")
            .arg("-C")
            .arg(tmp.path())
            .arg("stash")
            .arg("push")
            .status()
            .unwrap();
        commit_file(tmp.path(), "a.md", "conflicting\n");
        // Expected to fail with a real conflict — that's the point.
        let _ = Command::new("git")
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
        Command::new("git")
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
        let staged_before = Command::new("git")
            .arg("-C")
            .arg(tmp.path())
            .arg("diff")
            .arg("--cached")
            .arg("--")
            .arg("src.rs")
            .output()
            .unwrap();
        let unstaged_before = Command::new("git")
            .arg("-C")
            .arg(tmp.path())
            .arg("diff")
            .arg("--")
            .arg("src.rs")
            .output()
            .unwrap();

        let outcome = checked_auto_commit(
            &tmp.path().to_string_lossy(),
            &["note.md".to_string()],
            false,
        )
        .unwrap();

        assert_eq!(outcome, CommitOutcome::Committed);

        let staged_after = Command::new("git")
            .arg("-C")
            .arg(tmp.path())
            .arg("diff")
            .arg("--cached")
            .arg("--")
            .arg("src.rs")
            .output()
            .unwrap();
        let unstaged_after = Command::new("git")
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

        let last_commit_files = Command::new("git")
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

    #[test]
    fn nothing_to_commit_when_paths_are_unchanged() {
        let tmp = tempdir().unwrap();
        git_init(tmp.path());
        commit_file(tmp.path(), "note.md", "# Note\n");

        let outcome = checked_auto_commit(
            &tmp.path().to_string_lossy(),
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

        let before = Command::new("git")
            .arg("-C")
            .arg(tmp.path())
            .arg("rev-list")
            .arg("--count")
            .arg("HEAD")
            .output()
            .unwrap();

        let outcome = checked_auto_commit(
            &tmp.path().to_string_lossy(),
            &["note.md".to_string()],
            false,
        )
        .unwrap();

        assert!(matches!(outcome, CommitOutcome::HookFailed { .. }));
        let after = Command::new("git")
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
        Command::new("git")
            .arg("init")
            .arg("--bare")
            .arg("-q")
            .arg(remote.path())
            .status()
            .unwrap();

        let clone = tempdir().unwrap();
        Command::new("git")
            .arg("clone")
            .arg("-q")
            .arg(remote.path())
            .arg(clone.path())
            .status()
            .unwrap();
        commit_file(clone.path(), "note.md", "# Note\n");
        Command::new("git")
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
        Command::new("git")
            .arg("init")
            .arg("--bare")
            .arg("-q")
            .arg(remote.path())
            .status()
            .unwrap();

        let workspace = tempdir().unwrap();
        git_init(workspace.path());
        commit_file(workspace.path(), "note.md", "# Note\n");
        Command::new("git")
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
        Command::new("git")
            .arg("clone")
            .arg("-q")
            .arg(remote.path())
            .arg(clone_b.path())
            .status()
            .unwrap();

        commit_file(clone_a.path(), "a.md", "from a\n");
        Command::new("git")
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
        Command::new("git")
            .arg("clone")
            .arg("-q")
            .arg(remote.path())
            .arg(clone_b.path())
            .status()
            .unwrap();

        commit_file(clone_a.path(), "a.md", "from a\n");
        Command::new("git")
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
        Command::new("git")
            .arg("clone")
            .arg("-q")
            .arg(remote.path())
            .arg(clone_b.path())
            .status()
            .unwrap();

        commit_file(clone_a.path(), "a.md", "from a\n");
        Command::new("git")
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

        let outcome = checked_init_notes_repo(&tmp.path().to_string_lossy(), false).unwrap();

        assert!(matches!(
            outcome,
            RepoInitOutcome::InitializedLocalOnly { .. }
        ));
        assert!(tmp.path().join(".git").is_dir());
        let gitignore = std::fs::read_to_string(tmp.path().join(".gitignore")).unwrap();
        assert_eq!(gitignore, NOTES_GITIGNORE);
    }

    #[test]
    fn init_does_not_overwrite_an_existing_gitignore() {
        let tmp = tempdir().unwrap();
        std::fs::write(tmp.path().join(".gitignore"), "custom\n").unwrap();

        checked_init_notes_repo(&tmp.path().to_string_lossy(), false).unwrap();

        let gitignore = std::fs::read_to_string(tmp.path().join(".gitignore")).unwrap();
        assert_eq!(gitignore, "custom\n");
    }

    #[test]
    fn declining_the_github_remote_returns_the_exact_command_to_run_by_hand() {
        let tmp = tempdir().unwrap();

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

//! Detecting which of P5's two Git modes a workspace is in (P5-1).
//!
//! This is detection only — it answers "notes-only repo," "code repo," or
//! "not a repo at all," and nothing here runs a mutating Git command or
//! writes anything. Shells out to `git` rather than linking `git2`/`gix`:
//! that inherits the user's credential helpers, SSH agent, commit signing
//! and `.gitconfig` for free, which is exactly what later P5 tasks need and
//! would otherwise have to reimplement.
//!
//! Design: `docs/ROADMAP.md` §Phase 5.

use std::path::{Path, PathBuf};
use std::process::Command;
use crate::models::RepoMode;

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

    Ok(Some(if root_canon == workspace_canon {
        RepoMode::NotesOnly
    } else {
        RepoMode::CodeRepo
    }))
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
        .arg("-C").arg(workspace)
        .arg("rev-parse").arg("--absolute-git-dir")
        .output()?;
    if !output.status.success() {
        anyhow::bail!("not a git repository: {workspace}");
    }
    Ok(PathBuf::from(String::from_utf8_lossy(&output.stdout).trim().to_string()))
}

fn has_unresolved_conflicts(workspace: &str) -> anyhow::Result<bool> {
    let output = Command::new("git")
        .arg("-C").arg(workspace)
        .arg("ls-files").arg("-u")
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

    // A workspace two levels under the repo root is still a code repo, not
    // some third mode — depth past the root doesn't change which of the two
    // it is.
    #[test]
    fn depth_below_the_repo_root_stays_code_repo() {
        let tmp = tempdir().unwrap();
        git_init(tmp.path());
        let nested = tmp.path().join("courses").join("cs101");
        std::fs::create_dir_all(&nested).unwrap();

        let mode = detect_repo_mode(&nested.to_string_lossy()).unwrap();

        assert_eq!(mode, Some(RepoMode::CodeRepo));
    }

    fn commit_file(dir: &Path, name: &str, content: &str) {
        std::fs::write(dir.join(name), content).unwrap();
        Command::new("git").arg("-C").arg(dir).arg("add").arg(name).status().unwrap();
        Command::new("git")
            .arg("-C").arg(dir).arg("commit").arg("-m").arg(format!("add {name}"))
            .status()
            .unwrap();
    }

    #[test]
    fn a_clean_repo_is_safe() {
        let tmp = tempdir().unwrap();
        git_init(tmp.path());
        commit_file(tmp.path(), "a.md", "hello");

        assert_eq!(unsafe_repo_state(&tmp.path().to_string_lossy()).unwrap(), None);
    }

    #[test]
    fn a_detached_head_is_unsafe() {
        let tmp = tempdir().unwrap();
        git_init(tmp.path());
        commit_file(tmp.path(), "a.md", "hello");
        let sha = Command::new("git")
            .arg("-C").arg(tmp.path()).arg("rev-parse").arg("HEAD")
            .output().unwrap();
        let sha = String::from_utf8_lossy(&sha.stdout).trim().to_string();
        Command::new("git").arg("-C").arg(tmp.path()).arg("checkout").arg(&sha).status().unwrap();

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
        Command::new("git").arg("-C").arg(tmp.path()).arg("stash").arg("push").status().unwrap();
        commit_file(tmp.path(), "a.md", "conflicting\n");
        // Expected to fail with a real conflict — that's the point.
        let _ = Command::new("git").arg("-C").arg(tmp.path()).arg("stash").arg("pop").status();

        let git_dir = absolute_git_dir(&tmp.path().to_string_lossy()).unwrap();
        assert!(!git_dir.join("MERGE_HEAD").exists(), "a stash pop must not set MERGE_HEAD");

        assert_eq!(
            unsafe_repo_state(&tmp.path().to_string_lossy()).unwrap(),
            Some(UnsafeRepoState::UnresolvedConflicts)
        );
    }
}

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

use std::path::Path;
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
}

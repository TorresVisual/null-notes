//! iOS's mobile-target replacement for `git.rs`: the same 11 operations,
//! reimplemented against `gix` instead of shelling out to `git` — the App
//! Sandbox forbids spawning a child process at all, so there is no `git`
//! binary to shell out to regardless.
//!
//! Command names and return types match `git.rs` exactly (reusing its
//! `pub` types directly) so the frontend never branches on platform for
//! these calls — only `lib.rs`'s module alias picks which implementation
//! is registered. `init_notes_repo` and `list_github_repos` are the two
//! exceptions: explicitly out of mobile v1 scope, stubbed below.

use super::git::is_notes_monorepo;
use crate::models::RepoMode;
use std::path::Path;

/// `gix::discover` walks upward from `workspace` the same way `git rev-parse
/// --show-toplevel` does, but never shells out — the whole reason this
/// module exists. `Err` from `discover` covers "not a git repository at
/// all," matching `detect_repo_mode`'s `Ok(None)` contract, so it's mapped
/// rather than propagated.
pub fn detect_repo_mode(workspace: &str) -> anyhow::Result<Option<RepoMode>> {
    let repo = match gix::discover(workspace) {
        Ok(repo) => repo,
        Err(_) => return Ok(None),
    };

    let root = repo
        .workdir()
        .ok_or_else(|| anyhow::anyhow!("bare repositories are not supported: {workspace}"))?
        .to_path_buf();
    let root_canon = std::fs::canonicalize(&root)?;
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

#[cfg(target_os = "ios")]
#[tauri::command]
pub async fn detect_repo(workspace: String) -> Result<Option<RepoMode>, String> {
    tokio::task::spawn_blocking(move || detect_repo_mode(&workspace))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// Same evidence rule as desktop's `detect_prior_git_automation`: a remote
/// to sync through, plus at least one commit this app's own auto-commit
/// made.
pub fn detect_prior_git_automation(workspace: &str) -> anyhow::Result<bool> {
    let repo = gix::discover(workspace)?;
    let has_remote = repo.remote_names().iter().next().is_some();
    Ok(has_remote && has_notes_commit_in_log(&repo)?)
}

#[cfg(target_os = "ios")]
#[tauri::command]
pub async fn detect_prior_automation(workspace: String) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || detect_prior_git_automation(&workspace))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// Walks HEAD's ancestry looking for a commit message starting with
/// `"notes: update "` — the same prefix `git.rs`'s `build_commit_message`
/// uses. Capped at 500 commits — this only needs "does one exist somewhere
/// reasonably recent," not a full history scan.
fn has_notes_commit_in_log(repo: &gix::Repository) -> anyhow::Result<bool> {
    let Ok(head_id) = repo.head_id() else {
        return Ok(false);
    };
    for info in repo.rev_walk([head_id.detach()]).all()?.take(500) {
        let info = info?;
        let commit = info.object()?;
        if commit.message()?.title.starts_with(b"notes: update ") {
            return Ok(true);
        }
    }
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    // gix reads the same on-disk repo format `git` writes, so these fixture
    // helpers still shell to the real `git` CLI to build test repos — only
    // the *code under test* avoids it.
    fn git_init(dir: &Path) {
        assert!(Command::new("git")
            .arg("-C")
            .arg(dir)
            .arg("init")
            .arg("-q")
            .status()
            .unwrap()
            .success());
        for (key, value) in [("user.name", "Test"), ("user.email", "test@example.com")] {
            assert!(Command::new("git")
                .arg("-C")
                .arg(dir)
                .arg("config")
                .arg(key)
                .arg(value)
                .status()
                .unwrap()
                .success());
        }
    }

    fn commit_file(dir: &Path, name: &str, content: &str, message: &str) {
        std::fs::write(dir.join(name), content).unwrap();
        assert!(Command::new("git")
            .arg("-C")
            .arg(dir)
            .arg("add")
            .arg(name)
            .status()
            .unwrap()
            .success());
        assert!(Command::new("git")
            .arg("-C")
            .arg(dir)
            .arg("commit")
            .arg("-m")
            .arg(message)
            .status()
            .unwrap()
            .success());
    }

    #[test]
    fn a_plain_folder_is_not_a_repo() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(
            detect_repo_mode(&tmp.path().to_string_lossy()).unwrap(),
            None
        );
    }

    #[test]
    fn the_workspace_at_the_repo_root_is_notes_only() {
        let tmp = tempfile::tempdir().unwrap();
        git_init(tmp.path());
        commit_file(tmp.path(), "a.md", "# A\n", "notes: update A");
        assert_eq!(
            detect_repo_mode(&tmp.path().to_string_lossy()).unwrap(),
            Some(RepoMode::NotesOnly)
        );
    }

    #[test]
    fn a_workspace_inside_a_larger_repo_is_a_code_repo() {
        let tmp = tempfile::tempdir().unwrap();
        git_init(tmp.path());
        commit_file(tmp.path(), "README.md", "# R\n", "init");
        let notes_dir = tmp.path().join("notes");
        std::fs::create_dir(&notes_dir).unwrap();
        assert_eq!(
            detect_repo_mode(&notes_dir.to_string_lossy()).unwrap(),
            Some(RepoMode::CodeRepo)
        );
    }
}

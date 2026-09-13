//! iOS's mobile-target replacement for `git.rs`: the same 11 operations,
//! reimplemented against `gix` instead of shelling out to `git` — the App
//! Sandbox forbids spawning a child process at all, so there is no `git`
//! binary to shell out to regardless.
//!
//! Command names and return types match `git.rs` exactly (reusing its
//! `pub` types directly) so the frontend never branches on platform for
//! these calls. `init_notes_repo` and `list_github_repos` are the two
//! exceptions: explicitly out of mobile v1 scope, stubbed once this module's
//! surface is complete.
//!
//! No `#[tauri::command]` wrappers exist here until every one of the 11
//! operations has a real implementation: `#[tauri::command]` expands to a
//! crate-global helper macro keyed only on the Rust function's name, so a
//! `detect_repo` wrapper here would collide with `git.rs`'s the moment both
//! compile for the same target — regardless of which one `generate_handler!`
//! actually registers. Wrappers (and the matching `#[cfg(not(target_os =
//! "ios"))]` on `git.rs`'s own, plus `lib.rs`'s dispatch alias) all land
//! together as one atomic change once the surface is complete.

use super::git::{
    build_commit_message, is_notes_monorepo, resolve, CommitOutcome, UnsafeRepoState,
};
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

/// Same evidence rule as desktop's `detect_prior_git_automation`: a remote
/// to sync through, plus at least one commit this app's own auto-commit
/// made.
pub fn detect_prior_git_automation(workspace: &str) -> anyhow::Result<bool> {
    let repo = gix::discover(workspace)?;
    let has_remote = repo.remote_names().iter().next().is_some();
    Ok(has_remote && has_notes_commit_in_log(&repo)?)
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

/// Same precedence as desktop's `unsafe_repo_state`: merge/cherry-pick/
/// rebase markers live as files directly under `.git/` regardless of
/// implementation (gix and the `git` CLI both write the same on-disk
/// format), so they're read the same way. Detached-HEAD and index-conflict
/// checks go through gix's own APIs instead of `HEAD`-file text parsing and
/// `git ls-files -u`.
pub fn unsafe_repo_state(workspace: &str) -> anyhow::Result<Option<UnsafeRepoState>> {
    let repo = gix::discover(workspace)?;
    let git_dir = repo.git_dir();

    if git_dir.join("MERGE_HEAD").exists() {
        return Ok(Some(UnsafeRepoState::MergeInProgress));
    }
    if git_dir.join("CHERRY_PICK_HEAD").exists() {
        return Ok(Some(UnsafeRepoState::CherryPickInProgress));
    }
    if git_dir.join("rebase-merge").exists() || git_dir.join("rebase-apply").exists() {
        return Ok(Some(UnsafeRepoState::RebaseInProgress));
    }
    if repo.head()?.is_detached() {
        return Ok(Some(UnsafeRepoState::DetachedHead));
    }

    let index = repo.index_or_empty()?;
    let has_conflict = index
        .entries()
        .iter()
        .any(|entry| entry.stage() != gix::index::entry::Stage::Unconflicted);
    if has_conflict {
        return Ok(Some(UnsafeRepoState::UnresolvedConflicts));
    }

    Ok(None)
}

/// Builds a new tree from HEAD's tree plus `paths`' current on-disk content,
/// writes a commit on top of HEAD with that tree, and moves the current
/// branch ref to point at it (via `Repository::commit`, which updates the
/// ref and reflog atomically). Unlike desktop's `git add` + `git commit`,
/// there's no index staging step to reason about — the tree is built
/// directly from the paths this call was given, so a path left out (like an
/// unstaged edit to some other tracked file) never ends up in the commit.
/// Hook execution is a shelled-out subprocess, which iOS forbids outright —
/// `skip_hooks` is accepted for signature parity with desktop but has no
/// effect here, and `CommitOutcome::HookFailed` is structurally unreachable
/// from this function.
pub fn checked_auto_commit(
    workspace: &str,
    _mode: RepoMode,
    paths: &[String],
    _skip_hooks: bool,
) -> anyhow::Result<CommitOutcome> {
    if let Some(state) = unsafe_repo_state(workspace)? {
        return Ok(CommitOutcome::Skipped {
            reason: state.reason().to_string(),
        });
    }

    let repo = gix::discover(workspace)?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| anyhow::anyhow!("bare repositories are not supported: {workspace}"))?
        .to_path_buf();
    let head_tree_id = repo.head_tree_id()?.detach();

    let mut editor = repo.edit_tree(head_tree_id)?;
    for path in paths {
        let abs = resolve(workspace, path);
        let Ok(repo_relative) = abs.strip_prefix(&workdir) else {
            continue; // outside the repo entirely — skip, don't fail the whole batch
        };
        let repo_relative = repo_relative.to_string_lossy().replace('\\', "/");

        if abs.exists() {
            let content = std::fs::read(&abs)?;
            let blob_id = repo.write_blob(content)?.detach();
            editor.upsert(&repo_relative, gix::object::tree::EntryKind::Blob, blob_id)?;
        } else {
            // A path that no longer exists on disk is a removal — mirrors
            // desktop's `addable_paths`' "deleted but previously tracked"
            // branch. No error if it was never tracked to begin with.
            editor.remove(&repo_relative)?;
        }
    }

    let new_tree_id = editor.write()?.detach();
    if new_tree_id == head_tree_id {
        return Ok(CommitOutcome::NothingToCommit);
    }

    let message = build_commit_message(paths);
    let head_commit_id = repo.head_id()?.detach();
    repo.commit("HEAD", &message, new_tree_id, [head_commit_id])?;

    Ok(CommitOutcome::Committed)
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

    #[test]
    fn a_clean_repo_is_safe() {
        let tmp = tempfile::tempdir().unwrap();
        git_init(tmp.path());
        commit_file(tmp.path(), "a.md", "hello", "notes: update a");
        assert_eq!(
            unsafe_repo_state(&tmp.path().to_string_lossy()).unwrap(),
            None
        );
    }

    #[test]
    fn a_detached_head_is_unsafe() {
        let tmp = tempfile::tempdir().unwrap();
        git_init(tmp.path());
        commit_file(tmp.path(), "a.md", "hello", "notes: update a");
        let sha_output = Command::new("git")
            .arg("-C")
            .arg(tmp.path())
            .arg("rev-parse")
            .arg("HEAD")
            .output()
            .unwrap();
        let sha = String::from_utf8_lossy(&sha_output.stdout)
            .trim()
            .to_string();
        assert!(Command::new("git")
            .arg("-C")
            .arg(tmp.path())
            .arg("checkout")
            .arg(&sha)
            .status()
            .unwrap()
            .success());

        assert_eq!(
            unsafe_repo_state(&tmp.path().to_string_lossy()).unwrap(),
            Some(UnsafeRepoState::DetachedHead)
        );
    }

    #[test]
    fn a_merge_in_progress_is_unsafe() {
        let tmp = tempfile::tempdir().unwrap();
        git_init(tmp.path());
        commit_file(tmp.path(), "a.md", "hello", "notes: update a");
        std::fs::write(tmp.path().join(".git").join("MERGE_HEAD"), "abc123\n").unwrap();
        assert_eq!(
            unsafe_repo_state(&tmp.path().to_string_lossy()).unwrap(),
            Some(UnsafeRepoState::MergeInProgress)
        );
    }

    #[test]
    fn a_rebase_in_progress_is_unsafe() {
        let tmp = tempfile::tempdir().unwrap();
        git_init(tmp.path());
        commit_file(tmp.path(), "a.md", "hello", "notes: update a");
        std::fs::create_dir(tmp.path().join(".git").join("rebase-merge")).unwrap();
        assert_eq!(
            unsafe_repo_state(&tmp.path().to_string_lossy()).unwrap(),
            Some(UnsafeRepoState::RebaseInProgress)
        );
    }

    #[test]
    fn unresolved_index_conflicts_are_unsafe() {
        let tmp = tempfile::tempdir().unwrap();
        git_init(tmp.path());
        commit_file(tmp.path(), "a.md", "base\n", "notes: update a");
        std::fs::write(tmp.path().join("a.md"), "stashed\n").unwrap();
        assert!(Command::new("git")
            .arg("-C")
            .arg(tmp.path())
            .arg("stash")
            .arg("push")
            .status()
            .unwrap()
            .success());
        commit_file(tmp.path(), "a.md", "conflicting\n", "notes: update a");
        // Expected to fail with a real conflict, leaving unmerged index entries.
        let _ = Command::new("git")
            .arg("-C")
            .arg(tmp.path())
            .arg("stash")
            .arg("pop")
            .status();

        assert_eq!(
            unsafe_repo_state(&tmp.path().to_string_lossy()).unwrap(),
            Some(UnsafeRepoState::UnresolvedConflicts)
        );
    }

    #[test]
    fn commits_only_the_given_note_paths() {
        let tmp = tempfile::tempdir().unwrap();
        git_init(tmp.path());
        commit_file(tmp.path(), "src.rs", "fn main() {}\n", "add src");
        commit_file(tmp.path(), "note.md", "# Note\n", "notes: update note");
        std::fs::write(tmp.path().join("note.md"), "# Note\nmore\n").unwrap();
        std::fs::write(tmp.path().join("src.rs"), "fn main() { changed() }\n").unwrap();

        let outcome = checked_auto_commit(
            &tmp.path().to_string_lossy(),
            RepoMode::CodeRepo,
            &["note.md".to_string()],
            false,
        )
        .unwrap();

        assert_eq!(outcome, CommitOutcome::Committed);
        let show = Command::new("git")
            .arg("-C")
            .arg(tmp.path())
            .arg("show")
            .arg("--stat")
            .arg("--format=")
            .arg("HEAD")
            .output()
            .unwrap();
        let files = String::from_utf8_lossy(&show.stdout);
        assert!(files.contains("note.md"));
        assert!(
            !files.contains("src.rs"),
            "unstaged src.rs edit must survive untouched"
        );
        let src_contents = std::fs::read_to_string(tmp.path().join("src.rs")).unwrap();
        assert_eq!(src_contents, "fn main() { changed() }\n");
    }

    #[test]
    fn nothing_to_commit_when_paths_are_unchanged() {
        let tmp = tempfile::tempdir().unwrap();
        git_init(tmp.path());
        commit_file(tmp.path(), "note.md", "# Note\n", "notes: update note");

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
    fn backs_off_on_an_unsafe_repo_state() {
        let tmp = tempfile::tempdir().unwrap();
        git_init(tmp.path());
        commit_file(tmp.path(), "note.md", "# Note\n", "notes: update note");
        std::fs::write(tmp.path().join(".git").join("MERGE_HEAD"), "abc123\n").unwrap();
        std::fs::write(tmp.path().join("note.md"), "# Note\nchanged\n").unwrap();

        let outcome = checked_auto_commit(
            &tmp.path().to_string_lossy(),
            RepoMode::CodeRepo,
            &["note.md".to_string()],
            false,
        )
        .unwrap();

        assert!(matches!(outcome, CommitOutcome::Skipped { .. }));
    }
}

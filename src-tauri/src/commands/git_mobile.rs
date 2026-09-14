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
    build_commit_message, derive_clone_dir_name, is_notes_monorepo, resolve, CommitOutcome,
    GithubRepo, NoteHistoryEntry, PullOutcome, PushOutcome, RebaseOutcome, RepoInitOutcome,
    UnsafeRepoState, NOTE_HISTORY_LIMIT,
};
use crate::models::RepoMode;
use std::path::{Path, PathBuf};

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

/// A credential callback that always answers a `Get` with `token` as an
/// HTTPS personal-access-token password (the username is ignored by GitHub
/// for PAT auth, so any non-empty placeholder works) — `Store`/`Erase` are
/// no-ops since there's no on-disk credential cache to update here. `gix`
/// has no equivalent of desktop's inherited credential helpers/SSH agent
/// (see `git.rs`'s module doc), so mobile needs this explicit mechanism
/// instead; wiring a real token in from iOS Keychain is a separate, later
/// plan (see docs/plans/git-mobile-gix.md's Global Constraints).
#[allow(clippy::result_large_err)] // `protocol::Result`'s Err variant is gix's own type, not ours to shrink
fn basic_auth_credentials(
    token: String,
) -> impl FnMut(gix::credentials::helper::Action) -> gix::credentials::protocol::Result {
    move |action| match action {
        gix::credentials::helper::Action::Get(ctx) => {
            Ok(Some(gix::credentials::protocol::Outcome {
                identity: gix::sec::identity::Account {
                    username: "x-access-token".to_string(),
                    password: token.clone(),
                    oauth_refresh_token: None,
                },
                next: ctx.into(),
            }))
        }
        gix::credentials::helper::Action::Store(_) | gix::credentials::helper::Action::Erase(_) => {
            Ok(None)
        }
    }
}

/// Checks out `tree_id`'s content into `repo`'s worktree and updates the
/// persisted index to match — the gix-native equivalent of `git checkout
/// <tree>` or the file-writing half of `git merge --ff-only`. Used by both
/// `checked_pull`'s fast-forward path and `checked_clone_repo`.
fn checkout_tree_to_worktree(repo: &gix::Repository, tree_id: gix::ObjectId) -> anyhow::Result<()> {
    let workdir = repo
        .workdir()
        .ok_or_else(|| anyhow::anyhow!("bare repositories are not supported"))?;
    let index_state =
        gix::worktree::index::State::from_tree(&tree_id, &repo.objects, Default::default())?;
    let mut index = gix::index::File::from_state(index_state, repo.index_path());
    let opts = repo.checkout_options(gix::worktree::stack::state::attributes::Source::IdMapping)?;
    let should_interrupt = std::sync::atomic::AtomicBool::new(false);
    gix::worktree::state::checkout(
        &mut index,
        workdir,
        repo.objects.clone().into_arc()?,
        &gix::progress::Discard,
        &gix::progress::Discard,
        &should_interrupt,
        opts,
    )?;
    index.write(Default::default())?;
    Ok(())
}

/// `HEAD..other` in git's range syntax: commits reachable from `other` but
/// not from `head`.
fn count_commits_between(
    repo: &gix::Repository,
    exclude: gix::ObjectId,
    include: gix::ObjectId,
) -> anyhow::Result<u32> {
    Ok(repo
        .rev_walk([include])
        .with_hidden([exclude])
        .all()?
        .count() as u32)
}

/// Repo-root-relative changed paths between two commits' trees, matching
/// desktop's `changed_note_paths`.
fn changed_paths_between(
    repo: &gix::Repository,
    from: gix::ObjectId,
    to: gix::ObjectId,
) -> anyhow::Result<Vec<String>> {
    let from_tree = repo.find_commit(from)?.tree()?;
    let to_tree = repo.find_commit(to)?.tree()?;
    let mut paths = Vec::new();
    from_tree
        .changes()?
        .for_each_to_obtain_tree(&to_tree, |change| {
            paths.push(change.location().to_string());
            Ok::<_, std::convert::Infallible>(std::ops::ControlFlow::Continue(()))
        })?;
    Ok(paths)
}

/// `token` authenticates over HTTPS when the remote actually requires it —
/// this module's tests use local filesystem-path remotes, which need no
/// credential, so an empty token is fine there.
pub fn checked_pull(workspace: &str, token: &str) -> anyhow::Result<PullOutcome> {
    let repo = gix::discover(workspace)?;
    let remote = match repo.find_default_remote(gix::remote::Direction::Fetch) {
        None => return Ok(PullOutcome::NoRemote),
        Some(remote) => remote?,
    };

    let connection = remote
        .connect(gix::remote::Direction::Fetch)?
        .with_credentials(basic_auth_credentials(token.to_string()));
    connection
        .prepare_fetch(gix::progress::Discard, Default::default())?
        .receive(gix::progress::Discard, &Default::default())?;

    let head_name = repo
        .head_name()?
        .ok_or_else(|| anyhow::anyhow!("HEAD is not a symbolic ref"))?;
    let head_id = repo.head_id()?.detach();
    let upstream_id = match repo
        .find_reference(&format!("refs/remotes/origin/{}", head_name.shorten()))
        .ok()
        .and_then(|r| r.into_fully_peeled_id().ok())
    {
        None => {
            let ahead = repo.rev_walk([head_id]).all()?.count() as u32;
            return Ok(PullOutcome::NoUpstream { ahead });
        }
        Some(id) => id.detach(),
    };

    let ahead = count_commits_between(&repo, upstream_id, head_id)?;
    let behind = count_commits_between(&repo, head_id, upstream_id)?;

    if behind == 0 {
        return Ok(if ahead > 0 {
            PullOutcome::Ahead { ahead }
        } else {
            PullOutcome::UpToDate
        });
    }
    if ahead > 0 {
        let base = repo.merge_base(head_id, upstream_id)?.detach();
        let local_paths = changed_paths_between(&repo, base, head_id)?;
        let remote_paths = changed_paths_between(&repo, base, upstream_id)?;
        return Ok(PullOutcome::Diverged {
            ahead,
            behind,
            local_paths,
            remote_paths,
        });
    }

    // Pure fast-forward: no local commits since the merge-base, so moving
    // the branch ref (and checking out the new tree) is safe unconditionally
    // — the same case desktop's `merge --ff-only` always succeeds for.
    repo.reference(
        head_name,
        upstream_id,
        gix::refs::transaction::PreviousValue::MustExistAndMatch(head_id.into()),
        "pull --ff-only",
    )?;
    let upstream_tree = repo.find_commit(upstream_id)?.tree_id()?.detach();
    checkout_tree_to_worktree(&repo, upstream_tree)?;
    Ok(PullOutcome::FastForwarded)
}

/// **Deferred, not implemented.** `gix` has no reviewed send-pack (push)
/// support at any released version, including 0.87.1 — confirmed against
/// GitoxideLabs/gitoxide#306 (gitoxide's own push tracking issue, still open
/// as an unresolved feature discussion) and the absence of a `push.rs` in
/// gitoxide's own `gix/examples/`. The one attempt at a from-scratch
/// implementation found (gitoxide PR #2538) is an unreviewed, closed
/// experimental branch, not something to depend on for a path that pushes
/// real commits to a user's real GitHub remote. The two checks that *are*
/// implemented here (the `CodeRepo` guard and `NoRemote` detection) match
/// desktop's `checked_push` exactly; actually sending the pack is tracked as
/// a follow-up plan once gix gains reviewed push support or the wire
/// protocol is implemented directly (see docs/plans/git-mobile-gix.md).
pub fn checked_push(
    workspace: &str,
    mode: RepoMode,
    allow_code_repo_push: bool,
    _token: &str,
) -> anyhow::Result<PushOutcome> {
    if mode == RepoMode::CodeRepo && !allow_code_repo_push {
        anyhow::bail!(
            "refusing to push a CodeRepo workspace — set allow_code_repo_push to override"
        );
    }

    let repo = gix::discover(workspace)?;
    match repo.find_default_remote(gix::remote::Direction::Push) {
        None => return Ok(PushOutcome::NoRemote),
        Some(Err(e)) => return Err(e.into()),
        Some(Ok(_remote)) => {}
    }

    anyhow::bail!(
        "push is not yet implemented on mobile — gix has no reviewed send-pack support (see GitoxideLabs/gitoxide#306)"
    )
}

/// Replays the local commits a `Diverged` outcome found on top of the
/// remote — but as a single tree-merge commit rather than a true multi-commit
/// rebase, since `gix` has no rebase primitive to build one from. The
/// frontend only ever calls this after `checked_pull`'s `Diverged` outcome
/// has already confirmed the two sides touch disjoint files, so the
/// resulting tree is identical to what a real rebase would produce (no hunk
/// overlaps either way) — this only differs in history shape (one merge
/// commit vs. a linear replay), and no UI here renders per-commit rebase
/// history to notice the difference.
pub fn checked_rebase_onto_remote(workspace: &str) -> anyhow::Result<RebaseOutcome> {
    if let Some(state) = unsafe_repo_state(workspace)? {
        anyhow::bail!("refusing to rebase: {}", state.reason());
    }

    let repo = gix::discover(workspace)?;
    let head_name = repo
        .head_name()?
        .ok_or_else(|| anyhow::anyhow!("HEAD is not a symbolic ref"))?;
    let head_id = repo.head_id()?.detach();
    let upstream_id = repo
        .find_reference(&format!("refs/remotes/origin/{}", head_name.shorten()))?
        .into_fully_peeled_id()?
        .detach();

    let base_id = repo.merge_base(head_id, upstream_id)?.detach();
    let base_tree = repo.find_commit(base_id)?.tree_id()?.detach();
    let head_tree = repo.find_commit(head_id)?.tree_id()?.detach();
    let upstream_tree = repo.find_commit(upstream_id)?.tree_id()?.detach();

    let mut outcome = repo.merge_trees(
        base_tree,
        head_tree,
        upstream_tree,
        Default::default(),
        repo.tree_merge_options()?,
    )?;
    if !outcome.conflicts.is_empty() {
        return Ok(RebaseOutcome::Aborted {
            output: format!(
                "{} unresolved conflict(s) rebasing onto remote",
                outcome.conflicts.len()
            ),
        });
    }

    let merged_tree_id = outcome.tree.write()?.detach();
    let message = format!(
        "rebase (merged tree): local changes onto {}",
        head_name.shorten()
    );
    // `Repository::commit`'s first parent must match `reference`'s current
    // value, so `head_id` (what "refs/heads/<branch>" points to right now)
    // comes first — this is a real two-parent merge commit, not a rebase's
    // linear replay (see this function's doc comment on why that's fine).
    repo.commit(head_name, &message, merged_tree_id, [head_id, upstream_id])?;
    checkout_tree_to_worktree(&repo, merged_tree_id)?;

    Ok(RebaseOutcome::Rebased)
}

/// `--follow`'s rename-tracking has no single documented gix equivalent —
/// this walks commits touching the note's *current* path only, a real (if
/// narrower) difference from desktop's rename-following history worth
/// flagging rather than silently shipping degraded behavior for renamed
/// notes on mobile specifically.
pub fn list_note_history_at(
    workspace: &str,
    note_path: &str,
) -> anyhow::Result<Vec<NoteHistoryEntry>> {
    let repo = gix::discover(workspace)?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| anyhow::anyhow!("bare repositories are not supported: {workspace}"))?;
    let abs = resolve(workspace, note_path);
    let repo_relative = abs
        .strip_prefix(workdir)
        .unwrap_or(Path::new(note_path))
        .to_string_lossy()
        .replace('\\', "/");

    let head_id = repo.head_id()?.detach();
    let mut entries = Vec::new();
    for info in repo.rev_walk([head_id]).all()?.take(NOTE_HISTORY_LIMIT * 4) {
        let info = info?;
        let commit = info.object()?;
        let tree = commit.tree()?;
        let Some(entry) = tree.lookup_entry_by_path(&repo_relative)? else {
            continue;
        };
        // Only entries where this path's blob actually changed vs. its
        // first parent count as "touching" it, matching git log's default
        // (non---follow) path-filter semantics.
        let mut parent_ids = commit.parent_ids();
        let changed = match parent_ids.next() {
            None => true,
            Some(parent_id) => {
                let parent_tree = repo.find_commit(parent_id.detach())?.tree()?;
                let before = parent_tree
                    .lookup_entry_by_path(&repo_relative)?
                    .map(|e| e.object_id());
                before != Some(entry.object_id())
            }
        };
        if !changed {
            continue;
        }
        entries.push(NoteHistoryEntry {
            sha: commit.id().to_string(),
            timestamp_ms: commit.time()?.seconds * 1000,
            // `title` keeps a trailing newline when the message is a single
            // line with no body (no blank-line separator to trim against) —
            // trimmed here to match desktop's `%s` format, which never has one.
            message: commit.message()?.title.to_string().trim_end().to_string(),
            path: repo_relative.clone(),
        });
        if entries.len() >= NOTE_HISTORY_LIMIT {
            break;
        }
    }
    Ok(entries)
}

/// `sha` is validated the same way desktop's `read_note_at_commit_at` does —
/// it's about to be resolved as a revision, and a value like `--output=...`
/// would otherwise be misread as a flag rather than a commit-ish.
pub fn read_note_at_commit_at(
    workspace: &str,
    relative_path: &str,
    sha: &str,
) -> anyhow::Result<String> {
    if sha.len() < 7 || sha.len() > 40 || !sha.bytes().all(|b| b.is_ascii_hexdigit()) {
        anyhow::bail!("invalid commit sha: {sha}");
    }
    let repo = gix::discover(workspace)?;
    let commit_id = repo.rev_parse_single(sha)?;
    let tree = repo.find_commit(commit_id.detach())?.tree()?;
    let entry = tree
        .lookup_entry_by_path(relative_path)?
        .ok_or_else(|| anyhow::anyhow!("{relative_path} not found at {sha}"))?;
    let blob = repo.find_blob(entry.object_id())?;
    Ok(String::from_utf8_lossy(&blob.data).into_owned())
}

/// Clone via fetch into a freshly `gix::init`-ed repo — the documented gix
/// pattern for cloning (init empty + fetch + checkout), since `gix::init`
/// doesn't clone on its own and there's no porcelain `gix::clone` distinct
/// from that pattern.
pub fn checked_clone_repo(url: &str, parent_dir: &str, token: &str) -> anyhow::Result<PathBuf> {
    if url.starts_with('-') {
        anyhow::bail!("refusing suspicious repository URL: {url}");
    }
    let dir_name = derive_clone_dir_name(url);
    if dir_name.is_empty() || dir_name.starts_with('-') {
        anyhow::bail!("could not determine a folder name from {url}");
    }
    let dest = Path::new(parent_dir).join(dir_name);
    std::fs::create_dir(&dest)?;

    let repo = gix::init(&dest)?;
    let remote = repo
        .remote_at(url)?
        .with_fetch_tags(gix::remote::fetch::Tags::All)
        .with_refspecs(
            Some("+refs/heads/*:refs/remotes/origin/*"),
            gix::remote::Direction::Fetch,
        )?;
    let connection = remote
        .connect(gix::remote::Direction::Fetch)?
        .with_credentials(basic_auth_credentials(token.to_string()));
    let outcome = connection
        .prepare_fetch(gix::progress::Discard, Default::default())?
        .receive(gix::progress::Discard, &Default::default())?;

    // A fresh `gix::init` leaves HEAD unborn (pointing at the configured
    // default branch name, which doesn't exist as a ref yet) — cloning has
    // to create that branch itself once the fetch lands objects, mirroring
    // what `git clone` does. The first mapped branch's resolved commit
    // stands in for "the remote's default branch": good enough for the
    // common single-default-branch case this app's workspaces are in.
    let gix::head::Kind::Unborn(head_name) = repo.head()?.kind else {
        anyhow::bail!("expected an unborn HEAD immediately after gix::init");
    };
    let mapping = outcome
        .ref_map
        .mappings
        .first()
        .ok_or_else(|| anyhow::anyhow!("remote {url} has no branches to clone"))?;
    let commit_id = mapping
        .remote
        .peeled_id()
        .ok_or_else(|| anyhow::anyhow!("remote branch has no resolvable commit"))?
        .to_owned();
    repo.reference(
        head_name,
        commit_id,
        gix::refs::transaction::PreviousValue::MustNotExist,
        "clone: create initial branch",
    )?;

    let tree_id = repo.find_commit(commit_id)?.tree_id()?.detach();
    checkout_tree_to_worktree(&repo, tree_id)?;

    Ok(dest)
}

/// Out of mobile v1 scope (spec, "Out of scope (v1)": no fresh-workspace
/// creation from mobile). Kept registered (once Tauri wrappers land) rather
/// than omitted so a stray call fails loudly instead of the command simply
/// not existing.
pub fn checked_init_notes_repo() -> anyhow::Result<RepoInitOutcome> {
    anyhow::bail!(
        "starting a new workspace from mobile is not supported — join an existing Git-backed workspace instead"
    )
}

/// Out of mobile v1 scope (spec, Credentials: "Mobile onboarding skips the
/// picker — the user pastes a repository URL directly"). Same error text
/// desktop already produces when `gh` isn't installed, so any shared
/// frontend fallback path handles this identically on mobile with zero new
/// UI code.
pub fn list_own_github_repos() -> anyhow::Result<Vec<GithubRepo>> {
    anyhow::bail!("gh not available")
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

    // `derive_clone_dir_name` (git.rs) assumes a forward-slash URL, same as
    // any real git remote — a raw Windows path's backslashes would parse
    // wrong, so tests that pass a local path as a "URL" convert it first,
    // mirroring git.rs's own `as_url` test helper.
    fn as_url(path: &Path) -> String {
        path.to_string_lossy().replace('\\', "/")
    }

    fn git_clone(remote: &Path, dest: &Path) {
        assert!(Command::new("git")
            .arg("clone")
            .arg("-q")
            .arg(remote)
            .arg(dest)
            .status()
            .unwrap()
            .success());
        for (key, value) in [("user.name", "Test"), ("user.email", "test@example.com")] {
            assert!(Command::new("git")
                .arg("-C")
                .arg(dest)
                .arg("config")
                .arg(key)
                .arg(value)
                .status()
                .unwrap()
                .success());
        }
    }

    #[test]
    fn up_to_date_after_fetching_nothing_new() {
        let origin = tempfile::tempdir().unwrap();
        git_init(origin.path());
        commit_file(origin.path(), "a.md", "# A\n", "notes: update a");
        let clone = tempfile::tempdir().unwrap();
        git_clone(origin.path(), clone.path());

        let outcome = checked_pull(&clone.path().to_string_lossy(), "").unwrap();

        assert_eq!(outcome, PullOutcome::UpToDate);
    }

    #[test]
    fn fast_forwards_when_behind_with_no_local_commits() {
        let origin = tempfile::tempdir().unwrap();
        git_init(origin.path());
        commit_file(origin.path(), "a.md", "# A\n", "notes: update a");
        let clone = tempfile::tempdir().unwrap();
        git_clone(origin.path(), clone.path());
        commit_file(origin.path(), "b.md", "# B\n", "notes: update b");

        let outcome = checked_pull(&clone.path().to_string_lossy(), "").unwrap();

        assert_eq!(outcome, PullOutcome::FastForwarded);
        assert!(clone.path().join("b.md").exists());
    }

    #[test]
    fn reports_diverged_with_the_touched_paths_on_each_side() {
        let origin = tempfile::tempdir().unwrap();
        git_init(origin.path());
        commit_file(origin.path(), "shared.md", "base\n", "notes: update shared");
        let clone = tempfile::tempdir().unwrap();
        git_clone(origin.path(), clone.path());
        commit_file(
            origin.path(),
            "remote-only.md",
            "r\n",
            "notes: update remote-only",
        );
        commit_file(
            clone.path(),
            "local-only.md",
            "l\n",
            "notes: update local-only",
        );

        let outcome = checked_pull(&clone.path().to_string_lossy(), "").unwrap();

        match outcome {
            PullOutcome::Diverged {
                ahead,
                behind,
                local_paths,
                remote_paths,
            } => {
                assert_eq!(ahead, 1);
                assert_eq!(behind, 1);
                assert_eq!(local_paths, vec!["local-only.md".to_string()]);
                assert_eq!(remote_paths, vec!["remote-only.md".to_string()]);
            }
            other => panic!("expected Diverged, got {other:?}"),
        }
    }

    #[test]
    fn no_remote_when_none_is_configured() {
        let tmp = tempfile::tempdir().unwrap();
        git_init(tmp.path());
        commit_file(tmp.path(), "a.md", "# A\n", "notes: update a");

        assert_eq!(
            checked_pull(&tmp.path().to_string_lossy(), "").unwrap(),
            PullOutcome::NoRemote
        );
    }

    #[test]
    fn push_reports_no_remote_when_none_is_configured() {
        let tmp = tempfile::tempdir().unwrap();
        git_init(tmp.path());
        commit_file(tmp.path(), "a.md", "# A\n", "notes: update a");

        assert_eq!(
            checked_push(
                &tmp.path().to_string_lossy(),
                RepoMode::NotesOnly,
                false,
                ""
            )
            .unwrap(),
            PushOutcome::NoRemote
        );
    }

    #[test]
    fn push_refuses_a_code_repo_without_the_override() {
        let tmp = tempfile::tempdir().unwrap();
        git_init(tmp.path());
        commit_file(tmp.path(), "a.md", "# A\n", "notes: update a");

        assert!(
            checked_push(&tmp.path().to_string_lossy(), RepoMode::CodeRepo, false, "").is_err()
        );
    }

    #[test]
    fn rebase_combines_disjoint_local_and_remote_changes() {
        let origin = tempfile::tempdir().unwrap();
        git_init(origin.path());
        commit_file(origin.path(), "shared.md", "base\n", "notes: update shared");
        let clone = tempfile::tempdir().unwrap();
        git_clone(origin.path(), clone.path());
        commit_file(
            origin.path(),
            "remote-only.md",
            "r\n",
            "notes: update remote-only",
        );
        commit_file(
            clone.path(),
            "local-only.md",
            "l\n",
            "notes: update local-only",
        );
        assert!(Command::new("git")
            .arg("-C")
            .arg(clone.path())
            .arg("fetch")
            .status()
            .unwrap()
            .success());

        let outcome = checked_rebase_onto_remote(&clone.path().to_string_lossy()).unwrap();

        assert_eq!(outcome, RebaseOutcome::Rebased);
        assert!(clone.path().join("remote-only.md").exists());
        assert!(clone.path().join("local-only.md").exists());
    }

    #[test]
    fn refuses_to_rebase_on_an_unsafe_repo_state() {
        let origin = tempfile::tempdir().unwrap();
        git_init(origin.path());
        commit_file(origin.path(), "a.md", "# A\n", "notes: update a");
        let clone = tempfile::tempdir().unwrap();
        git_clone(origin.path(), clone.path());
        std::fs::write(clone.path().join(".git").join("MERGE_HEAD"), "abc123\n").unwrap();

        assert!(checked_rebase_onto_remote(&clone.path().to_string_lossy()).is_err());
    }

    #[test]
    fn list_note_history_returns_commits_touching_the_path_newest_first() {
        let tmp = tempfile::tempdir().unwrap();
        git_init(tmp.path());
        commit_file(tmp.path(), "Todo.md", "- one\n", "notes: update Todo");
        commit_file(
            tmp.path(),
            "Todo.md",
            "- one\n- two\n",
            "notes: update Todo",
        );

        let path = tmp.path().join("Todo.md").to_string_lossy().into_owned();
        let entries = list_note_history_at(&tmp.path().to_string_lossy(), &path).unwrap();

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].message, "notes: update Todo");
        assert_eq!(entries[0].path, "Todo.md");
    }

    #[test]
    fn read_note_at_commit_returns_the_historical_content() {
        let tmp = tempfile::tempdir().unwrap();
        git_init(tmp.path());
        commit_file(tmp.path(), "Todo.md", "- one\n", "notes: update Todo");
        let path = tmp.path().join("Todo.md").to_string_lossy().into_owned();
        let first_sha = list_note_history_at(&tmp.path().to_string_lossy(), &path).unwrap()[0]
            .sha
            .clone();
        commit_file(
            tmp.path(),
            "Todo.md",
            "- one\n- two\n",
            "notes: update Todo",
        );

        let content =
            read_note_at_commit_at(&tmp.path().to_string_lossy(), "Todo.md", &first_sha).unwrap();

        assert_eq!(content, "- one\n");
    }

    #[test]
    fn clone_repo_clones_into_the_derived_directory_name() {
        let origin = tempfile::tempdir().unwrap();
        git_init(origin.path());
        commit_file(origin.path(), "a.md", "# A\n", "notes: update a");
        let parent = tempfile::tempdir().unwrap();

        let dest = checked_clone_repo(&as_url(origin.path()), &parent.path().to_string_lossy(), "")
            .unwrap();

        assert!(dest.join("a.md").exists());
    }

    #[test]
    fn init_notes_repo_is_not_supported_on_mobile() {
        assert!(checked_init_notes_repo().is_err());
    }

    #[test]
    fn list_github_repos_is_not_supported_on_mobile() {
        assert!(list_own_github_repos().is_err());
    }
}

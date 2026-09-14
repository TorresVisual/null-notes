# git_mobile.rs (gix rewrite) Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Give the iOS build a real, in-process replacement for `git.rs`'s 12 git operations — `git_mobile.rs`, built on `gix` (gitoxide) instead of shelling out to the `git` CLI, which iOS's App Sandbox forbids entirely. Once this lands, an iOS build can detect a workspace's repo mode, auto-commit, fetch/pull, push, rebase-onto-remote, browse note history, and clone — the same commands the frontend already calls on desktop, now with an iOS-compatible implementation behind them.

**Architecture:** `git.rs` (desktop, shells to `git`) is left with only a few `pub(crate)` visibility bumps on pure helpers it already has — no logic changes. A new `git_mobile.rs` reimplements the same 11 `#[tauri::command]` names against `gix`, reusing those bumped-visibility helpers rather than duplicating them. `lib.rs` picks which module's functions get registered in `generate_handler!` via a `cfg`-gated module alias, so the frontend's `invoke("auto_commit", …)` calls resolve to `git.rs` on Windows and `git_mobile.rs` on iOS without any frontend branching. Two commands (`init_notes_repo`, `list_github_repos`) are explicitly out of mobile's v1 scope per the spec and get a one-line "not supported on mobile" stub rather than a real port. `gix` has no porcelain push or rebase — both are built from lower-level `gix` primitives (object/tree writing, `Connection`) confirmed to exist via current `docs.rs` lookups, not assumed from memory.

**Tech Stack:** `gix` (gitoxide) 0.7x, pure-Rust HTTP transport (`blocking-http-transport-reqwest`, avoiding a second C-library cross-compile after pdfium), Rust cross-compiled to `aarch64-apple-ios-sim` in the existing `ios-scaffold.yml` CI workflow, plus a new native-macOS `cargo test` step in that same workflow (gix's logic is ordinary Rust with no iOS-specific API, so its tests run natively on the CI Mac — no simulator needed).

**Spec:** docs/specs/mobile-app-design.md

## Execution Options

Leave every box below unchecked. The executing skill resolves them with
your human partner before Step 1 and checks the chosen boxes itself.

**Execution Target:**
- [x] Current branch (no isolation)
- [ ] New feature branch (no worktree)
- [ ] Worktree (superpowers:using-git-worktrees)

**Execution Mode:**
- [x] Inline execution (superpowers:executing-plans)
- [ ] Subagent-driven execution (superpowers:subagent-driven-development)

## Global Constraints

- **Requires the same macOS-host-via-CI setup `docs/plans/mobile-ios-scaffold.md` already built.** Every command below that needs to compile for iOS or run on macOS runs as a step in the existing `.github/workflows/ios-scaffold.yml`, triggered via `gh workflow run` / `gh run watch --exit-status` from Windows — never typed by hand on a Mac. This plan appends steps to that same file rather than creating a new one.
- **No behavior change to desktop.** `git.rs` keeps its current shelled-to-`git` behavior byte-for-byte; the only edits to it in this plan are three `fn` → `pub(crate) fn` visibility bumps (Task 1) so `git_mobile.rs` can reuse pure logic instead of duplicating it. Desktop's existing test suite (`cargo test` on `windows-latest` per `ci.yml`) must stay green throughout.
- **`gix` is a normal (not target-gated) dependency.** Unlike `pdfium-render`, there's no reason to exclude it from the Windows build — it's pure Rust, adds compile time but no behavioral risk, and letting it compile everywhere means its unit tests can run natively on the CI macOS runner without cross-compiling to the iOS target at all.
- **The iOS build must still succeed with `pdf-native` disabled** (per the scaffold plan) — this plan doesn't touch the PDF pipeline.
- **Two operations are explicitly out of mobile v1 scope per the spec** ("Out of scope (v1)": no fresh-workspace creation from mobile, no `gh`-backed repo picker): `init_notes_repo` and `list_github_repos`. Task 7 gives both a stub, not a real gix port.
- **Credentials are out of this plan's scope.** `checked_pull`/`checked_push`/`checked_clone_repo` on mobile take a `token: &str` parameter (HTTPS PAT); *where* that token is read from (iOS Keychain, onboarding UI) is a separate, later plan. This plan's job ends at "the git operation works if handed a valid token."
- **`gix` has no porcelain `push` or `rebase`** — confirmed against current `docs.rs` API listings before writing this plan (fetch/receive, `Connection`, object/tree writing, and a blob-merge driver all exist and are documented; no `Connection::push` or `gix::rebase` module does). Tasks 5 and 6 build both from the primitives that *do* exist, not from a porcelain call — if a task's first step says "confirm the exact method signature against `docs.rs`," that's a narrow, unavoidable version-pinning detail (the same category of thing the scaffold plan's own "Actual result (deviates from the plan)" notes recorded for CLI flags), not an unresolved design question.

---

### Task 1: Add `gix`, bump helper visibility, wire the command dispatch

**Files:**
- Modify: `src-tauri/Cargo.toml` — add `gix` dependency.
- Modify: `src-tauri/src/commands/git.rs` — three `fn` → `pub(crate) fn` visibility bumps only (`is_workspace_folder`, `only_holds_workspace_siblings`, `is_notes_monorepo`); no logic changes.
- Modify: `src-tauri/src/commands/mod.rs` — add `pub mod git_mobile;`.
- Create: `src-tauri/src/commands/git_mobile.rs`.
- Modify: `src-tauri/src/lib.rs:1,100-148` — cfg-gated module alias, update the 11 git command paths in `generate_handler!`.
- Modify: `.github/workflows/ios-scaffold.yml` — add a native `cargo test` step.

**Interfaces:**
- Consumes: `RepoMode` (`src-tauri/src/models.rs`), the three bumped-visibility helpers from `git.rs`, and every `pub` type `git.rs` already defines (`CommitOutcome`, `PushOutcome`, `PullOutcome`, `RebaseOutcome`, `RepoInitOutcome`, `UnsafeRepoState`, `NoteHistoryEntry`, `GithubRepo`) — `git_mobile.rs` returns the same types rather than defining its own, so both modules satisfy the same `generate_handler!` entries.
- Produces: `commands::git_mobile::detect_repo_mode(workspace: &str) -> anyhow::Result<Option<RepoMode>>` and its `#[tauri::command] pub async fn detect_repo` wrapper — the first working operation, used here to prove the wiring end to end. `detect_prior_automation` ships in this task too since it's a two-line function once `detect_repo_mode`-equivalent state exists.

- [x] **Step 1: Add the `gix` dependency**

In `src-tauri/Cargo.toml`, add to `[dependencies]` (not target-gated — see Global Constraints):

```toml
gix = { version = "0.70", default-features = false, features = [
    "blocking-network-client",
    "blocking-http-transport-reqwest",
    "credentials",
    "tree-editor",
    "revision",
] }
```

Before committing, run `cargo tree -p gix` (from `src-tauri/`) and confirm no C library (`libcurl`, `libssh2`, `openssl-sys`) appears in the resolved tree — the whole point of `blocking-http-transport-reqwest` over `blocking-http-transport-curl` is a pure-Rust HTTPS stack (`docs.rs`'s own feature-flag page confirms these two are the two HTTP backend choices, and only the curl one links a C library). If a C dependency did sneak in, check `docs.rs/gix`'s current feature list for a `-rustls` vs `-native-tls` suffix on the reqwest feature (TLS backend selection is separate from the HTTP client choice, and its exact current feature name is worth a live check before trusting this plan's spelling of it) and add that feature explicitly.

- [x] **Step 2: Bump three helpers to `pub(crate)`**

In `src-tauri/src/commands/git.rs`, change:
```rust
fn is_workspace_folder(dir: &Path) -> bool {
```
to
```rust
pub(crate) fn is_workspace_folder(dir: &Path) -> bool {
```
Same for `only_holds_workspace_siblings` and `is_notes_monorepo`. No other change on these three lines.

- [x] **Step 3: Run desktop's existing test suite to confirm zero behavior change**

Run: `cargo test --lib commands::git:: --manifest-path src-tauri/Cargo.toml` (on Windows, where `git` is on `PATH`).
Expected: all existing `git.rs` tests still PASS — a visibility bump has no runtime effect, this step just proves it.

- [x] **Step 4: Create `git_mobile.rs` with `detect_repo`/`detect_prior_automation`**

```rust
//! iOS's mobile-target replacement for `git.rs`: the same 12 operations,
//! reimplemented against `gix` instead of shelling out to `git` — the App
//! Sandbox forbids spawning a child process at all, so there is no `git`
//! binary to shell out to regardless. See docs/specs/mobile-app-design.md,
//! "Why desktop's git.rs can't be reused."
//!
//! Command names and return types match `git.rs` exactly (reusing its
//! `pub` types directly) so the frontend never branches on platform for
//! these calls — only `lib.rs`'s module alias picks which implementation
//! is registered. `init_notes_repo` and `list_github_repos` are the two
//! exceptions: explicitly out of mobile v1 scope, stubbed in Task 7.

use super::git::{
    is_notes_monorepo, CommitOutcome, GithubRepo, NoteHistoryEntry, PullOutcome, PushOutcome,
    RebaseOutcome, RepoInitOutcome, UnsafeRepoState,
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

    Ok(Some(
        if is_notes_monorepo(&root_canon, &workspace_canon)? {
            RepoMode::NotesMonorepo
        } else {
            RepoMode::CodeRepo
        },
    ))
}

#[tauri::command]
pub async fn detect_repo(workspace: String) -> Result<Option<RepoMode>, String> {
    tokio::task::spawn_blocking(move || detect_repo_mode(&workspace))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// Same evidence rule as desktop's `detect_prior_git_automation`: a remote
/// to sync through, plus at least one commit this app's own auto-commit
/// made. `has_notes_commit_in_log` (Task 3) provides the second half once
/// commit-log walking exists; until then this stub only checks for a
/// remote, which Task 3 tightens.
pub fn detect_prior_git_automation(workspace: &str) -> anyhow::Result<bool> {
    let repo = gix::discover(workspace)?;
    let has_remote = repo.remote_names().iter().next().is_some();
    Ok(has_remote && has_notes_commit_in_log(&repo)?)
}

#[tauri::command]
pub async fn detect_prior_automation(workspace: String) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || detect_prior_git_automation(&workspace))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// Walks HEAD's ancestry looking for a commit message starting with
/// `"notes: update "` — the same prefix `git.rs`'s `build_commit_message`
/// uses and the same rule `has_notes_commits` checks for on desktop.
/// Capped the same way `list_note_history_at`'s history browsing is
/// (nothing here needs the *full* history, just "does one exist").
fn has_notes_commit_in_log(repo: &gix::Repository) -> anyhow::Result<bool> {
    let Some(head_id) = repo.head_id().ok() else {
        return Ok(false);
    };
    // `rev_walk`'s exact builder method names (`.all()`, sorting options)
    // are worth confirming against gix::Repository::rev_walk's current
    // docs.rs page before relying on this signature verbatim.
    for info in repo.rev_walk([head_id.detach()]).all()?.take(500) {
        let info = info?;
        let commit = info.object()?;
        let message = commit.message()?;
        if message.title.starts_with(b"notes: update ") {
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
    // the *code under test* avoids it. This mirrors git.rs's own test
    // helpers exactly (see git_init/commit_file there); duplicated rather
    // than shared because git.rs's versions call its own `no_window_command`
    // wrapper, whose Windows console-suppression is irrelevant on the
    // macOS CI runner these tests actually run on (see Global Constraints:
    // gix is not target-gated, so this file's tests run natively there).
    fn git_init(dir: &Path) {
        assert!(Command::new("git").arg("-C").arg(dir).arg("init").arg("-q").status().unwrap().success());
        for (key, value) in [("user.name", "Test"), ("user.email", "test@example.com")] {
            assert!(Command::new("git").arg("-C").arg(dir).arg("config").arg(key).arg(value).status().unwrap().success());
        }
    }

    fn commit_file(dir: &Path, name: &str, content: &str, message: &str) {
        std::fs::write(dir.join(name), content).unwrap();
        assert!(Command::new("git").arg("-C").arg(dir).arg("add").arg(name).status().unwrap().success());
        assert!(Command::new("git").arg("-C").arg(dir).arg("commit").arg("-m").arg(message).status().unwrap().success());
    }

    #[test]
    fn a_plain_folder_is_not_a_repo() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(detect_repo_mode(&tmp.path().to_string_lossy()).unwrap(), None);
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
```

- [x] **Step 5: Register `git_mobile` and wire the dispatch alias**

In `src-tauri/src/commands/mod.rs`, add:
```rust
pub mod git_mobile;
```
(alongside the existing `pub mod git;` — both always compile on every platform; only which one gets registered as Tauri commands differs.)

In `src-tauri/src/lib.rs`, near the top (after existing `use`/`mod` lines):
```rust
#[cfg(not(target_os = "ios"))]
use commands::git as git_impl;
#[cfg(target_os = "ios")]
use commands::git_mobile as git_impl;
```

Then in the `generate_handler!` list, replace the 11 `commands::git::*` entries with `git_impl::*`:
```rust
            git_impl::detect_repo,
            git_impl::detect_prior_automation,
            git_impl::auto_commit,
            git_impl::push_notes,
            git_impl::fetch_and_compare,
            git_impl::rebase_onto_remote,
            git_impl::init_notes_repo,
            git_impl::list_note_history,
            git_impl::read_note_at_commit,
            git_impl::list_github_repos,
            git_impl::clone_repo,
```
(The other ~50 entries are untouched.) This alone won't compile yet — `git_mobile.rs` only has 2 of the 11 command functions so far. Add a `#[cfg(not(target_os = "ios"))]`-free `todo!()`-free stopgap isn't an option (no placeholders) — instead, temporarily keep `git_impl` pointed at `commands::git` unconditionally until Task 7 lands all 11, i.e. leave the `#[cfg(target_os = "ios")]` line out for now:
```rust
use commands::git as git_impl;
```
Task 7's Step 3 flips this to the real cfg-gated version once all 11 mobile commands exist — noted there so this task compiles cleanly today without a half-registered mobile module.

- [x] **Step 6: Verify desktop still builds and lints clean**

```bash
cd src-tauri
cargo build
cargo clippy -- -D warnings
cargo fmt --check
```
Expected: PASS, no behavior change (Step 5 left `git_impl` pointed at `commands::git`).

- [x] **Step 7: Add a native `cargo test` step to the CI workflow**

`git_mobile.rs`'s tests are ordinary Rust (gix has no iOS-specific API) — they run on the CI macOS runner directly, no cross-compile or Simulator needed. Add to `.github/workflows/ios-scaffold.yml`, after the existing "cargo build (desktop, unaffected)" step:
```yaml
      - name: cargo test (git_mobile, native macOS)
        working-directory: src-tauri
        run: cargo test --lib commands::git_mobile::
```

- [x] **Step 8: Commit and verify via CI**

```bash
git add src-tauri/Cargo.toml src-tauri/src/commands/git.rs src-tauri/src/commands/git_mobile.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs .github/workflows/ios-scaffold.yml
git commit -m "build: add gix and stand up git_mobile.rs's repo-mode detection"
git push
gh workflow run ios-scaffold.yml
gh run watch --exit-status
```
Expected: PASS, including the new `cargo test (git_mobile, native macOS)` step and the existing `cargo check (iOS)` step (confirms `git_mobile.rs` cross-compiles to `aarch64-apple-ios-sim` too, even though nothing calls it there yet).

---

### Task 2: `unsafe_repo_state` via gix

**Files:**
- Modify: `src-tauri/src/commands/git_mobile.rs`.

**Interfaces:**
- Consumes: `gix::discover` (Task 1), `UnsafeRepoState` (imported from `git.rs`).
- Produces: `pub fn unsafe_repo_state(workspace: &str) -> anyhow::Result<Option<UnsafeRepoState>>`, consumed by Task 3's `checked_auto_commit` and Task 6's `checked_rebase_onto_remote` exactly as desktop's own `checked_auto_commit`/`checked_rebase_onto_remote` consume their local version.

- [x] **Step 1: Write the failing tests**

Add to `git_mobile.rs`'s `#[cfg(test)] mod tests`:
```rust
    #[test]
    fn a_clean_repo_is_safe() {
        let tmp = tempfile::tempdir().unwrap();
        git_init(tmp.path());
        commit_file(tmp.path(), "a.md", "hello", "notes: update a");
        assert_eq!(unsafe_repo_state(&tmp.path().to_string_lossy()).unwrap(), None);
    }

    #[test]
    fn a_detached_head_is_unsafe() {
        let tmp = tempfile::tempdir().unwrap();
        git_init(tmp.path());
        commit_file(tmp.path(), "a.md", "hello", "notes: update a");
        let sha_output = Command::new("git").arg("-C").arg(tmp.path()).arg("rev-parse").arg("HEAD").output().unwrap();
        let sha = String::from_utf8_lossy(&sha_output.stdout).trim().to_string();
        assert!(Command::new("git").arg("-C").arg(tmp.path()).arg("checkout").arg(&sha).status().unwrap().success());

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
        assert!(Command::new("git").arg("-C").arg(tmp.path()).arg("stash").arg("push").status().unwrap().success());
        commit_file(tmp.path(), "a.md", "conflicting\n", "notes: update a");
        // Expected to fail with a real conflict, leaving unmerged index entries.
        let _ = Command::new("git").arg("-C").arg(tmp.path()).arg("stash").arg("pop").status();

        assert_eq!(
            unsafe_repo_state(&tmp.path().to_string_lossy()).unwrap(),
            Some(UnsafeRepoState::UnresolvedConflicts)
        );
    }
```

- [x] **Step 2: Run tests to verify they fail**

Run: `cargo test --lib commands::git_mobile:: --manifest-path src-tauri/Cargo.toml` (native, no `--target`).
Expected: FAIL with "cannot find function `unsafe_repo_state`".

- [x] **Step 3: Implement `unsafe_repo_state`**

```rust
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

    // `head()` resolves HEAD without following it to a commit; matching
    // git.rs's own "does HEAD start with `ref:`" check, just via gix's
    // typed API instead of reading the file as text.
    if !repo.head()?.is_detached() {
        // fall through — attached HEAD, check conflicts next
    } else {
        return Ok(Some(UnsafeRepoState::DetachedHead));
    }

    // Stage 0 = unconflicted (gix_index::entry::Stage::Unconflicted); any
    // entry at a non-zero stage is an unmerged conflict, the same
    // information `git ls-files -u` surfaces.
    let index = repo.index_or_empty()?;
    let has_conflict = index.entries().iter().any(|entry| entry.stage() != gix::index::entry::Stage::Unconflicted);
    if has_conflict {
        return Ok(Some(UnsafeRepoState::UnresolvedConflicts));
    }

    Ok(None)
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `cargo test --lib commands::git_mobile:: --manifest-path src-tauri/Cargo.toml`.
Expected: PASS. If `repo.head()?.is_detached()` or `index.entries()`/`entry.stage()` don't match this exact shape, check `gix::Repository::head`/`gix::Head::is_detached` and `gix::worktree::IndexPersistedOrInMemory::entries`/`gix_index::Entry::stage` on `docs.rs` for the current method names — the behavior (detached-HEAD check, per-entry stage read) is what matters, not this exact spelling.

- [x] **Step 5: Commit**

```bash
git add src-tauri/src/commands/git_mobile.rs
git commit -m "feat(mobile): implement unsafe_repo_state via gix"
git push
```

---

### Task 3: `auto_commit` via gix

**Files:**
- Modify: `src-tauri/src/commands/git_mobile.rs`.

**Interfaces:**
- Consumes: `unsafe_repo_state` (Task 2), `CommitOutcome` (from `git.rs`).
- Produces: `pub fn checked_auto_commit(workspace: &str, mode: RepoMode, paths: &[String], skip_hooks: bool) -> anyhow::Result<CommitOutcome>` and its `#[tauri::command] auto_commit` wrapper.

**Deliberate parity gap, called out here rather than discovered mid-implementation:** git hooks are shell scripts, and iOS forbids spawning a subprocess to run one — the same constraint the spec's "Feature cuts" section already applies to the Run button, Open-in-IDE, and the P8 terminal. `skip_hooks` is accepted for signature compatibility but mobile's `checked_auto_commit` never runs a hook either way; `CommitOutcome::HookFailed` is structurally unreachable from this function. This isn't in the spec's explicit "Feature cuts" list (that list covers UI-visible affordances; a commit hook has no UI surface to hide), so it's worth the frontend/desktop maintainer knowing about explicitly rather than only discovering it by reading this diff.

- [x] **Step 1: Write the failing tests**

```rust
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
        ).unwrap();

        assert_eq!(outcome, CommitOutcome::Committed);
        let show = Command::new("git").arg("-C").arg(tmp.path()).arg("show").arg("--stat").arg("--format=").arg("HEAD").output().unwrap();
        let files = String::from_utf8_lossy(&show.stdout);
        assert!(files.contains("note.md"));
        assert!(!files.contains("src.rs"), "unstaged src.rs edit must survive untouched");
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
        ).unwrap();

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
        ).unwrap();

        assert!(matches!(outcome, CommitOutcome::Skipped { .. }));
    }
```

- [x] **Step 2: Run tests to verify they fail**

Run: `cargo test --lib commands::git_mobile:: --manifest-path src-tauri/Cargo.toml`.
Expected: FAIL — `checked_auto_commit` doesn't exist.

- [x] **Step 3: Implement `checked_auto_commit`**

```rust
/// Builds a new tree from HEAD's tree plus `paths`' current on-disk content,
/// writes a commit on top of HEAD with that tree, and moves the current
/// branch ref to point at it. Unlike desktop's `git add` + `git commit`,
/// there's no index staging step to reason about — the tree is built
/// directly from the paths this call was given, which is exactly the
/// "batch, never anything else staged" property `checked_auto_commit` is
/// documented to have on desktop, just achieved structurally here instead
/// of relying on `git add --` being pathspec-scoped.
pub fn checked_auto_commit(
    workspace: &str,
    _mode: RepoMode,
    paths: &[String],
    _skip_hooks: bool,
) -> anyhow::Result<CommitOutcome> {
    if let Some(state) = unsafe_repo_state(workspace)? {
        return Ok(CommitOutcome::Skipped { reason: state.reason().to_string() });
    }

    let repo = gix::discover(workspace)?;
    let workspace_path = Path::new(workspace);
    let head_tree_id = repo.head_tree_id()?;

    let mut editor = repo.edit_tree(head_tree_id)?;
    let mut changed = false;
    let mut committed_paths = Vec::new();
    for path in paths {
        let abs = super::git::resolve(workspace, path);
        let Ok(repo_relative) = abs.strip_prefix(
            repo.workdir().ok_or_else(|| anyhow::anyhow!("bare repo"))?,
        ) else {
            continue; // outside the repo entirely — same "skip, don't fail the batch" posture as addable_paths
        };
        let repo_relative = repo_relative.to_string_lossy().replace('\\', "/");

        if abs.exists() {
            let content = std::fs::read(&abs)?;
            let blob_id = repo.write_blob(content)?;
            editor.upsert(
                repo_relative.split('/').collect::<Vec<_>>(),
                gix::object::tree::EntryKind::Blob,
                blob_id.detach(),
            )?;
            changed = true;
        } else {
            // A path that no longer exists on disk is a removal — mirrors
            // addable_paths' "deleted but previously tracked" branch.
            if editor.remove(repo_relative.split('/').collect::<Vec<_>>())?.is_some() {
                changed = true;
            }
        }
        committed_paths.push(path.clone());
    }

    if !changed {
        return Ok(CommitOutcome::NothingToCommit);
    }

    let new_tree_id = editor.write()?;
    if new_tree_id == head_tree_id {
        return Ok(CommitOutcome::NothingToCommit);
    }

    let message = super::git::build_commit_message(&committed_paths);
    let head_commit_id = repo.head_id()?.detach();
    let new_commit_id = repo.new_commit(&message, new_tree_id, [head_commit_id])?;

    let head_ref_name = repo.head_name()?.ok_or_else(|| anyhow::anyhow!("HEAD is not a symbolic ref"))?;
    repo.reference(
        head_ref_name,
        new_commit_id.detach(),
        gix::refs::transaction::PreviousValue::MustExistAndMatch(head_commit_id.into()),
        format!("commit: {message}"),
    )?;

    let _ = workspace_path; // kept for symmetry with git.rs's signature; unused directly once repo is discovered
    Ok(CommitOutcome::Committed)
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
```

Bump two more `git.rs` helpers to `pub(crate)` for this (Step 3a, fold into this task rather than Task 1 since they're only needed once auto-commit exists): `build_commit_message` and `resolve`. Same rule as Task 1 Step 2 — visibility only, no logic change, rerun `cargo test --lib commands::git:: --manifest-path src-tauri/Cargo.toml` on Windows afterward to confirm desktop is unaffected.

Add the import to `git_mobile.rs`'s existing `use super::git::{...}` line: `build_commit_message` and `resolve` alongside the others (call sites above use `super::git::build_commit_message`/`super::git::resolve` directly, so the `use` addition is for the tests below, which call them unqualified nowhere here — skip the import if nothing in this file ends up needing it unqualified, and keep the fully-qualified calls as written above; simpler, one less name to track).

- [x] **Step 4: Run tests to verify they pass**

Run: `cargo test --lib commands::git_mobile:: --manifest-path src-tauri/Cargo.toml`.
Expected: PASS. `Repository::edit_tree`/`object::tree::Editor::upsert`/`.remove`/`.write`, `Repository::write_blob`, `Repository::new_commit`, and `Repository::reference` are the confirmed-to-exist primitives (per `docs.rs` lookups made while writing this plan) — `upsert`'s and `remove`'s exact parameter shapes (path-component slice vs. a single `BStr` path) are worth a live check against `gix::object::tree::Editor`'s current docs page before trusting this plan's call shape verbatim.

- [x] **Step 5: Commit**

```bash
git add src-tauri/src/commands/git_mobile.rs src-tauri/src/commands/git.rs
git commit -m "feat(mobile): implement auto_commit via gix tree/commit writing"
git push
```

---

### Task 4: `fetch_and_compare` (pull classification) via gix

**Files:**
- Modify: `src-tauri/src/commands/git_mobile.rs`.

**Interfaces:**
- Consumes: nothing new from earlier tasks besides the module scaffold.
- Produces: `pub fn checked_pull(workspace: &str, token: &str) -> anyhow::Result<PullOutcome>` and its `#[tauri::command] fetch_and_compare` wrapper. **Signature deviates from desktop's `fetch_and_compare(workspace)`** by adding `token: &str` — the spec's own Credentials section anticipates this ("`gix` has no such [credential] inheritance; mobile needs an explicit credential mechanism"); wiring the frontend to actually supply a stored token is a separate, later plan (Global Constraints).

- [x] **Step 1: Write the failing tests**

```rust
    fn git_clone(remote: &Path, dest: &Path) {
        assert!(Command::new("git").arg("clone").arg("-q").arg(remote).arg(dest).status().unwrap().success());
        for (key, value) in [("user.name", "Test"), ("user.email", "test@example.com")] {
            assert!(Command::new("git").arg("-C").arg(dest).arg("config").arg(key).arg(value).status().unwrap().success());
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
        commit_file(origin.path(), "remote-only.md", "r\n", "notes: update remote-only");
        commit_file(clone.path(), "local-only.md", "l\n", "notes: update local-only");

        let outcome = checked_pull(&clone.path().to_string_lossy(), "").unwrap();

        match outcome {
            PullOutcome::Diverged { ahead, behind, local_paths, remote_paths } => {
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

        assert_eq!(checked_pull(&tmp.path().to_string_lossy(), "").unwrap(), PullOutcome::NoRemote);
    }
```

- [x] **Step 2: Run tests to verify they fail**

Run: `cargo test --lib commands::git_mobile:: --manifest-path src-tauri/Cargo.toml`.
Expected: FAIL — `checked_pull` doesn't exist.

- [x] **Step 3: Implement `checked_pull`**

```rust
/// `token` authenticates over HTTPS when the remote actually requires it —
/// these tests use a local `file://`-style path remote, which needs no
/// credential, so an empty token is fine there; a real GitHub HTTPS remote
/// is what Task 9 threads a real token through.
pub fn checked_pull(workspace: &str, token: &str) -> anyhow::Result<PullOutcome> {
    let repo = gix::discover(workspace)?;
    let Ok(remote) = repo.find_default_remote(gix::remote::Direction::Fetch).transpose() else {
        return Ok(PullOutcome::NoRemote);
    };
    let Some(remote) = remote? else {
        return Ok(PullOutcome::NoRemote);
    };

    let connection = remote
        .connect(gix::remote::Direction::Fetch)?
        .with_credentials(basic_auth_credentials(token));
    let outcome = connection
        .prepare_fetch(gix::progress::Discard, Default::default())?
        .receive(gix::progress::Discard, &Default::default())?;
    let _ = outcome;

    let Some(local_branch) = repo.head_name()? else {
        anyhow::bail!("HEAD is not a symbolic ref");
    };
    let Ok(upstream_id) = repo.find_reference(&format!("refs/remotes/origin/{}", local_branch.shorten()))
        .and_then(|r| r.into_fully_peeled_id().map_err(Into::into))
    else {
        let ahead = repo.rev_walk([repo.head_id()?.detach()]).all()?.count() as u32;
        return Ok(PullOutcome::NoUpstream { ahead });
    };
    let upstream_id = upstream_id.detach();
    let head_id = repo.head_id()?.detach();

    let ahead = count_commits_between(&repo, upstream_id, head_id)?;
    let behind = count_commits_between(&repo, head_id, upstream_id)?;

    if behind == 0 {
        return Ok(if ahead > 0 { PullOutcome::Ahead { ahead } } else { PullOutcome::UpToDate });
    }
    if ahead > 0 {
        let base = merge_base(&repo, head_id, upstream_id)?;
        let local_paths = changed_paths_between(&repo, base, head_id)?;
        let remote_paths = changed_paths_between(&repo, base, upstream_id)?;
        return Ok(PullOutcome::Diverged { ahead, behind, local_paths, remote_paths });
    }

    // Pure fast-forward: no local commits since the merge-base, so moving
    // the branch ref (and checking out the new tree) is safe unconditionally
    // — the same case desktop's `merge --ff-only` always succeeds for.
    let head_ref_name = repo.head_name()?.ok_or_else(|| anyhow::anyhow!("HEAD is not a symbolic ref"))?;
    repo.reference(
        head_ref_name,
        upstream_id,
        gix::refs::transaction::PreviousValue::MustExistAndMatch(head_id.into()),
        "pull --ff-only",
    )?;
    checkout_head_tree(&repo)?;
    Ok(PullOutcome::FastForwarded)
}

/// `HEAD..other` in git's range syntax: commits reachable from `other` but
/// not from `head`. Confirm `Platform`'s exact hidden-tips builder method
/// name (`with_hidden`, `hide`, or similar — this plan's best guess from
/// gix's documented `Platform` fields) against `gix::revision::walk`'s
/// current docs.rs page.
fn count_commits_between(repo: &gix::Repository, exclude: gix::ObjectId, include: gix::ObjectId) -> anyhow::Result<u32> {
    Ok(repo.rev_walk([include]).with_hidden([exclude]).all()?.count() as u32)
}

fn merge_base(repo: &gix::Repository, a: gix::ObjectId, b: gix::ObjectId) -> anyhow::Result<gix::ObjectId> {
    Ok(repo.merge_base(a, b)?.detach())
}

/// Repo-root-relative changed paths between two commits' trees, matching
/// `changed_note_paths`'s contract on desktop. Built on `gix::diff`'s tree
/// visitor (confirmed to exist on docs.rs) rather than `git diff
/// --name-only`.
fn changed_paths_between(repo: &gix::Repository, from: gix::ObjectId, to: gix::ObjectId) -> anyhow::Result<Vec<String>> {
    let from_tree = repo.find_commit(from)?.tree()?;
    let to_tree = repo.find_commit(to)?.tree()?;
    let mut paths = Vec::new();
    from_tree.changes()?.for_each_to_obtain_tree(&to_tree, |change| {
        paths.push(change.location().to_string());
        Ok::<_, std::convert::Infallible>(gix::object::tree::diff::Action::Continue)
    })?;
    Ok(paths)
}

fn checkout_head_tree(repo: &gix::Repository) -> anyhow::Result<()> {
    // A real checkout-to-worktree call belongs here (gix::worktree::checkout
    // or Repository::checkout — confirm the current name on docs.rs); until
    // Task 4 is executed this is the one remaining gap in FastForwarded,
    // called out explicitly rather than left silently incomplete.
    anyhow::bail!("checkout_head_tree: confirm gix's worktree-checkout API before shipping this path")
}
```

**Note for the executing agent:** `checkout_head_tree` is deliberately left calling `anyhow::bail!` with a descriptive message rather than a fabricated API call — none of this plan's `docs.rs` lookups turned up a confirmed worktree-checkout entry point (fetch/tree/commit APIs were all confirmed; checkout wasn't specifically queried). Before marking this task done, run one targeted `docs.rs`/ctx7 lookup for "gix checkout working tree from a tree id" and replace this function's body with the real call — this is the one spot in Task 4 that is a genuine open lookup, not a placeholder for logic. Everything else in `checked_pull` is real, runnable code once that single function is filled in.

- [x] **Step 4: Run tests to verify they pass**

Run: `cargo test --lib commands::git_mobile:: --manifest-path src-tauri/Cargo.toml`.
Expected: the `fast_forwards_when_behind_with_no_local_commits` test FAILS until `checkout_head_tree` is filled in with a real implementation (per the note above); the other three pass once the rest of `checked_pull` is correct. Do not consider this task done with `checkout_head_tree` still a `bail!`.

- [x] **Step 5: Commit**

```bash
git add src-tauri/src/commands/git_mobile.rs
git commit -m "feat(mobile): implement fetch_and_compare (pull classification) via gix"
git push
```

---

### Task 5: `push_notes` via gix `Connection` primitives

**Files:**
- Modify: `src-tauri/src/commands/git_mobile.rs`.

**Interfaces:**
- Consumes: `basic_auth_credentials` (Task 4/6 shared helper — move it here if Task 4 hasn't landed it yet), `PushOutcome` (from `git.rs`).
- Produces: `pub fn checked_push(workspace: &str, mode: RepoMode, allow_code_repo_push: bool, token: &str) -> anyhow::Result<PushOutcome>` and its `#[tauri::command] push_notes` wrapper.

**This is the plan's highest-risk task, flagged as such rather than hidden behind confident-looking code.** No `docs.rs` lookup made while writing this plan turned up a porcelain `push`/`send-pack` call on `gix::Remote` or `gix::remote::Connection` — only fetch-direction methods (`prepare_fetch`, `ref_map`, `receive`) are documented. `gix`'s own push-configuration types (`push.default`, `remote.<name>.push`) exist for *reading* config, not for *sending* a pack. This matches gitoxide's own long-standing public tracking of push as unimplemented at the porcelain level.

**Deferred, by explicit decision during execution.** Step 1's investigation was carried out for real (not skipped): confirmed against `gix` 0.87.1 (a year+ past this plan's assumed 0.70) that no porcelain push exists, against GitoxideLabs/gitoxide#306 (gitoxide's own push tracking issue — still open as an unresolved feature discussion, not fixed), and against the absence of a `push.rs` in gitoxide's own `gix/examples/`. The one from-scratch attempt found (gitoxide PR #2538) is an unreviewed, closed experimental branch, not something to build on for a path that pushes real commits to a user's real GitHub remote. Given that risk, hand-rolling the send-pack wire protocol here was deliberately not attempted — `checked_push` implements the two checks that don't need it (the `CodeRepo` guard, `NoRemote` detection, both tested) and bails clearly otherwise. Steps 2–4 below (the real send-pack implementation and its tests) are left for a dedicated follow-up plan once there's appetite for that wire-protocol effort, rather than left half-done here.

- [ ] **Step 1: Confirm current push support before writing a single line of implementation**

Run (on the CI macOS runner, since it has network access `npx ctx7`/`docs.rs` need — or from Windows if `npx ctx7` is available locally):
```bash
npx ctx7@latest docs /websites/rs_gix "gix send pack write ref update request to a remote, gix_protocol push documentation"
```
Also check `gitoxide`'s own repository (github.com/GitoxideLabs/gitoxide) for a `push` example under `gix/examples/` — gitoxide ships runnable examples for exactly the operations it supports, so a `push.rs` example's presence or absence is a fast, concrete answer.

Two outcomes branch from here:
- **If a working push example/API exists:** port it directly, following its exact shape rather than this plan's guess. Skip to Step 2 below with the confirmed API in hand.
- **If it doesn't (the expected case per the investigation above):** proceed with Step 2's from-scratch implementation, built on the confirmed-to-exist `Connection` + `gix_transport` layer.

- [ ] **Step 2: Implement push on the wire protocol's ref-update-request + pack-upload primitives**

```rust
/// Built directly on gix's transport/protocol layer since no higher-level
/// push call exists (Step 1). Shape: connect for the *push* direction,
/// hand the transport a single ref-update command (old id → new id for
/// `refs/heads/<branch>`) followed by a pack containing every object HEAD's
/// ancestry has that the remote doesn't — mirroring what `git push` sends
/// on the wire (see git's own `Documentation/technical/pack-protocol.txt`,
/// the "Reference Update Request and Packfile Transfer" section, for the
/// exact line format if `gix_transport`'s API requires assembling it by
/// hand rather than exposing a single call for it).
///
/// Confirm `gix_transport::client::Transport`'s current write-side API
/// (`request`, `send_flush`, or equivalent) against its docs.rs page before
/// treating this function body as final — this plan's own investigation
/// (Step 1) stopped at "no porcelain exists," not "here is the exact raw
/// call sequence," since that requires reading gix_transport's source
/// directly rather than the gix crate's own doc surface this plan's
/// lookups were scoped to.
pub fn checked_push(
    workspace: &str,
    mode: RepoMode,
    allow_code_repo_push: bool,
    token: &str,
) -> anyhow::Result<PushOutcome> {
    if mode == RepoMode::CodeRepo && !allow_code_repo_push {
        anyhow::bail!("refusing to push a CodeRepo workspace — set allow_code_repo_push to override");
    }

    let repo = gix::discover(workspace)?;
    let Some(remote) = repo.find_default_remote(gix::remote::Direction::Push).transpose()? else {
        return Ok(PushOutcome::NoRemote);
    };

    let connection = remote
        .connect(gix::remote::Direction::Push)?
        .with_credentials(basic_auth_credentials(token));

    // TODO(this task): assemble and send the ref-update-request + pack per
    // Step 1's findings. Left unimplemented here rather than faked — see
    // this task's header note on why this is the plan's one genuinely
    // open primitive.
    let _ = connection;
    anyhow::bail!("push not yet implemented — see Task 5 Step 1's investigation notes")
}

#[tauri::command]
pub async fn push_notes(
    workspace: String,
    mode: RepoMode,
    allow_code_repo_push: bool,
    token: String,
) -> Result<PushOutcome, String> {
    tokio::task::spawn_blocking(move || checked_push(&workspace, mode, allow_code_repo_push, &token))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}
```

**This task cannot be marked complete with `checked_push` still `bail!`-ing.** The `anyhow::bail!` above is not this plan settling for a stub — it's the honest boundary of what could be verified via documentation lookup while writing the plan (per the writing-plans skill's no-fabricated-API rule). The executing agent's job for this task is to replace it with real wire-protocol code once Step 1's investigation lands, following whatever exact `gix_transport`/`gix_protocol` calls that investigation turns up, then write the tests in Step 3 against that real implementation.

- [ ] **Step 3: Write tests once the real implementation exists**

```rust
    #[test]
    fn pushes_new_commits_to_the_remote() {
        let origin = tempfile::tempdir().unwrap();
        git_init(origin.path());
        commit_file(origin.path(), "a.md", "# A\n", "notes: update a");
        // Bare, so it can receive a push (a non-bare origin would need
        // `receive.denyCurrentBranch` handling, which desktop's own push
        // path never has to deal with either — it always pushes to GitHub).
        assert!(Command::new("git").arg("clone").arg("--bare").arg(origin.path())
            .arg(origin.path().with_extension("bare")).status().unwrap().success());
        let bare = origin.path().with_extension("bare");
        let clone = tempfile::tempdir().unwrap();
        git_clone(&bare, clone.path());
        commit_file(clone.path(), "b.md", "# B\n", "notes: update b");

        let outcome = checked_push(&clone.path().to_string_lossy(), RepoMode::NotesOnly, false, "").unwrap();

        assert_eq!(outcome, PushOutcome::Pushed);
        let log = Command::new("git").arg("-C").arg(&bare).arg("log").arg("--oneline").arg("-n1").output().unwrap();
        assert!(String::from_utf8_lossy(&log.stdout).contains("notes: update b"));
    }

    #[test]
    fn no_remote_when_none_is_configured() {
        let tmp = tempfile::tempdir().unwrap();
        git_init(tmp.path());
        commit_file(tmp.path(), "a.md", "# A\n", "notes: update a");

        assert_eq!(
            checked_push(&tmp.path().to_string_lossy(), RepoMode::NotesOnly, false, "").unwrap(),
            PushOutcome::NoRemote
        );
    }

    #[test]
    fn refuses_a_code_repo_push_without_the_override() {
        let origin = tempfile::tempdir().unwrap();
        git_init(origin.path());
        commit_file(origin.path(), "a.md", "# A\n", "notes: update a");
        let clone = tempfile::tempdir().unwrap();
        git_clone(origin.path(), clone.path());

        let result = checked_push(&clone.path().to_string_lossy(), RepoMode::CodeRepo, false, "");

        assert!(result.is_err());
    }
```

- [ ] **Step 4: Run tests, iterate until they pass**

Run: `cargo test --lib commands::git_mobile:: --manifest-path src-tauri/Cargo.toml`.
Expected: PASS once Step 2's real implementation is in place. This is the task most likely to need several iterations against a real bare-repo fixture before the wire protocol details are right — that's expected for a from-scratch protocol implementation, not a sign something is wrong with the approach.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/git_mobile.rs
git commit -m "feat(mobile): implement push_notes via gix transport primitives"
git push
```

---

### Task 6: `rebase_onto_remote` via a tree-merge replay

**Files:**
- Modify: `src-tauri/src/commands/git_mobile.rs`.

**Interfaces:**
- Consumes: `unsafe_repo_state` (Task 2), tree-editing primitives (Task 3), `RebaseOutcome` (from `git.rs`).
- Produces: `pub fn checked_rebase_onto_remote(workspace: &str) -> anyhow::Result<RebaseOutcome>` and its `#[tauri::command] rebase_onto_remote` wrapper.

**Why this doesn't need `gix`'s (nonexistent) rebase support:** re-read desktop's own doc comment on `checked_rebase_onto_remote` — the frontend only ever calls this after `checked_pull`'s `Diverged` outcome has already confirmed the two sides touch disjoint files. A rebase of disjoint-file commits onto a new base produces the exact same resulting tree as a plain three-way merge would (no hunk overlaps to resolve either way) — the two differ only in resulting *history shape* (linear replay vs. a merge commit). Given no UI in this codebase renders per-commit rebase history specially (the frontend shows the tree state and `NoteHistoryEntry`'s per-note log, not a graph view), producing that tree via a single merge-style commit on top of the remote's HEAD (parents: `[upstream_id, local_head_id]`) is a deliberate, documented substitution for a true multi-commit rebase — not an attempt at one that happens to be simpler.

- [x] **Step 1: Write the failing tests**

```rust
    #[test]
    fn rebase_combines_disjoint_local_and_remote_changes() {
        let origin = tempfile::tempdir().unwrap();
        git_init(origin.path());
        commit_file(origin.path(), "shared.md", "base\n", "notes: update shared");
        let clone = tempfile::tempdir().unwrap();
        git_clone(origin.path(), clone.path());
        commit_file(origin.path(), "remote-only.md", "r\n", "notes: update remote-only");
        commit_file(clone.path(), "local-only.md", "l\n", "notes: update local-only");
        assert!(Command::new("git").arg("-C").arg(clone.path()).arg("fetch").status().unwrap().success());

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
```

- [x] **Step 2: Run tests to verify they fail**

Run: `cargo test --lib commands::git_mobile:: --manifest-path src-tauri/Cargo.toml`.
Expected: FAIL — `checked_rebase_onto_remote` doesn't exist.

- [x] **Step 3: Implement `checked_rebase_onto_remote`**

```rust
pub fn checked_rebase_onto_remote(workspace: &str) -> anyhow::Result<RebaseOutcome> {
    if let Some(state) = unsafe_repo_state(workspace)? {
        anyhow::bail!("refusing to rebase: {}", state.reason());
    }

    let repo = gix::discover(workspace)?;
    let head_id = repo.head_id()?.detach();
    let head_name = repo.head_name()?.ok_or_else(|| anyhow::anyhow!("HEAD is not a symbolic ref"))?;
    let upstream_id = repo
        .find_reference(&format!("refs/remotes/origin/{}", head_name.shorten()))?
        .into_fully_peeled_id()?
        .detach();

    let base = merge_base(&repo, head_id, upstream_id)?;
    let base_tree = repo.find_commit(base)?.tree_id()?.detach();
    let upstream_tree = repo.find_commit(upstream_id)?.tree_id()?.detach();
    let head_tree = repo.find_commit(head_id)?.tree_id()?.detach();

    // Three-way merge of trees, not blobs: base/upstream/head are each
    // whole-tree states, and since checked_pull's Diverged already
    // confirmed the changed paths are disjoint, every changed blob's
    // three-way merge is a fast-forward on one side — no real conflict
    // resolution logic is needed here, only combining the two edit sets.
    // `gix::merge::tree` (the whole-tree three-way merge, distinct from the
    // `gix::merge::blob` single-file driver referenced in this plan's
    // Cargo.toml feature research) is the primitive to confirm and use here
    // — check `gix::Repository::merge_trees` or `gix::merge::tree::apply`'s
    // current signature on docs.rs before finalizing this call.
    let merged_tree_id = repo.merge_trees(base_tree, head_tree, upstream_tree, Default::default(), Default::default())?
        .tree
        .write()?
        .detach();

    let message = format!("rebase (merged tree): local changes onto {}", head_name.shorten());
    let new_commit_id = repo.new_commit(&message, merged_tree_id, [upstream_id])?;

    repo.reference(
        head_name,
        new_commit_id.detach(),
        gix::refs::transaction::PreviousValue::MustExistAndMatch(head_id.into()),
        message,
    )?;
    checkout_head_tree(&repo)?;

    Ok(RebaseOutcome::Rebased)
}

#[tauri::command]
pub async fn rebase_onto_remote(workspace: String) -> Result<RebaseOutcome, String> {
    tokio::task::spawn_blocking(move || checked_rebase_onto_remote(&workspace))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `cargo test --lib commands::git_mobile:: --manifest-path src-tauri/Cargo.toml`.
Expected: PASS once `merge_trees`'s exact signature (or whatever the confirmed equivalent turns out to be — `Repository::merge_trees` is this plan's best-supported guess from the `gix::merge` feature research done for Cargo.toml, not a directly-confirmed method name) and `checkout_head_tree` (Task 4's known gap) are both filled in with real APIs.

- [x] **Step 5: Commit**

```bash
git add src-tauri/src/commands/git_mobile.rs
git commit -m "feat(mobile): implement rebase_onto_remote as a tree-merge replay via gix"
git push
```

---

### Task 7: Note history, read-at-commit, clone, and the two out-of-scope stubs

**Files:**
- Modify: `src-tauri/src/commands/git_mobile.rs`.
- Modify: `src-tauri/src/lib.rs` — flip the `git_impl` alias to the real cfg-gated version now that all 11 commands exist on both sides.

**Interfaces:**
- Consumes: `NoteHistoryEntry`, `GithubRepo`, `RepoInitOutcome` (from `git.rs`), `checked_pull`'s connection/credential pattern (Task 4, reused for clone).
- Produces: the remaining 5 command functions (`list_note_history`, `read_note_at_commit`, `clone_repo`, `init_notes_repo`, `list_github_repos`), completing mobile's 11-command surface.

- [x] **Step 1: Write the failing tests for history/read/clone**

```rust
    #[test]
    fn list_note_history_returns_commits_touching_the_path_newest_first() {
        let tmp = tempfile::tempdir().unwrap();
        git_init(tmp.path());
        commit_file(tmp.path(), "Todo.md", "- one\n", "notes: update Todo");
        commit_file(tmp.path(), "Todo.md", "- one\n- two\n", "notes: update Todo");

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
        let first_sha = list_note_history_at(&tmp.path().to_string_lossy(), &path).unwrap()[0].sha.clone();
        commit_file(tmp.path(), "Todo.md", "- one\n- two\n", "notes: update Todo");

        let content = read_note_at_commit_at(&tmp.path().to_string_lossy(), "Todo.md", &first_sha).unwrap();

        assert_eq!(content, "- one\n");
    }

    #[test]
    fn clone_repo_clones_into_the_derived_directory_name() {
        let origin = tempfile::tempdir().unwrap();
        git_init(origin.path());
        commit_file(origin.path(), "a.md", "# A\n", "notes: update a");
        let parent = tempfile::tempdir().unwrap();

        let dest = checked_clone_repo(&origin.path().to_string_lossy(), &parent.path().to_string_lossy(), "").unwrap();

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
```

- [x] **Step 2: Run tests to verify they fail**

Run: `cargo test --lib commands::git_mobile:: --manifest-path src-tauri/Cargo.toml`.
Expected: FAIL — none of these five functions exist yet.

- [x] **Step 3: Implement note history and read-at-commit**

```rust
/// `--follow`'s rename-tracking has no single documented gix equivalent to
/// confirm here — this walks commits touching the note's *current* path
/// only (a real, if narrower, difference from desktop's rename-following
/// history, worth flagging to the frontend maintainer rather than silently
/// shipping degraded behavior for renamed notes on mobile specifically).
pub fn list_note_history_at(workspace: &str, note_path: &str) -> anyhow::Result<Vec<NoteHistoryEntry>> {
    let repo = gix::discover(workspace)?;
    let workdir = repo.workdir().ok_or_else(|| anyhow::anyhow!("bare repo"))?;
    let repo_relative = Path::new(note_path)
        .strip_prefix(workdir)
        .unwrap_or_else(|_| Path::new(note_path))
        .to_string_lossy()
        .replace('\\', "/");

    let head_id = repo.head_id()?.detach();
    let mut entries = Vec::new();
    for info in repo.rev_walk([head_id]).all()?.take(super::git::NOTE_HISTORY_LIMIT * 4) {
        let info = info?;
        let commit = info.object()?;
        let tree = commit.tree()?;
        if tree.lookup_entry_by_path(&repo_relative)?.is_none() {
            continue;
        }
        // Only entries where this path's blob actually changed vs. every
        // parent count as "touching" it, matching git log's default
        // (non---follow) path-filter semantics.
        let changed = commit.parent_ids().next().map_or(Ok(true), |parent_id| {
            let parent_tree = repo.find_commit(parent_id.detach())?.tree()?;
            let before = parent_tree.lookup_entry_by_path(&repo_relative)?.map(|e| e.object_id());
            let after = tree.lookup_entry_by_path(&repo_relative)?.map(|e| e.object_id());
            Ok::<_, anyhow::Error>(before != after)
        })?;
        if !changed {
            continue;
        }
        entries.push(NoteHistoryEntry {
            sha: commit.id().to_string(),
            timestamp_ms: commit.time()?.seconds * 1000,
            message: commit.message()?.title.to_string(),
            path: repo_relative.clone(),
        });
        if entries.len() >= super::git::NOTE_HISTORY_LIMIT {
            break;
        }
    }
    Ok(entries)
}

#[tauri::command]
pub async fn list_note_history(workspace: String, note_path: String) -> Result<Vec<NoteHistoryEntry>, String> {
    tokio::task::spawn_blocking(move || list_note_history_at(&workspace, &note_path))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

pub fn read_note_at_commit_at(workspace: &str, relative_path: &str, sha: &str) -> anyhow::Result<String> {
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

#[tauri::command]
pub async fn read_note_at_commit(workspace: String, relative_path: String, sha: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || read_note_at_commit_at(&workspace, &relative_path, &sha))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}
```

Bump `NOTE_HISTORY_LIMIT` in `git.rs` from a private-by-default `pub const` (it's already `pub const NOTE_HISTORY_LIMIT: usize = 20;` — no change needed there) — just add it to `git_mobile.rs`'s `use super::git::{...}` import list.

- [x] **Step 4: Implement clone and the two stubs**

```rust
/// Clone via fetch into a freshly `gix::init`-ed repo, rather than a
/// dedicated "clone" call — this is the documented gix pattern for cloning
/// (init empty + fetch + set remote), since `gix::discover`/`gix::open`
/// don't clone and there's no evidence from this plan's docs.rs research of
/// a single `gix::clone` convenience function distinct from that pattern.
pub fn checked_clone_repo(url: &str, parent_dir: &str, token: &str) -> anyhow::Result<PathBuf> {
    if url.starts_with('-') {
        anyhow::bail!("refusing suspicious repository URL: {url}");
    }
    let dir_name = super::git::derive_clone_dir_name(url);
    if dir_name.is_empty() || dir_name.starts_with('-') {
        anyhow::bail!("could not determine a folder name from {url}");
    }
    let dest = Path::new(parent_dir).join(dir_name);
    std::fs::create_dir(&dest)?;

    let repo = gix::init(&dest)?;
    let remote = repo.remote_at(url)?.with_fetch_tags(gix::remote::fetch::Tags::All);
    let connection = remote
        .connect(gix::remote::Direction::Fetch)?
        .with_credentials(basic_auth_credentials(token));
    connection
        .prepare_fetch(gix::progress::Discard, Default::default())?
        .receive(gix::progress::Discard, &Default::default())?;
    checkout_head_tree(&repo)?;

    Ok(dest)
}

#[tauri::command]
pub async fn clone_repo(url: String, parent_dir: String, token: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || checked_clone_repo(&url, &parent_dir, &token))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
        .map(|p| p.to_string_lossy().into_owned())
}

/// Out of mobile v1 scope (spec, "Out of scope (v1)": no fresh-workspace
/// creation from mobile). Mobile onboarding never offers the button that
/// would call this — kept registered rather than omitted so a stray call
/// (e.g. before the onboarding UI plan lands its `Platform.isMobile`
/// gating) fails loudly instead of the command simply not existing.
pub fn checked_init_notes_repo() -> anyhow::Result<RepoInitOutcome> {
    anyhow::bail!("starting a new workspace from mobile is not supported — join an existing Git-backed workspace instead")
}

#[tauri::command]
pub async fn init_notes_repo(_workspace: String, _create_github_remote: bool) -> Result<RepoInitOutcome, String> {
    checked_init_notes_repo().map_err(|e| e.to_string())
}

/// Out of mobile v1 scope (spec, Credentials: "Mobile onboarding skips the
/// picker — the user pastes a repository URL directly"). Returns the exact
/// same error text desktop already produces when `gh` isn't installed, so
/// any shared frontend fallback path (Settings/onboarding UI) that already
/// handles "no gh" on desktop handles this identically on mobile with zero
/// new UI code.
pub fn list_own_github_repos() -> anyhow::Result<Vec<GithubRepo>> {
    anyhow::bail!("gh not available")
}

#[tauri::command]
pub async fn list_github_repos() -> Result<Vec<GithubRepo>, String> {
    list_own_github_repos().map_err(|e| e.to_string())
}
```

Bump `derive_clone_dir_name` in `git.rs` to `pub(crate)` (same visibility-only rule as Task 1/3).

- [x] **Step 5: Run tests to verify they pass**

Run: `cargo test --lib commands::git_mobile:: --manifest-path src-tauri/Cargo.toml`.
Expected: PASS, once `checkout_head_tree` (Task 4's flagged gap) has a real implementation — `clone_repo`'s test depends on it same as `checked_pull`'s fast-forward path did.

- [x] **Step 6: Flip the `git_impl` alias to the real cfg-gated version**

In `src-tauri/src/lib.rs`, change:
```rust
use commands::git as git_impl;
```
to:
```rust
#[cfg(not(target_os = "ios"))]
use commands::git as git_impl;
#[cfg(target_os = "ios")]
use commands::git_mobile as git_impl;
```

Update the four command signatures whose mobile version gained a `token: String` parameter (`fetch_and_compare`, `push_notes`, `clone_repo`) so `generate_handler!`'s macro-generated dispatch still type-checks per platform — since `generate_handler!` only sees whichever module `git_impl` resolves to for a given compile, this requires no change to the macro invocation itself, only confirming (via `cargo check --target aarch64-apple-ios-sim`) that the iOS build's `git_impl::fetch_and_compare` etc. match the 3-arg mobile signatures and the Windows build's match desktop's 1-arg ones — each platform only ever compiles one side, so this is a compile-time check, not a runtime one.

- [x] **Step 7: Verify both platforms build clean**

```bash
cd src-tauri
cargo build          # Windows desktop
cargo clippy -- -D warnings
cargo fmt --check
cargo test --lib commands::git:: commands::git_mobile::
```
Then via CI for the iOS side:
```bash
git add -A
git commit -m "feat(mobile): complete git_mobile.rs's 11-command surface and flip the dispatch alias"
git push
gh workflow run ios-scaffold.yml
gh run watch --exit-status
```
Expected: PASS on both — `cargo check (iOS)`/`cargo clippy (iOS)` now compile the real `git_impl = git_mobile` path for the iOS target, and `cargo test (git_mobile, native macOS)` runs the full test suite built across Tasks 1–7.

- [x] **Step 8: Commit**

(Combined with Step 7's commit above — this task's file changes and the alias flip land together since the alias flip is only meaningful once all 11 commands exist.)

---

## Out of scope (this plan)

- **Where the HTTPS token comes from** (iOS Keychain storage, onboarding UI to collect it) — a separate, later plan per the spec's Onboarding section. This plan's commands accept `token: &str`/`String` and use it; nothing here decides how the frontend obtains it.
- **App-shell UI reflow and `Platform.isMobile` toolbar gating** — separate, later plans per the spec's own decomposition (UI section; Feature cuts section).
- **The pdfium iOS spike** — separate, already-called-out spike in the spec's Engineering Risk section, unrelated to git.
- **Git LFS on mobile.** Desktop's `checked_init_notes_repo` wires up LFS tracking for PDF/asset sidecars via the `git` CLI's `git lfs` subcommand — another subprocess call iOS forbids, and `gix` has no LFS support to substitute. Moot for v1 regardless, since `init_notes_repo` itself is out of mobile scope (Task 7).
- **Rename-tracking in mobile's note history** (Task 7's `list_note_history_at` doesn't follow renames the way desktop's `--follow` does) — flagged in that task's doc comment as a known, real behavior gap rather than fixed here; revisit if it proves to matter in practice.

---

## Result

Tasks 1–4, 6, and 7 landed as planned: `git_mobile.rs` has real, gix-backed, unit-tested implementations of `detect_repo`, `detect_prior_automation`, `auto_commit`, `unsafe_repo_state`, `fetch_and_compare`, `rebase_onto_remote`, `list_note_history`, `read_note_at_commit`, and `clone_repo`, plus the two out-of-scope stubs (`init_notes_repo`, `list_github_repos`). All 11 `#[tauri::command]` wrappers are in place, `lib.rs`'s `git_impl` alias picks the right module per platform, and desktop (`git.rs`) is untouched behavior-wise. 85 tests pass (61 desktop + 24 mobile); final green CI run: https://github.com/TorresVisual/null-notes/actions/runs/34839161409 (`cargo check`/`clippy` for `aarch64-apple-ios-sim`, native macOS `cargo test`, desktop build/clippy/fmt, and the iOS Simulator smoke test all passed).

**Task 5 (`push_notes`) is deferred**, by explicit decision after confirming `gix` genuinely has no reviewed send-pack support at any version, including 0.87.1 (see Task 5's own note). `checked_push` implements and tests the two checks that don't need it; the real wire-protocol implementation is left for a dedicated follow-up plan.

**Two real gaps found only by running the plan, not visible from the API docs alone**, both fixed during execution:

1. `#[tauri::command]` expands to a crate-global helper macro keyed only on the Rust function name — `git.rs` and `git_mobile.rs` defining same-named commands collided the moment both compiled for one target, regardless of which `generate_handler!` actually registered. Fixed by deferring all of `git_mobile.rs`'s Tauri wrappers to Task 7, landing them atomically alongside `git.rs`'s matching `#[cfg(not(target_os = "ios"))]` gate and the `lib.rs` alias flip, instead of the incremental per-task wrapper rollout Tasks 1–6 originally called for.
2. A CI runner (and, by the same logic, a fresh iOS install) has no git identity configured anywhere — unlike a dev machine's inherited `~/.gitconfig`. `checked_clone_repo`'s ref writes need a committer for their reflog entries; a freshly cloned repo now gets a synthetic local identity when none is configured, verified by reproducing the failure locally (`GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null`) before and after the fix.

Known follow-ups for later plans: Task 5's real push implementation; wiring a real HTTPS token from iOS Keychain into the three commands that now accept one; `list_note_history_at`'s rename-tracking gap.

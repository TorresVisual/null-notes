# Versioned Workspaces / Git Automation (P5-2…P5-5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (default) or superpowers:subagent-driven-development if explicitly requested.

**Goal:** Batch note changes into coarse, safe auto-commits; push them only where that's safe (never a code repo); fast-forward-pull on workspace open without ever writing a conflict marker; and let a plain notes folder become a private GitHub-backed repo in one action. Closes M5: *"my notes commit themselves, in both kinds of repo."*

**Architecture:** All new logic shells out to `git` (never `git2`/`gix`, per P5-1's own precedent) from `src-tauri/src/commands/git.rs`, run inside `tokio::task::spawn_blocking` since `git` is synchronous. Every mutating command is pathspec-scoped to note paths and structurally forbidden from touching anything else. The frontend tracks which note paths changed during a session (a small addition to `useNote`'s save path), and a new idle-timer hook fires a batched commit — never per-save. Auto-pull reuses the *existing* P0-5 watcher and P0-5/`useNote` conflict machinery for the resulting file changes; this plan adds no new file-reload logic.

**Tech Stack:** Rust (`std::process::Command`, `tokio::task::spawn_blocking`, no new Cargo dependencies), React + Zustand.

**Spec:** `docs/ROADMAP.md` §"Phase 5 — Versioned Workspaces / Git Automation (P5)" (P5-2 through P5-5), cross-cutting rules in ROADMAP.md §5 ("External process launching", "Don't touch what you didn't create"). This is the authoritative spec — `TODO.md`'s P5 section holds the same content as a checklist.

## Global Constraints

- **Shell out to `git`, never link `git2`/`gix`** — inherits credential helpers, SSH agent, signing, `.gitconfig` for free (ROADMAP.md §Phase 5).
- **Always pathspec-scoped.** Every mutating command ends in `-- <paths>`; never `git add -A`, never a bare `git commit`.
- **Back off, never repair.** A repo that's mid-rebase/merge/cherry-pick, on a detached HEAD, or carrying unresolved conflicts gets skipped quietly — never fixed.
- **Hooks run by default; abort the commit on failure.** No silent `--no-verify` unless the per-workspace `skipHooks` toggle is on.
- **Code repo never auto-pushes, at any setting** — enforced in the Rust layer itself, not only in the UI that calls it.
- **Fast-forward-only, permanently.** `git merge --ff-only`, never `reset --hard`, never a real 3-way merge, never a rebase. Diverged history stops and reports counts; the user resolves it in their own tool.
- **No new file-reload logic.** A pull's resulting file burst is an ordinary external change — P0-5's watcher and `useNote`'s existing dirty/clean handling already cover it (see P3-4, which traced this exact `git pull` path).
- All Tauri commands return `Result<T, String>`; internal functions return `anyhow::Result<T>`, matching every other file under `commands/`.
- `cargo clippy -- -D warnings`, `npm run typecheck`, `npm test` stay green after every task.

---

## File Map

| File | Responsibility |
|---|---|
| `src-tauri/src/models.rs` | Extend `GitWorkspaceConfig` with `idleMinutes`, `skipHooks`, `autoPush` |
| `src-tauri/src/commands/git.rs` | `unsafe_repo_state`, `auto_commit`, `push_notes`, `fetch_and_compare`, `init_notes_repo` |
| `src-tauri/src/lib.rs` | Register the four new commands |
| `src/types/index.ts` | `GitWorkspaceConfig` fields, `CommitOutcome`, `PushOutcome`, `PullOutcome`, `RepoInitOutcome`, `GitCommitStatus` |
| `src/lib/tauri.ts` | `api.git.autoCommit/pushNotes/fetchAndCompare/initNotesRepo` |
| `src/store/workspace.ts` | `gitPendingPaths`, `gitCommitStatus`, `gitDiverged` + setters |
| `src/hooks/useNote.ts` | Record a path into `gitPendingPaths` after a successful save |
| `src/hooks/useGitAutoCommit.ts` (new) | Idle-timer batching + flush-on-close |
| `src/hooks/useGitAutoPull.ts` (new) | Fetch/compare on workspace open |
| `src/components/GitCommitStatus.tsx` (new) | Small status badge next to `SaveStatus` |
| `src/components/GitDivergedBar.tsx` (new) | Diverged-history notice, reuses `.conflict-bar` styling |
| `src/components/Layout.tsx` | Wire the two new hooks + two new status components |
| `src/components/SettingsPanel.tsx` | Idle minutes, skip hooks, auto-push, "Initialize Git repo" rows |

---

### Task 1: Extend `GitWorkspaceConfig`

**Files:**
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/commands/workspace.rs` (existing tests reference `GitWorkspaceConfig`)
- Modify: `src/types/index.ts`
- Modify: `src/store/workspace.ts` (`DEFAULT_GIT_CONFIG`)
- Modify: `src/store/workspace.test.ts`, `src/hooks/useGitConfig.test.ts` (existing `git: {...}` fixtures gain the new required fields)

**Interfaces:**
- Consumes: nothing new.
- Produces: `GitWorkspaceConfig { prompted: bool, auto_commit: bool, idle_minutes: u32, skip_hooks: bool, auto_push: bool }` (Rust) / `{ prompted, autoCommit, idleMinutes, skipHooks, autoPush }` (TS) — every later task reads these off `useWorkspaceStore.getState().git`.

- [ ] **Step 1: Write the failing Rust test**

Add to `src-tauri/src/commands/workspace.rs`'s `#[cfg(test)] mod tests`:

```rust
    // idle_minutes/skip_hooks/auto_push are P5-2/P5-3 fields, added after
    // prompted/auto_commit shipped — a file written by that earlier build
    // has none of them and must still load with sane defaults, not zeros.
    #[tokio::test]
    async fn test_load_legacy_file_without_p5_2_git_fields() {
        let dir = tempdir().unwrap();
        tokio::fs::write(
            dir.path().join(".workspace.json"),
            r#"{"openTabs":[],"activeTab":null,"git":{"prompted":true,"autoCommit":true}}"#,
        )
        .await
        .unwrap();

        let state = load_workspace_from_dir(&dir.path().to_string_lossy())
            .await
            .unwrap();

        assert!(state.git.prompted);
        assert!(state.git.auto_commit);
        assert_eq!(state.git.idle_minutes, 10);
        assert!(!state.git.skip_hooks);
        assert!(state.git.auto_push);
    }
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cargo test test_load_legacy_file_without_p5_2_git_fields`
Expected: FAIL — `GitWorkspaceConfig` has no `idle_minutes`/`skip_hooks`/`auto_push` fields yet.

- [ ] **Step 3: Add the fields**

In `src-tauri/src/models.rs`, replace the `GitWorkspaceConfig` struct (it currently derives `Default`, which would give `idle_minutes: 0` and `auto_push: false` — wrong for a *freshly created* config, not just a legacy load, so `Default` becomes a manual impl matching the serde defaults, the same pattern `AppSettings` already uses):

```rust
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
    /// Push after each auto-commit. Only ever consulted for a
    /// `RepoMode::NotesOnly` workspace — a `CodeRepo` workspace never
    /// pushes, at any setting (P5-3, enforced in `git.rs` itself).
    #[serde(default = "default_auto_push")]
    pub auto_push: bool,
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
        }
    }
}
```

- [ ] **Step 4: Fix the now-broken existing test**

`test_git_config_roundtrips` in `workspace.rs` constructs `GitWorkspaceConfig { prompted: true, auto_commit: true, ..Default::default() }` already (via struct-update syntax) — check it still compiles as-is; if it constructs all fields explicitly instead, add the three new ones. Run `cargo test git_config` and confirm both roundtrip tests and the new legacy-load test pass.

- [ ] **Step 5: Run the full Rust suite**

Run: `cargo test`
Expected: PASS, including `test_load_legacy_file_without_p5_2_git_fields`.

- [ ] **Step 6: Update the TypeScript type**

In `src/types/index.ts`:

```ts
export interface GitWorkspaceConfig {
  /** Whether the one-time "enable auto-commit?" prompt has been answered. */
  prompted: boolean
  autoCommit: boolean
  /** Minutes of no note activity before a pending batch is committed. */
  idleMinutes: number
  /** Per-workspace opt-out of running commit hooks on an auto-commit. */
  skipHooks: boolean
  /** Push after each auto-commit — only consulted when repoMode is 'notesOnly'. */
  autoPush: boolean
}
```

- [ ] **Step 7: Update `DEFAULT_GIT_CONFIG` and the existing test fixtures**

In `src/store/workspace.ts`:

```ts
const DEFAULT_GIT_CONFIG: GitWorkspaceConfig = {
  prompted: false,
  autoCommit: false,
  idleMinutes: 10,
  skipHooks: false,
  autoPush: true,
}
```

In `src/store/workspace.test.ts`'s `reset()` and `src/hooks/useGitConfig.test.ts`'s `beforeEach`/inline `setState` calls, change every `git: { prompted: false, autoCommit: false }` (and the `autoCommit: true` variant) to spread `DEFAULT_GIT_CONFIG` or list all five fields explicitly — TypeScript now requires them.

- [ ] **Step 8: Run the frontend suite**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/models.rs src-tauri/src/commands/workspace.rs src/types/index.ts src/store/workspace.ts src/store/workspace.test.ts src/hooks/useGitConfig.test.ts
git commit -m "feat(p5-2): add idleMinutes/skipHooks/autoPush to GitWorkspaceConfig"
```

---

### Task 2: Unsafe repo-state detection

**Files:**
- Modify: `src-tauri/src/commands/git.rs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `pub enum UnsafeRepoState { DetachedHead, MergeInProgress, CherryPickInProgress, RebaseInProgress, UnresolvedConflicts }` with `.reason() -> &'static str`; `pub fn unsafe_repo_state(workspace: &str) -> anyhow::Result<Option<UnsafeRepoState>>` — consumed by Task 3's `checked_auto_commit`.

- [ ] **Step 1: Write the failing tests**

Add to `git.rs`'s existing `#[cfg(test)] mod tests`:

```rust
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

    #[test]
    fn unresolved_conflicts_are_unsafe() {
        let tmp = tempdir().unwrap();
        git_init(tmp.path());
        commit_file(tmp.path(), "a.md", "base\n");

        Command::new("git").arg("-C").arg(tmp.path()).arg("checkout").arg("-b").arg("other").status().unwrap();
        commit_file(tmp.path(), "a.md", "other\n");
        Command::new("git").arg("-C").arg(tmp.path()).arg("checkout").arg("master").status().unwrap();
        commit_file(tmp.path(), "a.md", "mine\n");
        // Expected to fail with a real conflict — that's the point.
        let _ = Command::new("git").arg("-C").arg(tmp.path()).arg("merge").arg("other").status();

        assert_eq!(
            unsafe_repo_state(&tmp.path().to_string_lossy()).unwrap(),
            Some(UnsafeRepoState::UnresolvedConflicts)
        );
    }
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `cargo test --lib commands::git`
Expected: FAIL — `unsafe_repo_state` and `UnsafeRepoState` don't exist yet.

- [ ] **Step 3: Implement the detection**

Add to `git.rs` above the `#[cfg(test)]` block, after the existing `detect_repo_mode`:

```rust
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
```

Add `use std::path::PathBuf;` to the existing `use std::path::Path;` import line.

- [ ] **Step 4: Run the tests**

Run: `cargo test --lib commands::git`
Expected: PASS, all six new tests plus the four existing P5-1 ones.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/git.rs
git commit -m "feat(p5-2): detect unsafe repo states before an auto-commit"
```

---

### Task 3: `checked_auto_commit` + the `auto_commit` command

**Files:**
- Modify: `src-tauri/src/commands/git.rs`

**Interfaces:**
- Consumes: `unsafe_repo_state` (Task 2).
- Produces: `pub enum CommitOutcome { Committed, Skipped { reason: String }, NothingToCommit, HookFailed { output: String } }` (Serialize/Deserialize, `#[serde(tag = "kind", rename_all = "camelCase")]`); `pub fn checked_auto_commit(workspace: &str, paths: &[String], skip_hooks: bool) -> anyhow::Result<CommitOutcome>`; `#[tauri::command] pub async fn auto_commit(workspace: String, paths: Vec<String>, skip_hooks: bool) -> Result<CommitOutcome, String>` — consumed by Task 4's registration and Task 5's frontend hook.

- [ ] **Step 1: Write the failing tests**

Add to `git.rs`'s test module:

```rust
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
        Command::new("git").arg("-C").arg(tmp.path()).arg("add").arg("src.rs").status().unwrap();
        std::fs::write(tmp.path().join("note.md"), "# Note\nmore\n").unwrap();
        // An unstaged edit to a *second* source file the notes commit never touches.
        std::fs::write(tmp.path().join("src.rs"), "fn main() { staged() } // unstaged\n").unwrap();

        let staged_before = Command::new("git")
            .arg("-C").arg(tmp.path()).arg("diff").arg("--cached").arg("--name-only")
            .output().unwrap();
        let unstaged_before = Command::new("git")
            .arg("-C").arg(tmp.path()).arg("diff").arg("--name-only")
            .output().unwrap();

        let outcome = checked_auto_commit(
            &tmp.path().to_string_lossy(),
            &["note.md".to_string()],
            false,
        ).unwrap();

        assert_eq!(outcome, CommitOutcome::Committed);

        let staged_after = Command::new("git")
            .arg("-C").arg(tmp.path()).arg("diff").arg("--cached").arg("--name-only")
            .output().unwrap();
        let unstaged_after = Command::new("git")
            .arg("-C").arg(tmp.path()).arg("diff").arg("--name-only")
            .output().unwrap();
        assert_eq!(staged_before.stdout, staged_after.stdout, "staged source changes must be untouched");
        assert_eq!(unstaged_before.stdout, unstaged_after.stdout, "unstaged source changes must be untouched");

        let last_commit_files = Command::new("git")
            .arg("-C").arg(tmp.path()).arg("show").arg("--stat").arg("--format=").arg("HEAD")
            .output().unwrap();
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
        ).unwrap();

        assert_eq!(outcome, CommitOutcome::NothingToCommit);
    }

    #[test]
    fn a_failing_hook_aborts_the_commit() {
        let tmp = tempdir().unwrap();
        git_init(tmp.path());
        commit_file(tmp.path(), "note.md", "# Note\n");
        write_failing_pre_commit_hook(tmp.path());
        std::fs::write(tmp.path().join("note.md"), "# Note\nchanged\n").unwrap();

        let before = Command::new("git").arg("-C").arg(tmp.path()).arg("rev-list").arg("--count").arg("HEAD")
            .output().unwrap();

        let outcome = checked_auto_commit(
            &tmp.path().to_string_lossy(),
            &["note.md".to_string()],
            false,
        ).unwrap();

        assert!(matches!(outcome, CommitOutcome::HookFailed { .. }));
        let after = Command::new("git").arg("-C").arg(tmp.path()).arg("rev-list").arg("--count").arg("HEAD")
            .output().unwrap();
        assert_eq!(before.stdout, after.stdout, "a failed hook must not leave a commit behind");
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
        ).unwrap();

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
        ).unwrap();

        assert_eq!(outcome, CommitOutcome::Skipped { reason: "a rebase is in progress".to_string() });
    }
```

> `skip_hooks_bypasses_a_failing_hook` is `#[cfg(unix)]`-only because the executable-bit dance that makes the fake hook actually block a commit is POSIX-specific; on Windows the equivalent (a `.cmd`/`.bat` hook via `core.hooksPath` trickery) isn't worth the added complexity for one test — `a_failing_hook_aborts_the_commit` already proves hooks run and block by default, and `skip_hooks` is a one-line `--no-verify` conditional that this project's Windows-primary CI still exercises indirectly through clippy/typecheck on every commit.

- [ ] **Step 2: Run tests to confirm they fail**

Run: `cargo test --lib commands::git`
Expected: FAIL — `checked_auto_commit` and `CommitOutcome` don't exist yet.

- [ ] **Step 3: Implement**

Add to `git.rs`, above `#[cfg(test)]`:

```rust
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
        .arg("-C").arg(workspace)
        .arg("status").arg("--porcelain").arg("--")
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
        return Ok(CommitOutcome::Skipped { reason: state.reason().to_string() });
    }
    if !has_pending_changes(workspace, paths)? {
        return Ok(CommitOutcome::NothingToCommit);
    }

    let add_status = Command::new("git")
        .arg("-C").arg(workspace)
        .arg("add").arg("--")
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
```

Add `use serde::{Deserialize, Serialize};` to `git.rs`'s imports.

- [ ] **Step 4: Run the tests**

Run: `cargo test --lib commands::git`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/git.rs
git commit -m "feat(p5-2): pathspec-scoped batched auto-commit with hook handling"
```

---

### Task 4: Register `auto_commit`, wire the API layer, track changed paths

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/types/index.ts`
- Modify: `src/lib/tauri.ts`
- Modify: `src/store/workspace.ts`
- Modify: `src/store/workspace.test.ts`
- Modify: `src/hooks/useNote.ts`
- Test: `src/hooks/useNote.test.ts` (existing file — add one case)

**Interfaces:**
- Consumes: `commands::git::auto_commit` (Task 3).
- Produces: `useWorkspaceStore.getState().gitPendingPaths: string[]`, `.addGitPendingPath(path: string)`, `.clearGitPendingPaths()` — consumed by Task 5's `useGitAutoCommit`. `api.git.autoCommit(workspace, paths, skipHooks) => Promise<CommitOutcome>`.

- [ ] **Step 1: Register the command**

In `src-tauri/src/lib.rs`, add `commands::git::auto_commit,` to the `invoke_handler` list, right after `commands::git::detect_repo,`.

- [ ] **Step 2: Add the TS type and API call**

In `src/types/index.ts`:

```ts
export type CommitOutcome =
  | { kind: 'committed' }
  | { kind: 'skipped'; reason: string }
  | { kind: 'nothingToCommit' }
  | { kind: 'hookFailed'; output: string }
```

In `src/lib/tauri.ts`, extend the `git` section and its import line:

```ts
import type { NoteMetadata, WorkspaceState, WorkspaceTree, SearchResult, AppSettings, GraphLink, GraphTag, RepoMode, CommitOutcome } from '../types'
```

```ts
  git: {
    detectRepo: (workspace: string) =>
      invoke<RepoMode | null>('detect_repo', { workspace }),
    autoCommit: (workspace: string, paths: string[], skipHooks: boolean) =>
      invoke<CommitOutcome>('auto_commit', { workspace, paths, skipHooks }),
  },
```

- [ ] **Step 3: Write the failing store test**

Add to `src/store/workspace.test.ts`:

```ts
  it('addGitPendingPath dedupes', () => {
    useWorkspaceStore.getState().addGitPendingPath('/ws/a.md')
    useWorkspaceStore.getState().addGitPendingPath('/ws/a.md')
    useWorkspaceStore.getState().addGitPendingPath('/ws/b.md')
    expect(useWorkspaceStore.getState().gitPendingPaths).toEqual(['/ws/a.md', '/ws/b.md'])
  })

  it('clearGitPendingPaths empties the list', () => {
    useWorkspaceStore.getState().addGitPendingPath('/ws/a.md')
    useWorkspaceStore.getState().clearGitPendingPaths()
    expect(useWorkspaceStore.getState().gitPendingPaths).toEqual([])
  })
```

Also add `gitPendingPaths: []` to the `reset()` fixture at the top of the file.

- [ ] **Step 4: Run to confirm it fails**

Run: `npm test -- workspace.test`
Expected: FAIL — `addGitPendingPath` doesn't exist.

- [ ] **Step 5: Implement in the store**

In `src/store/workspace.ts`, add to the `WorkspaceStore` interface:

```ts
  // P5-2: paths saved since the last auto-commit, deduplicated, in save
  // order — what the next batched commit will touch.
  gitPendingPaths: string[]
  addGitPendingPath: (path: string) => void
  clearGitPendingPaths: () => void
```

Add to the store body:

```ts
  gitPendingPaths: [],

  addGitPendingPath: (path) => {
    const { gitPendingPaths } = get()
    if (gitPendingPaths.includes(path)) return
    set({ gitPendingPaths: [...gitPendingPaths, path] })
  },
  clearGitPendingPaths: () => set({ gitPendingPaths: [] }),
```

Add `gitPendingPaths: [],` to `resetForNewWorkspace`'s object and initial state.

- [ ] **Step 6: Run the store test**

Run: `npm test -- workspace.test`
Expected: PASS.

- [ ] **Step 7: Wire `useNote`'s save path**

In `src/hooks/useNote.ts`, inside `flushSave`, after `await api.notes.save(job.path, job.content)` succeeds (before `lastWritten.current = job.content`), add:

```ts
      useWorkspaceStore.getState().addGitPendingPath(job.path)
```

- [ ] **Step 8: Write the failing hook test**

In `src/hooks/useNote.test.ts`, find the existing test that asserts a successful save (search for `api.notes.save` being awaited) and add a new case near it:

```ts
  it('records the saved path for auto-commit batching', async () => {
    notes.save.mockResolvedValue(undefined)
    notes.open.mockResolvedValue('')
    useWorkspaceStore.setState({ path: '/ws', gitPendingPaths: [] })
    const { result } = renderHook(() => useNote('/ws/a.md'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    result.current.save('new content')
    await act(() => vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS))

    expect(useWorkspaceStore.getState().gitPendingPaths).toContain('/ws/a.md')
  })
```

Match this test's exact imports/mocking style (`vi.mock('../lib/tauri', ...)`, fake timers) to whatever the surrounding tests in the file already use — read the file's existing setup before adding this case rather than assuming the shape above verbatim.

- [ ] **Step 9: Run to confirm it fails, then implement, then confirm it passes**

Run: `npm test -- useNote.test` — FAIL, then apply Step 7's one-line change, then re-run — PASS.

- [ ] **Step 10: Full frontend check**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src-tauri/src/lib.rs src/types/index.ts src/lib/tauri.ts src/store/workspace.ts src/store/workspace.test.ts src/hooks/useNote.ts src/hooks/useNote.test.ts
git commit -m "feat(p5-2): register auto_commit and track changed note paths per session"
```

---

### Task 5: `useGitAutoCommit` — idle-timer batching

**Files:**
- Create: `src/hooks/useGitAutoCommit.ts`
- Test: `src/hooks/useGitAutoCommit.test.ts`
- Modify: `src/components/Layout.tsx`

**Interfaces:**
- Consumes: `api.git.autoCommit`, `gitPendingPaths`/`addGitPendingPath`/`clearGitPendingPaths` (Task 4), `useWorkspaceStore.getState().git.{autoCommit,idleMinutes,skipHooks}` (Task 1).
- Produces: `useGitAutoCommit() => { flushGitCommit: () => Promise<void> }` — `flushGitCommit` consumed by Layout's `close-requested` handler (Task 6 also reads the `gitCommitStatus` this sets, added in this task).

- [ ] **Step 1: Add `gitCommitStatus` to the store first (small, no separate task)**

In `src/types/index.ts`:

```ts
export type GitCommitStatus = 'idle' | 'committing' | 'committed' | 'skipped' | 'error'
```

In `src/store/workspace.ts`, add to the interface and body:

```ts
  gitCommitStatus: GitCommitStatus
  setGitCommitStatus: (status: GitCommitStatus) => void
```
```ts
  gitCommitStatus: 'idle',
  setGitCommitStatus: (status) => set({ gitCommitStatus: status }),
```

Add `gitCommitStatus: 'idle',` to `resetForNewWorkspace` and to `workspace.test.ts`'s `reset()` fixture.

- [ ] **Step 2: Write the failing hook test**

Create `src/hooks/useGitAutoCommit.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useGitAutoCommit } from './useGitAutoCommit'
import { useWorkspaceStore } from '../store/workspace'
import { api } from '../lib/tauri'

vi.mock('../lib/tauri', () => ({
  api: { git: { autoCommit: vi.fn() } },
}))

const git = vi.mocked(api.git)

describe('useGitAutoCommit', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useWorkspaceStore.setState({
      path: '/ws',
      repoMode: 'notesOnly',
      git: { prompted: true, autoCommit: true, idleMinutes: 10, skipHooks: false, autoPush: false },
      gitPendingPaths: [],
      gitCommitStatus: 'idle',
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('commits after the configured idle window, not immediately', async () => {
    git.autoCommit.mockResolvedValue({ kind: 'committed' })
    renderHook(() => useGitAutoCommit())

    useWorkspaceStore.getState().addGitPendingPath('/ws/a.md')
    await act(() => vi.advanceTimersByTimeAsync(9 * 60_000))
    expect(git.autoCommit).not.toHaveBeenCalled()

    await act(() => vi.advanceTimersByTimeAsync(1 * 60_000))
    expect(git.autoCommit).toHaveBeenCalledWith('/ws', ['/ws/a.md'], false)
  })

  it('clears pending paths and sets status after a successful commit', async () => {
    git.autoCommit.mockResolvedValue({ kind: 'committed' })
    renderHook(() => useGitAutoCommit())

    useWorkspaceStore.getState().addGitPendingPath('/ws/a.md')
    await act(() => vi.advanceTimersByTimeAsync(10 * 60_000))

    expect(useWorkspaceStore.getState().gitPendingPaths).toEqual([])
    expect(useWorkspaceStore.getState().gitCommitStatus).toBe('committed')
  })

  it('does nothing when auto-commit is off', async () => {
    useWorkspaceStore.setState({
      git: { prompted: true, autoCommit: false, idleMinutes: 10, skipHooks: false, autoPush: false },
    })
    renderHook(() => useGitAutoCommit())

    useWorkspaceStore.getState().addGitPendingPath('/ws/a.md')
    await act(() => vi.advanceTimersByTimeAsync(60 * 60_000))

    expect(git.autoCommit).not.toHaveBeenCalled()
  })

  it('flushGitCommit commits immediately, for session-end use', async () => {
    git.autoCommit.mockResolvedValue({ kind: 'committed' })
    const { result } = renderHook(() => useGitAutoCommit())

    useWorkspaceStore.getState().addGitPendingPath('/ws/a.md')
    await act(() => result.current.flushGitCommit())

    expect(git.autoCommit).toHaveBeenCalledWith('/ws', ['/ws/a.md'], false)
  })

  it('a non-committed outcome leaves the batch pending for the next trigger', async () => {
    git.autoCommit.mockResolvedValue({ kind: 'skipped', reason: 'a rebase is in progress' })
    renderHook(() => useGitAutoCommit())

    useWorkspaceStore.getState().addGitPendingPath('/ws/a.md')
    await act(() => vi.advanceTimersByTimeAsync(10 * 60_000))

    expect(useWorkspaceStore.getState().gitPendingPaths).toEqual(['/ws/a.md'])
    expect(useWorkspaceStore.getState().gitCommitStatus).toBe('skipped')
  })
})
```

- [ ] **Step 3: Run to confirm it fails**

Run: `npm test -- useGitAutoCommit.test`
Expected: FAIL — the module doesn't exist.

- [ ] **Step 4: Implement the hook**

Create `src/hooks/useGitAutoCommit.ts`:

```ts
import { useCallback, useEffect, useRef } from 'react'
import { useWorkspaceStore } from '../store/workspace'
import { api } from '../lib/tauri'

/**
 * Batches note saves into one commit per idle window (P5-2) — never per
 * save. `flushGitCommit` is also called directly on session end (Layout's
 * close-requested handler), so a session shorter than the idle window still
 * gets committed once before the app closes.
 */
export function useGitAutoCommit() {
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flushGitCommit = useCallback(async () => {
    if (idleTimer.current) {
      clearTimeout(idleTimer.current)
      idleTimer.current = null
    }
    const { path, git, gitPendingPaths, clearGitPendingPaths, setGitCommitStatus } =
      useWorkspaceStore.getState()
    if (!path || !git.autoCommit || gitPendingPaths.length === 0) return

    const paths = gitPendingPaths
    setGitCommitStatus('committing')
    try {
      const outcome = await api.git.autoCommit(path, paths, git.skipHooks)
      if (outcome.kind === 'committed') {
        clearGitPendingPaths()
        setGitCommitStatus('committed')
      } else if (outcome.kind === 'nothingToCommit') {
        clearGitPendingPaths()
        setGitCommitStatus('idle')
      } else {
        // Skipped or hookFailed: report quietly, leave the batch pending so
        // the next trigger retries rather than losing it.
        setGitCommitStatus('skipped')
      }
    } catch (e) {
      setGitCommitStatus('error')
      console.error('auto-commit failed', e)
    }
  }, [])

  const gitPendingPaths = useWorkspaceStore((s) => s.gitPendingPaths)
  const idleMinutes = useWorkspaceStore((s) => s.git.idleMinutes)
  const autoCommit = useWorkspaceStore((s) => s.git.autoCommit)

  useEffect(() => {
    if (!autoCommit || gitPendingPaths.length === 0) return
    if (idleTimer.current) clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => void flushGitCommit(), idleMinutes * 60_000)
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current)
    }
  }, [gitPendingPaths, idleMinutes, autoCommit, flushGitCommit])

  return { flushGitCommit }
}
```

- [ ] **Step 5: Run the hook test**

Run: `npm test -- useGitAutoCommit.test`
Expected: PASS.

- [ ] **Step 6: Wire into `Layout.tsx`**

In `src/components/Layout.tsx`, add the import and mount the hook, then flush it in the existing close-requested handler:

```tsx
import { useGitAutoCommit } from '../hooks/useGitAutoCommit'
```

```tsx
  const { flushGitCommit } = useGitAutoCommit()
```

Change the close-requested effect to also flush the pending commit, alongside the existing note flush:

```tsx
  useEffect(() => {
    const unlisten = listen('close-requested', async () => {
      try {
        await flush()
        await saveSession()
        await flushGitCommit()
      } finally {
        await api.terminal.close()
        await api.window.confirmClose()
      }
    })
    return () => void unlisten.then((off) => off())
  }, [flush, saveSession, flushGitCommit])
```

- [ ] **Step 7: Run the full frontend suite**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/types/index.ts src/store/workspace.ts src/store/workspace.test.ts src/hooks/useGitAutoCommit.ts src/hooks/useGitAutoCommit.test.ts src/components/Layout.tsx
git commit -m "feat(p5-2): idle-timer batched auto-commit, flushed on session end"
```

---

### Task 6: `GitCommitStatus` indicator + Settings rows

**Files:**
- Create: `src/components/GitCommitStatus.tsx`
- Modify: `src/components/TabBar.tsx`
- Modify: `src/components/Layout.tsx`
- Modify: `src/components/SettingsPanel.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: `gitCommitStatus` (Task 5), `git.{idleMinutes,skipHooks}` (Task 1), `updateGit` (existing `useGitConfig`).
- Produces: nothing consumed by later tasks — this is a leaf UI task.

- [ ] **Step 1: Implement the status badge**

Create `src/components/GitCommitStatus.tsx`, mirroring `SaveStatus.tsx`'s shape:

```tsx
import { Check, CircleDot, GitCommitHorizontal } from 'lucide-react'
import type { GitCommitStatus as Status } from '../types'

interface GitCommitStatusProps {
  status: Status
}

const LABEL: Record<Status, string> = {
  idle: '',
  committing: 'Committing…',
  committed: 'Committed',
  skipped: 'Commit skipped',
  error: 'Commit failed',
}

// Idle renders nothing — this badge only appears once there's something to
// say, unlike SaveStatus which always shows the current state.
export function GitCommitStatus({ status }: GitCommitStatusProps) {
  if (status === 'idle') return null
  return (
    <div className={`git-commit-status ${status}`} role="status" aria-live="polite">
      {status === 'committing' && <CircleDot size={12} />}
      {status === 'committed' && <Check size={12} />}
      {(status === 'skipped' || status === 'error') && <GitCommitHorizontal size={12} />}
      <span>{LABEL[status]}</span>
    </div>
  )
}
```

- [ ] **Step 2: Wire it into `TabBar`**

In `src/components/TabBar.tsx`, add the import, a `gitCommitStatus` prop, and render it beside `SaveStatus`:

```tsx
import { GitCommitStatus } from './GitCommitStatus'
import type { GitCommitStatus as Status } from '../types'
```

Add `gitCommitStatus: Status` to `TabBarProps`, and render `{activeTab && (<>...<GitCommitStatus status={gitCommitStatus} />...)}` next to the existing `SaveStatus` element.

In `src/components/Layout.tsx`, read the status and pass it through:

```tsx
  const gitCommitStatus = useWorkspaceStore((s) => s.gitCommitStatus)
```

```tsx
        <TabBar
          viewMode={viewMode}
          onToggleView={() => setViewMode((m) => (m === 'wysiwyg' ? 'raw' : 'wysiwyg'))}
          saveState={saveState}
          saveError={saveError}
          onRetrySave={() => void retrySave()}
          onDismissSaveError={dismissError}
          gitCommitStatus={gitCommitStatus}
        />
```

- [ ] **Step 3: Add CSS**

In `src/index.css`, near the existing `.save-status` rules, add:

```css
.git-commit-status { display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--text-secondary); }
.git-commit-status.error { color: var(--danger); }
```

- [ ] **Step 4: Add Settings rows**

In `src/components/SettingsPanel.tsx`, inside the existing `{repoMode && (...)}` block (after the auto-commit checkbox row), add two more rows, only when `gitAutoCommit` is on:

```tsx
        {repoMode && gitAutoCommit && (
          <>
            <label className="settings-row">
              <span>
                Auto-commit idle window
                <small>Minutes of no note activity before a pending batch is committed.</small>
              </span>
              <span className="settings-row-control">
                <input
                  type="number"
                  min={1}
                  max={120}
                  value={gitIdleMinutes}
                  onChange={(e) => void updateGit({ idleMinutes: Number(e.target.value) })}
                />
                <span className="settings-unit">min</span>
              </span>
            </label>

            <label className="settings-row">
              <span>
                Skip commit hooks
                <small>Run without <code>pre-commit</code>/<code>commit-msg</code> hooks. Off by default — a failing hook aborts the auto-commit instead.</small>
              </span>
              <span className="settings-row-control">
                <input
                  type="checkbox"
                  checked={gitSkipHooks}
                  onChange={(e) => void updateGit({ skipHooks: e.target.checked })}
                />
              </span>
            </label>
          </>
        )}
```

Add the two new selectors near the existing `gitAutoCommit` one:

```tsx
  const gitIdleMinutes = useWorkspaceStore((s) => s.git.idleMinutes)
  const gitSkipHooks = useWorkspaceStore((s) => s.git.skipHooks)
```

- [ ] **Step 5: Manual check**

Run: `npm run tauri dev`
Open a workspace inside a Git repo, enable auto-commit, confirm the idle-window and skip-hooks rows appear in Settings and persist across a restart.

- [ ] **Step 6: Run the frontend suite**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/GitCommitStatus.tsx src/components/TabBar.tsx src/components/Layout.tsx src/components/SettingsPanel.tsx src/index.css
git commit -m "feat(p5-2): surface auto-commit status and its two settings"
```

---

### Task 7: `checked_push` + the `push_notes` command (P5-3)

**Files:**
- Modify: `src-tauri/src/commands/git.rs`

**Interfaces:**
- Consumes: `RepoMode` (existing, `models.rs`).
- Produces: `pub enum PushOutcome { Pushed, NoRemote, AuthFailed { output: String }, Rejected { output: String } }`; `pub fn checked_push(workspace: &str, mode: RepoMode) -> anyhow::Result<PushOutcome>`; `#[tauri::command] pub async fn push_notes(workspace: String, mode: RepoMode) -> Result<PushOutcome, String>` — consumed by Task 8's registration/frontend and Task 9's `has_remote` reuse.

- [ ] **Step 1: Write the failing tests**

Add to `git.rs`'s test module:

```rust
    // A bare "remote" plus one clone that already has commits pushed to it —
    // the shared fixture every push/pull test in this file builds on.
    fn bare_remote_with_clone() -> (tempfile::TempDir, tempfile::TempDir) {
        let remote = tempdir().unwrap();
        Command::new("git").arg("init").arg("--bare").arg("-q").arg(remote.path()).status().unwrap();

        let clone = tempdir().unwrap();
        Command::new("git")
            .arg("clone").arg("-q").arg(remote.path()).arg(clone.path())
            .status().unwrap();
        commit_file(clone.path(), "note.md", "# Note\n");
        Command::new("git").arg("-C").arg(clone.path()).arg("push").arg("-q").arg("origin").arg("HEAD").status().unwrap();

        (remote, clone)
    }

    #[test]
    fn pushes_a_notes_only_workspace_with_a_remote() {
        let (_remote, clone) = bare_remote_with_clone();
        commit_file(clone.path(), "note2.md", "# Note 2\n");

        let outcome = checked_push(&clone.path().to_string_lossy(), RepoMode::NotesOnly).unwrap();

        assert_eq!(outcome, PushOutcome::Pushed);
    }

    #[test]
    fn no_remote_is_reported_not_errored() {
        let tmp = tempdir().unwrap();
        git_init(tmp.path());
        commit_file(tmp.path(), "note.md", "# Note\n");

        let outcome = checked_push(&tmp.path().to_string_lossy(), RepoMode::NotesOnly).unwrap();

        assert_eq!(outcome, PushOutcome::NoRemote);
    }

    #[test]
    fn a_non_fast_forward_push_is_rejected_not_forced() {
        let (remote, clone_a) = bare_remote_with_clone();
        let clone_b = tempdir().unwrap();
        Command::new("git").arg("clone").arg("-q").arg(remote.path()).arg(clone_b.path()).status().unwrap();

        commit_file(clone_a.path(), "a.md", "from a\n");
        Command::new("git").arg("-C").arg(clone_a.path()).arg("push").arg("-q").arg("origin").arg("HEAD").status().unwrap();

        commit_file(clone_b.path(), "b.md", "from b\n");
        let outcome = checked_push(&clone_b.path().to_string_lossy(), RepoMode::NotesOnly).unwrap();

        assert!(matches!(outcome, PushOutcome::Rejected { .. }));
    }

    #[test]
    fn a_code_repo_workspace_is_refused_unconditionally() {
        let (_remote, clone) = bare_remote_with_clone();

        let result = checked_push(&clone.path().to_string_lossy(), RepoMode::CodeRepo);

        assert!(result.is_err());
    }
```

- [ ] **Step 2: Run to confirm they fail**

Run: `cargo test --lib commands::git`
Expected: FAIL.

- [ ] **Step 3: Implement**

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PushOutcome {
    Pushed,
    NoRemote,
    AuthFailed { output: String },
    Rejected { output: String },
}

fn has_remote(workspace: &str) -> anyhow::Result<bool> {
    let output = Command::new("git").arg("-C").arg(workspace).arg("remote").output()?;
    Ok(!String::from_utf8_lossy(&output.stdout).trim().is_empty())
}

/// Never called for `RepoMode::CodeRepo` from the frontend, but the guard
/// lives here too — structural, not only a UI-layer check (P5-3).
pub fn checked_push(workspace: &str, mode: RepoMode) -> anyhow::Result<PushOutcome> {
    if mode == RepoMode::CodeRepo {
        anyhow::bail!("refusing to push a CodeRepo workspace — P5-3 forbids it unconditionally");
    }
    if !has_remote(workspace)? {
        return Ok(PushOutcome::NoRemote);
    }

    let output = Command::new("git").arg("-C").arg(workspace).arg("push").output()?;
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
pub async fn push_notes(workspace: String, mode: RepoMode) -> Result<PushOutcome, String> {
    tokio::task::spawn_blocking(move || checked_push(&workspace, mode))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}
```

- [ ] **Step 4: Run the tests**

Run: `cargo test --lib commands::git`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/git.rs
git commit -m "feat(p5-3): push policy — notes-only pushes, code repos never do"
```

---

### Task 8: Wire push into the frontend

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/types/index.ts`
- Modify: `src/lib/tauri.ts`
- Modify: `src/hooks/useGitAutoCommit.ts`
- Modify: `src/hooks/useGitAutoCommit.test.ts`
- Modify: `src/components/SettingsPanel.tsx`

**Interfaces:**
- Consumes: `commands::git::push_notes` (Task 7).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Register and type**

`src-tauri/src/lib.rs`: add `commands::git::push_notes,` after `commands::git::auto_commit,`.

`src/types/index.ts`:

```ts
export type PushOutcome =
  | { kind: 'pushed' }
  | { kind: 'noRemote' }
  | { kind: 'authFailed'; output: string }
  | { kind: 'rejected'; output: string }
```

`src/lib/tauri.ts`, add to `api.git` (and the import line):

```ts
    pushNotes: (workspace: string, mode: RepoMode) =>
      invoke<PushOutcome>('push_notes', { workspace, mode }),
```

- [ ] **Step 2: Write the failing test**

Add to `src/hooks/useGitAutoCommit.test.ts`:

```ts
  it('pushes after a successful commit when notes-only and autoPush is on', async () => {
    git.autoCommit.mockResolvedValue({ kind: 'committed' })
    git.pushNotes.mockResolvedValue({ kind: 'pushed' })
    useWorkspaceStore.setState({
      git: { prompted: true, autoCommit: true, idleMinutes: 10, skipHooks: false, autoPush: true },
    })
    renderHook(() => useGitAutoCommit())

    useWorkspaceStore.getState().addGitPendingPath('/ws/a.md')
    await act(() => vi.advanceTimersByTimeAsync(10 * 60_000))

    expect(git.pushNotes).toHaveBeenCalledWith('/ws', 'notesOnly')
  })

  it('never pushes a code-repo workspace, even with autoPush on', async () => {
    git.autoCommit.mockResolvedValue({ kind: 'committed' })
    useWorkspaceStore.setState({
      repoMode: 'codeRepo',
      git: { prompted: true, autoCommit: true, idleMinutes: 10, skipHooks: false, autoPush: true },
    })
    renderHook(() => useGitAutoCommit())

    useWorkspaceStore.getState().addGitPendingPath('/ws/a.md')
    await act(() => vi.advanceTimersByTimeAsync(10 * 60_000))

    expect(git.pushNotes).not.toHaveBeenCalled()
  })
```

Add `pushNotes: vi.fn()` to the `vi.mock('../lib/tauri', ...)` block at the top of the file.

- [ ] **Step 3: Run to confirm it fails**

Run: `npm test -- useGitAutoCommit.test`
Expected: FAIL.

- [ ] **Step 4: Implement**

In `src/hooks/useGitAutoCommit.ts`, inside `flushGitCommit`'s `if (outcome.kind === 'committed')` branch, read `repoMode` from the store and push:

```ts
    const { path, repoMode, git, gitPendingPaths, clearGitPendingPaths, setGitCommitStatus } =
      useWorkspaceStore.getState()
```

```ts
      if (outcome.kind === 'committed') {
        clearGitPendingPaths()
        setGitCommitStatus('committed')
        if (repoMode === 'notesOnly' && git.autoPush) {
          try {
            await api.git.pushNotes(path, repoMode)
          } catch (e) {
            console.error('push after auto-commit failed', e)
          }
        }
      }
```

The `repoMode === 'notesOnly'` check is the only call site for `pushNotes` in the app — this is what makes "never for a code repo" true on the frontend side too, on top of Task 7's backend guard.

- [ ] **Step 5: Run the test**

Run: `npm test -- useGitAutoCommit.test`
Expected: PASS.

- [ ] **Step 6: Add the Settings row**

In `src/components/SettingsPanel.tsx`, inside the `{repoMode && gitAutoCommit && (...)}` block from Task 6, add (only rendered for `notesOnly`, per P5-3):

```tsx
            {repoMode === 'notesOnly' && (
              <label className="settings-row">
                <span>
                  Push after commit
                  <small>Only ever applies to a notes-only repo — a workspace inside a code repo never auto-pushes, at any setting.</small>
                </span>
                <span className="settings-row-control">
                  <input
                    type="checkbox"
                    checked={gitAutoPush}
                    onChange={(e) => void updateGit({ autoPush: e.target.checked })}
                  />
                </span>
              </label>
            )}
```

```tsx
  const gitAutoPush = useWorkspaceStore((s) => s.git.autoPush)
```

- [ ] **Step 7: Run the full suite**

Run: `cargo build && npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/lib.rs src/types/index.ts src/lib/tauri.ts src/hooks/useGitAutoCommit.ts src/hooks/useGitAutoCommit.test.ts src/components/SettingsPanel.tsx
git commit -m "feat(p5-3): push after a notes-only auto-commit when enabled"
```

---

### Task 9: `checked_pull` + the `fetch_and_compare` command (P5-4)

**Files:**
- Modify: `src-tauri/src/commands/git.rs`

**Interfaces:**
- Consumes: `has_remote` (Task 7).
- Produces: `pub enum PullOutcome { UpToDate, FastForwarded, Diverged { ahead: u32, behind: u32 }, NoRemote }`; `pub fn checked_pull(workspace: &str) -> anyhow::Result<PullOutcome>`; `#[tauri::command] pub async fn fetch_and_compare(workspace: String) -> Result<PullOutcome, String>` — consumed by Task 10's frontend hook.

- [ ] **Step 1: Write the failing tests**

Add to `git.rs`'s test module:

```rust
    #[test]
    fn fast_forwards_when_purely_behind() {
        let (remote, clone_a) = bare_remote_with_clone();
        let clone_b = tempdir().unwrap();
        Command::new("git").arg("clone").arg("-q").arg(remote.path()).arg(clone_b.path()).status().unwrap();

        commit_file(clone_a.path(), "a.md", "from a\n");
        Command::new("git").arg("-C").arg(clone_a.path()).arg("push").arg("-q").arg("origin").arg("HEAD").status().unwrap();

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
        Command::new("git").arg("clone").arg("-q").arg(remote.path()).arg(clone_b.path()).status().unwrap();

        commit_file(clone_a.path(), "a.md", "from a\n");
        Command::new("git").arg("-C").arg(clone_a.path()).arg("push").arg("-q").arg("origin").arg("HEAD").status().unwrap();
        commit_file(clone_b.path(), "b.md", "from b, unpushed\n");

        let outcome = checked_pull(&clone_b.path().to_string_lossy()).unwrap();

        assert_eq!(outcome, PullOutcome::Diverged { ahead: 1, behind: 1 });
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
```

- [ ] **Step 2: Run to confirm they fail**

Run: `cargo test --lib commands::git`
Expected: FAIL.

- [ ] **Step 3: Implement**

```rust
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
        .arg("-C").arg(workspace)
        .arg("rev-list").arg("--count").arg(range)
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

    let fetch_status = Command::new("git").arg("-C").arg(workspace).arg("fetch").status()?;
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
        .arg("-C").arg(workspace).arg("merge").arg("--ff-only").arg("@{u}")
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
```

- [ ] **Step 4: Run the tests**

Run: `cargo test --lib commands::git`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/git.rs
git commit -m "feat(p5-4): fast-forward-only auto-pull, diverged history stops and reports"
```

---

### Task 10: `useGitAutoPull` — fetch/compare on workspace open

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/types/index.ts`
- Modify: `src/lib/tauri.ts`
- Create: `src/hooks/useGitAutoPull.ts`
- Test: `src/hooks/useGitAutoPull.test.ts`
- Modify: `src/store/workspace.ts`, `src/store/workspace.test.ts`

**Interfaces:**
- Consumes: `commands::git::fetch_and_compare` (Task 9).
- Produces: `useWorkspaceStore.getState().gitDiverged: { ahead: number; behind: number } | null`, `.setGitDiverged(...)`; `useGitAutoPull() => { checkForUpdates: (workspace: string) => Promise<void> }` — consumed by Task 11's `GitDivergedBar` and by `useWorkspace.ts`'s `openWorkspaceAt`.

- [ ] **Step 1: Register and type**

`src-tauri/src/lib.rs`: add `commands::git::fetch_and_compare,`.

`src/types/index.ts`:

```ts
export type PullOutcome =
  | { kind: 'upToDate' }
  | { kind: 'fastForwarded' }
  | { kind: 'diverged'; ahead: number; behind: number }
  | { kind: 'noRemote' }
```

`src/lib/tauri.ts`:

```ts
    fetchAndCompare: (workspace: string) =>
      invoke<PullOutcome>('fetch_and_compare', { workspace }),
```

- [ ] **Step 2: Add `gitDiverged` to the store**

In `src/store/workspace.ts`:

```ts
  gitDiverged: { ahead: number; behind: number } | null
  setGitDiverged: (d: { ahead: number; behind: number } | null) => void
```
```ts
  gitDiverged: null,
  setGitDiverged: (d) => set({ gitDiverged: d }),
```

Add `gitDiverged: null,` to `resetForNewWorkspace` and to `workspace.test.ts`'s `reset()`.

- [ ] **Step 3: Write the failing hook test**

Create `src/hooks/useGitAutoPull.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useGitAutoPull } from './useGitAutoPull'
import { useWorkspaceStore } from '../store/workspace'
import { api } from '../lib/tauri'

vi.mock('../lib/tauri', () => ({
  api: { git: { fetchAndCompare: vi.fn() } },
}))

const git = vi.mocked(api.git)

describe('useGitAutoPull', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ gitDiverged: null })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('sets gitDiverged when histories have diverged', async () => {
    git.fetchAndCompare.mockResolvedValue({ kind: 'diverged', ahead: 1, behind: 2 })
    const { result } = renderHook(() => useGitAutoPull())

    await result.current.checkForUpdates('/ws')

    expect(useWorkspaceStore.getState().gitDiverged).toEqual({ ahead: 1, behind: 2 })
  })

  it('leaves gitDiverged null on a silent fast-forward', async () => {
    git.fetchAndCompare.mockResolvedValue({ kind: 'fastForwarded' })
    const { result } = renderHook(() => useGitAutoPull())

    await result.current.checkForUpdates('/ws')

    expect(useWorkspaceStore.getState().gitDiverged).toBeNull()
  })

  it('never blocks on a fetch failure', async () => {
    git.fetchAndCompare.mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useGitAutoPull())

    await expect(result.current.checkForUpdates('/ws')).resolves.toBeUndefined()
    expect(useWorkspaceStore.getState().gitDiverged).toBeNull()
  })
})
```

- [ ] **Step 4: Run to confirm it fails**

Run: `npm test -- useGitAutoPull.test`
Expected: FAIL.

- [ ] **Step 5: Implement**

Create `src/hooks/useGitAutoPull.ts`:

```ts
import { useCallback } from 'react'
import { useWorkspaceStore } from '../store/workspace'
import { api } from '../lib/tauri'

/**
 * Fetch-and-compare on workspace open (P5-4). A fast-forward is silent — the
 * resulting file changes are an ordinary external edit that P0-5's watcher
 * and useNote's existing conflict handling already cover, so this adds no
 * reload logic of its own. A diverged history only ever sets state for
 * `GitDivergedBar` to render; it never merges, rebases, or resets.
 */
export function useGitAutoPull() {
  const checkForUpdates = useCallback(async (workspace: string) => {
    const { setGitDiverged } = useWorkspaceStore.getState()
    try {
      const outcome = await api.git.fetchAndCompare(workspace)
      setGitDiverged(outcome.kind === 'diverged' ? { ahead: outcome.ahead, behind: outcome.behind } : null)
    } catch (e) {
      // Best-effort, same posture as P5-1's repo detection: never blocks
      // opening the workspace.
      setGitDiverged(null)
      console.error('git fetch/compare failed', e)
    }
  }, [])

  return { checkForUpdates }
}
```

- [ ] **Step 6: Run the test**

Run: `npm test -- useGitAutoPull.test`
Expected: PASS.

- [ ] **Step 7: Call it from workspace open**

In `src/hooks/useWorkspace.ts`, import and call it right after the existing best-effort `setRepoMode(await api.git.detectRepo(selected))` block, inside the same `try`:

```ts
import { useGitAutoPull } from './useGitAutoPull'
```

```ts
export function useWorkspace() {
  const { setPath, openTab, setExpandedFolders, resetForNewWorkspace } = useWorkspaceStore()
  const { setNotes, setFolders } = useNotesStore()
  const { checkForUpdates } = useGitAutoPull()
```

```ts
      try {
        const mode = await api.git.detectRepo(selected)
        setRepoMode(mode)
        if (mode) await checkForUpdates(selected)
      } catch {
        setRepoMode(null)
      }
```

Add `checkForUpdates` to the `useCallback` dependency array of `openWorkspaceAt`.

- [ ] **Step 8: Run the full suite**

Run: `cargo build && npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/lib.rs src/types/index.ts src/lib/tauri.ts src/store/workspace.ts src/store/workspace.test.ts src/hooks/useGitAutoPull.ts src/hooks/useGitAutoPull.test.ts src/hooks/useWorkspace.ts
git commit -m "feat(p5-4): fetch and compare on workspace open"
```

---

### Task 11: `GitDivergedBar`

**Files:**
- Create: `src/components/GitDivergedBar.tsx`
- Modify: `src/components/Layout.tsx`

**Interfaces:**
- Consumes: `gitDiverged`/`setGitDiverged` (Task 10).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Implement, reusing `.conflict-bar`'s existing styling**

Create `src/components/GitDivergedBar.tsx`:

```tsx
import { GitBranch } from 'lucide-react'

interface GitDivergedBarProps {
  ahead: number
  behind: number
  onDismiss: () => void
}

// P5-4: local and remote history have genuinely diverged, so nothing here
// auto-merges, auto-rebases, or resets. Reuses ConflictBar's `.conflict-bar`
// styling rather than inventing a second bar look for the same "you decide"
// shape of message.
export function GitDivergedBar({ ahead, behind, onDismiss }: GitDivergedBarProps) {
  return (
    <div className="conflict-bar" role="alert">
      <GitBranch size={14} />
      <span>
        Local and remote history have diverged — you&apos;re ahead by {ahead}, behind by {behind}.
        Resolve it in the terminal or your Git tool; null-notes never merges or rebases automatically.
      </span>
      <button onClick={onDismiss}>Dismiss</button>
    </div>
  )
}
```

- [ ] **Step 2: Wire into `Layout.tsx`**

Add the import and render it near the existing `ConflictBar`/`GitAutoCommitPrompt` (after `{repoMode && !gitPrompted && (...)}`):

```tsx
import { GitDivergedBar } from './GitDivergedBar'
```

```tsx
        const gitDiverged = useWorkspaceStore((s) => s.gitDiverged)
```

```tsx
        {gitDiverged && (
          <GitDivergedBar
            ahead={gitDiverged.ahead}
            behind={gitDiverged.behind}
            onDismiss={() => useWorkspaceStore.getState().setGitDiverged(null)}
          />
        )}
```

(Add the `gitDiverged` selector near Layout's other `useWorkspaceStore` selectors, not inline mid-JSX as shown above — that's illustrative of placement only.)

- [ ] **Step 3: Manual check**

Run: `npm run tauri dev`. Simulate a divergence by hand (clone the workspace repo elsewhere, commit+push from the clone, then commit locally without pulling) and confirm the bar appears with correct counts and dismisses without affecting anything on disk.

- [ ] **Step 4: Run the frontend suite**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/GitDivergedBar.tsx src/components/Layout.tsx
git commit -m "feat(p5-4): show a diverged-history bar, never auto-resolved"
```

---

### Task 12: `checked_init_notes_repo` + the `init_notes_repo` command (P5-5)

**Files:**
- Modify: `src-tauri/src/commands/git.rs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `pub const NOTES_GITIGNORE: &str`; `pub enum RepoInitOutcome { InitializedWithRemote, InitializedLocalOnly { remote_add_command: String } }`; `pub fn checked_init_notes_repo(workspace: &str, create_github_remote: bool) -> anyhow::Result<RepoInitOutcome>`; `#[tauri::command] pub async fn init_notes_repo(workspace: String, create_github_remote: bool) -> Result<RepoInitOutcome, String>` — consumed by Task 13's frontend wiring.

- [ ] **Step 1: Write the failing tests**

Add to `git.rs`'s test module:

```rust
    #[test]
    fn init_creates_a_repo_and_the_documented_gitignore() {
        let tmp = tempdir().unwrap();

        let outcome = checked_init_notes_repo(&tmp.path().to_string_lossy(), false).unwrap();

        assert!(matches!(outcome, RepoInitOutcome::InitializedLocalOnly { .. }));
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
```

- [ ] **Step 2: Run to confirm they fail**

Run: `cargo test --lib commands::git`
Expected: FAIL.

- [ ] **Step 3: Implement**

```rust
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
    let init_status = Command::new("git").arg("-C").arg(workspace).arg("init").status()?;
    if !init_status.success() {
        anyhow::bail!("git init failed for {workspace}");
    }

    let gitignore_path = Path::new(workspace).join(".gitignore");
    if !gitignore_path.exists() {
        std::fs::write(&gitignore_path, NOTES_GITIGNORE)?;
    }

    if create_github_remote && has_gh() {
        // Private by default: lecture notes must not become public by
        // accident.
        let status = Command::new("gh")
            .arg("repo").arg("create")
            .arg("--source").arg(workspace)
            .arg("--private")
            .arg("--remote").arg("origin")
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
```

- [ ] **Step 4: Run the tests**

Run: `cargo test --lib commands::git`
Expected: PASS. Also run `cargo test` (full suite) once here — Task 12 is the last backend task, a good point to catch any cross-file breakage.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/git.rs
git commit -m "feat(p5-5): init a notes-only repo, with an optional private GitHub remote"
```

---

### Task 13: Wire P5-5 into Settings

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/types/index.ts`
- Modify: `src/lib/tauri.ts`
- Modify: `src/components/SettingsPanel.tsx`

**Interfaces:**
- Consumes: `commands::git::init_notes_repo` (Task 12).
- Produces: nothing consumed by later tasks — final frontend task.

- [ ] **Step 1: Register and type**

`src-tauri/src/lib.rs`: add `commands::git::init_notes_repo,`.

`src/types/index.ts`:

```ts
export type RepoInitOutcome =
  | { kind: 'initializedWithRemote' }
  | { kind: 'initializedLocalOnly'; remoteAddCommand: string }
```

`src/lib/tauri.ts`:

```ts
    initNotesRepo: (workspace: string, createGithubRemote: boolean) =>
      invoke<RepoInitOutcome>('init_notes_repo', { workspace, createGithubRemote }),
```

- [ ] **Step 2: Add the Settings action**

In `src/components/SettingsPanel.tsx`, this only makes sense when the open workspace is *not* already a repo. Add near the top of the panel, before the existing rows, guarded on `repoMode === null`:

```tsx
        {repoMode === null && workspacePath && (
          <div className="settings-row">
            <span>
              This workspace isn&apos;t a Git repository yet
              <small>Turn it into one — private by default if you have the GitHub CLI installed, local-only otherwise.</small>
            </span>
            <button
              onClick={() => {
                if (!confirm(`Initialize a Git repository in ${workspacePath}?`)) return
                void (async () => {
                  const wantsRemote = confirm('Also create a private GitHub remote via `gh`? (Cancel = local-only)')
                  const outcome = await api.git.initNotesRepo(workspacePath, wantsRemote)
                  if (outcome.kind === 'initializedLocalOnly') {
                    alert(`Repo created locally. To add a remote later:\n${outcome.remoteAddCommand}`)
                  }
                  useWorkspaceStore.getState().setRepoMode('notesOnly')
                })()
              }}
            >
              Initialize Git repo
            </button>
          </div>
        )}
```

Add `const workspacePath = useWorkspaceStore((s) => s.path)` near the panel's other selectors.

Setting `repoMode` to `'notesOnly'` directly (rather than re-running detection) reuses P5-1's existing `{repoMode && !gitPrompted && <GitAutoCommitPrompt .../>}` wiring in `Layout.tsx` unchanged — the one-time prompt now appears immediately, since `git.prompted` is still `false` for this workspace.

- [ ] **Step 3: Manual check**

Run: `npm run tauri dev`. Open a plain folder with no `.git`, open Settings, click "Initialize Git repo", decline the GitHub remote, confirm `.git` and `.gitignore` now exist and the auto-commit prompt banner appears.

- [ ] **Step 4: Run the full suite**

Run: `cargo build && cargo clippy -- -D warnings && npm run typecheck && npm test`
Expected: PASS, clean clippy.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs src/types/index.ts src/lib/tauri.ts src/components/SettingsPanel.tsx
git commit -m "feat(p5-5): initialize a Git repo for a plain notes workspace from Settings"
```

---

### Task 14: Close out the roadmap bookkeeping

**Files:**
- Modify: `docs/ROADMAP.md`
- Modify: `TODO.md`

**Interfaces:** none — documentation only, no tests.

- [ ] **Step 1: Update `TODO.md`**

Tick every box under P5-2 through P5-5 in `TODO.md`'s `▸ P5` section; change the Progress table's `P5 Versioned workspaces (Git)` row to `✅`; update the "Now" line at the top from `P5-2 → P5-3 → P5-4 → P5-5 → P6 → P9` to `P6 → P9`.

- [ ] **Step 2: Update `docs/ROADMAP.md`**

Add a `*Done: ...*` paragraph under each of P5-2, P5-3, P5-4, P5-5 (mirroring every other completed task in the file — see P5-1's own `*Done. ...*` paragraph for the exact tone and level of detail: what shipped, the one or two real bugs/decisions found along the way, what's explicitly not covered). Change the phase heading from `## Phase 5 — Versioned Workspaces / Git Automation (P5)` to add `✅`, matching `## Phase 4 — ... ✅` and `## Phase 7 — IDE Integration (P7) ✅`. Update the `| **P5** | ... | | ... |` row in §3's prioritization table to `✅`. Add the exit check confirmation to `**Exit check for M5:** ...` (already present — confirm its three conditions are genuinely true against what shipped, don't just tick it).

- [ ] **Step 3: Commit**

```bash
git add docs/ROADMAP.md TODO.md
git commit -m "docs(p5): close out P5 — M5 reached"
```

---

## Self-Review Notes

- **Spec coverage:** P5-2's five bullets (cadence, message, pathspec-only, back-off, hooks) → Tasks 2–6. P5-3's three bullets (notes-only pushes, code-repo never, surfaced failures) → Tasks 7–8. P5-4's five bullets (fetch/compare, silent ff, diverged stop, never auto-merge, dirty-buffer safety) → Tasks 9–11 (dirty-buffer safety is explicitly *not* new code — it's the existing P0-5/`useNote` path, called out in Task 9's docstring and the Global Constraints). P5-5's four bullets (init, gitignore, optional `gh` remote, private-by-default, no hard `gh` dependency) → Tasks 12–13.
- **The one unforgivable DoD** ("staged and unstaged source changes are byte-identical after an auto-commit") has a dedicated test in Task 3, asserting both `git diff --cached` and `git diff` output are unchanged.
- **CodeRepo can never push** is enforced at three independent layers: the Rust guard in `checked_push` (Task 7, tested), the frontend call site only ever passing `repoMode === 'notesOnly'` (Task 8, tested), and P5-3's Settings row only rendering for `notesOnly` (Task 8).
- **No new dependencies** — every task uses `std::process::Command`, already-present crates, or existing frontend libraries.

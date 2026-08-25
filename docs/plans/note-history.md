# Note History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (default) or superpowers:subagent-driven-development if explicitly requested.

**Goal:** A per-note commit history panel — list past commits touching the open note, preview an old version, restore it — for workspaces that already have Git auto-commit enabled.

**Architecture:** Two new read-only Rust commands in `src-tauri/src/commands/git.rs`, following the exact `checked_*` sync-function-plus-`spawn_blocking`-wrapper pattern `checked_auto_commit`/`auto_commit` already establish: `list_note_history_at`/`list_note_history` (git pathspec history for one path) and `read_note_at_commit_at`/`read_note_at_commit` (a historical blob's content). A new frontend component, `NoteHistoryPanel.tsx`, structurally mirrors `BacklinksPanel.tsx` — self-contained data fetch, own collapse toggle, own empty state — and mounts in `Layout.tsx` as `BacklinksPanel`'s sibling, gated on `repoMode` being non-null. Restore reuses the existing `save` function already wired to `NoteEditor`'s `onChange` — no new write path.

**Tech Stack:** Rust (`git` shelled out via `std::process::Command`, `tokio::task::spawn_blocking`), React 19 + TypeScript, Vitest + React Testing Library, `cargo test` against real `git` in a `tempdir` (no mocking git — matches `checked_auto_commit`'s existing test module).

**Spec:** `docs/specs/note-history-design.md`

## Global Constraints

- Both new Rust commands are read-only — neither needs the `unsafe_repo_state` guard `checked_auto_commit` requires before it writes anything.
- `list_note_history_at`'s `note_path` argument is the note's ordinary absolute path — a git pathspec (`-- <path>`) resolves correctly whether absolute or `-C`-relative, the same assumption `checked_auto_commit`'s own `paths` argument already relies on. Do not relativize it.
- `read_note_at_commit_at` is the one place that needs the path relative to the **repo root**, not the workspace — git's `<rev>:<path>` object syntax is always root-relative, and `RepoMode::CodeRepo` means workspace can be a subtree of the repo. Compute the root via `git -C <workspace> rev-parse --show-toplevel`, the same call `detect_repo_mode` (`src-tauri/src/commands/git.rs:43-49`) already makes.
- History is capped at 20 commits (`NOTE_HISTORY_LIMIT`).
- No diffing, no workspace-wide history view, no changes to `useGitAutoCommit.ts`, no mechanism for non-Git users — all explicitly out of scope per the spec.

---

### Task 1: `list_note_history` (Rust)

**Files:**
- Modify: `src-tauri/src/commands/git.rs` (new function + tauri command, placed after `checked_auto_commit`/`auto_commit` around line 369)
- Test: same file, `mod tests` (starts at line 663)

**Interfaces:**
- Produces: `pub fn list_note_history_at(workspace: &str, note_path: &str) -> anyhow::Result<Vec<NoteHistoryEntry>>`, `pub struct NoteHistoryEntry { pub sha: String, pub timestamp_ms: i64, pub message: String }`, `#[tauri::command] pub async fn list_note_history(workspace: String, note_path: String) -> Result<Vec<NoteHistoryEntry>, String>` — consumed by Task 3 (frontend binding) and reused by Task 2's tests (same fixture helpers).

- [ ] **Step 1: Write the failing tests**

Add to `git.rs`'s `mod tests` block, near the other `checked_auto_commit` tests. These reuse the module's existing `git_init`/`configure_test_identity` helpers (lines 675-702) and add one new helper for reading HEAD's SHA in a test:

```rust
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

    fn commit_file(dir: &Path, relative_path: &str, content: &str, message: &str) -> String {
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

        let first_sha = commit_file(tmp.path(), "Todo.md", "# Todo\n\n- one\n", "notes: update Todo");
        let second_sha = commit_file(tmp.path(), "Todo.md", "# Todo\n\n- one\n- two\n", "notes: update Todo");

        let entries = list_note_history_at(&tmp.path().to_string_lossy(), &note_path).unwrap();

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].sha, second_sha, "newest first");
        assert_eq!(entries[0].message, "notes: update Todo");
        assert_eq!(entries[1].sha, first_sha);
    }

    #[test]
    fn list_note_history_is_capped_at_the_limit() {
        let tmp = tempdir().unwrap();
        git_init(tmp.path());
        let note_path = tmp.path().join("Todo.md").to_string_lossy().into_owned();

        for i in 0..(NOTE_HISTORY_LIMIT + 5) {
            commit_file(tmp.path(), "Todo.md", &format!("edit {i}\n"), &format!("edit {i}"));
        }

        let entries = list_note_history_at(&tmp.path().to_string_lossy(), &note_path).unwrap();

        assert_eq!(entries.len(), NOTE_HISTORY_LIMIT);
    }

    #[test]
    fn list_note_history_follows_a_rename() {
        let tmp = tempdir().unwrap();
        git_init(tmp.path());
        let old_sha = commit_file(tmp.path(), "Old.md", "# Old\n", "notes: update Old");

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
        assert_eq!(entries[1].sha, old_sha);
    }

    #[test]
    fn list_note_history_returns_empty_for_a_path_with_no_history() {
        let tmp = tempdir().unwrap();
        git_init(tmp.path());
        commit_file(tmp.path(), "Other.md", "# Other\n", "notes: update Other");
        let untouched_path = tmp.path().join("Todo.md").to_string_lossy().into_owned();

        let entries = list_note_history_at(&tmp.path().to_string_lossy(), &untouched_path).unwrap();

        assert!(entries.is_empty());
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test list_note_history`
Expected: FAIL to compile — `list_note_history_at`, `NoteHistoryEntry`, `NOTE_HISTORY_LIMIT` don't exist yet.

- [ ] **Step 3: Write the implementation**

Add to `src-tauri/src/commands/git.rs`, after `auto_commit` (after line 369, before the `PushOutcome` enum):

```rust
/// How many recent commits `list_note_history_at` returns for one note —
/// enough for "did I lose anything recently," not a full audit log.
pub const NOTE_HISTORY_LIMIT: usize = 20;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NoteHistoryEntry {
    pub sha: String,
    pub timestamp_ms: i64,
    pub message: String,
}

/// The commits touching `note_path`, newest first, capped at
/// `NOTE_HISTORY_LIMIT`. `--follow` keeps history intact across a rename —
/// history is exactly the case where that must not look like the file's
/// story restarted. `note_path` is the note's ordinary absolute path: a git
/// pathspec resolves an absolute path correctly regardless of `-C`, the
/// same assumption `checked_auto_commit`'s own `paths` argument already
/// relies on — unlike `read_note_at_commit_at` below, no relativizing here.
pub fn list_note_history_at(workspace: &str, note_path: &str) -> anyhow::Result<Vec<NoteHistoryEntry>> {
    let output = no_window_command("git")
        .arg("-C")
        .arg(workspace)
        .arg("log")
        .arg("--follow")
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
    for line in text.lines() {
        let mut fields = line.splitn(3, '\u{1f}');
        let sha = fields.next().unwrap_or_default().to_string();
        let timestamp_s: i64 = fields.next().unwrap_or_default().parse().unwrap_or(0);
        let message = fields.next().unwrap_or_default().to_string();
        entries.push(NoteHistoryEntry {
            sha,
            timestamp_ms: timestamp_s * 1000,
            message,
        });
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test list_note_history`
Expected: PASS, all four cases.

- [ ] **Step 5: Register the command and typecheck**

In `src-tauri/src/lib.rs`, the `generate_handler!` list has five `commands::git::*` entries (`detect_repo`, `auto_commit`, `push_notes`, `fetch_and_compare`, `init_notes_repo`, in that order — `lib.rs:249-253`). Add the new command right after `init_notes_repo`:

```rust
            commands::git::init_notes_repo,
            commands::git::list_note_history,
```

Run: `cd src-tauri && cargo build`
Expected: compiles clean.

Run: `cd src-tauri && cargo clippy -- -D warnings`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/git.rs src-tauri/src/lib.rs
git commit -m "feat: add list_note_history command"
```

---

### Task 2: `read_note_at_commit` (Rust)

**Files:**
- Modify: `src-tauri/src/commands/git.rs` (new function + tauri command, placed after Task 1's `list_note_history`)
- Test: same file, `mod tests`

**Interfaces:**
- Consumes: `commit_sha_of_head`, `commit_file`, `git_init`, `configure_test_identity` test helpers from Task 1.
- Produces: `pub fn read_note_at_commit_at(workspace: &str, note_path: &str, sha: &str) -> anyhow::Result<String>`, `#[tauri::command] pub async fn read_note_at_commit(workspace: String, note_path: String, sha: String) -> Result<String, String>` — consumed by Task 3 (frontend binding).

- [ ] **Step 1: Write the failing tests**

Add to `git.rs`'s `mod tests` block, after Task 1's tests:

```rust
    #[test]
    fn read_note_at_commit_returns_the_historical_content() {
        let tmp = tempdir().unwrap();
        git_init(tmp.path());
        let note_path = tmp.path().join("Todo.md").to_string_lossy().into_owned();
        let first_sha = commit_file(tmp.path(), "Todo.md", "# Todo\n\n- one\n", "notes: update Todo");
        commit_file(tmp.path(), "Todo.md", "# Todo\n\n- one\n- two\n", "notes: update Todo");

        let content = read_note_at_commit_at(&tmp.path().to_string_lossy(), &note_path, &first_sha).unwrap();

        assert_eq!(content, "# Todo\n\n- one\n");
    }

    #[test]
    fn read_note_at_commit_resolves_the_path_relative_to_repo_root_not_workspace() {
        // A RepoMode::CodeRepo shape: the workspace is a subdirectory of the
        // repo, not the repo root itself — the exact case
        // read_note_at_commit_at must handle correctly, unlike
        // list_note_history_at's plain pathspec matching.
        let tmp = tempdir().unwrap();
        git_init(tmp.path());
        let notes_dir = tmp.path().join("notes");
        std::fs::create_dir(&notes_dir).unwrap();
        let note_path = notes_dir.join("Todo.md").to_string_lossy().into_owned();

        let sha = commit_file(tmp.path(), "notes/Todo.md", "# Todo\n\n- one\n", "notes: update Todo");

        let content = read_note_at_commit_at(&notes_dir.to_string_lossy(), &note_path, &sha).unwrap();

        assert_eq!(content, "# Todo\n\n- one\n");
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test read_note_at_commit`
Expected: FAIL to compile — `read_note_at_commit_at` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Add to `src-tauri/src/commands/git.rs`, after Task 1's `list_note_history` tauri command:

```rust
/// Reads `note_path`'s content as of `sha`. Unlike `list_note_history_at`'s
/// pathspec, `git show <rev>:<path>` always resolves `<path>` relative to
/// the repo root, never to `-C`'s working directory — the one place this
/// feature must not treat `workspace` as if it were the repo root, since
/// `RepoMode::CodeRepo` means it can be a subtree of one.
pub fn read_note_at_commit_at(workspace: &str, note_path: &str, sha: &str) -> anyhow::Result<String> {
    let toplevel_output = no_window_command("git")
        .arg("-C")
        .arg(workspace)
        .arg("rev-parse")
        .arg("--show-toplevel")
        .output()?;
    if !toplevel_output.status.success() {
        anyhow::bail!("{workspace} is not a Git repository");
    }
    let root = String::from_utf8_lossy(&toplevel_output.stdout).trim().to_string();
    let root_canon = std::fs::canonicalize(Path::new(&root))?;
    let note_canon = std::fs::canonicalize(Path::new(note_path))?;
    let relative = note_canon.strip_prefix(&root_canon).map_err(|_| {
        anyhow::anyhow!("{note_path} is not inside repo root {}", root_canon.display())
    })?;
    // git's <rev>:<path> syntax wants forward slashes even on Windows,
    // matching how detect_repo_mode already normalises rev-parse
    // --show-toplevel's own output before comparing paths.
    let relative_git = relative.to_string_lossy().replace('\\', "/");

    let output = no_window_command("git")
        .arg("-C")
        .arg(workspace)
        .arg("show")
        .arg(format!("{sha}:{relative_git}"))
        .output()?;

    if !output.status.success() {
        anyhow::bail!(
            "git show failed for {sha}:{relative_git}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

#[tauri::command]
pub async fn read_note_at_commit(
    workspace: String,
    note_path: String,
    sha: String,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || read_note_at_commit_at(&workspace, &note_path, &sha))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test read_note_at_commit`
Expected: PASS, both cases.

- [ ] **Step 5: Register the command, build, test, clippy**

In `src-tauri/src/lib.rs`, add next to `commands::git::list_note_history,`:

```rust
            commands::git::read_note_at_commit,
```

Run: `cd src-tauri && cargo build`
Expected: compiles clean.

Run: `cd src-tauri && cargo test`
Expected: full suite passes, six more tests than before Task 1 (four from Task 1, two from Task 2).

Run: `cd src-tauri && cargo clippy -- -D warnings`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/git.rs src-tauri/src/lib.rs
git commit -m "feat: add read_note_at_commit command"
```

---

### Task 3: `NoteHistoryPanel` component (frontend)

**Files:**
- Modify: `src/types/index.ts` (add `NoteHistoryEntry`)
- Modify: `src/lib/tauri.ts` (add `api.git.listNoteHistory`/`readNoteAtCommit`)
- Create: `src/components/NoteHistoryPanel.tsx`
- Test: `src/components/NoteHistoryPanel.test.tsx`

**Interfaces:**
- Consumes: `list_note_history`/`read_note_at_commit` Tauri commands from Tasks 1-2.
- Produces: `NoteHistoryPanel` React component, props `{ notePath: string; saveState: SaveState; onRestore: (content: string) => void }` — consumed by Task 4.

- [ ] **Step 1: Add the `NoteHistoryEntry` type**

In `src/types/index.ts`, add after `RepoInitOutcome` (end of file, after line 78):

```ts
export interface NoteHistoryEntry {
  sha: string
  timestampMs: number
  message: string
}
```

- [ ] **Step 2: Add the API bindings**

In `src/lib/tauri.ts`, add to the `git: { ... }` block (after `initNotesRepo`, before the closing `},` at line 106-107):

```ts
    listNoteHistory: (workspace: string, notePath: string) =>
      invoke<NoteHistoryEntry[]>('list_note_history', { workspace, notePath }),
    readNoteAtCommit: (workspace: string, notePath: string, sha: string) =>
      invoke<string>('read_note_at_commit', { workspace, notePath, sha }),
```

Add `NoteHistoryEntry` to this file's existing type imports from `../types`.

- [ ] **Step 3: Write the failing tests**

Create `src/components/NoteHistoryPanel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NoteHistoryPanel } from './NoteHistoryPanel'
import { useWorkspaceStore } from '../store/workspace'
import { api } from '../lib/tauri'

vi.mock('../lib/tauri', () => ({
  api: {
    git: {
      listNoteHistory: vi.fn(),
      readNoteAtCommit: vi.fn(),
    },
  },
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({
  confirm: vi.fn(),
}))

const listNoteHistory = vi.mocked(api.git.listNoteHistory)
const readNoteAtCommit = vi.mocked(api.git.readNoteAtCommit)

beforeEach(() => {
  useWorkspaceStore.setState({ path: '/ws' })
  listNoteHistory.mockResolvedValue([])
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('NoteHistoryPanel', () => {
  it('shows an empty state when the note has no history', async () => {
    render(<NoteHistoryPanel notePath="/ws/Todo.md" saveState="clean" onRestore={vi.fn()} />)

    expect(await screen.findByText(/No history yet/)).toBeInTheDocument()
  })

  it('lists commits newest first with timestamp and message', async () => {
    listNoteHistory.mockResolvedValue([
      { sha: 'b', timestampMs: 2000, message: 'notes: update Todo' },
      { sha: 'a', timestampMs: 1000, message: 'notes: update Todo' },
    ])

    render(<NoteHistoryPanel notePath="/ws/Todo.md" saveState="clean" onRestore={vi.fn()} />)

    const items = await screen.findAllByText('notes: update Todo')
    expect(items).toHaveLength(2)
  })

  it('previews a commit\'s content when clicked', async () => {
    const user = userEvent.setup()
    listNoteHistory.mockResolvedValue([{ sha: 'a', timestampMs: 1000, message: 'notes: update Todo' }])
    readNoteAtCommit.mockResolvedValue('# Todo\n\n- old content\n')

    render(<NoteHistoryPanel notePath="/ws/Todo.md" saveState="clean" onRestore={vi.fn()} />)

    await user.click(await screen.findByText('notes: update Todo'))

    expect(readNoteAtCommit).toHaveBeenCalledWith('/ws', '/ws/Todo.md', 'a')
    expect(await screen.findByText(/old content/)).toBeInTheDocument()
  })

  it('restores immediately when the buffer is clean', async () => {
    const user = userEvent.setup()
    const onRestore = vi.fn()
    listNoteHistory.mockResolvedValue([{ sha: 'a', timestampMs: 1000, message: 'notes: update Todo' }])
    readNoteAtCommit.mockResolvedValue('# Todo\n\n- old content\n')

    render(<NoteHistoryPanel notePath="/ws/Todo.md" saveState="clean" onRestore={onRestore} />)

    await user.click(await screen.findByText('notes: update Todo'))
    await user.click(await screen.findByRole('button', { name: /Restore this version/ }))

    expect(onRestore).toHaveBeenCalledWith('# Todo\n\n- old content\n')
  })

  it('confirms before restoring when the buffer is dirty', async () => {
    const { confirm } = await import('@tauri-apps/plugin-dialog')
    vi.mocked(confirm).mockResolvedValue(true)
    const user = userEvent.setup()
    const onRestore = vi.fn()
    listNoteHistory.mockResolvedValue([{ sha: 'a', timestampMs: 1000, message: 'notes: update Todo' }])
    readNoteAtCommit.mockResolvedValue('# Todo\n\n- old content\n')

    render(<NoteHistoryPanel notePath="/ws/Todo.md" saveState="dirty" onRestore={onRestore} />)

    await user.click(await screen.findByText('notes: update Todo'))
    await user.click(await screen.findByRole('button', { name: /Restore this version/ }))

    expect(confirm).toHaveBeenCalledWith('You have unsaved changes — restoring will discard them.')
    expect(onRestore).toHaveBeenCalledWith('# Todo\n\n- old content\n')
  })

  it('does not restore when the confirm is declined', async () => {
    const { confirm } = await import('@tauri-apps/plugin-dialog')
    vi.mocked(confirm).mockResolvedValue(false)
    const user = userEvent.setup()
    const onRestore = vi.fn()
    listNoteHistory.mockResolvedValue([{ sha: 'a', timestampMs: 1000, message: 'notes: update Todo' }])
    readNoteAtCommit.mockResolvedValue('# Todo\n\n- old content\n')

    render(<NoteHistoryPanel notePath="/ws/Todo.md" saveState="dirty" onRestore={onRestore} />)

    await user.click(await screen.findByText('notes: update Todo'))
    await user.click(await screen.findByRole('button', { name: /Restore this version/ }))

    await waitFor(() => expect(confirm).toHaveBeenCalledOnce())
    expect(onRestore).not.toHaveBeenCalled()
  })

  it('shows an inline error when the history fetch fails, without blocking the rest of the note', async () => {
    listNoteHistory.mockRejectedValue(new Error('git log failed'))

    render(<NoteHistoryPanel notePath="/ws/Todo.md" saveState="clean" onRestore={vi.fn()} />)

    expect(await screen.findByText(/Couldn't load history/)).toBeInTheDocument()
  })

  it('shows an inline error when reading a historical version fails', async () => {
    listNoteHistory.mockResolvedValue([{ sha: 'a', timestampMs: 1000, message: 'notes: update Todo' }])
    readNoteAtCommit.mockRejectedValue(new Error('git show failed'))
    const user = userEvent.setup()

    render(<NoteHistoryPanel notePath="/ws/Todo.md" saveState="clean" onRestore={vi.fn()} />)

    await user.click(await screen.findByText('notes: update Todo'))

    expect(await screen.findByText(/Couldn't load that version/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/components/NoteHistoryPanel.test.tsx`
Expected: FAIL — `Cannot find module './NoteHistoryPanel'`.

- [ ] **Step 3: Write the implementation**

Create `src/components/NoteHistoryPanel.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'
import { confirm } from '@tauri-apps/plugin-dialog'
import { useWorkspaceStore } from '../store/workspace'
import { api } from '../lib/tauri'
import type { SaveState } from '../hooks/useNote'
import type { NoteHistoryEntry } from '../types'

interface NoteHistoryPanelProps {
  notePath: string
  saveState: SaveState
  onRestore: (content: string) => void
}

export function NoteHistoryPanel({ notePath, saveState, onRestore }: NoteHistoryPanelProps) {
  const workspacePath = useWorkspaceStore((s) => s.path)
  const [entries, setEntries] = useState<NoteHistoryEntry[]>([])
  const [collapsed, setCollapsed] = useState(false)
  const [selected, setSelected] = useState<NoteHistoryEntry | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)

  useEffect(() => {
    if (!workspacePath) return
    setListError(null)
    api.git
      .listNoteHistory(workspacePath, notePath)
      .then(setEntries)
      .catch((e: unknown) => setListError(`Couldn't load history: ${String(e)}`))
    setSelected(null)
    setPreview(null)
    setPreviewError(null)
  }, [workspacePath, notePath])

  async function handleSelect(entry: NoteHistoryEntry) {
    if (!workspacePath) return
    setSelected(entry)
    setPreview(null)
    setPreviewError(null)
    try {
      const content = await api.git.readNoteAtCommit(workspacePath, notePath, entry.sha)
      setPreview(content)
    } catch (e) {
      setPreviewError(`Couldn't load that version: ${String(e)}`)
    }
  }

  async function handleRestore() {
    if (preview === null) return
    if (saveState !== 'clean') {
      const proceed = await confirm('You have unsaved changes — restoring will discard them.')
      if (!proceed) return
    }
    onRestore(preview)
  }

  return (
    <div className="note-history-panel">
      <button className="note-history-toggle" onClick={() => setCollapsed((c) => !c)}>
        {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />} History ({entries.length})
      </button>
      {!collapsed && (
        listError ? (
          <p className="note-history-error">{listError}</p>
        ) : entries.length === 0 ? (
          <p className="note-history-empty">
            No history yet — this note hasn&apos;t been committed.
          </p>
        ) : (
          <>
            <ul className="note-history-list">
              {entries.map((entry) => (
                <li key={entry.sha}>
                  <button
                    className="note-history-item"
                    onClick={() => void handleSelect(entry)}
                  >
                    <span className="note-history-timestamp">
                      {new Date(entry.timestampMs).toLocaleString()}
                    </span>
                    <span className="note-history-message">{entry.message}</span>
                  </button>
                </li>
              ))}
            </ul>
            {selected && previewError && (
              <p className="note-history-error">{previewError}</p>
            )}
            {selected && preview !== null && (
              <div className="note-history-preview">
                <pre>{preview}</pre>
                <button className="note-history-restore" onClick={() => void handleRestore()}>
                  Restore this version
                </button>
              </div>
            )}
          </>
        )
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/components/NoteHistoryPanel.test.tsx`
Expected: PASS, all eight cases.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/types/index.ts src/lib/tauri.ts src/components/NoteHistoryPanel.tsx src/components/NoteHistoryPanel.test.tsx
git commit -m "feat: add NoteHistoryPanel component"
```

---

### Task 4: Mount `NoteHistoryPanel` in `Layout`

**Files:**
- Modify: `src/components/Layout.tsx`
- Modify: `src/index.css` (styling, reusing `BacklinksPanel`'s existing class conventions as a base)
- Test: `src/components/Layout.test.tsx` (extend)

**Interfaces:**
- Consumes: `NoteHistoryPanel` from Task 3, `save`/`saveState`/`repoMode` already available in `Layout.tsx`'s existing scope (`Layout.tsx:52-68`, `Layout.tsx:68`).

- [ ] **Step 1: Write the failing test**

Add a new `describe` block to `src/components/Layout.test.tsx`, reusing the file's existing mock harness. This needs `api.git.listNoteHistory` added to the file's `../lib/tauri` mock — extend the existing mock factory:

```ts
vi.mock('../lib/tauri', () => ({
  api: {
    workspace: { initialWorkspace: vi.fn().mockResolvedValue(null) },
    settings: {
      load: vi.fn().mockResolvedValue({
        autosaveDebounceMs: 600,
        editorMaxWidthPx: 800,
        spellcheck: false,
        spellcheckLanguage: 'de',
        pdfImportMode: 'pages',
        editorCommand: 'code -g {file}:{line}',
        terminalShell: 'powershell',
      }),
    },
    terminal: { close: vi.fn().mockResolvedValue(undefined) },
    window: { confirmClose: vi.fn().mockResolvedValue(undefined) },
    notes: {
      notesWithTag: vi.fn().mockResolvedValue([]),
      listOpenTasks: vi.fn().mockResolvedValue([]),
      listDueCards: vi.fn().mockResolvedValue([]),
    },
    git: {
      listNoteHistory: vi.fn().mockResolvedValue([]),
    },
  },
}))
```

(This replaces the file's existing `vi.mock('../lib/tauri', ...)` factory — only the new `git` key is added, every other entry stays exactly as-is.)

Add the test:

```tsx
describe('Layout note history panel', () => {
  it('shows the history panel only when the workspace is a Git repository', () => {
    useWorkspaceStore.setState({
      path: '/ws',
      activeTab: '/ws/Lecture.md',
      tagFilter: null,
      repoMode: null,
    })
    useNotesStore.setState({
      notes: [{ id: '1', path: '/ws/Lecture.md', title: 'Lecture', workspace: '/ws', updatedAt: 0 }],
      folders: [],
      tags: [],
    })

    render(<Layout />)

    expect(screen.queryByText(/History \(/)).not.toBeInTheDocument()
  })

  it('shows the history panel when the workspace is a Git repository', async () => {
    useWorkspaceStore.setState({
      path: '/ws',
      activeTab: '/ws/Lecture.md',
      tagFilter: null,
      repoMode: 'notesOnly',
    })
    useNotesStore.setState({
      notes: [{ id: '1', path: '/ws/Lecture.md', title: 'Lecture', workspace: '/ws', updatedAt: 0 }],
      folders: [],
      tags: [],
    })

    render(<Layout />)

    expect(await screen.findByText(/History \(/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/components/Layout.test.tsx`
Expected: FAIL — no "History (" text exists anywhere yet.

- [ ] **Step 3: Wire it in**

In `src/components/Layout.tsx`, add the import:

```ts
import { NoteHistoryPanel } from './NoteHistoryPanel'
```

Add the mount site right after `BacklinksPanel` (`Layout.tsx:376-378`):

```tsx
              {!isLoading && activeTab && currentNote && (
                <BacklinksPanel notePath={activeTab} noteTitle={currentNote.title} />
              )}
              {!isLoading && activeTab && repoMode && (
                <NoteHistoryPanel
                  notePath={activeTab}
                  saveState={saveState}
                  onRestore={(content) => void save(content)}
                />
              )}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/components/Layout.test.tsx`
Expected: PASS, both new cases plus every existing case in the file.

- [ ] **Step 5: Add the CSS**

In `src/index.css`, find the `.backlinks-panel`/`.backlinks-toggle`/`.backlinks-empty`/`.backlinks-list`/`.backlink-item` rules and add matching `.note-history-*` rules right after them, reusing the same values (search for `.backlinks-panel {` to locate the block):

```css
.note-history-panel {
  margin-top: var(--space-md);
}

.note-history-toggle {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  background: none;
  border: none;
  color: var(--text-tertiary);
  font-size: 12px;
  cursor: pointer;
  padding: var(--space-xs) 0;
}

.note-history-empty {
  color: var(--text-tertiary);
  font: var(--text-empty-state);
  margin: 0;
}

.note-history-error { font-size: 12px; color: var(--danger); }

.note-history-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.note-history-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 100%;
  background: none;
  border: none;
  text-align: left;
  cursor: pointer;
  padding: var(--space-xs) 0;
}

.note-history-timestamp {
  color: var(--text-tertiary);
  font-size: 11px;
}

.note-history-message {
  color: var(--text-primary);
  font-size: 13px;
}

.note-history-preview {
  margin-top: var(--space-sm);
  padding: var(--space-sm);
  background: var(--bg-sunken);
  border: 1px solid var(--border);
  border-radius: 6px;
}

.note-history-preview pre {
  white-space: pre-wrap;
  font-size: 12px;
  max-height: 240px;
  overflow-y: auto;
  margin: 0 0 var(--space-sm);
}

.note-history-restore {
  background: none;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  color: var(--text-secondary);
  font-size: 12px;
  padding: var(--space-xs) var(--space-sm);
  cursor: pointer;
}

.note-history-restore:hover {
  color: var(--text-primary);
  border-color: var(--text-tertiary);
}
```

- [ ] **Step 6: Run the full test suite and typecheck**

Run: `npm test -- --run`
Expected: PASS.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/Layout.tsx src/components/Layout.test.tsx src/index.css
git commit -m "feat: mount NoteHistoryPanel in Layout, gated on repoMode"
```

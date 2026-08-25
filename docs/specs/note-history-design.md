# Note history

## Problem

The product-completion audit ("The Last Five Percent") found that null-notes' actual data safety (atomic writes, opt-in Git auto-commit) is invisible to the user — there's no way to answer "is my work safe right now" by looking at the app. The original framing proposed surfacing Git-backed commit history as a general safety net. That framing overreaches: Git auto-commit is off by default and only ever turns on for a workspace the user explicitly opts in for, so any Git-history feature only ever reaches users who already have it enabled — it cannot be the app's answer to data safety for everyone. This spec scopes the feature down to what it actually is: a convenience for the subset of users who already have Git on, not a crash-recovery mechanism. The broader gap (protecting users who never enable Git) is out of scope here and remains an open, separately-scoped need.

## Where it lives

A new component, `NoteHistoryPanel`, structurally identical to the existing `BacklinksPanel` (`src/components/BacklinksPanel.tsx`): renders below the open note, fetches its own data in a `useEffect` keyed on the note's path, owns its own collapse toggle, renders its own empty state. It is a sibling to `BacklinksPanel` in `Layout.tsx`'s JSX, not a new overlay and not a new global toggle — no `OverlayKind` member, no keyboard shortcut, no new `Layout.tsx` state.

It is conditionally mounted only when `repoMode` (from `useWorkspaceStore`) is non-null — a workspace with Git off never renders it at all, the same way `SettingsPanel`'s own Git section only renders when `repoMode` is truthy. This is a deliberate, existing precedent in the codebase, not a new convention.

## Data & backend

Two new Tauri commands in `src-tauri/src/commands/git.rs`, alongside the existing Git commands, both read-only:

**`list_note_history(workspace: String, note_path: String) -> Result<Vec<NoteHistoryEntry>, String>`**
Runs `git -C <workspace> log --follow -- <note_path>`, capped to the 20 most recent commits touching that path. `note_path` is the note's existing absolute path (the same convention `checked_auto_commit`'s `paths` argument already uses — git accepts an absolute pathspec fine regardless of `-C`). Output is structured (one record per commit: SHA, Unix timestamp, subject line) using a field delimiter that survives arbitrary characters in a commit message — the exact format string is an implementation detail for the plan, not this spec. `NoteHistoryEntry { sha: String, timestamp_ms: i64, message: String }`, `timestamp_ms` matching the existing `updated_at`/`now_ms()` millisecond convention used elsewhere (`NoteMetadata`).

**`read_note_at_commit(workspace: String, note_path: String, sha: String) -> Result<String, String>`**
Runs `git -C <workspace> show <sha>:<repo-relative-path>` to read the note's content as of that commit. Unlike `list_note_history`'s pathspec, this needs a path *relative to the repo root*, not the workspace — `git`'s `<rev>:<path>` object syntax is always root-relative, and workspace and repo root differ in `RepoMode::CodeRepo` (workspace is a subtree of the repo). Compute the repo root via `git -C <workspace> rev-parse --show-toplevel` (the same call `detect_repo_mode` already makes) and strip it as a prefix from `note_path` before building the `<sha>:<path>` argument. This is the one place in the feature where `RepoMode::CodeRepo` needs explicit handling — everywhere else, treating `workspace` as if it were the repo root is correct. Covered by a dedicated test against a repo where the workspace is a subdirectory, not just a `notesOnly` fixture.

Neither command mutates anything; both are safe to call without the `unsafe_repo_state` guard `checked_auto_commit` needs.

## Frontend

`api.git.listNoteHistory(workspace, notePath)` and `api.git.readNoteAtCommit(workspace, notePath, sha)`, added to `src/lib/tauri.ts` alongside the existing `api.git.*` bindings.

`NoteHistoryPanel` props: `notePath: string`, `saveState: SaveState` (from `useNote`, already threaded through `Layout.tsx` — needed to know whether the buffer is dirty before restoring), `onRestore: (content: string) => void`. `Layout.tsx` wires `onRestore` to the same `save` function it already passes to `NoteEditor`'s `onChange` — restoring is not a new write path, it's "the buffer now holds old content," which flows through the exact same debounced/atomic/reindexed save every keystroke already uses, and becomes a new commit on the next auto-commit cycle like any other edit.

Behavior:
- List renders newest first: `new Date(entry.timestampMs).toLocaleString()` + commit message. No existing date-formatting utility or convention exists anywhere else in the frontend to match — `toLocaleString()` is the concrete choice here, not a placeholder for one found elsewhere.
- Clicking a commit fetches and shows that version's content read-only in the panel (not a diff — plain content, matching the "list + restore" scope already agreed).
- A "Restore this version" action on the previewed commit: if `saveState !== 'clean'`, confirm first ("You have unsaved changes — restoring will discard them.") via the same native `@tauri-apps/plugin-dialog` `confirm()` the rest of the app already uses for destructive actions (`TreeNode`'s delete, `FolderContextMenu`'s delete). Then calls `onRestore(content)`.

## Error handling & empty states

- No commits yet for this note (empty `list_note_history` result): empty state in the app's established "what this is / what to do next" shape — "No history yet — this note hasn't been committed." No error, no icon needed beyond what `BacklinksPanel`'s own empty state already uses as a pattern.
- `git log`/`git show` failures (corrupt repo, git binary missing mid-session, etc.): shown inline in the panel, matching `BacklinksPanel`'s own error surface conventions — never blocks editing, never surfaces as a blocking dialog.
- Restore itself cannot fail in a new way: it's the existing `save` path, which already has its own error handling (`SaveStatus`'s retry/dismiss chip).

## Testing

**Rust** (`src-tauri/src/commands/git.rs`, alongside `checked_auto_commit`'s existing test module): real `git` calls against a `tempdir`-backed repo, mirroring that module's established style rather than mocking git. Cases: history lists commits touching only the given path, newest first, capped at 20; a renamed note's history survives across the rename (`--follow`); `read_note_at_commit` returns the exact historical content for a given SHA; a `CodeRepo`-shaped fixture (workspace as a subdirectory of the repo root) proves the repo-root-relative path computation is correct, not just the `NotesOnly` case where workspace and repo root coincide; a path with no history returns an empty list, not an error.

**Frontend** (`NoteHistoryPanel.test.tsx`, mirroring `BacklinksPanel.test.tsx`'s conventions): renders the commit list from a mocked `api.git.listNoteHistory`; empty state when the list is empty; clicking a commit calls `readNoteAtCommit` and shows the returned content; "Restore" calls `onRestore` directly when the buffer is clean; "Restore" confirms first when `saveState !== 'clean'` and only calls `onRestore` if confirmed.

## Out of scope

- Any mechanism for users who never enable Git — the audit's original "safety net for everyone" framing. Left as a genuinely open, separately-scoped need.
- Diffing between versions — the panel shows a previewed version's raw content, not a diff against current.
- A workspace-wide history view (all notes, not just the open one) — the per-note panel was chosen specifically over this in brainstorming.
- Any change to how or when auto-commit itself runs (`useGitAutoCommit.ts`) — this feature only reads history that mechanism already produces.

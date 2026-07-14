# Folder Navigation Design

**Goal:** Replace the flat, single-directory note list with a recursive folder tree in the sidebar, with full in-app folder management (create, rename, delete, move notes via drag-and-drop).

**Why now:** The sidebar currently reflects only the top level of the workspace folder. As a workspace grows past a handful of notes, a flat list stops scaling. This is the first of two organization features (folders, then tags + backlinks) — folders is a pure filesystem/UI change with no shared machinery with the second, so it ships independently.

**Non-goals (out of scope for this spec):** Tags, backlinks, folder drag-and-drop (only notes are draggable in v1 — folders are created/renamed/deleted, not reordered by dragging), nested-folder depth limits (any depth is allowed).

---

## 1. Data model & backend

No new SQLite tables. Folder structure stays filesystem-derived, consistent with the existing rule that `.md` files are the source of truth and SQLite is a rebuildable index.

### Bug fix: `workspace` field semantics

`save_note` currently derives the `workspace` field via `workspace_of(&path)`, which returns the note's *immediate parent directory*. This is harmless today because all notes are flat in the workspace root (parent dir == root), but it silently breaks `list_by_workspace` the moment a note lives in a subfolder — the note would be indexed under its subfolder path instead of the true root, and would vanish from `list_notes(workspace)` queries.

**Fix:** `save_note` takes an explicit `workspace: String` parameter from the frontend (which already knows the true root via `useWorkspaceStore`), matching the pattern `create_note` already uses. `workspace_of()` is removed.

### Recursive scan

`scan_workspace` currently performs a single non-recursive `read_dir` over the workspace root. It becomes recursive:

- Walks all subdirectories under the workspace root.
- Returns both the existing `Vec<NoteMetadata>` *and* a new `Vec<String>` of folder paths (relative or absolute — absolute, consistent with `NoteMetadata.path`), so that empty folders (no notes yet) still appear in the tree.
- **Excludes** any directory whose name ends in `.ink` — these are ink-sketch sidecars (`<note>.ink/`), not organizational folders, and must never be shown or treated as drop targets.
- **Excludes** dot-directories (`.git`, etc).

Return shape becomes a new struct:

```rust
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTree {
    pub notes: Vec<NoteMetadata>,
    pub folders: Vec<String>,
}
```

`scan_workspace` returns `WorkspaceTree` going forward. (`list_notes` is unrelated dead code today — it's declared but never called from the frontend, which only uses `scan_workspace` on open — and is out of scope for this change.)

### New commands

| Command | Signature | Behavior |
|---|---|---|
| `create_folder` | `(parent: String, name: String) -> Result<String, String>` | `tokio::fs::create_dir`, returns new folder's absolute path |
| `rename_folder` | `(old_path: String, new_path: String) -> Result<(), String>` | `tokio::fs::rename`, then bulk-updates the DB: every note whose `path` starts with `old_path + separator` gets that prefix rewritten to `new_path + separator` |
| `delete_folder` | `(path: String) -> Result<(), String>` | `tokio::fs::remove_dir_all`, then bulk-removes every note whose `path` starts with `path + separator` from `notes` and `notes_fts` |
| `move_note` | `(path: String, dest_folder: String) -> Result<NoteMetadata, String>` | Renames the note file into `dest_folder` (and its `.ink` sidecar dir, if present) via `tokio::fs::rename`, updates that note's DB/FTS row |

`db::notes` gains a `rename_path_prefix(pool, old_prefix, new_prefix)` and `remove_notes_under(pool, prefix)` to back `rename_folder`/`delete_folder`.

---

## 2. Frontend components

`Sidebar.tsx` currently renders a flat `<ul>` of notes. It's refactored into:

- **`Sidebar.tsx`** (top-level) — keeps workspace controls (Open Workspace, title-filter search input, search-open button) and renders `FolderTree` in place of the flat list.
- **`FolderTree.tsx`** — recursive component. Takes the flat `folders: string[]` and `notes: NoteMetadata[]` and builds a nested tree client-side by splitting each path on the workspace root and path separator. Renders folders as collapsible nodes (chevron + name), notes as leaf rows.
- **`TreeNode.tsx`** — a single row (folder or note): click-to-open (note) or click-to-expand (folder), right-click context menu, and drag-and-drop source (note) / target (folder) behavior.

The nested-tree-building function (flat paths → tree) is pure data transformation with no React dependency — it lives in `src/lib/folderTree.ts` per the project's "pure utilities, no React" convention, independently unit-testable.

### State additions

- `useNotesStore` gains `folders: string[]` alongside `notes`, populated by `scan_workspace` / `create_folder` / `rename_folder` / `delete_folder` / `move_note` responses.
- Expanded/collapsed folder state persists in the existing `.workspace.json` session file alongside open tabs, defaulting to **all expanded** the first time a workspace is opened.
- A "selected folder" (last-clicked folder row, defaulting to the workspace root) determines where **New Note** and **New Folder** land.

### Interactions

- **New Folder**: prompt for a name (same `prompt()` pattern as New Note today), created under the selected folder.
- **Rename / Delete folder**: right-click context menu on a folder row. Delete requires confirmation naming the note count being removed (e.g. "Delete 'Algorithms' and its 4 notes? This cannot be undone.").
- **Move note into folder**: drag a note row onto a folder row; the drop target highlights on drag-over. Folders are not draggable in v1 — only notes move.

---

## 3. Edge cases & error handling

- **Ink sidecars** are filtered out of the tree at scan time (backend) — never shown, never a drop target. `move_note` and `rename_folder` carry the sidecar along automatically since both operate as a filesystem rename of the parent directory, which moves its contents (including `<name>.ink/`) with it.
- **Name collisions** (creating a folder/note, or moving a note, where the target path already exists) surface as `Result<_, String>` errors, shown inline the same way `ImportButton` already surfaces import failures — not swallowed silently.
- **Renaming a folder with open tabs inside it**: after a successful rename, the frontend rewrites any `openTabs` / `activeTab` entries whose path had the old prefix to the new prefix, so tabs don't point at now-nonexistent files.
- **Deleting a folder with open tabs inside it**: same idea — close any open tabs whose path was under the deleted folder.
- **Empty folders persist across sessions**: since `scan_workspace` returns folder paths independently of notes, a folder created and left empty still appears after reopening the workspace.
- **Root-level notes** (today's only case) are unaffected — folders are purely additive; a workspace with zero subfolders behaves exactly as it does today.

---

## 4. Testing

- **Rust**: unit tests for the recursive scan (nested directories, `.ink` exclusion, dot-directory exclusion) and for `create_folder` / `rename_folder` / `delete_folder`, plus the bulk path-prefix DB update — using the existing `tempdir()`-based pattern already established in `db::notes` tests.
- **Frontend**: `src/lib/folderTree.ts`'s flat-paths-to-tree transform gets a Vitest unit test (pure function, no React, no mocking needed).
- **Manual smoke test**: create nested folders, drag a note between folders, rename a folder that has an open tab inside it, delete a non-empty folder and confirm its tabs close.

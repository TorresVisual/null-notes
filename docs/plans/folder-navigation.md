# Folder Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (default) or superpowers:subagent-driven-development if explicitly requested.

**Goal:** Replace the flat, single-directory note list with a recursive folder tree in the sidebar, with full in-app folder management (create, rename, delete, move notes via drag-and-drop).

**Architecture:** Folders stay filesystem-derived — no new SQLite table. The backend recursively scans the workspace and returns both notes and folder paths; the frontend builds a nested tree from those flat lists at render time. Folder rename/delete cascade via SQL prefix-rewrite on the `notes`/`notes_fts` tables, matched on a path-separator boundary to avoid `Course1` prefix-matching `Course10`.

**Tech Stack:** Tauri 2, Rust, sqlx (SQLite), React 19, TypeScript strict, Zustand, Vitest

**Spec:** `docs/specs/folder-navigation-design.md`

## Global Constraints

- Tauri 2 only — `@tauri-apps/api/core` for `invoke`
- TypeScript strict mode — no `any`, no non-null assertions unless the null case is structurally impossible
- No `.unwrap()` / `.expect()` outside `#[cfg(test)]` in Rust
- `cargo clippy -- -D warnings` must pass clean
- All Tauri commands return `Result<T, String>`
- Notes stored as plain `.md` files — source of truth is always the filesystem; SQLite is a rebuildable index
- `.ink` sidecar directories are never treated as folders
- Tauri JS↔Rust param names auto-convert camelCase↔snake_case (confirmed via existing `notePath`→`note_path`, `pdfPath`→`pdf_path` commands) — no manual renaming needed in `invoke()` calls
- Every task ends with the build green (`npm run typecheck`/`npm run build`/`cargo build` all passing) — no task intentionally leaves a broken intermediate commit

---

## File Map

### src-tauri/

| File | Change |
|---|---|
| `src/models.rs` | Add `WorkspaceTree`; add `expanded_folders` to `WorkspaceState` |
| `src/commands/notes.rs` | Fix `save_note` workspace param; recursive `scan_workspace`; add `create_folder`/`rename_folder`/`delete_folder`/`move_note`; `create_note` gains `folder` param |
| `src/db/notes.rs` | Add `rename_path_prefix`, `remove_notes_under`, `update_path` |
| `src/commands/workspace.rs` | Add `expanded_folders` field + backward-compat test |
| `src/lib.rs` | Register new commands |

### src/ (frontend)

| File | Change |
|---|---|
| `types/index.ts` | Add `WorkspaceTree`; add `expandedFolders` to `WorkspaceState` |
| `lib/tauri.ts` | Update `scan`/`save`/`create` signatures; add `createFolder`/`renameFolder`/`deleteFolder`/`moveNote` |
| `lib/pathPrefix.ts` | New — `isUnderPath`, `replacePathPrefix` (pure, tested) |
| `lib/folderTree.ts` | New — `buildFolderTree` (pure, tested) |
| `store/notes.ts` | Add `folders: string[]`, `setFolders` |
| `store/workspace.ts` | Add `expandedFolders`, `selectedFolder`, `folderContextMenu`, `folderError`, and related actions |
| `hooks/useWorkspace.ts` | `scan` → tree; expandedFolders restore/persist; new standalone `refreshTree()` |
| `hooks/useNote.ts` | Pass workspace root to `save` |
| `components/FolderTree.tsx` | New — top-level tree wrapper |
| `components/TreeNode.tsx` | New — recursive row (folder or note) |
| `components/FolderContextMenu.tsx` | New — rename/delete popup |
| `components/Sidebar.tsx` | Replace flat list with `FolderTree`; New Folder button; New Note targets `selectedFolder` |
| `components/ImportButton.tsx` | Update `create` call for new `folder` param |
| `index.css` | Tree/context-menu styles |

---

### Task 1: Fix `save_note` and `create_note` workspace-field correctness

**Files:**
- Modify: `src-tauri/src/commands/notes.rs`
- Modify: `src/lib/tauri.ts`
- Modify: `src/hooks/useNote.ts`
- Modify: `src/components/ImportButton.tsx`
- Modify: `src/components/Sidebar.tsx`

**Interfaces:**
- Produces: `save_note(path, workspace, content) -> Result<(), String>`; `create_note(workspace, folder, title) -> Result<NoteMetadata, String>` (folder-targeting groundwork used by later tasks; for now, always called with `folder == workspace`)

**Why this is first:** `save_note` currently derives `workspace` from the note's immediate parent directory. That's harmless today (all notes are flat), but it will silently corrupt the `workspace` column the moment a note lives in a subfolder — the note would vanish from `list_by_workspace` queries. This must be fixed before any subfolder support lands. `create_note` needs a `folder` param now too, since later tasks (New Note while a subfolder is selected) need to write the file into a specific folder while keeping `workspace` as the true root — bundling both fixes into one task avoids a broken intermediate state where `create_note`'s signature changes twice.

- [ ] **Step 1: Update `save_note` and remove `workspace_of` in `src-tauri/src/commands/notes.rs`**

Replace the `workspace_of` function and `save_note`/`create_note`:

```rust
// DELETE the workspace_of function (lines 24-29) entirely.

#[tauri::command]
pub async fn save_note(
    path: String,
    workspace: String,
    content: String,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    tokio::fs::write(&path, &content)
        .await
        .map_err(|e| e.to_string())?;

    let title = title_from_content(&content);
    let meta = NoteMetadata {
        id: Uuid::new_v4().to_string(),
        title: title.clone(),
        path: path.clone(),
        workspace,
        updated_at: now_ms(),
    };
    db::notes::index_note(&db, &meta)
        .await
        .map_err(|e| e.to_string())?;
    db::notes::index_note_content(&db, &path, &title, &content)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_note(
    workspace: String,
    folder: String,
    title: String,
    db: State<'_, DbPool>,
) -> Result<NoteMetadata, String> {
    let safe_name: String = title
        .chars()
        .map(|c| if c.is_alphanumeric() || c == ' ' { c } else { '-' })
        .collect();
    let filename = format!("{}.md", safe_name.trim());
    let path = std::path::Path::new(&folder).join(&filename);

    tokio::fs::write(&path, format!("# {}\n", title))
        .await
        .map_err(|e| e.to_string())?;

    let meta = NoteMetadata {
        id: Uuid::new_v4().to_string(),
        title: title.clone(),
        path: path.to_string_lossy().into_owned(),
        workspace,
        updated_at: now_ms(),
    };
    db::notes::index_note(&db, &meta)
        .await
        .map_err(|e| e.to_string())?;

    let body = format!("# {}", title);
    db::notes::index_note_content(&db, &meta.path, &meta.title, &body)
        .await
        .map_err(|e| e.to_string())?;

    Ok(meta)
}
```

- [ ] **Step 2: Verify Rust compiles and clippy passes**

```bash
cargo build --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

Expected: compiles clean, no clippy warnings.

- [ ] **Step 3: Update `src/lib/tauri.ts`**

```ts
export const api = {
  notes: {
    list: (workspace: string) =>
      invoke<NoteMetadata[]>('list_notes', { workspace }),
    scan: (workspace: string) =>
      invoke<NoteMetadata[]>('scan_workspace', { workspace }),
    open: (path: string) =>
      invoke<string>('open_note', { path }),
    save: (path: string, workspace: string, content: string) =>
      invoke<void>('save_note', { path, workspace, content }),
    create: (workspace: string, folder: string, title: string) =>
      invoke<NoteMetadata>('create_note', { workspace, folder, title }),
    delete: (path: string) =>
      invoke<void>('delete_note', { path }),
    search: (query: string) =>
      invoke<SearchResult[]>('search_notes', { query }),
  },
  workspace: {
    load: (path: string) =>
      invoke<WorkspaceState>('load_workspace', { path }),
    save: (path: string, state: WorkspaceState) =>
      invoke<void>('save_workspace', { path, state }),
  },
}
```

(The `scan` return type stays `NoteMetadata[]` for now — Task 2 changes it to `WorkspaceTree`. Keeping this task scoped to the workspace-field fix only.)

- [ ] **Step 4: Update `src/hooks/useNote.ts` to pass the workspace root**

```ts
import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/tauri'
import { useWorkspaceStore } from '../store/workspace'

export function useNote(path: string | null) {
  const [content, setContent] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const workspacePath = useWorkspaceStore((s) => s.path)

  useEffect(() => {
    if (!path) return
    setIsLoading(true)
    api.notes.open(path)
      .then(setContent)
      .finally(() => setIsLoading(false))
  }, [path])

  const save = useCallback(
    async (markdown: string) => {
      if (!path || !workspacePath) return
      setContent(markdown)
      await api.notes.save(path, workspacePath, markdown)
    },
    [path, workspacePath],
  )

  return { content, save, isLoading }
}
```

- [ ] **Step 5: Update `src/components/ImportButton.tsx`'s `create` call**

Change line 33 from `api.notes.create(workspacePath, result.title)` to:

```ts
const note = await api.notes.create(workspacePath, workspacePath, result.title)
```

(PDF imports always land at the workspace root — no folder-targeting UI for imports in this feature.)

- [ ] **Step 6: Update `Sidebar.tsx`'s `create` call to match the new signature**

Change line 30 from `api.notes.create(workspacePath, title)` to:

```ts
const meta = await api.notes.create(workspacePath, workspacePath, title)
```

(Sidebar gets real folder-targeting via `selectedFolder` in Task 9 — this step just keeps the build green in the meantime.)

- [ ] **Step 7: Typecheck and build**

```bash
npm run typecheck
npm run build
```

Expected: both pass with no errors.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/commands/notes.rs src/lib/tauri.ts src/hooks/useNote.ts src/components/ImportButton.tsx src/components/Sidebar.tsx
git commit -m "fix: save_note/create_note always record the true workspace root

save_note previously derived workspace from the note's immediate
parent directory, which is only correct when notes are flat in the
root. That silently breaks once folders exist. create_note gains a
folder param so notes can be written into a target directory while
workspace still names the true root."
```

---

### Task 2: `WorkspaceTree` model and recursive `scan_workspace`

**Files:**
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/commands/notes.rs`

**Interfaces:**
- Consumes: `NoteMetadata` (existing)
- Produces: `WorkspaceTree { notes: Vec<NoteMetadata>, folders: Vec<String> }`; `scan_dir_recursive(root: &Path, workspace: &str) -> anyhow::Result<(Vec<NoteMetadata>, Vec<String>)>`; `scan_workspace(workspace: String) -> Result<WorkspaceTree, String>`

- [ ] **Step 1: Add `WorkspaceTree` to `src-tauri/src/models.rs`**

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTree {
    pub notes: Vec<NoteMetadata>,
    pub folders: Vec<String>,
}
```

- [ ] **Step 2: Write the failing tests for the recursive scan in `src-tauri/src/commands/notes.rs`**

Add to the `#[cfg(test)] mod tests` block (add `use tempfile::tempdir;` to the existing `use super::*;` imports in that block):

```rust
#[tokio::test]
async fn test_scan_dir_recursive_finds_nested_notes() {
    let tmp = tempdir().unwrap();
    let root = tmp.path();
    std::fs::create_dir_all(root.join("Course101")).unwrap();
    std::fs::write(root.join("Course101/lecture1.md"), "# Lecture 1").unwrap();
    std::fs::write(root.join("root-note.md"), "# Root").unwrap();

    let ws = root.to_string_lossy().into_owned();
    let (notes, folders) = scan_dir_recursive(root, &ws).await.unwrap();

    assert_eq!(notes.len(), 2);
    assert_eq!(folders.len(), 1);
    assert!(folders[0].ends_with("Course101"));
}

#[tokio::test]
async fn test_scan_dir_recursive_excludes_ink_and_dot_dirs() {
    let tmp = tempdir().unwrap();
    let root = tmp.path();
    std::fs::create_dir_all(root.join("Note.ink")).unwrap();
    std::fs::write(root.join("Note.ink/sketch-1.svg"), "<svg></svg>").unwrap();
    std::fs::create_dir_all(root.join(".git")).unwrap();
    std::fs::write(root.join("Note.md"), "# Note").unwrap();

    let ws = root.to_string_lossy().into_owned();
    let (notes, folders) = scan_dir_recursive(root, &ws).await.unwrap();

    assert_eq!(notes.len(), 1);
    assert!(folders.is_empty());
}

#[tokio::test]
async fn test_scan_dir_recursive_lists_empty_folders() {
    let tmp = tempdir().unwrap();
    let root = tmp.path();
    std::fs::create_dir_all(root.join("Empty")).unwrap();

    let ws = root.to_string_lossy().into_owned();
    let (notes, folders) = scan_dir_recursive(root, &ws).await.unwrap();

    assert!(notes.is_empty());
    assert_eq!(folders.len(), 1);
}
```

- [ ] **Step 3: Run tests to verify they fail to compile**

```bash
cargo test --manifest-path src-tauri/Cargo.toml commands::notes
```

Expected: FAIL to compile — `scan_dir_recursive` not found.

- [ ] **Step 4: Implement `scan_dir_recursive` and update the `scan_workspace` command**

Change the top-of-file import from `use crate::models::{NoteMetadata, SearchResult};` to:

```rust
use crate::models::{NoteMetadata, SearchResult, WorkspaceTree};
```

Then add the following after the `now_ms`/`title_from_content` functions, and replace the existing `scan_workspace` command:

```rust
fn is_excluded_dir(name: &str) -> bool {
    name.ends_with(".ink") || name.starts_with('.')
}

async fn scan_dir_recursive(
    root: &std::path::Path,
    workspace: &str,
) -> anyhow::Result<(Vec<NoteMetadata>, Vec<String>)> {
    let mut notes = Vec::new();
    let mut folders = Vec::new();
    let mut stack = vec![root.to_path_buf()];

    while let Some(dir) = stack.pop() {
        let mut entries = tokio::fs::read_dir(&dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            let file_type = entry.file_type().await?;

            if file_type.is_dir() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if is_excluded_dir(&name) {
                    continue;
                }
                folders.push(path.to_string_lossy().into_owned());
                stack.push(path);
                continue;
            }

            if path.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }
            let path_str = path.to_string_lossy().into_owned();
            let title = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("Untitled")
                .to_string();
            let updated_at = entry
                .metadata()
                .await
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or_else(now_ms);
            notes.push(NoteMetadata {
                id: Uuid::new_v4().to_string(),
                title,
                path: path_str,
                workspace: workspace.to_string(),
                updated_at,
            });
        }
    }

    Ok((notes, folders))
}

#[tauri::command]
pub async fn scan_workspace(
    workspace: String,
    db: State<'_, DbPool>,
) -> Result<WorkspaceTree, String> {
    let (notes, folders) = scan_dir_recursive(std::path::Path::new(&workspace), &workspace)
        .await
        .map_err(|e| e.to_string())?;

    for meta in &notes {
        db::notes::index_note(&db, meta)
            .await
            .map_err(|e| e.to_string())?;
    }

    let indexed = db::notes::list_by_workspace(&db, &workspace)
        .await
        .map_err(|e| e.to_string())?;

    Ok(WorkspaceTree { notes: indexed, folders })
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cargo test --manifest-path src-tauri/Cargo.toml commands::notes
```

Expected: all `scan_dir_recursive` tests pass, plus the existing `title_from_content` tests still pass.

- [ ] **Step 6: Clippy**

```bash
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

Expected: clean (the crate won't fully build yet since `src/lib/tauri.ts`'s `scan` still expects `NoteMetadata[]` — that's fixed in Task 8; this step only checks the Rust side compiles and lints clean on its own).

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/models.rs src-tauri/src/commands/notes.rs
git commit -m "feat: recursive workspace scan returns notes and folder paths

scan_workspace now walks subdirectories (excluding .ink sidecars and
dot-directories) and returns a WorkspaceTree so empty folders are
visible in the sidebar even before they contain a note."
```

---

### Task 3: `db::notes` path-rewrite helpers

**Files:**
- Modify: `src-tauri/src/db/notes.rs`

**Interfaces:**
- Consumes: `SqlitePool`
- Produces: `rename_path_prefix(pool, old_prefix, new_prefix) -> anyhow::Result<()>`; `remove_notes_under(pool, prefix) -> anyhow::Result<()>`; `update_path(pool, old_path, new_path) -> anyhow::Result<()>`

**Why boundary-safety matters:** these are called with a folder path that has already had a separator appended by the caller (Task 4), so `LIKE` matching here is a simple string prefix — the boundary safety comes from the caller's contract, and the tests below verify a `Course1`/`Course10` sibling scenario stays isolated.

- [ ] **Step 1: Write the failing tests**

Add to the `#[cfg(test)] mod tests` block in `src-tauri/src/db/notes.rs`:

```rust
#[tokio::test]
async fn test_rename_path_prefix_updates_matching_notes_and_fts() {
    let pool = make_pool().await;
    index_note(&pool, &note("a", "A", "/ws/Course1/a.md", "/ws")).await.unwrap();
    index_note_content(&pool, "/ws/Course1/a.md", "A", "body text").await.unwrap();
    index_note(&pool, &note("b", "B", "/ws/Course10/b.md", "/ws")).await.unwrap();

    rename_path_prefix(&pool, "/ws/Course1/", "/ws/Renamed/").await.unwrap();

    let notes = list_by_workspace(&pool, "/ws").await.unwrap();
    let a = notes.iter().find(|n| n.id == "a").unwrap();
    let b = notes.iter().find(|n| n.id == "b").unwrap();
    assert_eq!(a.path, "/ws/Renamed/a.md");
    assert_eq!(b.path, "/ws/Course10/b.md");

    let fts_path: (String,) = sqlx::query_as("SELECT path FROM notes_fts WHERE title = 'A'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(fts_path.0, "/ws/Renamed/a.md");
}

#[tokio::test]
async fn test_remove_notes_under_deletes_matching_notes_and_fts_only() {
    let pool = make_pool().await;
    index_note(&pool, &note("a", "A", "/ws/Course1/a.md", "/ws")).await.unwrap();
    index_note_content(&pool, "/ws/Course1/a.md", "A", "body").await.unwrap();
    index_note(&pool, &note("b", "B", "/ws/Course10/b.md", "/ws")).await.unwrap();

    remove_notes_under(&pool, "/ws/Course1/").await.unwrap();

    let notes = list_by_workspace(&pool, "/ws").await.unwrap();
    assert_eq!(notes.len(), 1);
    assert_eq!(notes[0].id, "b");

    let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM notes_fts")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count.0, 0);
}

#[tokio::test]
async fn test_update_path_changes_a_single_note() {
    let pool = make_pool().await;
    index_note(&pool, &note("a", "A", "/ws/old.md", "/ws")).await.unwrap();
    update_path(&pool, "/ws/old.md", "/ws/Folder/old.md").await.unwrap();
    let notes = list_by_workspace(&pool, "/ws").await.unwrap();
    assert_eq!(notes[0].path, "/ws/Folder/old.md");
}
```

- [ ] **Step 2: Run tests to verify they fail to compile**

```bash
cargo test --manifest-path src-tauri/Cargo.toml db::notes
```

Expected: FAIL to compile — functions not found.

- [ ] **Step 3: Implement the three functions**

Add to `src-tauri/src/db/notes.rs` (after `remove_from_fts`):

```rust
pub async fn rename_path_prefix(pool: &SqlitePool, old_prefix: &str, new_prefix: &str) -> Result<()> {
    let like_pattern = format!("{}%", old_prefix.replace('%', "\\%").replace('_', "\\_"));
    let rows: Vec<(String,)> = sqlx::query_as("SELECT path FROM notes WHERE path LIKE ? ESCAPE '\\'")
        .bind(&like_pattern)
        .fetch_all(pool)
        .await?;

    for (old_path,) in rows {
        let new_path = format!("{}{}", new_prefix, &old_path[old_prefix.len()..]);
        update_path(pool, &old_path, &new_path).await?;
    }
    Ok(())
}

pub async fn remove_notes_under(pool: &SqlitePool, prefix: &str) -> Result<()> {
    let like_pattern = format!("{}%", prefix.replace('%', "\\%").replace('_', "\\_"));
    sqlx::query("DELETE FROM notes WHERE path LIKE ? ESCAPE '\\'")
        .bind(&like_pattern)
        .execute(pool)
        .await?;
    sqlx::query("DELETE FROM notes_fts WHERE path LIKE ? ESCAPE '\\'")
        .bind(&like_pattern)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn update_path(pool: &SqlitePool, old_path: &str, new_path: &str) -> Result<()> {
    sqlx::query("UPDATE notes SET path = ? WHERE path = ?")
        .bind(new_path)
        .bind(old_path)
        .execute(pool)
        .await?;
    sqlx::query("UPDATE notes_fts SET path = ? WHERE path = ?")
        .bind(new_path)
        .bind(old_path)
        .execute(pool)
        .await?;
    Ok(())
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cargo test --manifest-path src-tauri/Cargo.toml db::notes
```

Expected: all pass, including the pre-existing `test_index_and_list`, `test_upsert_updates_title`, `test_remove_note`.

- [ ] **Step 5: Clippy and commit**

```bash
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
git add src-tauri/src/db/notes.rs
git commit -m "feat: bulk path-prefix rewrite/delete helpers for folder rename/delete

rename_path_prefix and remove_notes_under back the upcoming
rename_folder/delete_folder commands. update_path handles the
single-note case used by move_note. Tests confirm a Course1/Course10
sibling pair stays isolated when the caller passes a
separator-terminated prefix."
```

---

### Task 4: Folder commands — create, rename, delete, move

**Files:**
- Modify: `src-tauri/src/commands/notes.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `db::notes::rename_path_prefix`, `remove_notes_under`, `update_path` (Task 3)
- Produces: `create_folder(parent, name) -> Result<String, String>`; `rename_folder(old_path, new_path) -> Result<(), String>`; `delete_folder(path) -> Result<(), String>`; `move_note(path, dest_folder) -> Result<String, String>`

- [ ] **Step 1: Write the failing tests**

Add a new `#[cfg(test)] mod folder_tests` block at the bottom of `src-tauri/src/commands/notes.rs` (separate from the existing `mod tests` so imports stay uncluttered):

```rust
#[cfg(test)]
mod folder_tests {
    use super::*;
    use tempfile::tempdir;
    use crate::db::schema::run_migrations;
    use crate::db::notes::index_note as db_index_note;

    async fn make_pool() -> DbPool {
        let pool = DbPool::connect("sqlite::memory:").await.unwrap();
        run_migrations(&pool).await.unwrap();
        pool
    }

    #[tokio::test]
    async fn test_create_folder_at_creates_directory() {
        let tmp = tempdir().unwrap();
        let parent = tmp.path().to_string_lossy().into_owned();
        let path = create_folder_at(&parent, "Course101").await.unwrap();
        assert!(std::path::Path::new(&path).is_dir());
    }

    #[tokio::test]
    async fn test_rename_folder_at_moves_dir_and_updates_notes() {
        let tmp = tempdir().unwrap();
        let root = tmp.path();
        let old_dir = root.join("Old");
        std::fs::create_dir_all(&old_dir).unwrap();
        std::fs::write(old_dir.join("note.md"), "# Note").unwrap();

        let pool = make_pool().await;
        let old_note_path = old_dir.join("note.md").to_string_lossy().into_owned();
        db_index_note(&pool, &NoteMetadata {
            id: "a".into(),
            title: "Note".into(),
            path: old_note_path,
            workspace: root.to_string_lossy().into_owned(),
            updated_at: 1000,
        }).await.unwrap();

        let new_dir = root.join("New").to_string_lossy().into_owned();
        rename_folder_at(&old_dir.to_string_lossy(), &new_dir, &pool).await.unwrap();

        assert!(std::path::Path::new(&new_dir).join("note.md").exists());
        let notes = db::notes::list_by_workspace(&pool, &root.to_string_lossy()).await.unwrap();
        let expected = std::path::Path::new(&new_dir).join("note.md").to_string_lossy().into_owned();
        assert_eq!(notes[0].path, expected);
    }

    #[tokio::test]
    async fn test_delete_folder_at_removes_dir_and_notes() {
        let tmp = tempdir().unwrap();
        let root = tmp.path();
        let dir = root.join("ToDelete");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("note.md"), "# Note").unwrap();

        let pool = make_pool().await;
        db_index_note(&pool, &NoteMetadata {
            id: "a".into(),
            title: "Note".into(),
            path: dir.join("note.md").to_string_lossy().into_owned(),
            workspace: root.to_string_lossy().into_owned(),
            updated_at: 1000,
        }).await.unwrap();

        delete_folder_at(&dir.to_string_lossy(), &pool).await.unwrap();

        assert!(!dir.exists());
        let notes = db::notes::list_by_workspace(&pool, &root.to_string_lossy()).await.unwrap();
        assert!(notes.is_empty());
    }

    #[tokio::test]
    async fn test_move_note_at_moves_file_and_ink_sidecar() {
        let tmp = tempdir().unwrap();
        let root = tmp.path();
        let src_dir = root.join("Src");
        let dest_dir = root.join("Dest");
        std::fs::create_dir_all(&src_dir).unwrap();
        std::fs::create_dir_all(&dest_dir).unwrap();
        std::fs::write(src_dir.join("note.md"), "# Note").unwrap();
        std::fs::create_dir_all(src_dir.join("note.ink")).unwrap();
        std::fs::write(src_dir.join("note.ink").join("sketch-1.svg"), "<svg></svg>").unwrap();

        let pool = make_pool().await;
        let old_path = src_dir.join("note.md").to_string_lossy().into_owned();
        db_index_note(&pool, &NoteMetadata {
            id: "a".into(),
            title: "Note".into(),
            path: old_path.clone(),
            workspace: root.to_string_lossy().into_owned(),
            updated_at: 1000,
        }).await.unwrap();

        let new_path = move_note_at(&old_path, &dest_dir.to_string_lossy(), &pool).await.unwrap();

        assert!(std::path::Path::new(&new_path).exists());
        assert!(dest_dir.join("note.ink").join("sketch-1.svg").exists());
        assert!(!src_dir.join("note.md").exists());
        let notes = db::notes::list_by_workspace(&pool, &root.to_string_lossy()).await.unwrap();
        assert_eq!(notes[0].path, new_path);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail to compile**

```bash
cargo test --manifest-path src-tauri/Cargo.toml commands::notes::folder_tests
```

Expected: FAIL to compile — `create_folder_at`/`rename_folder_at`/`delete_folder_at`/`move_note_at` not found.

- [ ] **Step 3: Implement the core functions and their thin command wrappers**

Add to `src-tauri/src/commands/notes.rs` (after the `search_notes` command, before the existing `#[cfg(test)] mod tests`):

```rust
async fn create_folder_at(parent: &str, name: &str) -> anyhow::Result<String> {
    let path = std::path::Path::new(parent).join(name);
    tokio::fs::create_dir(&path).await?;
    Ok(path.to_string_lossy().into_owned())
}

async fn rename_folder_at(old_path: &str, new_path: &str, db: &DbPool) -> anyhow::Result<()> {
    tokio::fs::rename(old_path, new_path).await?;
    let old_prefix = format!("{}{}", old_path, std::path::MAIN_SEPARATOR);
    let new_prefix = format!("{}{}", new_path, std::path::MAIN_SEPARATOR);
    db::notes::rename_path_prefix(db, &old_prefix, &new_prefix).await?;
    Ok(())
}

async fn delete_folder_at(path: &str, db: &DbPool) -> anyhow::Result<()> {
    tokio::fs::remove_dir_all(path).await?;
    let prefix = format!("{}{}", path, std::path::MAIN_SEPARATOR);
    db::notes::remove_notes_under(db, &prefix).await?;
    Ok(())
}

async fn move_note_at(path: &str, dest_folder: &str, db: &DbPool) -> anyhow::Result<String> {
    let file_name = std::path::Path::new(path)
        .file_name()
        .ok_or_else(|| anyhow::anyhow!("note path has no file name: {path}"))?
        .to_os_string();
    let new_path = std::path::Path::new(dest_folder).join(&file_name);
    tokio::fs::rename(path, &new_path).await?;

    let ink_dir = path.trim_end_matches(".md").to_string() + ".ink";
    if tokio::fs::metadata(&ink_dir).await.is_ok() {
        let new_ink_dir = new_path.to_string_lossy().trim_end_matches(".md").to_string() + ".ink";
        tokio::fs::rename(&ink_dir, &new_ink_dir).await?;
    }

    let new_path_str = new_path.to_string_lossy().into_owned();
    db::notes::update_path(db, path, &new_path_str).await?;
    Ok(new_path_str)
}

#[tauri::command]
pub async fn create_folder(parent: String, name: String) -> Result<String, String> {
    create_folder_at(&parent, &name).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rename_folder(old_path: String, new_path: String, db: State<'_, DbPool>) -> Result<(), String> {
    rename_folder_at(&old_path, &new_path, &db).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_folder(path: String, db: State<'_, DbPool>) -> Result<(), String> {
    delete_folder_at(&path, &db).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn move_note(path: String, dest_folder: String, db: State<'_, DbPool>) -> Result<String, String> {
    move_note_at(&path, &dest_folder, &db).await.map_err(|e| e.to_string())
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cargo test --manifest-path src-tauri/Cargo.toml commands::notes
```

Expected: all pass, including `folder_tests` and the pre-existing `title_from_content`/`scan_dir_recursive` tests.

- [ ] **Step 5: Register the new commands in `src-tauri/src/lib.rs`**

```rust
.invoke_handler(tauri::generate_handler![
    commands::notes::list_notes,
    commands::notes::scan_workspace,
    commands::notes::open_note,
    commands::notes::save_note,
    commands::notes::create_note,
    commands::notes::delete_note,
    commands::notes::search_notes,
    commands::notes::create_folder,
    commands::notes::rename_folder,
    commands::notes::delete_folder,
    commands::notes::move_note,
    commands::workspace::load_workspace,
    commands::workspace::save_workspace,
    commands::ink::ensure_ink_dir,
    commands::ink::read_ink,
    commands::ink::write_ink,
    commands::pdf::import_pdf,
])
```

- [ ] **Step 6: Clippy and build**

```bash
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo build --manifest-path src-tauri/Cargo.toml
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/commands/notes.rs src-tauri/src/lib.rs
git commit -m "feat: create/rename/delete folder and move-note commands

Each has a testable core function (create_folder_at, etc.) plus a
thin #[tauri::command] wrapper, matching the pattern already used by
load_workspace_from_dir/save_workspace_to_dir. move_note_at carries
a note's .ink sketch sidecar along automatically since it renames the
whole directory tree, not just the .md file."
```

---

### Task 5: `src/lib/pathPrefix.ts` — tab-path reconciliation helpers

**Files:**
- Create: `src/lib/pathPrefix.ts`
- Create: `src/lib/pathPrefix.test.ts`

**Interfaces:**
- Produces: `isUnderPath(path: string, prefix: string): boolean`; `replacePathPrefix(path: string, oldPrefix: string, newPrefix: string): string`

**Why this exists:** when a folder is renamed/deleted or a note is moved, any open tab whose path pointed into the old location needs to be rewritten (rename) or closed (delete) — otherwise a tab silently points at a file that no longer exists. This mirrors the same separator-boundary safety already tested on the Rust side in Task 3.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { isUnderPath, replacePathPrefix } from './pathPrefix'

describe('isUnderPath', () => {
  it('matches an exact path', () => {
    expect(isUnderPath('/ws/a.md', '/ws/a.md')).toBe(true)
  })

  it('matches a path nested under the prefix', () => {
    expect(isUnderPath('/ws/Course1/a.md', '/ws/Course1')).toBe(true)
  })

  it('does not match a sibling with a similar name', () => {
    expect(isUnderPath('/ws/Course10/a.md', '/ws/Course1')).toBe(false)
  })

  it('does not match an unrelated path', () => {
    expect(isUnderPath('/ws/Other/a.md', '/ws/Course1')).toBe(false)
  })
})

describe('replacePathPrefix', () => {
  it('replaces an exact match entirely', () => {
    expect(replacePathPrefix('/ws/a.md', '/ws/a.md', '/ws/Folder/a.md')).toBe('/ws/Folder/a.md')
  })

  it('replaces a nested path prefix', () => {
    expect(replacePathPrefix('/ws/Course1/a.md', '/ws/Course1', '/ws/Renamed')).toBe('/ws/Renamed/a.md')
  })

  it('leaves an unrelated path unchanged', () => {
    expect(replacePathPrefix('/ws/Course10/a.md', '/ws/Course1', '/ws/Renamed')).toBe('/ws/Course10/a.md')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test -- pathPrefix.test
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/pathPrefix.ts`**

```ts
export function isUnderPath(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}\\`)
}

export function replacePathPrefix(path: string, oldPrefix: string, newPrefix: string): string {
  if (path === oldPrefix) return newPrefix
  if (path.startsWith(`${oldPrefix}/`) || path.startsWith(`${oldPrefix}\\`)) {
    return newPrefix + path.slice(oldPrefix.length)
  }
  return path
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test -- pathPrefix.test
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pathPrefix.ts src/lib/pathPrefix.test.ts
git commit -m "feat: path-prefix helpers for tab reconciliation after folder rename/delete"
```

---

### Task 6: `src/lib/folderTree.ts` — flat paths to nested tree

**Files:**
- Create: `src/lib/folderTree.ts`
- Create: `src/lib/folderTree.test.ts`

**Interfaces:**
- Consumes: `NoteMetadata` (existing)
- Produces: `FolderTreeNode`, `NoteTreeNode`, `TreeEntry` (union); `buildFolderTree(root: string, folders: string[], notes: NoteMetadata[]): TreeEntry[]`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { buildFolderTree } from './folderTree'
import type { NoteMetadata } from '../types'

function note(title: string, path: string): NoteMetadata {
  return { id: title, title, path, workspace: '/ws', updatedAt: 0 }
}

describe('buildFolderTree', () => {
  it('places root-level notes directly under the root', () => {
    const n = note('Root Note', '/ws/Root Note.md')
    const tree = buildFolderTree('/ws', [], [n])
    expect(tree).toEqual([{ type: 'note', name: 'Root Note', path: '/ws/Root Note.md', note: n }])
  })

  it('nests notes under their folder', () => {
    const n = note('Lecture 1', '/ws/Course101/Lecture 1.md')
    const tree = buildFolderTree('/ws', ['/ws/Course101'], [n])
    expect(tree).toHaveLength(1)
    const folder = tree[0]
    expect(folder?.type).toBe('folder')
    if (folder?.type === 'folder') {
      expect(folder.name).toBe('Course101')
      expect(folder.children).toEqual([{ type: 'note', name: 'Lecture 1', path: n.path, note: n }])
    }
  })

  it('keeps an empty folder with no notes', () => {
    const tree = buildFolderTree('/ws', ['/ws/Empty'], [])
    expect(tree).toEqual([{ type: 'folder', name: 'Empty', path: '/ws/Empty', children: [] }])
  })

  it('sorts folders before notes, each alphabetically', () => {
    const tree = buildFolderTree(
      '/ws',
      ['/ws/Zeta'],
      [note('Beta', '/ws/Beta.md'), note('Alpha', '/ws/Alpha.md')],
    )
    expect(tree.map((e) => e.name)).toEqual(['Zeta', 'Alpha', 'Beta'])
  })

  it('handles nested subfolders', () => {
    const n = note('Deep', '/ws/A/B/Deep.md')
    const tree = buildFolderTree('/ws', ['/ws/A', '/ws/A/B'], [n])
    const a = tree[0]
    expect(a?.type).toBe('folder')
    if (a?.type === 'folder') {
      const b = a.children[0]
      expect(b?.type).toBe('folder')
      if (b?.type === 'folder') {
        expect(b.children).toEqual([{ type: 'note', name: 'Deep', path: n.path, note: n }])
      }
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test -- folderTree.test
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/folderTree.ts`**

```ts
import type { NoteMetadata } from '../types'

export interface FolderTreeNode {
  type: 'folder'
  name: string
  path: string
  children: TreeEntry[]
}

export interface NoteTreeNode {
  type: 'note'
  name: string
  path: string
  note: NoteMetadata
}

export type TreeEntry = FolderTreeNode | NoteTreeNode

interface MutableFolder {
  name: string
  path: string
  folders: Map<string, MutableFolder>
  notes: NoteMetadata[]
}

function relativeSegments(root: string, path: string): string[] {
  const normalizedRoot = root.replace(/[\\/]+$/, '')
  const rest = path.slice(normalizedRoot.length).replace(/^[\\/]+/, '')
  return rest.split(/[\\/]+/).filter(Boolean)
}

function ensureFolder(root: MutableFolder, segments: string[]): MutableFolder {
  let current = root
  let currentPath = root.path
  for (const segment of segments) {
    currentPath = `${currentPath}/${segment}`
    let next = current.folders.get(segment)
    if (!next) {
      next = { name: segment, path: currentPath, folders: new Map(), notes: [] }
      current.folders.set(segment, next)
    }
    current = next
  }
  return current
}

function toTreeEntries(folder: MutableFolder): TreeEntry[] {
  const folderEntries: FolderTreeNode[] = [...folder.folders.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((f) => ({ type: 'folder', name: f.name, path: f.path, children: toTreeEntries(f) }))

  const noteEntries: NoteTreeNode[] = [...folder.notes]
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((n) => ({ type: 'note', name: n.title, path: n.path, note: n }))

  return [...folderEntries, ...noteEntries]
}

export function buildFolderTree(
  root: string,
  folders: string[],
  notes: NoteMetadata[],
): TreeEntry[] {
  const rootFolder: MutableFolder = { name: '', path: root, folders: new Map(), notes: [] }

  for (const folderPath of folders) {
    const segments = relativeSegments(root, folderPath)
    if (segments.length > 0) {
      ensureFolder(rootFolder, segments)
    }
  }

  for (const noteItem of notes) {
    const segments = relativeSegments(root, noteItem.path)
    const noteName = segments.pop()
    if (noteName === undefined) continue
    const parent = ensureFolder(rootFolder, segments)
    parent.notes.push(noteItem)
  }

  return toTreeEntries(rootFolder)
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test -- folderTree.test
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/folderTree.ts src/lib/folderTree.test.ts
git commit -m "feat: buildFolderTree — flat folder/note paths into a nested tree

Folders are processed before notes so an empty folder with no notes
yet still appears. Pure function, no React dependency, matching the
project's existing ink/svgSerialiser testing convention."
```

---

### Task 7: Store updates — `useNotesStore` and `useWorkspaceStore`

**Files:**
- Modify: `src/store/notes.ts`
- Create: `src/store/notes.test.ts`
- Modify: `src/store/workspace.ts`
- Modify: `src/store/workspace.test.ts`

**Interfaces:**
- Consumes: `isUnderPath`, `replacePathPrefix` (Task 5)
- Produces: `useNotesStore` gains `folders: string[]`, `setFolders`; `useWorkspaceStore` gains `expandedFolders`, `selectedFolder`, `folderContextMenu`, `folderError`, `toggleFolder`, `setExpandedFolders`, `setSelectedFolder`, `openFolderContextMenu`, `closeFolderContextMenu`, `replaceOpenPath`, `closeTabsUnder`, `setFolderError`

- [ ] **Step 1: Write the failing test for `useNotesStore`**

Create `src/store/notes.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useNotesStore } from './notes'

const reset = () => useNotesStore.setState({ notes: [], folders: [] })

describe('useNotesStore', () => {
  beforeEach(reset)

  it('setFolders replaces the folder list', () => {
    useNotesStore.getState().setFolders(['/ws/A', '/ws/B'])
    expect(useNotesStore.getState().folders).toEqual(['/ws/A', '/ws/B'])
  })

  it('addNote prepends a note to the list', () => {
    const note = { id: '1', title: 'A', path: '/ws/a.md', workspace: '/ws', updatedAt: 0 }
    useNotesStore.getState().addNote(note)
    expect(useNotesStore.getState().notes[0]).toEqual(note)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- store/notes.test
```

Expected: FAIL — `setFolders` not found / `folders` undefined.

- [ ] **Step 3: Implement `src/store/notes.ts`**

```ts
import { create } from 'zustand'
import type { NoteMetadata } from '../types'

interface NotesStore {
  notes: NoteMetadata[]
  folders: string[]
  setNotes: (notes: NoteMetadata[]) => void
  setFolders: (folders: string[]) => void
  addNote: (note: NoteMetadata) => void
  removeNote: (path: string) => void
}

export const useNotesStore = create<NotesStore>((set, get) => ({
  notes: [],
  folders: [],
  setNotes: (notes) => set({ notes }),
  setFolders: (folders) => set({ folders }),
  addNote: (note) => set({ notes: [note, ...get().notes] }),
  removeNote: (path) =>
    set({ notes: get().notes.filter((n) => n.path !== path) }),
}))
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run test -- store/notes.test
```

Expected: pass.

- [ ] **Step 5: Write the failing tests for the new `useWorkspaceStore` actions**

Replace `src/store/workspace.test.ts` entirely:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useWorkspaceStore } from './workspace'

const reset = () =>
  useWorkspaceStore.setState({
    path: null,
    openTabs: [],
    activeTab: null,
    expandedFolders: [],
    selectedFolder: null,
    folderContextMenu: null,
    folderError: null,
  })

describe('useWorkspaceStore', () => {
  beforeEach(reset)

  it('opens a tab and makes it active', () => {
    useWorkspaceStore.getState().openTab('/ws/a.md')
    expect(useWorkspaceStore.getState().openTabs).toContain('/ws/a.md')
    expect(useWorkspaceStore.getState().activeTab).toBe('/ws/a.md')
  })

  it('does not duplicate tabs', () => {
    useWorkspaceStore.getState().openTab('/ws/a.md')
    useWorkspaceStore.getState().openTab('/ws/a.md')
    expect(useWorkspaceStore.getState().openTabs.length).toBe(1)
  })

  it('closing the active tab activates the previous one', () => {
    useWorkspaceStore.getState().openTab('/ws/a.md')
    useWorkspaceStore.getState().openTab('/ws/b.md')
    useWorkspaceStore.getState().closeTab('/ws/b.md')
    expect(useWorkspaceStore.getState().openTabs).not.toContain('/ws/b.md')
    expect(useWorkspaceStore.getState().activeTab).toBe('/ws/a.md')
  })

  it('closing the only tab sets activeTab to null', () => {
    useWorkspaceStore.getState().openTab('/ws/a.md')
    useWorkspaceStore.getState().closeTab('/ws/a.md')
    expect(useWorkspaceStore.getState().activeTab).toBeNull()
  })

  it('setPath defaults selectedFolder to the new path', () => {
    useWorkspaceStore.getState().setPath('/ws')
    expect(useWorkspaceStore.getState().selectedFolder).toBe('/ws')
  })

  it('toggleFolder adds then removes a folder from expandedFolders', () => {
    useWorkspaceStore.getState().toggleFolder('/ws/A')
    expect(useWorkspaceStore.getState().expandedFolders).toContain('/ws/A')
    useWorkspaceStore.getState().toggleFolder('/ws/A')
    expect(useWorkspaceStore.getState().expandedFolders).not.toContain('/ws/A')
  })

  it('replaceOpenPath rewrites tabs under the old prefix', () => {
    useWorkspaceStore.getState().openTab('/ws/Course1/a.md')
    useWorkspaceStore.getState().openTab('/ws/Course10/b.md')
    useWorkspaceStore.getState().replaceOpenPath('/ws/Course1', '/ws/Renamed')
    expect(useWorkspaceStore.getState().openTabs).toEqual([
      '/ws/Renamed/a.md',
      '/ws/Course10/b.md',
    ])
  })

  it('closeTabsUnder closes only tabs under the given prefix', () => {
    useWorkspaceStore.getState().openTab('/ws/Course1/a.md')
    useWorkspaceStore.getState().openTab('/ws/Course10/b.md')
    useWorkspaceStore.getState().closeTabsUnder('/ws/Course1')
    expect(useWorkspaceStore.getState().openTabs).toEqual(['/ws/Course10/b.md'])
  })

  it('opens and closes the folder context menu', () => {
    useWorkspaceStore.getState().openFolderContextMenu('/ws/A', 10, 20)
    expect(useWorkspaceStore.getState().folderContextMenu).toEqual({ path: '/ws/A', x: 10, y: 20 })
    useWorkspaceStore.getState().closeFolderContextMenu()
    expect(useWorkspaceStore.getState().folderContextMenu).toBeNull()
  })

  it('sets and clears the folder error message', () => {
    useWorkspaceStore.getState().setFolderError('a folder named X already exists')
    expect(useWorkspaceStore.getState().folderError).toBe('a folder named X already exists')
    useWorkspaceStore.getState().setFolderError(null)
    expect(useWorkspaceStore.getState().folderError).toBeNull()
  })
})
```

- [ ] **Step 6: Run tests to verify they fail**

```bash
npm run test -- store/workspace.test
```

Expected: FAIL — new fields/actions not found.

- [ ] **Step 7: Implement `src/store/workspace.ts`**

```ts
import { create } from 'zustand'
import { isUnderPath, replacePathPrefix } from '../lib/pathPrefix'

interface FolderContextMenuState {
  path: string
  x: number
  y: number
}

interface WorkspaceStore {
  path: string | null
  openTabs: string[]
  activeTab: string | null
  expandedFolders: string[]
  selectedFolder: string | null
  folderContextMenu: FolderContextMenuState | null
  setPath: (path: string) => void
  openTab: (notePath: string) => void
  closeTab: (notePath: string) => void
  setActiveTab: (notePath: string) => void
  toggleFolder: (folderPath: string) => void
  setExpandedFolders: (paths: string[]) => void
  setSelectedFolder: (path: string | null) => void
  openFolderContextMenu: (path: string, x: number, y: number) => void
  closeFolderContextMenu: () => void
  replaceOpenPath: (oldPrefix: string, newPrefix: string) => void
  closeTabsUnder: (prefix: string) => void
  folderError: string | null
  setFolderError: (message: string | null) => void
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  path: null,
  openTabs: [],
  activeTab: null,
  expandedFolders: [],
  selectedFolder: null,
  folderContextMenu: null,
  folderError: null,

  setPath: (path) => set({ path, selectedFolder: path }),

  openTab: (notePath) => {
    const { openTabs } = get()
    if (openTabs.includes(notePath)) {
      set({ activeTab: notePath })
      return
    }
    set({ openTabs: [...openTabs, notePath], activeTab: notePath })
  },

  closeTab: (notePath) => {
    const { openTabs, activeTab } = get()
    const next = openTabs.filter((p) => p !== notePath)
    const newActive =
      activeTab === notePath ? (next[next.length - 1] ?? null) : activeTab
    set({ openTabs: next, activeTab: newActive })
  },

  setActiveTab: (notePath) => set({ activeTab: notePath }),

  toggleFolder: (folderPath) => {
    const { expandedFolders } = get()
    set({
      expandedFolders: expandedFolders.includes(folderPath)
        ? expandedFolders.filter((p) => p !== folderPath)
        : [...expandedFolders, folderPath],
    })
  },

  setExpandedFolders: (paths) => set({ expandedFolders: paths }),
  setSelectedFolder: (path) => set({ selectedFolder: path }),

  openFolderContextMenu: (path, x, y) => set({ folderContextMenu: { path, x, y } }),
  closeFolderContextMenu: () => set({ folderContextMenu: null }),

  replaceOpenPath: (oldPrefix, newPrefix) => {
    const { openTabs, activeTab } = get()
    set({
      openTabs: openTabs.map((p) => replacePathPrefix(p, oldPrefix, newPrefix)),
      activeTab: activeTab ? replacePathPrefix(activeTab, oldPrefix, newPrefix) : activeTab,
    })
  },

  closeTabsUnder: (prefix) => {
    const { openTabs, activeTab } = get()
    const next = openTabs.filter((p) => !isUnderPath(p, prefix))
    const newActive = activeTab && isUnderPath(activeTab, prefix) ? (next[next.length - 1] ?? null) : activeTab
    set({ openTabs: next, activeTab: newActive })
  },

  setFolderError: (message) => set({ folderError: message }),
}))
```

- [ ] **Step 8: Run tests to verify they pass**

```bash
npm run test -- store/workspace.test store/notes.test
```

Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add src/store/notes.ts src/store/notes.test.ts src/store/workspace.ts src/store/workspace.test.ts
git commit -m "feat: folder/selection/context-menu state in the workspace and notes stores"
```

---

### Task 8: Frontend API surface and session persistence

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/lib/tauri.ts`
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/commands/workspace.rs`
- Modify: `src/hooks/useWorkspace.ts`

**Interfaces:**
- Consumes: `create_folder`, `rename_folder`, `delete_folder`, `move_note`, updated `scan_workspace` (Tasks 2 & 4); `setFolders`/`setExpandedFolders` (Task 7)
- Produces: `WorkspaceTree` (TS); `api.notes.createFolder/renameFolder/deleteFolder/moveNote`; `api.notes.scan` now returns `WorkspaceTree`; `WorkspaceState.expanded_folders: Vec<String>` (Rust, defaults to empty for legacy files); standalone `refreshTree(): Promise<void>` importable from anywhere without prop drilling

This task bundles the frontend API surface (types + `tauri.ts`) with the Rust session-persistence field and the `useWorkspace.ts` rewiring that consumes both, so the build stays green from start to finish — splitting these apart would leave `useWorkspace.ts` broken between commits (it calls `api.notes.scan`/`api.notes.create` and needs `setFolders`/`expandedFolders`, all of which land together here).

- [ ] **Step 1: Add `WorkspaceTree` and `expandedFolders` to `src/types/index.ts`**

```ts
export interface NoteMetadata {
  id: string
  title: string
  path: string
  workspace: string
  updatedAt: number
}

export interface WorkspaceTree {
  notes: NoteMetadata[]
  folders: string[]
}

export interface SearchResult {
  path: string
  title: string
  snippet: string
}

export interface WorkspaceState {
  openTabs: string[]
  activeTab: string | null
  expandedFolders: string[]
}
```

- [ ] **Step 2: Update `src/lib/tauri.ts`**

```ts
import { invoke } from '@tauri-apps/api/core'
import type { NoteMetadata, WorkspaceState, WorkspaceTree, SearchResult } from '../types'

export const api = {
  notes: {
    list: (workspace: string) =>
      invoke<NoteMetadata[]>('list_notes', { workspace }),
    scan: (workspace: string) =>
      invoke<WorkspaceTree>('scan_workspace', { workspace }),
    open: (path: string) =>
      invoke<string>('open_note', { path }),
    save: (path: string, workspace: string, content: string) =>
      invoke<void>('save_note', { path, workspace, content }),
    create: (workspace: string, folder: string, title: string) =>
      invoke<NoteMetadata>('create_note', { workspace, folder, title }),
    delete: (path: string) =>
      invoke<void>('delete_note', { path }),
    search: (query: string) =>
      invoke<SearchResult[]>('search_notes', { query }),
    createFolder: (parent: string, name: string) =>
      invoke<string>('create_folder', { parent, name }),
    renameFolder: (oldPath: string, newPath: string) =>
      invoke<void>('rename_folder', { oldPath, newPath }),
    deleteFolder: (path: string) =>
      invoke<void>('delete_folder', { path }),
    moveNote: (path: string, destFolder: string) =>
      invoke<string>('move_note', { path, destFolder }),
  },
  workspace: {
    load: (path: string) =>
      invoke<WorkspaceState>('load_workspace', { path }),
    save: (path: string, state: WorkspaceState) =>
      invoke<void>('save_workspace', { path, state }),
  },
}
```

- [ ] **Step 3: Write the failing backward-compatibility test for `WorkspaceState.expandedFolders`**

Add to `#[cfg(test)] mod tests` in `src-tauri/src/commands/workspace.rs`:

```rust
#[tokio::test]
async fn test_load_legacy_file_without_expanded_folders() {
    let dir = tempdir().unwrap();
    let state_path = dir.path().join(".workspace.json");
    tokio::fs::write(&state_path, r#"{"openTabs":["/ws/a.md"],"activeTab":"/ws/a.md"}"#)
        .await
        .unwrap();
    let state = load_workspace_from_dir(&dir.path().to_string_lossy())
        .await
        .unwrap();
    assert_eq!(state.open_tabs, vec!["/ws/a.md".to_string()]);
    assert!(state.expanded_folders.is_empty());
}
```

Also update `test_roundtrip` in the same file to include the new field (otherwise the `WorkspaceState` literal won't compile once Step 4 lands):

```rust
#[tokio::test]
async fn test_roundtrip() {
    let dir = tempdir().unwrap();
    let path = dir.path().to_string_lossy().into_owned();
    let original = WorkspaceState {
        open_tabs: vec!["/ws/note.md".into()],
        active_tab: Some("/ws/note.md".into()),
        expanded_folders: vec!["/ws/Course1".into()],
    };
    save_workspace_to_dir(&path, &original).await.unwrap();
    let loaded = load_workspace_from_dir(&path).await.unwrap();
    assert_eq!(loaded.open_tabs, original.open_tabs);
    assert_eq!(loaded.active_tab, original.active_tab);
    assert_eq!(loaded.expanded_folders, original.expanded_folders);
}
```

- [ ] **Step 4: Run tests to verify they fail to compile**

```bash
cargo test --manifest-path src-tauri/Cargo.toml commands::workspace
```

Expected: FAIL to compile — `WorkspaceState` has no field `expanded_folders`.

- [ ] **Step 5: Add the field in `src-tauri/src/models.rs`**

```rust
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceState {
    pub open_tabs: Vec<String>,
    pub active_tab: Option<String>,
    #[serde(default)]
    pub expanded_folders: Vec<String>,
}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cargo test --manifest-path src-tauri/Cargo.toml commands::workspace
```

Expected: all pass, including the legacy-file backward-compat test.

- [ ] **Step 7: Clippy**

```bash
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

- [ ] **Step 8: Rewrite `src/hooks/useWorkspace.ts`**

```ts
import { useCallback } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { api } from '../lib/tauri'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'

export async function refreshTree(): Promise<void> {
  const path = useWorkspaceStore.getState().path
  if (!path) return
  const tree = await api.notes.scan(path)
  useNotesStore.getState().setNotes(tree.notes)
  useNotesStore.getState().setFolders(tree.folders)
}

export function useWorkspace() {
  const { setPath, openTab, setExpandedFolders } = useWorkspaceStore()
  const { setNotes, setFolders } = useNotesStore()

  const openWorkspace = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false })
    if (!selected || Array.isArray(selected)) return

    setPath(selected)
    const [tree, session] = await Promise.all([
      api.notes.scan(selected),
      api.workspace.load(selected),
    ])
    setNotes(tree.notes)
    setFolders(tree.folders)
    setExpandedFolders(session.expandedFolders)
    for (const tab of session.openTabs) {
      openTab(tab)
    }
  }, [setPath, setNotes, setFolders, setExpandedFolders, openTab])

  const saveSession = useCallback(async () => {
    const { path, openTabs, activeTab, expandedFolders } = useWorkspaceStore.getState()
    if (!path) return
    await api.workspace.save(path, { openTabs, activeTab, expandedFolders })
  }, [])

  return { openWorkspace, saveSession }
}
```

`refreshTree` is a standalone exported function (not part of the hook's return value) so components deep in the folder tree (Tasks 10–11) can call it without prop-drilling it down through every recursive level — it reads/writes the Zustand stores imperatively via `.getState()`, the same pattern `saveSession` already uses.

- [ ] **Step 9: Typecheck and build**

```bash
npm run typecheck
npm run build
```

Expected: both pass.

- [ ] **Step 10: Commit**

```bash
git add src/types/index.ts src/lib/tauri.ts src-tauri/src/models.rs src-tauri/src/commands/workspace.rs src/hooks/useWorkspace.ts
git commit -m "feat: WorkspaceTree API surface, session-persisted expandedFolders, and useWorkspace rewiring

api.notes.scan now returns notes+folders together and create takes a
folder target. expandedFolders defaults to an empty list for
.workspace.json files written before this feature existed.
refreshTree is exported as a plain function so folder-tree
components several levels deep can re-sync notes/folders after a
mutation without prop-drilling a callback down through every
recursive level."
```

---

### Task 9: `FolderTree.tsx` / `TreeNode.tsx` and `Sidebar.tsx` integration

**Files:**
- Create: `src/components/FolderTree.tsx`
- Create: `src/components/TreeNode.tsx`
- Modify: `src/components/Sidebar.tsx`

**Interfaces:**
- Consumes: `TreeEntry`/`buildFolderTree` (Task 6), `refreshTree` (Task 8), workspace/notes store folder state (Task 7)
- Produces: `<FolderTree entries={TreeEntry[]} depth?={number} />`; `<TreeNode entry={TreeEntry} depth={number} />`

This task covers navigation only (expand/collapse, click-to-open, click-to-select, note delete). Folder rename/delete (Task 10) and drag-and-drop move (Task 11) build on top of it.

- [ ] **Step 1: Write `src/components/TreeNode.tsx`**

```tsx
import { useState } from 'react'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'
import { api } from '../lib/tauri'
import { FolderTree } from './FolderTree'
import type { TreeEntry } from '../lib/folderTree'

interface TreeNodeProps {
  entry: TreeEntry
  depth: number
}

export function TreeNode({ entry, depth }: TreeNodeProps) {
  const expandedFolders = useWorkspaceStore((s) => s.expandedFolders)
  const selectedFolder = useWorkspaceStore((s) => s.selectedFolder)
  const activeTab = useWorkspaceStore((s) => s.activeTab)
  const toggleFolder = useWorkspaceStore((s) => s.toggleFolder)
  const setSelectedFolder = useWorkspaceStore((s) => s.setSelectedFolder)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const closeTab = useWorkspaceStore((s) => s.closeTab)
  const removeNote = useNotesStore((s) => s.removeNote)

  if (entry.type === 'note') {
    const isActive = activeTab === entry.path

    async function handleDelete(e: React.MouseEvent) {
      e.stopPropagation()
      if (!confirm(`Delete "${entry.name}"?`)) return
      await api.notes.delete(entry.path)
      removeNote(entry.path)
      closeTab(entry.path)
    }

    return (
      <li
        className={`tree-row tree-note${isActive ? ' active' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => openTab(entry.path)}
      >
        <span className="tree-label">{entry.name}</span>
        <button
          className="tree-delete"
          onClick={(e) => void handleDelete(e)}
          aria-label={`Delete ${entry.name}`}
        >
          ✕
        </button>
      </li>
    )
  }

  const isExpanded = expandedFolders.includes(entry.path)
  const isSelected = selectedFolder === entry.path

  return (
    <li>
      <div
        className={`tree-row tree-folder${isSelected ? ' selected' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => {
          toggleFolder(entry.path)
          setSelectedFolder(entry.path)
        }}
      >
        <span className="tree-toggle">{isExpanded ? '▾' : '▸'}</span>
        <span className="tree-label">{entry.name}</span>
      </div>
      {isExpanded && (
        <ul className="folder-tree">
          {entry.children.map((child) => (
            <TreeNode key={child.path} entry={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  )
}
```

(`TreeNode` renders its own nested children directly rather than importing `FolderTree` for the recursive call, to avoid a circular import between the two files — `FolderTree` only depends on `TreeNode`, never the reverse. The unused `FolderTree` import above is intentionally not included in this file for that reason.)

- [ ] **Step 2: Write `src/components/FolderTree.tsx`**

```tsx
import { TreeNode } from './TreeNode'
import type { TreeEntry } from '../lib/folderTree'

interface FolderTreeProps {
  entries: TreeEntry[]
  depth?: number
}

export function FolderTree({ entries, depth = 0 }: FolderTreeProps) {
  return (
    <ul className="folder-tree">
      {entries.map((entry) => (
        <TreeNode key={entry.path} entry={entry} depth={depth} />
      ))}
    </ul>
  )
}
```

- [ ] **Step 3: Replace `src/components/Sidebar.tsx`**

```tsx
import { useState } from 'react'
import { useNotesStore } from '../store/notes'
import { useWorkspaceStore } from '../store/workspace'
import { useWorkspace, refreshTree } from '../hooks/useWorkspace'
import { ImportButton } from './ImportButton'
import { FolderTree } from './FolderTree'
import { buildFolderTree } from '../lib/folderTree'
import { api } from '../lib/tauri'

interface SidebarProps {
  onSearchOpen: () => void
}

export function Sidebar({ onSearchOpen }: SidebarProps) {
  const notes = useNotesStore((s) => s.notes)
  const folders = useNotesStore((s) => s.folders)
  const addNote = useNotesStore((s) => s.addNote)
  const workspacePath = useWorkspaceStore((s) => s.path)
  const selectedFolder = useWorkspaceStore((s) => s.selectedFolder)
  const setSelectedFolder = useWorkspaceStore((s) => s.setSelectedFolder)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const { openWorkspace } = useWorkspace()
  const [search, setSearch] = useState('')

  const visibleNotes = search.trim()
    ? notes.filter((n) => n.title.toLowerCase().includes(search.toLowerCase()))
    : notes

  const tree = workspacePath ? buildFolderTree(workspacePath, folders, visibleNotes) : []
  const folderError = useWorkspaceStore((s) => s.folderError)
  const setFolderError = useWorkspaceStore((s) => s.setFolderError)

  async function handleCreateNote() {
    if (!workspacePath) return
    const title = prompt('Note title:')
    if (!title) return
    const folder = selectedFolder ?? workspacePath
    try {
      const meta = await api.notes.create(workspacePath, folder, title)
      addNote(meta)
      openTab(meta.path)
      setFolderError(null)
    } catch (e) {
      setFolderError(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleCreateFolder() {
    if (!workspacePath) return
    const name = prompt('Folder name:')
    if (!name) return
    const parent = selectedFolder ?? workspacePath
    try {
      const newPath = await api.notes.createFolder(parent, name)
      setSelectedFolder(newPath)
      setFolderError(null)
      await refreshTree()
    } catch (e) {
      setFolderError(e instanceof Error ? e.message : String(e))
    }
  }

  const workspaceName = workspacePath
    ? workspacePath.split(/[\\/]/).filter(Boolean).pop() ?? workspacePath
    : null

  return (
    <aside className="sidebar">
      {workspaceName && <p className="workspace-name" title={workspacePath ?? ''}>{workspaceName}</p>}
      <button onClick={() => void openWorkspace()}>Open Workspace</button>
      <div className="sidebar-new-actions">
        <button onClick={() => void handleCreateNote()} disabled={!workspacePath}>
          New Note
        </button>
        <button onClick={() => void handleCreateFolder()} disabled={!workspacePath}>
          New Folder
        </button>
      </div>
      <ImportButton />
      <button className="search-open-btn" onClick={onSearchOpen}>
        Search <kbd>Ctrl K</kbd>
      </button>
      <input
        className="search-input"
        type="search"
        placeholder="Filter by title…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Filter notes by title"
      />
      {folderError && <p className="sidebar-error">{folderError}</p>}
      <FolderTree entries={tree} />
    </aside>
  )
}
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: passes.

- [ ] **Step 5: Build**

```bash
npm run build
```

Expected: passes.

- [ ] **Step 6: Manual verification**

```bash
npm run tauri dev
```

Open a workspace, create a folder via "New Folder", create a note while that folder is selected, confirm it lands inside the folder on disk, collapse/expand the folder, delete the note.

- [ ] **Step 7: Commit**

```bash
git add src/components/FolderTree.tsx src/components/TreeNode.tsx src/components/Sidebar.tsx
git commit -m "feat: recursive folder tree replaces the flat note list in the sidebar

New Note now targets the selected folder (defaulting to the
workspace root); New Folder creates under the selected folder and
selects it. Folder rename/delete and drag-to-move land in the next
two commits."
```

---

### Task 10: Folder rename and delete via context menu

**Files:**
- Create: `src/components/FolderContextMenu.tsx`
- Modify: `src/components/TreeNode.tsx`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: `openFolderContextMenu`/`closeFolderContextMenu`/`replaceOpenPath`/`closeTabsUnder` (Task 7), `api.notes.renameFolder`/`deleteFolder` (Task 8), `refreshTree` (Task 8), `isUnderPath` (Task 5)
- Produces: `<FolderContextMenu />` (no props — reads everything from the store)

- [ ] **Step 1: Write `src/components/FolderContextMenu.tsx`**

```tsx
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'
import { api } from '../lib/tauri'
import { refreshTree } from '../hooks/useWorkspace'
import { isUnderPath } from '../lib/pathPrefix'

export function FolderContextMenu() {
  const menu = useWorkspaceStore((s) => s.folderContextMenu)
  const close = useWorkspaceStore((s) => s.closeFolderContextMenu)
  const setSelectedFolder = useWorkspaceStore((s) => s.setSelectedFolder)
  const replaceOpenPath = useWorkspaceStore((s) => s.replaceOpenPath)
  const closeTabsUnder = useWorkspaceStore((s) => s.closeTabsUnder)
  const setFolderError = useWorkspaceStore((s) => s.setFolderError)
  const notes = useNotesStore((s) => s.notes)

  if (!menu) return null

  async function handleRename() {
    const currentName = menu.path.split(/[\\/]/).filter(Boolean).pop() ?? ''
    const name = prompt('New folder name:', currentName)
    close()
    if (!name || name === currentName) return
    const newPath = menu.path.replace(/[^/\\]+$/, name)
    try {
      await api.notes.renameFolder(menu.path, newPath)
      replaceOpenPath(menu.path, newPath)
      setFolderError(null)
      await refreshTree()
    } catch (e) {
      setFolderError(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleDelete() {
    const count = notes.filter((n) => isUnderPath(n.path, menu.path)).length
    const name = menu.path.split(/[\\/]/).filter(Boolean).pop() ?? ''
    close()
    const noun = count === 1 ? 'note' : 'notes'
    if (!confirm(`Delete "${name}" and its ${count} ${noun}? This cannot be undone.`)) return
    try {
      await api.notes.deleteFolder(menu.path)
      closeTabsUnder(menu.path)
      setSelectedFolder(null)
      setFolderError(null)
      await refreshTree()
    } catch (e) {
      setFolderError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="context-menu-overlay" onMouseDown={close}>
      <div
        className="context-menu"
        style={{ position: 'fixed', top: menu.y, left: menu.x }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button onClick={() => void handleRename()}>Rename</button>
        <button onClick={() => void handleDelete()}>Delete</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add the right-click handler to the folder branch in `src/components/TreeNode.tsx`**

Add `openFolderContextMenu` to the store selectors near the top:

```tsx
const openFolderContextMenu = useWorkspaceStore((s) => s.openFolderContextMenu)
```

Add `onContextMenu` to the folder row's `<div>`:

```tsx
<div
  className={`tree-row tree-folder${isSelected ? ' selected' : ''}`}
  style={{ paddingLeft: 8 + depth * 14 }}
  onClick={() => {
    toggleFolder(entry.path)
    setSelectedFolder(entry.path)
  }}
  onContextMenu={(e) => {
    e.preventDefault()
    openFolderContextMenu(entry.path, e.clientX, e.clientY)
  }}
>
```

- [ ] **Step 3: Render `<FolderContextMenu />` once in `src/components/Sidebar.tsx`**

Add the import:

```tsx
import { FolderContextMenu } from './FolderContextMenu'
```

Add it as the last element inside `<aside className="sidebar">`, after `<FolderTree entries={tree} />`:

```tsx
      <FolderTree entries={tree} />
      <FolderContextMenu />
    </aside>
```

- [ ] **Step 4: Add context-menu CSS to `src/index.css`**

Append:

```css
/* Folder context menu */
.context-menu-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
}

.context-menu {
  background: #1e1e1e;
  border: 1px solid #333;
  border-radius: 6px;
  padding: 4px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  min-width: 120px;
}

.context-menu button {
  text-align: left;
  padding: 6px 10px;
  background: none;
  border: none;
  border-radius: 4px;
  color: #e8e8e8;
  cursor: pointer;
  font-size: 13px;
}

.context-menu button:hover { background: #2a2a2a; }
```

- [ ] **Step 5: Typecheck and build**

```bash
npm run typecheck
npm run build
```

Expected: both pass.

- [ ] **Step 6: Manual verification**

```bash
npm run tauri dev
```

Right-click a folder, rename it, confirm the file on disk and any open tab under it updated. Right-click a folder with notes inside, delete it, confirm the confirmation dialog states the correct note count and the folder/notes are gone.

- [ ] **Step 7: Commit**

```bash
git add src/components/FolderContextMenu.tsx src/components/TreeNode.tsx src/components/Sidebar.tsx src/index.css
git commit -m "feat: rename and delete folders via right-click context menu

Rename rewrites any open tab whose path was under the old folder;
delete closes them instead and resets the selected folder to the
workspace root."
```

---

### Task 11: Drag-and-drop move

**Files:**
- Modify: `src/components/TreeNode.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: `api.notes.moveNote` (Task 8), `replaceOpenPath` (Task 7), `refreshTree` (Task 8)

- [ ] **Step 1: Replace `src/components/TreeNode.tsx` in full**

```tsx
import { useState } from 'react'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'
import { api } from '../lib/tauri'
import { refreshTree } from '../hooks/useWorkspace'
import type { TreeEntry } from '../lib/folderTree'

interface TreeNodeProps {
  entry: TreeEntry
  depth: number
}

export function TreeNode({ entry, depth }: TreeNodeProps) {
  const [dragOver, setDragOver] = useState(false)
  const expandedFolders = useWorkspaceStore((s) => s.expandedFolders)
  const selectedFolder = useWorkspaceStore((s) => s.selectedFolder)
  const activeTab = useWorkspaceStore((s) => s.activeTab)
  const toggleFolder = useWorkspaceStore((s) => s.toggleFolder)
  const setSelectedFolder = useWorkspaceStore((s) => s.setSelectedFolder)
  const openFolderContextMenu = useWorkspaceStore((s) => s.openFolderContextMenu)
  const replaceOpenPath = useWorkspaceStore((s) => s.replaceOpenPath)
  const setFolderError = useWorkspaceStore((s) => s.setFolderError)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const closeTab = useWorkspaceStore((s) => s.closeTab)
  const removeNote = useNotesStore((s) => s.removeNote)

  if (entry.type === 'note') {
    const isActive = activeTab === entry.path

    async function handleDelete(e: React.MouseEvent) {
      e.stopPropagation()
      if (!confirm(`Delete "${entry.name}"?`)) return
      await api.notes.delete(entry.path)
      removeNote(entry.path)
      closeTab(entry.path)
    }

    return (
      <li
        className={`tree-row tree-note${isActive ? ' active' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        draggable
        onDragStart={(e) => e.dataTransfer.setData('text/note-path', entry.path)}
        onClick={() => openTab(entry.path)}
      >
        <span className="tree-label">{entry.name}</span>
        <button
          className="tree-delete"
          onClick={(e) => void handleDelete(e)}
          aria-label={`Delete ${entry.name}`}
        >
          ✕
        </button>
      </li>
    )
  }

  const isExpanded = expandedFolders.includes(entry.path)
  const isSelected = selectedFolder === entry.path

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const notePath = e.dataTransfer.getData('text/note-path')
    if (!notePath) return
    try {
      const newPath = await api.notes.moveNote(notePath, entry.path)
      replaceOpenPath(notePath, newPath)
      setFolderError(null)
      await refreshTree()
    } catch (err) {
      setFolderError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <li>
      <div
        className={`tree-row tree-folder${isSelected ? ' selected' : ''}${dragOver ? ' drag-over' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => {
          toggleFolder(entry.path)
          setSelectedFolder(entry.path)
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          openFolderContextMenu(entry.path, e.clientX, e.clientY)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => void handleDrop(e)}
      >
        <span className="tree-toggle">{isExpanded ? '▾' : '▸'}</span>
        <span className="tree-label">{entry.name}</span>
      </div>
      {isExpanded && (
        <ul className="folder-tree">
          {entry.children.map((child) => (
            <TreeNode key={child.path} entry={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  )
}
```

This is the same file Tasks 9 and 10 built up incrementally (note branch with delete, folder branch with expand/select/context-menu), now with `draggable`/`onDragStart` added to the note branch and `onDragOver`/`onDragLeave`/`onDrop` added to the folder branch.

- [ ] **Step 2: Add drag-over CSS to `src/index.css`**

Append:

```css
.tree-row.drag-over { background: #2a3f2a; outline: 1px dashed #4a9eff; }
```

- [ ] **Step 3: Typecheck and build**

```bash
npm run typecheck
npm run build
```

Expected: both pass.

- [ ] **Step 4: Manual verification**

```bash
npm run tauri dev
```

Drag a note onto a different folder, confirm it moves on disk, the tree updates, and if that note was open in a tab, the tab still shows the correct content (not a stale/broken reference).

- [ ] **Step 5: Commit**

```bash
git add src/components/TreeNode.tsx src/index.css
git commit -m "feat: drag a note onto a folder to move it"
```

---

### Task 12: Remaining tree/sidebar styling

**Files:**
- Modify: `src/index.css`

- [ ] **Step 1: Append the base tree/row styles**

```css
/* Folder tree */
.folder-tree {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
}

.tree-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  cursor: pointer;
  border-radius: 4px;
  font-size: 13px;
  color: #ccc;
}

.tree-row:hover { background: #1e1e1e; }
.tree-row.active { background: #24344a; color: #e8e8e8; }
.tree-row.selected { background: #1a2a3a; }

.tree-toggle {
  width: 12px;
  font-size: 10px;
  color: #777;
  flex-shrink: 0;
}

.tree-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree-note .tree-label { padding-left: 16px; }

.tree-delete {
  padding: 2px 4px;
  background: none;
  border: none;
  color: #555;
  cursor: pointer;
  font-size: 11px;
  opacity: 0;
}

.tree-row:hover .tree-delete { opacity: 1; }
.tree-delete:hover { color: #e66; }

.sidebar-new-actions {
  display: flex;
  gap: 6px;
}

.sidebar-new-actions button { flex: 1; }

.sidebar-error {
  margin: 4px 0 0;
  padding: 6px 8px;
  background: #270d0d;
  border: 1px solid #4a1f1f;
  border-radius: 4px;
  color: #e88;
  font-size: 12px;
}
```

- [ ] **Step 2: Manual visual check**

```bash
npm run tauri dev
```

Confirm rows align, the delete "✕" only shows on hover, and the active/selected/drag-over states are visually distinct from each other and from a plain hover. Try creating a folder with a name that already exists in the same location and confirm the error banner is legible against the dark theme.

- [ ] **Step 3: Commit**

```bash
git add src/index.css
git commit -m "style: folder tree rows, toggle chevrons, and new-note/new-folder button row"
```

---

### Task 13: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full Rust test suite**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: all pass (including the pre-existing ignored tests that require native OCR/PDF/pix2tex tooling).

- [ ] **Step 2: Clippy**

```bash
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

Expected: clean.

- [ ] **Step 3: Full frontend test suite**

```bash
npm run test
```

Expected: all pass.

- [ ] **Step 4: Typecheck and build**

```bash
npm run typecheck
npm run build
```

Expected: both pass.

- [ ] **Step 5: Manual smoke test checklist**

```bash
npm run tauri dev
```

- [ ] Create nested folders (at least two levels deep)
- [ ] Create a note inside a nested folder; confirm it appears in the right place after closing and reopening the workspace
- [ ] Drag a note from one folder into another; confirm the move persists after reopening the workspace
- [ ] Rename a folder that has an open tab inside it; confirm the tab keeps working (doesn't point at a stale path)
- [ ] Delete a folder that has an open tab inside it; confirm the tab closes rather than erroring
- [ ] Delete a non-empty folder; confirm the confirmation dialog states the correct note count
- [ ] Confirm `.ink` sketch sidecars never appear as folders in the tree, and that moving/renaming a note with an ink sketch keeps the sketch attached
- [ ] Reopen the workspace and confirm expanded/collapsed folder state was restored from the previous session
- [ ] Try to create a folder whose name collides with an existing one in the same location; confirm the error banner appears instead of the app failing silently

- [ ] **Step 6: Report completion**

No commit for this task — it's verification only. If any check fails, fix it in a follow-up commit before considering the feature done.

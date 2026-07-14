# null-notes Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the Tauri 2 desktop app with a WYSIWYG TipTap markdown editor, file-based note storage, SQLite search index, and workspace session persistence.

**Architecture:** Tauri 2 shell with a Rust backend for all file I/O and SQLite queries, exposed as typed IPC commands. The React/TypeScript frontend never touches the filesystem directly. TipTap runs in WYSIWYG mode using `tiptap-markdown` to serialize between its internal JSON model and plain `.md` files on disk.

**Tech Stack:** Tauri 2, Rust 2021 edition, sqlx 0.7 (SQLite), React 19, TypeScript 5 strict, TipTap 2, tiptap-markdown, Zustand 4, Vite 5, Vitest 1

## Global Constraints

- Tauri 2 only — use `@tauri-apps/api/core` for `invoke`, not v1's `@tauri-apps/api`
- TypeScript strict mode — no `any`, justify every `!`
- No `.unwrap()` / `.expect()` outside `#[cfg(test)]` in Rust
- `cargo clippy -- -D warnings` must pass clean before every commit
- All Tauri commands return `Result<T, String>` — use `.map_err(|e| e.to_string())`
- Notes stored as plain `.md` files — source of truth is always the filesystem
- SQLite stores derived index data only — must be fully rebuildable by scanning `.md` files
- Rust structs use `#[serde(rename_all = "camelCase")]` so JSON field names match TypeScript conventions

---

## File Map

### src-tauri/

| File | Responsibility |
|---|---|
| `Cargo.toml` | Rust dependencies |
| `src/main.rs` | App entry, Tauri builder, plugin and command registration |
| `src/models.rs` | `NoteMetadata`, `WorkspaceState` structs |
| `src/commands/mod.rs` | Command module re-exports |
| `src/commands/notes.rs` | `list_notes`, `open_note`, `save_note`, `create_note`, `delete_note` |
| `src/commands/workspace.rs` | `load_workspace`, `save_workspace` |
| `src/db/mod.rs` | `DbPool` type alias, `init_db()` |
| `src/db/schema.rs` | `run_migrations()` |
| `src/db/notes.rs` | `index_note`, `remove_note`, `list_by_workspace` |

### src/ (frontend)

| File | Responsibility |
|---|---|
| `types/index.ts` | TypeScript interfaces mirroring Rust models |
| `lib/tauri.ts` | Typed `invoke` wrappers for all Tauri commands |
| `store/workspace.ts` | Zustand — open tabs, active tab, workspace path |
| `store/notes.ts` | Zustand — note list for current workspace |
| `hooks/useNote.ts` | Load and save a single note by path |
| `hooks/useWorkspace.ts` | Open workspace folder, persist/restore session |
| `editor/extensions/index.ts` | Assembled TipTap extension list |
| `editor/NoteEditor.tsx` | TipTap editor component |
| `components/Sidebar.tsx` | Note list with create/delete |
| `components/TabBar.tsx` | Open note tabs |
| `components/Layout.tsx` | Root layout — sidebar + tab bar + editor pane |
| `App.tsx` | Wires stores to layout |
| `main.tsx` | React entry point |

---

### Task 1: Scaffold Tauri 2 + React + TypeScript Project

**Files:**
- Create: project root (`package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src-tauri/Cargo.toml`, `src-tauri/src/main.rs`)

**Interfaces:**
- Produces: runnable `npm run tauri dev` development environment

- [x] **Step 1: Initialise the project** — completed via `npm create tauri-app@latest . -- --template react-ts --manager npm --force`

- [x] **Step 2: Create `.gitignore`** — completed

- [ ] **Step 3: Verify the scaffold runs**

```bash
npm install
npm run tauri dev
```

Expected: Tauri window opens with the default Vite + React page. Close it.

- [ ] **Step 4: Initialise git and commit**

```bash
git init
git add .
git commit -m "chore: scaffold Tauri 2 + React + TypeScript"
```

---

### Task 2: Configure Dependencies and Dev Tooling

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `package.json`
- Modify: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/test-setup.ts`

**Interfaces:**
- Produces: all runtime and dev dependencies installed; TypeScript strict mode on; Vitest wired

- [ ] **Step 1: Replace the `[dependencies]` block in `src-tauri/Cargo.toml`**

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-dialog = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
anyhow = "1"
thiserror = "1"
tokio = { version = "1", features = ["full"] }
sqlx = { version = "0.7", features = ["sqlite", "runtime-tokio-rustls", "macros"] }
uuid = { version = "1", features = ["v4"] }

[dev-dependencies]
tokio = { version = "1", features = ["full", "test-util"] }
tempfile = "3"
```

- [ ] **Step 2: Install frontend dependencies**

```bash
npm install @tiptap/react @tiptap/starter-kit @tiptap/extension-placeholder tiptap-markdown zustand @tauri-apps/api @tauri-apps/plugin-dialog
npm install -D vitest @vitest/ui @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom
```

- [ ] **Step 3: Replace `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "./dist"
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/test-setup.ts'],
  },
})
```

- [ ] **Step 5: Create `src/test-setup.ts`**

```ts
import '@testing-library/jest-dom'
```

- [ ] **Step 6: Add scripts to `package.json`**

Ensure these entries exist under `"scripts"`:

```json
"typecheck": "tsc --noEmit",
"test": "vitest run",
"test:ui": "vitest --ui"
```

- [ ] **Step 7: Verify**

```bash
cargo build --manifest-path src-tauri/Cargo.toml
npm run typecheck
npm run test
```

Expected: Rust compiles, zero TypeScript errors, zero test failures.

- [ ] **Step 8: Commit**

```bash
git add .
git commit -m "chore: dependencies, strict TypeScript, Vitest"
```

---

### Task 3: Shared Type Definitions

**Files:**
- Create: `src-tauri/src/models.rs`
- Create: `src/types/index.ts`
- Modify: `src-tauri/src/main.rs`

**Interfaces:**
- Produces: `NoteMetadata` and `WorkspaceState` in both Rust (camelCase JSON) and TypeScript

- [ ] **Step 1: Write `src-tauri/src/models.rs`**

Note: `sqlx::FromRow` is derived so `query_as::<_, NoteMetadata>()` works without compile-time DATABASE_URL.

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct NoteMetadata {
    pub id: String,
    pub title: String,
    pub path: String,       // absolute filesystem path to the .md file
    pub workspace: String,  // absolute path to the workspace folder
    pub updated_at: i64,    // Unix timestamp ms
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceState {
    pub open_tabs: Vec<String>,
    pub active_tab: Option<String>,
}

impl Default for WorkspaceState {
    fn default() -> Self {
        Self {
            open_tabs: Vec::new(),
            active_tab: None,
        }
    }
}
```

- [ ] **Step 2: Write `src/types/index.ts`**

```ts
export interface NoteMetadata {
  id: string
  title: string
  path: string
  workspace: string
  updatedAt: number
}

export interface WorkspaceState {
  openTabs: string[]
  activeTab: string | null
}
```

- [ ] **Step 3: Add `mod models` to `src-tauri/src/main.rs`**

At the top of `main.rs` add:

```rust
mod models;
```

- [ ] **Step 4: Verify Rust compiles**

```bash
cargo build --manifest-path src-tauri/Cargo.toml
```

Expected: compiles without warnings.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/models.rs src/types/index.ts src-tauri/src/main.rs
git commit -m "feat: shared NoteMetadata and WorkspaceState types"
```

---

### Task 4: SQLite Setup

**Files:**
- Create: `src-tauri/src/db/mod.rs`
- Create: `src-tauri/src/db/schema.rs`
- Create: `src-tauri/src/db/notes.rs`
- Modify: `src-tauri/src/main.rs`

**Interfaces:**
- Produces: `DbPool` type alias (`sqlx::SqlitePool`), `db::init_db(app_data_dir: &Path) -> anyhow::Result<DbPool>`
- Produces: `db::notes::index_note`, `db::notes::remove_note`, `db::notes::list_by_workspace`

- [ ] **Step 1: Write `src-tauri/src/db/schema.rs`**

```rust
use anyhow::Result;
use sqlx::SqlitePool;

pub async fn run_migrations(pool: &SqlitePool) -> Result<()> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS notes (
            id       TEXT    PRIMARY KEY,
            title    TEXT    NOT NULL,
            path     TEXT    NOT NULL UNIQUE,
            workspace TEXT   NOT NULL,
            updated_at INTEGER NOT NULL
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS notes_workspace ON notes(workspace)",
    )
    .execute(pool)
    .await?;

    Ok(())
}
```

- [ ] **Step 2: Write failing tests in `src-tauri/src/db/notes.rs`**

Use `sqlx::query_as::<_, NoteMetadata>()` (runtime version) — no DATABASE_URL needed.

```rust
use anyhow::Result;
use sqlx::SqlitePool;
use crate::models::NoteMetadata;

pub async fn index_note(_pool: &SqlitePool, _note: &NoteMetadata) -> Result<()> {
    todo!()
}

pub async fn remove_note(_pool: &SqlitePool, _path: &str) -> Result<()> {
    todo!()
}

pub async fn list_by_workspace(_pool: &SqlitePool, _workspace: &str) -> Result<Vec<NoteMetadata>> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::run_migrations;

    async fn make_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        run_migrations(&pool).await.unwrap();
        pool
    }

    fn note(id: &str, title: &str, path: &str, workspace: &str) -> NoteMetadata {
        NoteMetadata {
            id: id.into(),
            title: title.into(),
            path: path.into(),
            workspace: workspace.into(),
            updated_at: 1000,
        }
    }

    #[tokio::test]
    async fn test_index_and_list() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "Note A", "/ws/a.md", "/ws")).await.unwrap();
        let notes = list_by_workspace(&pool, "/ws").await.unwrap();
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].title, "Note A");
    }

    #[tokio::test]
    async fn test_upsert_updates_title() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "Old Title", "/ws/a.md", "/ws")).await.unwrap();
        let mut updated = note("a", "New Title", "/ws/a.md", "/ws");
        updated.updated_at = 2000;
        index_note(&pool, &updated).await.unwrap();
        let notes = list_by_workspace(&pool, "/ws").await.unwrap();
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].title, "New Title");
    }

    #[tokio::test]
    async fn test_remove_note() {
        let pool = make_pool().await;
        index_note(&pool, &note("b", "B", "/ws/b.md", "/ws")).await.unwrap();
        remove_note(&pool, "/ws/b.md").await.unwrap();
        let notes = list_by_workspace(&pool, "/ws").await.unwrap();
        assert_eq!(notes.len(), 0);
    }
}
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cargo test --manifest-path src-tauri/Cargo.toml db::notes
```

Expected: FAIL with `not yet implemented`

- [ ] **Step 4: Implement the three functions**

Replace the `todo!()` stubs:

```rust
pub async fn index_note(pool: &SqlitePool, note: &NoteMetadata) -> Result<()> {
    sqlx::query(
        "INSERT INTO notes (id, title, path, workspace, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET
           title      = excluded.title,
           updated_at = excluded.updated_at",
    )
    .bind(&note.id)
    .bind(&note.title)
    .bind(&note.path)
    .bind(&note.workspace)
    .bind(note.updated_at)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn remove_note(pool: &SqlitePool, path: &str) -> Result<()> {
    sqlx::query("DELETE FROM notes WHERE path = ?")
        .bind(path)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn list_by_workspace(pool: &SqlitePool, workspace: &str) -> Result<Vec<NoteMetadata>> {
    let rows = sqlx::query_as::<_, NoteMetadata>(
        "SELECT id, title, path, workspace, updated_at
         FROM notes WHERE workspace = ?
         ORDER BY updated_at DESC",
    )
    .bind(workspace)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}
```

- [ ] **Step 5: Write `src-tauri/src/db/mod.rs`**

```rust
use anyhow::Result;
use sqlx::SqlitePool;
use std::path::Path;

pub mod notes;
pub mod schema;

pub type DbPool = SqlitePool;

pub async fn init_db(app_data_dir: &Path) -> Result<DbPool> {
    std::fs::create_dir_all(app_data_dir)?;
    let db_path = app_data_dir.join("index.db");
    let url = format!("sqlite://{}?mode=rwc", db_path.display());
    let pool = SqlitePool::connect(&url).await?;
    schema::run_migrations(&pool).await?;
    Ok(pool)
}
```

- [ ] **Step 6: Run tests**

```bash
cargo test --manifest-path src-tauri/Cargo.toml db::notes
```

Expected: `test_index_and_list ... ok`, `test_upsert_updates_title ... ok`, `test_remove_note ... ok`

- [ ] **Step 7: Add `mod db` to `main.rs`**

```rust
mod db;
```

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/db/ src-tauri/src/main.rs
git commit -m "feat: SQLite setup with notes index"
```

---

### Task 5: Note File I/O Commands

**Files:**
- Create: `src-tauri/src/commands/mod.rs`
- Create: `src-tauri/src/commands/notes.rs`
- Modify: `src-tauri/src/main.rs`

**Interfaces:**
- Consumes: `DbPool` (Task 4), `NoteMetadata` (Task 3)
- Produces Tauri commands: `list_notes`, `open_note`, `save_note`, `create_note`, `delete_note`

- [ ] **Step 1: Create `src-tauri/src/commands/mod.rs`**

```rust
pub mod notes;
pub mod workspace;
```

- [ ] **Step 2: Write `src-tauri/src/commands/notes.rs`**

```rust
use tauri::State;
use uuid::Uuid;
use std::time::{SystemTime, UNIX_EPOCH};
use crate::db::{self, DbPool};
use crate::models::NoteMetadata;

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

pub fn title_from_content(content: &str) -> String {
    content
        .lines()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("Untitled")
        .trim_start_matches('#')
        .trim()
        .to_string()
}

fn workspace_of(path: &str) -> String {
    std::path::Path::new(path)
        .parent()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default()
}

#[tauri::command]
pub async fn list_notes(
    workspace: String,
    db: State<'_, DbPool>,
) -> Result<Vec<NoteMetadata>, String> {
    db::notes::list_by_workspace(&db, &workspace)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn open_note(path: String) -> Result<String, String> {
    tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_note(
    path: String,
    content: String,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    tokio::fs::write(&path, &content)
        .await
        .map_err(|e| e.to_string())?;

    let meta = NoteMetadata {
        id: Uuid::new_v4().to_string(),
        title: title_from_content(&content),
        path: path.clone(),
        workspace: workspace_of(&path),
        updated_at: now_ms(),
    };
    db::notes::index_note(&db, &meta)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_note(
    workspace: String,
    title: String,
    db: State<'_, DbPool>,
) -> Result<NoteMetadata, String> {
    let safe_name: String = title
        .chars()
        .map(|c| if c.is_alphanumeric() || c == ' ' { c } else { '-' })
        .collect();
    let filename = format!("{}.md", safe_name.trim());
    let path = std::path::Path::new(&workspace).join(&filename);

    tokio::fs::write(&path, format!("# {}\n", title))
        .await
        .map_err(|e| e.to_string())?;

    let meta = NoteMetadata {
        id: Uuid::new_v4().to_string(),
        title,
        path: path.to_string_lossy().into_owned(),
        workspace,
        updated_at: now_ms(),
    };
    db::notes::index_note(&db, &meta)
        .await
        .map_err(|e| e.to_string())?;

    Ok(meta)
}

#[tauri::command]
pub async fn delete_note(
    path: String,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    tokio::fs::remove_file(&path)
        .await
        .map_err(|e| e.to_string())?;

    let ink_dir = path.trim_end_matches(".md").to_string() + ".ink";
    let _ = tokio::fs::remove_dir_all(&ink_dir).await;

    db::notes::remove_note(&db, &path)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_title_from_content_heading() {
        assert_eq!(title_from_content("# Hello World\nsome text"), "Hello World");
    }

    #[test]
    fn test_title_from_content_no_heading() {
        assert_eq!(title_from_content("just text"), "just text");
    }

    #[test]
    fn test_title_from_content_empty() {
        assert_eq!(title_from_content(""), "Untitled");
    }

    #[test]
    fn test_title_from_content_leading_blank_lines() {
        assert_eq!(title_from_content("\n\n# Deep\n"), "Deep");
    }
}
```

- [ ] **Step 3: Run unit tests**

```bash
cargo test --manifest-path src-tauri/Cargo.toml commands::notes
```

Expected: all 4 tests pass.

- [ ] **Step 4: Register commands in `src-tauri/src/main.rs`**

Replace the file content with:

```rust
mod commands;
mod db;
mod models;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let pool = tauri::async_runtime::block_on(db::init_db(&data_dir))
                .expect("failed to initialise database");
            app.manage(pool);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::notes::list_notes,
            commands::notes::open_note,
            commands::notes::save_note,
            commands::notes::create_note,
            commands::notes::delete_note,
            commands::workspace::load_workspace,
            commands::workspace::save_workspace,
        ])
        .run(tauri::generate_context!())
        .expect("error running app");
}

fn main() {
    run();
}
```

- [ ] **Step 5: Verify Rust compiles and clippy passes**

```bash
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/ src-tauri/src/main.rs
git commit -m "feat: note file I/O Tauri commands"
```

---

### Task 6: Workspace State Commands

**Files:**
- Create: `src-tauri/src/commands/workspace.rs`

**Interfaces:**
- Produces Tauri commands: `load_workspace`, `save_workspace`

- [ ] **Step 1: Write failing tests in `src-tauri/src/commands/workspace.rs`**

```rust
use crate::models::WorkspaceState;

const STATE_FILE: &str = ".workspace.json";

pub async fn load_workspace_from_dir(path: &str) -> anyhow::Result<WorkspaceState> {
    todo!()
}

pub async fn save_workspace_to_dir(path: &str, state: &WorkspaceState) -> anyhow::Result<()> {
    todo!()
}

#[tauri::command]
pub async fn load_workspace(path: String) -> Result<WorkspaceState, String> {
    load_workspace_from_dir(&path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_workspace(path: String, state: WorkspaceState) -> Result<(), String> {
    save_workspace_to_dir(&path, &state).await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_load_missing_returns_default() {
        let dir = tempdir().unwrap();
        let state = load_workspace_from_dir(&dir.path().to_string_lossy())
            .await
            .unwrap();
        assert!(state.open_tabs.is_empty());
        assert!(state.active_tab.is_none());
    }

    #[tokio::test]
    async fn test_roundtrip() {
        let dir = tempdir().unwrap();
        let path = dir.path().to_string_lossy().into_owned();
        let original = WorkspaceState {
            open_tabs: vec!["/ws/note.md".into()],
            active_tab: Some("/ws/note.md".into()),
        };
        save_workspace_to_dir(&path, &original).await.unwrap();
        let loaded = load_workspace_from_dir(&path).await.unwrap();
        assert_eq!(loaded.open_tabs, original.open_tabs);
        assert_eq!(loaded.active_tab, original.active_tab);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cargo test --manifest-path src-tauri/Cargo.toml commands::workspace
```

- [ ] **Step 3: Implement the two functions**

```rust
pub async fn load_workspace_from_dir(path: &str) -> anyhow::Result<WorkspaceState> {
    let state_path = std::path::Path::new(path).join(STATE_FILE);
    if !state_path.exists() {
        return Ok(WorkspaceState::default());
    }
    let raw = tokio::fs::read_to_string(&state_path).await?;
    Ok(serde_json::from_str(&raw)?)
}

pub async fn save_workspace_to_dir(path: &str, state: &WorkspaceState) -> anyhow::Result<()> {
    let state_path = std::path::Path::new(path).join(STATE_FILE);
    let json = serde_json::to_string_pretty(state)?;
    tokio::fs::write(&state_path, json).await?;
    Ok(())
}
```

- [ ] **Step 4: Run tests**

```bash
cargo test --manifest-path src-tauri/Cargo.toml commands::workspace
```

Expected: both tests pass.

- [ ] **Step 5: Clippy and commit**

```bash
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
git add src-tauri/src/commands/workspace.rs
git commit -m "feat: workspace session persistence commands"
```

---

### Task 7: TypeScript IPC Layer and Zustand Stores

**Files:**
- Create: `src/lib/tauri.ts`
- Create: `src/store/workspace.ts`
- Create: `src/store/workspace.test.ts`
- Create: `src/store/notes.ts`

- [ ] **Step 1: Write `src/lib/tauri.ts`**

```ts
import { invoke } from '@tauri-apps/api/core'
import type { NoteMetadata, WorkspaceState } from '../types'

export const api = {
  notes: {
    list: (workspace: string) =>
      invoke<NoteMetadata[]>('list_notes', { workspace }),
    open: (path: string) =>
      invoke<string>('open_note', { path }),
    save: (path: string, content: string) =>
      invoke<void>('save_note', { path, content }),
    create: (workspace: string, title: string) =>
      invoke<NoteMetadata>('create_note', { workspace, title }),
    delete: (path: string) =>
      invoke<void>('delete_note', { path }),
  },
  workspace: {
    load: (path: string) =>
      invoke<WorkspaceState>('load_workspace', { path }),
    save: (path: string, state: WorkspaceState) =>
      invoke<void>('save_workspace', { path, state }),
  },
}
```

- [ ] **Step 2: Write failing tests in `src/store/workspace.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useWorkspaceStore } from './workspace'

const reset = () =>
  useWorkspaceStore.setState({ path: null, openTabs: [], activeTab: null })

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
})
```

- [ ] **Step 3: Write `src/store/workspace.ts`**

```ts
import { create } from 'zustand'

interface WorkspaceStore {
  path: string | null
  openTabs: string[]
  activeTab: string | null
  setPath: (path: string) => void
  openTab: (notePath: string) => void
  closeTab: (notePath: string) => void
  setActiveTab: (notePath: string) => void
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  path: null,
  openTabs: [],
  activeTab: null,

  setPath: (path) => set({ path }),

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
}))
```

- [ ] **Step 4: Write `src/store/notes.ts`**

```ts
import { create } from 'zustand'
import type { NoteMetadata } from '../types'

interface NotesStore {
  notes: NoteMetadata[]
  setNotes: (notes: NoteMetadata[]) => void
  addNote: (note: NoteMetadata) => void
  removeNote: (path: string) => void
}

export const useNotesStore = create<NotesStore>((set, get) => ({
  notes: [],
  setNotes: (notes) => set({ notes }),
  addNote: (note) => set({ notes: [note, ...get().notes] }),
  removeNote: (path) =>
    set({ notes: get().notes.filter((n) => n.path !== path) }),
}))
```

- [ ] **Step 5: Run tests and commit**

```bash
npm run test -- workspace.test
git add src/lib/tauri.ts src/store/
git commit -m "feat: typed Tauri IPC wrappers and Zustand stores"
```

---

### Task 8: TipTap Editor Component

- [ ] **Step 1: Write `src/editor/extensions/index.ts`**

```ts
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import Placeholder from '@tiptap/extension-placeholder'

export const coreExtensions = [
  StarterKit,
  Markdown.configure({
    html: false,
    transformPastedText: true,
    transformCopiedText: true,
  }),
  Placeholder.configure({
    placeholder: 'Start writing…',
  }),
]
```

- [ ] **Step 2: Write `src/editor/NoteEditor.tsx`**

```tsx
import { useEditor, EditorContent } from '@tiptap/react'
import { useEffect } from 'react'
import { coreExtensions } from './extensions'

interface NoteEditorProps {
  content: string
  onChange: (markdown: string) => void
}

export function NoteEditor({ content, onChange }: NoteEditorProps) {
  const editor = useEditor({
    extensions: coreExtensions,
    content,
    onUpdate({ editor }) {
      const md = editor.storage.markdown.getMarkdown() as string
      onChange(md)
    },
  })

  useEffect(() => {
    if (!editor) return
    const current = editor.storage.markdown.getMarkdown() as string
    if (content !== current) {
      editor.commands.setContent(content)
    }
  }, [content, editor])

  return (
    <EditorContent
      editor={editor}
      role="textbox"
      aria-multiline="true"
      className="note-editor"
    />
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/editor/
git commit -m "feat: TipTap WYSIWYG editor component"
```

---

### Task 9: Hooks

- [ ] **Step 1: Write `src/hooks/useNote.ts`**

```ts
import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/tauri'

export function useNote(path: string | null) {
  const [content, setContent] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!path) return
    setIsLoading(true)
    api.notes.open(path)
      .then(setContent)
      .finally(() => setIsLoading(false))
  }, [path])

  const save = useCallback(
    async (markdown: string) => {
      if (!path) return
      setContent(markdown)
      await api.notes.save(path, markdown)
    },
    [path],
  )

  return { content, save, isLoading }
}
```

- [ ] **Step 2: Write `src/hooks/useWorkspace.ts`**

```ts
import { useCallback } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { api } from '../lib/tauri'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'

export function useWorkspace() {
  const { setPath, openTab } = useWorkspaceStore()
  const { setNotes } = useNotesStore()

  const openWorkspace = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false })
    if (!selected || Array.isArray(selected)) return

    setPath(selected)
    const [notes, session] = await Promise.all([
      api.notes.list(selected),
      api.workspace.load(selected),
    ])
    setNotes(notes)
    for (const tab of session.openTabs) {
      openTab(tab)
    }
  }, [setPath, setNotes, openTab])

  const saveSession = useCallback(async () => {
    const { path, openTabs, activeTab } = useWorkspaceStore.getState()
    if (!path) return
    await api.workspace.save(path, { openTabs, activeTab })
  }, [])

  return { openWorkspace, saveSession }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/hooks/
git commit -m "feat: useNote and useWorkspace hooks"
```

---

### Task 10: UI — Sidebar, Tab Bar, Layout, App

- [ ] **Step 1: Write `src/components/Sidebar.tsx`**

```tsx
import { useNotesStore } from '../store/notes'
import { useWorkspaceStore } from '../store/workspace'
import { useWorkspace } from '../hooks/useWorkspace'
import { api } from '../lib/tauri'

export function Sidebar() {
  const notes = useNotesStore((s) => s.notes)
  const removeNote = useNotesStore((s) => s.removeNote)
  const addNote = useNotesStore((s) => s.addNote)
  const workspacePath = useWorkspaceStore((s) => s.path)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const closeTab = useWorkspaceStore((s) => s.closeTab)
  const { openWorkspace } = useWorkspace()

  async function handleCreate() {
    if (!workspacePath) return
    const title = prompt('Note title:')
    if (!title) return
    const meta = await api.notes.create(workspacePath, title)
    addNote(meta)
    openTab(meta.path)
  }

  async function handleDelete(notePath: string) {
    if (!confirm('Delete this note?')) return
    await api.notes.delete(notePath)
    removeNote(notePath)
    closeTab(notePath)
  }

  return (
    <aside className="sidebar">
      <button onClick={openWorkspace}>Open Workspace</button>
      <button onClick={handleCreate} disabled={!workspacePath}>New Note</button>
      <ul>
        {notes.map((note) => (
          <li key={note.path}>
            <button className="note-link" onClick={() => openTab(note.path)}>{note.title}</button>
            <button className="note-delete" onClick={() => handleDelete(note.path)} aria-label={`Delete ${note.title}`}>✕</button>
          </li>
        ))}
      </ul>
    </aside>
  )
}
```

- [ ] **Step 2: Write `src/components/TabBar.tsx`**

```tsx
import { useWorkspaceStore } from '../store/workspace'

export function TabBar() {
  const { openTabs, activeTab, setActiveTab, closeTab } = useWorkspaceStore()
  if (openTabs.length === 0) return null
  return (
    <div className="tab-bar" role="tablist">
      {openTabs.map((path) => {
        const name = path.split(/[\\/]/).pop()?.replace('.md', '') ?? path
        const isActive = path === activeTab
        return (
          <div key={path} role="tab" aria-selected={isActive} className={`tab${isActive ? ' active' : ''}`}>
            <button onClick={() => setActiveTab(path)}>{name}</button>
            <button onClick={() => closeTab(path)} aria-label={`Close ${name}`}>✕</button>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 3: Write `src/components/Layout.tsx`**

```tsx
import { useEffect } from 'react'
import { Sidebar } from './Sidebar'
import { TabBar } from './TabBar'
import { NoteEditor } from '../editor/NoteEditor'
import { useWorkspaceStore } from '../store/workspace'
import { useNote } from '../hooks/useNote'
import { useWorkspace } from '../hooks/useWorkspace'

export function Layout() {
  const activeTab = useWorkspaceStore((s) => s.activeTab)
  const { content, save, isLoading } = useNote(activeTab)
  const { saveSession } = useWorkspace()

  useEffect(() => {
    const handler = () => { void saveSession() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [saveSession])

  return (
    <div className="layout">
      <Sidebar />
      <div className="main">
        <TabBar />
        <div className="editor-pane">
          {isLoading && <p className="status">Loading…</p>}
          {!isLoading && activeTab && <NoteEditor content={content} onChange={save} />}
          {!activeTab && <p className="empty-state">Open a workspace and select a note</p>}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Replace `src/App.tsx`**

```tsx
import { Layout } from './components/Layout'
export default function App() {
  return <Layout />
}
```

- [ ] **Step 5: Replace `src/index.css`** — (see full styles in original plan)

- [ ] **Step 6: Add dialog permission to `src-tauri/capabilities/default.json`**

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Default capability",
  "windows": ["main"],
  "permissions": ["core:default", "dialog:allow-open"]
}
```

- [ ] **Step 7: Launch, smoke test, typecheck, and commit**

```bash
npm run tauri dev
npm run typecheck
git add src/components/ src/App.tsx src/index.css src-tauri/capabilities/
git commit -m "feat: sidebar, tab bar, layout — complete foundation UI"
```

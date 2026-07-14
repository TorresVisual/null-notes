# Tags and Backlinks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (default) or superpowers:subagent-driven-development if explicitly requested.

**Goal:** Add inline `#tags` and a backlinks panel for `[[wiki-links]]`, both extracted via a shared content-indexing pass into new SQLite tables, surfaced as a tag browser in the sidebar and a "linked from" panel below the editor.

**Architecture:** Rust extracts tags and wiki-link targets from a note's raw markdown at save/create time (mirroring how FTS indexing already works), storing them in two new path-keyed tables. The existing folder rename/delete/move cascade (`update_path`, `remove_notes_under`) is extended to keep these tables in sync. The frontend gets a `Tag` TipTap extension mirroring the existing `WikiLink` extension, a sidebar tag browser, and a backlinks panel below the editor.

**Tech Stack:** Tauri 2, Rust, sqlx (SQLite), regex, React 19, TypeScript strict, Zustand, TipTap 3, Vitest

**Spec:** `docs/specs/tags-backlinks-design.md`

**Deviation from spec (documented here since it affects task design):** the spec says tags/backlinks refresh "after any save." Saves fire on every editor keystroke with no debounce (confirmed in `useNote.ts`/`NoteEditor.tsx`), so refetching `list_tags` on every save would mean a DB round-trip per keystroke and sidebar re-renders while typing. Tasks 7 and 10 instead refresh when the active note changes (opening/switching notes) — this still reflects any prior edits by the time you'd actually look at the tag list or a backlinks panel, without the performance cost.

## Global Constraints

- Tauri 2 only — `@tauri-apps/api/core` for `invoke`
- TypeScript strict mode — no `any`, no non-null assertions unless the null case is structurally impossible
- No `.unwrap()` / `.expect()` outside `#[cfg(test)]` in Rust — regex compilation failures degrade gracefully via `.unwrap_or(...)`, matching the existing `pdf::parser::is_exercise_header` convention
- `cargo clippy -- -D warnings` must pass clean
- All Tauri commands return `Result<T, String>`
- Tags are case-preserved for display, case-insensitive for matching/counting
- `.ink` sidecar directories are never treated as folders (unaffected by this feature, noted for context)

---

## File Map

### src-tauri/

| File | Change |
|---|---|
| `src/db/schema.rs` | Add `note_tags`, `note_links` tables + indexes |
| `src/commands/notes.rs` | Add `extract_tags`/`extract_links` pure functions; wire extraction into `save_note`/`create_note`/`delete_note`; add `list_tags`/`notes_with_tag`/`backlinks_for` commands |
| `src/db/notes.rs` | Add `set_tags`/`set_links`/`list_tags`/`notes_with_tag`/`backlinks_for`; extend `update_path`/`remove_notes_under` to cover the two new tables |
| `src/lib.rs` | Register new commands |

### src/ (frontend)

| File | Change |
|---|---|
| `lib/tauri.ts` | Add `listTags`/`notesWithTag`/`backlinksFor` wrappers |
| `store/notes.ts` | Add `tags: string[]`, `setTags` |
| `store/workspace.ts` | Add `tagFilter: string \| null`, `setTagFilter` |
| `hooks/useWorkspace.ts` | Add standalone `refreshTags()` |
| `components/Layout.tsx` | Refresh tags/backlinks on active-note change; render `BacklinksPanel` |
| `components/Sidebar.tsx` | Tag-filter mode (flat list) alongside the existing folder-tree mode |
| `components/TreeNode.tsx` | Clicking a folder clears the active tag filter |
| `components/TagList.tsx` | New — sidebar tag browser |
| `components/BacklinksPanel.tsx` | New — "linked from" panel below the editor |
| `editor/extensions/Tag.tsx` | New — TipTap node for `#tag` |
| `editor/extensions/index.ts` | Register `Tag` |
| `index.css` | Tag pill, tag list, backlinks panel styles |

---

### Task 1: `note_tags` / `note_links` schema

**Files:**
- Modify: `src-tauri/src/db/schema.rs`

**Interfaces:**
- Produces: `note_tags(note_path, tag)`, `note_links(source_path, target_title)` tables with indexes on `tag` and `target_title`

- [ ] **Step 1: Add the two tables to `run_migrations`**

```rust
sqlx::query(
    "CREATE TABLE IF NOT EXISTS note_tags (
        note_path TEXT NOT NULL,
        tag       TEXT NOT NULL
    )",
)
.execute(pool)
.await?;

sqlx::query(
    "CREATE INDEX IF NOT EXISTS note_tags_tag ON note_tags(tag)",
)
.execute(pool)
.await?;

sqlx::query(
    "CREATE TABLE IF NOT EXISTS note_links (
        source_path   TEXT NOT NULL,
        target_title  TEXT NOT NULL
    )",
)
.execute(pool)
.await?;

sqlx::query(
    "CREATE INDEX IF NOT EXISTS note_links_target ON note_links(target_title)",
)
.execute(pool)
.await?;
```

Add this block right before the final `Ok(())` in `run_migrations`.

- [ ] **Step 2: Verify Rust compiles**

```bash
cargo build --manifest-path src-tauri/Cargo.toml
```

Expected: compiles clean (existing tests still pass since `run_migrations` is additive).

- [ ] **Step 3: Run the existing test suite to confirm nothing broke**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: all pass (27 passed, 3 ignored — same as before this change).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/db/schema.rs
git commit -m "feat: note_tags and note_links tables"
```

---

### Task 2: `extract_tags` / `extract_links` pure functions

**Files:**
- Modify: `src-tauri/src/commands/notes.rs`

**Interfaces:**
- Produces: `extract_tags(content: &str) -> Vec<String>`; `extract_links(content: &str) -> Vec<String>`

- [ ] **Step 1: Write the failing tests**

Add to the `#[cfg(test)] mod tests` block in `src-tauri/src/commands/notes.rs`:

```rust
#[test]
fn test_extract_tags_finds_inline_hashtags() {
    let tags = extract_tags("Notes on #recursion and #dynamic-programming today.");
    assert_eq!(tags, vec!["recursion", "dynamic-programming"]);
}

#[test]
fn test_extract_tags_ignores_atx_headings() {
    let tags = extract_tags("# Heading One\n## Heading Two\nSome #realtag here.");
    assert_eq!(tags, vec!["realtag"]);
}

#[test]
fn test_extract_tags_ignores_fenced_code() {
    let content = "See #important below.\n```c\n#include <stdio.h>\n#define MAX 10\n```\nDone.";
    let tags = extract_tags(content);
    assert_eq!(tags, vec!["important"]);
}

#[test]
fn test_extract_tags_ignores_inline_code() {
    let tags = extract_tags("Use `#define` for macros, but #cpreprocessor is a real tag.");
    assert_eq!(tags, vec!["cpreprocessor"]);
}

#[test]
fn test_extract_tags_deduplicates_case_insensitively() {
    let tags = extract_tags("#CS101 material. Revisit #cs101 before the exam. #cs101");
    assert_eq!(tags, vec!["CS101"]);
}

#[test]
fn test_extract_tags_ignores_hash_mid_word() {
    let tags = extract_tags("issue#42 is not a tag, but #issue42 is.");
    assert_eq!(tags, vec!["issue42"]);
}

#[test]
fn test_extract_tags_empty_content() {
    assert!(extract_tags("").is_empty());
}

#[test]
fn test_extract_links_finds_wiki_links() {
    let links = extract_links("See [[Big O Notation]] and [[Sorting Algorithms]].");
    assert_eq!(links, vec!["Big O Notation", "Sorting Algorithms"]);
}

#[test]
fn test_extract_links_deduplicates_case_insensitively() {
    let links = extract_links("[[Big O Notation]] again: [[big o notation]]");
    assert_eq!(links, vec!["Big O Notation"]);
}

#[test]
fn test_extract_links_empty_content() {
    assert!(extract_links("").is_empty());
}
```

- [ ] **Step 2: Run tests to verify they fail to compile**

```bash
cargo test --manifest-path src-tauri/Cargo.toml commands::notes::tests
```

Expected: FAIL to compile — `extract_tags`/`extract_links` not found.

- [ ] **Step 3: Implement `extract_tags` and `extract_links`**

Add to `src-tauri/src/commands/notes.rs`, after `title_from_content`:

```rust
use regex::Regex;
use std::collections::HashSet;

fn strip_code(content: &str) -> String {
    let without_fences = Regex::new(r"(?s)```.*?```")
        .map(|re| re.replace_all(content, "").into_owned())
        .unwrap_or_else(|_| content.to_string());
    Regex::new(r"`[^`\n]*`")
        .map(|re| re.replace_all(&without_fences, "").into_owned())
        .unwrap_or(without_fences)
}

pub fn extract_tags(content: &str) -> Vec<String> {
    let stripped = strip_code(content);
    let re = match Regex::new(r"(?:^|\s)#([A-Za-z][\w-]*)") {
        Ok(re) => re,
        Err(_) => return Vec::new(),
    };
    let mut seen = HashSet::new();
    let mut tags = Vec::new();
    for cap in re.captures_iter(&stripped) {
        if let Some(m) = cap.get(1) {
            let tag = m.as_str().to_string();
            if seen.insert(tag.to_lowercase()) {
                tags.push(tag);
            }
        }
    }
    tags
}

pub fn extract_links(content: &str) -> Vec<String> {
    let re = match Regex::new(r"\[\[([^\]\n]+)\]\]") {
        Ok(re) => re,
        Err(_) => return Vec::new(),
    };
    let mut seen = HashSet::new();
    let mut links = Vec::new();
    for cap in re.captures_iter(content) {
        if let Some(m) = cap.get(1) {
            let title = m.as_str().trim().to_string();
            if !title.is_empty() && seen.insert(title.to_lowercase()) {
                links.push(title);
            }
        }
    }
    links
}
```

`extract_links` uses the same `\[\[([^\]\n]+)\]\]` pattern already used by `WikiLink.tsx`'s frontend markdown-it parse rule, so backend backlink indexing and frontend link rendering agree on what counts as a link.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cargo test --manifest-path src-tauri/Cargo.toml commands::notes::tests
```

Expected: all pass, including the pre-existing `title_from_content`/`scan_dir_recursive` tests.

- [ ] **Step 5: Clippy**

```bash
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/notes.rs
git commit -m "feat: extract_tags/extract_links pure functions

Tags require no space after '#' (disambiguates from ATX headings,
which require one) and are extracted after stripping fenced/inline
code so #include/#define in C/C++ snippets are never mistaken for
tags. Both functions dedupe case-insensitively, preserving first-seen
casing."
```

---

### Task 3: `db::notes` tag/link storage and folder-cascade extension

**Files:**
- Modify: `src-tauri/src/db/notes.rs`

**Interfaces:**
- Consumes: `NoteMetadata` (existing)
- Produces: `set_tags(pool, note_path, tags: &[String]) -> Result<()>`; `set_links(pool, source_path, targets: &[String]) -> Result<()>`; `list_tags(pool, workspace) -> Result<Vec<String>>`; `notes_with_tag(pool, workspace, tag) -> Result<Vec<NoteMetadata>>`; `backlinks_for(pool, workspace, title) -> Result<Vec<NoteMetadata>>`
- Modifies: `update_path` and `remove_notes_under` now also cover `note_tags`/`note_links`

- [ ] **Step 1: Write the failing tests**

Add to the `#[cfg(test)] mod tests` block in `src-tauri/src/db/notes.rs`:

```rust
#[tokio::test]
async fn test_set_tags_replaces_existing_tags_for_a_note() {
    let pool = make_pool().await;
    index_note(&pool, &note("a", "A", "/ws/a.md", "/ws")).await.unwrap();
    set_tags(&pool, "/ws/a.md", &["cs101".to_string(), "midterm".to_string()]).await.unwrap();
    set_tags(&pool, "/ws/a.md", &["final".to_string()]).await.unwrap();

    let tags = list_tags(&pool, "/ws").await.unwrap();
    assert_eq!(tags, vec!["final".to_string()]);
}

#[tokio::test]
async fn test_notes_with_tag_returns_matching_notes_only() {
    let pool = make_pool().await;
    index_note(&pool, &note("a", "A", "/ws/a.md", "/ws")).await.unwrap();
    index_note(&pool, &note("b", "B", "/ws/b.md", "/ws")).await.unwrap();
    set_tags(&pool, "/ws/a.md", &["cs101".to_string()]).await.unwrap();
    set_tags(&pool, "/ws/b.md", &["cs102".to_string()]).await.unwrap();

    let notes = notes_with_tag(&pool, "/ws", "cs101").await.unwrap();
    assert_eq!(notes.len(), 1);
    assert_eq!(notes[0].id, "a");
}

#[tokio::test]
async fn test_notes_with_tag_matches_case_insensitively() {
    let pool = make_pool().await;
    index_note(&pool, &note("a", "A", "/ws/a.md", "/ws")).await.unwrap();
    set_tags(&pool, "/ws/a.md", &["CS101".to_string()]).await.unwrap();

    let notes = notes_with_tag(&pool, "/ws", "cs101").await.unwrap();
    assert_eq!(notes.len(), 1);
}

#[tokio::test]
async fn test_set_links_and_backlinks_for() {
    let pool = make_pool().await;
    index_note(&pool, &note("a", "A", "/ws/a.md", "/ws")).await.unwrap();
    index_note(&pool, &note("b", "B", "/ws/b.md", "/ws")).await.unwrap();
    set_links(&pool, "/ws/a.md", &["B".to_string()]).await.unwrap();

    let backlinks = backlinks_for(&pool, "/ws", "B").await.unwrap();
    assert_eq!(backlinks.len(), 1);
    assert_eq!(backlinks[0].id, "a");
}

#[tokio::test]
async fn test_backlinks_for_matches_case_insensitively() {
    let pool = make_pool().await;
    index_note(&pool, &note("a", "A", "/ws/a.md", "/ws")).await.unwrap();
    set_links(&pool, "/ws/a.md", &["big o notation".to_string()]).await.unwrap();

    let backlinks = backlinks_for(&pool, "/ws", "Big O Notation").await.unwrap();
    assert_eq!(backlinks.len(), 1);
}

#[tokio::test]
async fn test_update_path_also_rewrites_tags_and_links() {
    let pool = make_pool().await;
    index_note(&pool, &note("a", "A", "/ws/old.md", "/ws")).await.unwrap();
    set_tags(&pool, "/ws/old.md", &["cs101".to_string()]).await.unwrap();
    set_links(&pool, "/ws/old.md", &["Target".to_string()]).await.unwrap();

    update_path(&pool, "/ws/old.md", "/ws/Folder/old.md").await.unwrap();

    let notes = notes_with_tag(&pool, "/ws", "cs101").await.unwrap();
    assert_eq!(notes[0].path, "/ws/Folder/old.md");

    let backlinks = backlinks_for(&pool, "/ws", "Target").await.unwrap();
    assert_eq!(backlinks[0].path, "/ws/Folder/old.md");
}

#[tokio::test]
async fn test_remove_notes_under_also_deletes_tags_and_links() {
    let pool = make_pool().await;
    index_note(&pool, &note("a", "A", "/ws/Course1/a.md", "/ws")).await.unwrap();
    set_tags(&pool, "/ws/Course1/a.md", &["cs101".to_string()]).await.unwrap();
    set_links(&pool, "/ws/Course1/a.md", &["Target".to_string()]).await.unwrap();
    index_note(&pool, &note("b", "B", "/ws/Course10/b.md", "/ws")).await.unwrap();
    set_tags(&pool, "/ws/Course10/b.md", &["cs102".to_string()]).await.unwrap();

    remove_notes_under(&pool, "/ws/Course1/").await.unwrap();

    let all_tags = list_tags(&pool, "/ws").await.unwrap();
    assert_eq!(all_tags, vec!["cs102".to_string()]);
    let backlinks = backlinks_for(&pool, "/ws", "Target").await.unwrap();
    assert!(backlinks.is_empty());
}
```

- [ ] **Step 2: Run tests to verify they fail to compile**

```bash
cargo test --manifest-path src-tauri/Cargo.toml db::notes
```

Expected: FAIL to compile — `set_tags`/`set_links`/`list_tags`/`notes_with_tag`/`backlinks_for` not found.

- [ ] **Step 3: Implement the new functions and extend `update_path`/`remove_notes_under`**

Add to `src-tauri/src/db/notes.rs` (after `search_notes`, before `list_by_workspace`):

```rust
pub async fn set_tags(pool: &SqlitePool, note_path: &str, tags: &[String]) -> Result<()> {
    sqlx::query("DELETE FROM note_tags WHERE note_path = ?")
        .bind(note_path)
        .execute(pool)
        .await?;
    for tag in tags {
        sqlx::query("INSERT INTO note_tags (note_path, tag) VALUES (?, ?)")
            .bind(note_path)
            .bind(tag)
            .execute(pool)
            .await?;
    }
    Ok(())
}

pub async fn set_links(pool: &SqlitePool, source_path: &str, targets: &[String]) -> Result<()> {
    sqlx::query("DELETE FROM note_links WHERE source_path = ?")
        .bind(source_path)
        .execute(pool)
        .await?;
    for target in targets {
        sqlx::query("INSERT INTO note_links (source_path, target_title) VALUES (?, ?)")
            .bind(source_path)
            .bind(target)
            .execute(pool)
            .await?;
    }
    Ok(())
}

pub async fn list_tags(pool: &SqlitePool, workspace: &str) -> Result<Vec<String>> {
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT DISTINCT nt.tag FROM note_tags nt
         JOIN notes n ON n.path = nt.note_path
         WHERE n.workspace = ?
         ORDER BY nt.tag COLLATE NOCASE",
    )
    .bind(workspace)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|(t,)| t).collect())
}

pub async fn notes_with_tag(pool: &SqlitePool, workspace: &str, tag: &str) -> Result<Vec<NoteMetadata>> {
    let rows = sqlx::query_as::<_, NoteMetadata>(
        "SELECT n.id, n.title, n.path, n.workspace, n.updated_at
         FROM notes n
         JOIN note_tags nt ON nt.note_path = n.path
         WHERE n.workspace = ? AND nt.tag = ? COLLATE NOCASE
         ORDER BY n.updated_at DESC",
    )
    .bind(workspace)
    .bind(tag)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn backlinks_for(pool: &SqlitePool, workspace: &str, title: &str) -> Result<Vec<NoteMetadata>> {
    let rows = sqlx::query_as::<_, NoteMetadata>(
        "SELECT n.id, n.title, n.path, n.workspace, n.updated_at
         FROM notes n
         JOIN note_links nl ON nl.source_path = n.path
         WHERE n.workspace = ? AND nl.target_title = ? COLLATE NOCASE
         ORDER BY n.updated_at DESC",
    )
    .bind(workspace)
    .bind(title)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}
```

Modify `update_path` to also rewrite `note_tags`/`note_links` rows:

```rust
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
    sqlx::query("UPDATE note_tags SET note_path = ? WHERE note_path = ?")
        .bind(new_path)
        .bind(old_path)
        .execute(pool)
        .await?;
    sqlx::query("UPDATE note_links SET source_path = ? WHERE source_path = ?")
        .bind(new_path)
        .bind(old_path)
        .execute(pool)
        .await?;
    Ok(())
}
```

Modify `remove_notes_under` to also delete matching `note_tags`/`note_links` rows:

```rust
pub async fn remove_notes_under(pool: &SqlitePool, prefix: &str) -> Result<()> {
    let like_pattern = format!("{}%", escape_like(prefix));
    sqlx::query("DELETE FROM notes WHERE path LIKE ? ESCAPE '\\'")
        .bind(&like_pattern)
        .execute(pool)
        .await?;
    sqlx::query("DELETE FROM notes_fts WHERE path LIKE ? ESCAPE '\\'")
        .bind(&like_pattern)
        .execute(pool)
        .await?;
    sqlx::query("DELETE FROM note_tags WHERE note_path LIKE ? ESCAPE '\\'")
        .bind(&like_pattern)
        .execute(pool)
        .await?;
    sqlx::query("DELETE FROM note_links WHERE source_path LIKE ? ESCAPE '\\'")
        .bind(&like_pattern)
        .execute(pool)
        .await?;
    Ok(())
}
```

Since `rename_path_prefix` already calls `update_path` per affected note, and `move_note_at`/`rename_folder_at`/`delete_folder_at` (in `commands/notes.rs`) already call `update_path`/`rename_path_prefix`/`remove_notes_under`, this one change point covers move, rename, and delete for tags/links without touching the command layer at all.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cargo test --manifest-path src-tauri/Cargo.toml db::notes
```

Expected: all pass, including every pre-existing `db::notes` test.

- [ ] **Step 5: Clippy and commit**

```bash
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
git add src-tauri/src/db/notes.rs
git commit -m "feat: tag/link storage, extending the folder-rename/delete cascade

set_tags/set_links follow the same clear-and-reinsert pattern as
index_note_content. update_path and remove_notes_under now also cover
note_tags/note_links, so renaming or deleting a folder no longer
orphans the tags and backlinks of the notes inside it — the same fix
point already used by move_note/rename_folder/delete_folder."
```

---

### Task 4: Wire extraction into commands, add tag/backlink commands

**Files:**
- Modify: `src-tauri/src/commands/notes.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `extract_tags`, `extract_links` (Task 2); `set_tags`, `set_links`, `list_tags`, `notes_with_tag`, `backlinks_for` (Task 3)
- Produces: `list_tags(workspace) -> Result<Vec<String>, String>`; `notes_with_tag(workspace, tag) -> Result<Vec<NoteMetadata>, String>`; `backlinks_for(workspace, title) -> Result<Vec<NoteMetadata>, String>`

- [ ] **Step 1: Update `save_note` to extract and store tags/links**

Replace the body of `save_note`:

```rust
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
        .map_err(|e| e.to_string())?;

    let tags = extract_tags(&content);
    db::notes::set_tags(&db, &path, &tags)
        .await
        .map_err(|e| e.to_string())?;

    let links = extract_links(&content);
    db::notes::set_links(&db, &path, &links)
        .await
        .map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Update `create_note` to extract and store tags/links**

Replace the body of `create_note`:

```rust
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
    let body = format!("# {}\n", title);

    tokio::fs::write(&path, &body)
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

    db::notes::index_note_content(&db, &meta.path, &meta.title, &body)
        .await
        .map_err(|e| e.to_string())?;

    let tags = extract_tags(&body);
    db::notes::set_tags(&db, &meta.path, &tags)
        .await
        .map_err(|e| e.to_string())?;

    let links = extract_links(&body);
    db::notes::set_links(&db, &meta.path, &links)
        .await
        .map_err(|e| e.to_string())?;

    Ok(meta)
}
```

(This also fixes a pre-existing inconsistency where the file was written with a trailing newline but the FTS index was given the body without one — both now use the same `body` variable.)

- [ ] **Step 3: Update `delete_note` to clear tags/links**

Replace the body of `delete_note`:

```rust
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
        .map_err(|e| e.to_string())?;

    db::notes::remove_from_fts(&db, &path)
        .await
        .map_err(|e| e.to_string())?;

    db::notes::set_tags(&db, &path, &[])
        .await
        .map_err(|e| e.to_string())?;

    db::notes::set_links(&db, &path, &[])
        .await
        .map_err(|e| e.to_string())
}
```

- [ ] **Step 4: Add the three new commands**

Add after `search_notes`:

```rust
#[tauri::command]
pub async fn list_tags(workspace: String, db: State<'_, DbPool>) -> Result<Vec<String>, String> {
    db::notes::list_tags(&db, &workspace)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn notes_with_tag(
    workspace: String,
    tag: String,
    db: State<'_, DbPool>,
) -> Result<Vec<NoteMetadata>, String> {
    db::notes::notes_with_tag(&db, &workspace, &tag)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn backlinks_for(
    workspace: String,
    title: String,
    db: State<'_, DbPool>,
) -> Result<Vec<NoteMetadata>, String> {
    db::notes::backlinks_for(&db, &workspace, &title)
        .await
        .map_err(|e| e.to_string())
}
```

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
    commands::notes::list_tags,
    commands::notes::notes_with_tag,
    commands::notes::backlinks_for,
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

- [ ] **Step 6: Full Rust test suite, clippy, and build**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo build --manifest-path src-tauri/Cargo.toml
```

Expected: all tests pass, clippy clean, build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/commands/notes.rs src-tauri/src/lib.rs
git commit -m "feat: wire tag/link extraction into save/create/delete, add tag/backlink commands"
```

---

### Task 5: Frontend types and `tauri.ts` wrappers

**Files:**
- Modify: `src/lib/tauri.ts`

**Interfaces:**
- Consumes: `list_tags`, `notes_with_tag`, `backlinks_for` (Task 4)
- Produces: `api.notes.listTags`, `api.notes.notesWithTag`, `api.notes.backlinksFor`

No new TS types are needed — `list_tags` returns `string[]`, and `notes_with_tag`/`backlinks_for` both return `NoteMetadata[]`, an existing type.

- [ ] **Step 1: Add the three wrappers to `src/lib/tauri.ts`**

```ts
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
    listTags: (workspace: string) =>
      invoke<string[]>('list_tags', { workspace }),
    notesWithTag: (workspace: string, tag: string) =>
      invoke<NoteMetadata[]>('notes_with_tag', { workspace, tag }),
    backlinksFor: (workspace: string, title: string) =>
      invoke<NoteMetadata[]>('backlinks_for', { workspace, title }),
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

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/lib/tauri.ts
git commit -m "feat: listTags/notesWithTag/backlinksFor API wrappers"
```

---

### Task 6: Store updates — `useNotesStore.tags` and `useWorkspaceStore.tagFilter`

**Files:**
- Modify: `src/store/notes.ts`
- Modify: `src/store/notes.test.ts`
- Modify: `src/store/workspace.ts`
- Modify: `src/store/workspace.test.ts`

**Interfaces:**
- Produces: `useNotesStore` gains `tags: string[]`, `setTags`; `useWorkspaceStore` gains `tagFilter: string | null`, `setTagFilter`

- [ ] **Step 1: Write the failing tests**

Add to `src/store/notes.test.ts`:

```ts
it('setTags replaces the tag list', () => {
  useNotesStore.getState().setTags(['cs101', 'midterm'])
  expect(useNotesStore.getState().tags).toEqual(['cs101', 'midterm'])
})
```

Update the `reset` function in the same file to include `tags: []`:

```ts
const reset = () => useNotesStore.setState({ notes: [], folders: [], tags: [] })
```

Add to `src/store/workspace.test.ts`:

```ts
it('sets and clears the tag filter', () => {
  useWorkspaceStore.getState().setTagFilter('cs101')
  expect(useWorkspaceStore.getState().tagFilter).toBe('cs101')
  useWorkspaceStore.getState().setTagFilter(null)
  expect(useWorkspaceStore.getState().tagFilter).toBeNull()
})
```

Update the `reset` function in the same file to include `tagFilter: null`:

```ts
const reset = () =>
  useWorkspaceStore.setState({
    path: null,
    openTabs: [],
    activeTab: null,
    expandedFolders: [],
    selectedFolder: null,
    folderContextMenu: null,
    folderError: null,
    tagFilter: null,
  })
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test -- store/notes.test store/workspace.test
```

Expected: FAIL — `setTags`/`tags`/`setTagFilter`/`tagFilter` not found.

- [ ] **Step 3: Implement `src/store/notes.ts`**

```ts
import { create } from 'zustand'
import type { NoteMetadata } from '../types'

interface NotesStore {
  notes: NoteMetadata[]
  folders: string[]
  tags: string[]
  setNotes: (notes: NoteMetadata[]) => void
  setFolders: (folders: string[]) => void
  setTags: (tags: string[]) => void
  addNote: (note: NoteMetadata) => void
  removeNote: (path: string) => void
}

export const useNotesStore = create<NotesStore>((set, get) => ({
  notes: [],
  folders: [],
  tags: [],
  setNotes: (notes) => set({ notes }),
  setFolders: (folders) => set({ folders }),
  setTags: (tags) => set({ tags }),
  addNote: (note) => set({ notes: [note, ...get().notes] }),
  removeNote: (path) =>
    set({ notes: get().notes.filter((n) => n.path !== path) }),
}))
```

- [ ] **Step 4: Implement `src/store/workspace.ts`**

Add `tagFilter: string | null` and `setTagFilter` to the `WorkspaceStore` interface and its implementation:

```ts
interface WorkspaceStore {
  path: string | null
  openTabs: string[]
  activeTab: string | null
  expandedFolders: string[]
  selectedFolder: string | null
  folderContextMenu: FolderContextMenuState | null
  tagFilter: string | null
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
  setTagFilter: (tag: string | null) => void
}
```

Add `tagFilter: null,` to the initial state object, and `setTagFilter: (tag) => set({ tagFilter: tag }),` alongside the other setters.

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm run test -- store/notes.test store/workspace.test
```

Expected: all pass.

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```

Expected: passes.

- [ ] **Step 7: Commit**

```bash
git add src/store/notes.ts src/store/notes.test.ts src/store/workspace.ts src/store/workspace.test.ts
git commit -m "feat: tags list and tag-filter state in the notes/workspace stores"
```

---

### Task 7: `refreshTags()` and note-switch refresh wiring

**Files:**
- Modify: `src/hooks/useWorkspace.ts`
- Modify: `src/components/Layout.tsx`

**Interfaces:**
- Consumes: `api.notes.listTags` (Task 5), `setTags` (Task 6)
- Produces: standalone `refreshTags(): Promise<void>`

- [ ] **Step 1: Add `refreshTags` to `src/hooks/useWorkspace.ts`**

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

export async function refreshTags(): Promise<void> {
  const path = useWorkspaceStore.getState().path
  if (!path) return
  const tags = await api.notes.listTags(path)
  useNotesStore.getState().setTags(tags)
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
    await refreshTags()
  }, [setPath, setNotes, setFolders, setExpandedFolders, openTab])

  const saveSession = useCallback(async () => {
    const { path, openTabs, activeTab, expandedFolders } = useWorkspaceStore.getState()
    if (!path) return
    await api.workspace.save(path, { openTabs, activeTab, expandedFolders })
  }, [])

  return { openWorkspace, saveSession }
}
```

- [ ] **Step 2: Refresh tags whenever the active note changes, in `src/components/Layout.tsx`**

`Layout.tsx` already has `import { useWorkspace } from '../hooks/useWorkspace'` — change it to also bring in `refreshTags` from the same module:

```tsx
import { useWorkspace, refreshTags } from '../hooks/useWorkspace'
```

Add a new effect alongside the existing `activeTab`-keyed effect:

```tsx
useEffect(() => {
  void refreshTags()
}, [activeTab])
```

This fires on initial load (when a restored session sets `activeTab`) and every time you switch notes — catching tag changes from whatever was just edited, without querying on every keystroke.

- [ ] **Step 3: Typecheck and build**

```bash
npm run typecheck
npm run build
```

Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useWorkspace.ts src/components/Layout.tsx
git commit -m "feat: refresh workspace tags on workspace open and note switch

Deliberately not refreshed on every save — saves fire on every editor
keystroke with no debounce, so a per-keystroke list_tags round-trip
would be wasteful. Refreshing on note-switch (including the initial
tab restored from session) keeps the tag list current for realistic
usage."
```

---

### Task 8: `Tag` TipTap extension

**Files:**
- Create: `src/editor/extensions/Tag.tsx`
- Modify: `src/editor/extensions/index.ts`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: `tagFilter`, `setTagFilter` (Task 6)
- Produces: `Tag` TipTap node extension

- [ ] **Step 1: Write `src/editor/extensions/Tag.tsx`**

```tsx
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { useWorkspaceStore } from '../../store/workspace'

interface TagAttrs {
  name: string
}

function TagView({ node }: ReactNodeViewProps) {
  const { name } = node.attrs as unknown as TagAttrs
  const tagFilter = useWorkspaceStore((s) => s.tagFilter)
  const setTagFilter = useWorkspaceStore((s) => s.setTagFilter)
  const isActive = tagFilter?.toLowerCase() === name.toLowerCase()

  function handleClick() {
    setTagFilter(isActive ? null : name)
  }

  return (
    <NodeViewWrapper
      as="span"
      className={`tag-pill${isActive ? ' active' : ''}`}
      onClick={handleClick}
    >
      #{name}
    </NodeViewWrapper>
  )
}

export const Tag = Node.create({
  name: 'tag',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      name: { default: '' },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-type="tag"]',
        getAttrs: (el) => ({
          name: (el as HTMLElement).getAttribute('data-name') ?? '',
        }),
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'tag' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(TagView)
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: Record<string, unknown>, node: { attrs: TagAttrs }) {
          ;(state as { write: (s: string) => void }).write(`#${node.attrs.name}`)
        },
        parse: {
          setup(markdownit: {
            core: { ruler: { push: (name: string, fn: (state: unknown) => void) => void } }
          }) {
            markdownit.core.ruler.push('tag', (state: unknown) => {
              const st = state as {
                tokens: Array<{
                  type: string
                  children: Array<{ type: string; content: string }> | null
                }>
              }
              for (const token of st.tokens) {
                if (token.type !== 'inline' || !token.children) continue
                const newChildren: typeof token.children = []
                for (const child of token.children) {
                  if (child.type !== 'text') {
                    newChildren.push(child)
                    continue
                  }
                  const parts = child.content.split(/(?<=^|\s)#([A-Za-z][\w-]*)/)
                  if (parts.length === 1) {
                    newChildren.push(child)
                    continue
                  }
                  for (let i = 0; i < parts.length; i++) {
                    const part = parts[i] ?? ''
                    if (i % 2 === 0) {
                      if (part) newChildren.push({ type: 'text', content: part })
                    } else {
                      newChildren.push({
                        type: 'html_inline',
                        content: `<span data-type="tag" data-name="${encodeAttr(part)}"></span>`,
                      })
                    }
                  }
                }
                token.children = newChildren
              }
            })
          },
        },
      },
    }
  },
})

function encodeAttr(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
```

This mirrors `WikiLink.tsx`'s structure exactly — same split-based markdown-it token rewriting, same node-view pattern — swapping only the trigger pattern (`#word` instead of `[[title]]`) and the attribute name. Like `WikiLink`, this has no live input rule: typing `#tag` renders as plain text until the note is saved and reloaded (or reopened), matching `WikiLink`'s existing behavior exactly rather than introducing a new, inconsistent live-conversion UX.

- [ ] **Step 2: Register `Tag` in `src/editor/extensions/index.ts`**

Add the import:

```ts
import { Tag } from './Tag'
```

Add `Tag` to the `coreExtensions` array, alongside `WikiLink`:

```ts
  Callout,
  WikiLink,
  Tag,
  NoteContext,
  SlashCommands,
]
```

- [ ] **Step 3: Add tag pill CSS to `src/index.css`**

Append:

```css
/* Inline #tag pill */
.tag-pill {
  color: #4a9eff;
  cursor: pointer;
  background: rgba(74, 158, 255, 0.12);
  border-radius: 3px;
  padding: 0 4px;
}

.tag-pill:hover { background: rgba(74, 158, 255, 0.22); }
.tag-pill.active { background: rgba(74, 158, 255, 0.35); }
```

- [ ] **Step 4: Typecheck and build**

```bash
npm run typecheck
npm run build
```

Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add src/editor/extensions/Tag.tsx src/editor/extensions/index.ts src/index.css
git commit -m "feat: Tag TipTap extension for inline #hashtags

Structurally mirrors WikiLink: markdown-it token rewriting via the
same split-based approach, no live input rule (renders as plain text
until save/reload, matching WikiLink's existing behavior)."
```

---

### Task 9: `TagList.tsx` sidebar tag browser and tag-filter mode

**Files:**
- Create: `src/components/TagList.tsx`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/components/TreeNode.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: `tags` (Task 6 store), `tagFilter`/`setTagFilter` (Task 6), `api.notes.notesWithTag` (Task 5)
- Produces: `<TagList />` (no props — reads everything from the store)

- [ ] **Step 1: Write `src/components/TagList.tsx`**

```tsx
import { useNotesStore } from '../store/notes'
import { useWorkspaceStore } from '../store/workspace'

export function TagList() {
  const tags = useNotesStore((s) => s.tags)
  const tagFilter = useWorkspaceStore((s) => s.tagFilter)
  const setTagFilter = useWorkspaceStore((s) => s.setTagFilter)

  if (tags.length === 0) return null

  return (
    <ul className="tag-list">
      {tags.map((tag) => {
        const isActive = tagFilter?.toLowerCase() === tag.toLowerCase()
        return (
          <li key={tag}>
            <button
              className={`tag-item${isActive ? ' active' : ''}`}
              onClick={() => setTagFilter(isActive ? null : tag)}
            >
              #{tag}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
```

- [ ] **Step 2: Replace `src/components/Sidebar.tsx` in full**

```tsx
import { useEffect, useState } from 'react'
import { useNotesStore } from '../store/notes'
import { useWorkspaceStore } from '../store/workspace'
import { useWorkspace, refreshTree } from '../hooks/useWorkspace'
import { ImportButton } from './ImportButton'
import { FolderTree } from './FolderTree'
import { FolderContextMenu } from './FolderContextMenu'
import { TagList } from './TagList'
import { buildFolderTree } from '../lib/folderTree'
import { api } from '../lib/tauri'
import type { NoteMetadata } from '../types'

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
  const tagFilter = useWorkspaceStore((s) => s.tagFilter)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const folderError = useWorkspaceStore((s) => s.folderError)
  const setFolderError = useWorkspaceStore((s) => s.setFolderError)
  const { openWorkspace } = useWorkspace()
  const [search, setSearch] = useState('')
  const [tagFilteredNotes, setTagFilteredNotes] = useState<NoteMetadata[]>([])

  useEffect(() => {
    if (!tagFilter || !workspacePath) {
      setTagFilteredNotes([])
      return
    }
    api.notes.notesWithTag(workspacePath, tagFilter).then(setTagFilteredNotes)
  }, [tagFilter, workspacePath])

  const visibleNotes = search.trim()
    ? notes.filter((n) => n.title.toLowerCase().includes(search.toLowerCase()))
    : notes

  const tree = workspacePath ? buildFolderTree(workspacePath, folders, visibleNotes) : []

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
      <TagList />
      {tagFilter ? (
        <ul className="folder-tree">
          {tagFilteredNotes.map((note) => (
            <li
              key={note.path}
              className="tree-row tree-note"
              onClick={() => openTab(note.path)}
            >
              <span className="tree-label">{note.title}</span>
            </li>
          ))}
        </ul>
      ) : (
        <FolderTree entries={tree} />
      )}
      <FolderContextMenu />
    </aside>
  )
}
```

- [ ] **Step 3: Clear the tag filter when a folder is clicked, in `src/components/TreeNode.tsx`**

Add the store selector near the top:

```tsx
const setTagFilter = useWorkspaceStore((s) => s.setTagFilter)
```

Update the folder row's `onClick`:

```tsx
onClick={() => {
  toggleFolder(entry.path)
  setSelectedFolder(entry.path)
  setTagFilter(null)
}}
```

- [ ] **Step 4: Add tag-list CSS to `src/index.css`**

Append:

```css
/* Sidebar tag list */
.tag-list {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
}

.tag-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 4px 8px;
  background: none;
  border: none;
  border-radius: 4px;
  color: #ccc;
  cursor: pointer;
  font-size: 13px;
}

.tag-item:hover { background: #1e1e1e; }
.tag-item.active { background: #1a2a3a; color: #82aaff; }
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

Tag a note (`#coursework`), save, switch to a different note and back, confirm `#coursework` appears in the sidebar Tags section, click it, confirm the sidebar switches to the flat filtered list, click a folder, confirm the filter clears and the tree view returns.

- [ ] **Step 7: Commit**

```bash
git add src/components/TagList.tsx src/components/Sidebar.tsx src/components/TreeNode.tsx src/index.css
git commit -m "feat: sidebar tag browser and tag-filter mode

Clicking a tag switches the sidebar from the folder tree to a flat
list of notes carrying that tag; clicking a folder (or re-clicking
the active tag) restores the tree view. The two are modes over the
same sidebar, not separate always-visible panels."
```

---

### Task 10: `BacklinksPanel.tsx`

**Files:**
- Create: `src/components/BacklinksPanel.tsx`
- Modify: `src/components/Layout.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: `api.notes.backlinksFor` (Task 5)
- Produces: `<BacklinksPanel notePath={string} noteTitle={string} />`

- [ ] **Step 1: Write `src/components/BacklinksPanel.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useWorkspaceStore } from '../store/workspace'
import { api } from '../lib/tauri'
import type { NoteMetadata } from '../types'

interface BacklinksPanelProps {
  notePath: string
  noteTitle: string
}

export function BacklinksPanel({ notePath, noteTitle }: BacklinksPanelProps) {
  const workspacePath = useWorkspaceStore((s) => s.path)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const [backlinks, setBacklinks] = useState<NoteMetadata[]>([])
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    if (!workspacePath) return
    api.notes.backlinksFor(workspacePath, noteTitle).then(setBacklinks)
    // notePath is included so switching between two notes that happen to
    // share a title still triggers a fresh fetch.
  }, [workspacePath, notePath, noteTitle])

  return (
    <div className="backlinks-panel">
      <button className="backlinks-toggle" onClick={() => setCollapsed((c) => !c)}>
        {collapsed ? '▸' : '▾'} Linked from ({backlinks.length})
      </button>
      {!collapsed && (
        backlinks.length === 0 ? (
          <p className="backlinks-empty">No notes link here yet.</p>
        ) : (
          <ul className="backlinks-list">
            {backlinks.map((note) => (
              <li key={note.path}>
                <button className="backlink-item" onClick={() => openTab(note.path)}>
                  {note.title}
                </button>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  )
}
```

- [ ] **Step 2: Render `BacklinksPanel` below the editor in `src/components/Layout.tsx`**

Add the imports:

```tsx
import { BacklinksPanel } from './BacklinksPanel'
import { useNotesStore } from '../store/notes'
```

Add the current-note lookup inside `Layout`:

```tsx
const notes = useNotesStore((s) => s.notes)
const currentNote = notes.find((n) => n.path === activeTab)
```

Add `<BacklinksPanel />` after the editor's conditional blocks, still inside `.editor-pane`:

```tsx
          <div className="editor-pane">
            {isLoading && <p className="status">Loading…</p>}
            {!isLoading && activeTab && viewMode === 'wysiwyg' && (
              <NoteEditor content={content} notePath={activeTab} onChange={(md) => void save(md)} />
            )}
            {!isLoading && activeTab && viewMode === 'raw' && (
              <RawEditor content={content} onChange={(md) => void save(md)} />
            )}
            {!activeTab && (
              <p className="empty-state">Open a workspace and select a note</p>
            )}
            {!isLoading && activeTab && currentNote && (
              <BacklinksPanel notePath={activeTab} noteTitle={currentNote.title} />
            )}
          </div>
```

- [ ] **Step 3: Add backlinks panel CSS to `src/index.css`**

Append:

```css
/* Backlinks panel */
.backlinks-panel {
  margin-top: 24px;
  padding-top: 12px;
  border-top: 1px solid #2a2a2a;
}

.backlinks-toggle {
  background: none;
  border: none;
  color: #777;
  font-size: 12px;
  cursor: pointer;
  padding: 4px 0;
}

.backlinks-toggle:hover { color: #aaa; }
.backlinks-empty { color: #555; font-size: 12px; margin: 6px 0 0; }
.backlinks-list { list-style: none; margin: 6px 0 0; padding: 0; }

.backlink-item {
  display: block;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  color: #82aaff;
  cursor: pointer;
  padding: 3px 0;
  font-size: 13px;
}

.backlink-item:hover { text-decoration: underline; }
```

- [ ] **Step 4: Typecheck and build**

```bash
npm run typecheck
npm run build
```

Expected: both pass.

- [ ] **Step 5: Manual verification**

```bash
npm run tauri dev
```

Add `[[Note B]]` inside Note A and save. Open Note B, confirm "Linked from (1)" shows Note A. Click it, confirm it opens Note A. Collapse the panel, confirm it stays collapsed while you scroll.

- [ ] **Step 6: Commit**

```bash
git add src/components/BacklinksPanel.tsx src/components/Layout.tsx src/index.css
git commit -m "feat: backlinks panel below the editor

Refetches whenever the active note changes (by path, not just
title, so two notes sharing a title still refresh correctly).
Always renders when a note is open, with an explicit empty state,
so the feature stays discoverable even with zero backlinks."
```

---

### Task 11: Final verification

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

- [ ] Type `#coursework` in a note, save, reopen the note, confirm it renders as a styled pill (not plain text)
- [ ] Click the tag pill inside the editor, confirm the sidebar switches to the filtered list
- [ ] Confirm `#include`/`#define` inside a fenced C code block do NOT appear in the sidebar Tags section
- [ ] Confirm a `# Heading` is never mistaken for a tag
- [ ] Add `[[Target Note]]` in one note, open the target note, confirm "Linked from" shows the linking note
- [ ] Rename a folder containing a tagged and linked note; confirm the tag still filters to it and its backlinks still resolve correctly afterward
- [ ] Delete a tagged note; confirm its tag disappears from the sidebar Tags section if it was the only note with that tag

- [ ] **Step 6: Report completion**

No commit for this task — it's verification only. If any check fails, fix it in a follow-up commit before considering the feature done.

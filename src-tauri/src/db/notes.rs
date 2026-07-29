use anyhow::Result;
use sqlx::SqlitePool;
use crate::models::{NoteMetadata, SearchResult};

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

pub async fn index_note_content(pool: &SqlitePool, path: &str, title: &str, body: &str) -> Result<()> {
    sqlx::query("DELETE FROM notes_fts WHERE path = ?")
        .bind(path)
        .execute(pool)
        .await?;
    sqlx::query("INSERT INTO notes_fts (path, title, body) VALUES (?, ?, ?)")
        .bind(path)
        .bind(title)
        .bind(body)
        .execute(pool)
        .await?;
    Ok(())
}

// Windows paths already contain literal backslashes, which collide with the
// '\' ESCAPE character used below. Escape existing backslashes first so they
// match literally, then escape SQL's own wildcard characters.
fn escape_like(input: &str) -> String {
    input
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

pub async fn rename_path_prefix(pool: &SqlitePool, old_prefix: &str, new_prefix: &str) -> Result<()> {
    let like_pattern = format!("{}%", escape_like(old_prefix));
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

pub async fn remove_from_fts(pool: &SqlitePool, path: &str) -> Result<()> {
    sqlx::query("DELETE FROM notes_fts WHERE path = ?")
        .bind(path)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn search_notes(pool: &SqlitePool, fts_query: &str) -> Result<Vec<SearchResult>> {
    let rows = sqlx::query_as::<_, SearchResult>(
        "SELECT path, title,
                snippet(notes_fts, 2, '[[', ']]', '\u{2026}', 20) as snippet
         FROM notes_fts
         WHERE notes_fts MATCH ?
         ORDER BY rank
         LIMIT 20",
    )
    .bind(fts_query)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

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

// Every link/tag in the workspace at once, for the connections graph — link
// resolution (title -> path, which may be ambiguous or unresolved) and tag
// grouping happen on the frontend, which already holds the full notes list.
pub async fn all_links(pool: &SqlitePool, workspace: &str) -> Result<Vec<(String, String)>> {
    sqlx::query_as(
        "SELECT nl.source_path, nl.target_title
         FROM note_links nl
         JOIN notes n ON n.path = nl.source_path
         WHERE n.workspace = ?",
    )
    .bind(workspace)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

pub async fn all_note_tags(pool: &SqlitePool, workspace: &str) -> Result<Vec<(String, String)>> {
    sqlx::query_as(
        "SELECT nt.note_path, nt.tag
         FROM note_tags nt
         JOIN notes n ON n.path = nt.note_path
         WHERE n.workspace = ?",
    )
    .bind(workspace)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
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
        let updated = NoteMetadata {
            id: "a".into(),
            title: "New Title".into(),
            path: "/ws/a.md".into(),
            workspace: "/ws".into(),
            updated_at: 2000,
        };
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

    #[tokio::test]
    async fn test_all_links_returns_every_link_in_the_workspace() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "A", "/ws/a.md", "/ws")).await.unwrap();
        index_note(&pool, &note("b", "B", "/ws/b.md", "/ws")).await.unwrap();
        set_links(&pool, "/ws/a.md", &["B".to_string(), "Missing".to_string()]).await.unwrap();
        set_links(&pool, "/ws/b.md", &["A".to_string()]).await.unwrap();

        let mut links = all_links(&pool, "/ws").await.unwrap();
        links.sort();

        assert_eq!(
            links,
            vec![
                ("/ws/a.md".to_string(), "B".to_string()),
                ("/ws/a.md".to_string(), "Missing".to_string()),
                ("/ws/b.md".to_string(), "A".to_string()),
            ]
        );
    }

    #[tokio::test]
    async fn test_all_links_excludes_other_workspaces() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "A", "/ws/a.md", "/ws")).await.unwrap();
        index_note(&pool, &note("c", "C", "/other/c.md", "/other")).await.unwrap();
        set_links(&pool, "/ws/a.md", &["X".to_string()]).await.unwrap();
        set_links(&pool, "/other/c.md", &["Y".to_string()]).await.unwrap();

        let links = all_links(&pool, "/ws").await.unwrap();

        assert_eq!(links, vec![("/ws/a.md".to_string(), "X".to_string())]);
    }

    #[tokio::test]
    async fn test_all_note_tags_returns_every_tag_in_the_workspace() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "A", "/ws/a.md", "/ws")).await.unwrap();
        index_note(&pool, &note("b", "B", "/ws/b.md", "/ws")).await.unwrap();
        set_tags(&pool, "/ws/a.md", &["cs101".to_string(), "exam".to_string()]).await.unwrap();
        set_tags(&pool, "/ws/b.md", &["cs101".to_string()]).await.unwrap();

        let mut tags = all_note_tags(&pool, "/ws").await.unwrap();
        tags.sort();

        assert_eq!(
            tags,
            vec![
                ("/ws/a.md".to_string(), "cs101".to_string()),
                ("/ws/a.md".to_string(), "exam".to_string()),
                ("/ws/b.md".to_string(), "cs101".to_string()),
            ]
        );
    }
}

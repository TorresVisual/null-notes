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
}

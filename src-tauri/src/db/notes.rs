use anyhow::Result;
use sqlx::SqlitePool;
use crate::models::NoteMetadata;

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
}

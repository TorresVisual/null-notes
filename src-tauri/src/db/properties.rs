use crate::properties::Properties;
use anyhow::Result;
use sqlx::SqlitePool;

pub async fn set_properties(
    pool: &SqlitePool,
    note_path: &str,
    props: &Properties,
    error: Option<&str>,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO note_properties (note_path, json, error) VALUES (?, ?, ?)
         ON CONFLICT(note_path) DO UPDATE SET json = excluded.json, error = excluded.error",
    )
    .bind(note_path)
    .bind(serde_json::to_string(props)?)
    .bind(error)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn remove_properties(pool: &SqlitePool, note_path: &str) -> Result<()> {
    sqlx::query("DELETE FROM note_properties WHERE note_path = ?")
        .bind(note_path)
        .execute(pool)
        .await?;
    Ok(())
}

/// One row per indexed note in the workspace: (path, properties JSON, parse error).
/// A note without a stored row reads as empty properties.
pub async fn all_properties(
    pool: &SqlitePool,
    workspace: &str,
) -> Result<Vec<(String, String, Option<String>)>> {
    sqlx::query_as(
        "SELECT n.path, COALESCE(p.json, '{}'), p.error
         FROM notes n
         LEFT JOIN note_properties p ON p.note_path = n.path
         WHERE n.workspace = ?",
    )
    .bind(workspace)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::notes::{index_note, remove_notes_under, update_path};
    use crate::db::schema::run_migrations;
    use crate::models::NoteMetadata;
    use crate::properties::Properties;
    use serde_json::json;

    async fn make_pool() -> SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        run_migrations(&pool).await.unwrap();
        pool
    }

    fn note(path: &str, workspace: &str) -> NoteMetadata {
        NoteMetadata {
            id: path.into(),
            title: path.into(),
            path: path.into(),
            workspace: workspace.into(),
            updated_at: 0,
        }
    }

    fn props(value: serde_json::Value) -> Properties {
        value.as_object().cloned().unwrap()
    }

    #[tokio::test]
    async fn set_properties_upserts_and_all_properties_joins_workspace() {
        let pool = make_pool().await;
        index_note(&pool, &note("/ws/a.md", "/ws")).await.unwrap();
        index_note(&pool, &note("/ws/b.md", "/ws")).await.unwrap();
        index_note(&pool, &note("/other/c.md", "/other"))
            .await
            .unwrap();
        set_properties(&pool, "/ws/a.md", &props(json!({"s": 1})), None)
            .await
            .unwrap();
        set_properties(&pool, "/ws/a.md", &props(json!({"s": 2})), None)
            .await
            .unwrap();
        set_properties(&pool, "/other/c.md", &props(json!({"s": 9})), None)
            .await
            .unwrap();

        let mut rows = all_properties(&pool, "/ws").await.unwrap();
        rows.sort();
        assert_eq!(
            rows,
            vec![
                ("/ws/a.md".to_string(), r#"{"s":2}"#.to_string(), None),
                ("/ws/b.md".to_string(), "{}".to_string(), None),
            ]
        );
    }

    #[tokio::test]
    async fn properties_row_follows_rename_move_and_delete() {
        let pool = make_pool().await;
        for p in ["/ws/a.md", "/ws/dir/b.md"] {
            index_note(&pool, &note(p, "/ws")).await.unwrap();
            set_properties(&pool, p, &props(json!({"k": p})), Some("bad"))
                .await
                .unwrap();
        }

        update_path(&pool, "/ws/a.md", "/ws/z.md").await.unwrap();
        let rows = all_properties(&pool, "/ws").await.unwrap();
        let z = rows.iter().find(|r| r.0 == "/ws/z.md").unwrap();
        assert_eq!(z.1, r#"{"k":"/ws/a.md"}"#);
        assert_eq!(z.2.as_deref(), Some("bad"));

        remove_notes_under(&pool, "/ws/dir/").await.unwrap();
        remove_properties(&pool, "/ws/z.md").await.unwrap();
        let left: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM note_properties")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(left.0, 0);
    }
}

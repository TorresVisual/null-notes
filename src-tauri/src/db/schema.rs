use anyhow::Result;
use sqlx::SqlitePool;

pub async fn run_migrations(pool: &SqlitePool) -> Result<()> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS notes (
            id        TEXT    PRIMARY KEY,
            title     TEXT    NOT NULL,
            path      TEXT    NOT NULL UNIQUE,
            workspace TEXT    NOT NULL,
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

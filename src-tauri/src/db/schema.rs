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

    sqlx::query("CREATE INDEX IF NOT EXISTS notes_workspace ON notes(workspace)")
        .execute(pool)
        .await?;

    sqlx::query(
        "CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
            path UNINDEXED,
            title,
            body,
            tokenize = 'unicode61'
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS note_tags (
            note_path TEXT NOT NULL,
            tag       TEXT NOT NULL
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS note_tags_tag ON note_tags(tag)")
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

    sqlx::query("CREATE INDEX IF NOT EXISTS note_links_target ON note_links(target_title)")
        .execute(pool)
        .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS note_tasks (
            note_path TEXT    NOT NULL,
            text      TEXT    NOT NULL,
            done      INTEGER NOT NULL,
            position  INTEGER NOT NULL
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS note_tasks_path ON note_tasks(note_path)")
        .execute(pool)
        .await?;

    Ok(())
}

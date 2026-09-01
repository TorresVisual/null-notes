use anyhow::Result;
use sqlx::SqlitePool;

// SQLite has no `ADD COLUMN IF NOT EXISTS` — this is the standard sqlx
// workaround. Any error other than the column already existing still
// propagates; only that one specific case is treated as success so a
// re-run against an already-migrated `index.db` stays a no-op.
async fn add_column_if_missing(pool: &SqlitePool, sql: &str) -> Result<()> {
    match sqlx::query(sql).execute(pool).await {
        Ok(_) => Ok(()),
        Err(e) if e.to_string().contains("duplicate column name") => Ok(()),
        Err(e) => Err(e.into()),
    }
}

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

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS review_cards (
            note_path TEXT    NOT NULL,
            kind      TEXT    NOT NULL,
            front     TEXT    NOT NULL,
            back      TEXT    NOT NULL,
            position  INTEGER NOT NULL,
            due       TEXT    NOT NULL,
            ease      REAL    NOT NULL,
            interval  INTEGER NOT NULL,
            reps      INTEGER NOT NULL
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS review_cards_due ON review_cards(due)")
        .execute(pool)
        .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS review_cards_path ON review_cards(note_path)")
        .execute(pool)
        .await?;

    // First column addition this table has ever had. `options` is a JSON
    // array of MC option strings, NULL for qa/cloze. `grade` is the last
    // grade given (again/hard/good/easy), NULL if never graded — the MC
    // auto-grade ladder needs to know the previous rung, and this is also
    // written by qa/cloze grading now so the comment format stays uniform.
    add_column_if_missing(pool, "ALTER TABLE review_cards ADD COLUMN options TEXT").await?;
    add_column_if_missing(pool, "ALTER TABLE review_cards ADD COLUMN grade TEXT").await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_run_migrations_adds_options_and_grade_columns() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        run_migrations(&pool).await.unwrap();

        // A row insert naming both new columns is the simplest proof they
        // exist and accept NULL — sqlx has no schema-introspection helper
        // exposed here, and this exercises exactly what set_cards will do.
        sqlx::query(
            "INSERT INTO review_cards (note_path, kind, front, back, position, due, ease, interval, reps, options, grade)
             VALUES ('/a.md', 'mc', 'Q', '', 0, '2026-01-01', 2.5, 0, 0, NULL, NULL)",
        )
        .execute(&pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn test_run_migrations_is_idempotent_against_an_already_migrated_db() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        run_migrations(&pool).await.unwrap();
        // Re-running against an already-migrated DB must not error on the
        // "duplicate column name" the second ALTER TABLE always produces.
        run_migrations(&pool).await.unwrap();
    }
}

use anyhow::Result;
use sqlx::SqlitePool;
use std::path::Path;

pub mod fts_query;
pub mod notes;
pub mod properties;
pub mod schema;

pub type DbPool = SqlitePool;

async fn open_checked(db_path: &Path) -> Result<DbPool> {
    let url = format!("sqlite://{}?mode=rwc", db_path.display());
    let pool = SqlitePool::connect(&url).await?;
    let checked = async {
        let verdict: String = sqlx::query_scalar("PRAGMA quick_check")
            .fetch_one(&pool)
            .await?;
        anyhow::ensure!(verdict == "ok", "quick_check: {verdict}");
        schema::run_migrations(&pool).await
    }
    .await;
    match checked {
        Ok(()) => Ok(pool),
        Err(e) => {
            pool.close().await;
            Err(e)
        }
    }
}

/// `index.db` is rebuildable from the notes, so an unusable one is set aside
/// as `index.db.corrupt-<ts>` and replaced rather than stopping startup;
/// reindex-on-open repopulates it.
pub async fn init_db(app_data_dir: &Path) -> Result<DbPool> {
    std::fs::create_dir_all(app_data_dir)?;
    let db_path = app_data_dir.join("index.db");
    let err = match open_checked(&db_path).await {
        Ok(pool) => return Ok(pool),
        Err(e) => e,
    };
    let stamp = chrono::Utc::now().format("%Y%m%dT%H%M%S");
    let quarantined = app_data_dir.join(format!("index.db.corrupt-{stamp}"));
    if std::fs::rename(&db_path, &quarantined).is_err() {
        return Err(err.context("index.db unusable and could not be set aside"));
    }
    for suffix in ["-wal", "-shm"] {
        let _ = std::fs::remove_file(app_data_dir.join(format!("index.db{suffix}")));
    }
    crate::commands::error_log::append_entry_sync(
        app_data_dir,
        "db",
        &format!("index.db unusable, rebuilt from scratch: {err:#}"),
        Some(&quarantined.display().to_string()),
    );
    open_checked(&db_path).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn init_db_replaces_a_garbage_index_db() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("index.db"), vec![0xAB; 4096]).unwrap();

        let pool = init_db(dir.path()).await.unwrap();
        sqlx::query("SELECT COUNT(*) FROM notes")
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;

        let quarantined = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .any(|e| {
                e.file_name()
                    .to_string_lossy()
                    .starts_with("index.db.corrupt-")
            });
        assert!(quarantined);
        assert!(dir.path().join("errors.log").exists());
    }
}

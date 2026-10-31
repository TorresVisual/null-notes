use anyhow::Result;
use sqlx::SqlitePool;
use std::path::Path;

pub mod fts_query;
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

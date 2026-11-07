use crate::models::ErrorEntry;
use std::path::Path;
use tauri::{AppHandle, Manager};
use tokio::io::AsyncWriteExt;

const ERROR_LOG_FILE: &str = "errors.log";
const ROTATED_LOG_FILE: &str = "errors.log.1";
const MAX_LOG_BYTES: u64 = 1024 * 1024;

fn rotate_if_oversized(dir: &Path) {
    let log = dir.join(ERROR_LOG_FILE);
    if std::fs::metadata(&log).is_ok_and(|m| m.len() >= MAX_LOG_BYTES) {
        let _ = std::fs::rename(&log, dir.join(ROTATED_LOG_FILE));
    }
}

async fn append_entry_to_dir(dir: &Path, entry: &ErrorEntry) -> anyhow::Result<()> {
    tokio::fs::create_dir_all(dir).await?;
    rotate_if_oversized(dir);
    let mut line = serde_json::to_string(entry)?;
    line.push('\n');
    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join(ERROR_LOG_FILE))
        .await?;
    file.write_all(line.as_bytes()).await?;
    Ok(())
}

async fn read_entries_from_dir(dir: &Path, limit: usize) -> anyhow::Result<Vec<ErrorEntry>> {
    let file = dir.join(ERROR_LOG_FILE);
    if !file.exists() {
        return Ok(Vec::new());
    }
    let content = tokio::fs::read_to_string(&file).await?;
    let mut entries: Vec<ErrorEntry> = content
        .lines()
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect();
    entries.reverse();
    entries.truncate(limit);
    Ok(entries)
}

async fn clear_entries_in_dir(dir: &Path) -> anyhow::Result<()> {
    let file = dir.join(ERROR_LOG_FILE);
    if file.exists() {
        tokio::fs::write(&file, "").await?;
    }
    Ok(())
}

/// Synchronous, best-effort variant for the panic hook: a hook has no
/// `AppHandle` to ask for the app-data dir, no guarantee the tokio runtime
/// is still reachable, and must never itself panic.
pub fn append_entry_sync(dir: &Path, source: &str, message: &str, context: Option<&str>) {
    let entry = ErrorEntry {
        timestamp: chrono::Utc::now().to_rfc3339(),
        source: source.to_string(),
        message: message.to_string(),
        context: context.map(|c| c.to_string()),
    };
    let Ok(mut line) = serde_json::to_string(&entry) else {
        return;
    };
    line.push('\n');
    let _ = std::fs::create_dir_all(dir);
    rotate_if_oversized(dir);
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join(ERROR_LOG_FILE))
    {
        use std::io::Write;
        let _ = file.write_all(line.as_bytes());
    }
}

#[tauri::command]
pub async fn record_error(
    app: AppHandle,
    source: String,
    message: String,
    context: Option<String>,
) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let entry = ErrorEntry {
        timestamp: chrono::Utc::now().to_rfc3339(),
        source,
        message,
        context,
    };
    append_entry_to_dir(&dir, &entry)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_errors(app: AppHandle) -> Result<Vec<ErrorEntry>, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    read_entries_from_dir(&dir, 200)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_errors(app: AppHandle) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    clear_entries_in_dir(&dir).await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn sample_entry(source: &str) -> ErrorEntry {
        ErrorEntry {
            timestamp: "2026-09-05T00:00:00Z".to_string(),
            source: source.to_string(),
            message: "boom".to_string(),
            context: None,
        }
    }

    #[tokio::test]
    async fn test_append_and_read_roundtrip() {
        let dir = tempdir().unwrap();
        append_entry_to_dir(dir.path(), &sample_entry("console-error"))
            .await
            .unwrap();

        let entries = read_entries_from_dir(dir.path(), 200).await.unwrap();

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].source, "console-error");
        assert_eq!(entries[0].message, "boom");
    }

    #[tokio::test]
    async fn test_read_missing_file_returns_empty() {
        let dir = tempdir().unwrap();
        let entries = read_entries_from_dir(dir.path(), 200).await.unwrap();
        assert!(entries.is_empty());
    }

    #[tokio::test]
    async fn test_read_caps_at_limit_and_returns_newest_first() {
        let dir = tempdir().unwrap();
        for i in 0..5 {
            append_entry_to_dir(dir.path(), &sample_entry(&format!("source-{i}")))
                .await
                .unwrap();
        }

        let entries = read_entries_from_dir(dir.path(), 3).await.unwrap();

        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].source, "source-4");
        assert_eq!(entries[1].source, "source-3");
        assert_eq!(entries[2].source, "source-2");
    }

    #[tokio::test]
    async fn test_clear_empties_the_log() {
        let dir = tempdir().unwrap();
        append_entry_to_dir(dir.path(), &sample_entry("console-error"))
            .await
            .unwrap();

        clear_entries_in_dir(dir.path()).await.unwrap();

        let entries = read_entries_from_dir(dir.path(), 200).await.unwrap();
        assert!(entries.is_empty());
    }

    #[test]
    fn test_append_entry_sync_writes_a_readable_line() {
        let dir = tempdir().unwrap();
        append_entry_sync(dir.path(), "panic", "index out of bounds", None);

        let content = std::fs::read_to_string(dir.path().join(ERROR_LOG_FILE)).unwrap();
        assert!(content.contains("index out of bounds"));
        assert!(content.contains("\"source\":\"panic\""));
    }

    #[test]
    fn test_oversized_log_rotates_instead_of_growing() {
        let dir = tempdir().unwrap();
        let big = "x".repeat(MAX_LOG_BYTES as usize);
        std::fs::write(dir.path().join(ERROR_LOG_FILE), big).unwrap();

        append_entry_sync(dir.path(), "panic", "fresh", None);

        let rotated = std::fs::metadata(dir.path().join(ROTATED_LOG_FILE)).unwrap();
        assert_eq!(rotated.len(), MAX_LOG_BYTES);
        let current = std::fs::read_to_string(dir.path().join(ERROR_LOG_FILE)).unwrap();
        assert!(current.contains("fresh") && current.lines().count() == 1);
    }
}

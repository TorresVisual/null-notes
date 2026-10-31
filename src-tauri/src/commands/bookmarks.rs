use std::path::{Path, PathBuf};

use super::notes::write_atomic;

pub const BOOKMARKS_FILE: &str = ".bookmarks";

fn bookmarks_path(workspace: &str) -> PathBuf {
    Path::new(workspace).join(BOOKMARKS_FILE)
}

async fn read_bookmarks_at(workspace: &str) -> anyhow::Result<String> {
    match tokio::fs::read_to_string(bookmarks_path(workspace)).await {
        Ok(text) => Ok(text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(e.into()),
    }
}

#[tauri::command]
pub async fn read_bookmarks(workspace: String) -> Result<String, String> {
    read_bookmarks_at(&workspace)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn write_bookmarks(workspace: String, content: String) -> Result<(), String> {
    write_atomic(&bookmarks_path(&workspace), &content)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn missing_file_reads_as_empty_and_a_write_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let ws = dir.path().to_string_lossy().into_owned();

        assert_eq!(read_bookmarks_at(&ws).await.unwrap(), "");

        write_bookmarks(ws.clone(), "{\"kind\":\"note\"}\n".into())
            .await
            .unwrap();
        assert_eq!(
            read_bookmarks_at(&ws).await.unwrap(),
            "{\"kind\":\"note\"}\n"
        );
    }
}

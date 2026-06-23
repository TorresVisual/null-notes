use tauri::State;
use uuid::Uuid;
use std::time::{SystemTime, UNIX_EPOCH};
use crate::db::{self, DbPool};
use crate::models::NoteMetadata;

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

pub fn title_from_content(content: &str) -> String {
    content
        .lines()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("Untitled")
        .trim_start_matches('#')
        .trim()
        .to_string()
}

fn workspace_of(path: &str) -> String {
    std::path::Path::new(path)
        .parent()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default()
}

#[tauri::command]
pub async fn list_notes(
    workspace: String,
    db: State<'_, DbPool>,
) -> Result<Vec<NoteMetadata>, String> {
    db::notes::list_by_workspace(&db, &workspace)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn scan_workspace(
    workspace: String,
    db: State<'_, DbPool>,
) -> Result<Vec<NoteMetadata>, String> {
    let mut dir = tokio::fs::read_dir(&workspace)
        .await
        .map_err(|e| e.to_string())?;

    while let Some(entry) = dir.next_entry().await.map_err(|e| e.to_string())? {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        let path_str = path.to_string_lossy().into_owned();
        let content = tokio::fs::read_to_string(&path).await.unwrap_or_default();
        let updated_at = entry
            .metadata()
            .await
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or_else(now_ms);
        let meta = NoteMetadata {
            id: Uuid::new_v4().to_string(),
            title: title_from_content(&content),
            path: path_str,
            workspace: workspace.clone(),
            updated_at,
        };
        db::notes::index_note(&db, &meta)
            .await
            .map_err(|e| e.to_string())?;
    }

    db::notes::list_by_workspace(&db, &workspace)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn open_note(path: String) -> Result<String, String> {
    tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_note(
    path: String,
    content: String,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    tokio::fs::write(&path, &content)
        .await
        .map_err(|e| e.to_string())?;

    let meta = NoteMetadata {
        id: Uuid::new_v4().to_string(),
        title: title_from_content(&content),
        path: path.clone(),
        workspace: workspace_of(&path),
        updated_at: now_ms(),
    };
    db::notes::index_note(&db, &meta)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_note(
    workspace: String,
    title: String,
    db: State<'_, DbPool>,
) -> Result<NoteMetadata, String> {
    let safe_name: String = title
        .chars()
        .map(|c| if c.is_alphanumeric() || c == ' ' { c } else { '-' })
        .collect();
    let filename = format!("{}.md", safe_name.trim());
    let path = std::path::Path::new(&workspace).join(&filename);

    tokio::fs::write(&path, format!("# {}\n", title))
        .await
        .map_err(|e| e.to_string())?;

    let meta = NoteMetadata {
        id: Uuid::new_v4().to_string(),
        title,
        path: path.to_string_lossy().into_owned(),
        workspace,
        updated_at: now_ms(),
    };
    db::notes::index_note(&db, &meta)
        .await
        .map_err(|e| e.to_string())?;

    Ok(meta)
}

#[tauri::command]
pub async fn delete_note(
    path: String,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    tokio::fs::remove_file(&path)
        .await
        .map_err(|e| e.to_string())?;

    let ink_dir = path.trim_end_matches(".md").to_string() + ".ink";
    let _ = tokio::fs::remove_dir_all(&ink_dir).await;

    db::notes::remove_note(&db, &path)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_title_from_content_heading() {
        assert_eq!(title_from_content("# Hello World\nsome text"), "Hello World");
    }

    #[test]
    fn test_title_from_content_no_heading() {
        assert_eq!(title_from_content("just text"), "just text");
    }

    #[test]
    fn test_title_from_content_empty() {
        assert_eq!(title_from_content(""), "Untitled");
    }

    #[test]
    fn test_title_from_content_leading_blank_lines() {
        assert_eq!(title_from_content("\n\n# Deep\n"), "Deep");
    }
}

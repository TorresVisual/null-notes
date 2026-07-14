use tauri::State;
use uuid::Uuid;
use std::time::{SystemTime, UNIX_EPOCH};
use crate::db::{self, DbPool};
use crate::models::{NoteMetadata, SearchResult, WorkspaceTree};

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

#[tauri::command]
pub async fn list_notes(
    workspace: String,
    db: State<'_, DbPool>,
) -> Result<Vec<NoteMetadata>, String> {
    db::notes::list_by_workspace(&db, &workspace)
        .await
        .map_err(|e| e.to_string())
}

fn is_excluded_dir(name: &str) -> bool {
    name.ends_with(".ink") || name.starts_with('.')
}

async fn scan_dir_recursive(
    root: &std::path::Path,
    workspace: &str,
) -> anyhow::Result<(Vec<NoteMetadata>, Vec<String>)> {
    let mut notes = Vec::new();
    let mut folders = Vec::new();
    let mut stack = vec![root.to_path_buf()];

    while let Some(dir) = stack.pop() {
        let mut entries = tokio::fs::read_dir(&dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            let file_type = entry.file_type().await?;

            if file_type.is_dir() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if is_excluded_dir(&name) {
                    continue;
                }
                folders.push(path.to_string_lossy().into_owned());
                stack.push(path);
                continue;
            }

            if path.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }
            let path_str = path.to_string_lossy().into_owned();
            let title = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("Untitled")
                .to_string();
            let updated_at = entry
                .metadata()
                .await
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or_else(now_ms);
            notes.push(NoteMetadata {
                id: Uuid::new_v4().to_string(),
                title,
                path: path_str,
                workspace: workspace.to_string(),
                updated_at,
            });
        }
    }

    Ok((notes, folders))
}

#[tauri::command]
pub async fn scan_workspace(
    workspace: String,
    db: State<'_, DbPool>,
) -> Result<WorkspaceTree, String> {
    let (notes, folders) = scan_dir_recursive(std::path::Path::new(&workspace), &workspace)
        .await
        .map_err(|e| e.to_string())?;

    for meta in &notes {
        db::notes::index_note(&db, meta)
            .await
            .map_err(|e| e.to_string())?;
    }

    let indexed = db::notes::list_by_workspace(&db, &workspace)
        .await
        .map_err(|e| e.to_string())?;

    Ok(WorkspaceTree { notes: indexed, folders })
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
    workspace: String,
    content: String,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    tokio::fs::write(&path, &content)
        .await
        .map_err(|e| e.to_string())?;

    let title = title_from_content(&content);
    let meta = NoteMetadata {
        id: Uuid::new_v4().to_string(),
        title: title.clone(),
        path: path.clone(),
        workspace,
        updated_at: now_ms(),
    };
    db::notes::index_note(&db, &meta)
        .await
        .map_err(|e| e.to_string())?;
    db::notes::index_note_content(&db, &path, &title, &content)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_note(
    workspace: String,
    folder: String,
    title: String,
    db: State<'_, DbPool>,
) -> Result<NoteMetadata, String> {
    let safe_name: String = title
        .chars()
        .map(|c| if c.is_alphanumeric() || c == ' ' { c } else { '-' })
        .collect();
    let filename = format!("{}.md", safe_name.trim());
    let path = std::path::Path::new(&folder).join(&filename);

    tokio::fs::write(&path, format!("# {}\n", title))
        .await
        .map_err(|e| e.to_string())?;

    let meta = NoteMetadata {
        id: Uuid::new_v4().to_string(),
        title: title.clone(),
        path: path.to_string_lossy().into_owned(),
        workspace,
        updated_at: now_ms(),
    };
    db::notes::index_note(&db, &meta)
        .await
        .map_err(|e| e.to_string())?;

    let body = format!("# {}", title);
    db::notes::index_note_content(&db, &meta.path, &meta.title, &body)
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
        .map_err(|e| e.to_string())?;

    db::notes::remove_from_fts(&db, &path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn search_notes(
    query: String,
    db: State<'_, DbPool>,
) -> Result<Vec<SearchResult>, String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(vec![]);
    }
    let fts_query = trimmed
        .split_whitespace()
        .map(|w| format!("\"{}\"*", w.replace('"', "")))
        .collect::<Vec<_>>()
        .join(" ");
    db::notes::search_notes(&db, &fts_query)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

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

    #[tokio::test]
    async fn test_scan_dir_recursive_finds_nested_notes() {
        let tmp = tempdir().unwrap();
        let root = tmp.path();
        std::fs::create_dir_all(root.join("Course101")).unwrap();
        std::fs::write(root.join("Course101/lecture1.md"), "# Lecture 1").unwrap();
        std::fs::write(root.join("root-note.md"), "# Root").unwrap();

        let ws = root.to_string_lossy().into_owned();
        let (notes, folders) = scan_dir_recursive(root, &ws).await.unwrap();

        assert_eq!(notes.len(), 2);
        assert_eq!(folders.len(), 1);
        assert!(folders[0].ends_with("Course101"));
    }

    #[tokio::test]
    async fn test_scan_dir_recursive_excludes_ink_and_dot_dirs() {
        let tmp = tempdir().unwrap();
        let root = tmp.path();
        std::fs::create_dir_all(root.join("Note.ink")).unwrap();
        std::fs::write(root.join("Note.ink/sketch-1.svg"), "<svg></svg>").unwrap();
        std::fs::create_dir_all(root.join(".git")).unwrap();
        std::fs::write(root.join("Note.md"), "# Note").unwrap();

        let ws = root.to_string_lossy().into_owned();
        let (notes, folders) = scan_dir_recursive(root, &ws).await.unwrap();

        assert_eq!(notes.len(), 1);
        assert!(folders.is_empty());
    }

    #[tokio::test]
    async fn test_scan_dir_recursive_lists_empty_folders() {
        let tmp = tempdir().unwrap();
        let root = tmp.path();
        std::fs::create_dir_all(root.join("Empty")).unwrap();

        let ws = root.to_string_lossy().into_owned();
        let (notes, folders) = scan_dir_recursive(root, &ws).await.unwrap();

        assert!(notes.is_empty());
        assert_eq!(folders.len(), 1);
    }
}

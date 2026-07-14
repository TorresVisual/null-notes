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

async fn create_folder_at(parent: &str, name: &str) -> anyhow::Result<String> {
    let path = std::path::Path::new(parent).join(name);
    tokio::fs::create_dir(&path).await?;
    Ok(path.to_string_lossy().into_owned())
}

async fn rename_folder_at(old_path: &str, new_path: &str, db: &DbPool) -> anyhow::Result<()> {
    tokio::fs::rename(old_path, new_path).await?;
    let old_prefix = format!("{}{}", old_path, std::path::MAIN_SEPARATOR);
    let new_prefix = format!("{}{}", new_path, std::path::MAIN_SEPARATOR);
    db::notes::rename_path_prefix(db, &old_prefix, &new_prefix).await?;
    Ok(())
}

async fn delete_folder_at(path: &str, db: &DbPool) -> anyhow::Result<()> {
    tokio::fs::remove_dir_all(path).await?;
    let prefix = format!("{}{}", path, std::path::MAIN_SEPARATOR);
    db::notes::remove_notes_under(db, &prefix).await?;
    Ok(())
}

async fn move_note_at(path: &str, dest_folder: &str, db: &DbPool) -> anyhow::Result<String> {
    let file_name = std::path::Path::new(path)
        .file_name()
        .ok_or_else(|| anyhow::anyhow!("note path has no file name: {path}"))?
        .to_os_string();
    let new_path = std::path::Path::new(dest_folder).join(&file_name);
    tokio::fs::rename(path, &new_path).await?;

    let ink_dir = path.trim_end_matches(".md").to_string() + ".ink";
    if tokio::fs::metadata(&ink_dir).await.is_ok() {
        let new_ink_dir = new_path.to_string_lossy().trim_end_matches(".md").to_string() + ".ink";
        tokio::fs::rename(&ink_dir, &new_ink_dir).await?;
    }

    let new_path_str = new_path.to_string_lossy().into_owned();
    db::notes::update_path(db, path, &new_path_str).await?;
    Ok(new_path_str)
}

#[tauri::command]
pub async fn create_folder(parent: String, name: String) -> Result<String, String> {
    create_folder_at(&parent, &name).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rename_folder(old_path: String, new_path: String, db: State<'_, DbPool>) -> Result<(), String> {
    rename_folder_at(&old_path, &new_path, &db).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_folder(path: String, db: State<'_, DbPool>) -> Result<(), String> {
    delete_folder_at(&path, &db).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn move_note(path: String, dest_folder: String, db: State<'_, DbPool>) -> Result<String, String> {
    move_note_at(&path, &dest_folder, &db).await.map_err(|e| e.to_string())
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

#[cfg(test)]
mod folder_tests {
    use super::*;
    use tempfile::tempdir;
    use crate::db::schema::run_migrations;
    use crate::db::notes::index_note as db_index_note;

    async fn make_pool() -> DbPool {
        let pool = DbPool::connect("sqlite::memory:").await.unwrap();
        run_migrations(&pool).await.unwrap();
        pool
    }

    #[tokio::test]
    async fn test_create_folder_at_creates_directory() {
        let tmp = tempdir().unwrap();
        let parent = tmp.path().to_string_lossy().into_owned();
        let path = create_folder_at(&parent, "Course101").await.unwrap();
        assert!(std::path::Path::new(&path).is_dir());
    }

    #[tokio::test]
    async fn test_rename_folder_at_moves_dir_and_updates_notes() {
        let tmp = tempdir().unwrap();
        let root = tmp.path();
        let old_dir = root.join("Old");
        std::fs::create_dir_all(&old_dir).unwrap();
        std::fs::write(old_dir.join("note.md"), "# Note").unwrap();

        let pool = make_pool().await;
        let old_note_path = old_dir.join("note.md").to_string_lossy().into_owned();
        db_index_note(&pool, &NoteMetadata {
            id: "a".into(),
            title: "Note".into(),
            path: old_note_path,
            workspace: root.to_string_lossy().into_owned(),
            updated_at: 1000,
        }).await.unwrap();

        let new_dir = root.join("New").to_string_lossy().into_owned();
        rename_folder_at(&old_dir.to_string_lossy(), &new_dir, &pool).await.unwrap();

        assert!(std::path::Path::new(&new_dir).join("note.md").exists());
        let notes = db::notes::list_by_workspace(&pool, &root.to_string_lossy()).await.unwrap();
        let expected = std::path::Path::new(&new_dir).join("note.md").to_string_lossy().into_owned();
        assert_eq!(notes[0].path, expected);
    }

    #[tokio::test]
    async fn test_delete_folder_at_removes_dir_and_notes() {
        let tmp = tempdir().unwrap();
        let root = tmp.path();
        let dir = root.join("ToDelete");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("note.md"), "# Note").unwrap();

        let pool = make_pool().await;
        db_index_note(&pool, &NoteMetadata {
            id: "a".into(),
            title: "Note".into(),
            path: dir.join("note.md").to_string_lossy().into_owned(),
            workspace: root.to_string_lossy().into_owned(),
            updated_at: 1000,
        }).await.unwrap();

        delete_folder_at(&dir.to_string_lossy(), &pool).await.unwrap();

        assert!(!dir.exists());
        let notes = db::notes::list_by_workspace(&pool, &root.to_string_lossy()).await.unwrap();
        assert!(notes.is_empty());
    }

    #[tokio::test]
    async fn test_move_note_at_moves_file_and_ink_sidecar() {
        let tmp = tempdir().unwrap();
        let root = tmp.path();
        let src_dir = root.join("Src");
        let dest_dir = root.join("Dest");
        std::fs::create_dir_all(&src_dir).unwrap();
        std::fs::create_dir_all(&dest_dir).unwrap();
        std::fs::write(src_dir.join("note.md"), "# Note").unwrap();
        std::fs::create_dir_all(src_dir.join("note.ink")).unwrap();
        std::fs::write(src_dir.join("note.ink").join("sketch-1.svg"), "<svg></svg>").unwrap();

        let pool = make_pool().await;
        let old_path = src_dir.join("note.md").to_string_lossy().into_owned();
        db_index_note(&pool, &NoteMetadata {
            id: "a".into(),
            title: "Note".into(),
            path: old_path.clone(),
            workspace: root.to_string_lossy().into_owned(),
            updated_at: 1000,
        }).await.unwrap();

        let new_path = move_note_at(&old_path, &dest_dir.to_string_lossy(), &pool).await.unwrap();

        assert!(std::path::Path::new(&new_path).exists());
        assert!(dest_dir.join("note.ink").join("sketch-1.svg").exists());
        assert!(!src_dir.join("note.md").exists());
        let notes = db::notes::list_by_workspace(&pool, &root.to_string_lossy()).await.unwrap();
        assert_eq!(notes[0].path, new_path);
    }
}

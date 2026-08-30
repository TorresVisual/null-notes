use super::sidecar_dir_for;

fn diagrams_dir_for(note_path: &str) -> String {
    sidecar_dir_for(note_path, "diagrams")
}

#[tauri::command]
pub async fn ensure_diagrams_dir(note_path: String) -> Result<String, String> {
    let dir = diagrams_dir_for(&note_path);
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| e.to_string())?;
    Ok(dir)
}

#[tauri::command]
pub async fn read_diagram(path: String) -> Result<String, String> {
    tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn write_diagram(path: String, content: String) -> Result<(), String> {
    tokio::fs::write(&path, content)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_diagrams_dir_for() {
        let dir = diagrams_dir_for("/ws/Lecture 7.md");
        assert!(dir.ends_with("Lecture 7.diagrams"));
    }

    #[tokio::test]
    async fn test_ensure_diagrams_dir_creates_directory() {
        let tmp = tempdir().unwrap();
        let note_path = tmp.path().join("Note.md").to_string_lossy().into_owned();
        let dir = ensure_diagrams_dir(note_path).await.unwrap();
        assert!(std::path::Path::new(&dir).is_dir());
    }

    #[tokio::test]
    async fn test_write_and_read_diagram() {
        let tmp = tempdir().unwrap();
        let path = tmp
            .path()
            .join("diagram-1.excalidraw")
            .to_string_lossy()
            .into_owned();
        write_diagram(path.clone(), "{}".into()).await.unwrap();
        let content = read_diagram(path).await.unwrap();
        assert_eq!(content, "{}");
    }
}

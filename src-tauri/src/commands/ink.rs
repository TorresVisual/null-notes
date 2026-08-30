use super::sidecar_dir_for;

fn ink_dir_for(note_path: &str) -> String {
    sidecar_dir_for(note_path, "ink")
}

#[tauri::command]
pub async fn ensure_ink_dir(note_path: String) -> Result<String, String> {
    let dir = ink_dir_for(&note_path);
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| e.to_string())?;
    Ok(dir)
}

#[tauri::command]
pub async fn read_ink(path: String) -> Result<String, String> {
    tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn write_ink(path: String, svg: String) -> Result<(), String> {
    tokio::fs::write(&path, svg)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_ink_dir_for() {
        let dir = ink_dir_for("/ws/Lecture 7.md");
        assert!(dir.ends_with("Lecture 7.ink"));
    }

    #[tokio::test]
    async fn test_ensure_ink_dir_creates_directory() {
        let tmp = tempdir().unwrap();
        let note_path = tmp.path().join("Note.md").to_string_lossy().into_owned();
        let ink_dir = ensure_ink_dir(note_path).await.unwrap();
        assert!(std::path::Path::new(&ink_dir).is_dir());
    }

    #[tokio::test]
    async fn test_write_and_read_ink() {
        let tmp = tempdir().unwrap();
        let svg_path = tmp
            .path()
            .join("sketch-1.svg")
            .to_string_lossy()
            .into_owned();
        write_ink(svg_path.clone(), "<svg></svg>".into())
            .await
            .unwrap();
        let content = read_ink(svg_path).await.unwrap();
        assert_eq!(content, "<svg></svg>");
    }
}

use base64::Engine;
use std::path::{Component, Path, PathBuf};

// Third sidecar of the same shape as NoteName.ink/ and NoteName.pdf/. Inside
// the workspace, so a pasted image travels with the note it belongs to — a
// note whose figures didn't come along is a broken note.
fn assets_dir_name(note_path: &str) -> String {
    let stem = Path::new(note_path)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy();
    format!("{stem}.assets")
}

fn note_parent(note_path: &str) -> PathBuf {
    Path::new(note_path)
        .parent()
        .unwrap_or(Path::new("."))
        .to_path_buf()
}

// The note holds a relative path, and a note is editable by hand in any other
// editor — so what comes back is untrusted text that gets joined onto a real
// directory. Anything that is not a plain forward-relative path is refused
// rather than normalised into something that escapes the note's folder.
fn resolve_relative(note_path: &str, relative: &str) -> Result<PathBuf, String> {
    let candidate = Path::new(relative);
    if candidate.is_absolute() {
        return Err(format!("not a relative asset path: {relative}"));
    }
    for component in candidate.components() {
        match component {
            Component::Normal(_) => {}
            _ => return Err(format!("asset path escapes the note folder: {relative}")),
        }
    }
    Ok(note_parent(note_path).join(candidate))
}

fn extension_for(mime: &str) -> &'static str {
    match mime {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/bmp" => "bmp",
        "image/svg+xml" => "svg",
        _ => "png",
    }
}

/// Stores `data` in the note's `.assets` sidecar and returns the path to write
/// into the Markdown — relative, so the note stays portable and the link keeps
/// working after the workspace moves.
#[tauri::command]
pub async fn write_note_asset(
    note_path: String,
    mime: String,
    data: Vec<u8>,
) -> Result<String, String> {
    let dir_name = assets_dir_name(&note_path);
    let dir = note_parent(&note_path).join(&dir_name);
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| e.to_string())?;

    let file_name = format!(
        "image-{}.{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_millis(),
        extension_for(&mime)
    );
    tokio::fs::write(dir.join(&file_name), data)
        .await
        .map_err(|e| e.to_string())?;

    // Forward slashes: this goes into Markdown, which is read on any platform.
    Ok(format!("{dir_name}/{file_name}"))
}

/// Reads an asset back as base64 for display. Same "binary over IPC" shape as
/// read_ink/read_pdf_page rather than a new asset-protocol permission surface.
#[tauri::command]
pub async fn read_note_asset(note_path: String, relative: String) -> Result<String, String> {
    let path = resolve_relative(&note_path, &relative)?;
    let bytes = tokio::fs::read(&path).await.map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_assets_dir_name_follows_the_note() {
        assert_eq!(assets_dir_name("/ws/Lecture 7.md"), "Lecture 7.assets");
    }

    #[test]
    fn test_extension_follows_the_mime_type() {
        assert_eq!(extension_for("image/jpeg"), "jpg");
        assert_eq!(extension_for("image/svg+xml"), "svg");
        assert_eq!(extension_for("application/octet-stream"), "png");
    }

    #[test]
    fn test_resolve_relative_refuses_paths_that_escape_the_note_folder() {
        assert!(resolve_relative("/ws/Note.md", "../../../etc/passwd").is_err());
        assert!(resolve_relative("/ws/Note.md", "Note.assets/../../secret").is_err());
        assert!(resolve_relative("/ws/Note.md", "/etc/passwd").is_err());
    }

    #[test]
    fn test_resolve_relative_accepts_a_plain_sidecar_path() {
        let resolved = resolve_relative("/ws/Note.md", "Note.assets/image-1.png").unwrap();
        assert!(resolved.ends_with("Note.assets/image-1.png"));
    }

    #[tokio::test]
    async fn test_write_then_read_round_trips_the_bytes() {
        let tmp = tempdir().unwrap();
        let note = tmp.path().join("Note.md").to_string_lossy().into_owned();

        let relative = write_note_asset(note.clone(), "image/png".into(), vec![1, 2, 3, 4])
            .await
            .unwrap();

        assert!(relative.starts_with("Note.assets/"));
        assert!(relative.ends_with(".png"));
        assert!(tmp.path().join("Note.assets").is_dir());

        let encoded = read_note_asset(note, relative).await.unwrap();
        assert_eq!(
            encoded,
            base64::engine::general_purpose::STANDARD.encode([1, 2, 3, 4])
        );
    }

    #[tokio::test]
    async fn test_read_refuses_to_escape_even_when_the_target_exists() {
        let tmp = tempdir().unwrap();
        let note = tmp.path().join("notes").join("Note.md");
        std::fs::create_dir_all(note.parent().unwrap()).unwrap();
        std::fs::write(tmp.path().join("secret.txt"), "sensitive").unwrap();

        let result = read_note_asset(
            note.to_string_lossy().into_owned(),
            "../secret.txt".into(),
        )
        .await;

        assert!(result.is_err());
    }
}

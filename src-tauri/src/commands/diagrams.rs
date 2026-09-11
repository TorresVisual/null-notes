use super::notes::is_excluded_dir;
use super::sidecar_dir_for;
use crate::models::DiagramMetadata;
use std::path::{Path, PathBuf};

fn diagrams_dir_for(note_path: &str) -> String {
    sidecar_dir_for(note_path, "diagrams")
}

/// `.excalidraw`/`.svg` pairs directly inside one note's `*.diagrams/`
/// sidecar. An `.excalidraw` with no matching `.svg` is a half-written pair
/// (or one exported by a future format) — skipped rather than shown with a
/// broken thumbnail.
async fn diagrams_in_sidecar(dir: &Path, note_title: &str) -> anyhow::Result<Vec<DiagramMetadata>> {
    let mut entries = tokio::fs::read_dir(dir).await?;
    let mut found = Vec::new();
    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("excalidraw") {
            continue;
        }
        let svg_path = path.with_extension("svg");
        if !tokio::fs::try_exists(&svg_path).await? {
            continue;
        }
        found.push(DiagramMetadata {
            json_path: path.to_string_lossy().into_owned(),
            svg_path: svg_path.to_string_lossy().into_owned(),
            note_title: note_title.to_string(),
        });
    }
    Ok(found)
}

/// Iterative stack walk mirroring `notes::scan_dir_recursive`, but hunting
/// for `*.diagrams` sidecars instead of skipping them like that scan does —
/// every other dot-dir, sidecar suffix and build-tool dir is still skipped
/// the same way (`is_excluded_dir`), so this doesn't wander into
/// `node_modules/` on a workspace that's also a code repo.
async fn list_diagrams_at(workspace: &str) -> anyhow::Result<Vec<DiagramMetadata>> {
    let mut diagrams = Vec::new();
    let mut stack = vec![PathBuf::from(workspace)];

    while let Some(dir) = stack.pop() {
        let mut entries = match tokio::fs::read_dir(&dir).await {
            Ok(entries) => entries,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => return Err(e.into()),
        };
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            if !entry.file_type().await?.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if let Some(note_title) = name.strip_suffix(".diagrams") {
                diagrams.extend(diagrams_in_sidecar(&path, note_title).await?);
                continue;
            }
            if is_excluded_dir(&name) {
                continue;
            }
            stack.push(path);
        }
    }

    diagrams.sort_by(|a, b| {
        a.note_title
            .cmp(&b.note_title)
            .then(a.json_path.cmp(&b.json_path))
    });
    Ok(diagrams)
}

#[tauri::command]
pub async fn list_diagrams(workspace: String) -> Result<Vec<DiagramMetadata>, String> {
    list_diagrams_at(&workspace)
        .await
        .map_err(|e| e.to_string())
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

    #[tokio::test]
    async fn test_list_diagrams_empty_workspace() {
        let tmp = tempdir().unwrap();
        let diagrams = list_diagrams_at(tmp.path().to_str().unwrap())
            .await
            .unwrap();
        assert!(diagrams.is_empty());
    }

    #[tokio::test]
    async fn test_list_diagrams_finds_nested_sidecars_and_skips_incomplete_pairs() {
        let tmp = tempdir().unwrap();
        let unit_dir = tmp.path().join("Unit 1");
        let sidecar = unit_dir.join("Lecture 7.diagrams");
        tokio::fs::create_dir_all(&sidecar).await.unwrap();
        tokio::fs::write(sidecar.join("diagram-1.excalidraw"), "{}")
            .await
            .unwrap();
        tokio::fs::write(sidecar.join("diagram-1.svg"), "<svg></svg>")
            .await
            .unwrap();
        // No matching .svg — should be skipped, not surfaced with a broken thumbnail.
        tokio::fs::write(sidecar.join("diagram-2.excalidraw"), "{}")
            .await
            .unwrap();
        tokio::fs::create_dir_all(tmp.path().join("node_modules/.diagrams"))
            .await
            .unwrap();

        let diagrams = list_diagrams_at(tmp.path().to_str().unwrap())
            .await
            .unwrap();
        assert_eq!(diagrams.len(), 1);
        assert_eq!(diagrams[0].note_title, "Lecture 7");
        assert!(diagrams[0].json_path.ends_with("diagram-1.excalidraw"));
        assert!(diagrams[0].svg_path.ends_with("diagram-1.svg"));
    }
}

use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
pub struct WatcherState(pub Mutex<Option<RecommendedWatcher>>);

// Editors and sync clients touch a file several times per save, and our own
// atomic write lands as create+rename. Collapse a burst into one refresh.
const DEBOUNCE: Duration = Duration::from_millis(300);

fn is_note_path(path: &Path) -> bool {
    if path.extension().and_then(|e| e.to_str()) != Some("md") {
        return false;
    }
    !path.components().any(|c| {
        let name = c.as_os_str().to_string_lossy();
        name.starts_with('.') || name.ends_with(".ink")
    })
}

fn note_paths(event: &Event) -> Vec<PathBuf> {
    event
        .paths
        .iter()
        .filter(|p| is_note_path(p))
        .cloned()
        .collect()
}

#[tauri::command]
pub fn watch_workspace(
    workspace: String,
    app: AppHandle,
    state: State<'_, WatcherState>,
) -> Result<(), String> {
    let (tx, rx) = std::sync::mpsc::channel::<Vec<PathBuf>>();

    let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
        if let Ok(event) = res {
            let paths = note_paths(&event);
            if !paths.is_empty() {
                let _ = tx.send(paths);
            }
        }
    })
    .map_err(|e| e.to_string())?;

    watcher
        .watch(Path::new(&workspace), RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    std::thread::spawn(move || {
        while let Ok(first) = rx.recv() {
            let mut batch: HashSet<PathBuf> = first.into_iter().collect();
            while let Ok(more) = rx.recv_timeout(DEBOUNCE) {
                batch.extend(more);
            }
            let paths: Vec<String> = batch
                .into_iter()
                .map(|p| p.to_string_lossy().into_owned())
                .collect();
            let _ = app.emit("workspace-changed", paths);
        }
    });

    // Dropping the previous watcher stops it, so switching workspaces never
    // leaves a second watcher reporting paths from the old one.
    *state.0.lock().map_err(|e| e.to_string())? = Some(watcher);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_note_path_accepts_markdown() {
        assert!(is_note_path(Path::new("/ws/Course/lecture.md")));
    }

    #[test]
    fn test_is_note_path_rejects_non_markdown() {
        assert!(!is_note_path(Path::new("/ws/index.db")));
        assert!(!is_note_path(Path::new("/ws/sketch.svg")));
    }

    #[test]
    fn test_is_note_path_rejects_our_own_temp_writes() {
        assert!(!is_note_path(Path::new("/ws/.note.md.abc123.tmp")));
    }

    #[test]
    fn test_is_note_path_rejects_ink_and_dot_directories() {
        assert!(!is_note_path(Path::new("/ws/note.ink/stroke.md")));
        assert!(!is_note_path(Path::new("/ws/.git/notes.md")));
    }
}

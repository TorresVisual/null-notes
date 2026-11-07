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

fn has_visible_ext(path: &Path, ext: &str) -> bool {
    if path.extension().and_then(|e| e.to_str()) != Some(ext) {
        return false;
    }
    !path.components().any(|c| {
        let name = c.as_os_str().to_string_lossy();
        name.starts_with('.') || name.ends_with(".ink")
    })
}

fn is_note_path(path: &Path) -> bool {
    has_visible_ext(path, "md")
}

fn is_canvas_path(path: &Path) -> bool {
    has_visible_ext(path, "canvas") || has_visible_ext(path, "base")
}

fn is_bookmarks_path(path: &Path) -> bool {
    path.file_name().and_then(|n| n.to_str()) == Some(super::bookmarks::BOOKMARKS_FILE)
}

fn note_paths(event: &Event) -> Vec<PathBuf> {
    event
        .paths
        .iter()
        .filter(|p| is_note_path(p) || is_canvas_path(p) || is_bookmarks_path(p))
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
    .map_err(|e| {
        tracing::error!(error = %e, "creating file watcher failed");
        e.to_string()
    })?;

    watcher
        .watch(Path::new(&workspace), RecursiveMode::Recursive)
        .map_err(|e| {
            tracing::error!(error = %e, workspace, "watching workspace failed");
            e.to_string()
        })?;
    tracing::info!(workspace, "watching workspace");

    std::thread::spawn(move || {
        while let Ok(first) = rx.recv() {
            let mut batch: HashSet<PathBuf> = first.into_iter().collect();
            while let Ok(more) = rx.recv_timeout(DEBOUNCE) {
                batch.extend(more);
            }
            let (bookmarks, rest): (Vec<PathBuf>, Vec<PathBuf>) =
                batch.into_iter().partition(|p| is_bookmarks_path(p));
            if !bookmarks.is_empty() {
                let _ = app.emit("bookmarks-changed", ());
            }
            // Canvases stay off `workspace-changed`: that path re-indexes from
            // disk, and a .canvas is JSON, not a note.
            let (canvases, notes): (Vec<PathBuf>, Vec<PathBuf>) =
                rest.into_iter().partition(|p| is_canvas_path(p));
            tracing::debug!(
                bookmarks = bookmarks.len(),
                canvases = canvases.len(),
                notes = notes.len(),
                "watcher batch"
            );
            if !canvases.is_empty() {
                let paths: Vec<String> = canvases
                    .into_iter()
                    .map(|p| p.to_string_lossy().into_owned())
                    .collect();
                let _ = app.emit("canvas-changed", paths);
            }
            if !notes.is_empty() {
                let paths: Vec<String> = notes
                    .into_iter()
                    .map(|p| p.to_string_lossy().into_owned())
                    .collect();
                let _ = app.emit("workspace-changed", paths);
            }
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
    fn test_is_bookmarks_path_matches_only_the_bookmarks_file() {
        assert!(is_bookmarks_path(Path::new("/ws/.bookmarks")));
        assert!(!is_bookmarks_path(Path::new("/ws/.bookmarks.abc.tmp")));
        assert!(!is_bookmarks_path(Path::new("/ws/notes.md")));
    }

    #[test]
    fn test_is_note_path_rejects_our_own_temp_writes() {
        assert!(!is_note_path(Path::new("/ws/.note.md.abc123.tmp")));
    }

    #[test]
    fn test_is_canvas_path_accepts_canvases_but_not_temp_writes_or_dot_directories() {
        assert!(is_canvas_path(Path::new("/ws/a.canvas")));
        assert!(!is_canvas_path(Path::new("/ws/.a.canvas.abc.tmp")));
        assert!(!is_canvas_path(Path::new("/ws/.git/a.canvas")));
        assert!(!is_canvas_path(Path::new("/ws/a.md")));
        assert!(!is_note_path(Path::new("/ws/a.canvas")));
    }

    #[test]
    fn test_is_canvas_path_also_classifies_bases() {
        assert!(is_canvas_path(Path::new("/ws/Tasks.base")));
        assert!(!is_canvas_path(Path::new("/ws/.Tasks.base.abc.tmp")));
        assert!(!is_note_path(Path::new("/ws/Tasks.base")));
    }

    #[test]
    fn test_is_note_path_rejects_ink_and_dot_directories() {
        assert!(!is_note_path(Path::new("/ws/note.ink/stroke.md")));
        assert!(!is_note_path(Path::new("/ws/.git/notes.md")));
    }
}

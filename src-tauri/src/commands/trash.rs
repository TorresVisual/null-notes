use super::notes::{
    forget_note, index_note_at, now_ms, require_within_workspace, scan_dir_recursive,
};
use crate::db::{self, DbPool};
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

const MANIFEST: &str = "manifest.json";
const PAYLOAD: &str = "payload";
const SIDECAR_SUFFIXES: [&str; 4] = ["ink", "pdf", "diagrams", "assets"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashEntry {
    pub id: String,
    pub workspace: String,
    pub original_path: String,
    pub is_folder: bool,
    pub name: String,
    pub trashed_at: i64,
}

pub(super) fn trash_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("trash"))
        .map_err(|e| e.to_string())
}

// The id arrives from the frontend and becomes a path under the trash root, so
// it is refused unless it is exactly one `Component::Normal` as written.
fn entry_dir(root: &Path, id: &str) -> anyhow::Result<PathBuf> {
    let mut components = Path::new(id).components();
    match (components.next(), components.next()) {
        (Some(Component::Normal(_)), None) => Ok(root.join(id)),
        _ => anyhow::bail!("invalid trash entry id: {id}"),
    }
}

fn read_manifest(dir: &Path) -> anyhow::Result<TrashEntry> {
    Ok(serde_json::from_slice(&std::fs::read(dir.join(MANIFEST))?)?)
}

fn remove_any(path: &Path) -> std::io::Result<()> {
    if path.is_dir() {
        std::fs::remove_dir_all(path)
    } else {
        std::fs::remove_file(path)
    }
}

pub(super) fn copy_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    if src.is_dir() {
        std::fs::create_dir_all(dst)?;
        for child in std::fs::read_dir(src)? {
            let child = child?;
            copy_recursive(&child.path(), &dst.join(child.file_name()))?;
        }
        Ok(())
    } else {
        std::fs::copy(src, dst).map(|_| ())
    }
}

// Trash lives in the app-data dir, so a workspace on another volume makes
// `rename` fail. The source is only removed once the copy has fully succeeded.
fn move_path(src: &Path, dst: &Path) -> std::io::Result<()> {
    if std::fs::rename(src, dst).is_ok() {
        return Ok(());
    }
    if let Err(e) = copy_recursive(src, dst) {
        let _ = remove_any(dst);
        return Err(e);
    }
    remove_any(src)
}

fn trash_files(
    root: &Path,
    workspace: &str,
    path: &str,
    is_folder: bool,
) -> anyhow::Result<TrashEntry> {
    let src = Path::new(path);
    let file_name = src
        .file_name()
        .ok_or_else(|| anyhow::anyhow!("path has no file name: {path}"))?;
    let name = if is_folder {
        file_name.to_string_lossy().into_owned()
    } else {
        src.file_stem()
            .unwrap_or(file_name)
            .to_string_lossy()
            .into_owned()
    };
    let trashed_at = now_ms();
    let id = format!("{trashed_at}-{}", Uuid::new_v4());
    let dir = root.join(&id);
    let payload = dir.join(PAYLOAD);
    std::fs::create_dir_all(&payload)?;

    let entry = TrashEntry {
        id,
        workspace: workspace.to_string(),
        original_path: path.to_string(),
        is_folder,
        name,
        trashed_at,
    };
    std::fs::write(dir.join(MANIFEST), serde_json::to_vec(&entry)?)?;

    let moved = (|| -> std::io::Result<()> {
        move_path(src, &payload.join(file_name))?;
        // A canvas or base shares its stem with a same-named note, whose sidecars aren't its own.
        if !is_folder && !is_standalone(src) {
            for suffix in SIDECAR_SUFFIXES {
                let sidecar = PathBuf::from(super::sidecar_dir_for(path, suffix));
                if let Some(sidecar_name) = sidecar.file_name().filter(|_| sidecar.exists()) {
                    move_path(&sidecar, &payload.join(sidecar_name))?;
                }
            }
        }
        Ok(())
    })();
    if let Err(e) = moved {
        if std::fs::read_dir(&payload).is_ok_and(|mut d| d.next().is_none()) {
            let _ = std::fs::remove_dir_all(&dir);
        }
        return Err(e.into());
    }
    Ok(entry)
}

/// `.canvas` and `.base` files stand alone: they share a stem with a same-named
/// note but own none of its sidecars.
fn is_standalone(path: &Path) -> bool {
    path.extension()
        .is_some_and(|e| e == "canvas" || e == "base")
}

fn is_free(parent: &Path, entry: &TrashEntry, candidate: &str) -> bool {
    if entry.is_folder {
        return !parent.join(candidate).exists();
    }
    let original = Path::new(&entry.original_path);
    if is_standalone(original) {
        let ext = original.extension().unwrap_or_default().to_string_lossy();
        return !parent.join(format!("{candidate}.{ext}")).exists();
    }
    !parent.join(format!("{candidate}.md")).exists()
        && SIDECAR_SUFFIXES
            .iter()
            .all(|suffix| !parent.join(format!("{candidate}.{suffix}")).exists())
}

fn restore_files(root: &Path, workspace: &str, id: &str) -> anyhow::Result<(TrashEntry, PathBuf)> {
    let dir = entry_dir(root, id)?;
    let entry = read_manifest(&dir)?;
    if entry.workspace != workspace {
        anyhow::bail!("trash entry {id} belongs to a different workspace");
    }
    let original = Path::new(&entry.original_path);
    let parent = original
        .parent()
        .ok_or_else(|| anyhow::anyhow!("original path has no parent"))?;
    std::fs::create_dir_all(parent)?;

    let stem = entry.name.clone();
    let candidate = (0..)
        .map(|n| match n {
            0 => stem.clone(),
            1 => format!("{stem} (restored)"),
            n => format!("{stem} (restored {n})"),
        })
        .find(|candidate| is_free(parent, &entry, candidate))
        .unwrap_or_else(|| stem.clone());

    let mut restored_root = parent.join(&candidate);
    for item in std::fs::read_dir(dir.join(PAYLOAD))? {
        let item = item?;
        let item_name = item.file_name().to_string_lossy().into_owned();
        let suffix = item_name.strip_prefix(&stem).unwrap_or_default();
        let target = parent.join(format!("{candidate}{suffix}"));
        move_path(&item.path(), &target)?;
        if suffix.is_empty() || matches!(suffix, ".md" | ".canvas" | ".base") {
            restored_root = target;
        }
    }
    std::fs::remove_dir_all(&dir)?;
    Ok((entry, restored_root))
}

fn list_entries(root: &Path, workspace: &str) -> Vec<TrashEntry> {
    let Ok(dir) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    let mut entries: Vec<TrashEntry> = dir
        .filter_map(Result::ok)
        .filter_map(|e| read_manifest(&e.path()).ok())
        .filter(|e| e.workspace == workspace)
        .collect();
    entries.sort_by_key(|e| std::cmp::Reverse(e.trashed_at));
    entries
}

async fn blocking<T: Send + 'static>(
    job: impl FnOnce() -> anyhow::Result<T> + Send + 'static,
) -> anyhow::Result<T> {
    tokio::task::spawn_blocking(job).await?
}

pub(super) async fn trash_note_at(
    root: &Path,
    workspace: &str,
    path: &str,
    db: &DbPool,
) -> anyhow::Result<TrashEntry> {
    let (root, workspace_owned, path_owned) =
        (root.to_path_buf(), workspace.to_string(), path.to_string());
    let entry = blocking(move || trash_files(&root, &workspace_owned, &path_owned, false)).await?;
    forget_note(path, db).await?;
    Ok(entry)
}

async fn trash_folder_at(
    root: &Path,
    workspace: &str,
    path: &str,
    db: &DbPool,
) -> anyhow::Result<TrashEntry> {
    let (root, workspace_owned, path_owned) =
        (root.to_path_buf(), workspace.to_string(), path.to_string());
    let entry = blocking(move || trash_files(&root, &workspace_owned, &path_owned, true)).await?;
    let prefix = format!("{}{}", path, std::path::MAIN_SEPARATOR);
    db::notes::remove_notes_under(db, &prefix).await?;
    Ok(entry)
}

pub(super) async fn restore_at(
    root: &Path,
    workspace: &str,
    id: &str,
    db: &DbPool,
) -> anyhow::Result<String> {
    let (root, workspace_owned, id) = (root.to_path_buf(), workspace.to_string(), id.to_string());
    let (entry, restored) = blocking(move || restore_files(&root, &workspace_owned, &id)).await?;
    let restored_str = restored.to_string_lossy().into_owned();
    if entry.is_folder {
        let (notes, _, _) = scan_dir_recursive(&restored, workspace).await?;
        for note in notes {
            let content = tokio::fs::read_to_string(&note.path).await?;
            index_note_at(&note.path, workspace, &content, db).await?;
        }
    } else if !is_standalone(&restored) {
        let content = tokio::fs::read_to_string(&restored).await?;
        index_note_at(&restored_str, workspace, &content, db).await?;
    }
    Ok(restored_str)
}

#[tauri::command]
pub async fn delete_note(
    app: AppHandle,
    workspace: String,
    path: String,
    db: State<'_, DbPool>,
) -> Result<TrashEntry, String> {
    require_within_workspace(&workspace, &path)?;
    trash_note_at(&trash_root(&app)?, &workspace, &path, &db)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_folder(
    app: AppHandle,
    workspace: String,
    path: String,
    db: State<'_, DbPool>,
) -> Result<TrashEntry, String> {
    require_within_workspace(&workspace, &path)?;
    trash_folder_at(&trash_root(&app)?, &workspace, &path, &db)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_trash(app: AppHandle, workspace: String) -> Result<Vec<TrashEntry>, String> {
    let root = trash_root(&app)?;
    blocking(move || Ok(list_entries(&root, &workspace)))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn restore_trash_entry(
    app: AppHandle,
    workspace: String,
    id: String,
    db: State<'_, DbPool>,
) -> Result<String, String> {
    restore_at(&trash_root(&app)?, &workspace, &id, &db)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn purge_trash_entry(app: AppHandle, id: String) -> Result<(), String> {
    let root = trash_root(&app)?;
    blocking(move || Ok(std::fs::remove_dir_all(entry_dir(&root, &id)?)?))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn empty_trash(app: AppHandle, workspace: String) -> Result<(), String> {
    let root = trash_root(&app)?;
    blocking(move || {
        for entry in list_entries(&root, &workspace) {
            std::fs::remove_dir_all(entry_dir(&root, &entry.id)?)?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::notes::index_note as db_index_note;
    use crate::db::schema::run_migrations;
    use crate::models::NoteMetadata;
    use tempfile::tempdir;

    // max_connections(1): see the matching comment on notes.rs's folder_tests.
    async fn make_pool() -> DbPool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        run_migrations(&pool).await.unwrap();
        pool
    }

    async fn index(pool: &DbPool, root: &Path, path: &Path) {
        db_index_note(
            pool,
            &NoteMetadata {
                id: "a".into(),
                title: "Note".into(),
                path: path.to_string_lossy().into_owned(),
                workspace: root.to_string_lossy().into_owned(),
                updated_at: 1000,
            },
        )
        .await
        .unwrap();
    }

    fn write_note_with_sidecars(dir: &Path, stem: &str) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(dir.join(format!("{stem}.md")), "# Note").unwrap();
        for suffix in SIDECAR_SUFFIXES {
            let sidecar = dir.join(format!("{stem}.{suffix}"));
            std::fs::create_dir_all(&sidecar).unwrap();
            std::fs::write(sidecar.join("child"), "content").unwrap();
        }
    }

    fn assert_note_with_sidecars(dir: &Path, stem: &str) {
        assert!(dir.join(format!("{stem}.md")).exists());
        for suffix in SIDECAR_SUFFIXES {
            assert!(
                dir.join(format!("{stem}.{suffix}")).join("child").exists(),
                "{stem}.{suffix} must be present"
            );
        }
    }

    #[tokio::test]
    async fn test_trash_then_restore_note_returns_every_sidecar() {
        let ws = tempdir().unwrap();
        let trash = tempdir().unwrap();
        write_note_with_sidecars(ws.path(), "note");
        let pool = make_pool().await;
        let path = ws.path().join("note.md");
        index(&pool, ws.path(), &path).await;
        let workspace = ws.path().to_string_lossy().into_owned();

        let entry = trash_note_at(trash.path(), &workspace, &path.to_string_lossy(), &pool)
            .await
            .unwrap();

        assert!(!path.exists());
        for suffix in SIDECAR_SUFFIXES {
            assert!(!ws.path().join(format!("note.{suffix}")).exists());
        }
        assert!(db::notes::list_by_workspace(&pool, &workspace)
            .await
            .unwrap()
            .is_empty());
        assert_eq!(list_entries(trash.path(), &workspace).len(), 1);

        let restored = restore_at(trash.path(), &workspace, &entry.id, &pool)
            .await
            .unwrap();

        assert_eq!(restored, path.to_string_lossy());
        assert_note_with_sidecars(ws.path(), "note");
        assert!(list_entries(trash.path(), &workspace).is_empty());
        assert_eq!(
            db::notes::list_by_workspace(&pool, &workspace)
                .await
                .unwrap()
                .len(),
            1
        );
    }

    #[tokio::test]
    async fn test_trash_then_restore_folder_returns_nested_notes() {
        let ws = tempdir().unwrap();
        let trash = tempdir().unwrap();
        let folder = ws.path().join("Course");
        write_note_with_sidecars(&folder.join("Week 1"), "note");
        let pool = make_pool().await;
        index(&pool, ws.path(), &folder.join("Week 1").join("note.md")).await;
        let workspace = ws.path().to_string_lossy().into_owned();

        let entry = trash_folder_at(trash.path(), &workspace, &folder.to_string_lossy(), &pool)
            .await
            .unwrap();

        assert!(!folder.exists());
        assert!(db::notes::list_by_workspace(&pool, &workspace)
            .await
            .unwrap()
            .is_empty());

        restore_at(trash.path(), &workspace, &entry.id, &pool)
            .await
            .unwrap();

        assert_note_with_sidecars(&folder.join("Week 1"), "note");
        assert_eq!(
            db::notes::list_by_workspace(&pool, &workspace)
                .await
                .unwrap()
                .len(),
            1
        );
    }

    #[tokio::test]
    async fn test_restore_on_collision_never_overwrites() {
        let ws = tempdir().unwrap();
        let trash = tempdir().unwrap();
        write_note_with_sidecars(ws.path(), "note");
        let pool = make_pool().await;
        let path = ws.path().join("note.md");
        let workspace = ws.path().to_string_lossy().into_owned();
        let entry = trash_note_at(trash.path(), &workspace, &path.to_string_lossy(), &pool)
            .await
            .unwrap();
        std::fs::write(&path, "# Survivor").unwrap();

        let restored = restore_at(trash.path(), &workspace, &entry.id, &pool)
            .await
            .unwrap();

        assert_eq!(std::fs::read_to_string(&path).unwrap(), "# Survivor");
        assert_eq!(
            restored,
            ws.path().join("note (restored).md").to_string_lossy()
        );
        assert_note_with_sidecars(ws.path(), "note (restored)");
    }

    #[tokio::test]
    async fn test_restore_recreates_a_missing_parent_folder() {
        let ws = tempdir().unwrap();
        let trash = tempdir().unwrap();
        let folder = ws.path().join("Gone");
        write_note_with_sidecars(&folder, "note");
        let pool = make_pool().await;
        let workspace = ws.path().to_string_lossy().into_owned();
        let entry = trash_note_at(
            trash.path(),
            &workspace,
            &folder.join("note.md").to_string_lossy(),
            &pool,
        )
        .await
        .unwrap();
        std::fs::remove_dir_all(&folder).unwrap();

        restore_at(trash.path(), &workspace, &entry.id, &pool)
            .await
            .unwrap();

        assert_note_with_sidecars(&folder, "note");
    }

    #[tokio::test]
    async fn test_trash_then_restore_canvas_keeps_the_index_and_a_sibling_notes_sidecars() {
        let ws = tempdir().unwrap();
        let trash = tempdir().unwrap();
        write_note_with_sidecars(ws.path(), "map");
        let canvas = ws.path().join("map.canvas");
        std::fs::write(&canvas, "{}").unwrap();
        let pool = make_pool().await;
        let workspace = ws.path().to_string_lossy().into_owned();

        let entry = trash_note_at(trash.path(), &workspace, &canvas.to_string_lossy(), &pool)
            .await
            .unwrap();

        assert!(!canvas.exists());
        assert_note_with_sidecars(ws.path(), "map");

        let restored = restore_at(trash.path(), &workspace, &entry.id, &pool)
            .await
            .unwrap();

        assert_eq!(restored, canvas.to_string_lossy());
        assert!(canvas.exists());
        assert!(db::notes::list_by_workspace(&pool, &workspace)
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn test_trash_then_restore_base_keeps_a_sibling_notes_sidecars() {
        let ws = tempdir().unwrap();
        let trash = tempdir().unwrap();
        write_note_with_sidecars(ws.path(), "Tasks");
        let base = ws.path().join("Tasks.base");
        std::fs::write(&base, "views: []\n").unwrap();
        let pool = make_pool().await;
        let workspace = ws.path().to_string_lossy().into_owned();

        let entry = trash_note_at(trash.path(), &workspace, &base.to_string_lossy(), &pool)
            .await
            .unwrap();

        assert!(!base.exists());
        assert_note_with_sidecars(ws.path(), "Tasks");

        std::fs::write(&base, "views: [new]\n").unwrap();
        let restored = restore_at(trash.path(), &workspace, &entry.id, &pool)
            .await
            .unwrap();

        assert_eq!(
            restored,
            ws.path().join("Tasks (restored).base").to_string_lossy()
        );
        assert_eq!(std::fs::read_to_string(&base).unwrap(), "views: [new]\n");
        assert_eq!(std::fs::read_to_string(&restored).unwrap(), "views: []\n");
        assert_note_with_sidecars(ws.path(), "Tasks");
    }

    #[tokio::test]
    async fn test_restore_canvas_on_collision_never_overwrites() {
        let ws = tempdir().unwrap();
        let trash = tempdir().unwrap();
        let canvas = ws.path().join("map.canvas");
        std::fs::write(&canvas, "old").unwrap();
        let pool = make_pool().await;
        let workspace = ws.path().to_string_lossy().into_owned();
        let entry = trash_note_at(trash.path(), &workspace, &canvas.to_string_lossy(), &pool)
            .await
            .unwrap();
        std::fs::write(&canvas, "new").unwrap();

        let restored = restore_at(trash.path(), &workspace, &entry.id, &pool)
            .await
            .unwrap();

        assert_eq!(
            restored,
            ws.path().join("map (restored).canvas").to_string_lossy()
        );
        assert_eq!(std::fs::read_to_string(&canvas).unwrap(), "new");
        assert_eq!(std::fs::read_to_string(&restored).unwrap(), "old");
    }

    #[test]
    fn test_entry_id_must_be_a_single_normal_component() {
        let root = Path::new("/trash");
        assert!(entry_dir(root, "123-abc").is_ok());
        for bad in ["..", "../x", "a/b", "/abs", ""] {
            assert!(entry_dir(root, bad).is_err(), "{bad:?} must be refused");
        }
    }
}

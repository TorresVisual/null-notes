//! Every directory under `tests/golden/` is a workspace and `index.db` written
//! by a tagged release (see `tests/golden/README.md`). The current build must
//! open each one, reindex it, save a note, and leave every file byte-identical.

use null_notes_lib::commands::notes::{reindex_from_disk, save_note, scan_workspace};
use null_notes_lib::db::{self, notes};
use std::collections::BTreeMap;
use std::path::Path;
use tauri::test::mock_app;
use tauri::Manager;

type Snapshot = BTreeMap<String, Vec<u8>>;

fn snapshot(root: &Path, dir: &Path, out: &mut Snapshot) {
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            snapshot(root, &path, out);
        } else {
            let rel = path.strip_prefix(root).unwrap().to_string_lossy();
            out.insert(rel.replace('\\', "/"), std::fs::read(&path).unwrap());
        }
    }
}

fn copy_dir(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let dest = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_dir(&entry.path(), &dest);
        } else {
            std::fs::copy(entry.path(), dest).unwrap();
        }
    }
}

fn markdown_files(dir: &Path, out: &mut Vec<String>) {
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            markdown_files(&path, out);
        } else if path.extension().is_some_and(|ext| ext == "md") {
            out.push(path.to_string_lossy().into_owned());
        }
    }
}

async fn open_golden(version_dir: &Path) {
    let version = version_dir.file_name().unwrap().to_string_lossy();
    let workspace_dir = tempfile::tempdir().unwrap();
    copy_dir(&version_dir.join("workspace"), workspace_dir.path());
    let workspace = workspace_dir.path().to_string_lossy().into_owned();
    let mut before = Snapshot::new();
    snapshot(workspace_dir.path(), workspace_dir.path(), &mut before);

    let data_dir = tempfile::tempdir().unwrap();
    std::fs::copy(
        version_dir.join("index.db"),
        data_dir.path().join("index.db"),
    )
    .unwrap();
    let pool = db::init_db(data_dir.path()).await.unwrap();

    let (old_notes,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM notes")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(old_notes > 0, "{version}: migration dropped the old index");
    assert!(
        std::fs::read_dir(data_dir.path()).unwrap().all(|e| !e
            .unwrap()
            .file_name()
            .to_string_lossy()
            .contains("corrupt")),
        "{version}: index.db was quarantined as corrupt"
    );

    let app = mock_app();
    app.manage(pool.clone());
    let tree = scan_workspace(workspace.clone(), Vec::new(), app.state())
        .await
        .unwrap();
    assert_eq!(tree.notes.len(), 3, "{version}: notes in tree");
    assert_eq!(tree.canvases.len(), 2, "{version}: .canvas and .base files");

    let mut files = Vec::new();
    markdown_files(workspace_dir.path(), &mut files);
    for file in files {
        assert!(
            reindex_from_disk(file.clone(), workspace.clone(), app.state())
                .await
                .unwrap()
        );
        let content = std::fs::read_to_string(&file).unwrap();
        save_note(workspace.clone(), file, content).await.unwrap();
    }

    let mut after = Snapshot::new();
    snapshot(workspace_dir.path(), workspace_dir.path(), &mut after);
    assert_eq!(before, after, "{version}: workspace files changed");

    let tags = notes::list_tags(&pool, &workspace).await.unwrap();
    assert_eq!(tags, ["cs", "graphs", "recursion", "sorting"], "{version}");

    let (hits,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM notes_fts f JOIN notes n ON n.path = f.path
         WHERE notes_fts MATCH 'zeppelin' AND n.workspace = ?",
    )
    .bind(&workspace)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(hits, 1, "{version}: full-text search");

    let graphs = tree
        .notes
        .iter()
        .find(|n| n.title == "Graphs")
        .unwrap_or_else(|| panic!("{version}: Graphs note missing"));
    let backlinks = notes::backlinks_for(&pool, &workspace, &graphs.path)
        .await
        .unwrap();
    assert_eq!(backlinks.len(), 1, "{version}: backlinks");
    pool.close().await;
}

#[tokio::test]
async fn every_released_version_opens_without_content_changes() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/golden");
    let mut versions: Vec<_> = std::fs::read_dir(&root)
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.is_dir())
        .collect();
    versions.sort();
    assert!(!versions.is_empty(), "no golden workspaces found");
    for version in versions {
        open_golden(&version).await;
    }
}

use super::notes::{
    encode_uri_stem, ensure_markdown, index_note_at, note_filename, now_ms,
    require_within_workspace, rewrite_links, split_frontmatter, title_from_content, write_atomic,
};
use super::trash::{restore_at, trash_note_at, trash_root, TrashEntry};
use crate::db::{self, DbPool};
use crate::models::NoteMetadata;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};
use uuid::Uuid;

const SIDECAR_SUFFIXES: [&str; 4] = ["ink", "pdf", "diagrams", "assets"];

// What a merge wrote into an already-existing note, kept so the undo can put
// it back — but only while the file still holds exactly `after`, so an edit
// made since the merge is never overwritten.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeSnapshot {
    pub path: String,
    pub before: String,
    pub after: String,
}

#[derive(Debug, Serialize)]
pub struct MergeOutcome {
    pub trash: TrashEntry,
    pub snapshots: Vec<MergeSnapshot>,
}

fn stem_of(path: &str) -> String {
    Path::new(path)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned()
}

fn free_name(dir: &Path, name: &str) -> String {
    let path = Path::new(name);
    let stem = stem_of(name);
    let ext = path
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    (0..)
        .map(|n| match n {
            0 => name.to_string(),
            n => format!("{stem}-{n}{ext}"),
        })
        .find(|candidate| !dir.join(candidate).exists())
        .unwrap_or_else(|| name.to_string())
}

// Copies (never moves) every sidecar file `content` links to from `src`'s
// sidecar dirs into `dst`'s, and returns `content` re-pointed at the copies.
// Copying keeps the source whole, so the editor's undo and the trash's restore
// both still find their files; the cost is an orphan left behind in the source
// sidecar after an extract. A name already taken in the destination is kept
// apart (`page-1-1.png`) rather than overwritten.
fn carry_sidecars(content: &str, src: &str, dst: &str) -> anyhow::Result<String> {
    let (src_stem, dst_stem) = (stem_of(src), stem_of(dst));
    let mut out = content.to_string();
    for suffix in SIDECAR_SUFFIXES {
        let Ok(files) = std::fs::read_dir(super::sidecar_dir_for(src, suffix)) else {
            continue;
        };
        let dst_dir = PathBuf::from(super::sidecar_dir_for(dst, suffix));
        for file in files {
            let file = file?;
            if !file.file_type()?.is_file() {
                continue;
            }
            let name = file.file_name().to_string_lossy().into_owned();
            let raw_ref = format!("{src_stem}.{suffix}/{name}");
            let enc_ref = format!("{}.{suffix}/{name}", encode_uri_stem(&src_stem));
            if !out.contains(&raw_ref) && !out.contains(&enc_ref) {
                continue;
            }
            std::fs::create_dir_all(&dst_dir)?;
            let new_name = free_name(&dst_dir, &name);
            std::fs::copy(file.path(), dst_dir.join(&new_name))?;
            out = out.replace(&raw_ref, &format!("{dst_stem}.{suffix}/{new_name}"));
            out = out.replace(
                &enc_ref,
                &format!("{}.{suffix}/{new_name}", encode_uri_stem(&dst_stem)),
            );
        }
    }
    Ok(out)
}

async fn carry(content: &str, src: &str, dst: &str) -> anyhow::Result<String> {
    let (content, src, dst) = (content.to_string(), src.to_string(), dst.to_string());
    tokio::task::spawn_blocking(move || carry_sidecars(&content, &src, &dst)).await?
}

pub(super) async fn extract_to_note_at(
    workspace: &str,
    source: &str,
    title: &str,
    markdown: &str,
    db: &DbPool,
) -> anyhow::Result<NoteMetadata> {
    let title = title.trim();
    if title.is_empty() {
        anyhow::bail!("the new note needs a title");
    }
    let folder = Path::new(source)
        .parent()
        .ok_or_else(|| anyhow::anyhow!("note path has no parent folder: {source}"))?;
    let new_path = folder.join(note_filename(title));
    if tokio::fs::try_exists(&new_path).await? {
        anyhow::bail!(
            "a note named \"{}\" already exists here",
            note_filename(title)
        );
    }
    let new_path_str = new_path.to_string_lossy().into_owned();

    // Sidecars first: the note appearing is the commit point, and an orphaned
    // sidecar from a failed write is harmless where a broken note is not.
    let body = carry(markdown, source, &new_path_str).await?;
    let content = format!("# {title}\n\n{}\n", body.trim());
    write_atomic(&new_path, &content).await?;
    index_note_at(&new_path_str, workspace, &content, db).await?;

    Ok(NoteMetadata {
        id: Uuid::new_v4().to_string(),
        title: title.to_string(),
        path: new_path_str,
        workspace: workspace.to_string(),
        updated_at: now_ms(),
    })
}

// The source's own title heading would otherwise become a second `#` title in
// the middle of the destination.
fn demote_title(body: &str) -> String {
    let start = body.len() - body.trim_start().len();
    if body[start..].starts_with("# ") {
        format!("{}#{}", &body[..start], &body[start..])
    } else {
        body.to_string()
    }
}

async fn rewrite_note(
    path: &str,
    before: String,
    after: String,
    workspace: &str,
    db: &DbPool,
) -> anyhow::Result<MergeSnapshot> {
    write_atomic(Path::new(path), &after).await?;
    index_note_at(path, workspace, &after, db).await?;
    Ok(MergeSnapshot {
        path: path.to_string(),
        before,
        after,
    })
}

// The source goes to the trash last: until then every earlier step only added
// content, so a failure part-way leaves the text in both notes, never in none.
pub(super) async fn merge_note_at(
    root: &Path,
    workspace: &str,
    source: &str,
    dest: &str,
    db: &DbPool,
) -> anyhow::Result<MergeOutcome> {
    if source == dest {
        anyhow::bail!("a note cannot be merged into itself");
    }
    let source_content = tokio::fs::read_to_string(source).await?;
    let dest_content = tokio::fs::read_to_string(dest).await?;
    let (source_title, dest_title) = (
        title_from_content(&source_content),
        title_from_content(&dest_content),
    );

    let moved = carry(split_frontmatter(&source_content).1, source, dest).await?;
    let mut merged = format!(
        "{}\n\n{}\n",
        dest_content.trim_end(),
        demote_title(moved.trim())
    );
    let retarget = !source_title.eq_ignore_ascii_case(&dest_title);
    if retarget {
        merged = rewrite_links(&merged, &source_title, &dest_title)?;
    }

    let mut snapshots = vec![rewrite_note(dest, dest_content, merged, workspace, db).await?];
    if retarget {
        for backlinker in db::notes::backlinks_for(db, workspace, source).await? {
            if backlinker.path == source || backlinker.path == dest {
                continue;
            }
            let content = tokio::fs::read_to_string(&backlinker.path).await?;
            let rewritten = rewrite_links(&content, &source_title, &dest_title)?;
            if rewritten != content {
                snapshots
                    .push(rewrite_note(&backlinker.path, content, rewritten, workspace, db).await?);
            }
        }
    }

    let trash = trash_note_at(root, workspace, source, db).await?;
    Ok(MergeOutcome { trash, snapshots })
}

pub(super) async fn undo_merge_at(
    root: &Path,
    workspace: &str,
    trash_id: &str,
    snapshots: &[MergeSnapshot],
    db: &DbPool,
) -> anyhow::Result<String> {
    for snapshot in snapshots {
        if tokio::fs::read_to_string(&snapshot.path).await? != snapshot.after {
            anyhow::bail!(
                "{} changed after the merge, so it was left alone — nothing was undone",
                snapshot.path
            );
        }
    }
    let restored = restore_at(root, workspace, trash_id, db).await?;
    for snapshot in snapshots {
        write_atomic(Path::new(&snapshot.path), &snapshot.before).await?;
        index_note_at(&snapshot.path, workspace, &snapshot.before, db).await?;
    }
    Ok(restored)
}

#[tauri::command]
pub async fn extract_to_note(
    workspace: String,
    source_path: String,
    title: String,
    markdown: String,
    db: State<'_, DbPool>,
) -> Result<NoteMetadata, String> {
    require_within_workspace(&workspace, &source_path)?;
    extract_to_note_at(&workspace, &source_path, &title, &markdown, &db)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn merge_note(
    app: AppHandle,
    workspace: String,
    source_path: String,
    dest_path: String,
    db: State<'_, DbPool>,
) -> Result<MergeOutcome, String> {
    require_within_workspace(&workspace, &source_path)?;
    require_within_workspace(&workspace, &dest_path)?;
    ensure_markdown(&source_path).map_err(|e| e.to_string())?;
    ensure_markdown(&dest_path).map_err(|e| e.to_string())?;
    merge_note_at(
        &trash_root(&app)?,
        &workspace,
        &source_path,
        &dest_path,
        &db,
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn undo_merge(
    app: AppHandle,
    workspace: String,
    trash_id: String,
    snapshots: Vec<MergeSnapshot>,
    db: State<'_, DbPool>,
) -> Result<String, String> {
    for snapshot in &snapshots {
        require_within_workspace(&workspace, &snapshot.path)?;
    }
    undo_merge_at(&trash_root(&app)?, &workspace, &trash_id, &snapshots, &db)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::run_migrations;
    use tempfile::tempdir;

    async fn make_pool() -> DbPool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        run_migrations(&pool).await.unwrap();
        pool
    }

    fn write(dir: &Path, rel: &str, content: &str) -> String {
        let path = dir.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, content).unwrap();
        path.to_string_lossy().into_owned()
    }

    #[tokio::test]
    async fn test_extract_copies_only_referenced_sidecars_and_rewrites_links() {
        let ws = tempdir().unwrap();
        let source = write(ws.path(), "Lecture 7.md", "# Lecture 7\n");
        write(ws.path(), "Lecture 7.assets/a.png", "A");
        write(ws.path(), "Lecture 7.assets/b.png", "B");
        write(ws.path(), "Lecture 7.ink/s.svg", "S");
        let pool = make_pool().await;
        let md = "![fig](Lecture%207.assets/a.png)\n\n![](Lecture 7.ink/s.svg#ink=700x900)";

        let meta = extract_to_note_at(&ws.path().to_string_lossy(), &source, "Part", md, &pool)
            .await
            .unwrap();

        let content = std::fs::read_to_string(&meta.path).unwrap();
        assert!(content.starts_with("# Part\n\n"));
        assert!(content.contains("Part.assets/a.png"));
        assert!(content.contains("Part.ink/s.svg"));
        assert!(!content.contains("Lecture"));
        assert!(ws.path().join("Part.assets/a.png").exists());
        assert!(!ws.path().join("Part.assets/b.png").exists());
        assert!(ws.path().join("Part.ink/s.svg").exists());
        assert!(ws.path().join("Lecture 7.assets/a.png").exists());
    }

    #[tokio::test]
    async fn test_extract_refuses_to_overwrite_an_existing_note() {
        let ws = tempdir().unwrap();
        let source = write(ws.path(), "Src.md", "# Src\n");
        write(ws.path(), "Taken.md", "# Taken\nkeep me");
        let pool = make_pool().await;

        let result =
            extract_to_note_at(&ws.path().to_string_lossy(), &source, "Taken", "x", &pool).await;

        assert!(result.is_err());
        assert_eq!(
            std::fs::read_to_string(ws.path().join("Taken.md")).unwrap(),
            "# Taken\nkeep me"
        );
    }

    #[tokio::test]
    async fn test_merge_appends_rewrites_links_trashes_and_undoes() {
        let ws = tempdir().unwrap();
        let trash = tempdir().unwrap();
        let workspace = ws.path().to_string_lossy().into_owned();
        let source = write(
            ws.path(),
            "Src.md",
            "# Src\n\nbody ![](Src.assets/image-1.png) [[Dest]]\n",
        );
        let dest = write(
            ws.path(),
            "Dest.md",
            "# Dest\n\nown ![](Dest.assets/image-1.png)\n",
        );
        let other = write(ws.path(), "Other.md", "# Other\n\nsee [[Src|the source]]\n");
        write(ws.path(), "Src.assets/image-1.png", "SRC");
        write(ws.path(), "Dest.assets/image-1.png", "DEST");
        let pool = make_pool().await;
        for path in [&source, &dest, &other] {
            let content = std::fs::read_to_string(path).unwrap();
            index_note_at(path, &workspace, &content, &pool)
                .await
                .unwrap();
        }

        let outcome = merge_note_at(trash.path(), &workspace, &source, &dest, &pool)
            .await
            .unwrap();

        let merged = std::fs::read_to_string(&dest).unwrap();
        assert!(merged.contains("own ![](Dest.assets/image-1.png)"));
        assert!(merged.contains("## Src"));
        assert!(merged.contains("Dest.assets/image-1-1.png"));
        assert!(merged.contains("[[Dest]]"));
        assert_eq!(
            std::fs::read_to_string(ws.path().join("Dest.assets/image-1.png")).unwrap(),
            "DEST"
        );
        assert_eq!(
            std::fs::read_to_string(ws.path().join("Dest.assets/image-1-1.png")).unwrap(),
            "SRC"
        );
        assert_eq!(
            std::fs::read_to_string(&other).unwrap(),
            "# Other\n\nsee [[Dest|the source]]\n"
        );
        assert!(!Path::new(&source).exists());
        assert!(!ws.path().join("Src.assets").exists());

        undo_merge_at(
            trash.path(),
            &workspace,
            &outcome.trash.id,
            &outcome.snapshots,
            &pool,
        )
        .await
        .unwrap();

        assert!(Path::new(&source).exists());
        assert!(ws.path().join("Src.assets/image-1.png").exists());
        assert_eq!(
            std::fs::read_to_string(&dest).unwrap(),
            "# Dest\n\nown ![](Dest.assets/image-1.png)\n"
        );
        assert_eq!(
            std::fs::read_to_string(&other).unwrap(),
            "# Other\n\nsee [[Src|the source]]\n"
        );
    }

    #[tokio::test]
    async fn test_undo_merge_leaves_everything_alone_when_a_note_changed_since() {
        let ws = tempdir().unwrap();
        let trash = tempdir().unwrap();
        let workspace = ws.path().to_string_lossy().into_owned();
        let source = write(ws.path(), "Src.md", "# Src\n\nbody\n");
        let dest = write(ws.path(), "Dest.md", "# Dest\n");
        let pool = make_pool().await;

        let outcome = merge_note_at(trash.path(), &workspace, &source, &dest, &pool)
            .await
            .unwrap();
        std::fs::write(&dest, "edited since").unwrap();

        let result = undo_merge_at(
            trash.path(),
            &workspace,
            &outcome.trash.id,
            &outcome.snapshots,
            &pool,
        )
        .await;

        assert!(result.is_err());
        assert_eq!(std::fs::read_to_string(&dest).unwrap(), "edited since");
        assert!(!Path::new(&source).exists());
    }

    #[tokio::test]
    async fn test_merge_into_itself_is_refused() {
        let ws = tempdir().unwrap();
        let trash = tempdir().unwrap();
        let note = write(ws.path(), "A.md", "# A\n");
        let pool = make_pool().await;

        let result = merge_note_at(
            trash.path(),
            &ws.path().to_string_lossy(),
            &note,
            &note,
            &pool,
        )
        .await;

        assert!(result.is_err());
        assert!(Path::new(&note).exists());
    }
}

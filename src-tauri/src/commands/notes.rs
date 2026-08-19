use crate::db::{self, DbPool};
use crate::models::{GraphLink, GraphTag, NoteMetadata, SearchResult, WorkspaceTree};
use regex::Regex;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

const MAX_TITLE_CHARS: usize = 60;

fn truncate_title(s: &str) -> String {
    if s.chars().count() <= MAX_TITLE_CHARS {
        s.to_string()
    } else {
        let truncated: String = s.chars().take(MAX_TITLE_CHARS).collect();
        format!("{}…", truncated.trim_end())
    }
}

// Notes often open with a blockquote tagline or a horizontal rule before
// their actual heading, so the title can't just be "the first line" — it
// has to be the first ATX heading found anywhere in the document, falling
// back to the first non-heading line only when no heading exists at all.
pub fn title_from_content(content: &str) -> String {
    let mut fallback: Option<&str> = None;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.starts_with('#') {
            let heading = trimmed.trim_start_matches('#').trim();
            if !heading.is_empty() {
                return truncate_title(heading);
            }
            continue;
        }
        if fallback.is_none() {
            fallback = Some(trimmed);
        }
    }
    match fallback {
        Some(line) => truncate_title(line),
        None => "Untitled".to_string(),
    }
}

fn strip_code(content: &str) -> String {
    let without_fences = Regex::new(r"(?s)```.*?```")
        .map(|re| re.replace_all(content, "").into_owned())
        .unwrap_or_else(|_| content.to_string());
    Regex::new(r"`[^`\n]*`")
        .map(|re| re.replace_all(&without_fences, "").into_owned())
        .unwrap_or(without_fences)
}

pub fn extract_tags(content: &str) -> Vec<String> {
    let stripped = strip_code(content);
    let re = match Regex::new(r"(?:^|\s)#([A-Za-z][\w-]*)") {
        Ok(re) => re,
        Err(_) => return Vec::new(),
    };
    let mut seen = HashSet::new();
    let mut tags = Vec::new();
    for cap in re.captures_iter(&stripped) {
        if let Some(m) = cap.get(1) {
            let tag = m.as_str().to_string();
            if seen.insert(tag.to_lowercase()) {
                tags.push(tag);
            }
        }
    }
    tags
}

pub fn extract_links(content: &str) -> Vec<String> {
    let re = match Regex::new(r"\[\[([^\]\n]+)\]\]") {
        Ok(re) => re,
        Err(_) => return Vec::new(),
    };
    let mut seen = HashSet::new();
    let mut links = Vec::new();
    for cap in re.captures_iter(content) {
        if let Some(m) = cap.get(1) {
            let title = m.as_str().trim().to_string();
            if !title.is_empty() && seen.insert(title.to_lowercase()) {
                links.push(title);
            }
        }
    }
    links
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

/// Build and dependency directories, skipped so a code repository can be
/// opened as a workspace directly.
///
/// A workspace is just a folder scanned for `.md`, so pointing the app at a
/// project already works — except the scan walks `node_modules/` and
/// `target/` and drowns long before it reaches `docs/`. This list is what
/// makes P7-3's "no importing" true rather than merely technically true.
/// `.git` needs no entry; the dot rule already covers it.
const EXCLUDED_DIRS: [&str; 4] = ["node_modules", "target", "dist", "build"];

/// Sidecar directories, which hold a note's ink, rendered PDF pages and
/// pasted images. They travel with the notes (see the storage boundary) but
/// they are not folders the user made, and listing them in the tree offers a
/// place to file a note that nothing should ever file a note in.
const SIDECAR_SUFFIXES: [&str; 3] = [".ink", ".pdf", ".assets"];

/// The workspace folder templates live in (P6-3). Excluded from the ordinary
/// scan for the same reason as the sidecar suffixes above: a template is
/// authored to be filled in, not a note in its own right, so it has no
/// business showing up in the tree or the search index.
const TEMPLATES_DIR: &str = "templates";

fn is_excluded_dir(name: &str) -> bool {
    name.starts_with('.')
        || SIDECAR_SUFFIXES.iter().any(|suffix| name.ends_with(suffix))
        || EXCLUDED_DIRS.contains(&name)
        || name == TEMPLATES_DIR
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
            let title = match tokio::fs::read_to_string(&path).await {
                Ok(content) => title_from_content(&content),
                Err(_) => path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("Untitled")
                    .to_string(),
            };
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

    Ok(WorkspaceTree {
        notes: indexed,
        folders,
    })
}

#[tauri::command]
pub async fn open_note(path: String) -> Result<String, String> {
    tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| e.to_string())
}

// A note is only ever replaced wholesale, so a partially written file is
// always corruption. Write a sibling temp file, fsync it, then rename over
// the target — the reader sees either the whole old note or the whole new one.
async fn write_atomic(path: &Path, content: &str) -> anyhow::Result<()> {
    let dir = path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("note path has no parent directory: {}", path.display()))?;
    let file_name = path
        .file_name()
        .ok_or_else(|| anyhow::anyhow!("note path has no file name: {}", path.display()))?;
    let tmp = dir.join(format!(
        ".{}.{}.tmp",
        file_name.to_string_lossy(),
        Uuid::new_v4()
    ));

    let write = async {
        let mut file = tokio::fs::File::create(&tmp).await?;
        file.write_all(content.as_bytes()).await?;
        file.sync_all().await?;
        anyhow::Ok(())
    };

    let result = match write.await {
        Ok(()) => tokio::fs::rename(&tmp, path)
            .await
            .map_err(anyhow::Error::from),
        Err(e) => Err(e),
    };
    if result.is_err() {
        let _ = tokio::fs::remove_file(&tmp).await;
    }
    result
}

async fn index_note_at(
    path: &str,
    workspace: &str,
    content: &str,
    db: &DbPool,
) -> anyhow::Result<()> {
    let title = title_from_content(content);
    let meta = NoteMetadata {
        id: Uuid::new_v4().to_string(),
        title: title.clone(),
        path: path.to_string(),
        workspace: workspace.to_string(),
        updated_at: now_ms(),
    };
    db::notes::index_note(db, &meta).await?;
    db::notes::index_note_content(db, path, &title, content).await?;
    db::notes::set_tags(db, path, &extract_tags(content)).await?;
    db::notes::set_links(db, path, &extract_links(content)).await?;
    Ok(())
}

// Deliberately does no database work: typing latency must not depend on
// FTS/tag/link reindexing. The caller drives `reindex_note` separately.
#[tauri::command]
pub async fn save_note(path: String, content: String) -> Result<(), String> {
    write_atomic(Path::new(&path), &content)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn reindex_note(
    path: String,
    workspace: String,
    content: String,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    index_note_at(&path, &workspace, &content, &db)
        .await
        .map_err(|e| e.to_string())
}

// Used when a file changes underneath us: the index follows the disk, and a
// note deleted externally drops out of search, tags and links.
#[tauri::command]
pub async fn reindex_from_disk(
    path: String,
    workspace: String,
    db: State<'_, DbPool>,
) -> Result<bool, String> {
    match tokio::fs::read_to_string(&path).await {
        Ok(content) => index_note_at(&path, &workspace, &content, &db)
            .await
            .map(|()| true)
            .map_err(|e| e.to_string()),
        Err(_) => {
            forget_note(&path, &db).await.map_err(|e| e.to_string())?;
            Ok(false)
        }
    }
}

// Replaces the same heading `title_from_content` would have read the title
// from, preserving its `#` depth. A note with no heading at all (the
// fallback-first-line case) gets one prepended, matching `create_note`'s shape.
fn rewrite_title(content: &str, new_title: &str) -> String {
    let mut replaced = false;
    let mut lines: Vec<String> = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if !replaced && !trimmed.is_empty() && trimmed.starts_with('#') {
            let heading = trimmed.trim_start_matches('#').trim();
            if !heading.is_empty() {
                let hashes: String = trimmed.chars().take_while(|c| *c == '#').collect();
                lines.push(format!("{hashes} {new_title}"));
                replaced = true;
                continue;
            }
        }
        lines.push(line.to_string());
    }
    let mut rewritten = lines.join("\n");
    if content.ends_with('\n') {
        rewritten.push('\n');
    }
    if !replaced {
        rewritten = format!("# {new_title}\n\n{rewritten}");
    }
    rewritten
}

// Wiki-links resolve by title case-insensitively (`backlinks_for`), and
// `extract_links` trims whitespace inside the brackets, so the rewrite must
// tolerate both rather than only matching an exact `[[Old]]`.
fn rewrite_links(content: &str, old_title: &str, new_title: &str) -> anyhow::Result<String> {
    let pattern = format!(r"(?i)\[\[\s*{}\s*\]\]", regex::escape(old_title));
    let re = Regex::new(&pattern)?;
    Ok(re
        .replace_all(content, |_: &regex::Captures| format!("[[{new_title}]]"))
        .into_owned())
}

async fn rename_note_at(
    path: &str,
    new_title: &str,
    workspace: &str,
    db: &DbPool,
) -> anyhow::Result<NoteMetadata> {
    let old_content = tokio::fs::read_to_string(path).await?;
    let old_title = title_from_content(&old_content);

    let mut new_content = rewrite_title(&old_content, new_title);
    if old_title != new_title {
        new_content = rewrite_links(&new_content, &old_title, new_title)?;
    }
    write_atomic(Path::new(path), &new_content).await?;
    index_note_at(path, workspace, &new_content, db).await?;

    if old_title != new_title {
        for backlinker in db::notes::backlinks_for(db, workspace, &old_title).await? {
            if backlinker.path == path {
                continue;
            }
            let content = tokio::fs::read_to_string(&backlinker.path).await?;
            let rewritten = rewrite_links(&content, &old_title, new_title)?;
            if rewritten != content {
                write_atomic(Path::new(&backlinker.path), &rewritten).await?;
                index_note_at(&backlinker.path, workspace, &rewritten, db).await?;
            }
        }
    }

    Ok(NoteMetadata {
        id: Uuid::new_v4().to_string(),
        title: new_title.to_string(),
        path: path.to_string(),
        workspace: workspace.to_string(),
        updated_at: now_ms(),
    })
}

#[tauri::command]
pub async fn rename_note(
    path: String,
    new_title: String,
    workspace: String,
    db: State<'_, DbPool>,
) -> Result<NoteMetadata, String> {
    rename_note_at(&path, &new_title, &workspace, &db)
        .await
        .map_err(|e| e.to_string())
}

async fn forget_note(path: &str, db: &DbPool) -> anyhow::Result<()> {
    db::notes::remove_note(db, path).await?;
    db::notes::remove_from_fts(db, path).await?;
    db::notes::set_tags(db, path, &[]).await?;
    db::notes::set_links(db, path, &[]).await?;
    Ok(())
}

#[tauri::command]
pub async fn create_note(
    workspace: String,
    folder: String,
    title: String,
    db: State<'_, DbPool>,
) -> Result<NoteMetadata, String> {
    let path = create_note_file(&folder, &title)
        .await
        .map_err(|e| e.to_string())?;
    let body = format!("# {}\n", title);

    let meta = NoteMetadata {
        id: Uuid::new_v4().to_string(),
        title: title.clone(),
        path: path.to_string_lossy().into_owned(),
        workspace,
        updated_at: now_ms(),
    };
    index_note_at(&meta.path, &meta.workspace, &body, &db)
        .await
        .map_err(|e| e.to_string())?;

    Ok(meta)
}

#[tauri::command]
pub async fn delete_note(path: String, db: State<'_, DbPool>) -> Result<(), String> {
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
        .map_err(|e| e.to_string())?;

    db::notes::set_tags(&db, &path, &[])
        .await
        .map_err(|e| e.to_string())?;

    db::notes::set_links(&db, &path, &[])
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn search_notes(
    workspace: String,
    query: String,
    folder: Option<String>,
    tag: Option<String>,
    block_type: Option<String>,
    db: State<'_, DbPool>,
) -> Result<Vec<SearchResult>, String> {
    let trimmed = query.trim();
    let fts_query = if trimmed.is_empty() {
        None
    } else {
        Some(
            trimmed
                .split_whitespace()
                .map(|w| format!("\"{}\"*", w.replace('"', "")))
                .collect::<Vec<_>>()
                .join(" "),
        )
    };

    // A bare `folder:` or `tag:` with no free text is a real, useful search
    // ("everything in this folder") — only truly empty input short-circuits.
    if fts_query.is_none() && folder.is_none() && tag.is_none() && block_type.is_none() {
        return Ok(vec![]);
    }

    db::notes::search_notes(
        &db,
        &workspace,
        fts_query.as_deref(),
        folder.as_deref(),
        tag.as_deref(),
        block_type.as_deref(),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_tags(workspace: String, db: State<'_, DbPool>) -> Result<Vec<String>, String> {
    db::notes::list_tags(&db, &workspace)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn notes_with_tag(
    workspace: String,
    tag: String,
    db: State<'_, DbPool>,
) -> Result<Vec<NoteMetadata>, String> {
    db::notes::notes_with_tag(&db, &workspace, &tag)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn backlinks_for(
    workspace: String,
    title: String,
    db: State<'_, DbPool>,
) -> Result<Vec<NoteMetadata>, String> {
    db::notes::backlinks_for(&db, &workspace, &title)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn graph_links(
    workspace: String,
    db: State<'_, DbPool>,
) -> Result<Vec<GraphLink>, String> {
    let rows = db::notes::all_links(&db, &workspace)
        .await
        .map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|(source_path, target_title)| GraphLink {
            source_path,
            target_title,
        })
        .collect())
}

#[tauri::command]
pub async fn graph_tags(workspace: String, db: State<'_, DbPool>) -> Result<Vec<GraphTag>, String> {
    let rows = db::notes::all_note_tags(&db, &workspace)
        .await
        .map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|(note_path, tag)| GraphTag { note_path, tag })
        .collect())
}

fn note_filename(title: &str) -> String {
    let safe_name: String = title
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == ' ' {
                c
            } else {
                '-'
            }
        })
        .collect();
    format!("{}.md", safe_name.trim())
}

// Filenames are derived from titles, so two different notes can want the same
// one. Creating over an existing file would silently destroy it, so refuse and
// let the caller report the collision.
async fn create_note_file(folder: &str, title: &str) -> anyhow::Result<PathBuf> {
    let filename = note_filename(title);
    let path = Path::new(folder).join(&filename);
    if tokio::fs::try_exists(&path).await? {
        anyhow::bail!("a note named \"{filename}\" already exists here");
    }
    write_atomic(&path, &format!("# {title}\n")).await?;
    Ok(path)
}

/// The starter notes a project workspace gets, on request.
///
/// Named in `docs/ROADMAP.md` §P7-3. Deliberately four and no more: the point
/// is somewhere obvious to put the first note about a project, not a filing
/// system nobody asked for.
const PROJECT_NOTE_TITLES: [&str; 4] = ["Architecture", "Meeting", "Research", "Todo"];

/// The folder project notes are scaffolded into. Everything this writes goes
/// inside it — a code repository's own source directories are not somewhere
/// the app gets to create files.
const PROJECT_NOTES_DIR: &str = "notes";

/// Creates `notes/` and its starter notes under `workspace`, returning the
/// paths actually created.
///
/// Never overwrites: a title whose file already exists is skipped rather than
/// replaced, so running this on a repo that already has `notes/Todo.md` tops
/// up the missing three and leaves the real one alone. Nothing here runs
/// unless the user asks for it — see the roadmap's "on request only".
async fn scaffold_project_notes_at(
    workspace: &str,
) -> anyhow::Result<Vec<(&'static str, PathBuf)>> {
    let folder = Path::new(workspace).join(PROJECT_NOTES_DIR);
    tokio::fs::create_dir_all(&folder).await?;
    let folder = folder.to_string_lossy().into_owned();

    let mut created = Vec::new();
    for title in PROJECT_NOTE_TITLES {
        let path = Path::new(&folder).join(note_filename(title));
        if tokio::fs::try_exists(&path).await? {
            continue;
        }
        created.push((title, create_note_file(&folder, title).await?));
    }
    Ok(created)
}

/// Rewrites a note into `## Task N` / `### Solution` pairs, on request.
///
/// Deliberately takes and returns Markdown rather than a note path: the caller
/// is the open editor, whose buffer may hold edits that have not reached disk
/// yet, and rewriting the file underneath it would fight the save path.
#[tauri::command]
pub fn split_into_tasks(markdown: String) -> String {
    crate::exercises::split_into_tasks(&markdown)
}

#[tauri::command]
pub async fn scaffold_project_notes(
    workspace: String,
    db: State<'_, DbPool>,
) -> Result<Vec<NoteMetadata>, String> {
    let paths = scaffold_project_notes_at(&workspace)
        .await
        .map_err(|e| e.to_string())?;

    let mut created = Vec::new();
    for (title, path) in paths {
        let path = path.to_string_lossy().into_owned();
        let body = format!("# {title}\n");
        index_note_at(&path, &workspace, &body, &db)
            .await
            .map_err(|e| e.to_string())?;
        created.push(NoteMetadata {
            id: Uuid::new_v4().to_string(),
            title: title.to_string(),
            path,
            workspace: workspace.clone(),
            updated_at: now_ms(),
        });
    }
    Ok(created)
}

/// P6-3's required first template: P4-3's own Task/Solution layout, so the
/// feature ships with something usable in `templates/` rather than an empty
/// folder and a promise. `{{course}}`/`{{sheet}}` are literal find-and-replace
/// placeholders — no substitution engine beyond that, per the DoD.
const EXERCISE_SHEET_TEMPLATE: &str = "# {{course}} — {{sheet}}\n\n## Task 1\n\n### Solution\n\n\n## Task 2\n\n### Solution\n\n\n## Task 3\n\n### Solution\n";

const DEFAULT_TEMPLATES: [(&str, &str); 1] = [("Exercise Sheet", EXERCISE_SHEET_TEMPLATE)];

fn template_metadata(name: &str, path: &Path) -> crate::models::TemplateMetadata {
    crate::models::TemplateMetadata {
        name: name.to_string(),
        path: path.to_string_lossy().into_owned(),
    }
}

/// Lists the `.md` files directly under `templates/`, flat — no recursion,
/// no logic. A missing folder is an empty list, not an error: nothing has
/// asked for the folder to exist yet.
async fn list_templates_at(
    workspace: &str,
) -> anyhow::Result<Vec<crate::models::TemplateMetadata>> {
    let dir = Path::new(workspace).join(TEMPLATES_DIR);
    let mut entries = match tokio::fs::read_dir(&dir).await {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.into()),
    };

    let mut templates = Vec::new();
    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        let name = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Untitled")
            .to_string();
        templates.push(template_metadata(&name, &path));
    }
    templates.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(templates)
}

/// Seeds `templates/` with whichever starter templates aren't already there.
/// Never overwrites — same "top up, don't replace" rule as
/// `scaffold_project_notes_at` — and runs only when the empty-state button
/// asks for it, never on workspace open.
async fn seed_default_templates_at(
    workspace: &str,
) -> anyhow::Result<Vec<crate::models::TemplateMetadata>> {
    let dir = Path::new(workspace).join(TEMPLATES_DIR);
    tokio::fs::create_dir_all(&dir).await?;

    let mut created = Vec::new();
    for (name, content) in DEFAULT_TEMPLATES {
        let path = dir.join(note_filename(name));
        if tokio::fs::try_exists(&path).await? {
            continue;
        }
        write_atomic(&path, content).await?;
        created.push(template_metadata(name, &path));
    }
    Ok(created)
}

// Same collision rule as `create_note_file`: refuse rather than silently
// destroy an existing note. The only difference is the body comes from the
// caller (a filled-in template) instead of a synthesized `# {title}` heading.
async fn create_note_file_with_content(
    folder: &str,
    title: &str,
    content: &str,
) -> anyhow::Result<PathBuf> {
    let filename = note_filename(title);
    let path = Path::new(folder).join(&filename);
    if tokio::fs::try_exists(&path).await? {
        anyhow::bail!("a note named \"{filename}\" already exists here");
    }
    write_atomic(&path, content).await?;
    Ok(path)
}

#[tauri::command]
pub async fn list_templates(
    workspace: String,
) -> Result<Vec<crate::models::TemplateMetadata>, String> {
    list_templates_at(&workspace)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn read_template(path: String) -> Result<String, String> {
    tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn seed_default_templates(
    workspace: String,
) -> Result<Vec<crate::models::TemplateMetadata>, String> {
    seed_default_templates_at(&workspace)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_note_from_template(
    workspace: String,
    folder: String,
    title: String,
    content: String,
    db: State<'_, DbPool>,
) -> Result<NoteMetadata, String> {
    let path = create_note_file_with_content(&folder, &title, &content)
        .await
        .map_err(|e| e.to_string())?;

    let meta = NoteMetadata {
        id: Uuid::new_v4().to_string(),
        title: title.clone(),
        path: path.to_string_lossy().into_owned(),
        workspace,
        updated_at: now_ms(),
    };
    index_note_at(&meta.path, &meta.workspace, &content, &db)
        .await
        .map_err(|e| e.to_string())?;

    Ok(meta)
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
        let new_ink_dir = new_path
            .to_string_lossy()
            .trim_end_matches(".md")
            .to_string()
            + ".ink";
        tokio::fs::rename(&ink_dir, &new_ink_dir).await?;
    }

    let new_path_str = new_path.to_string_lossy().into_owned();
    db::notes::update_path(db, path, &new_path_str).await?;
    Ok(new_path_str)
}

#[tauri::command]
pub async fn create_folder(parent: String, name: String) -> Result<String, String> {
    create_folder_at(&parent, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rename_folder(
    old_path: String,
    new_path: String,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    rename_folder_at(&old_path, &new_path, &db)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_folder(path: String, db: State<'_, DbPool>) -> Result<(), String> {
    delete_folder_at(&path, &db)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn move_note(
    path: String,
    dest_folder: String,
    db: State<'_, DbPool>,
) -> Result<String, String> {
    move_note_at(&path, &dest_folder, &db)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    // P7-3a. Opening a code repo as a workspace already worked; the scan just
    // drowned in node_modules and target before reaching docs/.
    #[test]
    fn test_build_and_dependency_dirs_are_not_scanned() {
        for name in ["node_modules", "target", "dist", "build"] {
            assert!(is_excluded_dir(name), "{name} should be skipped");
        }
    }

    // Sidecars hold a note's own ink, PDF pages and images. Listing them in
    // the tree offers a folder to file notes into that nothing should.
    #[test]
    fn test_sidecar_dirs_are_not_scanned() {
        for name in ["Lecture 7.ink", "Lecture 7.pdf", "Lecture 7.assets"] {
            assert!(is_excluded_dir(name), "{name} should be skipped");
        }
    }

    #[test]
    fn test_dotfiles_are_still_skipped_and_ordinary_folders_are_not() {
        assert!(is_excluded_dir(".git"));
        assert!(!is_excluded_dir("Analysis 2"));
        // Only an exact match: a course folder named after a build directory
        // is a stretch, but "Distributed Systems" abbreviated is not.
        assert!(!is_excluded_dir("distributed"));
        assert!(!is_excluded_dir("building-compilers"));
    }

    #[test]
    fn test_title_from_content_heading() {
        assert_eq!(
            title_from_content("# Hello World\nsome text"),
            "Hello World"
        );
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
    fn test_title_from_content_bare_hash_heading_falls_back_to_next_line() {
        assert_eq!(title_from_content("#\nbody text"), "body text");
    }

    #[test]
    fn test_title_from_content_only_bare_hash() {
        assert_eq!(title_from_content("#\n\n"), "Untitled");
    }

    #[test]
    fn test_title_from_content_leading_blank_lines() {
        assert_eq!(title_from_content("\n\n# Deep\n"), "Deep");
    }

    #[test]
    fn test_title_from_content_skips_blockquote_intro_for_later_heading() {
        let content = "> **A Markdown-first note-taking application designed specifically for computer science students. It provides the best environment for writing mathematical and programming notes while integrating naturally with existing development workflows rather than replacing the IDE.**\n\n---\n\n## What the app should do\n\n### Best-in-class Markdown editing\n";
        assert_eq!(title_from_content(content), "What the app should do");
    }

    #[test]
    fn test_title_from_content_truncates_long_non_heading_line() {
        let long_line = "a".repeat(120);
        let expected: String = "a".repeat(60);
        assert_eq!(title_from_content(&long_line), format!("{expected}…"));
    }

    #[test]
    fn test_extract_tags_finds_inline_hashtags() {
        let tags = extract_tags("Notes on #recursion and #dynamic-programming today.");
        assert_eq!(tags, vec!["recursion", "dynamic-programming"]);
    }

    #[test]
    fn test_extract_tags_ignores_atx_headings() {
        let tags = extract_tags("# Heading One\n## Heading Two\nSome #realtag here.");
        assert_eq!(tags, vec!["realtag"]);
    }

    #[test]
    fn test_extract_tags_ignores_fenced_code() {
        let content = "See #important below.\n```c\n#include <stdio.h>\n#define MAX 10\n```\nDone.";
        let tags = extract_tags(content);
        assert_eq!(tags, vec!["important"]);
    }

    #[test]
    fn test_extract_tags_ignores_inline_code() {
        let tags = extract_tags("Use `#define` for macros, but #cpreprocessor is a real tag.");
        assert_eq!(tags, vec!["cpreprocessor"]);
    }

    #[test]
    fn test_extract_tags_deduplicates_case_insensitively() {
        let tags = extract_tags("#CS101 material. Revisit #cs101 before the exam. #cs101");
        assert_eq!(tags, vec!["CS101"]);
    }

    #[test]
    fn test_extract_tags_ignores_hash_mid_word() {
        let tags = extract_tags("issue#42 is not a tag, but #issue42 is.");
        assert_eq!(tags, vec!["issue42"]);
    }

    #[test]
    fn test_extract_tags_empty_content() {
        assert!(extract_tags("").is_empty());
    }

    #[test]
    fn test_extract_links_finds_wiki_links() {
        let links = extract_links("See [[Big O Notation]] and [[Sorting Algorithms]].");
        assert_eq!(links, vec!["Big O Notation", "Sorting Algorithms"]);
    }

    #[test]
    fn test_extract_links_deduplicates_case_insensitively() {
        let links = extract_links("[[Big O Notation]] again: [[big o notation]]");
        assert_eq!(links, vec!["Big O Notation"]);
    }

    #[test]
    fn test_extract_links_empty_content() {
        assert!(extract_links("").is_empty());
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
    async fn test_scan_dir_recursive_uses_content_title_not_filename() {
        let tmp = tempdir().unwrap();
        let root = tmp.path();
        std::fs::write(root.join("lecture-1-notes.md"), "# Lecture 1 Notes\nbody").unwrap();

        let ws = root.to_string_lossy().into_owned();
        let (notes, _) = scan_dir_recursive(root, &ws).await.unwrap();

        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].title, "Lecture 1 Notes");
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
mod save_tests {
    use super::*;
    use crate::db::schema::run_migrations;
    use tempfile::tempdir;

    fn temp_files_in(dir: &Path) -> Vec<String> {
        std::fs::read_dir(dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|name| name.ends_with(".tmp"))
            .collect()
    }

    #[tokio::test]
    async fn test_write_atomic_replaces_existing_content() {
        let tmp = tempdir().unwrap();
        let target = tmp.path().join("note.md");
        std::fs::write(&target, "# Old\nold body").unwrap();

        write_atomic(&target, "# New\nnew body").await.unwrap();

        assert_eq!(std::fs::read_to_string(&target).unwrap(), "# New\nnew body");
        assert!(temp_files_in(tmp.path()).is_empty());
    }

    #[tokio::test]
    async fn test_write_atomic_creates_missing_file() {
        let tmp = tempdir().unwrap();
        let target = tmp.path().join("fresh.md");

        write_atomic(&target, "# Fresh").await.unwrap();

        assert_eq!(std::fs::read_to_string(&target).unwrap(), "# Fresh");
        assert!(temp_files_in(tmp.path()).is_empty());
    }

    // The whole point of the temp-then-rename dance: a failed write must never
    // leave the target truncated, and must not litter the folder with temps.
    #[tokio::test]
    async fn test_write_atomic_failure_leaves_target_and_folder_clean() {
        let tmp = tempdir().unwrap();
        let target = tmp.path().join("blocked.md");
        std::fs::create_dir(&target).unwrap();

        let result = write_atomic(&target, "# Should not land").await;

        assert!(result.is_err());
        assert!(target.is_dir());
        assert!(temp_files_in(tmp.path()).is_empty());
    }

    #[tokio::test]
    async fn test_create_note_file_seeds_a_heading() {
        let tmp = tempdir().unwrap();

        let path = create_note_file(&tmp.path().to_string_lossy(), "Missing")
            .await
            .unwrap();

        assert_eq!(path, tmp.path().join("Missing.md"));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "# Missing\n");
    }

    #[tokio::test]
    async fn test_create_note_file_replaces_path_characters_in_the_filename() {
        let tmp = tempdir().unwrap();

        let path = create_note_file(&tmp.path().to_string_lossy(), "CS/101: Week 1")
            .await
            .unwrap();

        assert_eq!(path, tmp.path().join("CS-101- Week 1.md"));
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "# CS/101: Week 1\n"
        );
    }

    // Clicking an unresolved [[link]] creates a note from a title alone, so a
    // collision must fail loudly rather than overwrite whatever holds the name.
    #[tokio::test]
    async fn test_create_note_file_refuses_to_overwrite_an_existing_note() {
        let tmp = tempdir().unwrap();
        let existing = tmp.path().join("Missing.md");
        std::fs::write(&existing, "# Something else\nreal content").unwrap();

        let result = create_note_file(&tmp.path().to_string_lossy(), "Missing").await;

        assert!(result.is_err());
        assert_eq!(
            std::fs::read_to_string(&existing).unwrap(),
            "# Something else\nreal content"
        );
    }

    #[tokio::test]
    async fn test_index_note_at_makes_content_searchable() {
        let pool = DbPool::connect("sqlite::memory:").await.unwrap();
        run_migrations(&pool).await.unwrap();

        index_note_at(
            "/ws/dijkstra.md",
            "/ws",
            "# Dijkstra\nShortest paths with #graphs and [[Big O Notation]].",
            &pool,
        )
        .await
        .unwrap();

        let hits = db::notes::search_notes(&pool, "/ws", Some("\"shortest\"*"), None, None, None)
            .await
            .unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].title, "Dijkstra");

        let tagged = db::notes::notes_with_tag(&pool, "/ws", "graphs")
            .await
            .unwrap();
        assert_eq!(tagged.len(), 1);

        let backlinks = db::notes::backlinks_for(&pool, "/ws", "Big O Notation")
            .await
            .unwrap();
        assert_eq!(backlinks.len(), 1);
    }

    #[test]
    fn test_rewrite_title_replaces_the_first_heading_and_keeps_its_depth() {
        let content = "intro line\n## Old Title\nbody text\n## Old Title again\n";
        assert_eq!(
            rewrite_title(content, "New Title"),
            "intro line\n## New Title\nbody text\n## Old Title again\n"
        );
    }

    #[test]
    fn test_rewrite_title_prepends_a_heading_when_none_exists() {
        assert_eq!(
            rewrite_title("just a line of text", "New Title"),
            "# New Title\n\njust a line of text"
        );
    }

    #[test]
    fn test_rewrite_links_matches_case_insensitively_and_tolerates_inner_whitespace() {
        let content = "See [[big o notation]] and [[ Big O Notation ]] again.";
        assert_eq!(
            rewrite_links(content, "Big O Notation", "Asymptotic Notation").unwrap(),
            "See [[Asymptotic Notation]] and [[Asymptotic Notation]] again."
        );
    }

    #[test]
    fn test_rewrite_links_leaves_a_different_title_untouched() {
        let content = "See [[Dijkstra]].";
        assert_eq!(
            rewrite_links(content, "Big O Notation", "Asymptotic Notation").unwrap(),
            content
        );
    }

    #[tokio::test]
    async fn test_rename_note_at_rewrites_inbound_links_and_reindexes_both_notes() {
        let tmp = tempdir().unwrap();
        let ws = tmp.path().to_string_lossy().into_owned();
        let target = tmp.path().join("target.md");
        let source = tmp.path().join("source.md");
        std::fs::write(&target, "# Big O Notation\nWhat it means.\n").unwrap();
        std::fs::write(&source, "# Source\nSee [[Big O Notation]] for details.\n").unwrap();

        let pool = DbPool::connect("sqlite::memory:").await.unwrap();
        run_migrations(&pool).await.unwrap();
        index_note_at(
            &target.to_string_lossy(),
            &ws,
            "# Big O Notation\nWhat it means.\n",
            &pool,
        )
        .await
        .unwrap();
        index_note_at(
            &source.to_string_lossy(),
            &ws,
            "# Source\nSee [[Big O Notation]] for details.\n",
            &pool,
        )
        .await
        .unwrap();

        let meta = rename_note_at(&target.to_string_lossy(), "Asymptotic Notation", &ws, &pool)
            .await
            .unwrap();

        assert_eq!(meta.title, "Asymptotic Notation");
        assert_eq!(
            std::fs::read_to_string(&target).unwrap(),
            "# Asymptotic Notation\nWhat it means.\n"
        );
        assert_eq!(
            std::fs::read_to_string(&source).unwrap(),
            "# Source\nSee [[Asymptotic Notation]] for details.\n"
        );

        let old_backlinks = db::notes::backlinks_for(&pool, &ws, "Big O Notation")
            .await
            .unwrap();
        assert!(old_backlinks.is_empty());
        let new_backlinks = db::notes::backlinks_for(&pool, &ws, "Asymptotic Notation")
            .await
            .unwrap();
        assert_eq!(new_backlinks.len(), 1);
        assert_eq!(new_backlinks[0].path, source.to_string_lossy());
    }

    #[tokio::test]
    async fn test_rename_note_at_leaves_an_unrelated_note_untouched() {
        let tmp = tempdir().unwrap();
        let ws = tmp.path().to_string_lossy().into_owned();
        let target = tmp.path().join("target.md");
        let other = tmp.path().join("other.md");
        std::fs::write(&target, "# Old Title\nbody\n").unwrap();
        std::fs::write(&other, "# Other\nSee [[Something Else]].\n").unwrap();

        let pool = DbPool::connect("sqlite::memory:").await.unwrap();
        run_migrations(&pool).await.unwrap();
        index_note_at(&target.to_string_lossy(), &ws, "# Old Title\nbody\n", &pool)
            .await
            .unwrap();
        index_note_at(
            &other.to_string_lossy(),
            &ws,
            "# Other\nSee [[Something Else]].\n",
            &pool,
        )
        .await
        .unwrap();

        rename_note_at(&target.to_string_lossy(), "New Title", &ws, &pool)
            .await
            .unwrap();

        assert_eq!(
            std::fs::read_to_string(&other).unwrap(),
            "# Other\nSee [[Something Else]].\n"
        );
    }
}

#[cfg(test)]
mod folder_tests {
    use super::*;
    use crate::db::notes::index_note as db_index_note;
    use crate::db::schema::run_migrations;
    use tempfile::tempdir;

    async fn make_pool() -> DbPool {
        let pool = DbPool::connect("sqlite::memory:").await.unwrap();
        run_migrations(&pool).await.unwrap();
        pool
    }

    // P7-3. Opt-in only: nothing calls this without the user asking.
    #[tokio::test]
    async fn test_scaffold_creates_the_four_starter_notes_inside_notes() {
        let tmp = tempdir().unwrap();
        let workspace = tmp.path().to_string_lossy().into_owned();

        let created = scaffold_project_notes_at(&workspace).await.unwrap();

        assert_eq!(created.len(), 4);
        for (title, path) in &created {
            assert!(path.is_file(), "{title} was not written");
            assert_eq!(path.parent().unwrap(), tmp.path().join("notes"));
        }
    }

    // The guarantee that matters in a code repository: this writes into
    // notes/ and nowhere else, whatever else the workspace contains.
    #[tokio::test]
    async fn test_scaffold_touches_nothing_outside_the_notes_folder() {
        let tmp = tempdir().unwrap();
        let src = tmp.path().join("src");
        tokio::fs::create_dir(&src).await.unwrap();
        tokio::fs::write(src.join("main.rs"), "fn main() {}")
            .await
            .unwrap();
        let before = tokio::fs::read_to_string(src.join("main.rs"))
            .await
            .unwrap();

        scaffold_project_notes_at(&tmp.path().to_string_lossy())
            .await
            .unwrap();

        let mut entries = tokio::fs::read_dir(&src).await.unwrap();
        let mut names = Vec::new();
        while let Some(entry) = entries.next_entry().await.unwrap() {
            names.push(entry.file_name().to_string_lossy().into_owned());
        }
        assert_eq!(names, ["main.rs"], "source folder gained files");
        assert_eq!(
            tokio::fs::read_to_string(src.join("main.rs"))
                .await
                .unwrap(),
            before
        );
    }

    // A repo that already keeps notes/Todo.md gets the missing three and keeps
    // the real one. Overwriting a genuine note would be the worst possible
    // behaviour for a convenience command.
    #[tokio::test]
    async fn test_scaffold_tops_up_without_overwriting_an_existing_note() {
        let tmp = tempdir().unwrap();
        let notes = tmp.path().join("notes");
        tokio::fs::create_dir(&notes).await.unwrap();
        tokio::fs::write(notes.join("Todo.md"), "# Todo\n\n- real work\n")
            .await
            .unwrap();

        let created = scaffold_project_notes_at(&tmp.path().to_string_lossy())
            .await
            .unwrap();

        assert_eq!(created.len(), 3, "Todo was rewritten");
        assert_eq!(
            tokio::fs::read_to_string(notes.join("Todo.md"))
                .await
                .unwrap(),
            "# Todo\n\n- real work\n"
        );
    }

    #[tokio::test]
    async fn test_scaffold_run_twice_creates_nothing_the_second_time() {
        let tmp = tempdir().unwrap();
        let workspace = tmp.path().to_string_lossy().into_owned();

        scaffold_project_notes_at(&workspace).await.unwrap();
        let again = scaffold_project_notes_at(&workspace).await.unwrap();

        assert!(again.is_empty());
    }

    #[tokio::test]
    async fn test_list_templates_at_missing_folder_is_an_empty_list_not_an_error() {
        let tmp = tempdir().unwrap();
        let templates = list_templates_at(&tmp.path().to_string_lossy())
            .await
            .unwrap();
        assert!(templates.is_empty());
    }

    #[tokio::test]
    async fn test_list_templates_at_lists_only_markdown_files() {
        let tmp = tempdir().unwrap();
        let dir = tmp.path().join("templates");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("Exercise Sheet.md"), "# {{course}}").unwrap();
        std::fs::write(dir.join("notes.txt"), "not a template").unwrap();

        let templates = list_templates_at(&tmp.path().to_string_lossy())
            .await
            .unwrap();

        assert_eq!(templates.len(), 1);
        assert_eq!(templates[0].name, "Exercise Sheet");
    }

    #[tokio::test]
    async fn test_seed_default_templates_at_writes_the_exercise_sheet_template() {
        let tmp = tempdir().unwrap();
        let workspace = tmp.path().to_string_lossy().into_owned();

        let created = seed_default_templates_at(&workspace).await.unwrap();

        assert_eq!(created.len(), 1);
        assert_eq!(created[0].name, "Exercise Sheet");
        let content =
            std::fs::read_to_string(tmp.path().join("templates/Exercise Sheet.md")).unwrap();
        assert!(content.contains("{{course}}"));
        assert!(content.contains("## Task 1"));
    }

    // Mirrors the scaffold-notes "top up, don't replace" guarantee: a template
    // the user has since edited must survive re-running the seed command.
    #[tokio::test]
    async fn test_seed_default_templates_at_never_overwrites_an_edited_template() {
        let tmp = tempdir().unwrap();
        let workspace = tmp.path().to_string_lossy().into_owned();
        seed_default_templates_at(&workspace).await.unwrap();
        let path = tmp.path().join("templates/Exercise Sheet.md");
        std::fs::write(&path, "# my own edits").unwrap();

        let created = seed_default_templates_at(&workspace).await.unwrap();

        assert!(created.is_empty());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "# my own edits");
    }

    #[tokio::test]
    async fn test_create_note_file_with_content_writes_the_given_content_verbatim() {
        let tmp = tempdir().unwrap();

        let path = create_note_file_with_content(
            &tmp.path().to_string_lossy(),
            "Blatt 4",
            "# Analysis — Blatt 4\n\n## Task 1\n",
        )
        .await
        .unwrap();

        assert_eq!(path, tmp.path().join("Blatt 4.md"));
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "# Analysis — Blatt 4\n\n## Task 1\n"
        );
    }

    #[tokio::test]
    async fn test_create_note_file_with_content_refuses_to_overwrite_an_existing_note() {
        let tmp = tempdir().unwrap();
        std::fs::write(tmp.path().join("Blatt 4.md"), "# real work").unwrap();

        let result =
            create_note_file_with_content(&tmp.path().to_string_lossy(), "Blatt 4", "# new").await;

        assert!(result.is_err());
        assert_eq!(
            std::fs::read_to_string(tmp.path().join("Blatt 4.md")).unwrap(),
            "# real work"
        );
    }

    #[test]
    fn test_templates_dir_is_not_scanned_as_notes() {
        assert!(is_excluded_dir("templates"));
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
        db_index_note(
            &pool,
            &NoteMetadata {
                id: "a".into(),
                title: "Note".into(),
                path: old_note_path,
                workspace: root.to_string_lossy().into_owned(),
                updated_at: 1000,
            },
        )
        .await
        .unwrap();

        let new_dir = root.join("New").to_string_lossy().into_owned();
        rename_folder_at(&old_dir.to_string_lossy(), &new_dir, &pool)
            .await
            .unwrap();

        assert!(std::path::Path::new(&new_dir).join("note.md").exists());
        let notes = db::notes::list_by_workspace(&pool, &root.to_string_lossy())
            .await
            .unwrap();
        let expected = std::path::Path::new(&new_dir)
            .join("note.md")
            .to_string_lossy()
            .into_owned();
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
        db_index_note(
            &pool,
            &NoteMetadata {
                id: "a".into(),
                title: "Note".into(),
                path: dir.join("note.md").to_string_lossy().into_owned(),
                workspace: root.to_string_lossy().into_owned(),
                updated_at: 1000,
            },
        )
        .await
        .unwrap();

        delete_folder_at(&dir.to_string_lossy(), &pool)
            .await
            .unwrap();

        assert!(!dir.exists());
        let notes = db::notes::list_by_workspace(&pool, &root.to_string_lossy())
            .await
            .unwrap();
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
        db_index_note(
            &pool,
            &NoteMetadata {
                id: "a".into(),
                title: "Note".into(),
                path: old_path.clone(),
                workspace: root.to_string_lossy().into_owned(),
                updated_at: 1000,
            },
        )
        .await
        .unwrap();

        let new_path = move_note_at(&old_path, &dest_dir.to_string_lossy(), &pool)
            .await
            .unwrap();

        assert!(std::path::Path::new(&new_path).exists());
        assert!(dest_dir.join("note.ink").join("sketch-1.svg").exists());
        assert!(!src_dir.join("note.md").exists());
        let notes = db::notes::list_by_workspace(&pool, &root.to_string_lossy())
            .await
            .unwrap();
        assert_eq!(notes[0].path, new_path);
    }
}

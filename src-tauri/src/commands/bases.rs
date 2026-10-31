use super::notes::{
    create_note_file_with_content, index_note_at, now_ms, require_within_workspace, safe_stem,
    split_frontmatter, write_atomic,
};
use crate::db::{self, DbPool};
use crate::models::{BaseRow, NoteMetadata, PropertiesResult, PropertyEdit};
use crate::properties::{
    frontmatter_for, parse_properties, remove_property, rename_property, set_property, Properties,
};
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;
use std::time::UNIX_EPOCH;
use tauri::State;
use uuid::Uuid;

const NEW_BASE: &str = "views:\n  - type: table\n    name: Table\n";

fn millis(time: std::io::Result<std::time::SystemTime>) -> i64 {
    time.ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_millis() as i64)
}

fn file_times(path: &str) -> (i64, i64, u64) {
    match std::fs::metadata(path) {
        Ok(m) => {
            let mtime = millis(m.modified());
            let ctime = match millis(m.created()) {
                0 => mtime,
                created => created,
            };
            (ctime, mtime, m.len())
        }
        Err(_) => (0, 0, 0),
    }
}

pub(super) async fn list_base_rows_at(
    workspace: &str,
    db: &DbPool,
) -> anyhow::Result<Vec<BaseRow>> {
    let notes = db::notes::list_by_workspace(db, workspace).await?;
    let mut props: HashMap<String, (String, Option<String>)> =
        db::properties::all_properties(db, workspace)
            .await?
            .into_iter()
            .map(|(path, json, error)| (path, (json, error)))
            .collect();
    let mut tags: HashMap<String, Vec<String>> = HashMap::new();
    for (path, tag) in db::notes::all_note_tags(db, workspace).await? {
        tags.entry(path).or_default().push(tag);
    }
    let title_of: HashMap<&str, &str> = notes
        .iter()
        .map(|n| (n.path.as_str(), n.title.as_str()))
        .collect();
    let mut paths_by_title: HashMap<String, Vec<&str>> = HashMap::new();
    for note in &notes {
        paths_by_title
            .entry(note.title.to_lowercase())
            .or_default()
            .push(&note.path);
    }
    let mut links: HashMap<String, Vec<String>> = HashMap::new();
    let mut backlinks: HashMap<String, Vec<String>> = HashMap::new();
    for (source, target) in db::notes::all_links(db, workspace).await? {
        if let (Some(targets), Some(source_title)) = (
            paths_by_title.get(&target.to_lowercase()),
            title_of.get(source.as_str()),
        ) {
            for target_path in targets {
                backlinks
                    .entry(target_path.to_string())
                    .or_default()
                    .push(source_title.to_string());
            }
        }
        links.entry(source).or_default().push(target);
    }

    let paths: Vec<String> = notes.iter().map(|n| n.path.clone()).collect();
    let times = tokio::task::spawn_blocking(move || {
        paths.iter().map(|p| file_times(p)).collect::<Vec<_>>()
    })
    .await?;

    Ok(notes
        .into_iter()
        .zip(times)
        .map(|(note, (ctime, mtime, size))| {
            let (json, parse_error) = props.remove(&note.path).unwrap_or_default();
            BaseRow {
                properties: serde_json::from_str(&json)
                    .unwrap_or_else(|_| Value::Object(Properties::new())),
                parse_error,
                ctime,
                mtime,
                size,
                tags: tags.remove(&note.path).unwrap_or_default(),
                links: links.remove(&note.path).unwrap_or_default(),
                backlinks: backlinks.remove(&note.path).unwrap_or_default(),
                title: note.title,
                path: note.path,
            }
        })
        .collect())
}

pub(super) async fn write_note_property_at(
    workspace: &str,
    path: &str,
    key: &str,
    expected: Option<Value>,
    value: Option<Value>,
    db: &DbPool,
) -> Result<(), String> {
    require_within_workspace(workspace, path)?;
    if Path::new(path).extension().and_then(|e| e.to_str()) != Some("md") {
        return Err(format!("not a note: {path}"));
    }
    let content = tokio::fs::read_to_string(path)
        .await
        .map_err(|e| e.to_string())?;
    let props = parse_properties(split_frontmatter(&content).0)?;
    let present = |v: Option<&Value>| v.filter(|v| !v.is_null()).cloned();
    if present(props.get(key)) != present(expected.as_ref()) {
        return Err(format!("STALE: \"{key}\" changed since the view loaded"));
    }
    let updated = match &value {
        Some(v) => set_property(&content, key, v)?,
        None => remove_property(&content, key)?,
    };
    write_atomic(Path::new(path), &updated)
        .await
        .map_err(|e| e.to_string())?;
    index_note_at(path, workspace, &updated, db)
        .await
        .map_err(|e| e.to_string())
}

pub(super) async fn create_note_with_properties_at(
    workspace: &str,
    folder: &str,
    title: &str,
    properties: &Properties,
    db: &DbPool,
) -> Result<NoteMetadata, String> {
    require_within_workspace(workspace, folder)?;
    let content = format!("{}# {title}\n", frontmatter_for(properties));
    let path = create_note_file_with_content(folder, title, &content)
        .await
        .map_err(|e| e.to_string())?;
    let meta = NoteMetadata {
        id: Uuid::new_v4().to_string(),
        title: title.to_string(),
        path: path.to_string_lossy().into_owned(),
        workspace: workspace.to_string(),
        updated_at: now_ms(),
    };
    index_note_at(&meta.path, workspace, &content, db)
        .await
        .map_err(|e| e.to_string())?;
    Ok(meta)
}

#[tauri::command]
pub async fn list_base_rows(
    workspace: String,
    db: State<'_, DbPool>,
) -> Result<Vec<BaseRow>, String> {
    list_base_rows_at(&workspace, &db)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn parse_note_properties(content: String) -> PropertiesResult {
    match parse_properties(split_frontmatter(&content).0) {
        Ok(props) => PropertiesResult {
            properties: Value::Object(props),
            error: None,
        },
        Err(error) => PropertiesResult {
            properties: Value::Object(Properties::new()),
            error: Some(error),
        },
    }
}

#[tauri::command]
pub fn edit_content_property(content: String, edit: PropertyEdit) -> Result<String, String> {
    match edit {
        PropertyEdit::Set { key, value } => set_property(&content, &key, &value),
        PropertyEdit::Remove { key } => remove_property(&content, &key),
        PropertyEdit::Rename { from, to } => rename_property(&content, &from, &to),
    }
}

#[tauri::command]
pub async fn write_note_property(
    workspace: String,
    path: String,
    key: String,
    expected: Option<Value>,
    value: Option<Value>,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    write_note_property_at(&workspace, &path, &key, expected, value, &db).await
}

#[tauri::command]
pub async fn create_note_with_properties(
    workspace: String,
    folder: String,
    title: String,
    properties: Properties,
    db: State<'_, DbPool>,
) -> Result<NoteMetadata, String> {
    create_note_with_properties_at(&workspace, &folder, &title, &properties, &db).await
}

#[tauri::command]
pub async fn create_base(
    workspace: String,
    folder: String,
    name: String,
) -> Result<String, String> {
    require_within_workspace(&workspace, &folder)?;
    let stem = safe_stem(&name);
    if stem.is_empty() {
        return Err("a base needs a name".to_string());
    }
    let path = Path::new(&folder).join(format!("{stem}.base"));
    if tokio::fs::try_exists(&path)
        .await
        .map_err(|e| e.to_string())?
    {
        return Err(format!("a base named \"{stem}\" already exists here"));
    }
    write_atomic(&path, NEW_BASE)
        .await
        .map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::run_migrations;
    use serde_json::json;
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

    const NOTE: &str = "---\n# keep\nstatus: todo\n---\n# A\n";

    fn note_in(dir: &std::path::Path, name: &str, content: &str) -> String {
        let path = dir.join(name);
        std::fs::write(&path, content).unwrap();
        path.to_string_lossy().into_owned()
    }

    #[tokio::test]
    async fn write_note_property_applies_when_expected_matches() {
        let tmp = tempdir().unwrap();
        let ws = tmp.path().to_string_lossy().into_owned();
        let path = note_in(tmp.path(), "a.md", NOTE);
        let pool = make_pool().await;

        write_note_property_at(
            &ws,
            &path,
            "status",
            Some(json!("todo")),
            Some(json!("done")),
            &pool,
        )
        .await
        .unwrap();

        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "---\n# keep\nstatus: done\n---\n# A\n"
        );
        let rows = db::properties::all_properties(&pool, &ws).await.unwrap();
        assert_eq!(rows[0].1, r#"{"status":"done"}"#);
    }

    #[tokio::test]
    async fn write_note_property_refuses_stale_and_leaves_the_file_untouched() {
        let tmp = tempdir().unwrap();
        let ws = tmp.path().to_string_lossy().into_owned();
        let path = note_in(tmp.path(), "a.md", NOTE);
        let pool = make_pool().await;

        let err = write_note_property_at(
            &ws,
            &path,
            "status",
            Some(json!("doing")),
            Some(json!("done")),
            &pool,
        )
        .await
        .unwrap_err();

        assert!(err.starts_with("STALE:"), "{err}");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), NOTE);
        let err = write_note_property_at(&ws, &path, "status", None, Some(json!("x")), &pool)
            .await
            .unwrap_err();
        assert!(err.starts_with("STALE:"), "{err}");
    }

    #[tokio::test]
    async fn write_note_property_adds_and_removes_keys() {
        let tmp = tempdir().unwrap();
        let ws = tmp.path().to_string_lossy().into_owned();
        let path = note_in(tmp.path(), "a.md", NOTE);
        let pool = make_pool().await;

        write_note_property_at(&ws, &path, "due", None, Some(json!("2026-11-01")), &pool)
            .await
            .unwrap();
        write_note_property_at(&ws, &path, "status", Some(json!("todo")), None, &pool)
            .await
            .unwrap();

        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "---\n# keep\ndue: 2026-11-01\n---\n# A\n"
        );
    }

    #[tokio::test]
    async fn write_note_property_refuses_a_path_outside_the_workspace() {
        let tmp = tempdir().unwrap();
        let other = tempdir().unwrap();
        let ws = tmp.path().to_string_lossy().into_owned();
        let path = note_in(other.path(), "a.md", NOTE);
        let pool = make_pool().await;

        let result =
            write_note_property_at(&ws, &path, "status", None, Some(json!("x")), &pool).await;

        assert!(result.is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), NOTE);
    }

    #[tokio::test]
    async fn create_note_with_properties_writes_frontmatter_then_heading() {
        let tmp = tempdir().unwrap();
        let ws = tmp.path().to_string_lossy().into_owned();
        let pool = make_pool().await;
        let mut props = Properties::new();
        props.insert("status".into(), json!("todo"));

        let meta = create_note_with_properties_at(&ws, &ws, "Task", &props, &pool)
            .await
            .unwrap();

        assert_eq!(
            std::fs::read_to_string(&meta.path).unwrap(),
            "---\nstatus: todo\n---\n# Task\n"
        );
        let rows = db::properties::all_properties(&pool, &ws).await.unwrap();
        assert_eq!(rows[0].1, r#"{"status":"todo"}"#);
    }

    #[tokio::test]
    async fn create_base_writes_a_table_view_and_refuses_an_existing_name() {
        let tmp = tempdir().unwrap();
        let ws = tmp.path().to_string_lossy().into_owned();

        let path = create_base(ws.clone(), ws.clone(), "Tasks".into())
            .await
            .unwrap();

        assert!(path.ends_with("Tasks.base"));
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "views:\n  - type: table\n    name: Table\n"
        );
        assert!(create_base(ws.clone(), ws, "Tasks".into()).await.is_err());
    }

    #[tokio::test]
    async fn list_base_rows_merges_tags_and_reports_parse_errors() {
        let tmp = tempdir().unwrap();
        let ws = tmp.path().to_string_lossy().into_owned();
        let a = note_in(
            tmp.path(),
            "A.md",
            "---\ntags: [x]\n---\n# A\nSee #body and [[B]]\n",
        );
        let b = note_in(tmp.path(), "B.md", "---\nbad: [\n---\n# B\n");
        let pool = make_pool().await;
        for path in [&a, &b] {
            let content = std::fs::read_to_string(path).unwrap();
            index_note_at(path, &ws, &content, &pool).await.unwrap();
        }

        let mut rows = list_base_rows_at(&ws, &pool).await.unwrap();
        rows.sort_by(|l, r| l.path.cmp(&r.path));

        let (row_a, row_b) = (&rows[0], &rows[1]);
        assert_eq!(row_a.title, "A");
        let mut tags = row_a.tags.clone();
        tags.sort();
        assert_eq!(tags, vec!["body", "x"]);
        assert_eq!(row_a.links, vec!["B"]);
        assert_eq!(row_a.properties, json!({"tags": ["x"]}));
        assert!(row_a.size > 0 && row_a.mtime > 0);
        assert_eq!(row_b.backlinks, vec!["A"]);
        assert_eq!(row_b.properties, json!({}));
        assert!(row_b.parse_error.is_some());
    }

    #[test]
    fn content_commands_parse_and_edit_without_touching_disk() {
        let parsed = parse_note_properties("---\na: 1\n---\n".into());
        assert_eq!(parsed.properties, json!({"a": 1}));
        assert!(parsed.error.is_none());
        let bad = parse_note_properties("---\na: [\n---\n".into());
        assert!(bad.error.is_some());

        let edited = edit_content_property(
            "---\na: 1\n---\nbody".into(),
            PropertyEdit::Set {
                key: "b".into(),
                value: json!("x"),
            },
        )
        .unwrap();
        assert_eq!(edited, "---\na: 1\nb: x\n---\nbody");
        let renamed = edit_content_property(
            edited,
            PropertyEdit::Rename {
                from: "b".into(),
                to: "c".into(),
            },
        )
        .unwrap();
        let removed =
            edit_content_property(renamed, PropertyEdit::Remove { key: "a".into() }).unwrap();
        assert_eq!(removed, "---\nc: x\n---\nbody");
    }
}

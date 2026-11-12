use crate::models::WorkspaceState;
use std::path::Path;
use tauri::{AppHandle, Manager};

const STATE_FILE: &str = ".workspace.json";
const RECENTS_FILE: &str = "recent-workspaces.json";
const MAX_RECENTS: usize = 8;

pub async fn load_workspace_from_dir(path: &str) -> anyhow::Result<WorkspaceState> {
    let state_path = std::path::Path::new(path).join(STATE_FILE);
    if !state_path.exists() {
        return Ok(WorkspaceState::default());
    }
    let raw = tokio::fs::read_to_string(&state_path).await?;
    Ok(serde_json::from_str(&raw)?)
}

pub async fn save_workspace_to_dir(path: &str, state: &WorkspaceState) -> anyhow::Result<()> {
    let state_path = std::path::Path::new(path).join(STATE_FILE);
    let json = serde_json::to_string_pretty(state)?;
    tokio::fs::write(&state_path, json).await?;
    Ok(())
}

async fn read_recents(dir: &Path) -> anyhow::Result<Vec<String>> {
    let file = dir.join(RECENTS_FILE);
    if !file.exists() {
        return Ok(Vec::new());
    }
    let raw = tokio::fs::read_to_string(&file).await?;
    Ok(serde_json::from_str(&raw)?)
}

// A workspace on an unplugged drive is hidden from the picker but kept in the
// file, so it comes back on its own rather than being forgotten.
pub(crate) async fn present_recents(dir: &Path) -> anyhow::Result<Vec<String>> {
    let mut present = Vec::new();
    for path in read_recents(dir).await? {
        if tokio::fs::try_exists(&path).await.unwrap_or(false) {
            present.push(path);
        }
    }
    Ok(present)
}

async fn push_recent(dir: &Path, workspace: &str) -> anyhow::Result<Vec<String>> {
    let mut recents = read_recents(dir).await?;
    recents.retain(|p| p != workspace);
    recents.insert(0, workspace.to_string());
    recents.truncate(MAX_RECENTS);

    tokio::fs::create_dir_all(dir).await?;
    tokio::fs::write(
        dir.join(RECENTS_FILE),
        serde_json::to_string_pretty(&recents)?,
    )
    .await?;
    Ok(recents)
}

// Only a folder the app itself opened (it is in the recents file) can be
// deleted, so a compromised or buggy caller cannot point this at an arbitrary
// path. Already-gone folders are just forgotten.
async fn delete_recent_workspace(dir: &Path, workspace: &str) -> anyhow::Result<Vec<String>> {
    let recents = read_recents(dir).await?;
    if !recents.iter().any(|p| p == workspace) {
        anyhow::bail!("not a known workspace: {workspace}");
    }
    if Path::new(workspace).parent().is_none() {
        anyhow::bail!("refusing to delete a filesystem root");
    }
    match tokio::fs::remove_dir_all(workspace).await {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.into()),
    }
    let remaining: Vec<String> = recents.into_iter().filter(|p| p != workspace).collect();
    tokio::fs::write(
        dir.join(RECENTS_FILE),
        serde_json::to_string_pretty(&remaining)?,
    )
    .await?;
    Ok(remaining)
}

// A single `--workspace=<path>` token, not a `--workspace <path>` pair: some
// launchers in the E2E toolchain reorder and re-split multi-token argv lists,
// which silently detaches a flag from its value. One token can't be reordered
// relative to anything.
pub fn initial_workspace_from_args<I: IntoIterator<Item = String>>(args: I) -> Option<String> {
    args.into_iter()
        .find_map(|arg| arg.strip_prefix("--workspace=").map(str::to_string))
}

// Set by the `nullnotes` CLI when it has to start the app itself: the window
// stays hidden and the instance quits when idle.
pub fn headless_from_args<I: IntoIterator<Item = String>>(args: I) -> bool {
    args.into_iter().any(|arg| arg == "--headless")
}

// Sibling to `--workspace=`: the Explorer "Open in null-notes" file handler
// (the context-menu-handler COM DLL's Invoke()) sends this for a single
// file, since a lone file isn't a workspace. The caller copies it into a
// temp workspace, then treats that the same as any other `--workspace=`
// launch.
pub fn open_file_from_args<I: IntoIterator<Item = String>>(args: I) -> Option<String> {
    args.into_iter()
        .find_map(|arg| arg.strip_prefix("--open-file=").map(str::to_string))
}

// Pairs with `--workspace=` (not `--open-file=`, which implies "no real
// workspace, copy into a temp one"): a caller that already has a real
// workspace folder open elsewhere — e.g. an IDE — sends both flags together
// to open that folder as-is and land on one file inside it, instead of
// forking off a throwaway copy.
pub fn select_file_from_args<I: IntoIterator<Item = String>>(args: I) -> Option<String> {
    args.into_iter()
        .find_map(|arg| arg.strip_prefix("--select-file=").map(str::to_string))
}

// Creates a fresh temp directory and copies `file_path` into it, so the file
// can be opened through the same `--workspace=` startup path as a folder.
//
// ponytail: temp dirs under `%TEMP%\null-notes` are never cleaned up here —
// the OS reclaims `%TEMP%` on its own schedule. Add explicit GC if stale
// dirs are ever reported as a problem.
pub fn temp_workspace_for_file(file_path: &str) -> std::io::Result<String> {
    let file_path = Path::new(file_path);
    let file_name = file_path
        .file_name()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "no file name"))?;

    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let dir = std::env::temp_dir()
        .join("null-notes")
        .join(nanos.to_string());
    std::fs::create_dir_all(&dir)?;
    std::fs::copy(file_path, dir.join(file_name))?;

    Ok(dir.to_string_lossy().into_owned())
}

pub struct InitialWorkspace(pub Option<String>);

#[tauri::command]
pub fn initial_workspace(state: tauri::State<InitialWorkspace>) -> Option<String> {
    state.0.clone()
}

// A lone `.md` opens in place: its folder is the workspace root (sidecars land
// beside it) but the frontend runs a single-note session over it. Other file
// types keep the temp-copy path.
pub fn single_note_target(file_path: &str) -> Option<(String, String)> {
    let path = Path::new(file_path);
    let is_markdown = path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("md"));
    if !is_markdown || !path.is_file() {
        return None;
    }
    let dir = path.parent()?;
    Some((
        dir.to_string_lossy().into_owned(),
        path.to_string_lossy().into_owned(),
    ))
}

#[derive(Debug)]
pub struct InitialSingleNote(pub bool);

#[tauri::command]
pub fn initial_single_note(state: tauri::State<InitialSingleNote>) -> bool {
    state.0
}

pub struct InitialSelectFile(pub Option<String>);

#[tauri::command]
pub fn initial_select_file(state: tauri::State<InitialSelectFile>) -> Option<String> {
    state.0.clone()
}

#[tauri::command]
pub async fn recent_workspaces(app: AppHandle) -> Result<Vec<String>, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    present_recents(&dir).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn remember_workspace(app: AppHandle, path: String) -> Result<Vec<String>, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    // A window nobody has seen belongs to the CLI, whose workspaces never
    // become "recent".
    #[cfg(windows)]
    if app
        .try_state::<crate::cli_server::state::CliState>()
        .is_some_and(|state| !state.is_shown())
    {
        return present_recents(&dir).await.map_err(|e| e.to_string());
    }
    let recents = push_recent(&dir, &path).await.map_err(|e| e.to_string())?;
    #[cfg(windows)]
    let _ = crate::commands::jumplist::rebuild(&recents);
    Ok(recents)
}

#[tauri::command]
pub async fn delete_workspace(app: AppHandle, path: String) -> Result<Vec<String>, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    delete_recent_workspace(&dir, &path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn load_workspace(path: String) -> Result<WorkspaceState, String> {
    load_workspace_from_dir(&path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_workspace(path: String, state: WorkspaceState) -> Result<(), String> {
    save_workspace_to_dir(&path, &state)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    #[test]
    fn single_note_target_takes_an_existing_md_file_in_place() {
        let dir = tempfile::tempdir().unwrap();
        let note = dir.path().join("Lecture.MD");
        std::fs::write(&note, "x").unwrap();
        let (root, file) = single_note_target(&note.to_string_lossy()).unwrap();
        assert_eq!(root, dir.path().to_string_lossy());
        assert_eq!(file, note.to_string_lossy());
    }

    #[test]
    fn single_note_target_rejects_other_types_and_missing_files() {
        let dir = tempfile::tempdir().unwrap();
        let pdf = dir.path().join("a.pdf");
        std::fs::write(&pdf, "x").unwrap();
        assert!(single_note_target(&pdf.to_string_lossy()).is_none());
        assert!(single_note_target(&dir.path().join("gone.md").to_string_lossy()).is_none());
    }

    #[test]
    fn headless_is_only_the_literal_flag() {
        assert!(headless_from_args(["--headless".to_string()]));
        assert!(!headless_from_args(["--workspace=x".to_string()]));
        assert!(!headless_from_args(["--headless=1".to_string()]));
    }

    use super::*;
    use crate::models::{CanvasViewport, EditorGroupState, EditorLayoutState};
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_load_missing_returns_default() {
        let dir = tempdir().unwrap();
        let state = load_workspace_from_dir(&dir.path().to_string_lossy())
            .await
            .unwrap();
        assert!(state.open_tabs.is_empty());
        assert!(state.active_tab.is_none());
    }

    #[tokio::test]
    async fn test_roundtrip() {
        let dir = tempdir().unwrap();
        let path = dir.path().to_string_lossy().into_owned();
        let original = WorkspaceState {
            open_tabs: vec!["/ws/note.md".into()],
            active_tab: Some("/ws/note.md".into()),
            expanded_folders: vec!["/ws/Course1".into()],
            recent_searches: vec!["theorem 3.2".into(), "tag:graphs".into()],
            ..Default::default()
        };
        save_workspace_to_dir(&path, &original).await.unwrap();
        let loaded = load_workspace_from_dir(&path).await.unwrap();
        assert_eq!(loaded.open_tabs, original.open_tabs);
        assert_eq!(loaded.active_tab, original.active_tab);
        assert_eq!(loaded.expanded_folders, original.expanded_folders);
        assert_eq!(loaded.recent_searches, original.recent_searches);
    }

    #[tokio::test]
    async fn test_push_recent_moves_a_repeat_visit_to_the_front() {
        let dir = tempdir().unwrap();
        push_recent(dir.path(), "/ws/a").await.unwrap();
        push_recent(dir.path(), "/ws/b").await.unwrap();

        let recents = push_recent(dir.path(), "/ws/a").await.unwrap();

        assert_eq!(recents, vec!["/ws/a".to_string(), "/ws/b".to_string()]);
    }

    #[tokio::test]
    async fn test_push_recent_keeps_only_the_most_recent_entries() {
        let dir = tempdir().unwrap();
        for i in 0..MAX_RECENTS + 3 {
            push_recent(dir.path(), &format!("/ws/{i}")).await.unwrap();
        }

        let recents = read_recents(dir.path()).await.unwrap();

        assert_eq!(recents.len(), MAX_RECENTS);
        assert_eq!(recents[0], format!("/ws/{}", MAX_RECENTS + 2));
    }

    #[tokio::test]
    async fn test_present_recents_hides_folders_that_are_gone_without_forgetting_them() {
        let config = tempdir().unwrap();
        let workspace = tempdir().unwrap();
        let live = workspace.path().to_string_lossy().into_owned();
        push_recent(config.path(), "/ws/vanished").await.unwrap();
        push_recent(config.path(), &live).await.unwrap();

        assert_eq!(present_recents(config.path()).await.unwrap(), vec![live]);
        assert_eq!(read_recents(config.path()).await.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn test_delete_removes_a_known_workspace_and_forgets_it() {
        let config = tempdir().unwrap();
        let parent = tempdir().unwrap();
        let ws = parent.path().join("notes");
        std::fs::create_dir_all(ws.join(".git")).unwrap();
        std::fs::write(ws.join("a.md"), "x").unwrap();
        let ws = ws.to_string_lossy().into_owned();
        push_recent(config.path(), &ws).await.unwrap();
        push_recent(config.path(), "/ws/other").await.unwrap();

        let remaining = delete_recent_workspace(config.path(), &ws).await.unwrap();

        assert!(!Path::new(&ws).exists());
        assert_eq!(remaining, vec!["/ws/other".to_string()]);
    }

    #[tokio::test]
    async fn test_delete_refuses_a_path_that_is_not_a_recent_workspace() {
        let config = tempdir().unwrap();
        let stranger = tempdir().unwrap();
        std::fs::write(stranger.path().join("a.md"), "x").unwrap();

        let result =
            delete_recent_workspace(config.path(), &stranger.path().to_string_lossy()).await;

        assert!(result.is_err());
        assert!(stranger.path().join("a.md").exists());
    }

    #[tokio::test]
    async fn test_recents_are_empty_before_any_workspace_is_opened() {
        let dir = tempdir().unwrap();
        assert!(present_recents(dir.path()).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_load_legacy_file_without_expanded_folders() {
        let dir = tempdir().unwrap();
        let state_path = dir.path().join(".workspace.json");
        tokio::fs::write(
            &state_path,
            r#"{"openTabs":["/ws/a.md"],"activeTab":"/ws/a.md"}"#,
        )
        .await
        .unwrap();
        let state = load_workspace_from_dir(&dir.path().to_string_lossy())
            .await
            .unwrap();
        assert_eq!(state.open_tabs, vec!["/ws/a.md".to_string()]);
        assert!(state.expanded_folders.is_empty());
    }

    // A `.workspace.json` written before P5-1 shipped has no `git` key at
    // all. It must still load — with auto-commit off and the one-time
    // prompt still owed — rather than fail the whole workspace open.
    #[tokio::test]
    async fn test_load_legacy_file_without_git_config() {
        let dir = tempdir().unwrap();
        tokio::fs::write(
            dir.path().join(".workspace.json"),
            r#"{"openTabs":[],"activeTab":null}"#,
        )
        .await
        .unwrap();

        let state = load_workspace_from_dir(&dir.path().to_string_lossy())
            .await
            .unwrap();

        assert!(!state.git.prompted);
        assert!(!state.git.auto_commit);
    }

    #[tokio::test]
    async fn test_git_config_roundtrips() {
        use crate::models::GitWorkspaceConfig;

        let dir = tempdir().unwrap();
        let path = dir.path().to_string_lossy().into_owned();
        let original = WorkspaceState {
            git: GitWorkspaceConfig {
                prompted: true,
                auto_commit: true,
                ..Default::default()
            },
            ..Default::default()
        };

        save_workspace_to_dir(&path, &original).await.unwrap();
        let loaded = load_workspace_from_dir(&path).await.unwrap();

        assert!(loaded.git.prompted);
        assert!(loaded.git.auto_commit);
    }

    #[tokio::test]
    async fn test_editor_layout_roundtrips() {
        let dir = tempdir().unwrap();
        let path = dir.path().to_string_lossy().into_owned();
        let original = WorkspaceState {
            layout: Some(EditorLayoutState {
                groups: vec![
                    EditorGroupState {
                        tabs: vec!["/ws/a.md".into(), "/ws/b.md".into()],
                        pinned: vec!["/ws/a.md".into()],
                        active: Some("/ws/b.md".into()),
                        view_mode: "wysiwyg".into(),
                    },
                    EditorGroupState {
                        tabs: vec!["/ws/b.md".into()],
                        pinned: vec![],
                        active: Some("/ws/b.md".into()),
                        view_mode: "raw".into(),
                    },
                ],
                focused: 1,
                direction: "column".into(),
                ratio: 0.35,
            }),
            ..Default::default()
        };

        save_workspace_to_dir(&path, &original).await.unwrap();
        let loaded = load_workspace_from_dir(&path).await.unwrap();

        let layout = loaded.layout.unwrap();
        assert_eq!(layout.groups.len(), 2);
        assert_eq!(layout.groups[1].view_mode, "raw");
        assert_eq!(layout.focused, 1);
        assert_eq!(layout.direction, "column");
        assert_eq!(layout.ratio, 0.35);
    }

    // The pre-groups split (#54) stays readable so the frontend can turn it into
    // a layout, but is never written back out.
    #[tokio::test]
    async fn test_legacy_split_fields_load_but_are_not_rewritten() {
        let dir = tempdir().unwrap();
        tokio::fs::write(
            dir.path().join(".workspace.json"),
            r#"{"openTabs":["/ws/a.md"],"activeTab":"/ws/a.md","secondaryTab":"/ws/b.md","splitRatio":0.4}"#,
        )
        .await
        .unwrap();
        let path = dir.path().to_string_lossy().into_owned();

        let loaded = load_workspace_from_dir(&path).await.unwrap();
        assert_eq!(loaded.secondary_tab.as_deref(), Some("/ws/b.md"));
        assert_eq!(loaded.split_ratio, Some(0.4));

        save_workspace_to_dir(&path, &loaded).await.unwrap();
        let written = tokio::fs::read_to_string(dir.path().join(".workspace.json"))
            .await
            .unwrap();
        assert!(!written.contains("secondaryTab"));
        assert!(!written.contains("splitRatio"));
    }

    // A `.workspace.json` written before split-pane editing shipped has neither
    // key at all. It must still load as single-pane, not fail the whole open.
    #[tokio::test]
    async fn test_load_legacy_file_without_split_pane_fields() {
        let dir = tempdir().unwrap();
        tokio::fs::write(
            dir.path().join(".workspace.json"),
            r#"{"openTabs":[],"activeTab":null}"#,
        )
        .await
        .unwrap();

        let state = load_workspace_from_dir(&dir.path().to_string_lossy())
            .await
            .unwrap();

        assert!(state.secondary_tab.is_none());
        assert!(state.split_ratio.is_none());
        assert!(state.layout.is_none());
    }

    #[tokio::test]
    async fn test_sidebar_state_roundtrips_and_defaults_open() {
        let dir = tempdir().unwrap();
        let path = dir.path().to_string_lossy().into_owned();
        let original = WorkspaceState {
            sidebar_collapsed: true,
            tags_collapsed: true,
            ..Default::default()
        };

        save_workspace_to_dir(&path, &original).await.unwrap();
        let loaded = load_workspace_from_dir(&path).await.unwrap();
        assert!(loaded.sidebar_collapsed);
        assert!(loaded.tags_collapsed);

        tokio::fs::write(
            dir.path().join(".workspace.json"),
            r#"{"openTabs":[],"activeTab":null}"#,
        )
        .await
        .unwrap();
        let legacy = load_workspace_from_dir(&path).await.unwrap();
        assert!(!legacy.sidebar_collapsed);
        assert!(!legacy.tags_collapsed);
    }

    #[tokio::test]
    async fn test_pinned_tabs_roundtrip_and_default_empty() {
        let dir = tempdir().unwrap();
        let path = dir.path().to_string_lossy().into_owned();
        let original = WorkspaceState {
            open_tabs: vec!["/ws/a.md".into(), "/ws/b.md".into()],
            pinned_tabs: vec!["/ws/a.md".into()],
            ..Default::default()
        };

        save_workspace_to_dir(&path, &original).await.unwrap();
        let loaded = load_workspace_from_dir(&path).await.unwrap();
        assert_eq!(loaded.pinned_tabs, original.pinned_tabs);

        tokio::fs::write(
            dir.path().join(".workspace.json"),
            r#"{"openTabs":[],"activeTab":null}"#,
        )
        .await
        .unwrap();
        let legacy = load_workspace_from_dir(&path).await.unwrap();
        assert!(legacy.pinned_tabs.is_empty());
    }

    #[tokio::test]
    async fn test_canvas_viewports_roundtrip_and_default_empty() {
        let dir = tempdir().unwrap();
        let path = dir.path().to_string_lossy().into_owned();
        let original = WorkspaceState {
            canvas_viewports: [(
                "/ws/map.canvas".to_string(),
                CanvasViewport {
                    x: 10.0,
                    y: -4.5,
                    zoom: 0.75,
                },
            )]
            .into(),
            ..Default::default()
        };

        save_workspace_to_dir(&path, &original).await.unwrap();
        let loaded = load_workspace_from_dir(&path).await.unwrap();
        let viewport = &loaded.canvas_viewports["/ws/map.canvas"];
        assert_eq!((viewport.x, viewport.y, viewport.zoom), (10.0, -4.5, 0.75));

        tokio::fs::write(
            dir.path().join(".workspace.json"),
            r#"{"openTabs":[],"activeTab":null}"#,
        )
        .await
        .unwrap();
        let legacy = load_workspace_from_dir(&path).await.unwrap();
        assert!(legacy.canvas_viewports.is_empty());
    }

    // idle_minutes/skip_hooks/auto_push are P5-2/P5-3 fields, added after
    // prompted/auto_commit shipped — a file written by that earlier build
    // has none of them and must still load with sane defaults, not zeros.
    #[tokio::test]
    async fn test_load_legacy_file_without_p5_2_git_fields() {
        let dir = tempdir().unwrap();
        tokio::fs::write(
            dir.path().join(".workspace.json"),
            r#"{"openTabs":[],"activeTab":null,"git":{"prompted":true,"autoCommit":true}}"#,
        )
        .await
        .unwrap();

        let state = load_workspace_from_dir(&dir.path().to_string_lossy())
            .await
            .unwrap();

        assert!(state.git.prompted);
        assert!(state.git.auto_commit);
        assert_eq!(state.git.idle_minutes, 10);
        assert!(!state.git.skip_hooks);
        assert!(state.git.auto_push);
        assert!(!state.git.allow_code_repo_push);
    }

    #[test]
    fn test_initial_workspace_from_args_finds_the_flag() {
        let args = vec!["--workspace=/tmp/ws".to_string()];
        assert_eq!(
            initial_workspace_from_args(args),
            Some("/tmp/ws".to_string())
        );
    }

    #[test]
    fn test_initial_workspace_from_args_ignores_other_flags() {
        let args = vec!["--debug".to_string()];
        assert_eq!(initial_workspace_from_args(args), None);
    }

    #[test]
    fn test_initial_workspace_from_args_unjoined_flag_without_equals_is_ignored() {
        let args = vec!["--workspace".to_string(), "/tmp/ws".to_string()];
        assert_eq!(initial_workspace_from_args(args), None);
    }

    #[test]
    fn test_initial_workspace_from_args_finds_the_flag_among_others_in_any_position() {
        let args = vec![
            "--debug".to_string(),
            "--workspace=/tmp/ws".to_string(),
            "--other".to_string(),
        ];
        assert_eq!(
            initial_workspace_from_args(args),
            Some("/tmp/ws".to_string())
        );
    }

    #[test]
    fn test_open_file_from_args_finds_the_flag() {
        let args = vec!["--open-file=/tmp/Lecture 7.pdf".to_string()];
        assert_eq!(
            open_file_from_args(args),
            Some("/tmp/Lecture 7.pdf".to_string())
        );
    }

    #[test]
    fn test_open_file_from_args_ignores_the_workspace_flag() {
        let args = vec!["--workspace=/tmp/ws".to_string()];
        assert_eq!(open_file_from_args(args), None);
    }

    #[test]
    fn test_select_file_from_args_finds_the_flag_alongside_workspace() {
        let args = vec![
            "--workspace=/tmp/ws".to_string(),
            "--select-file=/tmp/ws/Lecture 7.md".to_string(),
        ];
        assert_eq!(
            select_file_from_args(args),
            Some("/tmp/ws/Lecture 7.md".to_string())
        );
    }

    #[test]
    fn test_select_file_from_args_ignores_the_open_file_flag() {
        let args = vec!["--open-file=/tmp/Lecture 7.pdf".to_string()];
        assert_eq!(select_file_from_args(args), None);
    }

    #[test]
    fn test_temp_workspace_for_file_copies_the_file_in() {
        let src_dir = tempdir().unwrap();
        let src = src_dir.path().join("Lecture 7.pdf");
        std::fs::write(&src, b"pdf bytes").unwrap();

        let workspace = temp_workspace_for_file(&src.to_string_lossy()).unwrap();

        let copied = std::path::Path::new(&workspace).join("Lecture 7.pdf");
        assert_eq!(std::fs::read(copied).unwrap(), b"pdf bytes");
    }

    #[test]
    fn test_temp_workspace_for_file_rejects_a_path_with_no_file_name() {
        assert!(temp_workspace_for_file("/").is_err());
    }
}

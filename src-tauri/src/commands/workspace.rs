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

// A single `--workspace=<path>` token, not a `--workspace <path>` pair: some
// launchers in the E2E toolchain reorder and re-split multi-token argv lists,
// which silently detaches a flag from its value. One token can't be reordered
// relative to anything.
pub fn initial_workspace_from_args<I: IntoIterator<Item = String>>(args: I) -> Option<String> {
    args.into_iter()
        .find_map(|arg| arg.strip_prefix("--workspace=").map(str::to_string))
}

pub struct InitialWorkspace(pub Option<String>);

#[tauri::command]
pub fn initial_workspace(state: tauri::State<InitialWorkspace>) -> Option<String> {
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
    let recents = push_recent(&dir, &path).await.map_err(|e| e.to_string())?;
    #[cfg(windows)]
    let _ = crate::commands::jumplist::rebuild(&recents);
    Ok(recents)
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
    use super::*;
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
}

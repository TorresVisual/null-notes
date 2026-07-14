use crate::models::WorkspaceState;

const STATE_FILE: &str = ".workspace.json";

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

#[tauri::command]
pub async fn load_workspace(path: String) -> Result<WorkspaceState, String> {
    load_workspace_from_dir(&path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_workspace(path: String, state: WorkspaceState) -> Result<(), String> {
    save_workspace_to_dir(&path, &state).await.map_err(|e| e.to_string())
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
        };
        save_workspace_to_dir(&path, &original).await.unwrap();
        let loaded = load_workspace_from_dir(&path).await.unwrap();
        assert_eq!(loaded.open_tabs, original.open_tabs);
        assert_eq!(loaded.active_tab, original.active_tab);
        assert_eq!(loaded.expanded_folders, original.expanded_folders);
    }

    #[tokio::test]
    async fn test_load_legacy_file_without_expanded_folders() {
        let dir = tempdir().unwrap();
        let state_path = dir.path().join(".workspace.json");
        tokio::fs::write(&state_path, r#"{"openTabs":["/ws/a.md"],"activeTab":"/ws/a.md"}"#)
            .await
            .unwrap();
        let state = load_workspace_from_dir(&dir.path().to_string_lossy())
            .await
            .unwrap();
        assert_eq!(state.open_tabs, vec!["/ws/a.md".to_string()]);
        assert!(state.expanded_folders.is_empty());
    }
}

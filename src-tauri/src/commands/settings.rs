use std::path::Path;
use tauri::{AppHandle, Manager};
use crate::models::AppSettings;

const SETTINGS_FILE: &str = "settings.json";

async fn load_settings_from_dir(dir: &Path) -> anyhow::Result<AppSettings> {
    let file = dir.join(SETTINGS_FILE);
    if !file.exists() {
        return Ok(AppSettings::default());
    }
    let raw = tokio::fs::read_to_string(&file).await?;
    Ok(serde_json::from_str(&raw)?)
}

async fn save_settings_to_dir(dir: &Path, settings: &AppSettings) -> anyhow::Result<()> {
    tokio::fs::create_dir_all(dir).await?;
    let json = serde_json::to_string_pretty(settings)?;
    tokio::fs::write(dir.join(SETTINGS_FILE), json).await?;
    Ok(())
}

#[tauri::command]
pub async fn load_settings(app: AppHandle) -> Result<AppSettings, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    load_settings_from_dir(&dir).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_settings(app: AppHandle, settings: AppSettings) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    save_settings_to_dir(&dir, &settings).await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_load_missing_returns_defaults() {
        let dir = tempdir().unwrap();
        let settings = load_settings_from_dir(dir.path()).await.unwrap();
        assert_eq!(settings.autosave_debounce_ms, 600);
        assert_eq!(settings.editor_max_width_px, 800);
    }

    #[tokio::test]
    async fn test_roundtrip() {
        let dir = tempdir().unwrap();
        let original = AppSettings {
            autosave_debounce_ms: 1200,
            editor_max_width_px: 960,
            spellcheck: true,
        };
        save_settings_to_dir(dir.path(), &original).await.unwrap();
        let loaded = load_settings_from_dir(dir.path()).await.unwrap();
        assert_eq!(loaded.autosave_debounce_ms, 1200);
        assert_eq!(loaded.editor_max_width_px, 960);
        assert!(loaded.spellcheck);
    }

    // A settings.json written before spellcheck existed must still load, or
    // the app comes up with an error instead of the user's preferences.
    #[tokio::test]
    async fn test_load_tolerates_a_file_missing_newer_fields() {
        let dir = tempdir().unwrap();
        tokio::fs::write(
            dir.path().join(SETTINGS_FILE),
            r#"{"autosaveDebounceMs":900,"editorMaxWidthPx":1000}"#,
        )
        .await
        .unwrap();

        let loaded = load_settings_from_dir(dir.path()).await.unwrap();

        assert_eq!(loaded.autosave_debounce_ms, 900);
        assert!(!loaded.spellcheck);
    }

    #[tokio::test]
    async fn test_save_creates_the_app_data_dir_if_missing() {
        let parent = tempdir().unwrap();
        let dir = parent.path().join("nested").join("app-data");
        save_settings_to_dir(&dir, &AppSettings::default()).await.unwrap();
        assert!(dir.join(SETTINGS_FILE).exists());
    }
}

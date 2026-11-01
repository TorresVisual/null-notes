pub mod dispatch;
pub mod lifecycle;
pub mod paths;
pub mod pipe;
pub mod protocol;
pub mod state;

use crate::commands::error_log;
use tauri::{AppHandle, Manager, Runtime, State};

pub(crate) const TOKEN_FILE: &str = "cli-token";

// Read straight off settings.json rather than through `load_settings`, which
// probes for an editor on every call; this runs at each launch.
fn access_enabled(data_dir: &std::path::Path) -> bool {
    std::fs::read_to_string(data_dir.join("settings.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|settings| settings["cliAccess"].as_bool())
        .unwrap_or(true)
}

// Binds the pipe first and publishes the per-launch token only once the bind
// succeeded, so an instance that loses the bind cannot invalidate the token
// the winner's clients are already using.
pub fn start<R: Runtime>(app: &AppHandle<R>) {
    let Ok(data_dir) = app.path().app_data_dir() else {
        return;
    };
    if !access_enabled(&data_dir) {
        return;
    }
    let token = uuid::Uuid::new_v4().to_string();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let published = token.clone();
        let dir = data_dir.clone();
        let result = pipe::serve(app, token, pipe::pipe_name(), move || {
            if let Err(e) = std::fs::write(dir.join(TOKEN_FILE), published) {
                error_log::append_entry_sync(
                    &dir,
                    "cli",
                    &format!("cannot write cli-token: {e}"),
                    None,
                );
            }
        })
        .await;
        if let Err(e) = result {
            error_log::append_entry_sync(
                &data_dir,
                "cli",
                &format!("CLI pipe server stopped: {e}"),
                None,
            );
        }
    });
}

#[tauri::command]
pub fn report_dirty_paths(
    state: State<'_, state::CliState>,
    workspace: String,
    paths: Vec<String>,
) {
    state.set_dirty(&workspace, paths);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn access_is_on_unless_settings_say_false() {
        let dir = tempfile::tempdir().unwrap();
        assert!(access_enabled(dir.path()));
        let settings = dir.path().join("settings.json");
        std::fs::write(&settings, r#"{"autosaveDebounceMs":600}"#).unwrap();
        assert!(access_enabled(dir.path()));
        std::fs::write(&settings, r#"{"cliAccess":false}"#).unwrap();
        assert!(!access_enabled(dir.path()));
        std::fs::write(&settings, r#"{"cliAccess":true}"#).unwrap();
        assert!(access_enabled(dir.path()));
    }
}

pub mod dispatch;
pub mod lifecycle;
pub mod paths;
pub mod pipe;
pub mod protocol;
pub mod state;

use crate::commands::error_log;
use tauri::{AppHandle, Manager, Runtime, State};

pub(crate) const TOKEN_FILE: &str = "cli-token";

// Binds the pipe first and publishes the per-launch token only once the bind
// succeeded, so an instance that loses the bind cannot invalidate the token
// the winner's clients are already using.
pub fn start<R: Runtime>(app: &AppHandle<R>) {
    let Ok(data_dir) = app.path().app_data_dir() else {
        return;
    };
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

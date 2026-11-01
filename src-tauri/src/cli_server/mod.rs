pub mod dispatch;
pub mod paths;
pub mod protocol;
pub mod state;

use tauri::State;

#[tauri::command]
pub fn report_dirty_paths(
    state: State<'_, state::CliState>,
    workspace: String,
    paths: Vec<String>,
) {
    state.set_dirty(&workspace, paths);
}

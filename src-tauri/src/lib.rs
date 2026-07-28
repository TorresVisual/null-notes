pub mod commands;
pub mod db;
pub mod models;
pub mod pdf;

use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // Veto the close so the UI can flush unsaved edits; it calls
        // `confirm_close` once the buffer is safely on disk.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.emit("close-requested", ());
            }
        })
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let pool = tauri::async_runtime::block_on(db::init_db(&data_dir))
                .expect("failed to initialise database");
            app.manage(pool);
            app.manage(commands::watcher::WatcherState::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::notes::list_notes,
            commands::notes::scan_workspace,
            commands::notes::open_note,
            commands::notes::save_note,
            commands::notes::reindex_note,
            commands::notes::reindex_from_disk,
            commands::watcher::watch_workspace,
            commands::notes::create_note,
            commands::notes::rename_note,
            commands::notes::delete_note,
            commands::notes::search_notes,
            commands::notes::list_tags,
            commands::notes::notes_with_tag,
            commands::notes::backlinks_for,
            commands::notes::create_folder,
            commands::notes::rename_folder,
            commands::notes::delete_folder,
            commands::notes::move_note,
            commands::workspace::load_workspace,
            commands::workspace::save_workspace,
            commands::workspace::recent_workspaces,
            commands::workspace::remember_workspace,
            commands::ink::ensure_ink_dir,
            commands::ink::read_ink,
            commands::ink::write_ink,
            commands::pdf::import_pdf,
            commands::window::confirm_close,
        ])
        .run(tauri::generate_context!())
        .expect("error running app");
}

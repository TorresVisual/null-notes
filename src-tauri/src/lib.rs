pub mod commands;
pub mod db;
pub mod models;
pub mod pdf;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let pool = tauri::async_runtime::block_on(db::init_db(&data_dir))
                .expect("failed to initialise database");
            app.manage(pool);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::notes::list_notes,
            commands::notes::scan_workspace,
            commands::notes::open_note,
            commands::notes::save_note,
            commands::notes::create_note,
            commands::notes::delete_note,
            commands::notes::search_notes,
            commands::notes::create_folder,
            commands::notes::rename_folder,
            commands::notes::delete_folder,
            commands::notes::move_note,
            commands::workspace::load_workspace,
            commands::workspace::save_workspace,
            commands::ink::ensure_ink_dir,
            commands::ink::read_ink,
            commands::ink::write_ink,
            commands::pdf::import_pdf,
        ])
        .run(tauri::generate_context!())
        .expect("error running app");
}

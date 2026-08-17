pub mod commands;
pub mod db;
pub mod exercises;
pub mod models;
pub mod pdf;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, Manager};

// Every ID here is also the string the frontend's command dispatcher
// (Layout.tsx) switches on when it receives the "menu-action" event.
fn build_menu(handle: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let file_menu = Submenu::with_items(
        handle,
        "File",
        true,
        &[
            &MenuItem::with_id(handle, "new-note", "New Note", true, Some("CmdOrCtrl+N"))?,
            &MenuItem::with_id(handle, "new-folder", "New Folder", true, Some("CmdOrCtrl+Shift+N"))?,
            &MenuItem::with_id(handle, "new-canvas", "New Canvas Note", true, None::<&str>)?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(handle, "open-workspace", "Open Workspace…", true, Some("CmdOrCtrl+O"))?,
            // A menu item and nothing else: scaffolding is on request only, so
            // it must never be reachable by opening a workspace.
            &MenuItem::with_id(handle, "scaffold-notes", "Scaffold Project Notes", true, None::<&str>)?,
            &PredefinedMenuItem::separator(handle)?,
            // On request only: a PDF import never does this on its own, because
            // "this document is an exercise sheet" is a claim about the
            // document that only the reader can make.
            &MenuItem::with_id(handle, "split-tasks", "Split Into Tasks", true, None::<&str>)?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(handle, "export-pdf", "Export to PDF…", true, None::<&str>)?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(handle, "settings", "Settings…", true, Some("CmdOrCtrl+,"))?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::quit(handle, None)?,
        ],
    )?;

    // Undo/Redo are unsupported on Windows/Linux per Tauri's own predefined
    // items, and ProseMirror already handles Ctrl+Z/Ctrl+Y inside the editor,
    // so this menu sticks to the clipboard actions that do work everywhere.
    let edit_menu = Submenu::with_items(
        handle,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::cut(handle, None)?,
            &PredefinedMenuItem::copy(handle, None)?,
            &PredefinedMenuItem::paste(handle, None)?,
            &PredefinedMenuItem::select_all(handle, None)?,
        ],
    )?;

    let view_menu = Submenu::with_items(
        handle,
        "View",
        true,
        &[
            &MenuItem::with_id(handle, "search", "Search", true, Some("CmdOrCtrl+K"))?,
            &MenuItem::with_id(handle, "quick-switch", "Quick Switcher", true, Some("CmdOrCtrl+P"))?,
            &MenuItem::with_id(handle, "toggle-view", "Toggle Source/Preview", true, Some("CmdOrCtrl+E"))?,
            &MenuItem::with_id(handle, "insert-ink", "Insert Ink Block", true, Some("CmdOrCtrl+Shift+I"))?,
            &MenuItem::with_id(handle, "graph-view", "Connections Graph", true, Some("CmdOrCtrl+G"))?,
            &MenuItem::with_id(handle, "toggle-terminal", "Toggle Terminal", true, Some("CmdOrCtrl+`"))?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(handle, "shortcuts-help", "Keyboard Shortcuts", true, None::<&str>)?,
        ],
    )?;

    Menu::with_items(handle, &[&file_menu, &edit_menu, &view_menu])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .menu(build_menu)
        // Every menu item's action lives in the frontend (React state, hooks) —
        // the native menu is purely a second entry point onto the same
        // dispatcher the keyboard shortcuts use, so there is exactly one
        // source of truth per action and no risk of a double-fire.
        .on_menu_event(|app, event| {
            let _ = app.emit("menu-action", event.id().0.as_str());
        })
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
            app.manage(commands::terminal::PtyState::default());
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
            commands::notes::graph_links,
            commands::notes::graph_tags,
            commands::notes::create_folder,
            commands::notes::scaffold_project_notes,
            commands::notes::split_into_tasks,
            commands::editor_launch::open_in_editor,
            commands::editor_launch::resolve_code_links,
            commands::git::detect_repo,
            commands::git::auto_commit,
            commands::git::push_notes,
            commands::terminal::terminal_open,
            commands::terminal::terminal_write,
            commands::terminal::terminal_resize,
            commands::terminal::terminal_close,
            commands::notes::rename_folder,
            commands::notes::delete_folder,
            commands::notes::move_note,
            commands::workspace::load_workspace,
            commands::workspace::save_workspace,
            commands::workspace::recent_workspaces,
            commands::workspace::remember_workspace,
            commands::settings::load_settings,
            commands::settings::save_settings,
            commands::ink::ensure_ink_dir,
            commands::ink::read_ink,
            commands::ink::write_ink,
            commands::pdf::ensure_pdf_dir,
            commands::pdf::import_pdf_pages,
            commands::pdf::read_pdf_page,
            commands::pdf::import_pdf_markdown,
            commands::pdf::pdf_has_text_layer,
            commands::assets::write_note_asset,
            commands::assets::read_note_asset,
            commands::window::confirm_close,
        ])
        .run(tauri::generate_context!())
        .expect("error running app");
}

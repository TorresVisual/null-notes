#[cfg(windows)]
pub mod cli_server;
pub mod commands;
pub mod db;
pub mod exercises;
pub mod fsrs;
pub mod link_resolve;
pub mod models;
pub mod pdf;
pub mod properties;
pub mod sm2;

use std::path::PathBuf;
use std::sync::OnceLock;
use tauri::{Emitter, Manager};

#[cfg(not(mobile))]
use commands::git as git_impl;
#[cfg(mobile)]
use commands::git_mobile as git_impl;

static ERROR_LOG_DIR: OnceLock<PathBuf> = OnceLock::new();

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let open_file = commands::workspace::open_file_from_args(std::env::args().skip(1));
    let workspace_arg = commands::workspace::initial_workspace_from_args(std::env::args().skip(1));
    let single_note = open_file
        .as_deref()
        .filter(|_| workspace_arg.is_none())
        .and_then(commands::workspace::single_note_target);
    let initial_workspace = workspace_arg
        .or_else(|| single_note.as_ref().map(|(dir, _)| dir.clone()))
        .or_else(|| {
            open_file.and_then(|file| commands::workspace::temp_workspace_for_file(&file).ok())
        });
    // Only meaningful alongside a real `--workspace=`; a lone `.md` lands on
    // its file through the single-note target, other files through the temp
    // workspace copy.
    let initial_select_file = commands::workspace::select_file_from_args(std::env::args().skip(1))
        .or_else(|| single_note.as_ref().map(|(_, file)| file.clone()));
    let is_single_note = single_note.is_some();
    let headless = commands::workspace::headless_from_args(std::env::args().skip(1));

    #[cfg(windows)]
    if !headless {
        let has_target_args = initial_workspace.is_some()
            || commands::workspace::open_file_from_args(std::env::args().skip(1)).is_some();
        if cli_server::lifecycle::defer_to_hidden_instance(has_target_args)
            == cli_server::lifecycle::Handshake::Promoted
        {
            return;
        }
    }

    #[cfg(windows)]
    unsafe {
        let _ = windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID(
            if cfg!(debug_assertions) {
                windows::core::w!("dev.nullnotes.app.dev")
            } else {
                windows::core::w!("dev.nullnotes.app")
            },
        );
    }

    #[cfg(all(target_os = "ios", debug_assertions))]
    if std::env::var("NULLNOTES_PDFIUM_SMOKE_TEST").is_ok() {
        std::thread::spawn(|| {
            // CWD at launch isn't guaranteed to be the bundle root on iOS
            // Simulator (confirmed empirically — a CWD-relative path here
            // produced NotFound); anchor off the executable's own directory
            // instead, matching bind_pdfium()'s iOS fallback in pdf/renderer.rs.
            let fixture = std::env::current_exe()
                .ok()
                .and_then(|p| {
                    p.parent()
                        .map(|p| p.join("assets/pdfium-smoke-fixture.pdf"))
                })
                .unwrap_or_else(|| "assets/pdfium-smoke-fixture.pdf".into());

            let result = crate::pdf::extract::extract_pages(&fixture)
                .map(|pages| {
                    let text = crate::pdf::extract::pages_to_text(&pages);
                    format!("PASS pages={} chars={}", pages.len(), text.len())
                })
                .unwrap_or_else(|e| format!("FAIL {e}"));

            let out = std::env::temp_dir().join("pdfium_smoke_result.txt");
            let _ = std::fs::write(&out, result);
        });
    }

    #[cfg(all(target_os = "ios", debug_assertions))]
    if std::env::var("NULLNOTES_PDFIUM_SMOKE_TEST").is_ok() {
        std::thread::spawn(move || {
            let fixture = std::env::current_exe()
                .ok()
                .and_then(|p| {
                    p.parent()
                        .map(|p| p.join("assets/pdfium-smoke-fixture.pdf"))
                })
                .unwrap_or_else(|| "assets/pdfium-smoke-fixture.pdf".into());
            let out_dir = std::env::temp_dir();

            // render_pages is async, but this hook runs before
            // tauri::Builder::default() is constructed (same insertion point
            // as the existing extract-check hook above), so Tauri's own
            // async_runtime isn't guaranteed live yet — a throwaway runtime
            // here is self-contained and doesn't depend on that timing.
            let result = tokio::runtime::Runtime::new()
                .map_err(|e| anyhow::anyhow!("runtime: {e}"))
                .and_then(|rt| {
                    rt.block_on(crate::pdf::renderer::render_pages(
                        &fixture,
                        &out_dir,
                        |_, _| {},
                    ))
                })
                .map(|pages| match pages.first() {
                    Some(p) => format!(
                        "PASS pages={} width={} height={} path={}",
                        pages.len(),
                        p.width,
                        p.height,
                        p.path
                    ),
                    None => "FAIL rendered zero pages".to_string(),
                })
                .unwrap_or_else(|e| format!("FAIL {e}"));

            let out = std::env::temp_dir().join("pdfium_render_smoke_result.txt");
            let _ = std::fs::write(&out, result);
        });
    }

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init());
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    builder
        // Veto the close so the UI can flush unsaved edits; it calls
        // `confirm_close` once the buffer is safely on disk.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.emit("close-requested", ());
            }
        })
        .setup(move |app| {
            let data_dir = app.path().app_data_dir()?;
            #[cfg(windows)]
            {
                if let Ok(exe_dir) =
                    std::env::current_exe().map(|p| p.parent().unwrap().to_path_buf())
                {
                    let msix = exe_dir.join("null-notes-identity.msix");
                    if msix.exists() && !commands::identity::has_current_package_identity(&msix) {
                        let args: Vec<String> = std::env::args().skip(1).collect();
                        commands::identity::register_and_relaunch(
                            &msix, &exe_dir, &args, &data_dir,
                        );
                    }
                }
                if !headless {
                    let recents = tauri::async_runtime::block_on(
                        commands::workspace::present_recents(&data_dir),
                    )
                    .unwrap_or_default();
                    let _ = commands::jumplist::rebuild(&recents);
                }
            }
            let _ = ERROR_LOG_DIR.set(data_dir.clone());
            std::panic::set_hook(Box::new(|info| {
                if let Some(dir) = ERROR_LOG_DIR.get() {
                    commands::error_log::append_entry_sync(dir, "panic", &info.to_string(), None);
                }
            }));
            let pool = tauri::async_runtime::block_on(db::init_db(&data_dir))
                .expect("failed to initialise database");
            app.manage(pool);
            app.manage(commands::watcher::WatcherState::default());
            app.manage(commands::terminal::PtyState::default());
            app.manage(commands::code_run::RunState::default());
            #[cfg(windows)]
            app.manage(cli_server::state::CliState::default());
            if !headless {
                #[cfg(windows)]
                app.state::<cli_server::state::CliState>().mark_shown();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                }
            }
            #[cfg(windows)]
            {
                cli_server::start(app.handle());
                cli_server::lifecycle::spawn_idle_quit(app.handle());
            }
            app.manage(commands::workspace::InitialWorkspace(initial_workspace));
            app.manage(commands::workspace::InitialSelectFile(initial_select_file));
            app.manage(commands::workspace::InitialSingleNote(is_single_note));

            // WebView2 claims some of our menu accelerators for its own browser-chrome
            // shortcuts before our menu ever sees the keystroke: Ctrl+P prints,
            // Ctrl+Shift+R hard-reloads, Ctrl+Shift+I opens DevTools, Ctrl+G finds
            // next. Turning this off is the only way to stop that; Tauri doesn't
            // expose it through config. It does *not* explain every dead
            // accelerator on Windows — see the comment on Layout.tsx's `runCommand`
            // for the rest, which this can't fix.
            #[cfg(windows)]
            if let Some(webview) = app.get_webview_window("main") {
                let _ = webview.with_webview(|platform_webview| {
                    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
                    use windows::core::Interface;
                    unsafe {
                        let Ok(core_webview) = platform_webview.controller().CoreWebView2() else {
                            return;
                        };
                        let Ok(settings) = core_webview.Settings() else {
                            return;
                        };
                        if let Ok(settings3) = settings.cast::<ICoreWebView2Settings3>() {
                            let _ = settings3.SetAreBrowserAcceleratorKeysEnabled(false);
                        }
                    }
                });
            }

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
            #[cfg(windows)]
            cli_server::report_dirty_paths,
            commands::bookmarks::read_bookmarks,
            commands::bookmarks::write_bookmarks,
            commands::scheduler::get_scheduler,
            commands::scheduler::set_scheduler,
            commands::notes::create_note,
            commands::notes::create_canvas,
            commands::notes::rename_canvas,
            commands::bases::create_base,
            commands::bases::list_base_rows,
            commands::bases::parse_note_properties,
            commands::bases::edit_content_property,
            commands::bases::write_note_property,
            commands::bases::create_note_with_properties,
            commands::notes::rename_note,
            commands::notes::rename_tag,
            commands::trash::delete_note,
            commands::compose::extract_to_note,
            commands::compose::merge_note,
            commands::compose::undo_merge,
            commands::trash::list_trash,
            commands::trash::restore_trash_entry,
            commands::trash::purge_trash_entry,
            commands::trash::empty_trash,
            commands::notes::search_notes,
            commands::notes::list_tags,
            commands::notes::notes_with_tag,
            commands::notes::list_open_tasks,
            commands::notes::toggle_task,
            commands::notes::grade_card,
            commands::notes::grade_mc_card,
            commands::notes::get_card_schedule,
            commands::notes::restore_card_schedule,
            commands::notes::set_card_suspended,
            commands::notes::list_due_cards,
            commands::notes::list_all_cards,
            commands::notes::list_cram_cards,
            commands::notes::list_tag_cards,
            commands::notes::backlinks_for,
            commands::notes::backlinks_for_with_context,
            commands::notes::code_backlinks_for_with_context,
            commands::notes::unlinked_mentions_for_with_context,
            commands::notes::graph_links,
            commands::notes::graph_tags,
            commands::notes::create_folder,
            commands::notes::split_into_tasks,
            commands::notes::list_templates,
            commands::notes::read_template,
            commands::notes::seed_default_templates,
            commands::notes::create_note_from_template,
            commands::notes::generate_formula_sheet,
            commands::notes::generate_solutions_sheet,
            commands::editor_launch::open_in_editor,
            commands::editor_launch::resolve_code_links,
            commands::crossref::resolve_cross_refs,
            git_impl::detect_repo,
            git_impl::detect_prior_automation,
            git_impl::auto_commit,
            git_impl::push_notes,
            git_impl::fetch_and_compare,
            git_impl::rebase_onto_remote,
            git_impl::init_notes_repo,
            git_impl::list_note_history,
            git_impl::read_note_at_commit,
            git_impl::list_github_repos,
            git_impl::clone_repo,
            commands::git_credentials::get_git_token,
            commands::git_credentials::set_git_token,
            commands::terminal::terminal_open,
            commands::terminal::terminal_write,
            commands::terminal::terminal_resize,
            commands::terminal::terminal_close,
            commands::code_format::format_code,
            commands::code_run::run_code,
            commands::code_run::send_input,
            commands::code_run::stop_run,
            commands::code_run::install_python_package,
            commands::notes::rename_folder,
            commands::trash::delete_folder,
            commands::notes::move_note,
            commands::notes::duplicate_note,
            commands::notes::reveal_note,
            commands::notes::open_note_externally,
            commands::workspace::load_workspace,
            commands::workspace::save_workspace,
            commands::workspace::recent_workspaces,
            commands::workspace::remember_workspace,
            commands::workspace::initial_workspace,
            commands::workspace::initial_select_file,
            commands::workspace::initial_single_note,
            commands::settings::load_settings,
            commands::settings::save_settings,
            commands::error_log::record_error,
            commands::error_log::list_errors,
            commands::error_log::clear_errors,
            commands::ink::ensure_ink_dir,
            commands::ink::read_ink,
            commands::ink::write_ink,
            commands::diagrams::ensure_diagrams_dir,
            commands::diagrams::read_diagram,
            commands::diagrams::write_diagram,
            commands::diagrams::list_diagrams,
            commands::pdf::ensure_pdf_dir,
            commands::pdf::import_pdf_pages,
            commands::pdf::read_pdf_page,
            commands::pdf::find_pdf_page,
            commands::pdf::import_pdf_markdown,
            commands::pdf::pdf_has_text_layer,
            commands::assets::write_note_asset,
            commands::assets::read_note_asset,
            commands::assets::gc_note_assets,
            commands::window::confirm_close,
            commands::window::exit_app,
            commands::window::is_release_build,
            commands::printing::list_printers,
            commands::printing::export_pdf,
            commands::export::export_zip,
            commands::printing::print_document,
        ])
        .run(tauri::generate_context!())
        .expect("error running app");
}

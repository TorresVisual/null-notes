//! The embedded terminal pane (P8-1).
//!
//! One PTY session at a time — `PtyState` holds `Option`, not a map, matching
//! the roadmap's own framing of "a terminal pane." Output isn't guaranteed
//! valid UTF-8 (a multi-byte character can split across two reads, and
//! arbitrary binary can appear in escape sequences), so it's base64-encoded
//! before crossing the IPC boundary — the same shape `read_ink`/`read_pdf_page`
//! already use for binary data over Tauri events/commands. Design:
//! `docs/specs/terminal-pane-design.md`.

use super::editor_launch::{is_on_path, tokenize};

/// Splits a shell template into a program and its arguments — no placeholder
/// substitution, unlike `editor_launch::build_command`, because a shell needs
/// no `{file}`/`{line}` filled in.
pub fn parse_shell(template: &str) -> Result<(String, Vec<String>), String> {
    let tokens = tokenize(template);
    let (program, args) = tokens.split_first().ok_or("terminal shell is empty")?;
    Ok((program.clone(), args.to_vec()))
}

/// The shell to spawn when no setting has been chosen: probes for `pwsh`
/// then `powershell` on Windows, or `$SHELL` (falling back to `bash`) elsewhere.
pub fn detect_terminal_shell() -> String {
    if cfg!(windows) {
        for candidate in ["pwsh", "powershell"] {
            if is_on_path(candidate) {
                return candidate.to_string();
            }
        }
        "powershell".to_string()
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "bash".to_string())
    }
}

use base64::Engine;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

pub struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
pub struct PtyState(pub Mutex<Option<PtySession>>);

/// Spawns the configured shell rooted at `workspace`. A no-op if a session is
/// already open — reopening the pane reuses it rather than respawning, which
/// is what lets a long-running process (e.g. `claude`) survive the panel
/// being toggled shut and back open.
///
/// The shell is read from `settings.json` here, not accepted as a parameter —
/// see `settings::resolve_settings`'s docs for why (H-4).
#[tauri::command]
pub async fn terminal_open(
    workspace: String,
    note_path: Option<String>,
    app: AppHandle,
    state: State<'_, PtyState>,
) -> Result<(), String> {
    // Resolved before the lock is taken: a std::sync::MutexGuard can't be held
    // across an .await point, and this settings read is the only async step.
    let settings = super::settings::resolve_settings(&app).await?;
    let (program, args) = parse_shell(&settings.terminal_shell)?;

    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if guard.is_some() {
        return Ok(());
    }

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new(&program);
    cmd.args(&args);
    cmd.cwd(&workspace);
    // Frozen at spawn time — a running process's environment can't be
    // rewritten from outside. The terminal pane's header button covers the
    // "note changed since" case by inserting the live path as typed text.
    if let Some(note) = &note_path {
        cmd.env("NULL_NOTES_ACTIVE_NOTE", note);
    }

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    // The slave side is only needed to spawn the child; dropping it here
    // matches portable-pty's own examples and avoids holding an extra handle
    // open for the life of the session.
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let emit_app = app.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let chunk = base64::engine::general_purpose::STANDARD.encode(&buf[..n]);
                    if emit_app.emit("terminal-output", chunk).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    *guard = Some(PtySession {
        master: pair.master,
        writer,
        child,
    });
    Ok(())
}

#[tauri::command]
pub fn terminal_write(data: String, state: State<'_, PtyState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    let session = guard.as_mut().ok_or("no terminal session is open")?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())?;
    session.writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn terminal_resize(cols: u16, rows: u16, state: State<'_, PtyState>) -> Result<(), String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let session = guard.as_ref().ok_or("no terminal session is open")?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

/// Kills the running shell, if any. This — not toggling the pane closed — is
/// what the DoD's "no orphaned process" applies to. A no-op (`Ok(())`) when
/// no session is open, so callers never need to check first.
#[tauri::command]
pub fn terminal_close(state: State<'_, PtyState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(mut session) = guard.take() {
        let _ = session.child.kill();
        let _ = session.child.wait();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_bare_shell_with_no_arguments() {
        let (program, args) = parse_shell("powershell").unwrap();
        assert_eq!(program, "powershell");
        assert!(args.is_empty());
    }

    #[test]
    fn parses_a_shell_with_arguments() {
        let (program, args) = parse_shell("wsl -d Ubuntu").unwrap();
        assert_eq!(program, "wsl");
        assert_eq!(args, ["-d", "Ubuntu"]);
    }

    #[test]
    fn refuses_an_empty_template() {
        assert!(parse_shell("   ").is_err());
    }
}

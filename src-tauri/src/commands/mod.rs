pub mod assets;
pub mod code_run;
pub mod crossref;
pub mod diagrams;
pub mod editor_launch;
pub mod error_log;
pub mod git;
pub mod identity;
pub mod ink;
pub mod jumplist;
pub mod notes;
pub mod pdf;
pub mod printing;
pub mod settings;
pub mod terminal;
pub mod watcher;
pub mod window;
pub mod workspace;

/// `<note-dir>/<note-stem>.<suffix>` — the sidecar directory ink, diagrams
/// and PDF pages each keep alongside a note, named after it so it travels
/// with the note (see CLAUDE.md's "storage boundary").
pub fn sidecar_dir_for(note_path: &str, suffix: &str) -> String {
    let p = std::path::Path::new(note_path);
    let stem = p.file_stem().unwrap_or_default().to_string_lossy();
    let dir = p.parent().unwrap_or(std::path::Path::new("."));
    dir.join(format!("{stem}.{suffix}"))
        .to_string_lossy()
        .into_owned()
}

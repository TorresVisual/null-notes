//! Opening a file from a note in the user's own editor.
//!
//! **The first feature in this app that launches an external process using
//! text taken from note content**, and a note is a hand-editable `.md` that
//! may have arrived by Git pull, by Syncthing, or out of a converted PDF. The
//! link target is attacker-influenced text and the sink is process execution,
//! so the guarantees here are structural rather than checks that a later edit
//! could forget:
//!
//! - No shell, ever. [`std::process::Command`] with one `.arg()` per argument.
//! - The command template is tokenized **before** substitution, never after,
//!   so a resolved path is never re-split into words.
//! - A path is refused unless every component is `Component::Normal`, the same
//!   posture `assets.rs` takes: rejected as written rather than normalised,
//!   because normalising invites a gap between what was checked and what runs.
//!
//! Design: `docs/specs/code-deep-links-design.md`.

use std::path::{Component, Path, PathBuf};

/// Command templates for the editors worth naming, tried in this order when
/// the setting is empty. `code` is last as the fallback, not a probe result.
const KNOWN_EDITORS: [(&str, &str); 4] = [
    ("code", "code -g {file}:{line}"),
    ("idea", "idea --line {line} {file}"),
    ("nvim", "nvim +{line} {file}"),
    ("subl", "subl {file}:{line}"),
];

pub const DEFAULT_EDITOR_COMMAND: &str = "code -g {file}:{line}";

/// Resolves a link target against the workspace root.
///
/// Refuses absolute paths, drive prefixes and anything containing `..` — every
/// component must be `Component::Normal`. A target that resolves but does not
/// exist is refused too: that is what keeps an unresolvable link inert rather
/// than launching an editor on nothing.
pub fn resolve_in_workspace(workspace: &str, target: &str) -> Result<PathBuf, String> {
    let candidate = Path::new(target);
    if candidate.is_absolute() {
        return Err(format!("not a workspace-relative path: {target}"));
    }
    for component in candidate.components() {
        if !matches!(component, Component::Normal(_)) {
            return Err(format!("path escapes the workspace: {target}"));
        }
    }

    let resolved = Path::new(workspace).join(candidate);
    if !resolved.is_file() {
        return Err(format!("no such file: {target}"));
    }
    Ok(resolved)
}

/// Splits a command template into its program and argument tokens.
///
/// Runs on the template alone and never on a resolved path — substitution
/// happens afterwards, inside tokens that are already separated. Doing it the
/// other way round would let a path containing a space become two arguments,
/// which is the same injection this module exists to prevent.
pub(crate) fn tokenize(template: &str) -> Vec<String> {
    template.split_whitespace().map(str::to_string).collect()
}

/// The program and arguments to launch, with `{file}` and `{line}` filled in.
///
/// A token is substituted in place, so `{file}:{line}` stays one argument
/// however many spaces the resolved path contains.
pub fn build_command(
    template: &str,
    file: &str,
    line: u32,
) -> Result<(String, Vec<String>), String> {
    let tokens = tokenize(template);
    let (program, args) = tokens.split_first().ok_or("editor command is empty")?;
    if program.contains("{file}") || program.contains("{line}") {
        return Err("editor command must start with a program, not a placeholder".to_string());
    }

    let filled: Vec<String> = args
        .iter()
        .map(|arg| {
            arg.replace("{file}", file)
                .replace("{line}", &line.to_string())
        })
        .collect();
    Ok((program.clone(), filled))
}

/// The first known editor present on `PATH`, or the VS Code default.
///
/// Probed with the platform's own lookup rather than by walking `PATH`
/// ourselves — `where`/`which` know about `PATHEXT` on Windows, and getting
/// that subtly wrong would mean silently defaulting on a machine that has the
/// editor installed.
pub fn detect_editor_command() -> String {
    for (program, template) in KNOWN_EDITORS {
        let probe = if cfg!(windows) { "where" } else { "which" };
        let found = std::process::Command::new(probe)
            .arg(program)
            .output()
            .map(|out| out.status.success())
            .unwrap_or(false);
        if found {
            return template.to_string();
        }
    }
    DEFAULT_EDITOR_COMMAND.to_string()
}

#[tauri::command]
pub async fn open_in_editor(
    workspace: String,
    target: String,
    line: Option<u32>,
    template: String,
) -> Result<(), String> {
    let resolved = resolve_in_workspace(&workspace, &target)?;
    let (program, args) = build_command(&template, &resolved.to_string_lossy(), line.unwrap_or(1))?;

    std::process::Command::new(program)
        .args(args)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("could not launch the configured editor: {e}"))
}

/// Which of `targets` resolve to a real file, in the order given.
///
/// Batched deliberately: a link renders inert unless its file exists, and
/// asking per link on every render is what would make the feature feel slow.
#[tauri::command]
pub async fn resolve_code_links(
    workspace: String,
    targets: Vec<String>,
) -> Result<Vec<bool>, String> {
    Ok(targets
        .iter()
        .map(|target| resolve_in_workspace(&workspace, target).is_ok())
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn workspace_with(file: &str) -> tempfile::TempDir {
        let tmp = tempdir().unwrap();
        let path = tmp.path().join(file);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "fn main() {}").unwrap();
        tmp
    }

    #[test]
    fn resolves_a_plain_relative_path_that_exists() {
        let tmp = workspace_with("src/main.rs");

        let resolved = resolve_in_workspace(&tmp.path().to_string_lossy(), "src/main.rs").unwrap();

        assert!(resolved.is_file());
    }

    // The same posture as assets.rs: refused as written, not normalised and
    // compared, so there is no gap between the string checked and the one used.
    #[test]
    fn refuses_paths_that_escape_the_workspace() {
        let tmp = workspace_with("src/main.rs");
        let ws = tmp.path().to_string_lossy().into_owned();

        assert!(resolve_in_workspace(&ws, "../../../etc/passwd").is_err());
        assert!(resolve_in_workspace(&ws, "src/../../secret").is_err());
        assert!(resolve_in_workspace(&ws, "/etc/passwd").is_err());
        assert!(resolve_in_workspace(&ws, "C:\\Windows\\System32\\cmd.exe").is_err());
    }

    #[test]
    fn refuses_a_path_that_does_not_exist() {
        let tmp = workspace_with("src/main.rs");

        assert!(resolve_in_workspace(&tmp.path().to_string_lossy(), "src/nope.rs").is_err());
    }

    // Even when the target really is there. Escaping is refused on its shape,
    // never on whether the escape happens to land on something.
    #[test]
    fn refuses_to_escape_even_when_the_target_exists() {
        let tmp = tempdir().unwrap();
        std::fs::write(tmp.path().join("secret.txt"), "sensitive").unwrap();
        let inner = tmp.path().join("workspace");
        std::fs::create_dir(&inner).unwrap();

        assert!(resolve_in_workspace(&inner.to_string_lossy(), "../secret.txt").is_err());
    }

    #[test]
    fn builds_the_program_and_its_arguments() {
        let (program, args) =
            build_command("code -g {file}:{line}", "/ws/src/main.rs", 58).unwrap();

        assert_eq!(program, "code");
        assert_eq!(args, ["-g", "/ws/src/main.rs:58"]);
    }

    #[test]
    fn substitutes_the_line_into_a_template_that_takes_it_separately() {
        let (program, args) = build_command("idea --line {line} {file}", "/ws/a.rs", 12).unwrap();

        assert_eq!(program, "idea");
        assert_eq!(args, ["--line", "12", "/ws/a.rs"]);
    }

    // The load-bearing test. Substituting before splitting would turn this one
    // path into three arguments; substituting into an already-separated token
    // leaves it as one, whatever it contains.
    #[test]
    fn a_path_with_spaces_stays_a_single_argument() {
        let (_, args) = build_command("code -g {file}:{line}", "/ws/My Notes/a b.rs", 3).unwrap();

        assert_eq!(args, ["-g", "/ws/My Notes/a b.rs:3"]);
    }

    // No shell is involved, so metacharacters are ordinary characters in an
    // argument that names no file. They must never become separate tokens.
    #[test]
    fn shell_metacharacters_stay_inside_one_argument() {
        let (program, args) =
            build_command("code -g {file}:{line}", "/ws/a.rs; rm -rf ~", 1).unwrap();

        assert_eq!(program, "code");
        assert_eq!(args, ["-g", "/ws/a.rs; rm -rf ~:1"]);
        assert_eq!(args.len(), 2, "metacharacters split the command: {args:?}");
    }

    #[test]
    fn refuses_an_empty_template() {
        assert!(build_command("   ", "/ws/a.rs", 1).is_err());
    }

    // A template whose program slot is a placeholder would let a note's own
    // text choose the executable.
    #[test]
    fn refuses_a_template_whose_program_is_a_placeholder() {
        assert!(build_command("{file} -g", "/ws/a.rs", 1).is_err());
    }
}

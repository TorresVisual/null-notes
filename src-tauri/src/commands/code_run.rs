//! In-editor code execution (P10-2). No shell, no sandbox — see
//! `docs/specs/code-execution-design.md` for the security posture this
//! module implements: friction and visibility (never auto-run, per-note
//! confirmation) instead of containment.

use super::editor_launch::tokenize;
use std::time::Duration;

/// `python`, `cpp`, `c++`, or `c` — the only languages a Run button appears
/// on. MSVC's `cl.exe` is a known v1 gap (see the design doc).
pub fn is_cpp(language: &str) -> bool {
    matches!(language, "cpp" | "c++" | "c")
}

/// Probes `PATH` for `python3` then `python`, same `where`/`which` pattern
/// as `editor_launch::detect_editor_command`.
pub fn detect_python_command() -> String {
    for candidate in ["python3", "python"] {
        let probe = if cfg!(windows) { "where" } else { "which" };
        let found = std::process::Command::new(probe)
            .arg(candidate)
            .output()
            .map(|out| out.status.success())
            .unwrap_or(false);
        if found {
            return candidate.to_string();
        }
    }
    "python3".to_string()
}

/// Probes `PATH` for `g++` then `clang++`. MSVC's `cl.exe` needs
/// `vcvarsall.bat`-style environment setup to work outside a Developer
/// Command Prompt — a distinct problem, not probed for here.
pub fn detect_cpp_compiler_command() -> String {
    for candidate in ["g++", "clang++"] {
        let probe = if cfg!(windows) { "where" } else { "which" };
        let found = std::process::Command::new(probe)
            .arg(candidate)
            .output()
            .map(|out| out.status.success())
            .unwrap_or(false);
        if found {
            return candidate.to_string();
        }
    }
    "g++".to_string()
}

/// The binary a successful compile produces, inside the run's own temp
/// directory — never a name derived from note content.
pub fn cpp_binary_name() -> &'static str {
    if cfg!(windows) {
        "main.exe"
    } else {
        "main"
    }
}

/// Program and args for running a Python script — no shell; `script_path`
/// is always a path this module wrote itself, never note-derived text.
pub fn python_argv(python_command: &str, script_path: &str) -> (String, Vec<String>) {
    let mut tokens = tokenize(python_command);
    if tokens.is_empty() {
        tokens.push("python3".to_string());
    }
    let program = tokens.remove(0);
    tokens.push(script_path.to_string());
    (program, tokens)
}

/// Program and args for compiling `source_path` into `cpp_binary_name()`.
pub fn cpp_compile_argv(cpp_compiler_command: &str, source_path: &str) -> (String, Vec<String>) {
    let mut tokens = tokenize(cpp_compiler_command);
    if tokens.is_empty() {
        tokens.push("g++".to_string());
    }
    let program = tokens.remove(0);
    tokens.push(source_path.to_string());
    tokens.push("-o".to_string());
    tokens.push(cpp_binary_name().to_string());
    (program, tokens)
}

/// Whether a run that started `elapsed` ago should be killed under a
/// `limit_secs`-second timeout — the only resource limit this feature
/// applies (see the design doc's security posture).
pub fn has_timed_out(elapsed: Duration, limit_secs: u64) -> bool {
    elapsed >= Duration::from_secs(limit_secs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn python_argv_uses_the_script_as_the_only_argument() {
        let (program, args) = python_argv("python3", "main.py");
        assert_eq!(program, "python3");
        assert_eq!(args, ["main.py"]);
    }

    #[test]
    fn python_argv_splits_a_multi_token_command() {
        let (program, args) = python_argv("python3.11 -B", "main.py");
        assert_eq!(program, "python3.11");
        assert_eq!(args, ["-B", "main.py"]);
    }

    #[test]
    fn cpp_compile_argv_names_the_output_binary() {
        let (program, args) = cpp_compile_argv("g++", "main.cpp");
        assert_eq!(program, "g++");
        assert_eq!(args, ["main.cpp", "-o", cpp_binary_name()]);
    }

    #[test]
    fn is_cpp_recognises_every_cpp_alias_but_not_python() {
        assert!(is_cpp("cpp"));
        assert!(is_cpp("c++"));
        assert!(is_cpp("c"));
        assert!(!is_cpp("python"));
    }

    #[test]
    fn has_timed_out_is_false_before_the_limit() {
        assert!(!has_timed_out(Duration::from_secs(5), 10));
    }

    #[test]
    fn has_timed_out_is_true_at_or_after_the_limit() {
        assert!(has_timed_out(Duration::from_secs(10), 10));
        assert!(has_timed_out(Duration::from_secs(11), 10));
    }
}

//! Reformatting a code block with an external tool (#133). Design:
//! `docs/specs/code-formatter-design.md`.
//!
//! The program comes from a fixed table keyed by language — never from the
//! frontend or the note — and the block's text reaches it on stdin only,
//! never argv, so note content cannot steer what runs.

use super::git::no_window_command;
use std::io::{Read, Write};
use std::process::Stdio;
use std::time::{Duration, Instant};

const FORMAT_TIMEOUT: Duration = Duration::from_secs(10);

/// Program and args for formatting `language`, or `None` if it has no
/// external formatter. JSON is formatted in the frontend.
pub fn format_argv(
    language: &str,
    indent_width: u32,
    use_tab: bool,
) -> Option<(&'static str, Vec<String>)> {
    let clang = |filename: &str| {
        let style = format!(
            "{{BasedOnStyle: LLVM, IndentWidth: {}, UseTab: {}}}",
            indent_width.clamp(1, 16),
            if use_tab { "Always" } else { "Never" }
        );
        (
            "clang-format",
            vec![
                format!("--assume-filename={filename}"),
                format!("--style={style}"),
            ],
        )
    };
    match language {
        "c" => Some(clang("main.c")),
        "cpp" | "c++" => Some(clang("main.cpp")),
        "java" => Some(clang("Main.java")),
        "python" => Some(("black", vec!["-q".to_string(), "-".to_string()])),
        _ => None,
    }
}

fn run_formatter(program: &str, args: &[String], source: String) -> anyhow::Result<String> {
    let mut child = no_window_command(program)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                anyhow::anyhow!("{program} is not installed or not on PATH")
            } else {
                anyhow::anyhow!("could not start {program}: {e}")
            }
        })?;

    let stdin = child.stdin.take();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    // Each pipe gets its own thread so a large block can't deadlock against a
    // full pipe buffer on the other side.
    let writer = std::thread::spawn(move || {
        if let Some(mut stdin) = stdin {
            let _ = stdin.write_all(source.as_bytes());
        }
    });
    let read = |pipe: Option<Box<dyn Read + Send>>| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            if let Some(mut pipe) = pipe {
                let _ = pipe.read_to_end(&mut buf);
            }
            buf
        })
    };
    let out_thread = read(stdout.map(|s| Box::new(s) as Box<dyn Read + Send>));
    let err_thread = read(stderr.map(|s| Box::new(s) as Box<dyn Read + Send>));

    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if started.elapsed() >= FORMAT_TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            anyhow::bail!("{program} timed out after {}s", FORMAT_TIMEOUT.as_secs());
        }
        std::thread::sleep(Duration::from_millis(20));
    };

    let _ = writer.join();
    let out = out_thread.join().unwrap_or_default();
    let err = err_thread.join().unwrap_or_default();

    if !status.success() {
        let message = String::from_utf8_lossy(&err);
        let first = message.lines().find(|l| !l.trim().is_empty());
        anyhow::bail!("{}", first.unwrap_or("formatting failed"));
    }
    Ok(String::from_utf8(out)?)
}

#[tauri::command]
pub async fn format_code(
    language: String,
    source: String,
    indent_width: u32,
    use_tab: bool,
) -> Result<String, String> {
    let (program, args) = format_argv(&language, indent_width, use_tab)
        .ok_or_else(|| format!("no formatter for {language}"))?;
    tokio::task::spawn_blocking(move || run_formatter(program, &args, source))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn c_family_languages_use_clang_format_with_the_matching_filename() {
        let (program, args) = format_argv("cpp", 4, false).unwrap();
        assert_eq!(program, "clang-format");
        assert_eq!(args[0], "--assume-filename=main.cpp");
        assert_eq!(
            args[1],
            "--style={BasedOnStyle: LLVM, IndentWidth: 4, UseTab: Never}"
        );
        assert_eq!(format_argv("c++", 4, false).unwrap().1[0], args[0]);
        assert_eq!(
            format_argv("c", 4, false).unwrap().1[0],
            "--assume-filename=main.c"
        );
        assert_eq!(
            format_argv("java", 4, false).unwrap().1[0],
            "--assume-filename=Main.java"
        );
    }

    #[test]
    fn tab_indent_sets_use_tab_always_and_width_is_clamped() {
        let (_, args) = format_argv("java", 0, true).unwrap();
        assert_eq!(
            args[1],
            "--style={BasedOnStyle: LLVM, IndentWidth: 1, UseTab: Always}"
        );
        let (_, args) = format_argv("java", 999, false).unwrap();
        assert!(args[1].contains("IndentWidth: 16"));
    }

    #[test]
    fn python_uses_black_reading_stdin() {
        let (program, args) = format_argv("python", 2, false).unwrap();
        assert_eq!(program, "black");
        assert_eq!(args, ["-q", "-"]);
    }

    #[test]
    fn unknown_and_frontend_handled_languages_have_no_external_formatter() {
        assert!(format_argv("json", 2, false).is_none());
        assert!(format_argv("rust", 2, false).is_none());
        assert!(format_argv("clang-format; rm -rf /", 2, false).is_none());
    }

    #[test]
    fn a_missing_program_reports_that_it_is_not_installed() {
        let err = run_formatter("null-notes-no-such-formatter", &[], String::new()).unwrap_err();
        assert!(err.to_string().contains("not installed"));
    }
}

//! In-editor code execution (P10-2). No shell, no sandbox — see
//! `docs/specs/code-execution-design.md` for the security posture this
//! module implements: friction and visibility (never auto-run, per-note
//! confirmation) instead of containment.

use super::editor_launch::{is_on_path, tokenize};
use super::git::no_window_command;
use base64::Engine;
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::process::{Child, ChildStdin, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};
use tempfile::TempDir;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodeRunOutput {
    run_id: String,
    stream: String,
    data: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodeRunExit {
    run_id: String,
    code: Option<i32>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodeRunTimeout {
    run_id: String,
}

/// One in-flight run. `_temp_dir` is only ever read through `child`/`stdin`
/// — it exists so `TempDir`'s own `Drop` deletes the directory the moment
/// this struct is removed from `RunState`, whichever of exit/timeout/stop
/// removes it.
struct Run {
    child: Child,
    stdin: Option<ChildStdin>,
    _temp_dir: TempDir,
}

#[derive(Default)]
pub struct RunState(Mutex<HashMap<String, Run>>);

fn emit_output(app: &AppHandle, run_id: &str, stream: &str, bytes: &[u8]) {
    if bytes.is_empty() {
        return;
    }
    let data = base64::engine::general_purpose::STANDARD.encode(bytes);
    let _ = app.emit(
        "code-run-output",
        CodeRunOutput {
            run_id: run_id.to_string(),
            stream: stream.to_string(),
            data,
        },
    );
}

/// Reports a failure that happens before a process exists to `try_wait` on
/// (writing the source, spawning the compiler, spawning the interpreter) as
/// an ordinary stderr line plus an exit event — never as a `Result::Err`
/// from the command itself. The frontend dispatches its `'start'` meta and
/// shows a "running" panel the moment the click handler fires, before this
/// command's own promise settles; a rejected promise would leave that panel
/// stuck with no terminal state to reach; landing here instead. See
/// docs/plans/code-execution.md Task 11 (the QA pass that found this).
fn fail(app: &AppHandle, run_id: &str, message: &str) {
    emit_output(app, run_id, "stderr", message.as_bytes());
    let _ = app.emit(
        "code-run-exit",
        CodeRunExit {
            run_id: run_id.to_string(),
            code: None,
        },
    );
}

/// Reads one stream to EOF, emitting each chunk as it arrives. Two of these
/// run per process (stdout, stderr) — the same "one thread per pipe" shape
/// as `terminal.rs`'s single reader thread, doubled because a piped child
/// (unlike a PTY) keeps stdout and stderr as genuinely separate streams.
fn spawn_reader<R: Read + Send + 'static>(
    app: AppHandle,
    run_id: String,
    stream: String,
    mut reader: R,
) {
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => emit_output(&app, &run_id, &stream, &buf[..n]),
                Err(_) => break,
            }
        }
    });
}

/// Polls the run every 100ms: reports a normal exit as soon as `try_wait`
/// sees one, or kills the child and reports a timeout once `has_timed_out`
/// says so. Reads `app.state::<RunState>()` fresh each iteration rather
/// than capturing a `State<'_, RunState>` — that type's lifetime is tied to
/// the invocation that produced it and cannot be moved into a thread that
/// outlives the command call.
fn spawn_supervisor(app: AppHandle, run_id: String, timeout_secs: u64) {
    std::thread::spawn(move || {
        let started = Instant::now();
        loop {
            std::thread::sleep(Duration::from_millis(100));
            let state = app.state::<RunState>();
            let Ok(mut guard) = state.0.lock() else {
                return;
            };
            let Some(run) = guard.get_mut(&run_id) else {
                return;
            };

            match run.child.try_wait() {
                Ok(Some(status)) => {
                    guard.remove(&run_id);
                    drop(guard);
                    let _ = app.emit(
                        "code-run-exit",
                        CodeRunExit {
                            run_id: run_id.clone(),
                            code: status.code(),
                        },
                    );
                    return;
                }
                Ok(None) => {
                    if has_timed_out(started.elapsed(), timeout_secs) {
                        let _ = run.child.kill();
                        let _ = run.child.wait();
                        guard.remove(&run_id);
                        drop(guard);
                        let _ = app.emit(
                            "code-run-timeout",
                            CodeRunTimeout {
                                run_id: run_id.clone(),
                            },
                        );
                        return;
                    }
                }
                Err(_) => {
                    guard.remove(&run_id);
                    return;
                }
            }
        }
    });
}

/// Writes the block's content to a fresh temp directory and runs it with no
/// shell. For C++, compiles first — a failed compile emits its stderr and a
/// `code-run-exit` for the compiler's own exit code, and the binary is
/// never invoked. `run_id` is generated by the caller (the frontend) so it
/// can subscribe to this run's events before invoking, closing the race a
/// backend-generated ID would leave between "process starts producing
/// output" and "listener attached."
// The argument count mirrors the frontend's flat invoke payload
// (runId/language/source/pythonCommand/cppCompilerCommand/timeoutSecs) plus
// Tauri's own injected app/state — splitting it into a sub-struct would only
// move the same six fields one level down, not reduce them.
// python_command/cpp_compiler_command are read from settings.json below,
// not accepted as parameters — see settings::resolve_settings's docs (H-4).
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn run_code(
    run_id: String,
    language: String,
    source: String,
    timeout_secs: u64,
    app: AppHandle,
    state: State<'_, RunState>,
) -> Result<(), String> {
    let settings = super::settings::resolve_settings(&app).await?;
    let python_command = settings.python_command;
    let cpp_compiler_command = settings.cpp_compiler_command;

    let dir = match tempfile::tempdir() {
        Ok(dir) => dir,
        Err(e) => {
            fail(
                &app,
                &run_id,
                &format!("could not create a temp directory: {e}"),
            );
            return Ok(());
        }
    };
    let dir_path = dir.path().to_path_buf();

    let (program, args): (String, Vec<String>) = if is_cpp(&language) {
        if let Err(e) = std::fs::write(dir_path.join("main.cpp"), &source) {
            fail(
                &app,
                &run_id,
                &format!("could not write the source file: {e}"),
            );
            return Ok(());
        }
        let (compiler, compile_args) = cpp_compile_argv(&cpp_compiler_command, "main.cpp");
        let compile_output = match no_window_command(&compiler)
            .args(&compile_args)
            .current_dir(&dir_path)
            .output()
        {
            Ok(output) => output,
            Err(e) => {
                fail(
                    &app,
                    &run_id,
                    &format!("could not run the configured compiler ({compiler}): {e}"),
                );
                return Ok(());
            }
        };
        if !compile_output.status.success() {
            emit_output(&app, &run_id, "stderr", &compile_output.stderr);
            let _ = app.emit(
                "code-run-exit",
                CodeRunExit {
                    run_id: run_id.clone(),
                    code: compile_output.status.code(),
                },
            );
            return Ok(());
        }
        (
            dir_path
                .join(cpp_binary_name())
                .to_string_lossy()
                .into_owned(),
            Vec::new(),
        )
    } else if language == "python" {
        if let Err(e) = std::fs::write(dir_path.join("main.py"), &source) {
            fail(
                &app,
                &run_id,
                &format!("could not write the source file: {e}"),
            );
            return Ok(());
        }
        python_argv(&python_command, "main.py")
    } else {
        fail(&app, &run_id, &format!("unsupported language: {language}"));
        return Ok(());
    };

    let mut child = match no_window_command(&program)
        .args(&args)
        .current_dir(&dir_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(e) => {
            fail(
                &app,
                &run_id,
                &format!("could not start the process ({program}): {e}"),
            );
            return Ok(());
        }
    };

    let stdin = child.stdin.take();
    let Some(stdout) = child.stdout.take() else {
        fail(&app, &run_id, "no stdout handle");
        let _ = child.kill();
        return Ok(());
    };
    let Some(stderr) = child.stderr.take() else {
        fail(&app, &run_id, "no stderr handle");
        let _ = child.kill();
        return Ok(());
    };

    spawn_reader(app.clone(), run_id.clone(), "stdout".to_string(), stdout);
    spawn_reader(app.clone(), run_id.clone(), "stderr".to_string(), stderr);

    {
        let mut guard = match state.0.lock() {
            Ok(guard) => guard,
            Err(e) => {
                fail(&app, &run_id, &format!("internal error: {e}"));
                return Ok(());
            }
        };
        guard.insert(
            run_id.clone(),
            Run {
                child,
                stdin,
                _temp_dir: dir,
            },
        );
    }

    spawn_supervisor(app, run_id, timeout_secs);
    Ok(())
}

/// Writes a line to the run's piped stdin — the wiring `input()`/`cin >>`
/// need. A no-op error, not a panic, if the run already exited: a stray
/// keystroke landing after the process closed is an ordinary race, not a
/// bug.
#[tauri::command]
pub fn send_input(run_id: String, text: String, state: State<'_, RunState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    let run = guard.get_mut(&run_id).ok_or("no such run")?;
    let stdin = run.stdin.as_mut().ok_or("this run has no stdin")?;
    stdin
        .write_all(text.as_bytes())
        .map_err(|e| e.to_string())?;
    stdin.write_all(b"\n").map_err(|e| e.to_string())?;
    stdin.flush().map_err(|e| e.to_string())
}

/// Kills the run and drops its temp directory. A no-op (`Ok(())`) if the
/// run has already exited or was never started — same "no session? no-op"
/// shape as `terminal::terminal_close`, so callers never need to check
/// first.
#[tauri::command]
pub fn stop_run(run_id: String, state: State<'_, RunState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(mut run) = guard.remove(&run_id) {
        let _ = run.child.kill();
        let _ = run.child.wait();
    }
    Ok(())
}

/// `python`, `cpp`, `c++`, or `c` — the only languages a Run button appears
/// on. MSVC's `cl.exe` is a known v1 gap (see the design doc).
pub fn is_cpp(language: &str) -> bool {
    matches!(language, "cpp" | "c++" | "c")
}

/// Probes `PATH` for `python3` then `python`.
pub fn detect_python_command() -> String {
    for candidate in ["python3", "python"] {
        if is_on_path(candidate) {
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
        if is_on_path(candidate) {
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

# In-Editor Code Execution (P10-2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (default) or superpowers:subagent-driven-development if explicitly requested.

**Goal:** Add a Run button to Python and C++ fenced code blocks that executes the block's content and streams stdout/stderr/exit status inline, with no sandbox and no auto-run — friction and visibility are the whole security model.

**Architecture:** A new Rust module (`commands/code_run.rs`) writes a code block's content to a file in a fresh temp directory it creates and controls, spawns the configured interpreter/compiler with no shell, and streams output back over Tauri events tagged with a client-generated run ID. A new TipTap/ProseMirror extension (`CodeBlockRun.ts`) renders a Run/Stop/output panel below eligible code blocks, gates the first run per note per session behind a native confirm dialog, and never persists anything about the run into the note.

**Tech Stack:** Rust (`std::process`, `tempfile`, existing `base64`/`serde` deps — no new Cargo dependencies), TypeScript/React, TipTap 3 / ProseMirror (`Plugin`, `Decoration.widget`), `@tauri-apps/api/event`, `@tauri-apps/plugin-dialog`.

**Spec:** `docs/specs/code-execution-design.md`

## Global Constraints

- No shell is ever invoked — every process spawn is `std::process::Command::new(program).args([...])`, one argument per `.arg()`/`.args()`, matching `editor_launch.rs`'s discipline.
- No argument or path passed to `std::process::Command` is derived from note text — only the app-generated temp file path and the user-configured interpreter/compiler command.
- Every run gets its own fresh `tempfile::TempDir`, deleted when the run ends (exit, timeout, or stop).
- Default timeout is 10 seconds (`code_run_timeout_secs`), user-configurable in Settings.
- Supported languages: `python`, `cpp`, `c++`, `c`. MSVC (`cl.exe`) is out of scope.
- Confirmation is per-note, per-session, in-memory only (Zustand) — never written to `settings.json`, the note file, or `index.db`.
- No run is ever triggered automatically (note open, external watcher reload, Git pull, PDF import) — only an explicit Run click.
- All new `AppSettings` fields use `#[serde(default = ...)]` (or plain `#[serde(default)]` for empty-string-means-detect fields) so an older `settings.json` still loads.
- All new IPC struct fields use `#[serde(rename_all = "camelCase")]`, matching every existing struct crossing the Tauri IPC boundary.

---

### Task 1: `code_run.rs` — pure helpers (toolchain detection, argv builders, timeout decision)

**Files:**
- Create: `src-tauri/src/commands/code_run.rs`
- Modify: `src-tauri/src/commands/mod.rs` (add `pub mod code_run;`)

**Interfaces:**
- Produces: `pub fn detect_python_command() -> String`, `pub fn detect_cpp_compiler_command() -> String`, `pub fn cpp_binary_name() -> &'static str`, `pub fn python_argv(python_command: &str, script_path: &str) -> (String, Vec<String>)`, `pub fn cpp_compile_argv(cpp_compiler_command: &str, source_path: &str) -> (String, Vec<String>)`, `pub fn is_cpp(language: &str) -> bool`, `pub fn has_timed_out(elapsed: std::time::Duration, limit_secs: u64) -> bool` — all consumed by Task 2 (settings detection) and Task 3 (the run command).

- [ ] **Step 1: Write the failing tests**

```rust
// bottom of src-tauri/src/commands/code_run.rs, first draft with no
// implementation above it yet
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml code_run:: -- --nocapture`
Expected: FAIL to compile — `python_argv`, `cpp_compile_argv`, `cpp_binary_name`, `is_cpp`, `has_timed_out` are not defined.

- [ ] **Step 3: Write the minimal implementation**

Add above the `#[cfg(test)]` block:

```rust
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
```

- [ ] **Step 4: Register the module**

In `src-tauri/src/commands/mod.rs`, add alphabetically:

```rust
pub mod code_run;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml code_run::`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/code_run.rs src-tauri/src/commands/mod.rs
git commit -m "feat: add pure argv/detection helpers for code execution (P10-2)"
```

---

### Task 2: Settings — `python_command`, `cpp_compiler_command`, `code_run_timeout_secs`

**Files:**
- Modify: `src-tauri/src/models.rs` (`AppSettings` struct, `Default` impl)
- Modify: `src-tauri/src/commands/settings.rs` (`load_settings_from_dir`, tests)

**Interfaces:**
- Consumes: `code_run::detect_python_command`, `code_run::detect_cpp_compiler_command` (Task 1).
- Produces: `AppSettings.python_command: String`, `AppSettings.cpp_compiler_command: String`, `AppSettings.code_run_timeout_secs: u32` — consumed by Task 3/4 (passed through from the frontend to `run_code`) and by Task 5 (TS mirror type).

- [ ] **Step 1: Write the failing tests**

In `src-tauri/src/commands/settings.rs`, extend the existing `test_roundtrip` literal (it will fail to compile otherwise) and add three new tests, placed after `test_an_empty_terminal_shell_is_filled_in_on_load`:

```rust
    #[tokio::test]
    async fn test_an_empty_python_command_is_filled_in_on_load() {
        let dir = tempdir().unwrap();
        tokio::fs::write(
            dir.path().join(SETTINGS_FILE),
            r#"{"autosaveDebounceMs":600,"editorMaxWidthPx":800}"#,
        )
        .await
        .unwrap();

        let loaded = load_settings_from_dir(dir.path()).await.unwrap();

        assert!(!loaded.python_command.trim().is_empty(), "got {:?}", loaded.python_command);
    }

    #[tokio::test]
    async fn test_a_configured_python_command_survives_detection() {
        let dir = tempdir().unwrap();
        let mut settings = AppSettings::default();
        settings.python_command = "python3.11".to_string();
        save_settings_to_dir(dir.path(), &settings).await.unwrap();

        let loaded = load_settings_from_dir(dir.path()).await.unwrap();

        assert_eq!(loaded.python_command, "python3.11");
    }

    #[tokio::test]
    async fn test_an_empty_cpp_compiler_command_is_filled_in_on_load() {
        let dir = tempdir().unwrap();
        tokio::fs::write(
            dir.path().join(SETTINGS_FILE),
            r#"{"autosaveDebounceMs":600,"editorMaxWidthPx":800}"#,
        )
        .await
        .unwrap();

        let loaded = load_settings_from_dir(dir.path()).await.unwrap();

        assert!(!loaded.cpp_compiler_command.trim().is_empty(), "got {:?}", loaded.cpp_compiler_command);
    }
```

Also add to `test_load_tolerates_a_file_missing_newer_fields`, after the existing `code_font_size_px` assertion:

```rust
        assert_eq!(loaded.code_run_timeout_secs, 10);
```

Update `test_roundtrip`'s `AppSettings { ... }` literal to add the three new fields (it will not compile without them):

```rust
            python_command: "python3.11".to_string(),
            cpp_compiler_command: "clang++".to_string(),
            code_run_timeout_secs: 30,
```

and its assertions, after the existing `code_font_size_px` assertion:

```rust
        assert_eq!(loaded.python_command, "python3.11");
        assert_eq!(loaded.cpp_compiler_command, "clang++");
        assert_eq!(loaded.code_run_timeout_secs, 30);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml settings::`
Expected: FAIL to compile — `AppSettings` has no field `python_command`/`cpp_compiler_command`/`code_run_timeout_secs`.

- [ ] **Step 3: Write the minimal implementation**

In `src-tauri/src/models.rs`, add fields to `AppSettings` right after `pub code_font_size_px: u32,`:

```rust
    /// Interpreter for `python` code blocks (P10-2). Same detect-on-empty
    /// shape as `editor_command`. Tokenized and run without a shell — see
    /// `commands::code_run`.
    #[serde(default)]
    pub python_command: String,
    /// Compiler for `cpp`/`c++`/`c` code blocks (P10-2). MSVC's `cl.exe`
    /// isn't probed for — see `docs/specs/code-execution-design.md`.
    #[serde(default)]
    pub cpp_compiler_command: String,
    /// Wall-clock seconds before a running code block is killed
    /// automatically — the only resource limit P10-2 applies.
    #[serde(default = "default_code_run_timeout_secs")]
    pub code_run_timeout_secs: u32,
```

Add the default function next to `default_code_font_size_px`:

```rust
fn default_code_run_timeout_secs() -> u32 {
    10
}
```

Update `impl Default for AppSettings`, adding after `code_font_size_px: default_code_font_size_px(),`:

```rust
            python_command: String::new(),
            cpp_compiler_command: String::new(),
            code_run_timeout_secs: default_code_run_timeout_secs(),
```

In `src-tauri/src/commands/settings.rs`, add to `load_settings_from_dir` after the existing `terminal_shell` detection block:

```rust
    if settings.python_command.trim().is_empty() {
        settings.python_command = super::code_run::detect_python_command();
    }
    if settings.cpp_compiler_command.trim().is_empty() {
        settings.cpp_compiler_command = super::code_run::detect_cpp_compiler_command();
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml settings::`
Expected: PASS, all settings tests including the 3 new ones.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/models.rs src-tauri/src/commands/settings.rs
git commit -m "feat: add python/cpp toolchain and run-timeout settings (P10-2)"
```

---

### Task 3: `run_code` command — spawn, stream output, timeout

**Files:**
- Modify: `src-tauri/src/commands/code_run.rs`

**Interfaces:**
- Consumes: `is_cpp`, `python_argv`, `cpp_compile_argv`, `cpp_binary_name`, `has_timed_out` (Task 1); `super::editor_launch::tokenize` (existing).
- Produces: `pub struct RunState(pub Mutex<HashMap<String, Run>>)` (with `#[derive(Default)]`), `#[tauri::command] pub fn run_code(run_id: String, language: String, source: String, python_command: String, cpp_compiler_command: String, timeout_secs: u64, app: AppHandle, state: State<'_, RunState>) -> Result<(), String>` — consumed by Task 4 (`send_input`/`stop_run` share `RunState`) and Task 5 (frontend `api.codeRun.run`). Emits Tauri events `code-run-output` (`{ runId, stream, data }`, `data` base64), `code-run-exit` (`{ runId, code }`), `code-run-timeout` (`{ runId }`).

This task's spawn/IO/timeout path is the same category as `terminal.rs`'s PTY spawn — not realistically unit-testable without a real OS process and a real Tauri `AppHandle`, which is why `terminal.rs` itself has no test beyond its pure `parse_shell`. Verification here is `cargo build`/`cargo clippy` (compiles, no warnings) plus the manual QA checklist in Task 11 — matching the codebase's own established precedent for this exact category of code.

- [ ] **Step 1: Add the event payload structs and `RunState`**

At the top of `src-tauri/src/commands/code_run.rs`, after the existing `use` lines, add:

```rust
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use std::time::Instant;
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
pub struct RunState(pub Mutex<HashMap<String, Run>>);

fn emit_output(app: &AppHandle, run_id: &str, stream: &str, bytes: &[u8]) {
    if bytes.is_empty() {
        return;
    }
    let data = base64::engine::general_purpose::STANDARD.encode(bytes);
    let _ = app.emit(
        "code-run-output",
        CodeRunOutput { run_id: run_id.to_string(), stream: stream.to_string(), data },
    );
}
```

Add `use base64::Engine;` alongside the other `use` lines (needed for `.encode`).

- [ ] **Step 2: Add the reader and supervisor threads**

```rust
/// Reads one stream to EOF, emitting each chunk as it arrives. Two of these
/// run per process (stdout, stderr) — the same "one thread per pipe" shape
/// as `terminal.rs`'s single reader thread, doubled because a piped child
/// (unlike a PTY) keeps stdout and stderr as genuinely separate streams.
fn spawn_reader<R: Read + Send + 'static>(app: AppHandle, run_id: String, stream: String, mut reader: R) {
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
            std::thread::sleep(std::time::Duration::from_millis(100));
            let state = app.state::<RunState>();
            let Ok(mut guard) = state.0.lock() else { return };
            let Some(run) = guard.get_mut(&run_id) else { return };

            match run.child.try_wait() {
                Ok(Some(status)) => {
                    guard.remove(&run_id);
                    drop(guard);
                    let _ = app.emit(
                        "code-run-exit",
                        CodeRunExit { run_id: run_id.clone(), code: status.code() },
                    );
                    return;
                }
                Ok(None) => {
                    if has_timed_out(started.elapsed(), timeout_secs) {
                        let _ = run.child.kill();
                        let _ = run.child.wait();
                        guard.remove(&run_id);
                        drop(guard);
                        let _ = app.emit("code-run-timeout", CodeRunTimeout { run_id: run_id.clone() });
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
```

- [ ] **Step 3: Add the `run_code` command**

```rust
/// Writes the block's content to a fresh temp directory and runs it with no
/// shell. For C++, compiles first — a failed compile emits its stderr and a
/// `code-run-exit` for the compiler's own exit code, and the binary is
/// never invoked. `run_id` is generated by the caller (the frontend) so it
/// can subscribe to this run's events before invoking, closing the race a
/// backend-generated ID would leave between "process starts producing
/// output" and "listener attached."
#[tauri::command]
pub fn run_code(
    run_id: String,
    language: String,
    source: String,
    python_command: String,
    cpp_compiler_command: String,
    timeout_secs: u64,
    app: AppHandle,
    state: State<'_, RunState>,
) -> Result<(), String> {
    let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
    let dir_path = dir.path().to_path_buf();

    let (program, args): (String, Vec<String>) = if is_cpp(&language) {
        std::fs::write(dir_path.join("main.cpp"), &source).map_err(|e| e.to_string())?;
        let (compiler, compile_args) = cpp_compile_argv(&cpp_compiler_command, "main.cpp");
        let compile_output = Command::new(&compiler)
            .args(&compile_args)
            .current_dir(&dir_path)
            .output()
            .map_err(|e| format!("could not run the configured compiler: {e}"))?;
        if !compile_output.status.success() {
            emit_output(&app, &run_id, "stderr", &compile_output.stderr);
            let _ = app.emit(
                "code-run-exit",
                CodeRunExit { run_id: run_id.clone(), code: compile_output.status.code() },
            );
            return Ok(());
        }
        (dir_path.join(cpp_binary_name()).to_string_lossy().into_owned(), Vec::new())
    } else if language == "python" {
        std::fs::write(dir_path.join("main.py"), &source).map_err(|e| e.to_string())?;
        python_argv(&python_command, "main.py")
    } else {
        return Err(format!("unsupported language: {language}"));
    };

    let mut child = Command::new(&program)
        .args(&args)
        .current_dir(&dir_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("could not start the process: {e}"))?;

    let stdin = child.stdin.take();
    let stdout = child.stdout.take().ok_or("no stdout handle")?;
    let stderr = child.stderr.take().ok_or("no stderr handle")?;

    spawn_reader(app.clone(), run_id.clone(), "stdout".to_string(), stdout);
    spawn_reader(app.clone(), run_id.clone(), "stderr".to_string(), stderr);

    {
        let mut guard = state.0.lock().map_err(|e| e.to_string())?;
        guard.insert(run_id.clone(), Run { child, stdin, _temp_dir: dir });
    }

    spawn_supervisor(app, run_id, timeout_secs);
    Ok(())
}
```

- [ ] **Step 4: Register the command**

In `src-tauri/src/commands/mod.rs` — no change needed, `code_run` is already declared (Task 1).

In `src-tauri/src/lib.rs`, add to the `.setup()` block, alongside the other `app.manage(...)` calls:

```rust
            app.manage(commands::code_run::RunState::default());
```

Add to `.invoke_handler(tauri::generate_handler![...])`, after the `commands::terminal::*` group:

```rust
            commands::code_run::run_code,
```

- [ ] **Step 5: Verify it compiles clean**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: builds with no errors.

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`
Expected: no warnings.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/code_run.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat: spawn and stream code-block execution with a wall-clock timeout (P10-2)"
```

---

### Task 4: `send_input` and `stop_run` commands

**Files:**
- Modify: `src-tauri/src/commands/code_run.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `RunState` (Task 3).
- Produces: `#[tauri::command] pub fn send_input(run_id: String, text: String, state: State<'_, RunState>) -> Result<(), String>`, `#[tauri::command] pub fn stop_run(run_id: String, state: State<'_, RunState>) -> Result<(), String>` — consumed by Task 5 (`api.codeRun.sendInput`/`api.codeRun.stop`).

Same "manually QA'd, not unit tested" category as Task 3 — see that task's note.

- [ ] **Step 1: Add the commands**

In `src-tauri/src/commands/code_run.rs`, after `run_code`:

```rust
/// Writes a line to the run's piped stdin — the wiring `input()`/`cin >>`
/// need. A no-op error, not a panic, if the run already exited: a stray
/// keystroke landing after the process closed is an ordinary race, not a
/// bug.
#[tauri::command]
pub fn send_input(run_id: String, text: String, state: State<'_, RunState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    let run = guard.get_mut(&run_id).ok_or("no such run")?;
    let stdin = run.stdin.as_mut().ok_or("this run has no stdin")?;
    stdin.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
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
```

- [ ] **Step 2: Register the commands**

In `src-tauri/src/lib.rs`, add after `commands::code_run::run_code,`:

```rust
            commands::code_run::send_input,
            commands::code_run::stop_run,
```

- [ ] **Step 3: Verify it compiles clean**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: builds with no errors.

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`
Expected: no warnings.

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: full backend suite still passes (no regressions in `code_run::` or `settings::`).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/code_run.rs src-tauri/src/lib.rs
git commit -m "feat: add stdin and stop commands for running code blocks (P10-2)"
```

---

### Task 5: Frontend types, settings defaults, and `api.codeRun`

**Files:**
- Modify: `src/types/index.ts` (`AppSettings` interface)
- Modify: `src/store/settings.ts` (`DEFAULT_SETTINGS`)
- Modify: `src/store/settings.test.ts` (round-trip object literals)
- Modify: `src/lib/tauri.ts` (`api.codeRun`)

**Interfaces:**
- Produces: `AppSettings.pythonCommand: string`, `AppSettings.cppCompilerCommand: string`, `AppSettings.codeRunTimeoutSecs: number`; `api.codeRun.run(runId, language, source, pythonCommand, cppCompilerCommand, timeoutSecs): Promise<void>`, `api.codeRun.sendInput(runId, text): Promise<void>`, `api.codeRun.stop(runId): Promise<void>` — consumed by Task 6 (Settings UI) and Task 9 (the run panel).

- [ ] **Step 1: Write the failing test**

In `src/store/settings.test.ts`, add the three new fields to both object literals in the `'replaces the settings wholesale'` test:

```ts
      autosaveDebounceMs: 1200,
      editorMaxWidthPx: 960,
      spellcheck: true,
      spellcheckLanguage: 'en',
      pdfImportMode: 'markdown',
      editorCommand: 'nvim +{line} {file}',
      terminalShell: 'wsl -d Ubuntu',
      codeIndentWidth: 4,
      codeIndentChar: 'tab',
      codeTheme: 'one-dark',
      codeFontSizePx: 16,
      pythonCommand: 'python3.11',
      cppCompilerCommand: 'clang++',
      codeRunTimeoutSecs: 30,
```

(apply the same three lines to both the `setSettings(...)` call and the `expect(...).toEqual({...})` object — they must match exactly.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- src/store/settings.test.ts`
Expected: FAIL — TypeScript error, `AppSettings` has no properties `pythonCommand`/`cppCompilerCommand`/`codeRunTimeoutSecs`.

- [ ] **Step 3: Write the minimal implementation**

In `src/types/index.ts`, add to the `AppSettings` interface, after `codeFontSizePx: number`:

```ts
  /** Interpreter for `python` code blocks. Empty means "detect on next load." */
  pythonCommand: string
  /** Compiler for `cpp`/`c++`/`c` code blocks. MSVC's `cl.exe` isn't detected. */
  cppCompilerCommand: string
  /** Wall-clock seconds before a running code block is killed automatically. */
  codeRunTimeoutSecs: number
```

In `src/store/settings.ts`, add to `DEFAULT_SETTINGS`, after `codeFontSizePx: 13,`:

```ts
  pythonCommand: 'python3',
  cppCompilerCommand: 'g++',
  codeRunTimeoutSecs: 10,
```

In `src/lib/tauri.ts`, add a new top-level key after `terminal: { ... }`:

```ts
  codeRun: {
    run: (
      runId: string,
      language: string,
      source: string,
      pythonCommand: string,
      cppCompilerCommand: string,
      timeoutSecs: number,
    ) =>
      invoke<void>('run_code', { runId, language, source, pythonCommand, cppCompilerCommand, timeoutSecs }),
    sendInput: (runId: string, text: string) =>
      invoke<void>('send_input', { runId, text }),
    stop: (runId: string) =>
      invoke<void>('stop_run', { runId }),
  },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- src/store/settings.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts src/store/settings.ts src/store/settings.test.ts src/lib/tauri.ts
git commit -m "feat: add code-execution settings and api.codeRun wrappers (P10-2)"
```

---

### Task 6: Settings panel fields

**Files:**
- Modify: `src/components/SettingsPanel.tsx`

**Interfaces:**
- Consumes: `settings.pythonCommand`, `settings.cppCompilerCommand`, `settings.codeRunTimeoutSecs` (Task 5), the existing `update(patch: Partial<typeof settings>)` helper already defined in this file.

No automated test exists for any row in this file's "Tools" section today (`editorCommand`/`terminalShell` have none either) — this task follows that precedent. Verified manually (Task 11).

- [ ] **Step 1: Add the three fields**

In `src/components/SettingsPanel.tsx`, inside the `<div className="settings-section">` that has `<p className="section-label">Tools</p>`, after the existing "Terminal shell" `<label className="settings-row">...</label>` block:

```tsx
            <label className="settings-row">
              <span>
                Python command
                <small>
                  Runs a <code>python</code> code block&apos;s Run button. No shell, no sandbox — same trust
                  level as typing it into the terminal. Detected on first load.
                </small>
              </span>
              <span className="settings-row-control">
                <input
                  type="text"
                  className="settings-text settings-text-wide"
                  value={settings.pythonCommand}
                  onChange={(e) => void update({ pythonCommand: e.target.value })}
                />
              </span>
            </label>

            <label className="settings-row">
              <span>
                C++ compiler command
                <small>
                  Compiles a <code>cpp</code> code block before running it. MSVC (<code>cl.exe</code>) isn&apos;t
                  detected. Detected on first load.
                </small>
              </span>
              <span className="settings-row-control">
                <input
                  type="text"
                  className="settings-text settings-text-wide"
                  value={settings.cppCompilerCommand}
                  onChange={(e) => void update({ cppCompilerCommand: e.target.value })}
                />
              </span>
            </label>

            <label className="settings-row">
              <span>
                Run timeout (seconds)
                <small>A running code block is killed automatically after this many seconds.</small>
              </span>
              <span className="settings-row-control">
                <input
                  type="number"
                  min={1}
                  className="settings-text"
                  value={settings.codeRunTimeoutSecs}
                  onChange={(e) => void update({ codeRunTimeoutSecs: Number(e.target.value) || 1 })}
                />
              </span>
            </label>
```

- [ ] **Step 2: Verify it typechecks and builds**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm run build`
Expected: builds successfully.

- [ ] **Step 3: Commit**

```bash
git add src/components/SettingsPanel.tsx
git commit -m "feat: add code-execution fields to the settings panel (P10-2)"
```

---

### Task 7: Per-note, per-session run confirmation

**Files:**
- Create: `src/store/codeRunConfirm.ts`
- Create: `src/store/codeRunConfirm.test.ts`

**Interfaces:**
- Produces: `useCodeRunConfirmStore` with state `{ confirmedNotes: Set<string> }` and action `confirmNote(notePath: string): Promise<boolean>` — consumed by Task 9 (the Run click handler).

- [ ] **Step 1: Write the failing test**

```ts
// src/store/codeRunConfirm.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { confirm } from '@tauri-apps/plugin-dialog'

vi.mock('@tauri-apps/plugin-dialog', () => ({
  confirm: vi.fn(),
}))

const { useCodeRunConfirmStore } = await import('./codeRunConfirm')
const dialog = vi.mocked({ confirm })

beforeEach(() => {
  useCodeRunConfirmStore.setState({ confirmedNotes: new Set() })
  dialog.confirm.mockReset()
})

describe('useCodeRunConfirmStore', () => {
  it('asks for confirmation the first time a note runs code', async () => {
    dialog.confirm.mockResolvedValue(true)

    const allowed = await useCodeRunConfirmStore.getState().confirmNote('/ws/a.md')

    expect(allowed).toBe(true)
    expect(dialog.confirm).toHaveBeenCalledTimes(1)
  })

  it('does not ask again for the same note once confirmed', async () => {
    dialog.confirm.mockResolvedValue(true)

    await useCodeRunConfirmStore.getState().confirmNote('/ws/a.md')
    const allowed = await useCodeRunConfirmStore.getState().confirmNote('/ws/a.md')

    expect(allowed).toBe(true)
    expect(dialog.confirm).toHaveBeenCalledTimes(1)
  })

  it('asks again for a different note', async () => {
    dialog.confirm.mockResolvedValue(true)

    await useCodeRunConfirmStore.getState().confirmNote('/ws/a.md')
    await useCodeRunConfirmStore.getState().confirmNote('/ws/b.md')

    expect(dialog.confirm).toHaveBeenCalledTimes(2)
  })

  it('does not remember a declined confirmation', async () => {
    dialog.confirm.mockResolvedValue(false)

    const first = await useCodeRunConfirmStore.getState().confirmNote('/ws/a.md')
    const second = await useCodeRunConfirmStore.getState().confirmNote('/ws/a.md')

    expect(first).toBe(false)
    expect(second).toBe(false)
    expect(dialog.confirm).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- src/store/codeRunConfirm.test.ts`
Expected: FAIL — cannot find module `./codeRunConfirm`.

- [ ] **Step 3: Write the minimal implementation**

```ts
// src/store/codeRunConfirm.ts
import { create } from 'zustand'
import { confirm } from '@tauri-apps/plugin-dialog'

interface CodeRunConfirmStore {
  confirmedNotes: Set<string>
  confirmNote: (notePath: string) => Promise<boolean>
}

/**
 * Gates the first code-block run per note per app session behind a native
 * confirm dialog (P10-2). In-memory only — nothing here is written to
 * `settings.json`, the note file, or `index.db`, so every fresh session
 * re-asks. This is the feature's whole security model: friction and
 * visibility, not a sandbox. See docs/specs/code-execution-design.md.
 */
export const useCodeRunConfirmStore = create<CodeRunConfirmStore>((set, get) => ({
  confirmedNotes: new Set(),
  confirmNote: async (notePath) => {
    if (get().confirmedNotes.has(notePath)) return true

    const allowed = await confirm(
      'This note contains code. Allow it to run on your machine? ' +
        'It runs with no sandbox — the same trust level as typing it into the terminal.',
    )
    if (allowed) {
      set((state) => ({ confirmedNotes: new Set(state.confirmedNotes).add(notePath) }))
    }
    return allowed
  },
}))
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- src/store/codeRunConfirm.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/store/codeRunConfirm.ts src/store/codeRunConfirm.test.ts
git commit -m "feat: add per-note per-session confirmation gate for code execution (P10-2)"
```

---

### Task 8: `CodeBlockRun.ts` — pure state reducer

**Files:**
- Create: `src/editor/extensions/CodeBlockRun.ts`
- Create: `src/editor/extensions/codeBlockRun.test.ts`

**Interfaces:**
- Produces: `RUNNABLE_LANGUAGES: Set<string>`, `interface RunEntry { runId: string; status: 'starting' | 'running' | 'exited' | 'timeout' | 'stopped'; exitCode: number | null; output: { stream: 'stdout' | 'stderr'; text: string }[] }`, `type CodeRunMeta` (union below), `applyCodeRunMeta(entries: Map<number, RunEntry>, meta: CodeRunMeta): Map<number, RunEntry>`, `decodeBase64Text(base64: string): string` — consumed by Task 9 (the ProseMirror plugin wraps these in `Plugin.state.apply` and the output/click handlers).

- [ ] **Step 1: Write the failing tests**

```ts
// src/editor/extensions/codeBlockRun.test.ts
import { describe, it, expect } from 'vitest'
import { applyCodeRunMeta, decodeBase64Text } from './CodeBlockRun'
import type { RunEntry } from './CodeBlockRun'

describe('decodeBase64Text', () => {
  it('round-trips plain ASCII', () => {
    expect(decodeBase64Text(btoa('hello\n'))).toBe('hello\n')
  })
})

describe('applyCodeRunMeta', () => {
  it('start creates a fresh entry at the given position', () => {
    const entries = applyCodeRunMeta(new Map(), { type: 'start', pos: 5, runId: 'r1' })
    expect(entries.get(5)).toEqual<RunEntry>({ runId: 'r1', status: 'starting', exitCode: null, output: [] })
  })

  it('start replaces a prior entry at the same position', () => {
    const first = applyCodeRunMeta(new Map(), { type: 'start', pos: 5, runId: 'r1' })
    const withOutput = applyCodeRunMeta(first, { type: 'output', runId: 'r1', stream: 'stdout', text: 'old\n' })

    const restarted = applyCodeRunMeta(withOutput, { type: 'start', pos: 5, runId: 'r2' })

    expect(restarted.get(5)).toEqual<RunEntry>({ runId: 'r2', status: 'starting', exitCode: null, output: [] })
  })

  it('output appends a chunk and flips status to running', () => {
    const started = applyCodeRunMeta(new Map(), { type: 'start', pos: 5, runId: 'r1' })
    const next = applyCodeRunMeta(started, { type: 'output', runId: 'r1', stream: 'stdout', text: 'hi\n' })

    expect(next.get(5)).toEqual<RunEntry>({
      runId: 'r1',
      status: 'running',
      exitCode: null,
      output: [{ stream: 'stdout', text: 'hi\n' }],
    })
  })

  it('output for an unknown run id is a no-op', () => {
    const started = applyCodeRunMeta(new Map(), { type: 'start', pos: 5, runId: 'r1' })
    const next = applyCodeRunMeta(started, { type: 'output', runId: 'other', stream: 'stdout', text: 'hi\n' })

    expect(next).toBe(started)
  })

  it('exit sets status and exit code', () => {
    const started = applyCodeRunMeta(new Map(), { type: 'start', pos: 5, runId: 'r1' })
    const next = applyCodeRunMeta(started, { type: 'exit', runId: 'r1', code: 2 })

    expect(next.get(5)).toEqual<RunEntry>({ runId: 'r1', status: 'exited', exitCode: 2, output: [] })
  })

  it('timeout sets status without an exit code', () => {
    const started = applyCodeRunMeta(new Map(), { type: 'start', pos: 5, runId: 'r1' })
    const next = applyCodeRunMeta(started, { type: 'timeout', runId: 'r1' })

    expect(next.get(5)?.status).toBe('timeout')
  })

  it('stopped sets status immediately, without waiting on the backend', () => {
    const started = applyCodeRunMeta(new Map(), { type: 'start', pos: 5, runId: 'r1' })
    const next = applyCodeRunMeta(started, { type: 'stopped', runId: 'r1' })

    expect(next.get(5)?.status).toBe('stopped')
  })

  it('close removes the entry at a position', () => {
    const started = applyCodeRunMeta(new Map(), { type: 'start', pos: 5, runId: 'r1' })
    const next = applyCodeRunMeta(started, { type: 'close', pos: 5 })

    expect(next.has(5)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- src/editor/extensions/codeBlockRun.test.ts`
Expected: FAIL — cannot find module `./CodeBlockRun`.

- [ ] **Step 3: Write the minimal implementation**

```ts
// src/editor/extensions/CodeBlockRun.ts
export const RUNNABLE_LANGUAGES = new Set(['python', 'cpp', 'c++', 'c'])

export interface RunEntry {
  runId: string
  status: 'starting' | 'running' | 'exited' | 'timeout' | 'stopped'
  exitCode: number | null
  output: { stream: 'stdout' | 'stderr'; text: string }[]
}

export type CodeRunMeta =
  | { type: 'start'; pos: number; runId: string }
  | { type: 'output'; runId: string; stream: 'stdout' | 'stderr'; text: string }
  | { type: 'exit'; runId: string; code: number | null }
  | { type: 'timeout'; runId: string }
  | { type: 'stopped'; runId: string }
  | { type: 'close'; pos: number }

function posForRunId(entries: Map<number, RunEntry>, runId: string): number | null {
  for (const [pos, entry] of entries) {
    if (entry.runId === runId) return pos
  }
  return null
}

/**
 * Pure reducer backing `CodeBlockRun`'s ProseMirror plugin state — kept
 * separate from the plugin itself so the transition logic is unit-testable
 * without mounting an editor, the same split `CodeBlockSearch.ts`'s
 * `findMatches` makes.
 */
export function applyCodeRunMeta(entries: Map<number, RunEntry>, meta: CodeRunMeta): Map<number, RunEntry> {
  if (meta.type === 'start') {
    const next = new Map(entries)
    next.set(meta.pos, { runId: meta.runId, status: 'starting', exitCode: null, output: [] })
    return next
  }

  if (meta.type === 'close') {
    if (!entries.has(meta.pos)) return entries
    const next = new Map(entries)
    next.delete(meta.pos)
    return next
  }

  const pos = posForRunId(entries, meta.runId)
  if (pos === null) return entries
  // Non-null: `pos` came from `posForRunId`, which only ever returns a key
  // that exists in `entries`.
  const entry = entries.get(pos)!

  if (meta.type === 'output') {
    const next = new Map(entries)
    next.set(pos, {
      ...entry,
      status: entry.status === 'starting' ? 'running' : entry.status,
      output: [...entry.output, { stream: meta.stream, text: meta.text }],
    })
    return next
  }

  if (meta.type === 'exit') {
    const next = new Map(entries)
    next.set(pos, { ...entry, status: 'exited', exitCode: meta.code })
    return next
  }

  if (meta.type === 'timeout') {
    const next = new Map(entries)
    next.set(pos, { ...entry, status: 'timeout' })
    return next
  }

  // 'stopped'
  const next = new Map(entries)
  next.set(pos, { ...entry, status: 'stopped' })
  return next
}

/** Base64 (as emitted by `commands::code_run::emit_output`) to a UTF-8 string. */
export function decodeBase64Text(base64: string): string {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- src/editor/extensions/codeBlockRun.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/editor/extensions/CodeBlockRun.ts src/editor/extensions/codeBlockRun.test.ts
git commit -m "feat: add the pure run-state reducer for code-block execution (P10-2)"
```

---

### Task 9: `CodeBlockRun.ts` — ProseMirror plugin, panel UI, and wiring

**Files:**
- Modify: `src/editor/extensions/CodeBlockRun.ts`
- Modify: `src/editor/extensions/codeBlockRun.test.ts`
- Modify: `src/editor/extensions/index.ts` (register in `coreExtensions`)

**Interfaces:**
- Consumes: `applyCodeRunMeta`, `decodeBase64Text`, `RUNNABLE_LANGUAGES`, `RunEntry`, `CodeRunMeta` (Task 8); `api.codeRun` (Task 5); `useCodeRunConfirmStore` (Task 7); `useWorkspaceStore.getState().activeTab` (existing, gives the open note's path); `listen` from `@tauri-apps/api/event` (existing dependency, already used by `useTerminal.ts`).
- Produces: `export const CodeBlockRun` (a TipTap `Extension`), added to `coreExtensions` in `src/editor/extensions/index.ts` — this is what makes the Run button appear in the actual editor.

- [ ] **Step 1: Write the failing test**

Add to `src/editor/extensions/codeBlockRun.test.ts`, above the existing `describe` blocks:

```ts
import { afterEach, vi, beforeEach as vitestBeforeEach } from 'vitest'

vi.mock('../../lib/tauri', () => ({
  api: { codeRun: { run: vi.fn(), sendInput: vi.fn(), stop: vi.fn() } },
}))
vi.mock('../../store/codeRunConfirm', () => ({
  useCodeRunConfirmStore: { getState: () => ({ confirmNote: vi.fn().mockResolvedValue(true) }) },
}))
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}))

const { Editor } = await import('@tiptap/core')
const { coreExtensions } = await import('./index')

let editor: InstanceType<typeof Editor> | null = null

function mount(content: string) {
  const element = document.createElement('div')
  document.body.appendChild(element)
  editor = new Editor({ element, extensions: coreExtensions, content })
  return editor
}

function codeBlock(language: string, text = 'print(1)'): string {
  return `<pre><code class="language-${language}">${text}</code></pre>`
}

vitestBeforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  editor?.destroy()
  editor = null
  document.body.innerHTML = ''
})

describe('CodeBlockRun panel visibility', () => {
  it('shows a Run button on a python code block', () => {
    mount(codeBlock('python'))
    expect(editor?.view.dom.querySelector('.code-run-run')).not.toBeNull()
  })

  it('shows a Run button on a cpp code block', () => {
    mount(codeBlock('cpp', 'int main(){}'))
    expect(editor?.view.dom.querySelector('.code-run-run')).not.toBeNull()
  })

  it('does not show a Run button on an unsupported language', () => {
    mount(codeBlock('rust', 'fn main() {}'))
    expect(editor?.view.dom.querySelector('.code-run-run')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- src/editor/extensions/codeBlockRun.test.ts`
Expected: FAIL — `CodeBlockRun` is not exported / not registered, so no `.code-run-run` element exists.

- [ ] **Step 3: Write the minimal implementation**

Append to `src/editor/extensions/CodeBlockRun.ts` (after the Task 8 code):

```ts
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorState } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { listen } from '@tauri-apps/api/event'
import { api } from '../../lib/tauri'
import { useCodeRunConfirmStore } from '../../store/codeRunConfirm'
import { useSettingsStore } from '../../store/settings'
import { useWorkspaceStore } from '../../store/workspace'

/**
 * Run button + output panel on every `python`/`cpp`/`c++`/`c` code block
 * (P10-2). No sandbox — see docs/specs/code-execution-design.md. Nothing
 * here is written to the note: the panel is a widget decoration, and its
 * content lives entirely in this plugin's own state, the same
 * presentation-only shape as `CodeBlockToolbar`'s fold state and
 * `CodeBlockSearch`'s query state.
 */

const codeRunKey = new PluginKey<Map<number, RunEntry>>('codeBlockRun')

interface OutputPayload {
  runId: string
  stream: 'stdout' | 'stderr'
  data: string
}
interface ExitPayload {
  runId: string
  code: number | null
}
interface TimeoutPayload {
  runId: string
}

function runPanel(pos: number): HTMLElement {
  const panel = document.createElement('div')
  panel.className = 'code-run-panel'
  panel.contentEditable = 'false'
  panel.setAttribute('data-code-run-pos', String(pos))

  const run = document.createElement('button')
  run.type = 'button'
  run.className = 'code-run-run'
  run.dataset['action'] = 'run'
  run.textContent = 'Run'
  panel.appendChild(run)

  const stop = document.createElement('button')
  stop.type = 'button'
  stop.className = 'code-run-stop'
  stop.dataset['action'] = 'stop'
  stop.textContent = 'Stop'
  stop.hidden = true
  panel.appendChild(stop)

  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'code-run-close'
  close.dataset['action'] = 'close'
  close.textContent = 'Dismiss'
  close.hidden = true
  panel.appendChild(close)

  const output = document.createElement('pre')
  output.className = 'code-run-output'
  output.hidden = true
  panel.appendChild(output)

  const stdinRow = document.createElement('div')
  stdinRow.className = 'code-run-stdin-row'
  stdinRow.hidden = true
  const stdinInput = document.createElement('input')
  stdinInput.type = 'text'
  stdinInput.className = 'code-run-stdin'
  stdinInput.placeholder = 'stdin…'
  stdinRow.appendChild(stdinInput)
  panel.appendChild(stdinRow)

  return panel
}

function decorate(state: EditorState): DecorationSet {
  const decorations: Decoration[] = []
  state.doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return true
    const language = String(node.attrs['language'] ?? '')
    if (!RUNNABLE_LANGUAGES.has(language)) return false

    decorations.push(
      Decoration.widget(pos + node.nodeSize, () => runPanel(pos), {
        key: `code-run-${pos}`,
        side: 1,
        ignoreSelection: true,
        stopEvent: () => true,
      }),
    )
    return false
  })
  return DecorationSet.create(state.doc, decorations)
}

function syncRunPanelUi(view: EditorView) {
  const entries = codeRunKey.getState(view.state) ?? new Map<number, RunEntry>()
  view.dom.querySelectorAll('.code-run-panel').forEach((el) => {
    if (!(el instanceof HTMLElement)) return
    const pos = Number(el.getAttribute('data-code-run-pos'))
    const entry = entries.get(pos)

    const run = el.querySelector('.code-run-run')
    const stop = el.querySelector('.code-run-stop')
    const close = el.querySelector('.code-run-close')
    const output = el.querySelector('.code-run-output')
    const stdinRow = el.querySelector('.code-run-stdin-row')
    if (
      !(run instanceof HTMLElement) ||
      !(stop instanceof HTMLElement) ||
      !(close instanceof HTMLElement) ||
      !(output instanceof HTMLElement) ||
      !(stdinRow instanceof HTMLElement)
    ) {
      return
    }

    if (!entry) {
      run.hidden = false
      stop.hidden = true
      close.hidden = true
      output.hidden = true
      stdinRow.hidden = true
      return
    }

    const running = entry.status === 'starting' || entry.status === 'running'
    run.hidden = true
    stop.hidden = !running
    close.hidden = running
    output.hidden = false
    stdinRow.hidden = !running

    let text = entry.output.map((chunk) => chunk.text).join('')
    if (entry.status === 'exited') text += `\n[exited with code ${entry.exitCode ?? 'unknown'}]`
    if (entry.status === 'timeout') text += '\n[stopped: exceeded the run timeout]'
    if (entry.status === 'stopped') text += '\n[stopped]'
    output.textContent = text
    output.scrollTop = output.scrollHeight
  })
}

export const CodeBlockRun = Extension.create({
  name: 'codeBlockRun',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: codeRunKey,
        state: {
          init: () => new Map<number, RunEntry>(),
          apply: (tr, entries) => {
            const meta = tr.getMeta(codeRunKey) as CodeRunMeta | undefined
            if (meta) return applyCodeRunMeta(entries, meta)
            if (!tr.docChanged || entries.size === 0) return entries

            const mapped = new Map<number, RunEntry>()
            entries.forEach((entry, pos) => {
              const next = tr.mapping.map(pos)
              if (tr.doc.nodeAt(next)?.type.name === 'codeBlock') mapped.set(next, entry)
            })
            return mapped
          },
        },
        props: {
          decorations(state) {
            return decorate(state)
          },
        },
        view(view: EditorView) {
          const unlistenOutput = listen<OutputPayload>('code-run-output', (event) => {
            view.dispatch(
              view.state.tr.setMeta(codeRunKey, {
                type: 'output',
                runId: event.payload.runId,
                stream: event.payload.stream,
                text: decodeBase64Text(event.payload.data),
              }),
            )
          })
          const unlistenExit = listen<ExitPayload>('code-run-exit', (event) => {
            view.dispatch(
              view.state.tr.setMeta(codeRunKey, { type: 'exit', runId: event.payload.runId, code: event.payload.code }),
            )
          })
          const unlistenTimeout = listen<TimeoutPayload>('code-run-timeout', (event) => {
            view.dispatch(view.state.tr.setMeta(codeRunKey, { type: 'timeout', runId: event.payload.runId }))
          })

          const onClick = (event: MouseEvent) => {
            const target = event.target as HTMLElement | null
            const panelEl = target?.closest?.('.code-run-panel')
            if (!(panelEl instanceof HTMLElement)) return
            const pos = Number(panelEl.getAttribute('data-code-run-pos'))
            if (!Number.isInteger(pos)) return
            const action = target?.closest?.('button')?.getAttribute('data-action')
            if (!action) return
            event.preventDefault()

            if (action === 'run') {
              const node = view.state.doc.nodeAt(pos)
              if (!node) return
              const language = String(node.attrs['language'] ?? '')
              const source = node.textContent
              const notePath = useWorkspaceStore.getState().activeTab
              if (!notePath) return

              void useCodeRunConfirmStore
                .getState()
                .confirmNote(notePath)
                .then((allowed) => {
                  if (!allowed) return
                  const runId = crypto.randomUUID()
                  view.dispatch(view.state.tr.setMeta(codeRunKey, { type: 'start', pos, runId }))
                  const settings = useSettingsStore.getState().settings
                  void api.codeRun.run(
                    runId,
                    language,
                    source,
                    settings.pythonCommand,
                    settings.cppCompilerCommand,
                    settings.codeRunTimeoutSecs,
                  )
                })
              return
            }

            const entries = codeRunKey.getState(view.state) ?? new Map<number, RunEntry>()
            const entry = entries.get(pos)
            if (!entry) return

            if (action === 'stop') {
              void api.codeRun.stop(entry.runId)
              view.dispatch(view.state.tr.setMeta(codeRunKey, { type: 'stopped', runId: entry.runId }))
            } else if (action === 'close') {
              view.dispatch(view.state.tr.setMeta(codeRunKey, { type: 'close', pos }))
            }
          }

          const onKeydown = (event: KeyboardEvent) => {
            if (event.key !== 'Enter') return
            const target = event.target as HTMLElement | null
            if (!target?.classList?.contains('code-run-stdin')) return
            const panelEl = target.closest('.code-run-panel')
            const pos = Number(panelEl?.getAttribute('data-code-run-pos'))
            if (!Number.isInteger(pos)) return
            const entries = codeRunKey.getState(view.state) ?? new Map<number, RunEntry>()
            const entry = entries.get(pos)
            if (!entry) return
            const input = target as HTMLInputElement
            void api.codeRun.sendInput(entry.runId, input.value)
            input.value = ''
          }

          view.dom.addEventListener('click', onClick)
          view.dom.addEventListener('keydown', onKeydown)

          return {
            update: syncRunPanelUi,
            destroy: () => {
              view.dom.removeEventListener('click', onClick)
              view.dom.removeEventListener('keydown', onKeydown)
              void unlistenOutput.then((off) => off())
              void unlistenExit.then((off) => off())
              void unlistenTimeout.then((off) => off())
            },
          }
        },
      }),
    ]
  },
})
```

In `src/editor/extensions/index.ts`, add the import alongside the other `CodeBlock*` imports:

```ts
import { CodeBlockRun } from './CodeBlockRun'
```

and register it in `coreExtensions`, right after `CodeBlockSearch,`:

```ts
  CodeBlockSearch,
  CodeBlockRun,
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- src/editor/extensions/codeBlockRun.test.ts`
Expected: PASS, 12 tests total (9 from Task 8, 3 new).

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Run the full frontend suite to check for regressions**

Run: `npm test`
Expected: full suite green — in particular `codeBlockOpenInIde.test.ts`, `codeBlockToolbar.test.ts`, and `codeBlockSearch.test.ts` still pass unaffected, since `CodeBlockRun` only adds decorations/listeners and touches no shared state.

- [ ] **Step 6: Commit**

```bash
git add src/editor/extensions/CodeBlockRun.ts src/editor/extensions/codeBlockRun.test.ts src/editor/extensions/index.ts
git commit -m "feat: wire the code-run panel into python/cpp code blocks (P10-2)"
```

---

### Task 10: Styling

**Files:**
- Modify: `src/index.css`

**Interfaces:**
- Consumes: the class names from Task 9's `runPanel()` (`.code-run-panel`, `.code-run-run`, `.code-run-stop`, `.code-run-close`, `.code-run-output`, `.code-run-stdin-row`, `.code-run-stdin`).

No automated test — this is a plain-CSS visual addition, verified in Task 11's manual QA pass, same as every other editor-surface style change in this codebase.

- [ ] **Step 1: Add the styles**

In `src/index.css`, after the existing `.code-search-bar { ... }` block:

```css
.code-run-panel {
  display: block;
  margin: 0.25rem 0 1rem;
  font-family: var(--font-mono, monospace);
  font-size: 0.85em;
}

.code-run-run,
.code-run-stop,
.code-run-close {
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text-secondary);
  border-radius: 4px;
  padding: 0.15rem 0.6rem;
  cursor: pointer;
}

.code-run-run:hover,
.code-run-stop:hover,
.code-run-close:hover {
  background: var(--surface-3);
  color: var(--text-primary);
}

.code-run-stop {
  border-color: var(--danger, #c44);
  color: var(--danger, #c44);
}

.code-run-output {
  margin: 0.4rem 0 0;
  padding: 0.5rem 0.65rem;
  max-height: 240px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 4px;
}

.code-run-stdin-row {
  margin-top: 0.35rem;
}

.code-run-stdin {
  width: 100%;
  box-sizing: border-box;
  font-family: inherit;
  font-size: inherit;
  padding: 0.25rem 0.5rem;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--surface-1);
  color: var(--text-primary);
}
```

Also add `.code-run-panel` to the existing selector list that excludes non-prose UI chrome from spellcheck/print if one applies here — check the selector found earlier at `src/index.css:3517` (`.outline-panel, .search-overlay, .code-block-open-in-ide, .code-block-actions, ...`) and add `.code-run-panel` to that list, since it is UI chrome, not note content.

- [ ] **Step 2: Verify visually**

Run: `npm run dev`, open a note, insert a fenced code block with `python` as the language, confirm the Run button and (once clicked) the output panel render with readable contrast in both light and dark theme.

- [ ] **Step 3: Commit**

```bash
git add src/index.css
git commit -m "style: add code-run panel styles (P10-2)"
```

---

### Task 11: Manual QA against the compiled app (no code changes)

**Files:** none — verification only, per this project's own precedent for process-spawn/IO paths (`terminal-pane-design.md`'s "Manual QA checklist for the DoD").

Run `npm run tauri build --debug` (or `npm run tauri dev`) with a real `python3`/`g++` on `PATH`, then walk the design doc's DoD:

- [ ] A Python block printing `"hi"` runs and shows `hi` in the panel.
- [ ] A C++ block with a syntax error shows the compiler's stderr and the panel reports a nonzero exit — no binary output ever appears.
- [ ] An infinite-loop Python block (`while True: pass`) is killed once `codeRunTimeoutSecs` elapses and the panel shows the timeout message, not a normal exit.
- [ ] Clicking Stop on a running block ends it immediately and shows the "stopped" message.
- [ ] A Python block using `input()` (e.g. `print("you said " + input())`) receives text typed into the stdin box and prints the expected line.
- [ ] A C++ block using `std::cin >>` behaves the same way.
- [ ] Restarting the app and running any code block in any note re-shows the confirmation dialog — nothing was remembered across the restart.
- [ ] Opening a note, letting the workspace watcher reload it, or importing a PDF never triggers a run on its own — Run only fires on a direct click.
- [ ] Task Manager / `Get-Process` shows no orphaned `python`/compiled-binary process after a run finishes, times out, or is stopped, and the run's temp directory is gone from `%TEMP%` afterward.
- [ ] Changing the Python command / C++ compiler / timeout fields in Settings takes effect on the next run without restarting the app.

If any of these fail, fix the underlying task before considering P10-2 done — this checklist is the feature's actual Definition of Done, not a formality.

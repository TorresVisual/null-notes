# `nullnotes` CLI Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** A `nullnotes` command that lets agents (and the user) do everything the app can do to a workspace, with JSON output, whether or not Null Notes is running.

**Architecture:** The app runs a token-gated named-pipe server whose dispatcher is a hand-written allowlist `match` over the existing command functions. `nullnotes` is a small standalone crate (sibling of `context-menu-handler/`) that connects to the pipe, starting a hidden app instance first if none answers. A hidden instance quits itself when idle; a normal launch promotes or shuts down a hidden instance instead of running beside it.

**Tech Stack:** Rust, tokio named pipes (`tokio::net::windows::named_pipe`), `clap` (CLI crate only), React/Zustand (dirty-path reporting), NSIS hook (PATH).

**Spec:** [docs/specs/cli-design.md](../specs/cli-design.md) — including its "Changes found while planning" section, which supersedes the spec body where they differ.

## Execution Options

Leave every box below unchecked. The executing skill resolves them with
your human partner before Step 1 and checks the chosen boxes itself.

**Execution Target:**
- [ ] Current branch (no isolation)
- [ ] New feature branch (no worktree)
- [ ] Worktree (superpowers:using-git-worktrees)

**Execution Mode:**
- [ ] Inline execution (superpowers:executing-plans)
- [ ] Subagent-driven execution (superpowers:subagent-driven-development)

## Global Constraints

- Binary name `nullnotes`; pipe name `\\.\pipe\nullnotes-cli-<USERNAME>`; token file `cli-token` in the app-data dir (`%APPDATA%\dev.nullnotes.app\`); setting `cliAccess` (default `true`).
- `PROTOCOL_VERSION: u32 = 1`. One JSON object per line, request and response.
- Exit codes: `0` ok · `1` command failed · `2` usage · `3` workspace not resolved · `4` app unreachable after 15 s · `5` dirty buffer · `6` CLI access disabled · `7` version mismatch or bad token.
- Notes are addressed by workspace-relative, forward-slash paths in input and output; the dispatcher converts at the boundary.
- Never exposed on the pipe: `run_code`, `send_input`, `stop_run`, `format_code`, `open_in_editor`, `open_note_externally`, `reveal_note`, `terminal_*`, `get_git_token`, `set_git_token`, window commands, `clone_repo`, `push_notes`, `fetch_and_compare`, `rebase_onto_remote`, `purge_trash_entry`, `empty_trash`. Default for any new command is *not exposed*.
- Idle quit 10 min (only if the window was never shown); launch wait 15 s; per-path write lock around every write command.
- Rust rules from `CLAUDE.md`: no `.unwrap()`/`.expect()` outside tests, derive `Debug`, `cargo clippy -- -D warnings` and `cargo fmt --check` clean in both `src-tauri` and `src-tauri/cli`. Note writes go through the existing commands (`write_atomic` inside), never `tokio::fs::write`.
- `cfg(windows)` gate the pipe and launch code so mobile and web builds keep compiling.

## Review Focus

Inputs the spec implies but no obvious task would test; each has a pinning test in the owning task.

1. **Hostile paths** — `..`, absolute, drive-letter, UNC and `-`-leading paths in any `path`/`folder` argument must be refused (and a `-`-leading path must never reach `git`). Task 1.
2. **Dirty-path matching on Windows** — the frontend reports backslash paths in whatever case it holds; a CLI write to the same file spelled with `/` or different case must still be refused with exit 5. Task 2.
3. **Concurrent appends** — two simultaneous `note.append` to one note must both land. Task 2.
4. **Garbage on the pipe** — malformed JSON, wrong token, wrong version, unknown command, or an oversized line must yield an error response and leave the server serving. Task 3.
5. **Token clobbering** — a second app instance that fails to bind the pipe (e.g. the e2e build next to a running app) must not overwrite the first instance's `cli-token`. Task 3.

---

### Task 1: Protocol, path rules, read-only dispatcher

**Files:**
- Create: `src-tauri/src/cli_server/mod.rs`, `protocol.rs`, `paths.rs`, `dispatch.rs`
- Modify: `src-tauri/src/lib.rs` (add `pub mod cli_server;`), `src-tauri/Cargo.toml` (`[dev-dependencies] tauri = { version = "2", features = ["test"] }`)

**Interfaces:**
- Produces (`protocol.rs`): `pub const PROTOCOL_VERSION: u32`; `pub struct Request { pub v: u32, pub token: String, pub command: String, pub workspace: Option<String>, pub args: serde_json::Value }` (Deserialize, Debug; `workspace`/`args` `#[serde(default)]`); `pub struct Response { pub ok: bool, pub result: Option<serde_json::Value>, pub error: Option<ErrorBody> }` (Serialize, Debug) with `Response::ok(Value)` and `Response::err(ErrorCode, impl Into<String>)`; `pub struct ErrorBody { pub code: ErrorCode, pub message: String }`; `pub enum ErrorCode { Failed, Usage, DirtyBuffer, VersionMismatch, Unauthorized }` serialized `snake_case`.
- Produces (`paths.rs`): `pub fn to_absolute(workspace: &str, rel: &str) -> Result<String, String>`; `pub fn to_relative(workspace: &str, abs: &str) -> String`; `pub fn relativize_paths(value: &mut serde_json::Value, workspace: &str)` — rewrites string values under the keys in `const PATH_KEYS` (the path-bearing field names of the `NoteMetadata`, `BacklinkEntry`, `GraphLink`, `OpenTask`, `DueCard`, `CardSummary`, `TrashEntry`, `BaseRow` JSON shapes in `models.rs`/command modules — read them to build the list).
- Produces (`dispatch.rs`): `pub async fn dispatch(app: &tauri::AppHandle, req: Request) -> Response`.
- Consumes: the `pub async fn` bodies of the read commands in `commands/notes.rs`, `trash.rs`, `bookmarks.rs`, `bases.rs`; `db::DbPool` via `app.state::<DbPool>()`.

- [ ] **Step 1: Write failing tests** in `paths.rs` and `dispatch.rs` (`#[cfg(test)]`):
  - `to_absolute("C:/ws", "a/b.md") == Ok("C:/ws/a/b.md")`; `Err` for `"../x"`, `"a/../../x"`, `"/etc/x"`, `"C:/x"`, `"\\\\srv\\share\\x"`, `"-rf"`-style names only when the component is exactly `..` or the whole path starts with `-`.
  - `to_relative("C:\\ws", "C:\\ws\\a\\b.md") == "a/b.md"`.
  - `relativize_paths` rewrites a nested `[{ "path": "C:/ws/a.md" }]` and leaves `"title"` untouched.
  - With `tauri::test::mock_app()` plus a temp-dir SQLite pool managed as `DbPool`: `dispatch` of `tags.list` returns `ok` with `[]`; of `run_code` returns `ok:false`, `code: usage`, message containing `"not exposed"`; a request with `v: 99` returns `version_mismatch`.
  - A test iterating a `const NEVER_EXPOSED: &[&str]` (the Global Constraints list) asserting `dispatch` rejects each with `"not exposed"`.
- [ ] **Step 2: Run** `cargo test --lib cli_server` in `src-tauri`; expect compile failure/FAIL.
- [ ] **Step 3: Implement** the protocol types and `paths.rs` (component-wise: accept only `Component::Normal` segments from the *as-written* relative path, per `commands/CLAUDE.md`'s rule — never normalise-then-compare; reject a leading `-` on the whole argument). Implement `dispatch`: version check → (token check is the pipe layer's job, not here) → `match req.command.as_str()` arms for the **read** rows of the table below, each deserialising `req.args` into a local `#[derive(Deserialize)]` struct, converting paths with `to_absolute`, calling the command fn with `app.state::<DbPool>()`, then `relativize_paths` on the serialised result. Unknown name → `Response::err(Usage, "command not exposed: <name>")`.
- [ ] **Step 4: Run** the tests again; expect PASS.
- [ ] **Step 5: Commit** `feat(cli): protocol, path rules and read-only dispatcher`.

**Dispatch table** (wire name → function; args are workspace-relative paths). *Read:* `note.list`→`list_notes` · `note.read {path}`→`open_note` · `search {query, folder?, tag?, block_type?, all_workspaces?, offset?}`→`search_notes` · `tags.list`→`list_tags` · `tags.notes {tag}`→`notes_with_tag` · `backlinks {title}`→`backlinks_for_with_context` · `backlinks.code {target}`→`code_backlinks_for_with_context` · `mentions {title, path}`→`unlinked_mentions_for_with_context` · `graph.links`/`graph.tags` · `tasks.list`→`list_open_tasks` · `cards.due`/`cards.list`→`list_due_cards`/`list_all_cards` · `template.list`/`template.read {path}` · `trash.list` · `bookmarks.read` · `bases.rows`→`list_base_rows` · `git.repo`→`detect_repo` · `git.history {path}`→`list_note_history`. *Write (Task 2):* `note.create {folder, title, content?}` · `note.write {path, content}` · `note.append {path, content}` · `note.rename {path, title}` · `note.move {path, folder}` · `note.duplicate {path}` · `note.delete {path}`→`delete_note` (trash) · `folder.create {parent, name}` · `folder.rename {old, new}` · `folder.delete {path}`→`delete_folder` (trash) · `tags.rename {old, new}` · `tasks.toggle {path, position}` · `cards.grade {path, position, grade}` · `cards.suspend {path, position, suspended}` · `template.create {folder, title, template}` · `trash.restore {id}` · `bookmarks.write {content}` · `property.set {path, key, expected?, value?}`→`write_note_property` · `git.commit {paths}`→`detect_repo` then `auto_commit(skip_hooks=false)`, refusing when no repo.

---

### Task 2: Write commands, locks, freshness scan, dirty-buffer refusal

**Files:**
- Create: `src-tauri/src/cli_server/state.rs`
- Modify: `src-tauri/src/cli_server/dispatch.rs`, `mod.rs`, `src-tauri/src/commands/notes.rs` is **not** modified; `src-tauri/src/lib.rs` (`app.manage(cli_server::state::CliState::default())`, register `report_dirty_paths` in `generate_handler!`)

**Interfaces:**
- Produces (`state.rs`): `#[derive(Debug, Default)] pub struct CliState { … }` with `pub fn set_dirty(&self, workspace: &str, paths: Vec<String>)`, `pub fn is_dirty(&self, abs_path: &str) -> bool` (compares after replacing `\` with `/` and lowercasing), `pub async fn lock_path(&self, abs_path: &str) -> tokio::sync::OwnedMutexGuard<()>`, `pub fn take_first_scan(&self, workspace: &str) -> bool` (true once per workspace), `pub fn touch(&self)`, `pub fn idle_for(&self) -> std::time::Duration`.
- Produces: `#[tauri::command] pub fn report_dirty_paths(state: State<'_, CliState>, workspace: String, paths: Vec<String>)` in `cli_server/mod.rs`.
- Consumes: Task 1 `dispatch`, `to_absolute`.

- [ ] **Step 1: Write failing tests**:
  - `is_dirty` is true for a path reported as `C:\ws\Notes\A.md` and queried as `c:/ws/notes/a.md`; false after `set_dirty(ws, vec![])`.
  - `take_first_scan("ws")` is true then false; true again for `"ws2"`.
  - Dispatch (mock app + temp workspace): `note.write` on a dirty path → `ok:false`, `code: dirty_buffer`, file bytes unchanged; on a clean path → file contains new content and the note is findable by `search`.
  - Two `note.append` calls joined with `tokio::join!` on one note: file contains both appended strings.
  - `note.delete` moves the file into the trash (`trash.list` has one entry); `trash.restore` brings it back.
  - First workspace-scoped request triggers one `scan_workspace` (index contains a note that was created on disk beforehand); a second does not rescan.
  - `git.commit` with `paths: ["-rf"]` is rejected with `usage` before any process is spawned.
- [ ] **Step 2: Run** `cargo test --lib cli_server`; expect FAIL.
- [ ] **Step 3: Implement** `state.rs`, the **write** arms of the table, and in `dispatch`: call `state.touch()`; run `take_first_scan` → `scan_workspace` before any workspace-scoped command; wrap every write arm in `let _g = state.lock_path(&abs).await;`; refuse with `DirtyBuffer` when `is_dirty(abs)` for `note.write/append/rename/move/delete/property.set/tasks.toggle/cards.*`. Content-writing arms call `save_note` then `reindex_note` (the CLI is not a keystroke path). `note.create` with `content` calls `create_note` then writes the body the same way. Before enabling `git.commit`, read `git.rs::checked_auto_commit` and confirm paths reach `git` after `--`; if not, add the `--` there as part of this task.
- [ ] **Step 4: Run** tests; expect PASS. Run `cargo clippy -- -D warnings` and `cargo fmt --check`.
- [ ] **Step 5: Commit** `feat(cli): write commands with locks, scan-on-first-use and dirty-buffer refusal`.

---

### Task 3: Pipe server, token, request framing

**Files:**
- Create: `src-tauri/src/cli_server/pipe.rs`
- Modify: `cli_server/mod.rs`, `src-tauri/src/lib.rs` (`setup`: call `cli_server::start`)

**Interfaces:**
- Produces (`pipe.rs`): `pub fn pipe_name() -> String`; `pub async fn serve(app: AppHandle, token: String, name: String) -> std::io::Result<()>` (binds, then returns only on fatal error); `pub async fn send(name: &str, req: &Request) -> std::io::Result<Response>` (client half, used by the startup handshake in Task 4).
- Produces (`mod.rs`): `pub fn start(app: &AppHandle)`: if `cliAccess` is false return; otherwise spawn `serve`; **bind first, then write** the token file (`<app_data>/cli-token`, fresh `uuid::Uuid::new_v4()`); on bind failure log via `error_log::append_entry_sync` and return without touching the token file.
- Consumes: Task 2 `dispatch`.

- [ ] **Step 1: Write failing tests** (`#[cfg(all(test, windows))]`, unique pipe name per test, in-process client via `send`):
  - Round trip: valid request `tags.list` → `ok:true`.
  - Wrong token → `unauthorized`, wrong `v` → `version_mismatch`, unknown command → `usage`; malformed JSON line → `usage`; a line over 1 MiB → `usage` — and a valid request on a fresh connection afterwards still succeeds.
  - Binding a second server on the same pipe name returns `Err`, and `start`-style token writing (factor as `fn write_token_after_bind`) leaves the first token file content unchanged.
- [ ] **Step 2: Run** `cargo test --lib cli_server::pipe`; expect FAIL.
- [ ] **Step 3: Implement** with `tokio::net::windows::named_pipe::ServerOptions` (`first_pipe_instance(true)` on the first create, `reject_remote_clients(true)`), one task per connection reading lines with a 1 MiB cap. Token comparison via equal-length byte comparison. No custom DACL (see spec change note).
- [ ] **Step 4: Run** tests; expect PASS; clippy + fmt.
- [ ] **Step 5: Commit** `feat(cli): named-pipe server with token auth`.

---

### Task 4: Headless mode, idle quit, promote/shutdown handshake

**Files:**
- Create: `src-tauri/src/cli_server/lifecycle.rs`
- Modify: `src-tauri/src/commands/workspace.rs` (add `headless_from_args`), `src-tauri/src/lib.rs`, `src-tauri/tauri.conf.json` (main window `"visible": false`), `cli_server/dispatch.rs` (`status`, `promote`, `shutdown` internal commands)

**Interfaces:**
- Produces: `pub fn headless_from_args<I: IntoIterator<Item = String>>(args: I) -> bool` (matches the literal `--headless`); `pub fn should_idle_quit(shown: bool, idle: Duration) -> bool` (true iff `!shown && idle >= IDLE_QUIT`); `pub enum Handshake { NoInstance, Promoted, ShutDown }`; `pub fn defer_to_hidden_instance(has_target_args: bool) -> Handshake` (sync wrapper over `pipe::send` using `tauri::async_runtime::block_on`; reads the token file; `status` → if the instance reports `shown: false`: with `has_target_args == false` send `promote` and return `Promoted`, otherwise send `shutdown`, wait up to 3 s for the pipe to disappear, return `ShutDown`; any error → `NoInstance`); `CliState` gains `shown: AtomicBool`.
- `status` result: `{ "shown": bool, "workspace": string|null }`. `promote`: `window.show()`, `set_focus()`, `shown = true`. `shutdown`: `app.exit(0)`.

- [ ] **Step 1: Write failing tests**: `headless_from_args(["--headless".into()])` true, `["--workspace=x".into()]` false; `should_idle_quit(false, 11 min)` true, `(true, 11 min)` false, `(false, 9 min)` false; `dispatch` of `status` on a fresh mock app → `shown: false`; of `promote` → subsequent `status` → `shown: true`.
- [ ] **Step 2: Run**; expect FAIL.
- [ ] **Step 3: Implement.** In `run()`: compute `headless`; when `!headless` call `defer_to_hidden_instance(initial_workspace.is_some() || open_file.is_some())` first and `return` on `Promoted`. In `setup`: `if !headless { window.show(); state.shown = true }`; spawn the 30-second idle loop that calls `app.exit(0)` when `should_idle_quit`. Skip `remember_workspace`/jump-list rebuild when `headless`. Verify in `commands/identity.rs` that `register_and_relaunch` forwards `args` so `--headless` survives the MSIX relaunch; fix if not.
- [ ] **Step 4: Run** unit tests; then `npm run tauri dev` is **not** enough here — run `npm run test:e2e -- --spec e2e/specs/create-note.e2e.ts` to confirm a normal launch still shows its window (regression for the `visible:false` change). Expected: PASS.
- [ ] **Step 5: Commit** `feat(cli): headless launch, idle quit and hidden-instance handshake`.

---

### Task 5: `cliAccess` setting

**Files:**
- Modify: `src-tauri/src/models.rs` (`AppSettings.cli_access: bool` with `#[serde(default = "default_cli_access")]`, `Default` impl), `src/types/index.ts`, `src/store/settings.ts`, `src/web/memoryWorkspace.ts`, `src/components/SettingsPanel.tsx`, `src/components/Layout.test.tsx` and `src/store/settings.test.ts` fixtures, `src/index.css` only if a new className is introduced.
- Test: `src/store/settings.test.ts`, a Rust test beside the existing `AppSettings` tests.

**Interfaces:** Produces `AppSettings.cliAccess: boolean` (TS) / `cli_access: bool` (Rust, default `true`). Consumes: Task 3 `start` reads it via `commands::settings::resolve_settings`.

- [ ] **Step 1: Write failing tests**: Rust — deserialising a `settings.json` without the field yields `cli_access == true`; TS — store default `cliAccess === true`.
- [ ] **Step 2: Run** `cargo test --lib settings` and `npx vitest run src/store/settings.test.ts`; expect FAIL.
- [ ] **Step 3: Implement** the field in all the places listed, plus one `.settings-row` checkbox "Allow CLI access" in `SettingsPanel.tsx` (reuse the existing row/toggle markup used by `spellcheck`; grep `index.css` for every className before finishing, per `CLAUDE.md`). Subtext: changes apply on next launch.
- [ ] **Step 4: Run** both tests plus `npm run typecheck` and `npm run build:web`; expect PASS.
- [ ] **Step 5: Commit** `feat(cli): Allow CLI access setting`.

---

### Task 6: Frontend dirty-path reporting

**Files:**
- Create: `src/store/dirtyPaths.ts`, `src/hooks/useReportDirtyPaths.ts`
- Modify: `src/hooks/useNote.ts`, `src/lib/tauri.ts` (`api.cli.reportDirtyPaths`), `src/web/` stub if `invoke` is shimmed there, `src/components/Layout.tsx` (mount the reporting hook once)
- Test: `src/store/dirtyPaths.test.ts`, extend `src/hooks/useNote.test.ts`

**Interfaces:**
- Produces: `useDirtyPathsStore` with `paths: ReadonlySet<string>`, `markDirty(path: string): void`, `markClean(path: string): void`; `api.cli.reportDirtyPaths(workspace: string, paths: string[]): Promise<void>` → `invoke('report_dirty_paths', { workspace, paths })`; `useReportDirtyPaths(): void` subscribes and reports on change.
- Consumes: Task 2 `report_dirty_paths`.

- [ ] **Step 1: Write failing tests**: store `markDirty` then `markClean` leaves `paths` empty; in `useNote.test.ts`, calling `save('x')` marks the path dirty and the path is cleaned after the save resolves; a failed save (state `error`) leaves it dirty; unmounting the hook marks it clean.
- [ ] **Step 2: Run** `npx vitest run src/store/dirtyPaths.test.ts src/hooks/useNote.test.ts`; expect FAIL.
- [ ] **Step 3: Implement.** In `useNote`, an effect on `[saveState, path]`: `saveState === 'clean'` → `markClean(path)`, otherwise `markDirty(path)`; cleanup on unmount/path change → `markClean(path)`. `useReportDirtyPaths` debounces nothing — it reports on every store change (set sizes are tiny).
- [ ] **Step 4: Run** the tests, `npm run typecheck`, `npm run lint`, `npm run build:web`; expect PASS.
- [ ] **Step 5: Commit** `feat(cli): report unsaved note paths to the backend`.

---

### Task 7: CLI crate — workspace resolution, client, launch

**Files:**
- Create: `src-tauri/cli/Cargo.toml` (package `nullnotes-cli`, `[[bin]] name = "nullnotes"`, deps `serde`, `serde_json`, `tokio` (`rt`, `net`, `time`, `io-util`, `macros`), `clap` (`derive`), dev-dep `tempfile`; own `Cargo.lock`), `src/main.rs`, `src/workspace.rs`, `src/client.rs`, `src/exit.rs`

**Interfaces:**
- Produces: `workspace::resolve(flag: Option<&Path>, cwd: &Path, recents_file: &Path) -> Result<PathBuf, ResolveError>`; `client::request(command: &str, workspace: Option<&Path>, args: serde_json::Value) -> Result<serde_json::Value, ClientError>` (reads token, checks `settings.json` for `cliAccess == false` first, connects, launches `null-notes.exe --headless --workspace=<ws>` if the pipe is absent, polls every 200 ms up to 15 s); `exit::code_for(&ClientError) -> i32` implementing the Global Constraints table.
- App exe lookup order: env `NULLNOTES_APP_EXE`; `null-notes.exe` beside `nullnotes.exe`; `src-tauri/target/{release,debug}/null-notes.exe` relative to the CLI crate's `CARGO_MANIFEST_DIR` ancestors. Spawn with `creation_flags(0x0800_0008)` (detached, no console).

- [ ] **Step 1: Write failing tests** in `workspace.rs`: flag wins; with `<tmp>/ws/.workspace.json` and cwd `<tmp>/ws/a/b`, resolves `<tmp>/ws`; a directory with only a root `README.md` is **not** treated as a workspace; cwd inside a recents entry resolves to that entry; otherwise first recents entry that exists; none → `ResolveError::NotFound`. In `client.rs`: a fake in-process pipe server answering `{ok:true,result:[]}` yields `Ok`; `cliAccess:false` in a temp `settings.json` yields `ClientError::Disabled` without connecting; `exit::code_for` maps each variant to the documented number.
- [ ] **Step 2: Run** `cargo test` in `src-tauri/cli`; expect FAIL.
- [ ] **Step 3: Implement.** Walk-up marker is `.workspace.json` only (stricter than `git.rs::is_workspace_folder` on purpose — see spec change note). Request framing matches `protocol.rs` (copy the five fields; no shared crate, as with `context-menu-handler`).
- [ ] **Step 4: Run** tests; `cargo clippy -- -D warnings`; `cargo fmt --check`; expect PASS.
- [ ] **Step 5: Commit** `feat(cli): nullnotes crate with workspace resolution and pipe client`.

---

### Task 8: CLI command surface

**Files:**
- Create: `src-tauri/cli/src/commands.rs`
- Modify: `src-tauri/cli/src/main.rs`

**Interfaces:**
- Produces: `#[derive(clap::Parser)] pub struct Cli` (global `--workspace <PATH>`, subcommands mirroring the Task 1 table as `nullnotes note read <path>`, `nullnotes search <query> [--folder] [--tag] [--block-type] [--all-workspaces] [--offset]`, …); `pub fn build_request(cli: &Cli, stdin: &mut impl Read) -> Result<(String, serde_json::Value), UsageError>` mapping a parsed command to `(wire command, args)`.
- `--content -` reads stdin to a `String`; non-UTF-8 stdin is a `UsageError` (exit 2). `main` prints the response JSON line to stdout on `ok:true`, prints the error response to stdout on `ok:false`, diagnostics to stderr, and exits with `exit::code_for`.

- [ ] **Step 1: Write failing tests**: `["nullnotes","note","read","a/b.md"]` → `("note.read", {"path":"a/b.md"})`; `["nullnotes","search","foo","--tag","x"]` → `("search", {"query":"foo","tag":"x"})`; `note append a.md --content -` with stdin `"hi\r\n"` → args content `"hi\r\n"`; non-UTF-8 stdin bytes → `UsageError`; an unknown subcommand → clap exit 2; `--help` lists every wire command in the table (iterate the table constant and assert each appears).
- [ ] **Step 2: Run** `cargo test` in `src-tauri/cli`; expect FAIL.
- [ ] **Step 3: Implement** the clap tree and `build_request` for every row of the Task 1 dispatch table.
- [ ] **Step 4: Run** tests; clippy; fmt.
- [ ] **Step 5: Commit** `feat(cli): command surface`.

---

### Task 9: Packaging, CI, PATH, end-to-end

**Files:**
- Modify: `src-tauri/tauri.windows.conf.json` (`"cli/target/release/nullnotes.exe": ""` in `bundle.resources`), `.github/workflows/ci.yml` and `release.yml` (add `src-tauri/cli` to the `rust-cache` workspaces and a `cargo build --release` step beside the context-menu-handler one), `src-tauri/windows/hooks.nsh` (POSTINSTALL: add `$INSTDIR` to the user `PATH` if absent; PREUNINSTALL: remove it — via `nsExec::ExecToLog` PowerShell, matching the existing hooks)
- Create: `e2e/specs/cli.e2e.ts`

- [ ] **Step 1: Write the e2e spec**: with the fixture workspace, run `nullnotes note create --folder "" --title "CLI Note" --content -` (stdin) via `child_process.spawnSync` against the debug build while the app is running, assert exit 0 and the file exists; run `nullnotes search "CLI Note"` and assert the note is in the JSON; run `nullnotes note write` on a note the UI has open and dirty and assert exit 5.
- [ ] **Step 2: Run** `npm run test:e2e -- --spec e2e/specs/cli.e2e.ts`; expect FAIL (binary not built / not wired).
- [ ] **Step 3: Wire packaging** as listed; `pretest:e2e` must also build the CLI (`cargo build --manifest-path src-tauri/cli/Cargo.toml`) and the spec points `NULLNOTES_APP_EXE` at the debug app.
- [ ] **Step 4: Run** the e2e spec, then `npm run tauri build` and install the NSIS output once by hand: confirm `nullnotes --help` works from a **new** terminal and a cold `nullnotes tags list` (app closed) returns within ~5 s and leaves no visible window. Expected: PASS.
- [ ] **Step 5: Commit** `feat(cli): bundle nullnotes, add to PATH, e2e coverage`.

---

### Task 10: Docs

**Files:**
- Create: `docs/cli.md` (agent-facing: command list, JSON shapes, exit codes, `--content -` recommendation, "app may take 1–3 s on first call")
- Modify: `src-tauri/src/commands/CLAUDE.md` (new section "The CLI pipe": allowlist-by-`match`, default not exposed, token file is machine-local app-data state per the storage boundary), `CLAUDE.md` (one line under "Commands: process execution" pointing at it)

- [ ] **Step 1:** Write the docs from the implemented behaviour; verify every command in `docs/cli.md` against `nullnotes --help`.
- [ ] **Step 2: Commit** `docs(cli): agent reference and pipe allowlist rules`.

---

## Self-review

- **Spec coverage:** intent/goals → Tasks 1–2, 7–8; pipe + token + allowlist → 1, 3; auto-launch + idle quit + (revised) single-instance → 4, 7; workspace resolution → 7; output/exit codes → 7–8; write safety (dirty, locks, reindex) → 2, 6; freshness scan → 2; `cliAccess` → 5, 7; protocol version → 1, 3; PATH/install → 9; recents not polluted → 4 (headless skips `remember_workspace`/jump list); stdin → 8; MSIX relaunch → 4; docs → 10. Cross-workspace requests work because every request carries `workspace`.
- **Type consistency:** `Request`/`Response`/`ErrorCode` names and exit codes are defined once (Global Constraints, Task 1) and reused unchanged; `CliState` methods are named in Task 2 and consumed in Tasks 3–4.
- **Proportion:** the dispatch table carries the per-command mapping once; arms are left to the implementer.

# `nullnotes tui` Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** `nullnotes tui` — a full-screen terminal UI over a workspace to browse/read notes, search, triage tasks, review flashcards and capture a line, using only the existing pipe commands.

**Architecture:** A `tui` module in the existing `src-tauri/cli` crate. A pure `update(state, msg) -> jobs` model, pure `ratatui` rendering, and one worker thread that runs the blocking `client::request_with` calls and posts replies back over an `mpsc` channel. Each request carries a per-slot id so stale replies are dropped.

**Tech Stack:** Rust, `ratatui` + `crossterm` (terminal), `pulldown-cmark` (markdown), existing `clap`/`serde_json`/`tokio`. Run all commands from `src-tauri/cli`.

**Spec:** [docs/specs/cli-tui-design.md](../specs/cli-tui-design.md) (builds on [cli-design.md](../specs/cli-design.md), shipped in [plans/cli.md](cli.md)).

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

- Only existing wire commands from `commands::COMMAND_TABLE`; **no new server commands, no `src-tauri/src` changes**, no direct disk or `index.db` access.
- New dependencies: `ratatui`, `crossterm`, `pulldown-cmark` only. Add with `cargo add` (current versions); confirm the API with `npx ctx7@latest` before relying on remembered signatures; if `ratatui` re-exports `crossterm`, use the re-export so the versions cannot diverge.
- Exit codes: `0` clean quit · `2` not a TTY / usage · `3` no workspace · `4` app unreachable · `6` access off · `7` version mismatch. Bare `nullnotes` stays a usage error.
- Rust rules (`CLAUDE.md`): no `.unwrap()`/`.expect()` outside tests, derive `Debug` on every struct, no comments unless the WHY is non-obvious, `cargo clippy -- -D warnings` and `cargo fmt --check` clean in `src-tauri/cli`.
- Windows Terminal / modern conhost only; 16-colour ANSI; honour `NO_COLOR`.
- Tuning defaults (builder may adjust): `SEARCH_DEBOUNCE` 150 ms, `KEEPALIVE` 5 min (`tags.list`), `NARROW_COLS` 80.
- Dirty-buffer status text, exactly: `Unsaved edits in the app — nothing written`.
- The terminal is restored (raw mode off, alternate screen left) on every exit path including panic.

## Review Focus

1. **Terminal left raw after Ctrl+C or a panic** — a broken shell is the worst failure a TUI has. Guard + panic hook (Task 1); verified in manual QA (Task 13).
2. **A slow reply overwriting a newer one** — search typed quickly, selection moved quickly. Task 2 (`is_current`) and Task 8.
3. **Typing `q`, `1`–`6`, `c` or `/` into a text box quits or switches view.** Task 8 and Task 12.
4. **Non-ASCII, CRLF and very long lines** (CJK, emoji, combining marks, a 5000-char line) must render without panic or split characters. Task 5 and Task 6.
5. **Empty and tiny states** — empty workspace, no due cards, no tasks, no results, a 20×5 terminal: no panic, no arithmetic underflow, a readable empty message. Task 6 onward, one test per view.

---

### Task 1: Entry, gates and terminal guard

**Files:**
- Modify: `src-tauri/cli/Cargo.toml` (deps), `src/commands.rs` (`Command::Tui`; `build_request` arm; `after_help` gains a line `Interactive: nullnotes tui`), `src/main.rs` (`mod tui;`, early dispatch)
- Create: `src/tui/mod.rs`, `tests/tui_entry.rs`

**Interfaces:**
- Produces: `pub fn run(workspace: Option<&Path>) -> i32` in `tui/mod.rs`; `struct TerminalGuard` whose `Drop` and a panic hook restore the terminal.
- `main.rs`: `if matches!(cli.command, Command::Tui) { return tui::run(cli.workspace.as_deref()); }` before `build_request`. `build_request` returns `Err(UsageError("tui is interactive, not a wire command"))` for `Tui`.

- [ ] **Step 1: Write failing tests.**
  - `tests/tui_entry.rs` (spawn `env!("CARGO_BIN_EXE_nullnotes")`, stdio piped): `tui_refuses_without_a_terminal` — args `["tui"]` exits `2`, stderr contains `interactive terminal`; `tui_checks_the_terminal_before_the_workspace` — same with `--workspace C:/definitely/missing` still exits `2`; `bare_nullnotes_is_still_a_usage_error` — no args exits `2`.
  - In `commands.rs` tests: `tui_is_not_a_wire_command` — `build_request` on `["nullnotes","tui"]` is `Err`.
- [ ] **Step 2: Run** `cargo test` → FAIL (no `tui` subcommand).
- [ ] **Step 3: Implement.** Gate order in `run`: `IsTerminal` on stdin **and** stdout (else print `nullnotes tui needs an interactive terminal` to stderr, return 2) → resolve workspace via `workspace::resolve` exactly as `main.rs` does, same message, return 3 → enter raw mode + alternate screen under `TerminalGuard` → temporary loop that draws a bordered "Null Notes" block and returns 0 on `q`/`Ctrl+C` (Task 6 replaces the loop). Install the panic hook before entering raw mode; hook restores the terminal then calls the previous hook.
- [ ] **Step 4: Run** `cargo test` → PASS. Run `nullnotes tui` by hand in Windows Terminal: block shows, `q` exits cleanly.
- [ ] **Step 5: Commit** `feat(cli): nullnotes tui entry, gates and terminal guard`.

---

### Task 2: Wire types, worker and stale-reply slots

**Files:**
- Create: `src/tui/wire.rs`, `src/tui/effects.rs`
- Modify: `src/exit.rs` (add `pub fn message_for(error: &ClientError) -> String`: `Disabled` → `CLI access is turned off in Null Notes (Settings → Tools)`, `Unreachable(r)` → `r`, `Rejected(b)` → `b.message`); `src/main.rs` uses it for the `Disabled`/`Unreachable` stderr arms.

**Interfaces:**
- `wire.rs` (all `#[derive(Debug, Clone, Deserialize)]`, `rename_all = "camelCase"`): `NoteMeta { id, title, path, workspace: String, updated_at: i64 }`; `SearchHit { path, title, workspace: String, updated_at: i64, snippet: String }`; `SearchPage { results: Vec<SearchHit>, total: i64 }`; `Backlink { note: NoteMeta, snippet: Option<String> }`; `OpenTask { note_path, note_title, text: String, position: i64 }`; `DueCard { note_path, note_title, kind, front, back: String, position: i64, options: Vec<String>, streak: i64 }`; `TrashEntry { id, workspace, original_path: String, is_folder: bool, name: String, trashed_at: i64 }`. Tags are plain `Vec<String>`; `note.read` is a plain `String`.
- `pub fn decode<T: DeserializeOwned>(value: Value) -> Result<T, String>` (error text names the target type).
- `effects.rs`: `pub type Call = Box<dyn Fn(&str, Value) -> Result<Value, ClientError> + Send + 'static>`; `#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)] pub enum Slot { Notes, Preview, Backlinks, Search, Tasks, TaskToggle, Cards, CardWrite, Tags, TagNotes, Trash, TrashRestore, Capture, Keepalive }` with `fn is_write(self) -> bool` (`TaskToggle | CardWrite | TrashRestore | Capture | Keepalive`); `pub struct Job { pub slot: Slot, pub command: &'static str, pub args: Value }`; `pub struct Reply { pub slot: Slot, pub id: u64, pub command: &'static str, pub args: Value, pub result: Result<Value, ClientError> }`; `pub struct Worker` with `pub fn spawn(call: Call, replies: mpsc::Sender<Reply>) -> Worker`, `pub fn submit(&mut self, job: Job) -> u64`, `pub fn is_current(&self, reply: &Reply) -> bool`; plus `pub fn pipe_call(env: Env, workspace: PathBuf) -> Call` wrapping `client::request_with`.

- [ ] **Step 1: Write failing tests.**
  - `wire.rs`: one `decodes_<type>` test per struct from a literal JSON sample (camelCase keys, an extra unknown key ignored); `decode_names_the_type_on_failure`.
  - `effects.rs` (fake `Call` echoing its args): `replies_carry_slot_command_args_and_id`; `a_newer_submit_makes_the_older_reply_stale` — two `Search` submits, replies in order, `is_current` is `false` then `true`; `write_slots_are_never_stale` — two `TaskToggle` submits, both replies current; `slots_are_independent`; `errors_pass_through_unchanged` — a `ClientError::Rejected` from the fake arrives as `Err` with the same body.
  - `exit.rs`: `message_for_covers_every_variant`.
- [ ] **Step 2: Run** `cargo test tui::` → FAIL.
- [ ] **Step 3: Implement.** Worker is one thread draining an `mpsc` of `(id, Job)`; latest-id per slot kept in a `HashMap<Slot, u64>` on `Worker` (main-thread only). `// ponytail: one worker, so a slow request delays the next; a pool if that ever shows.`
- [ ] **Step 4: Run** `cargo test` → PASS.
- [ ] **Step 5: Commit** `feat(cli): tui wire types and stale-aware worker`.

---

### Task 3: Search query parser

**Files:** Create `src/tui/query.rs`.

**Interfaces:** `#[derive(Debug, Default, PartialEq)] pub struct SearchQuery { pub text: String, pub tag: Option<String>, pub folder: Option<String>, pub block_type: Option<String> }`; `pub fn parse(input: &str) -> SearchQuery`; `impl SearchQuery { pub fn args(&self, offset: i64) -> Value }` producing the `search` wire args (`query`, `tag`, `folder`, `block_type`; `offset` only when `> 0`; absent options omitted).

- [ ] **Step 1: Write failing tests:** `plain_text_has_no_filters`; `tag_folder_and_block_prefixes_are_extracted` (`"tag:cs101 folder:notes/os block:code binary tree"` → fields set, `text == "binary tree"`); `unknown_prefixes_stay_in_the_text` (`"http://x foo:bar"`); `empty_filter_value_stays_in_the_text` (`"tag: x"`); `last_duplicate_filter_wins`; `args_omit_absent_options_and_zero_offset`; `args_include_offset_when_positive`; `unicode_text_survives` (`"tag:日本 ünïcode"`).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** by whitespace-splitting; `block:` maps to `block_type`. **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(cli): tui search query parser`.

---

### Task 4: Folder tree builder

**Files:** Create `src/tui/tree.rs`.

**Interfaces:** `#[derive(Debug, Clone, PartialEq)] pub enum Row { Folder { path: String, name: String, depth: usize, open: bool }, Note { path: String, title: String, depth: usize } }`; `pub fn build(notes: &[NoteMeta], expanded: &HashSet<String>) -> Vec<Row>`. Sort: at each level folders first, then notes, each case-insensitive by name/title (my call; builder may tune).

- [ ] **Step 1: Write failing tests:** `root_notes_have_depth_zero`; `nested_paths_make_folders_with_depth` (`a/b/c.md` → folders `a`, `a/b`, note depth 2 when both expanded); `collapsed_folders_hide_their_children`; `folders_sort_before_notes_case_insensitively`; `empty_input_gives_no_rows`; `unicode_and_spaced_names_sort_without_panic` (`Lecture 7/Ünï.md`).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** Split on `/` (paths are workspace-relative, forward-slash). **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(cli): tui folder tree builder`.

---

### Task 5: Markdown renderer

**Files:** Create `src/tui/markdown.rs`.

**Interfaces:** `pub fn render(markdown: &str, selected_link: Option<usize>) -> Vec<ratatui::text::Line<'static>>` (unwrapped logical lines; the view wraps); `pub fn wiki_links(markdown: &str) -> Vec<String>` (titles in document order, alias after `|` and heading after `#` stripped).
Rendering per spec: headings bold, emphasis, inline/fenced code, lists, `[ ]`/`[x]` task items, quotes, rules, links; `[[wiki-links]]` and `#tags` highlighted (the `selected_link`-th wiki-link reverse-video); frontmatter as a dim block; tables, `$$` maths, mermaid fences and `![[…]]`/image embeds as dim raw text.

- [ ] **Step 1: Write failing tests** (assert on span text and style, not whole snapshots): `heading_is_bold`; `wiki_link_is_highlighted_and_selected_one_is_reversed`; `wiki_links_lists_titles_stripping_alias_and_heading`; `task_items_keep_their_checkbox`; `frontmatter_renders_dim_and_first`; `maths_mermaid_and_embeds_fall_back_to_dim_raw`; `crlf_input_has_no_stray_carriage_returns`; `cjk_emoji_and_combining_marks_pass_through_whole` (no lossy replacement, no split characters); `a_5000_char_line_does_not_panic`; `empty_input_gives_no_lines`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** with `pulldown-cmark` events (enable task lists + tables so tables are recognised and emitted raw); wiki-links and tags found by scanning text events, not byte-slicing. **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(cli): tui markdown renderer`.

---

### Task 6: App shell — model, keys, layout, loop

**Files:**
- Create: `src/tui/model.rs`, `src/tui/view.rs`
- Modify: `src/tui/mod.rs` (real event loop replaces Task 1's)

**Interfaces:**
- Produces (`model.rs`): `pub enum View { Notes, Search, Tasks, Cards, Tags, Trash }` (keys `1`–`6`); `pub enum Msg { Key(KeyEvent), Reply(Reply), Tick(Instant) }`; `pub enum Action { Send(Job), OpenNote(String), Status(String) }`; `pub struct State { pub view: View, pub workspace: String, pub status: Option<String>, pub fatal: Option<String>, pub starting: bool, pub help: bool, pub quit: bool, … }`; `pub fn update(state: &mut State, msg: Msg) -> Vec<Job>`; consts `SEARCH_DEBOUNCE`, `KEEPALIVE`.
- **View module contract** (every file in `src/tui/views/` created by Tasks 7–11): `pub struct <Name>State` (`Debug, Default`) with `pub fn enter(&mut self) -> Vec<Action>` (view entered, or `Ctrl+R`), `pub fn key(&mut self, key: KeyEvent) -> Vec<Action>`, `pub fn reply(&mut self, reply: Reply) -> Vec<Action>`, `pub fn render(&self, frame: &mut Frame, area: Rect)`, `pub fn focused_note(&self) -> Option<String>`. `update` owns `Action` handling: `Send` → collected into the returned jobs, `Status` → `state.status`, `OpenNote(p)` → switch to Notes and call its `open(p)`.
- Produces (`view.rs`): `pub fn draw(frame: &mut Frame, state: &State)`; `pub const NARROW_COLS: u16 = 80`.
- Slot → owning view: `Notes|Preview|Backlinks` → Notes; `Search` → Search; `Tasks|TaskToggle` → Tasks; `Cards|CardWrite` → Cards; `Tags|TagNotes` → Tags; `Trash|TrashRestore` → Trash; `Capture` → handled by `update` itself (Task 12); `Keepalive` → none.
- Match arms for views not yet built return no actions; each view task replaces its own arm.

Behaviour: header `Null Notes · <workspace>`; tab row with the active view highlighted; status line with the last status/error plus key hints. Global keys when no input is open: `1`–`6` switch view (calls `enter`), `Ctrl+R` re-enters the current view, `?` toggles help overlay, `q`/`Ctrl+C` quit, `Esc` closes help. While `starting` (until the first reply of any kind) show `Starting Null Notes…`; keys other than `q`/`Ctrl+C` are ignored. Reply routing, in order: clear `starting` → fatal-class errors (`Disabled`, `Unreachable`, `VersionMismatch`, `Unauthorized`) set `state.fatal = message_for(..)` (full-screen; `r` clears it and re-enters the view, `q` quits) → `DirtyBuffer` sets the exact dirty-buffer status and is **still passed to the owning view** → other `Rejected` sets status to its message and is also passed on → pass to the owning view. `Tick(now)`: if nothing was sent for `KEEPALIVE`, emit `Job { slot: Keepalive, command: "tags.list", args: Value::Null }`.
Main loop (`mod.rs`): crossterm `poll(~50 ms)` → `Msg::Key`; drain the reply channel → `if worker.is_current(&reply) { update(.., Msg::Reply(reply)) }`; `Msg::Tick(Instant::now())` each iteration; jobs returned by `update` go to `worker.submit`; draw each iteration; first iteration submits the default view's `enter` jobs.

- [ ] **Step 1: Write failing tests** (`model.rs` with fake replies; `view.rs` with ratatui `TestBackend`):
  - `number_keys_switch_views_and_call_enter`; `ctrl_r_reenters_the_current_view`; `q_and_ctrl_c_set_quit`; `help_overlay_toggles_and_esc_closes_it`.
  - `keys_are_ignored_while_starting_except_quit`; `first_reply_clears_starting`.
  - `unreachable_reply_sets_fatal_and_r_clears_it`; `disabled_and_version_mismatch_are_fatal_with_their_messages`; `dirty_buffer_sets_the_exact_status_and_still_reaches_the_view` (fake view hook records the reply); `other_rejected_sets_status_to_the_message`.
  - `keepalive_emits_tags_list_after_five_minutes_idle_and_not_before`; `any_sent_job_resets_the_keepalive_clock`.
  - `draw_shows_workspace_tabs_and_status`; `draw_shows_the_starting_splash`; `draw_shows_the_fatal_screen_with_retry_hint`; `draw_survives_tiny_terminals` — loop sizes `1×1, 10×3, 20×5, 79×24`, no panic; `draw_clips_long_unicode_workspace_names`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `cargo test` → PASS; run by hand: header, tabs, `?`, `q`, and the splash against a closed app.
- [ ] **Step 5: Commit** `feat(cli): tui shell, key routing and layout`.

---

### Task 7: Notes view

**Files:** Create `src/tui/views/notes.rs`; Modify `model.rs`/`view.rs` arms.

**Interfaces:** `NotesState` per the view contract, plus `pub fn open(&mut self, path: String) -> Vec<Action>` (called for `OpenNote`; expands ancestors, selects, loads). Jobs: `note.list` (`Slot::Notes`), `note.read {path}` (`Slot::Preview`), `backlinks {title}` (`Slot::Backlinks`; title found from the cached `NoteMeta`). Focus cycles list → preview → backlinks with `Tab`. List: arrows/`j/k`, `Enter`/`l` expands a folder, `h` collapses; selecting a note fires `note.read` + `backlinks`. Preview focus: `j/k` scroll, `n`/`p` select next/previous wiki-link, `Enter` follows it (case-insensitive title match against cached notes; miss → `Status("no such note: <title>")`, **nothing created**). Backlinks focus: `j/k` select, `Enter` → `open`. Below `NARROW_COLS` the preview is hidden until `Enter` on a note shows it full-width; `Esc`/`Tab` returns.

- [ ] **Step 1: Write failing tests:** `enter_requests_the_note_list`; `selecting_a_note_requests_read_and_backlinks_with_its_title`; `moving_the_selection_twice_makes_the_first_preview_stale` (job ids via a fake `Worker`-free check: two `Preview` jobs emitted); `open_expands_ancestors_and_selects`; `following_a_link_matches_titles_case_insensitively`; `following_a_missing_link_sets_status_and_sends_no_job`; `backlink_enter_opens_that_note`; `folder_expand_collapse_keys`; `a_failed_read_shows_the_error_and_keeps_the_list`; `empty_workspace_renders_a_message`; `narrow_layout_shows_list_then_preview_full_width`; `long_unicode_titles_render_without_panic`; `focused_note_is_the_selected_note_or_none_for_folders`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (preview = `markdown::render` in a wrapping `Paragraph`; scroll clamps to logical line count — `// ponytail: wrapped lines make the clamp approximate`). **Step 4: Run** → PASS; manual check against a real workspace.
- [ ] **Step 5: Commit** `feat(cli): tui notes view`.

---

### Task 8: Text input and Search view

**Files:** Create `src/tui/input.rs`, `src/tui/views/search.rs`; Modify `model.rs` (adds `State.input: Option<TextInput>`; while it is `Some`, **every** key goes to the input and nothing else sees it), `view.rs`.

**Interfaces:**
- `input.rs`: `#[derive(Debug, Clone, PartialEq, Eq)] pub enum InputPurpose { Search }` (Task 12 adds variants); `pub struct TextInput { pub purpose: InputPurpose, pub value: String, … }`; `pub enum InputOutcome { Editing, Submit(String), Cancel }`; `pub fn handle(&mut self, key: KeyEvent) -> InputOutcome` — insert, backspace, delete, left/right/home/end by **char**, `Enter` submits, `Esc` cancels.
- `SearchState` per the view contract plus `pub fn set_query(&mut self, text: &str, now: Instant)` and `pub fn tick(&mut self, now: Instant) -> Vec<Action>` (called from `update`'s `Tick`). `/` from any view switches to Search with the input open. Job: `search` via `query::parse(..).args(offset)`, `Slot::Search`, sent once `SEARCH_DEBOUNCE` has passed since the last edit. `n`/`p` page by 20 (`offset`), clamped to `total`. `Enter` on a hit → `OpenNote(path)`. `Esc` in the input closes it; the typed text stays.

- [ ] **Step 1: Write failing tests:**
  - `input.rs`: `typing_inserts_at_the_cursor`; `backspace_and_delete_are_char_aware` (`"é🙂"`); `cursor_keys_clamp`; `enter_submits_and_esc_cancels`.
  - `model.rs`: `typing_q_and_digits_in_the_input_does_not_quit_or_switch_view` (types `"q3c/"`; `state.quit == false`, view unchanged, value is `"q3c/"`); `slash_opens_search_with_the_input_focused`.
  - `search.rs`: `no_job_before_the_debounce_and_one_job_after`; `an_edit_restarts_the_debounce`; `filters_are_sent_as_args` (`tag:x` → args contain `tag`); `a_stale_reply_is_not_applied` (drive through `Worker::is_current` with a fake `Call`); `paging_uses_offset_in_steps_of_20_and_clamps`; `enter_opens_the_hit`; `empty_query_clears_results_without_a_job`; `zero_results_render_a_message`; `unicode_snippets_render_without_panic`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; manual: type fast, results settle on the last query.
- [ ] **Step 5: Commit** `feat(cli): tui text input and search view`.

---

### Task 9: Tasks view

**Files:** Create `src/tui/views/tasks.rs`; Modify arms.

**Interfaces:** `TasksState` per the view contract. Rows grouped under their note title. Jobs: `tasks.list` (`Slot::Tasks`), `tasks.toggle {path, position}` (`Slot::TaskToggle`). `Space` toggles: flips the row's `done` flag at once (struck through, stays visible) and sends the job; a second `Space` toggles back. `Enter` → `OpenNote(note_path)`. Re-entering or `Ctrl+R` refetches and drops completed rows.

- [ ] **Step 1: Write failing tests:** `enter_requests_open_tasks`; `space_marks_done_strikes_through_and_sends_a_toggle`; `second_space_reopens_and_sends_another_toggle`; `a_dirty_buffer_reply_reverts_the_row_and_leaves_the_status` (reply carries the toggle's `args`, matched by path + position); `refetch_drops_completed_rows`; `rows_group_under_note_titles`; `enter_opens_the_note`; `no_tasks_renders_a_message`; `focused_note_is_the_selected_rows_note`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(cli): tui tasks view`.

---

### Task 10: Cards view

**Files:** Create `src/tui/views/cards.rs`; Modify arms.

**Interfaces:** `CardsState` per the view contract. Jobs: `cards.due` (`Slot::Cards`), `cards.grade {path, position, grade}` and `cards.suspend {path, position, suspended: true}` (`Slot::CardWrite`). Flow: front shown → `Space` reveals back → `1`–`4` = `again`/`hard`/`good`/`easy` (ignored until revealed) → advance immediately. `s` suspends and advances (allowed before reveal). MC cards list `options` on the front for context and are **self-graded**. A `CardWrite` reply that is an error (dirty or otherwise) increments `skipped`, leaves the status message, and the session continues. End screen: `<n> reviewed, <m> skipped`. Empty deck: `No cards due`.

- [ ] **Step 1: Write failing tests:** `enter_requests_due_cards`; `space_reveals_then_digits_grade_with_the_right_wire_names` (`1→again … 4→easy`); `digits_before_reveal_do_nothing`; `grading_advances_at_once`; `s_suspends_and_advances_with_suspended_true`; `a_failed_write_counts_as_skipped_and_the_session_continues`; `end_screen_counts_reviewed_and_skipped`; `empty_deck_renders_no_cards_due`; `mc_options_are_listed_and_self_graded`; `cloze_front_renders_as_is`; `long_unicode_card_text_renders_without_panic`; `focused_note_is_the_current_cards_note`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(cli): tui cards review view`.

---

### Task 11: Tags and Trash views

**Files:** Create `src/tui/views/tags.rs`, `src/tui/views/trash.rs`; Modify arms.

**Interfaces:** `TagsState` (jobs `tags.list` `Slot::Tags`, `tags.notes {tag}` `Slot::TagNotes`): `Enter` on a tag lists its notes, `Enter` on a note → `OpenNote`, `Esc` back to the tag list. `TrashState` (jobs `trash.list` `Slot::Trash`, `trash.restore {id}` `Slot::TrashRestore`): rows show `name`, `original_path` and an age from `trashed_at` (check the unit in `src-tauri/src/commands/trash.rs` before writing `fn age(trashed_at: i64, now: i64) -> String`); `r` restores, then refetches and sets `Status("Restored <name>")`.

- [ ] **Step 1: Write failing tests:** tags — `enter_requests_the_tag_list`; `enter_drills_into_the_tags_notes`; `esc_returns_to_the_tag_list`; `drilled_enter_opens_the_note`; `empty_tag_list_renders_a_message`. trash — `enter_requests_the_trash_list`; `r_restores_then_refetches_and_reports`; `a_failed_restore_shows_the_error`; `age_formats_minutes_hours_and_days`; `empty_trash_renders_a_message`; `unicode_names_render_without_panic`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(cli): tui tags and trash views`.

---

### Task 12: Capture

**Files:** Modify `src/tui/input.rs` (`InputPurpose` gains `Append { path: String }` and `NewTitle { folder: String }`), `model.rs`, `view.rs`. No new file.

**Interfaces:** `c` (no input open) shows a one-line chooser: `a` append · `n` new note · `Esc` cancel. `State::focused_note()` = the current view's `focused_note()`. Append requires a focused note, else `Status("No note in focus — open one first")` and no prompt. Submit append → `note.append {path, content: "<text>\n"}` (`Slot::Capture`). New note → `note.create {folder, title}` with `folder` = parent of the focused note (`""` if none), `Slot::Capture`; on `Ok` the reply's `NoteMeta.path` → `OpenNote`. Empty submissions do nothing. Both reuse the input swallow rule from Task 8.

- [ ] **Step 1: Write failing tests:** `c_opens_the_chooser_and_a_n_pick_the_purpose`; `append_without_a_focused_note_sets_status_and_opens_no_prompt`; `append_submits_note_append_with_a_trailing_newline`; `new_note_uses_the_focused_notes_folder_and_the_root_otherwise`; `new_note_reply_opens_the_created_note`; `empty_submit_sends_nothing`; `typing_q_and_digits_into_capture_does_not_quit_or_switch`; `dirty_buffer_on_append_sets_the_status_and_the_prompt_is_closed`; `unicode_text_round_trips_into_the_job_args`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(cli): tui capture`.

---

### Task 13: Docs, QA and gates

**Files:** Modify `docs/cli.md` (new `tui` section); Create nothing else.

- [ ] **Step 1: Docs.** Add to `docs/cli.md`: what `nullnotes tui` is, the key model (`1`–`6`, `/`, `c`, `Ctrl+R`, `?`, `q`), "needs an interactive terminal (exit 2 otherwise)", and one line: *agents do not use it — use the JSON commands.*
- [ ] **Step 2: Gates** in `src-tauri/cli`: `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test` — all clean.
- [ ] **Step 3: Manual QA** against a real workspace in Windows Terminal, recording results in the commit message body:
  - Cold start from a closed app: splash shows, then the notes list; `Ctrl+C` during the splash exits at once and leaves the shell usable.
  - Search round-trip with a `tag:` filter; typing quickly settles on the last query.
  - Grade a card, skip one by editing its note in the GUI first (status shows the dirty-buffer text, session continues).
  - Toggle a task, toggle it back; confirm the change in the GUI.
  - Capture an appended line and a new note; confirm in the GUI.
  - `Ctrl+C` mid-session and a forced panic (temporary `panic!` on a debug key, removed after) both leave the terminal usable.
  - `NO_COLOR=1` shows no colour; a 20×5 window does not crash; a note with CJK/emoji and CRLF endings renders.
- [ ] **Step 4: Commit** `docs: nullnotes tui in cli.md`.

---

## Decisions made while planning

- Split-pane only for Notes; Search/Tasks/Cards/Tags/Trash are full-width and `Enter` opens a note in Notes (the spec's single layout diagram read narrowly).
- Notes `Tab` cycles list → preview → backlinks (spec said list ↔ preview) so backlinks are reachable by keyboard.
- Cards: grading keys work only after reveal; the card advances immediately and a failed write counts as skipped.
- Sort order: folders first, then notes, case-insensitive by name.
- One worker thread (`ponytail:` noted in Task 2).

# Bases Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Read, show and edit YAML frontmatter properties on notes, and open `.base` files (Obsidian's format) as table, list, cards, kanban and map views over those properties.

**Architecture:** Rust parses frontmatter into a rebuildable `note_properties` table (JSON per note) during `reindex_note`, and edits frontmatter by surgical text edit so comments, key order and quoting survive. One TypeScript evaluator runs filters, formulas, sort and group over rows fetched in one call. `.base` files ride the existing `.canvas` file plumbing (scan, tree, tab, watcher, trash).

**Tech Stack:** Tauri 2 / Rust (`serde_yaml_ng`, new), React 19, TypeScript strict, Zustand, `yaml` (new, npm), `leaflet` (new, raster map), Vitest.

**Spec:** `docs/specs/bases-design.md`

## Execution Options

Leave every box below unchecked. The executing skill resolves them with
your human partner before Step 1 and checks the chosen boxes itself.

**Execution Target:**
- [x] Current branch (no isolation)
- [ ] New feature branch (no worktree)
- [ ] Worktree (superpowers:using-git-worktrees)

**Execution Mode:**
- [x] Inline execution (superpowers:executing-plans)
- [ ] Subagent-driven execution (superpowers:subagent-driven-development)

## Global Constraints

- **Amends spec decision 10:** the agent canvas has landed, so `.base` reuses its plumbing by widening it. The existing `WorkspaceTree.canvases` list (Rust `scan_dir_recursive`, `src/store/notes.ts`) holds both `.canvas` and `.base` paths; the tree classifies by extension. No second parallel list.
- **Amends spec decision 11:** a view write calls the Rust command `write_note_property`, which re-reads the file and refuses with an error starting `STALE:` if the property's current value differs from the value the view displayed (`expected`). An open note with unsaved edits then gets the existing `ConflictBar` from `useNote`'s `workspace-changed` handler. The properties block, which lives inside the open note, instead edits the content string and calls `onSave`, so it goes through the normal buffer. Task 14 rewrites decisions 10 and 11 in the spec to match.
- Frontmatter is the source of truth; `note_properties` in `index.db` is rebuildable. Property work runs in `reindex_note`/`index_note_at`, never in `save_note`.
- A property edit never rewrites the frontmatter block: comments, key order, quoting style, flow-vs-block list style and unknown keys survive. Frontmatter that fails to parse is never edited (`Err`), is shown read-only, and the note stays in bases with empty properties.
- Every file write goes through `write_atomic`. `.base` saves preserve keys and functions we don't implement; a view that needs one shows an "unsupported" marker instead of dropping rows.
- Formulas and filters are parsed and evaluated by our own fixed evaluator: nothing is executed; the function library is a fixed table in code (no user functions).
- Property keys are case-sensitive as written. `tags` reads as a list whether written as a YAML list or comma string; writes produce a YAML list in the file's existing style.
- Types are inferred from the YAML value (`text|number|checkbox|date|datetime|list`); a `YYYY-MM-DD` string is a date. No types registry.
- Desktop only. `.base` stays out of full-text search, the graph and backlinks.
- `.base` is YAML in Obsidian's syntax. The builder reads <https://obsidian.md/help/bases/syntax>, `/formulas`, `/functions`, `/views/table`, `/views/list`, `/views/cards`, `/views/kanban` and the map view page in full before Task 6 and Task 9; where a key is not in Obsidian's format it is ours.
- No new CSP origin. Map uses raster tiles (`img-src https:` already allows them); tile URL is the new setting `mapTileUrl`, default `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, with attribution.
- Colours from the token bridge in `src/index.css`; dialog/pane chrome uses existing classes. Grep `src/index.css` for every className introduced before calling a task done; add only the CSS a new list/row needs.
- Rust: no `.unwrap()`/`.expect()` outside tests; `cargo clippy -- -D warnings` and `cargo fmt --check` clean. TS: no `any`; named exports; one component per file, ~150 lines max.

## Review Focus

1. **Quoted/escaped values** (`title: "a: b"`, `status: 'done'`, multi-line `>` scalars) must survive an unrelated key's edit byte-for-byte (Task 1).
2. **CRLF files and a missing trailing newline** — an edit keeps the file's line endings (Task 1).
3. **Note has no frontmatter yet** — first property add creates the block at the top and never touches the body (Task 1).
4. **Tag spelled `tags: a, b`, `tags: [a, b]`, block list, or `tag:`/`Tags:`** — only the first three feed the tag index; keys are case-sensitive (Task 2).
5. **Two views of one note racing** (kanban drag while the note is edited elsewhere) — stale write is refused, never silently applied (Task 3).
6. **Empty column / unset property in kanban and table** — rows with no value land in a "No value" column and sort last, they don't vanish (Task 8, 11).
7. **Malformed `.base` file or formula** — view shows the error inline, file is never overwritten until fixed (Task 6, 10).

---

### Task 1: Frontmatter property engine (Rust, pure)

**Files:**
- Create: `src-tauri/src/properties.rs`
- Modify: `src-tauri/src/lib.rs` (`mod properties;`), `src-tauri/Cargo.toml` (`serde_yaml_ng = "0.10"`)
- Test: in-file `#[cfg(test)]` module

**Interfaces:**
- Consumes: `commands::notes::split_frontmatter(content: &str) -> (&str, &str)`
- Produces:
  - `pub type Properties = serde_json::Map<String, serde_json::Value>`
  - `pub fn parse_properties(frontmatter: &str) -> Result<Properties, String>` — `""` → empty map; `Err(msg)` on invalid YAML or a non-mapping root
  - `pub fn set_property(content: &str, key: &str, value: &Value) -> Result<String, String>`
  - `pub fn remove_property(content: &str, key: &str) -> Result<String, String>`
  - `pub fn rename_property(content: &str, from: &str, to: &str) -> Result<String, String>`
  - `pub fn frontmatter_for(props: &Properties) -> String` (block with `---` delimiters, `""` for an empty map)

- [ ] **Step 1: Write failing tests** (names; each asserts exact output strings)
  - `set_property_replaces_only_that_keys_lines` — comments, other keys, quoting and a `>` multi-line scalar elsewhere stay byte-identical
  - `set_property_appends_before_closing_delimiter_when_key_is_new`
  - `set_property_creates_block_when_note_has_none` — body unchanged
  - `set_list_keeps_flow_style_when_existing_is_flow_and_block_when_block`
  - `scalar_quoting` — values that would parse as another type (`"true"`, `"123"`, `"a: b"`, leading `[`) are written quoted
  - `crlf_and_no_trailing_newline_preserved`
  - `remove_property_removes_key_and_its_continuation_lines`
  - `rename_property_keeps_value_and_position`
  - `unparseable_frontmatter_is_never_edited` — all three edit fns return `Err`, input unchanged
  - `parse_properties_maps_scalars_lists_dates_and_reports_yaml_errors`
- [ ] **Step 2: Run** `cargo test properties::` from `src-tauri/` → FAIL (module missing)
- [ ] **Step 3: Implement** the functions above. Parse with `serde_yaml_ng` into `serde_json::Value`. Edits are line-based on the raw frontmatter text: find the top-level `key:` line, its range runs to the next line starting at column 0 that is a key or the closing `---` (comment lines directly above a key belong to the preceding key's gap, not its range); replace/remove that range. Serialize only the new value (scalar via `serde_yaml_ng`, quoting when a round-trip through `parse_properties` would change type).
- [ ] **Step 4: Run** `cargo test properties::` → PASS; `cargo clippy -- -D warnings`
- [ ] **Step 5: Commit** `feat(properties): surgical frontmatter property engine`

### Task 2: Index properties; frontmatter feeds tags, links, FTS

**Files:**
- Modify: `src-tauri/src/db/schema.rs`, `src-tauri/src/db/notes.rs`, `src-tauri/src/commands/notes.rs` (`index_note_at`, `extract_tags`/`extract_links` callers, `forget_note`, existing frontmatter-hidden tests ~line 2634+)
- Create: `src-tauri/src/db/properties.rs` (+ `mod` in `db/mod.rs`)
- Test: `db/schema.rs` tests, `db/properties.rs`, `commands/notes.rs` tests

**Interfaces:**
- Consumes: Task 1 `parse_properties`
- Produces:
  - table `note_properties(note_path TEXT PRIMARY KEY, json TEXT NOT NULL, error TEXT)`
  - `db::properties::set_properties(pool: &SqlitePool, note_path: &str, props: &Properties, error: Option<&str>) -> Result<()>`
  - `db::properties::all_properties(pool, workspace: &str) -> Result<Vec<(String, String, Option<String>)>>` (path, json, error) joined on `notes.workspace`
  - `pub fn property_tags(props: &Properties) -> Vec<String>`, `pub fn property_links(props: &Properties) -> Vec<String>`, `pub fn property_text(props: &Properties) -> String` in `properties.rs`

- [ ] **Step 1: Failing tests**
  - schema: migration idempotent with the new table
  - `index_note_at_stores_properties_json_and_parse_error`
  - `frontmatter_tags_merge_into_note_tags_for_list_and_comma_string_but_not_tag_or_Tags_keys`
  - `bracket_links_in_property_values_become_outgoing_links_and_backlinks`
  - `property_values_are_fts_searchable_but_keys_are_not`
  - `properties_row_follows_rename_move_and_delete` (mirror every place `note_tags` is touched in `db/notes.rs`: `rename_path_prefix`, `remove_notes_under`, `update_path`, `remove_note`)
  - Rewrite the existing tests that assert `#hidden` / `[[Hidden]]` inside frontmatter are *not* indexed so they now assert tags/links in **frontmatter prose-like text** stay unindexed but `tags:`/`[[…]]` *values* are
- [ ] **Step 2: Run** `cargo test` for those → FAIL
- [ ] **Step 3: Implement** the migration, `set_properties`, and the three extractors; call them from `index_note_at` (parse once; on `Err` store `{}` plus the error). Merge `property_tags` into the existing `set_tags` call and `property_links` into `set_links`; append `property_text` to `fts_body`.
- [ ] **Step 4: Run** `cargo test`; `cargo clippy -- -D warnings`; `cargo fmt --check`
- [ ] **Step 5: Commit** `feat(index): index note properties; frontmatter feeds tags, links and search`

### Task 3: Property commands and `.base` file plumbing (Rust)

**Files:**
- Modify: `src-tauri/src/commands/notes.rs` (new commands, widen `scan_dir_recursive` to `canvas|base`, `rename_canvas` to accept `.base`), `src-tauri/src/commands/watcher.rs` (`is_canvas_path` also matches `base`), `src-tauri/src/commands/trash.rs` (`is_canvas` also `base`), `src-tauri/src/models.rs` (`BaseRow`, `AppSettings.map_tile_url`), `src-tauri/src/lib.rs` (register)
- Test: existing test modules of each file

**Interfaces:**
- Produces (Tauri commands, camelCase over IPC):
  - `list_base_rows(workspace: String) -> Vec<BaseRow>`; `BaseRow { path, title, properties: serde_json::Value, parse_error: Option<String>, ctime: i64, mtime: i64, size: u64, tags: Vec<String>, links: Vec<String>, backlinks: Vec<String> }` (ctime/mtime/size from `fs::metadata` at call time)
  - `parse_note_properties(content: String) -> PropertiesResult { properties: Value, error: Option<String> }`
  - `edit_content_property(content: String, edit: PropertyEdit) -> Result<String, String>`; `enum PropertyEdit { Set{key, value}, Remove{key}, Rename{from, to} }`
  - `write_note_property(workspace, path, key: String, expected: Option<Value>, value: Option<Value>) -> Result<(), String>` — re-reads, errors `STALE: …` if current ≠ `expected`, `value: None` removes the key; `write_atomic`, then `index_note_at`
  - `create_note_with_properties(workspace, folder, title, properties: Properties) -> NoteMetadata` (frontmatter via `frontmatter_for`, then `# title`)
  - `create_base(workspace, folder, name) -> String` — mirrors `create_canvas`; content `views:\n  - type: table\n    name: Table\n`
  - setting `map_tile_url: String` (serde default = OSM URL)

- [ ] **Step 1: Failing tests:** scan returns a `.base` in `canvases`; watcher classifies `.base` and ignores its temp file; trash/restore of a `.base` keeps a same-named note's sidecars; `write_note_property` applies when `expected` matches, returns `STALE:` and leaves the file untouched when it doesn't; `create_base` refuses an existing name; `rename_canvas` renames `a.base` keeping the extension; `list_base_rows` includes tags merged from frontmatter and a row with `parse_error`.
- [ ] **Step 2: Run** `cargo test` → FAIL
- [ ] **Step 3: Implement** as specified, thin commands delegating to `properties.rs`/`db`.
- [ ] **Step 4: Run** `cargo test`, `cargo clippy -- -D warnings`, `cargo fmt --check` → clean
- [ ] **Step 5: Commit** `feat(bases): property and .base commands; .base shares the canvas file plumbing`

### Task 4: TypeScript API, types, `.base` in tree and tabs

**Files:**
- Modify: `src/lib/tauri.ts` (`api.properties.*`, `api.base.create`), `src/types/index.ts` (`BaseRow`, `PropertyEdit`, `AppSettings.mapTileUrl`), `src/store/settings.ts` (default), `src/lib/canvasPath.ts` (add `isBasePath`), `src/lib/folderTree.ts` (strip `.base` from the display name), `src/store/workspace.ts:209` (`setSecondaryTab` rejects base), `src/store/notes.ts` (`noteTitle` strips `.base`), `src/lib/noteActions.ts` (rename/delete cover `.base`), `src/components/NoteContextMenuItems.tsx`, `src/components/TreeNode.tsx` ("New base" in folder menu next to "New canvas"), `src/web/memoryWorkspace.ts` (stubs so web typecheck passes)
- Create: `src/hooks/useCreateBase.ts` (copy of `useCreateCanvas`, prompt "Base name:")
- Test: `src/lib/folderTree.test.ts`, `src/lib/canvasPath.test.ts`, `src/store/workspace.test.ts`

**Interfaces:**
- Produces: `isBasePath(path: string): boolean`; `api.properties.listRows(workspace): Promise<BaseRow[]>`, `.parse(content)`, `.edit(content, edit)`, `.writeProperty(workspace, path, key, expected, value)`, `.createNote(workspace, folder, title, properties)`; `api.base.create(workspace, folder, name)`

- [ ] **Step 1: Failing tests:** `buildFolderTree` shows `Tasks.base` as name `Tasks`; `isBasePath('a/x.base')` true, `.basement` false; `setSecondaryTab('x.base')` is a no-op.
- [ ] **Step 2: Run** `npx vitest run src/lib src/store` → FAIL
- [ ] **Step 3: Implement** the edits above.
- [ ] **Step 4: Run** `npm run typecheck && npx vitest run` → PASS
- [ ] **Step 5: Commit** `feat(bases): .base files in the tree, tabs and New base action`

### Task 5: Properties block in the editor

**Files:**
- Create: `src/components/PropertiesBlock.tsx`, `src/hooks/useProperties.ts`, `src/lib/propertyType.ts`
- Modify: `src/components/EditorPane.tsx` (render above `NoteEditor` in `wysiwyg` mode, between `isLoading` guard and editor), `src/index.css` (`.properties-block` rows; grep first)
- Test: `src/lib/propertyType.test.ts`, `src/components/PropertiesBlock.test.tsx`

**Interfaces:**
- Produces: `inferType(value: unknown): PropertyType` (`'text'|'number'|'checkbox'|'date'|'datetime'|'list'`); `useProperties(content: string): { properties: Record<string, unknown>; error: string | null }` (calls `api.properties.parse`, debounced to content changes); `PropertiesBlock({ content, onSave })` — typed inputs per key; add / remove / rename key; every change calls `api.properties.edit(content, edit)` then `onSave(newContent)`.

- [ ] **Step 1: Failing tests:** `inferType` table (`'2026-10-31'`→date, `'2026-10-31T10:00'`→datetime, `true`→checkbox, `3`→number, `['a']`→list, `'x'`→text); `PropertiesBlock` with a parse error shows the message and no inputs; editing a checkbox calls `onSave` with the string returned by a mocked `api.properties.edit`.
- [ ] **Step 2: Run** `npx vitest run src/lib/propertyType.test.ts src/components/PropertiesBlock.test.tsx` → FAIL
- [ ] **Step 3: Implement.** Collapsed by default when the note has no properties (shows "Add property"); never shown in raw mode.
- [ ] **Step 4: Run** tests + `npm run typecheck` → PASS
- [ ] **Step 5: Commit** `feat(editor): properties block above the note body`

### Task 6: `.base` file model (pure TS)

**Files:**
- Create: `src/lib/baseFile.ts`; add `yaml` to `package.json`
- Test: `src/lib/baseFile.test.ts`

**Interfaces:**
- Produces:
  - `interface BaseView { type: string; name: string; [key: string]: unknown }`
  - `interface BaseFile { filters?: unknown; formulas?: Record<string, string>; properties?: Record<string, { displayName?: string }>; views: BaseView[] }`
  - `parseBase(text: string): { ok: true; doc: BaseDoc; base: BaseFile } | { ok: false; error: string }` where `BaseDoc` wraps the `yaml` `Document` (comments and unknown keys live in it)
  - `serializeBase(doc: BaseDoc): string`
  - `updateView(doc: BaseDoc, index: number, patch: Partial<BaseView>): void`, `addView(doc, view: BaseView): void`, `removeView(doc, index): void`, `renameView(doc, index, name): void`, `setFilters(doc, filters: unknown): void`

- [ ] **Step 1: Failing tests:** an Obsidian-authored fixture round-trips byte-identical when nothing changed; unknown top-level and per-view keys and comments survive `updateView`; a syntax error returns `{ok:false}` with a line number in `error`; empty text parses to `{views: []}`.
- [ ] **Step 2: Run** `npx vitest run src/lib/baseFile.test.ts` → FAIL
- [ ] **Step 3: Implement** on the `yaml` package's `Document` API (edits mutate the document; `String(doc)` serializes).
- [ ] **Step 4: Run** → PASS
- [ ] **Step 5: Commit** `feat(bases): lossless .base file model`

### Task 7: Expression engine (pure TS)

**Files:**
- Create: `src/lib/baseExpr.ts` (parser), `src/lib/baseFunctions.ts` (fixed function table), `src/lib/baseValue.ts` (value types + coercion)
- Test: `src/lib/baseExpr.test.ts`

**Interfaces:**
- Produces:
  - `type BaseValue = null | boolean | number | string | BaseDate | BaseValue[] | { [key: string]: BaseValue } | BaseLink`
  - `parseExpression(src: string): { ok: true; expr: Expr } | { ok: false; error: string }`
  - `evaluate(expr: Expr, scope: Scope): BaseValue` where `Scope { row: BaseRow; thisRow: BaseRow | null; formulas: Record<string, Expr> }`; never throws — an unknown function returns `{unsupported: name}` collected by the caller via `unsupportedFunctions(expr: Expr): string[]`
  - `FUNCTIONS: Record<string, (args: BaseValue[], self?: BaseValue) => BaseValue>` — exactly the string/number/date/list/file/link functions on the Obsidian functions page

- [ ] **Step 1: Failing tests** (assert values): operator precedence and `&&`/`||`/`!`; comparison of dates/numbers/strings; `file.hasTag("a")` on tags merged from frontmatter; `note.status`, bare `status` and `formula.x` resolve; `this.file.name`; date arithmetic (`now() - file.mtime`); `list.contains`, `.map`, `.filter`; division by zero is `null`, not a throw; unknown function → `unsupportedFunctions` returns its name; unbalanced parens → `{ok:false}` with a position.
- [ ] **Step 2: Run** `npx vitest run src/lib/baseExpr.test.ts` → FAIL
- [ ] **Step 3: Implement** a hand-written tokenizer + precedence-climbing parser; function table copied from the documented list only.
- [ ] **Step 4: Run** → PASS
- [ ] **Step 5: Commit** `feat(bases): fixed-vocabulary filter and formula evaluator`

### Task 8: View query (filters, sort, group, columns)

**Files:**
- Create: `src/lib/baseQuery.ts`
- Test: `src/lib/baseQuery.test.ts`

**Interfaces:**
- Consumes: Tasks 6, 7; `BaseRow`
- Produces: `runView(base: BaseFile, viewIndex: number, rows: BaseRow[], thisRow: BaseRow | null): ViewResult` with `ViewResult { columns: { id: string; label: string }[]; groups: { key: BaseValue; label: string; rows: BaseRow[] }[]; errors: string[]; unsupported: string[] }`. Filters = base-level AND view-level (`and`/`or`/`not` groups and expression strings); one ungrouped group when no `groupBy`; rows without a value group under label "No value", sorted last.

- [ ] **Step 1: Failing tests:** base filter + view filter both apply; `or` group; sort ASC/DESC with nulls last; `groupBy` order; formula column; `displayName` label; a filter using an unknown function yields `unsupported: ['fn']` and the view still returns the rows it could evaluate; a bad expression yields an entry in `errors`.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS
- [ ] **Step 5: Commit** `feat(bases): view query over property rows`

### Task 9: Rows store, base hook, write path

**Files:**
- Create: `src/store/baseRows.ts`, `src/hooks/useBaseRows.ts`, `src/hooks/useBase.ts`, `src/hooks/usePropertyWrite.ts`
- Modify: `src/hooks/useExternalChanges.ts` (reload rows after the existing `reindexFromDisk` + `refreshTree` pair; also on `canvas-changed`)
- Test: `src/store/baseRows.test.ts`, `src/hooks/usePropertyWrite.test.ts`, `src/hooks/useBase.test.ts`

**Interfaces:**
- Produces:
  - `useBaseRowsStore`: `{ rows: BaseRow[]; load(workspace): Promise<void>; patch(path, key, value: unknown | undefined): void }`
  - `useBaseRows(): BaseRow[]` — loads on mount, reloads on `workspace-changed`
  - `useBase(path: string)` — like `useCanvas`: `{ base, doc, error, saveState, conflict, update(fn: (doc: BaseDoc) => void), keepMine, reloadTheirs, source, setSource(text) }`; saves via `api.notes.save` (generic `write_atomic`), refuses to save while `error` is set
  - `usePropertyWrite(): (row: BaseRow, key: string, value: unknown | undefined) => Promise<void>` — optimistic `patch`, `api.properties.writeProperty(…, expected = row.properties[key], value)`, then pushes a toast `"<message>"` with `Undo` (action reverses with `expected = value`); on `STALE:` reverts the patch and toasts "Note changed since — reload"; other errors revert and toast

- [ ] **Step 1: Failing tests:** `patch` updates one row only; write success pushes a toast whose action calls write with swapped expected/value; `STALE:` reverts the optimistic patch; `useBase` with a syntax-error file sets `error` and `update` does not call save.
- [ ] **Step 2: Run** `npx vitest run src/store src/hooks` → FAIL
- [ ] **Step 3: Implement**, reusing `ConflictBar` semantics from `useCanvas` (dirty `.base` is never overwritten from disk).
- [ ] **Step 4: Run** → PASS
- [ ] **Step 5: Commit** `feat(bases): rows store, base hook and property write path`

### Task 10: BasePane, toolbar and table + list layouts

**Files:**
- Create: `src/components/BasePane.tsx`, `src/components/base/BaseToolbar.tsx`, `src/components/base/TableView.tsx`, `src/components/base/ListView.tsx`, `src/components/base/PropertyCell.tsx`, `src/components/base/BaseSource.tsx`
- Modify: `src/components/Layout.tsx` (render `BasePane` for `isBasePath(activeTab)`, lazy like `CanvasPane`; `canvasTab` becomes "file tab" for both), `src/index.css`
- Test: `src/components/base/TableView.test.tsx`, `src/components/BasePane.test.tsx`

**Interfaces:**
- Consumes: Tasks 6, 8, 9
- Produces: `BasePane({ path, embedded?: boolean })`; `interface LayoutProps { result: ViewResult; rows: BaseRow[]; view: BaseView; onWrite: (row, key, value) => void; onCreate: (properties: Record<string, unknown>) => void; onOpen: (path: string) => void }` shared by all five layouts. Toolbar: view tabs (add/rename/delete), column picker + reorder, sort, group-by, "Edit source" toggle (raw YAML textarea, parse error inline, saves only when valid). "New" button calls `api.properties.createNote` in the base's folder (or the folder from a `file.inFolder("…")` filter) pre-filled from simple `==` filters, then focuses it for rename. Unsupported markers and errors render in a banner above the view.

- [ ] **Step 1: Failing tests:** table renders rows grouped by a property; editing a checkbox cell calls `onWrite(row, key, true)`; a view with `unsupported: ['fn']` shows the marker and still lists rows; "Edit source" with invalid YAML shows the error and does not save.
- [ ] **Step 2: Run** `npx vitest run src/components` → FAIL
- [ ] **Step 3: Implement.** Layout-specific YAML keys come from the Obsidian view pages.
- [ ] **Step 4: Run** → PASS; `npm run typecheck`
- [ ] **Step 5: Commit** `feat(bases): base pane with table and list views`

### Task 11: Cards and kanban layouts

**Files:**
- Create: `src/components/base/CardsView.tsx`, `src/components/base/KanbanView.tsx`
- Modify: `src/components/BasePane.tsx` (dispatch), `src/index.css`
- Test: `src/components/base/KanbanView.test.tsx`, `src/lib/kanbanMove.test.ts`; create `src/lib/kanbanMove.ts`

**Interfaces:**
- Produces: `kanbanMove(current: unknown, fromKey: BaseValue, toKey: BaseValue): unknown` — for a scalar property returns `toKey`; for a list property replaces just `fromKey` with `toKey`; `toKey` of "No value" returns `undefined` (remove). `KanbanView` uses native HTML5 drag-and-drop (no new dependency), one column per `ViewResult.groups` entry, order inside a column follows the view sort only; each column has "+ add card" calling `onCreate({[groupProperty]: column.key})`; "No value" column last.

- [ ] **Step 1: Failing tests:** `kanbanMove` scalar/list/no-value cases; dropping a card on another column calls `onWrite(row, groupProperty, newValue)`; "+ add card" passes the column value.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS
- [ ] **Step 5: Commit** `feat(bases): cards and kanban views`

### Task 12: Map layout

**Files:**
- Create: `src/components/base/MapView.tsx`, `src/lib/mapCoords.ts`; add `leaflet`, `@types/leaflet` to `package.json`
- Modify: `src/components/BasePane.tsx`, `src/components/SettingsPanel.tsx` (text field "Map tile URL", reuse existing settings-row classes), `src/index.css` (leaflet base CSS imported once)
- Test: `src/lib/mapCoords.test.ts`

**Interfaces:**
- Produces: `readCoords(value: unknown): [number, number] | null` accepting `[lat, lng]` and `"lat,lng"`, rejecting out-of-range or non-numeric. `MapView` reads the coordinate property named by the map view's config key (per Obsidian's map page), pins link to the note, uses `settings.mapTileUrl` with attribution, and when tiles fail to load shows pins on a blank background with a notice.

- [ ] **Step 1: Failing tests:** `readCoords` table incl. `[91, 0]` → null, `"48.2,16.4"` → `[48.2,16.4]`, `"x"` → null.
- [ ] **Step 2: Run** `npx vitest run src/lib/mapCoords.test.ts` → FAIL
- [ ] **Step 3: Implement.** Leaflet is not unit-tested (jsdom); verified in Task 15.
- [ ] **Step 4: Run** tests + `npm run typecheck`
- [ ] **Step 5: Commit** `feat(bases): map view with configurable raster tiles`

### Task 13: Embed `![[X.base]]` in notes

**Files:**
- Modify: `src/editor/extensions/NoteEmbedView.tsx` (when `title` ends with `.base`, resolve against `useNotesStore.canvases` by file name and render `<BasePane path embedded thisPath={notePath}>`; otherwise unchanged), `src/components/BasePane.tsx` (`thisPath` → `thisRow` for `this`)
- Test: `src/editor/extensions/NoteEmbed.test.tsx` (mount via `useEditor`/`EditorContent` per CLAUDE.md)

**Interfaces:**
- Consumes: Task 10 `BasePane`
- Produces: `BasePane({ path, embedded, thisPath? })`. Embed is interactive; `this` is the embedding note. Missing base renders the existing "not found" state.

- [ ] **Step 1: Failing tests:** `![[Tasks.base]]` serializes back to the same Markdown; the node view renders a table for a mocked base; a missing base shows not-found; `spellcheck="false"` is on the node.
- [ ] **Step 2: Run** `npx vitest run src/editor/extensions/NoteEmbed.test.tsx` → FAIL
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS
- [ ] **Step 5: Commit** `feat(bases): embed a base in a note`

### Task 14: Docs

**Files:**
- Modify: `docs/ROADMAP.md` (§5 frontmatter deferral: trigger now Bases, resolved 2026-11-01; §4 "Query blocks / Dataview-lite" row: still not built, point to the Bases spec; §1 new-workspace-state row for `.base`), `docs/specs/tags-backlinks-design.md` (frontmatter tags no longer a non-goal), `docs/specs/bases-design.md` (rewrite decisions 10 and 11 per Global Constraints), `docs/competitor-audits/obsidian/feature-inventory.md` (BS-001 → Done), `CLAUDE.md` (storage-boundary list gains `NameBase.base`; one line pointing to `src-tauri/src/properties.rs` rules)
- [ ] **Step 1:** make the edits; **Step 2:** `git diff --stat` shows only these files; **Step 3: Commit** `docs: record Bases decisions and resolve the frontmatter deferral`

### Task 15: End-to-end verification

**Files:**
- Create: `e2e/specs/bases.e2e.ts`
- [ ] **Step 1:** use the `e2e-verify` skill to write a spec: create a workspace with three notes with `status` frontmatter, create a base, switch to kanban, drag a card, assert the note file's frontmatter changed and its comments survived.
- [ ] **Step 2:** `npm run test:e2e` → PASS; screenshot each of the five layouts and inspect against `ui-preview` for spacing (per the project's spacing-gap lesson).
- [ ] **Step 3: Commit** `test(e2e): bases kanban drag writes frontmatter`

---

## Self-review notes

- Spec coverage: properties UI (5), `.base` format and five layouts (6–12), filters/formulas fixed set (7), kanban rules (11), tile setting (3, 12), embed (13), frontmatter→indexes (2), storage/ROADMAP (14), minimal editing UI with raw-YAML filters (10), create-from-view (3, 10), undo toast (9), malformed frontmatter (1, 5), no search/graph/backlinks (3, nothing added).
- Not covered by a task and intentionally left to the builder: exact `.base` layout keys (read from Obsidian pages), function list contents, CSS.

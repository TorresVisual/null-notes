# null-notes — Bases Design

Database-style views over note properties: a `.base` file defines filters, columns, sorting and grouping, and renders the matching notes as a **table, list, cards, kanban board or map**. Properties are YAML frontmatter at the top of a note, editable from the note and from the views. Obsidian's [Bases](https://obsidian.md/help/bases) is the reference, and the file format follows it so the same vault opens in both apps.

## Why

The user wants this feature (decided 2026-10-31, after the competitor audit logged it as BS-001 "Missing" and ROADMAP §4 challenged its sibling "Query blocks / Dataview-lite"). The existing answers — P6-5 tag/folder filters, the P9-1 task view, planned saved searches — browse notes by *where they are or what they're tagged*. None of them can show or edit *per-note fields* (status, due date, course, priority, location), which is what a table or board is for.

## Reverses two closed decisions

Both must be re-recorded in `docs/ROADMAP.md` as part of the work (CLAUDE.md requires it for new workspace state):

- **Frontmatter deferral (§5, 2026-07-29).** It named P9-3 as the only trigger and said not to add frontmatter "for any other reason without a concrete consumer." Bases is that consumer. Reword the entry; do not delete it.
- **Query blocks / Dataview-lite (§4 row).** Still *not* built. Bases is a fixed-vocabulary filter/formula set in a separate file, not a query language embedded in note text. The row should say so and point here.

## Goals

- Read, show and edit YAML frontmatter properties on any note, including notes imported from an Obsidian vault. Editing never destroys what the user wrote: comments, key order, quoting style and unknown keys survive.
- Create, open and edit `.base` files in any workspace, with all five layouts: table, list, cards, kanban, map.
- `.base` files written by Obsidian open and work here for the supported subset; files written here open in Obsidian. Syntax outside the supported subset is preserved on save, never dropped.
- Edit a property from a view (cell edit in the table, drag between kanban columns) and have it land in the note's frontmatter safely.
- Embed a base in a note with `![[Tasks.base]]`.

## Non-goals

- No query language: no user-defined functions, no JavaScript, no subqueries.
- No plugin views and no `.obsidian/` config. Property types are inferred from the YAML value; there is no types registry.
- No column summaries/aggregations in v1 (a later add; the file format preserves them).
- No Bases on mobile in v1 (desktop only, same call as the agent canvas).
- No bulk "edit this property across all matching notes."

## Anti-goals

- A property edit that rewrites the whole frontmatter block, reformats it, or loses comments. That is the D01 class of bug (silent corruption on save) and would make this feature worse than not having it.
- Any write to a note that bypasses `write_atomic`, or that overwrites a note with a dirty editor buffer.
- DB work on the keystroke path. Property indexing rides `reindex_note`, never `save_note`.
- The formula set growing function by function until it is a language. The function list is fixed in the code and documented; adding to it is a deliberate change.

## Storage boundary

| State | Where | Why |
|---|---|---|
| Properties | Frontmatter in the `.md` file, inside the workspace | Travels and merges with the note. Source of truth. |
| Base definitions | `Name.base`, YAML, inside the workspace | Content that other machines merge; line-oriented YAML merges. |
| `note_properties` index | `index.db` in the OS app-data dir | Rebuildable from the notes, so it can be excluded from sync. |
| Open view state (scroll, selected view) | `.workspace.json` (gitignored) | UI state, as for the canvas. |

## Constraints (from the codebase)

- **The save path rules apply to every property edit.** Frontmatter is currently an opaque verbatim string (`split_frontmatter` in `src-tauri/src/commands/notes.rs`, mirrored in `src/lib/frontmatter.ts`; `frontmatter + body == content`). A property edit is a *surgical text edit of that string*, written through `write_atomic`. If the note is open with a dirty buffer, the edit must go through the open buffer or prompt, never overwrite from disk. The watcher's echo of our own write must not raise a false conflict.
- **Indexing:** property extraction runs in `reindex_note` on its slower debounce, alongside FTS/tags/links/tasks, writing a new `note_properties` table (migration in `src-tauri/src/db/schema.rs`). `save_note` stays DB-free.
- **Untrusted input.** A `.base` file or a note's frontmatter can arrive via git pull. Formulas and filters are parsed and evaluated by our own fixed evaluator; nothing is executed, no shell, no file access beyond the index. A base's file/folder filters read the index only.
- **Map tiles are a network dependency** in an otherwise offline app (see Decisions).
- **`.base` registered like `.canvas`**: visible in the sidebar tree, opens in a tab, goes through the same recoverable trash, appears in the watcher path.
- **Embed** is a TipTap node: it needs `addStorage().markdown.serialize/parse`, `spellcheck="false"`, and a `ReactNodeViewRenderer` (so tests mount through `useEditor`/`EditorContent`). Check `note-embeds-design.md` for the existing `![[…]]` embed before adding a second node.
- UI follows project conventions: state in hooks, pure parse/evaluate code in `src/lib/`, dialogs reuse `index.css` classes, colours from the token bridge, no `any`.

## Decisions

Decided with the user:

1. Build properties and Bases together as one project (approach A below), not as two shipped steps.
2. All five layouts in v1.
3. `.base` files in Obsidian's YAML syntax, stored in the workspace; embed via `![[X.base]]`.

Made by me, flagged for review:

4. **Single evaluator in TypeScript.** Rust returns, for the workspace, one row per note (path, properties JSON, file metadata, tags, links, backlinks); TS evaluates filters, formulas, sort and group. One evaluator, no Rust expression engine, same code usable by a future web/mobile build. Ceiling: workspaces of tens of thousands of notes; move to SQL-side filtering if it measurably lags.
5. **Property types are inferred** from the YAML value (text, number, checkbox, date, datetime, list); a `YYYY-MM-DD` string is a date. No types registry.
6. **Properties UI:** a collapsible properties block above the note body (typed inputs per field, add/remove/rename), not inside the editor document. The frontmatter stays out of the TipTap document, as today.
7. **Map view uses OpenStreetMap raster tiles** (via a map library chosen by the builder) with the lat/long read from a configured property. When offline, the map shows pins on a blank background with a notice. This is the only feature that makes network requests on its own; the Tauri CSP must allow exactly the tile host and no more.
8. **Kanban** groups by one property; dragging a card writes that property's new value (and for a list property, replaces the one value in that column).
9. **Desktop only.** Same call as the agent canvas.
10. **Non-markdown file plumbing.** The `.canvas` spec is not implemented, so Bases builds the generic "first-class non-`.md` file kind" support itself (tree listing, tab type, rename/move, trash, watcher, `![[…]]` resolution), written so `.canvas` can reuse it.
11. **Writes to an open note go through the open editor buffer** (the normal save path). Writes to a note that is not open go through a Rust command that re-reads the file, edits the frontmatter text, and refuses (view shows "note changed, retry") if the content differs from what the view's row was built from. No silent overwrite either way.
12. **Edits feel instant:** the view updates optimistically from the write, and a property write triggers an immediate `reindex_note` for that one note.
13. **Embeds are interactive.** In `![[X.base]]`, `this` is the embedding note and cell edits are allowed.
14. **CSP:** Bases adds no new origin. The existing `img-src https:` already covers raster tiles; use a raster-tile map library, not one that needs vector tiles or `connect-src`.
15. **Interop:** the kanban and map view keys follow Obsidian's own help pages (`bases/views/kanban`, map) as the builder reads them; where a key is not in Obsidian's format, it is ours and Obsidian shows that view as unsupported.
16. **Minimal `.base` editing UI (user).** The app provides: create a base, switch/add/rename/delete views, pick and reorder columns, sort, group-by, and the layout-specific settings (kanban group property, map coordinate property). **Filters and formulas are edited as raw YAML** in the `.base` file (a "Edit source" toggle on the base), validated on save with parse errors shown inline. Visual filter/formula builders are later work.
17. **Frontmatter feeds the existing indexes (user).** A frontmatter `tags` property merges into `note_tags`; `[[…]]` values in properties count as outgoing links and backlinks; property values are FTS-searchable. This reverses the current "frontmatter is ignored" behaviour and the tests asserting it (`notes.rs` frontmatter-hidden tests), and the tags-backlinks-design non-goal; update both, and reword that spec. Indexed on `reindex_note` like everything else.
18. **Create from a view (user).** Table/list/cards have a "New" button and each kanban column a "+ add card". The new note is pre-filled with properties implied by simple equality filters and the column value only.
19. **Rename property is per-note (user).** Bulk rename stays a non-goal; other notes show an empty cell under the old key.
20. **Malformed frontmatter (user).** The properties block shows the parse error and is read-only; the note still appears in bases with empty properties. Frontmatter that failed to parse is never rewritten.
21. **Map tile URL is a setting (user)**, defaulting to OpenStreetMap's public raster tiles with attribution. Offline: pins on a blank background.
22. **Undo (user, with my refinement).** No per-view undo stack; note history is the undo. Each view write shows a toast "Moved to Done · Undo" that reverses that one write.
23. **`.base` files stay out of full-text search, the graph and backlinks in v1 (user)**, like the canvas. Links *to* a `.base` resolve so embeds work.
24. **Kanban order within a column follows the view's sort only (user)**; no manual reorder, so no stored rank.
25. **New-note location (user).** Created in the `.base` file's folder with an inline rename; if the base's filters restrict to another folder (e.g. `file.inFolder("Courses")`), the note goes there.
26. **Undo toast (user).** Reverses the one write, expires after ~8 s, and refuses with "note changed since" if the note was edited after the write (same compare-and-refuse rule as decision 11).
27. **Key/value conventions (user).** Property keys are case-sensitive as written. `tags` is read as a list whether written as a YAML list or a comma string; writes always produce a YAML list in the file's existing style (flow `[a, b]` or block).

## Supported `.base` subset (v1)

Per Obsidian's [syntax](https://obsidian.md/help/bases/syntax), [formulas](https://obsidian.md/help/formulas) and [functions](https://obsidian.md/help/bases/functions) pages (the builder reads them in full): top-level `filters`, `formulas`, `properties` (display names), `views` (each with `type`, `name`, `filters`, `order`, `sort`, `groupBy`, layout-specific keys); `and`/`or`/`not` filter groups; comparison and arithmetic operators; the function library listed on those pages for strings, numbers, dates, lists, files and links; `file.*` and `note.*`/bare property access; `this`. Any key or function we don't implement is preserved on save, and a view that depends on one shows a visible "unsupported" marker rather than silently dropping rows.

## Approaches considered

| | Approach | Outcome |
|---|---|---|
| A | Properties layer + `.base` files in Obsidian's format, five layouts | **Chosen** (user). Largest, but the only one that shows and edits per-note fields and interoperates with vaults. |
| B | Saved searches rendered as a table, no properties | Rejected: cannot show status/due date, the reason for the feature. |
| C | Embedded query block in the note | Rejected: a query language in note text, already rejected in ROADMAP §4. |

## Left to the builder

- YAML library and the surgical frontmatter editor (Rust side for writes, TS mirror for reads, as `split_frontmatter` is mirrored today).
- Exact `note_properties` schema (long vs JSON column) and which `file.*` fields need new index columns (e.g. created time, size).
- Formula grammar/parser and the final function list within the documented subset.
- Layout components, the map library, kanban drag mechanics, the properties-block UI, and how `.base` registers in scan/tabs/watcher.
- Test strategy: the parser, evaluator and frontmatter editor are pure and unit-testable (round-trip tests on comments/ordering are mandatory); layouts verified with `e2e-verify`/`ui-preview`.

## Open for later

- Column summaries; Bases on mobile; a properties types registry; bulk edit.

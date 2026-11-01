# Tags and Backlinks Design

**Goal:** Add inline `#tags` and a backlinks panel for `[[wiki-links]]`, both extracted via a shared content-indexing pass into new SQLite tables, surfaced as a tag browser in the sidebar and a "linked from" panel below the editor.

**Why now:** Second of two organization features scoped alongside folder navigation. Unlike folders (purely filesystem-derived), tags and backlinks are genuinely new relational data extracted from note *content*, so they share one mechanism — a content-indexing step — that folders never needed.

**Non-goals (out of scope for this spec):** Nested/hierarchical tags, renaming a tag across all notes, resolving backlink title collisions when two notes share a title (pre-existing `WikiLink` limitation, unchanged here).

---

## 1. Data model & backend

Two new tables, populated by a shared extraction step that runs wherever `index_note_content` already runs (`save_note`, `create_note`):

```sql
CREATE TABLE note_tags (note_path TEXT NOT NULL, tag TEXT NOT NULL);
CREATE INDEX note_tags_tag ON note_tags(tag);

CREATE TABLE note_links (source_path TEXT NOT NULL, target_title TEXT NOT NULL);
CREATE INDEX note_links_target ON note_links(target_title);
```

Both tables are cleared and reinserted for a given `note_path` on every save/create, exactly like `notes_fts` already is.

### Extraction rules

- **Tags**: `#word` with no space after `#` — this disambiguates from ATX headings, which require a space (`# Heading`). Extraction strips fenced (```` ``` ````) and inline (`` ` ``) code spans *before* scanning, so `#include`/`#define` in C/C++ snippets are never mistaken for tags. Tags are case-preserved for display but matched case-insensitively for filtering (`#CS101` and `#cs101` are the same tag).
- **Backlinks**: every `[[Target Title]]` found in a note's content is recorded as a link from that note to the target title. This matches `WikiLink.tsx`'s existing resolution rule (case-insensitive title match, not path match) — if two notes share a title, the backlink is recorded against the title string, same ambiguity `WikiLink` already has today. Not something this feature introduces or resolves.

The extraction logic is pure and independently testable, living as standalone functions rather than inlined into command handlers:

```rust
fn extract_tags(content: &str) -> Vec<String>
fn extract_links(content: &str) -> Vec<String>
```

Both functions deduplicate case-insensitively before returning (a note that writes `#cs101` three times produces one row in `note_tags`, not three) — `notes_with_tag` only checks existence, so this is a cleanliness guarantee rather than a correctness requirement, but it keeps the table from accumulating redundant rows across repeated saves of an unchanged tag.

### Cross-cutting fix required

Since `note_tags`/`note_links` key on `note_path`, the folder rename/delete/move machinery already built (`rename_path_prefix`, `remove_notes_under`, `update_path` in `db/notes.rs`) must be extended to also touch these two new tables. Without this, renaming a folder would silently orphan every tag and backlink for the notes inside it — `notes`/`notes_fts` were the only path-keyed tables before this feature.

---

## 2. New commands

| Command | Signature | Behavior |
|---|---|---|
| `list_tags` | `(workspace: String) -> Result<Vec<String>, String>` | Distinct tags across all notes in the workspace, sorted alphabetically |
| `notes_with_tag` | `(workspace: String, tag: String) -> Result<Vec<NoteMetadata>, String>` | Notes carrying that tag, for sidebar filtering |
| `backlinks_for` | `(workspace: String, title: String) -> Result<Vec<NoteMetadata>, String>` | Notes whose content links to the given title, for the backlinks panel |

`save_note` and `create_note` both gain an extraction step immediately after their existing `index_note_content` call: parse the just-written content for tags and wiki-link targets, then delete-and-reinsert the corresponding rows in `note_tags`/`note_links`.

---

## 3. Frontend components

- **`Tag.tsx`** — a new TipTap node extension mirroring `WikiLink.tsx`'s structure: parses `#word` (outside code spans) into a `tag` node, renders as a styled/clickable pill, serializes back to `#word` in markdown. Clicking a tag sets the sidebar's tag filter.
- **`TagList.tsx`** — a new collapsible sidebar section (same pattern as the folder tree) listing all tags via `api.notes.listTags`. Clicking a tag filters the sidebar to `notes_with_tag` results.
- **`BacklinksPanel.tsx`** — rendered below `NoteEditor`'s content, showing notes from `backlinks_for(currentNote.title)`. Collapsible, with an explicit "No notes link here yet" empty state (rather than hiding entirely) so the feature is discoverable.

### State

A `tagFilter: string | null` field in `useWorkspaceStore`, alongside the existing `selectedFolder`. When set, the sidebar shows `notes_with_tag` results instead of the folder tree; clearing it (click the active tag again, or click a folder) restores the normal tree view. Tag-filtering and folder-browsing are two modes over the same sidebar, not two independent always-visible panels.

### Data refresh

Tags and backlinks are re-fetched after any save: `list_tags` (workspace-wide) and `backlinks_for` (current note only), following the same refresh-after-mutation pattern folder state already uses via `refreshTree`.

---

## 4. Edge cases & error handling

- **Tag vs. heading disambiguation**: `#tag` (no space) is a tag; `# Heading` (space required by ATX syntax) is not. Multiple tags on one line (`#cs101 #midterm`) each extract separately.
- **Code-block exclusion**: fenced and inline code are stripped before tag extraction only — the actual rendered/stored content is untouched.
- **Case sensitivity**: tags are case-preserved for display, case-insensitive for matching/counting.
- **Backlink title collisions**: recorded against the title string, not a specific path — same pre-existing ambiguity as `WikiLink.tsx`, not resolved by this feature.
- **Folder rename/delete cascading**: `rename_folder`/`delete_folder`/`move_note` extend their existing `rename_path_prefix`/`remove_notes_under`/`update_path` calls to also cover `note_tags` and `note_links`, rather than introducing new cascade logic.
- **Empty states**: `TagList` doesn't render at all if the workspace has zero tags anywhere. `BacklinksPanel` always renders when a note is open, showing an explicit empty message rather than hiding, so the feature stays discoverable.

## 5. Testing

- **Rust**: unit tests for `extract_tags`/`extract_links` (heading exclusion, code-fence/inline-code stripping, case handling, multiple tags per line) — pure functions, no database needed. Unit tests for the `note_tags`/`note_links` insert/list helpers and the folder-rename/delete cascade, using the existing in-memory SQLite test pattern.
- **Frontend**: no dedicated tests beyond typecheck/build — there's no new pure-logic TypeScript module in this feature (extraction lives entirely in Rust), consistent with the project's existing testing boundary.
- **Manual smoke test**: tag a note and confirm it appears in the sidebar Tags section with filtering working; add a `[[link]]` between two notes and confirm the backlink shows up in the target note's panel; rename a folder containing a tagged/linked note and confirm both survive.

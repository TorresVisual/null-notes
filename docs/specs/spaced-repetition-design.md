# Spaced repetition (P9-3)

## Problem

Coursework material gets captured but never revisited in a structured way. P9-3 adds card authoring inside ordinary notes and a review session that schedules them with SM-2, closing M9 ("the app helps me *revise*, not just capture") together with P9-1 and P9-2. It also wires up `HomeView`'s Study section, shipped as a disabled placeholder by P9-4.

## Decision fork (resolved in ROADMAP.md, not reopened here)

Schedule state is stored **inline in the note** (Option A), not in a sidecar file or `index.db`. Three reasons, all already argued in the roadmap: it survives renames/moves with no key-tracking (the app's note `id` is deliberately non-stable — `path` is the real key); it merges as plain text under P5's automatic Git sync, where a sidecar JSON blob would produce unresolvable binary-style conflicts; and it keeps the `.md` self-contained, per principle #1. `index.db` gets a `review_cards` table that is purely derived — rebuilt every reindex from the note's own text, exactly like `note_tags`/`note_tasks` — so deleting it loses no scheduling state.

## Card syntax

Two forms, both plain text, both readable as ordinary Markdown in any other editor:

- **Question::Answer** — a paragraph line of the shape `<front> :: <back>`, e.g. `What is Big-O of binary search? :: O(log n)`.
- **Cloze** — a paragraph line containing one or more `{{hidden text}}` spans, e.g. `A binary search tree keeps {{all left descendants smaller}} than the node.` All spans on one line reveal together as a single card (no per-span Anki-style `c1`/`c2` sub-cards) — one card per line, matching how every other extractor in this codebase (`extract_tasks`, `extract_formulas`) keys off a line, not a sub-span.

A card's schedule state lives on the line immediately below it, once it has been reviewed at least once:

```
What is Big-O of binary search? :: O(log n)
<!-- sr due=2026-08-21 ease=2.50 interval=1 reps=1 -->
```

A card with no such comment is **new**: implicitly due today, with defaults `ease=2.5 interval=0 reps=0`. The comment is written for the first time on the card's first review — matching `toggle_task`'s posture of only ever writing what changed, never scaffolding state that hasn't happened yet.

## Verified risk: the editor round-trip silently drops HTML comments

Tested directly against `coreExtensions` before committing to this design: mounting `"text\n<!-- sr due=2026-08-21 ease=2.5 interval=1 reps=0 -->"` in a TipTap `Editor` and reading back `storage.markdown.getMarkdown()` **drops the comment entirely**. `tiptap-markdown` renders markdown to an HTML string via markdown-it, then parses that HTML into the ProseMirror doc via `DOMParser`; ProseMirror's parser walks Element nodes for schema matching and Text nodes for content, and silently skips any other DOM node type — including `Comment` (nodeType 8). Every other node that has ever needed a schedule/marker line in this codebase (`Callout`) sidesteps this because its marker lives inside an ordinary paragraph's text, not as a raw HTML comment.

Left unfixed, this would silently reset every card's review progress the moment its note was opened and saved in null-notes' own editor — exactly the class of bug the CLAUDE.md save-path rules exist to prevent, except for study data instead of note content.

**Fix, verified working:** a new `SrState` node extension, following `Callout.tsx`'s own `parse.updateDOM` hook (which already rewrites parsed-but-not-yet-schema'd DOM before ProseMirror consumes it — the exact tool for this problem). `updateDOM` walks the parsed HTML with a `TreeWalker(NodeFilter.SHOW_COMMENT)`, and any comment matching the `sr ...` pattern is replaced with an equivalent invisible `<div data-type="sr-state" data-due=... data-ease=... data-interval=... data-reps=...>` **before** ProseMirror's `DOMParser` ever sees it. A normal `parseHTML` tag-rule then claims that div into a real `srState` node, and `markdown.serialize` writes the identical comment text back out. Confirmed round-trip-safe with a throwaway test against the real extension list (deleted after verifying).

`SrState`:
- `group: 'block'`, `atom: true`, non-editable (`contentEditable={false}` on its `NodeViewWrapper`).
- Renders as a zero-visual-footprint block (`display: none`) — present in the document so it round-trips and so `grade_card` can find "the sr-state line right after this card" by line number, invisible in the reading view per the "comment hidden" rendering decision below.

## Extraction (`extract_cards`, `commands/notes.rs`)

Line-based, mirroring `extract_tasks`/`extract_formulas` exactly — a running "inside a fence" flag skips fenced code without shifting line numbers, since `position` (the line index) is the identity `grade_card` uses to find the line back, the same role it already plays for `toggle_task`.

```rust
pub struct ExtractedCard {
    pub kind: CardKind,       // Qa | Cloze
    pub front: String,
    pub back: String,
    pub position: i64,        // line index of the card itself
    pub due: Option<String>,      // None => new card, due today
    pub ease: Option<f64>,
    pub interval: Option<i64>,
    pub reps: Option<i64>,
}
```

Per line (not in a fence):
1. Try the Q::A pattern first: `^(.+?)\s::\s(.+)$` → `front`/`back` from the two groups.
2. Otherwise, if the line contains `{{...}}`, it's a cloze card: `front` = line with each `{{x}}` replaced by `[...]`; `back` = line with the braces stripped, spans left inline.
3. If the *next* line matches `^<!--\s+sr\s+due=(\S+)\s+ease=(\S+)\s+interval=(\S+)\s+reps=(\S+)\s+-->$`, parse its four fields onto the card; otherwise leave them `None`.

## Schema and reindex integration

```sql
CREATE TABLE IF NOT EXISTS review_cards (
    note_path TEXT    NOT NULL,
    kind      TEXT    NOT NULL,   -- 'qa' | 'cloze'
    front     TEXT    NOT NULL,
    back      TEXT    NOT NULL,
    position  INTEGER NOT NULL,
    due       TEXT    NOT NULL,   -- ISO date, always populated (defaults applied on write)
    ease      REAL    NOT NULL,
    interval  INTEGER NOT NULL,
    reps      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS review_cards_due ON review_cards(due);
CREATE INDEX IF NOT EXISTS review_cards_path ON review_cards(note_path);
```

`set_cards(pool, note_path, cards)` mirrors `set_tasks` (delete-then-reinsert for that path). Wired into the exact same five call sites `note_tasks` already uses, because it's the same "derived table that follows the note" shape:

- `index_note_at` → `db::notes::set_cards(db, path, &extract_cards(content)).await?;` (alongside `set_tasks`)
- `rename_path_prefix`'s `update_path` → add `UPDATE review_cards SET note_path = ? WHERE note_path = ?`
- `remove_notes_under` → add `DELETE FROM review_cards WHERE note_path LIKE ? ESCAPE '\\'`
- `forget_note` → `db::notes::set_cards(db, path, &[]).await?;`
- `delete_note` → `db::notes::set_cards(&db, &path, &[]).await`

## SM-2 scheduling (`sm2.rs`, pure function, no I/O)

Four-button grading (Again/Hard/Good/Easy). New-card defaults (`ease=2.5, interval=0, reps=0`) always take the `reps==1` branch on first grading regardless of button pressed, so a brand-new card's due date always reflects its first real interval.

```
fn next_state(state: CardState, grade: Grade) -> CardState

Again: reps=0
       ease = max(1.3, ease - 0.20)
       interval = 1
       due = today + 1

Hard:  reps += 1
       ease = max(1.3, ease - 0.15)
       interval = max(1, round(interval * 1.2))
       due = today + interval

Good:  reps += 1
       ease unchanged
       interval = reps==1 ? 1 : reps==2 ? 6 : round(interval * ease)
       due = today + interval

Easy:  reps += 1
       ease = ease + 0.15
       interval = round((reps==1 ? 1 : reps==2 ? 6 : interval * ease) * 1.3)
       due = today + interval
```

`interval` and `due` use whole days (`due` is an ISO date, not a timestamp) — reviews are a once-or-twice-a-day activity, not something that needs sub-day scheduling, and day granularity keeps "is this due" a simple string/date comparison.

## Commands

- `list_due_cards(workspace) -> Vec<DueCard>` — `SELECT ... FROM review_cards WHERE due <= today() ORDER BY due, note_path, position`, joined with `notes` for `note_title` (same join shape as `open_tasks`).
- `grade_card(note_path, position, workspace, grade)` — reads the note fresh off disk (like `toggle_task_at`), locates line `position`, confirms it's still a card, computes `next_state` against whatever schedule is currently on the following comment line (or defaults if none), replaces or inserts that comment line, atomic-writes, reindexes. If `position` no longer holds a card (the note changed since the queue was built), returns an error rather than mangling an unrelated line — the same posture `toggle_task_line` already takes.

## Frontend

**Card highlighting** — a ProseMirror decoration plugin (`SrCardHighlight`), not a schema node: it scans each paragraph's text for the `X :: Y` and `{{...}}` patterns and applies CSS-class decorations (`sr-card-qa`, `sr-cloze`). Decorations are view-layer only and never serialize, so this cannot affect the plain-Markdown DoD — the same "decoration not node" shape `CodeLink`/`CrossRef` already use for a comparable problem (recognise-in-place, no schema change).

**`ReviewSession.tsx`** — full-screen modal, same shape as `TaskView.tsx` (`.search-overlay` wrapper, header with close button). `list_due_cards` is fetched once on mount into local state; each grade button calls `grade_card` and advances the local index optimistically (no refetch), mirroring `TaskView.toggle`'s "drop it from local state on success" pattern. Card view: front text, a **Reveal answer** button; after reveal, back text plus the four grade buttons. Empty queue (at open, or after grading the last card): "All done for today."

**Entry points**:
- `Ctrl Shift R`, View menu — new `MenuItem` in `build_menu` (`src-tauri/src/lib.rs`), new `review` case in `Layout.tsx`'s `runCommand`, new `ShortcutsOverlay` row. No collision with the existing shortcut table.
- `HomeView`'s Study section goes live: fetch `list_due_cards(workspace)` on mount (same `useEffect` shape as its Tasks section), show `"N due"` and a **Start review** button opening `ReviewSession`, replacing the disabled placeholder text.

## Testing

- Rust: `extract_cards` (Q::A, cloze, fenced-code skip, multiple cards per note, missing/present schedule comment), `sm2::next_state` (all four grades from a new card and from an established one, ease floor at 1.3, interval monotonic under repeated Good), `set_cards`/rename/remove/forget call sites (mirroring the existing `note_tasks` test shapes), `grade_card` (inserts a comment for a new card, replaces an existing one, errors on a stale position).
- Frontend (Vitest): `SrCardHighlight` decorates the right ranges without altering `getMarkdown()` output; `SrState` round-trips the comment through mount → `getMarkdown()` (the verified case from the design spike, now a permanent regression test); `ReviewSession` grading flow with a mocked API; `HomeView`'s Study section renders count/button from mocked `list_due_cards`.
- E2E (per `.claude/skills/e2e-verify/`): author a Q::A and a cloze card in a note, open the review session, grade one of each, reopen the note and confirm the `<!-- sr ... -->` line is present with the expected fields, reload the workspace (forcing a reindex) and confirm the card no longer appears as due today.

## Out of scope

- **Theorem/Proof-block auto-cards.** The roadmap notes these could become cards "for free" — deferred: pairing a Theorem block with a following Proof block into synthetic question/answer text is real matching logic with no line in this task's DoD, and a user can already hand-author a Q::A card from a theorem in seconds once cards exist.
- **Per-cloze sub-cards** (Anki's `c1`/`c2` model). One line is one card, full stop.
- **Frontmatter.** Not needed — Option A's per-note inline state was the whole point of avoiding it (per ROADMAP.md §5).
- **Custom scheduling parameters** (per-deck ease presets, configurable intervals). SM-2 is the default; FSRS (default parameters, no optimizer) is an opt-in per-workspace scheduler in `.scheduler.json` (#137). FSRS state rides the same comment line as `stability=` / `difficulty=`; last review is `due − interval`, so no review log exists. A parameter optimizer would need one — decide where it lives (ROADMAP §1) first.

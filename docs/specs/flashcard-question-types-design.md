# Flashcard question types + slash commands + deck view

## Problem

P9-3 shipped Q::A and cloze cards with SM-2 scheduling and a review session (`docs/specs/spaced-repetition-design.md`). Missing: a way to author multiple-choice questions, a slash command to insert any card type without hand-typing the syntax, and a way to browse/manage the whole card collection rather than only the due queue. This spec covers all three as one round of work since the slash command and deck view both depend on the MC kind existing.

"Open question" was considered and dropped — it's mechanically identical to Q::A (free-response, self-graded), so it needs no new syntax or kind, just a slash-command label.

## Card syntax: multiple choice

```
What is the time complexity of binary search? ::
- [ ] O(n)
- [x] O(log n)
- [ ] O(n²)
```

A question line ending in a bare `::` (nothing after it) immediately followed by one or more `- [ ]`/`- [x]` lines is an MC block. Any number of `[x]` lines is allowed — multi-select is real, not a single radio pick, so grading is "picked set equals correct set," not "picked one of several."

**Collision with tasks.** `- [ ]`/`- [x]` is also `extract_tasks`'s own pattern (`commands/notes.rs`). Without a fix, MC options would leak into the Tasks view as fake to-dos. Fix: a shared `mc_option_line_positions(content: &str) -> HashSet<usize>` (new function, `commands/notes.rs`, used by both `extract_cards` and `extract_tasks`) walks the file once and returns every line index that's a checkbox line immediately under (or contiguous with) a bare-`::` question line. `extract_tasks` skips any line in that set; `extract_cards` is the only consumer that treats them as content.

## Scheduling: auto-grade by category

The existing four SM-2 grades (`Again`/`Hard`/`Good`/`Easy`, `sm2::Grade`) double as a four-rung ladder. MC grading moves one rung per attempt instead of asking the reviewer to self-assess:

- Correct submission (picked set == correct set) → one rung up from the card's last grade, capped at `Easy`.
- Incorrect → one rung down, floored at `Again`.
- No prior grade (new card) → baseline `Hard`, so a first correct pick lands on `Good` and a first miss lands on `Again` — matching what a manual first grade would produce today.

The computed grade is fed into the **existing** `sm2::next_state`/`grade_card_line` pipeline unchanged — no new scheduling math, no new persisted streak counter. What's new is only where the `Grade` value comes from for an MC card.

To know "last grade" on the next attempt, the sr comment gains a fifth field:

```
<!-- sr due=2026-08-21 ease=2.50 interval=1 reps=1 grade=good -->
```

Written by **every** grading path now (manual Q::A/Cloze grading included), so the comment format stays uniform rather than having two shapes. `parse_sr_comment`'s regex gains the `grade=(\S+)` capture; absent (an old-format comment, or a brand-new card) parses as `None`, which is exactly the "no prior grade" case both the MC ladder and the existing new-card defaults already treat specially.

```rust
// sm2.rs — pure, no I/O, mirrors next_state's shape
pub fn mc_auto_grade(last_grade: Option<Grade>, correct: bool) -> Grade {
    let rung = last_grade.map_or(1, |g| g as i32); // Hard=1 baseline
    let next = if correct { rung + 1 } else { rung - 1 };
    Grade::from_rung(next.clamp(0, 3))
}
```

## Data model

`ExtractedCard`/`DueCard`/`review_cards` gain two fields, used only by `Mc` cards:

- `options: Vec<String>` — the option text, in source order.
- `correct: Vec<usize>` — 0-based indices of the `[x]` lines. **Never sent to the frontend for a due card** — `DueCard` only carries `options`, so the answer isn't sitting in the initial fetch payload. Correctness is resolved server-side, against a fresh read of the note, at grading time — the same "read the file fresh, don't trust the cached queue" posture `grade_card_at` already has for position drift.

`review_cards` schema (first column addition this table has ever had — no `ALTER TABLE` exists yet in `schema.rs`):

```sql
ALTER TABLE review_cards ADD COLUMN options TEXT;      -- JSON array, NULL for qa/cloze
ALTER TABLE review_cards ADD COLUMN grade   TEXT;      -- last grade given, NULL if never graded
```

(`correct` indices are not stored in the DB at all — they're re-derived from the note's own `[x]` markers every time, same as `front`/`back` already are re-derived from source on every reindex. Storing them would be a second copy of what the file already says.)

SQLite has no `ADD COLUMN IF NOT EXISTS`; `run_migrations` runs both `ALTER TABLE`s and discards a "duplicate column name" error specifically (any other error still propagates), the standard sqlx workaround, so re-running migrations against an already-migrated `index.db` stays a no-op. `options` serializes via `serde_json` (already a dependency).

`kind` gains a third value, `"mc"`, alongside the existing `"qa"`/`"cloze"` strings.

## Commands

- `grade_mc_card(path: String, position: i64, picked: Vec<usize>, workspace: String)` — new command. Reads the note fresh, re-parses the MC block at `position` (reusing `classify_card_line`'s MC path), compares `picked` against the freshly-read correct set, resolves `mc_auto_grade`, then calls the same `grade_card_at` machinery `grade_card` already uses (refactored to accept an already-resolved `Grade` — it already does internally). Returns `{ correct: Vec<usize> }` so the frontend can show what was actually right without having asked for it up front.
- `grade_card` (existing) unchanged for `qa`/`cloze`.
- `list_all_cards(workspace: String) -> Vec<CardSummary>` — new, for the deck view. All cards regardless of due date, joined with `notes` (workspace-scoped) and `note_tags` (`GROUP_CONCAT` into `tags: Vec<String>`, same aggregation shape `list_tags` already does per-note elsewhere). `CardSummary` mirrors `DueCard` plus `due: String`, `interval: i64`, `tags: Vec<String>`.

## Frontend

**`ReviewSession.tsx`** — for `current.kind === 'mc'`, options render as checkboxes (never radio — the reviewer can't know in advance whether one or several are correct, so presenting radios would leak that). A **Submit** button (disabled with nothing picked) replaces **Reveal answer**. On submit: call `gradeMcCard`, disable the checkboxes, highlight each option (picked-correct = green, picked-wrong = red, missed-correct = amber outline) using the returned `correct` set, and show **Next** in place of the four grade buttons. Next re-fetches the queue exactly like today's `grade()`.

**`FlashcardTypeDialog.tsx`** (new, same shell as `TemplateDialog`) — opened by a new `/flashcard` slash command. Three choices (Q&A, Cloze, Multiple choice); each inserts its stub text at the cursor:
- Q&A → `Question :: Answer`
- Cloze → `Text with {{hidden}} span.`
- Multiple choice → `Question ::\n- [ ] Option\n- [x] Correct option\n- [ ] Option`

**`DeckView.tsx`** (new, same shell as `TaskView`/`ReviewSession`) — `list_all_cards` on mount, grouped by note (reuse `groupByNote`'s shape). A stats strip: total cards, due today (client-computed against today's date, same as the existing due comparison), mastered (`interval >= 21`, the conventional SRS "graduated" threshold — no new concept, just a display bucket). A tag filter (checkbox list from the already-available tag set, same source `refreshTags`/`listTags` already populates) narrows the grouped list client-side, matching `TaskView`'s existing all-client-side filtering posture — no new filter params on `list_all_cards` itself.

**Entry points**: `Ctrl+Shift+D` + View menu → `openOverlay('deck')`, new `OverlayKind` member; a "Browse all cards" link added next to `HomeView`'s existing "Start review" button.

## Testing

- Rust: `mc_option_line_positions` (options excluded from `extract_tasks`, included in `extract_cards`), `classify_card_line`'s MC branch (single `[x]`, multiple `[x]`, zero `[x]` → not a card, blank line breaking the block), `mc_auto_grade` (all four starting rungs × correct/incorrect, clamping at both ends), `grade_mc_card` (correct-set match with reordered picks, partial-credit-is-still-wrong for multi-select, stale-note cleanup reusing the same `forget_note` path P9-3's bug fix added), `list_all_cards` (tag join, mastered/due bucketing).
- Frontend (Vitest): `ReviewSession` MC flow (checkbox selection, submit disabled until a pick, highlight classes after submit, Next advances); `FlashcardTypeDialog` inserts the right stub per choice; `DeckView` renders grouped cards and tag filtering narrows the list.
- E2E: author an MC card, review it, get it right then wrong on a later day (mocked date) and confirm the grade field moves up then down; open the deck view and confirm the card appears with its tag.

## Out of scope

- **Per-option weighting or partial credit.** A multi-select answer is binary correct/incorrect (exact set match); no partial score for getting 2 of 3 right.
- **Editing cards from the deck view.** Browsing and reviewing only — editing is "open the note," same as today's backlinks/outline panels route back to source rather than editing in place.
- **Server-side tag/note filtering on `list_all_cards`.** Client-side only, matching every other list-and-filter view in this app.

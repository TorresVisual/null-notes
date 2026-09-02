# Cram mode

## Problem

P9-3/spaced-repetition-design.md and flashcard-question-types-design.md give every card a due date, and `ReviewSession` only ever shows cards where `due <= today`. That's correct for the spaced-repetition goal but leaves no way to deliberately drill a set of cards you choose — a brand-new card is due once, and after its first grade it won't come up again until its computed interval passes, even same-day. There's no "practice these again right now" path.

This adds **cram mode**: pick a category of cards (grouped by how many times in a row they've been answered correctly) and review all of them, shuffled, regardless of due date.

## Category: a new `streak` counter

Distinct from `reps` (which already exists and only tracks "reviewed since last miss," incrementing on every non-`Again` grade including `Hard`). `streak` tracks *clean* correct answers only:

- `Good` or `Easy` → `streak + 1`
- `Again` → `streak = 0`
- `Hard` → unchanged (you got it, but not cleanly — no promotion, no reset)

This is a pure function of `(current streak, resolved grade)`, so it applies identically to MC cards (whose `Grade` is already resolved server-side by `mc_auto_grade` before scheduling) and to self-graded Q&A/cloze cards — no new "was this correct" signal needed beyond the `Grade` that `next_state` already consumes.

```rust
// sm2.rs — pure, no I/O, sits next to next_state
pub fn next_streak(streak: i64, grade: Grade) -> i64 {
    match grade {
        Grade::Again => 0,
        Grade::Hard => streak,
        Grade::Good | Grade::Easy => streak + 1,
    }
}
```

Called from the same place `next_state` is (`grade_card_line`), threaded through exactly like `ease`/`interval`/`reps` today.

## Storage

`streak` is written as a sixth field on the existing sr comment, and gains its own DB column — same additive pattern the `grade` field used when it was added:

```
<!-- sr due=2026-08-21 ease=2.50 interval=1 reps=1 grade=good streak=2 -->
```

```sql
ALTER TABLE review_cards ADD COLUMN streak INTEGER;  -- NULL for a never-graded card
```

`parse_sr_comment`'s regex gains a trailing `(?:\s+streak=(\S+))?` capture. A card with no sr comment (never graded) or an old-format comment (graded before this field existed) parses `streak` as absent, which `set_cards` defaults to `0` — same posture the `ease`/`interval`/`reps`/`grade` defaults already take for a new or pre-existing card.

`ExtractedCard`, `DueCard`, and `CardSummary` each gain `streak: i64` (or `Option<i64>` on `ExtractedCard`, matching its other schedule fields, resolved to a real `i64` by the time it reaches the DB row).

## Backend

- `CardSummary` (returned by the existing `list_all_cards`) gains `streak`, so `DeckView`'s category breakdown needs no new fetch — it's already loading every card.
- New: `list_cards_by_category(pool, workspace, streak) -> Vec<DueCard>` — same query shape as `due_cards`, filtered on `rc.streak = ?` instead of `rc.due <= ?`. No `ORDER BY due` (the frontend shuffles), otherwise identical join against `notes` for `note_title`.
- New command: `list_cram_cards(workspace: String, streak: i64) -> Result<Vec<DueCard>, String>`, thin wrapper matching `list_due_cards`'s shape.
- `grade_card`/`grade_mc_card` are unchanged — cram grading is the exact same commands, same `grade_card_line`, now also updating `streak`. There is no separate "cram grade" endpoint.

## Frontend

**`DeckView.tsx`** gains a categories row above the existing per-note list, computed client-side from the already-fetched `cards` (respecting the existing tag filter, same as the stats strip already does): group by `streak`, show one chip per non-empty value —

```
New (12)   Category 1 (8)   Category 2 (3)   Category 3 (1)
```

(`streak === 0` labeled "New" to match the existing "new card" language elsewhere; `streak === N > 0` labeled "Category N".) Each chip has a **Cram** button that calls `onOpenCram(streak)` (new `DeckViewProps` callback, wired in `Layout.tsx` to `openOverlay('review')` with a cram payload — see below).

**`ReviewSession.tsx`** gains a `mode` prop:

```ts
type ReviewMode = { kind: 'due' } | { kind: 'cram'; streak: number }
```

- `kind: 'due'` (default) — today's behavior, unchanged: `listDueCards` on mount and after every grade.
- `kind: 'cram'` — initial fetch and every post-grade refetch call the new `listCramCards(workspace, streak)` instead; the returned array is shuffled client-side (`Array.prototype.sort` with `Math.random` comparator — good enough for study-order randomization, no seeding/fairness requirement) before picking `current` as its first element. A card graded out of the chosen category (streak changed) simply won't be in the next fetch, the same mechanism that already drops a card from the due queue once it's no longer due. Header reads "Cram — Category N" instead of "Review (N due)"; empty state reads "No cards in this category." instead of "All done for today."

**Layout wiring**: `openOverlay` payload needs to carry the chosen mode through to `ReviewSession` — reuse the existing pattern `pendingFlashcardInsert` already establishes for the `flashcard` overlay (a small piece of state in `Layout.tsx`, set right before `openOverlay('review')`, read by the `activeOverlay === 'review'` branch, cleared on close).

## Testing

- Rust: `next_streak` (all four grades from streak 0 and from an established streak, confirms `Hard` is a no-op), `parse_sr_comment`/`grade_card_line` round-trip streak through the comment (new card defaults to 0, existing streak increments/resets/holds per grade, old-format comment with no `streak=` field parsed and defaulted), `list_cards_by_category` (filters correctly, excludes cards outside the requested streak, no due-date filtering).
- Frontend (Vitest): `DeckView` category chips render correct counts per streak value and respect the active tag filter; `ReviewSession` in cram mode fetches from `listCramCards` not `listDueCards`, shuffles (assert the fetched set is unchanged, order not asserted), and shows the cram-specific header/empty copy.
- E2E: grade a new card Good twice in a row (streak reaches 2), confirm it appears under "Category 2" in Browse All Cards even though its `due` date is in the future; cram Category 2, grade it Again, confirm it drops out of Category 2 and back into "New."

## Out of scope

- **Cram sessions that don't touch scheduling.** Explicitly decided: cramming uses the same `grade_card`/`grade_mc_card` calls as a normal review, so due dates, `ease`, `interval`, `reps`, and `streak` all update normally during a cram session.
- **Per-card cram** (picking individual cards to drill outside their category). Category-level only, per the requested flow: clear a category by cramming all of it.
- **A cap/"mastered" ceiling on streak.** Unlike `interval` (which has the existing `MASTERED_INTERVAL_DAYS` display bucket), `streak` has no max — categories go as high as a card's correct-answer history takes it.

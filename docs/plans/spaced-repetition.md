# Spaced Repetition (P9-3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (default) or superpowers:subagent-driven-development if explicitly requested.

**Goal:** Let a student author review cards (Q::A and cloze) inside ordinary notes, schedule them with SM-2, and review due cards from a session launched off Home or a shortcut — closing M9 alongside P9-1/P9-2.

**Architecture:** Schedule state (`due`/`ease`/`interval`/`reps`) lives inline in the note as an `<!-- sr ... -->` comment written immediately below its card, written only on first review — never scaffolded ahead of time. `index.db` gets a purely derived `review_cards` table, rebuilt every `reindex_note` exactly like `note_tags`/`note_tasks`, so deleting it loses no scheduling state. A verified round-trip risk (raw HTML comments are silently dropped by the WYSIWYG editor's markdown parse/serialize pipeline) is fixed by an `SrState` node that rewrites the parsed DOM before ProseMirror consumes it, the same trick `Callout.tsx` already uses for its own marker line.

**Tech Stack:** Rust (Tauri commands, sqlx/SQLite, `chrono` — new dependency, for date arithmetic), TypeScript/React, TipTap 3 (ProseMirror), Vitest.

**Spec:** `docs/specs/spaced-repetition-design.md`

## Global Constraints

- Never `.unwrap()`/`.expect()` outside tests (CLAUDE.md). Every `Regex::new` follows the existing `extract_tasks`/`extract_formulas` fallible pattern: `match Regex::new(...) { Ok(re) => re, Err(_) => return Vec::new() }`.
- Card identity is **line position**, exactly like `note_tasks`/`toggle_task` — no synthetic per-card ID.
- `review_cards` is purely derived (rebuildable from note text via `reindex_note`); it is never the only copy of schedule state.
- Card markers must remain plain, readable Markdown in any other editor — no new fenced/block syntax, no node that changes how a card's own text serializes.
- `SrState` decorations and `SrCardHighlight` must not alter `getMarkdown()` output for any note that doesn't contain an actual `<!-- sr ... -->` comment or card pattern.
- New Tauri commands (`list_due_cards`, `grade_card`) must be registered in `src-tauri/src/lib.rs`'s `invoke_handler!` list or they are unreachable from the frontend at runtime with no compile-time error.

---

## Task 1: SM-2 scheduling core

**Files:**
- Create: `src-tauri/src/sm2.rs`
- Modify: `src-tauri/src/lib.rs:1-5` (add `pub mod sm2;`)
- Modify: `src-tauri/Cargo.toml` (add `chrono` dependency)
- Test: inline `#[cfg(test)] mod tests` in `src-tauri/src/sm2.rs`

**Interfaces:**
- Produces: `pub struct CardState { pub ease: f64, pub interval: i64, pub reps: i64 }` (implements `Default`: `ease: 2.5, interval: 0, reps: 0`), `pub enum Grade { Again, Hard, Good, Easy }` (`#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)] #[serde(rename_all = "lowercase")]`), `pub struct Scheduled { pub ease: f64, pub interval: i64, pub reps: i64, pub due: chrono::NaiveDate }`, `pub fn next_state(state: CardState, grade: Grade, today: chrono::NaiveDate) -> Scheduled`, `pub fn today() -> String` (today's date as `YYYY-MM-DD`).

- [ ] **Step 1: Add the `chrono` dependency**

Edit `src-tauri/Cargo.toml`, in the `[dependencies]` block, add a line after `regex = "1"`:

```toml
chrono = { version = "0.4", default-features = false, features = ["clock"] }
```

- [ ] **Step 2: Write the failing tests**

Create `src-tauri/src/sm2.rs`:

```rust
use chrono::{Duration, NaiveDate};
use serde::{Deserialize, Serialize};

/// A card's SM-2 scheduling state, parsed from (or about to be written to)
/// its `<!-- sr due=... ease=... interval=... reps=... -->` comment line. A
/// card with no comment yet is `Default` — new, due immediately.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CardState {
    pub ease: f64,
    pub interval: i64,
    pub reps: i64,
}

impl Default for CardState {
    fn default() -> Self {
        CardState {
            ease: 2.5,
            interval: 0,
            reps: 0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Grade {
    Again,
    Hard,
    Good,
    Easy,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Scheduled {
    pub ease: f64,
    pub interval: i64,
    pub reps: i64,
    pub due: NaiveDate,
}

const MIN_EASE: f64 = 1.3;

/// SM-2 with four-button grading. A brand-new card (`CardState::default()`,
/// `reps: 0`) always lands in each branch's `reps == 1` case on its first
/// grading, regardless of which button was pressed — there is no history yet
/// to weight differently.
pub fn next_state(state: CardState, grade: Grade, today: NaiveDate) -> Scheduled {
    match grade {
        Grade::Again => Scheduled {
            ease: (state.ease - 0.20).max(MIN_EASE),
            interval: 1,
            reps: 0,
            due: today + Duration::days(1),
        },
        Grade::Hard => {
            let interval = ((state.interval as f64) * 1.2).round().max(1.0) as i64;
            Scheduled {
                ease: (state.ease - 0.15).max(MIN_EASE),
                interval,
                reps: state.reps + 1,
                due: today + Duration::days(interval),
            }
        }
        Grade::Good => {
            let reps = state.reps + 1;
            let interval = if reps == 1 {
                1
            } else if reps == 2 {
                6
            } else {
                ((state.interval as f64) * state.ease).round() as i64
            };
            Scheduled {
                ease: state.ease,
                interval,
                reps,
                due: today + Duration::days(interval),
            }
        }
        Grade::Easy => {
            let reps = state.reps + 1;
            let base = if reps == 1 {
                1.0
            } else if reps == 2 {
                6.0
            } else {
                (state.interval as f64) * state.ease
            };
            let interval = (base * 1.3).round().max(1.0) as i64;
            Scheduled {
                ease: state.ease + 0.15,
                interval,
                reps,
                due: today + Duration::days(interval),
            }
        }
    }
}

/// Today's date as an ISO `YYYY-MM-DD` string — day granularity throughout,
/// since reviews are a once-or-twice-a-day activity, not something needing
/// sub-day scheduling.
pub fn today() -> String {
    chrono::Utc::now().date_naive().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn date(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn test_again_resets_reps_and_shortens_interval() {
        let state = CardState {
            ease: 2.5,
            interval: 10,
            reps: 3,
        };
        let out = next_state(state, Grade::Again, date("2026-08-20"));
        assert_eq!(out.reps, 0);
        assert_eq!(out.interval, 1);
        assert_eq!(out.due, date("2026-08-21"));
        assert!((out.ease - 2.30).abs() < 1e-9);
    }

    #[test]
    fn test_again_never_drops_ease_below_floor() {
        let state = CardState {
            ease: 1.35,
            interval: 1,
            reps: 0,
        };
        let out = next_state(state, Grade::Again, date("2026-08-20"));
        assert!((out.ease - MIN_EASE).abs() < 1e-9);
    }

    #[test]
    fn test_good_on_a_new_card_sets_one_day_interval() {
        let out = next_state(CardState::default(), Grade::Good, date("2026-08-20"));
        assert_eq!(out.reps, 1);
        assert_eq!(out.interval, 1);
        assert_eq!(out.due, date("2026-08-21"));
        assert!((out.ease - 2.5).abs() < 1e-9);
    }

    #[test]
    fn test_good_on_second_review_sets_six_day_interval() {
        let state = CardState {
            ease: 2.5,
            interval: 1,
            reps: 1,
        };
        let out = next_state(state, Grade::Good, date("2026-08-20"));
        assert_eq!(out.reps, 2);
        assert_eq!(out.interval, 6);
    }

    #[test]
    fn test_good_on_third_review_multiplies_by_ease() {
        let state = CardState {
            ease: 2.5,
            interval: 6,
            reps: 2,
        };
        let out = next_state(state, Grade::Good, date("2026-08-20"));
        assert_eq!(out.reps, 3);
        assert_eq!(out.interval, 15); // round(6 * 2.5)
    }

    #[test]
    fn test_hard_shrinks_ease_and_grows_slowly() {
        let state = CardState {
            ease: 2.5,
            interval: 6,
            reps: 2,
        };
        let out = next_state(state, Grade::Hard, date("2026-08-20"));
        assert_eq!(out.interval, 7); // round(6 * 1.2)
        assert!((out.ease - 2.35).abs() < 1e-9);
    }

    #[test]
    fn test_hard_on_a_new_card_still_yields_at_least_one_day() {
        let out = next_state(CardState::default(), Grade::Hard, date("2026-08-20"));
        assert_eq!(out.interval, 1);
    }

    #[test]
    fn test_easy_grows_ease_and_applies_bonus() {
        let state = CardState {
            ease: 2.5,
            interval: 6,
            reps: 2,
        };
        let out = next_state(state, Grade::Easy, date("2026-08-20"));
        assert_eq!(out.interval, 20); // round(6 * 2.5 * 1.3)
        assert!((out.ease - 2.65).abs() < 1e-9);
    }

    #[test]
    fn test_easy_on_a_new_card_uses_one_day_base() {
        let out = next_state(CardState::default(), Grade::Easy, date("2026-08-20"));
        assert_eq!(out.reps, 1);
        assert_eq!(out.interval, 1); // round(1 * 1.3) = 1
    }

    #[test]
    fn test_today_returns_iso_date_format() {
        let t = today();
        assert_eq!(t.len(), 10);
        assert_eq!(t.chars().nth(4), Some('-'));
        assert_eq!(t.chars().nth(7), Some('-'));
    }
}
```

- [ ] **Step 3: Register the module**

Edit `src-tauri/src/lib.rs`, change:

```rust
pub mod commands;
pub mod db;
pub mod exercises;
pub mod models;
pub mod pdf;
```

to:

```rust
pub mod commands;
pub mod db;
pub mod exercises;
pub mod models;
pub mod pdf;
pub mod sm2;
```

- [ ] **Step 4: Run the tests**

Run: `cd src-tauri && cargo test sm2:: -- --nocapture`
Expected: all 10 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/sm2.rs src-tauri/src/lib.rs
git commit -m "feat(p9-3): add SM-2 scheduling core"
```

---

## Task 2: Card extraction

**Files:**
- Modify: `src-tauri/src/models.rs` (add `CardKind`, `ExtractedCard`)
- Modify: `src-tauri/src/commands/notes.rs` (add `classify_card_line`, `parse_sr_comment`, `extract_cards`)
- Test: `#[cfg(test)] mod tests` in `src-tauri/src/commands/notes.rs` (existing module)

**Interfaces:**
- Consumes: nothing new (pure string processing).
- Produces: `pub enum CardKind { Qa, Cloze }` (`#[derive(Debug, Clone, Copy, PartialEq, Eq)]`), `pub struct ExtractedCard { pub kind: CardKind, pub front: String, pub back: String, pub position: i64, pub due: Option<String>, pub ease: Option<f64>, pub interval: Option<i64>, pub reps: Option<i64> }` (`#[derive(Debug, Clone, PartialEq)]`), `pub fn extract_cards(content: &str) -> Vec<ExtractedCard>`. Later tasks call `extract_cards` from `index_note_at`/`forget_note`/`delete_note`, and reuse the private `classify_card_line`/`parse_sr_comment` helpers from `grade_card_line` (Task 5).

- [ ] **Step 1: Add the models**

Edit `src-tauri/src/models.rs`, after the `ExtractedTask`/`OpenTask` block (after line 177 in the current file), add:

```rust
/// Which of the two card-authoring forms a line matched (P9-3): a
/// `front :: back` line, or a line containing one or more `{{cloze}}` spans.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CardKind {
    Qa,
    Cloze,
}

/// A review card extracted from a note's raw markdown (P9-3), mirroring how
/// `extract_tasks` feeds `note_tasks`: `position` is the 0-indexed line
/// number of the card itself, the same identity `grade_card` uses to find
/// its schedule-comment line back. `due`/`ease`/`interval`/`reps` come from
/// the `<!-- sr ... -->` comment on the line immediately below, if present —
/// `None` across all four means the card has never been reviewed and is
/// implicitly due today with SM-2 defaults.
#[derive(Debug, Clone, PartialEq)]
pub struct ExtractedCard {
    pub kind: CardKind,
    pub front: String,
    pub back: String,
    pub position: i64,
    pub due: Option<String>,
    pub ease: Option<f64>,
    pub interval: Option<i64>,
    pub reps: Option<i64>,
}
```

- [ ] **Step 2: Write the failing tests**

Add to the `mod tests` block at the bottom of `src-tauri/src/commands/notes.rs` (near `test_extract_tasks_*`, around line 1315):

```rust
    #[test]
    fn test_extract_cards_finds_a_qa_card() {
        let cards = extract_cards("# Notes\n\nWhat is Big-O of binary search? :: O(log n)\n");
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].kind, CardKind::Qa);
        assert_eq!(cards[0].front, "What is Big-O of binary search?");
        assert_eq!(cards[0].back, "O(log n)");
        assert_eq!(cards[0].position, 2);
        assert_eq!(cards[0].due, None);
    }

    #[test]
    fn test_extract_cards_finds_a_cloze_card() {
        let cards =
            extract_cards("A binary search tree keeps {{all left descendants smaller}} than the node.\n");
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].kind, CardKind::Cloze);
        assert_eq!(
            cards[0].front,
            "A binary search tree keeps [...] than the node."
        );
        assert_eq!(
            cards[0].back,
            "A binary search tree keeps all left descendants smaller than the node."
        );
    }

    #[test]
    fn test_extract_cards_reads_an_adjacent_schedule_comment() {
        let content =
            "Q :: A\n<!-- sr due=2026-08-21 ease=2.30 interval=6 reps=2 -->\n";
        let cards = extract_cards(content);
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].due, Some("2026-08-21".to_string()));
        assert_eq!(cards[0].ease, Some(2.30));
        assert_eq!(cards[0].interval, Some(6));
        assert_eq!(cards[0].reps, Some(2));
    }

    #[test]
    fn test_extract_cards_new_card_has_no_schedule() {
        let cards = extract_cards("Q :: A\nSome unrelated next line.\n");
        assert_eq!(cards[0].due, None);
        assert_eq!(cards[0].ease, None);
    }

    #[test]
    fn test_extract_cards_ignores_fenced_code() {
        let content = "```\nWhat :: is this\n```\n";
        assert!(extract_cards(content).is_empty());
    }

    #[test]
    fn test_extract_cards_ignores_the_schedule_comment_line_itself() {
        // A schedule comment can never be mistaken for a new card even
        // though it starts a fresh line right after one.
        let content = "Q :: A\n<!-- sr due=2026-08-21 ease=2.50 interval=1 reps=1 -->\n";
        let cards = extract_cards(content);
        assert_eq!(cards.len(), 1);
    }

    #[test]
    fn test_extract_cards_handles_multiple_cards_in_one_note() {
        let content = "Q1 :: A1\nQ2 :: A2\n";
        let cards = extract_cards(content);
        assert_eq!(cards.len(), 2);
        assert_eq!(cards[0].position, 0);
        assert_eq!(cards[1].position, 1);
    }

    #[test]
    fn test_extract_cards_empty_content() {
        assert!(extract_cards("").is_empty());
    }
```

Add `CardKind` to the test module's imports — find the existing `use super::*;` inside `mod tests` (it already brings `CardKind`/`ExtractedCard` into scope via `super::*` since they're used in `notes.rs` after Step 3 re-exports them from `models`; no separate import needed beyond what Step 3 adds to the top-of-file `use` block).

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd src-tauri && cargo test test_extract_cards -- --nocapture`
Expected: FAIL with "cannot find function `extract_cards`".

- [ ] **Step 4: Implement**

Edit `src-tauri/src/commands/notes.rs`. Change the `use crate::models::{...}` block (line 2-5) to add the two new types:

```rust
use crate::models::{
    CardKind, ExtractedCard, ExtractedFormula, ExtractedTask, GraphLink, GraphTag, NoteMetadata,
    OpenTask, SearchResult, WorkspaceTree,
};
```

Add the extraction functions after `extract_formulas` (after line 221, before `list_notes`):

```rust
// A schedule comment is never itself a card, even though it starts a fresh
// line right after one — checked first so the loop below never has to
// special-case it.
fn parse_sr_comment(line: &str) -> Option<(String, f64, i64, i64)> {
    let re = match Regex::new(
        r"^<!--\s+sr\s+due=(\S+)\s+ease=(\S+)\s+interval=(\S+)\s+reps=(\S+)\s+-->$",
    ) {
        Ok(re) => re,
        Err(_) => return None,
    };
    let caps = re.captures(line.trim())?;
    let due = caps[1].to_string();
    let ease = caps[2].parse::<f64>().ok()?;
    let interval = caps[3].parse::<i64>().ok()?;
    let reps = caps[4].parse::<i64>().ok()?;
    Some((due, ease, interval, reps))
}

// Q::A checked first; a line matching both forms (rare — a "::" pair inside
// a {{cloze}} span) reads as Q::A, which is the more explicit authoring
// intent. One card per line, matching every other extractor in this file:
// all {{}} spans on a cloze line reveal together as a single card, not
// Anki-style per-span sub-cards.
fn classify_card_line(trimmed: &str) -> Option<(CardKind, String, String)> {
    if trimmed.is_empty() || trimmed.starts_with("<!--") {
        return None;
    }
    let qa_re = Regex::new(r"^(.+?)\s::\s(.+)$").ok()?;
    if let Some(caps) = qa_re.captures(trimmed) {
        return Some((
            CardKind::Qa,
            caps[1].trim().to_string(),
            caps[2].trim().to_string(),
        ));
    }
    let cloze_re = Regex::new(r"\{\{([^{}]+)\}\}").ok()?;
    if cloze_re.is_match(trimmed) {
        let front = cloze_re.replace_all(trimmed, "[...]").to_string();
        let back = cloze_re.replace_all(trimmed, "$1").to_string();
        return Some((CardKind::Cloze, front, back));
    }
    None
}

// Line-based like `extract_tasks`/`extract_formulas`, for the same reason:
// `position` (the line index) is the identity `grade_card` uses to find a
// card's schedule-comment line back, so fenced code must be skipped without
// ever renumbering a line.
pub fn extract_cards(content: &str) -> Vec<ExtractedCard> {
    let lines: Vec<&str> = content.lines().collect();
    let mut in_fence = false;
    let mut cards = Vec::new();

    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        if trimmed.starts_with("```") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }

        let (kind, front, back) = match classify_card_line(trimmed) {
            Some(c) => c,
            None => continue,
        };

        let (due, ease, interval, reps) = match lines.get(i + 1).and_then(|l| parse_sr_comment(l)) {
            Some((due, ease, interval, reps)) => (Some(due), Some(ease), Some(interval), Some(reps)),
            None => (None, None, None, None),
        };

        cards.push(ExtractedCard {
            kind,
            front,
            back,
            position: i as i64,
            due,
            ease,
            interval,
            reps,
        });
    }

    cards
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test test_extract_cards -- --nocapture`
Expected: all 8 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/models.rs src-tauri/src/commands/notes.rs
git commit -m "feat(p9-3): extract Q::A and cloze cards from note markdown"
```

---

## Task 3: `review_cards` storage layer

**Files:**
- Modify: `src-tauri/src/db/schema.rs` (add `review_cards` table)
- Modify: `src-tauri/src/db/notes.rs` (add `set_cards`, `due_cards`; wire `update_path`, `remove_notes_under`)
- Modify: `src-tauri/src/models.rs` (add `DueCard`)
- Test: `#[cfg(test)] mod tests` in `src-tauri/src/db/notes.rs` (existing module)

**Interfaces:**
- Consumes: `ExtractedCard`, `CardKind` (Task 2); `sm2::today()` (Task 1).
- Produces: `pub async fn set_cards(pool: &SqlitePool, note_path: &str, cards: &[ExtractedCard]) -> Result<()>`, `pub async fn due_cards(pool: &SqlitePool, workspace: &str, today: &str) -> Result<Vec<DueCard>>`, `pub struct DueCard { pub note_path: String, pub note_title: String, pub kind: String, pub front: String, pub back: String, pub position: i64 }` (`#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)] #[serde(rename_all = "camelCase")]`). Task 4 calls `set_cards` from `index_note_at`/`forget_note`/`delete_note`; Task 5's `list_due_cards` command calls `due_cards`.

- [ ] **Step 1: Add the schema migration**

Edit `src-tauri/src/db/schema.rs`, after the `note_tasks` block (after line 71, before the closing `Ok(())`):

```rust
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS review_cards (
            note_path TEXT    NOT NULL,
            kind      TEXT    NOT NULL,
            front     TEXT    NOT NULL,
            back      TEXT    NOT NULL,
            position  INTEGER NOT NULL,
            due       TEXT    NOT NULL,
            ease      REAL    NOT NULL,
            interval  INTEGER NOT NULL,
            reps      INTEGER NOT NULL
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS review_cards_due ON review_cards(due)")
        .execute(pool)
        .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS review_cards_path ON review_cards(note_path)")
        .execute(pool)
        .await?;
```

- [ ] **Step 2: Add the `DueCard` model**

Edit `src-tauri/src/models.rs`, after `OpenTask` (after the block added in Task 2, or after line 177 if Task 2 hasn't touched this area — place it directly below `OpenTask`):

```rust
/// One due (or new) review card joined with the note it lives in, for the
/// review session (P9-3). Mirrors `OpenTask`'s shape exactly.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DueCard {
    pub note_path: String,
    pub note_title: String,
    pub kind: String,
    pub front: String,
    pub back: String,
    pub position: i64,
}
```

- [ ] **Step 3: Write the failing tests**

Add to `mod tests` in `src-tauri/src/db/notes.rs`, near `test_set_tasks_replaces_existing_tasks_for_a_note` (around line 973):

```rust
    fn card(kind: CardKind, front: &str, back: &str, position: i64) -> ExtractedCard {
        ExtractedCard {
            kind,
            front: front.into(),
            back: back.into(),
            position,
            due: None,
            ease: None,
            interval: None,
            reps: None,
        }
    }

    #[tokio::test]
    async fn test_set_cards_replaces_existing_cards_for_a_note() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "A", "/ws/a.md", "/ws")).await.unwrap();
        set_cards(
            &pool,
            "/ws/a.md",
            &[card(CardKind::Qa, "Q1", "A1", 0), card(CardKind::Qa, "Q2", "A2", 2)],
        )
        .await
        .unwrap();
        set_cards(&pool, "/ws/a.md", &[card(CardKind::Qa, "only", "one", 0)])
            .await
            .unwrap();

        let due = due_cards(&pool, "/ws", "9999-12-31").await.unwrap();
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].front, "only");
    }

    #[tokio::test]
    async fn test_new_card_with_no_schedule_defaults_to_due_today() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "A", "/ws/a.md", "/ws")).await.unwrap();
        set_cards(&pool, "/ws/a.md", &[card(CardKind::Cloze, "front", "back", 0)])
            .await
            .unwrap();

        let due = due_cards(&pool, "/ws", "2026-08-20").await.unwrap();
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].kind, "cloze");
    }

    #[tokio::test]
    async fn test_due_cards_excludes_not_yet_due_and_other_workspaces() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "A", "/ws/a.md", "/ws")).await.unwrap();
        index_note(&pool, &note("c", "C", "/other/c.md", "/other")).await.unwrap();
        let mut future = card(CardKind::Qa, "not due yet", "back", 0);
        future.due = Some("2099-01-01".to_string());
        future.ease = Some(2.5);
        future.interval = Some(400);
        future.reps = Some(5);
        set_cards(&pool, "/ws/a.md", &[future]).await.unwrap();
        set_cards(
            &pool,
            "/other/c.md",
            &[card(CardKind::Qa, "other workspace", "back", 0)],
        )
        .await
        .unwrap();

        let due = due_cards(&pool, "/ws", "2026-08-20").await.unwrap();
        assert!(due.is_empty());
    }

    #[tokio::test]
    async fn test_update_path_also_rewrites_cards() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "A", "/ws/old.md", "/ws")).await.unwrap();
        set_cards(&pool, "/ws/old.md", &[card(CardKind::Qa, "Q", "A", 0)])
            .await
            .unwrap();

        update_path(&pool, "/ws/old.md", "/ws/Folder/old.md").await.unwrap();

        let due = due_cards(&pool, "/ws", "9999-12-31").await.unwrap();
        assert_eq!(due[0].note_path, "/ws/Folder/old.md");
    }

    #[tokio::test]
    async fn test_remove_notes_under_also_deletes_cards() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "A", "/ws/Folder/a.md", "/ws")).await.unwrap();
        set_cards(&pool, "/ws/Folder/a.md", &[card(CardKind::Qa, "Q", "A", 0)])
            .await
            .unwrap();

        remove_notes_under(&pool, "/ws/Folder/").await.unwrap();

        let due = due_cards(&pool, "/ws", "9999-12-31").await.unwrap();
        assert!(due.is_empty());
    }
```

Add the two new imports at the top of `src-tauri/src/db/notes.rs` (line 1):

```rust
use crate::models::{CardKind, DueCard, ExtractedCard, ExtractedTask, NoteMetadata, OpenTask, SearchResult};
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `cd src-tauri && cargo test --lib db::notes::tests::test_set_cards db::notes::tests::test_new_card db::notes::tests::test_due_cards db::notes::tests::test_update_path_also_rewrites_cards db::notes::tests::test_remove_notes_under_also_deletes_cards -- --nocapture`
Expected: FAIL to compile — `set_cards`/`due_cards` not found.

- [ ] **Step 5: Implement**

Edit `src-tauri/src/db/notes.rs`. Add `use crate::sm2;` near the top (after the `use crate::models::{...}` line). Add after `set_tasks`/`open_tasks` (after line 294):

```rust
pub async fn set_cards(pool: &SqlitePool, note_path: &str, cards: &[ExtractedCard]) -> Result<()> {
    sqlx::query("DELETE FROM review_cards WHERE note_path = ?")
        .bind(note_path)
        .execute(pool)
        .await?;
    for card in cards {
        let kind = match card.kind {
            CardKind::Qa => "qa",
            CardKind::Cloze => "cloze",
        };
        let due = card.due.clone().unwrap_or_else(sm2::today);
        let ease = card.ease.unwrap_or(2.5);
        let interval = card.interval.unwrap_or(0);
        let reps = card.reps.unwrap_or(0);
        sqlx::query(
            "INSERT INTO review_cards (note_path, kind, front, back, position, due, ease, interval, reps)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(note_path)
        .bind(kind)
        .bind(&card.front)
        .bind(&card.back)
        .bind(card.position)
        .bind(due)
        .bind(ease)
        .bind(interval)
        .bind(reps)
        .execute(pool)
        .await?;
    }
    Ok(())
}

pub async fn due_cards(pool: &SqlitePool, workspace: &str, today: &str) -> Result<Vec<DueCard>> {
    let rows = sqlx::query_as::<_, DueCard>(
        "SELECT rc.note_path, n.title as note_title, rc.kind, rc.front, rc.back, rc.position
         FROM review_cards rc
         JOIN notes n ON n.path = rc.note_path
         WHERE n.workspace = ? AND rc.due <= ?
         ORDER BY rc.due, n.title COLLATE NOCASE, rc.position",
    )
    .bind(workspace)
    .bind(today)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}
```

Wire the two rename/remove call sites. In `update_path` (after the `note_tasks` `UPDATE`, around line 125-129):

```rust
    sqlx::query("UPDATE review_cards SET note_path = ? WHERE note_path = ?")
        .bind(new_path)
        .bind(old_path)
        .execute(pool)
        .await?;
```

In `remove_notes_under` (after the `note_tasks` `DELETE`, around line 97-100):

```rust
    sqlx::query("DELETE FROM review_cards WHERE note_path LIKE ? ESCAPE '\\'")
        .bind(&like_pattern)
        .execute(pool)
        .await?;
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test --lib db::notes:: -- --nocapture`
Expected: all `db::notes` tests PASS, including the 5 new ones.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/db/schema.rs src-tauri/src/db/notes.rs src-tauri/src/models.rs
git commit -m "feat(p9-3): add review_cards derived table and storage layer"
```

---

## Task 4: Wire card extraction into the reindex/forget/delete paths

**Files:**
- Modify: `src-tauri/src/commands/notes.rs` (`index_note_at`, `forget_note`, `delete_note`)
- Test: `#[cfg(test)] mod tests` in `src-tauri/src/commands/notes.rs`

**Interfaces:**
- Consumes: `extract_cards` (Task 2), `db::notes::set_cards`/`due_cards` (Task 3).
- Produces: nothing new — this task only wires existing pieces together so `review_cards` follows the same lifecycle as `note_tags`/`note_tasks`.

- [ ] **Step 1: Write the failing integration test**

Add to `mod tests` in `src-tauri/src/commands/notes.rs`, near the existing reindex-adjacent tests (search for `test_extract_tasks_finds_open_and_done_items_with_line_positions` for the surrounding style; this test needs a real DB pool, so place it near any existing `#[tokio::test]` in this file — if none exist yet in this module, add `use crate::db::schema::run_migrations;` and `use sqlx::SqlitePool;` to the test module's imports):

```rust
    #[tokio::test]
    async fn test_index_note_at_populates_review_cards() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        run_migrations(&pool).await.unwrap();
        index_note_at("/ws/a.md", "/ws", "Q :: A\n", &pool)
            .await
            .unwrap();

        let due = db::notes::due_cards(&pool, "/ws", "9999-12-31").await.unwrap();
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].front, "Q");
    }

    #[tokio::test]
    async fn test_forget_note_clears_its_cards() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        run_migrations(&pool).await.unwrap();
        index_note_at("/ws/a.md", "/ws", "Q :: A\n", &pool)
            .await
            .unwrap();
        forget_note("/ws/a.md", &pool).await.unwrap();

        let due = db::notes::due_cards(&pool, "/ws", "9999-12-31").await.unwrap();
        assert!(due.is_empty());
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src-tauri && cargo test test_index_note_at_populates_review_cards test_forget_note_clears_its_cards -- --nocapture`
Expected: FAIL — `due` is empty when it should have one row (extraction not wired yet).

- [ ] **Step 3: Implement**

Edit `src-tauri/src/commands/notes.rs`. In `index_note_at` (around line 386-406), add after the `set_tasks` line:

```rust
    db::notes::set_cards(db, path, &extract_cards(content)).await?;
```

In `forget_note` (around line 580-587), add after `set_tasks`:

```rust
    db::notes::set_cards(db, path, &[]).await?;
```

In `delete_note` (around line 616-643), change the final block from:

```rust
    db::notes::set_tasks(&db, &path, &[])
        .await
        .map_err(|e| e.to_string())
}
```

to:

```rust
    db::notes::set_tasks(&db, &path, &[])
        .await
        .map_err(|e| e.to_string())?;

    db::notes::set_cards(&db, &path, &[])
        .await
        .map_err(|e| e.to_string())
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test test_index_note_at_populates_review_cards test_forget_note_clears_its_cards -- --nocapture`
Expected: both PASS.

- [ ] **Step 5: Run the full backend test suite to check for regressions**

Run: `cd src-tauri && cargo test`
Expected: PASS, no regressions in tasks/tags/links/formulas tests.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/notes.rs
git commit -m "feat(p9-3): wire card extraction into reindex/forget/delete"
```

---

## Task 5: `grade_card` write-back and `list_due_cards` command

**Files:**
- Modify: `src-tauri/src/commands/notes.rs` (`grade_card_line`, `grade_card_at`, `grade_card` command, `list_due_cards` command)
- Test: `#[cfg(test)] mod tests` in `src-tauri/src/commands/notes.rs`

**Interfaces:**
- Consumes: `classify_card_line`, `parse_sr_comment` (Task 2, both already `fn`-private in this file), `sm2::{CardState, Grade, next_state}` (Task 1), `db::notes::due_cards` (Task 3), `write_atomic` (existing), `index_note_at` (existing).
- Produces: `pub fn grade_card_line(content: &str, position: i64, grade: sm2::Grade, today: chrono::NaiveDate) -> Option<String>` (pure, testable without I/O — same role as `toggle_task_line`), Tauri commands `grade_card(path: String, position: i64, grade: sm2::Grade, workspace: String) -> Result<(), String>` and `list_due_cards(workspace: String) -> Result<Vec<DueCard>, String>`. Task 6 registers both in `lib.rs`; the frontend (Task 7) calls both by name.

- [ ] **Step 1: Write the failing tests**

Add to `mod tests` in `src-tauri/src/commands/notes.rs`, near the `toggle_task_line` tests (around line 1415):

```rust
    fn today() -> chrono::NaiveDate {
        chrono::NaiveDate::from_ymd_opt(2026, 8, 20).unwrap()
    }

    #[test]
    fn test_grade_card_line_inserts_a_new_schedule_comment() {
        let result = grade_card_line("Q :: A\n", 0, crate::sm2::Grade::Good, today()).unwrap();
        assert_eq!(
            result,
            "Q :: A\n<!-- sr due=2026-08-21 ease=2.50 interval=1 reps=1 -->\n"
        );
    }

    #[test]
    fn test_grade_card_line_replaces_an_existing_schedule_comment() {
        let content = "Q :: A\n<!-- sr due=2026-08-20 ease=2.50 interval=6 reps=2 -->\n";
        let result = grade_card_line(content, 0, crate::sm2::Grade::Good, today()).unwrap();
        assert_eq!(
            result,
            "Q :: A\n<!-- sr due=2026-09-04 ease=2.50 interval=15 reps=3 -->\n"
        );
    }

    #[test]
    fn test_grade_card_line_again_resets_progress() {
        let content = "Q :: A\n<!-- sr due=2026-08-20 ease=2.50 interval=6 reps=2 -->\n";
        let result = grade_card_line(content, 0, crate::sm2::Grade::Again, today()).unwrap();
        assert!(result.contains("interval=1 reps=0"));
    }

    #[test]
    fn test_grade_card_line_none_when_position_is_no_longer_a_card() {
        assert!(grade_card_line(
            "just prose now\n",
            0,
            crate::sm2::Grade::Good,
            today()
        )
        .is_none());
    }

    #[test]
    fn test_grade_card_line_preserves_a_second_card_below() {
        let content = "Q1 :: A1\nQ2 :: A2\n";
        let result = grade_card_line(content, 0, crate::sm2::Grade::Good, today()).unwrap();
        assert!(result.contains("Q2 :: A2"));
        assert!(result.contains("Q1 :: A1\n<!-- sr"));
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src-tauri && cargo test test_grade_card_line -- --nocapture`
Expected: FAIL to compile — `grade_card_line` not found.

- [ ] **Step 3: Implement**

Edit `src-tauri/src/commands/notes.rs`. Add `sm2` to the crate imports at the top (line 1 becomes):

```rust
use crate::db::{self, DbPool};
use crate::models::{
    CardKind, DueCard, ExtractedCard, ExtractedFormula, ExtractedTask, GraphLink, GraphTag,
    NoteMetadata, OpenTask, SearchResult, WorkspaceTree,
};
use crate::sm2;
```

Add after `toggle_task_at` (after line 516):

```rust
// Mirrors `toggle_task_line`'s shape exactly: pure, no I/O, `None` when the
// line no longer looks like a card (the note changed on disk since the
// review queue was built) — surfaced as an error by the caller, never
// silently mangling an unrelated line.
pub fn grade_card_line(
    content: &str,
    position: i64,
    grade: sm2::Grade,
    today: chrono::NaiveDate,
) -> Option<String> {
    let mut lines: Vec<String> = content.lines().map(str::to_string).collect();
    let idx = usize::try_from(position).ok()?;
    let trimmed = lines.get(idx)?.trim().to_string();
    classify_card_line(&trimmed)?;

    let current = lines
        .get(idx + 1)
        .and_then(|l| parse_sr_comment(l))
        .map(|(_, ease, interval, reps)| sm2::CardState {
            ease,
            interval,
            reps,
        })
        .unwrap_or_default();

    let next = sm2::next_state(current, grade, today);
    let comment = format!(
        "<!-- sr due={} ease={:.2} interval={} reps={} -->",
        next.due, next.ease, next.interval, next.reps
    );

    let has_comment_line = lines
        .get(idx + 1)
        .map(|l| parse_sr_comment(l).is_some())
        .unwrap_or(false);
    if has_comment_line {
        lines[idx + 1] = comment;
    } else {
        lines.insert(idx + 1, comment);
    }

    let mut rewritten = lines.join("\n");
    if content.ends_with('\n') {
        rewritten.push('\n');
    }
    Some(rewritten)
}

async fn grade_card_at(
    path: &str,
    position: i64,
    grade: sm2::Grade,
    workspace: &str,
    db: &DbPool,
) -> anyhow::Result<()> {
    let content = tokio::fs::read_to_string(path).await?;
    let today = chrono::Utc::now().date_naive();
    let new_content = grade_card_line(&content, position, grade, today)
        .ok_or_else(|| anyhow::anyhow!("no card at line {position} in {path}"))?;
    write_atomic(Path::new(path), &new_content).await?;
    index_note_at(path, workspace, &new_content, db).await?;
    Ok(())
}
```

Add the two new Tauri commands after `toggle_task` (after line 723-724):

```rust
#[tauri::command]
pub async fn grade_card(
    path: String,
    position: i64,
    grade: sm2::Grade,
    workspace: String,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    grade_card_at(&path, position, grade, &workspace, &db)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_due_cards(workspace: String, db: State<'_, DbPool>) -> Result<Vec<DueCard>, String> {
    db::notes::due_cards(&db, &workspace, &sm2::today())
        .await
        .map_err(|e| e.to_string())
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test test_grade_card_line -- --nocapture`
Expected: all 5 tests PASS.

- [ ] **Step 5: Run the full backend suite and clippy**

Run: `cd src-tauri && cargo test && cargo clippy -- -D warnings`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/notes.rs
git commit -m "feat(p9-3): add grade_card write-back and list_due_cards command"
```

---

## Task 6: Register commands and the Review menu item

**Files:**
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `commands::notes::grade_card`, `commands::notes::list_due_cards` (Task 5).
- Produces: both commands reachable via `invoke()` from the frontend; a `review` menu-action ID with accelerator `CmdOrCtrl+Shift+R`, matching the `task-view`/`Ctrl+Shift+K` precedent Task 8 (frontend) dispatches on.

- [ ] **Step 1: Add the menu item**

Edit `src-tauri/src/lib.rs`. In `build_menu`'s `view_menu` (after the `task-view` `MenuItem`, around line 143-149), add:

```rust
            &MenuItem::with_id(
                handle,
                "review",
                "Review",
                true,
                Some("CmdOrCtrl+Shift+R"),
            )?,
```

- [ ] **Step 2: Register the commands**

Edit `src-tauri/src/lib.rs`'s `invoke_handler!` list (around line 198-258), add after `commands::notes::toggle_task,`:

```rust
            commands::notes::grade_card,
            commands::notes::list_due_cards,
```

- [ ] **Step 3: Build to verify it compiles**

Run: `cd src-tauri && cargo build`
Expected: builds cleanly, no errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(p9-3): register grade_card/list_due_cards and the Review menu item"
```

---

## Task 7: Frontend types and API bindings

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/lib/tauri.ts`

**Interfaces:**
- Produces: `export type Grade = 'again' | 'hard' | 'good' | 'easy'`, `export interface DueCard { notePath: string; noteTitle: string; kind: string; front: string; back: string; position: number }`, `api.notes.listDueCards(workspace: string) => Promise<DueCard[]>`, `api.notes.gradeCard(path: string, position: number, grade: Grade, workspace: string) => Promise<void>`. Consumed by Task 12 (`ReviewSession`) and Task 13 (`HomeView`).

- [ ] **Step 1: Add the types**

Edit `src/types/index.ts`, after the `OpenTask` interface (after line 107):

```ts

export type Grade = 'again' | 'hard' | 'good' | 'easy'

export interface DueCard {
  notePath: string
  noteTitle: string
  kind: string
  front: string
  back: string
  position: number
}
```

- [ ] **Step 2: Add the API bindings**

Edit `src/lib/tauri.ts`. Add `DueCard`, `Grade` to the type import on line 2:

```ts
import type { NoteMetadata, WorkspaceState, WorkspaceTree, SearchResult, AppSettings, GraphLink, GraphTag, RepoMode, CommitOutcome, PushOutcome, PullOutcome, RepoInitOutcome, TemplateMetadata, CrossRefTarget, OpenTask, DueCard, Grade } from '../types'
```

Add after `generateFormulaSheet` (after line 65):

```ts
    listDueCards: (workspace: string) =>
      invoke<DueCard[]>('list_due_cards', { workspace }),
    gradeCard: (path: string, position: number, grade: Grade, workspace: string) =>
      invoke<void>('grade_card', { path, position, grade, workspace }),
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts src/lib/tauri.ts
git commit -m "feat(p9-3): add DueCard/Grade types and API bindings"
```

---

## Task 8: `SrCardHighlight` decoration-target finder

**Files:**
- Create: `src/lib/srCards.ts`
- Test: `src/lib/srCards.test.ts`

**Interfaces:**
- Produces: `export interface SrCardSpan { kind: 'qa' | 'cloze'; from: number; to: number }`, `export function findSrCardSpans(text: string): SrCardSpan[]`. Consumed by Task 10 (`SrCardHighlight` ProseMirror plugin).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/srCards.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { findSrCardSpans } from './srCards'

describe('findSrCardSpans', () => {
  it('finds a whole-text Q::A span', () => {
    const spans = findSrCardSpans('What is Big-O of binary search? :: O(log n)')
    expect(spans).toEqual([{ kind: 'qa', from: 0, to: 45 }])
  })

  it('finds a cloze span covering the whole text', () => {
    const text = 'A binary search tree keeps {{all left descendants smaller}} than the node.'
    const spans = findSrCardSpans(text)
    expect(spans).toEqual([{ kind: 'cloze', from: 0, to: text.length }])
  })

  it('does not match plain prose', () => {
    expect(findSrCardSpans('Just an ordinary sentence.')).toEqual([])
  })

  it('does not match a schedule comment line', () => {
    expect(
      findSrCardSpans('<!-- sr due=2026-08-21 ease=2.50 interval=1 reps=1 -->'),
    ).toEqual([])
  })

  it('prefers qa over cloze when a line could read as both', () => {
    const text = 'Q :: {{A}}'
    const spans = findSrCardSpans(text)
    expect(spans).toEqual([{ kind: 'qa', from: 0, to: text.length }])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/srCards.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/srCards.ts`:

```ts
/**
 * Recognising a review card's own text (P9-3), so the editor can highlight
 * it — decoration only, never a schema change (a card must stay ordinary,
 * portable Markdown). Operates on one text node's content at a time, the
 * same granularity `findCodeLinks` uses; a card's front/back is expected to
 * be that node's entire text, matching how `extract_cards` treats a card as
 * an entire source line.
 *
 * Design: `docs/specs/spaced-repetition-design.md`.
 */

export interface SrCardSpan {
  kind: 'qa' | 'cloze'
  from: number
  to: number
}

const QA_PATTERN = /^(.+?)\s::\s(.+)$/
const CLOZE_PATTERN = /\{\{[^{}]+\}\}/

export function findSrCardSpans(text: string): SrCardSpan[] {
  if (!text || text.trim().startsWith('<!--')) return []

  if (QA_PATTERN.test(text)) {
    return [{ kind: 'qa', from: 0, to: text.length }]
  }
  if (CLOZE_PATTERN.test(text)) {
    return [{ kind: 'cloze', from: 0, to: text.length }]
  }
  return []
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/srCards.test.ts`
Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/srCards.ts src/lib/srCards.test.ts
git commit -m "feat(p9-3): add findSrCardSpans for editor decoration"
```

---

## Task 9: `SrState` node — the round-trip fix

**Files:**
- Create: `src/editor/extensions/SrState.tsx`
- Modify: `src/editor/extensions/index.ts`
- Test: `src/editor/extensions/srState.test.ts`

**Interfaces:**
- Produces: `export const SrState` (TipTap `Node`), registered in `coreExtensions`. This is the fix for the verified data-loss risk in the design spec — every other task that touches `<!-- sr ... -->` comments (backend) depends on this existing so the comment isn't dropped the moment a note opens in the app's own editor.

- [ ] **Step 1: Write the failing regression test**

Create `src/editor/extensions/srState.test.ts` (this is the permanent version of the throwaway spike test from the design phase):

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { coreExtensions } from './index'

let editor: Editor | null = null

interface MarkdownStorage {
  getMarkdown: () => string
}

function mount(content: string): Editor {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: coreExtensions,
    content,
  })
  return editor
}

function getMarkdown(e: Editor): string {
  return ((e.storage as unknown as Record<string, unknown>)['markdown'] as MarkdownStorage).getMarkdown()
}

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('SrState node (P9-3)', () => {
  it('round-trips a schedule comment through mount and getMarkdown unchanged', () => {
    const md = 'What is Big-O of binary search? :: O(log n)\n<!-- sr due=2026-08-21 ease=2.50 interval=1 reps=1 -->'
    const e = mount(md)
    expect(getMarkdown(e)).toContain('<!-- sr due=2026-08-21 ease=2.50 interval=1 reps=1 -->')
  })

  it('renders the sr-state node invisibly in the editor DOM', () => {
    const md = 'Q :: A\n<!-- sr due=2026-08-21 ease=2.50 interval=1 reps=1 -->'
    const e = mount(md)
    const el = e.view.dom.querySelector('[data-type="sr-state"]')
    expect(el).toBeTruthy()
    expect(getComputedStyle(el as Element).display).toBe('none')
  })

  it('leaves a note with no schedule comment completely unaffected', () => {
    const md = 'Just an ordinary note with no cards.'
    const e = mount(md)
    expect(getMarkdown(e)).toBe(md)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/editor/extensions/srState.test.ts`
Expected: FAIL — the comment is dropped (this reproduces the verified risk from the design spike).

- [ ] **Step 3: Implement**

Create `src/editor/extensions/SrState.tsx`:

```tsx
import { Node } from '@tiptap/core'

interface SrStateAttrs {
  due: string
  ease: string
  interval: string
  reps: string
}

// A card's SM-2 schedule (P9-3), stored in the note as a plain
// `<!-- sr due=... ease=... interval=... reps=... -->` comment so it reads
// as ordinary Markdown in any other editor. Verified directly: TipTap's
// markdown pipeline renders raw markdown to an HTML string via markdown-it,
// then builds the ProseMirror doc from that HTML via `DOMParser` — which
// walks Element and Text nodes only and silently skips Comment nodes
// (nodeType 8). Left alone, a note's entire review history would vanish the
// moment it was opened and saved in this editor.
//
// Fix, the same trick `Callout.tsx` already uses for its own marker line:
// `parse.updateDOM` runs on the parsed-but-not-yet-schema'd DOM, before
// ProseMirror's own parser ever sees it. It rewrites each matching Comment
// node into a real (invisible) element that a normal `parseHTML` tag rule
// can then claim.
export const SrState = Node.create({
  name: 'srState',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      due: { default: '' },
      ease: { default: '' },
      interval: { default: '' },
      reps: { default: '' },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="sr-state"]',
        getAttrs: (el) => ({
          due: (el as HTMLElement).getAttribute('data-due') ?? '',
          ease: (el as HTMLElement).getAttribute('data-ease') ?? '',
          interval: (el as HTMLElement).getAttribute('data-interval') ?? '',
          reps: (el as HTMLElement).getAttribute('data-reps') ?? '',
        }),
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    const attrs = HTMLAttributes as SrStateAttrs
    return [
      'div',
      {
        'data-type': 'sr-state',
        'data-due': attrs.due,
        'data-ease': attrs.ease,
        'data-interval': attrs.interval,
        'data-reps': attrs.reps,
        style: 'display:none',
        contenteditable: 'false',
      },
    ]
  },

  addStorage() {
    return {
      markdown: {
        serialize(
          state: { write: (s: string) => void; ensureNewLine: () => void; closeBlock: (n: unknown) => void },
          node: { attrs: SrStateAttrs },
        ) {
          const { due, ease, interval, reps } = node.attrs
          state.ensureNewLine()
          state.write(`<!-- sr due=${due} ease=${ease} interval=${interval} reps=${reps} -->`)
          state.closeBlock(node)
        },
        parse: {
          updateDOM(element: HTMLElement) {
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_COMMENT)
            const toReplace: Comment[] = []
            let n = walker.nextNode()
            while (n) {
              toReplace.push(n as Comment)
              n = walker.nextNode()
            }
            const pattern = /^sr\s+due=(\S+)\s+ease=(\S+)\s+interval=(\S+)\s+reps=(\S+)$/
            for (const comment of toReplace) {
              const match = pattern.exec(comment.data.trim())
              if (!match) continue
              const div = document.createElement('div')
              div.setAttribute('data-type', 'sr-state')
              div.setAttribute('data-due', match[1]!)
              div.setAttribute('data-ease', match[2]!)
              div.setAttribute('data-interval', match[3]!)
              div.setAttribute('data-reps', match[4]!)
              comment.replaceWith(div)
            }
          },
        },
      },
    }
  },
})
```

Note: no `addNodeView()` — `renderHTML`'s plain `display:none` div is sufficient since the node is never interacted with directly (no click handling, no content), unlike `Callout`/`Details` which need a React view for their header/collapse chrome.

Register it in `src/editor/extensions/index.ts`. Add the import (after the `HTMLBlock` import, line 37):

```ts
import { SrState } from './SrState'
```

Add it to `coreExtensions` (after `HTMLInline,` line 176, before `TextAlignment,`):

```ts
  SrState,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/editor/extensions/srState.test.ts`
Expected: all 3 tests PASS.

- [ ] **Step 5: Run the full frontend suite to check for regressions**

Run: `npm test`
Expected: PASS, no regressions (particularly `htmlFeatures.test.ts` — `SrState`'s `updateDOM` must not affect unrelated comments or HTML, since it only replaces comments matching the exact `sr ...` pattern).

- [ ] **Step 6: Commit**

```bash
git add src/editor/extensions/SrState.tsx src/editor/extensions/index.ts src/editor/extensions/srState.test.ts
git commit -m "fix(p9-3): preserve sr-state comments through the editor round-trip"
```

---

## Task 10: `SrCardHighlight` decoration plugin

**Files:**
- Create: `src/editor/extensions/SrCardHighlight.ts`
- Modify: `src/editor/extensions/index.ts`
- Modify: `src/index.css`
- Test: `src/editor/extensions/srCardHighlight.test.ts`

**Interfaces:**
- Consumes: `findSrCardSpans` (Task 8).
- Produces: `export const SrCardHighlight` (TipTap `Extension`), registered in `coreExtensions`, applying `.sr-card-qa`/`.sr-cloze` decoration classes.

- [ ] **Step 1: Write the failing tests**

Create `src/editor/extensions/srCardHighlight.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { coreExtensions } from './index'

let editor: Editor | null = null

interface MarkdownStorage {
  getMarkdown: () => string
}

function mount(content: string): Editor {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: coreExtensions,
    content,
  })
  return editor
}

function getMarkdown(e: Editor): string {
  return ((e.storage as unknown as Record<string, unknown>)['markdown'] as MarkdownStorage).getMarkdown()
}

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('SrCardHighlight (P9-3)', () => {
  it('decorates a Q::A paragraph', () => {
    const e = mount('What is Big-O of binary search? :: O(log n)')
    const el = e.view.dom.querySelector('.sr-card-qa')
    expect(el).toBeTruthy()
    expect(el?.textContent).toContain('::')
  })

  it('decorates a cloze paragraph', () => {
    const e = mount('A tree keeps {{all left descendants smaller}} than the node.')
    const el = e.view.dom.querySelector('.sr-cloze')
    expect(el).toBeTruthy()
  })

  it('does not decorate plain prose', () => {
    const e = mount('Just an ordinary sentence.')
    expect(e.view.dom.querySelector('.sr-card-qa')).toBeFalsy()
    expect(e.view.dom.querySelector('.sr-cloze')).toBeFalsy()
  })

  it('never changes getMarkdown output — decoration is view-layer only', () => {
    const md = 'What is Big-O of binary search? :: O(log n)'
    const e = mount(md)
    expect(getMarkdown(e)).toBe(md)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/editor/extensions/srCardHighlight.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/editor/extensions/SrCardHighlight.ts`:

```ts
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorState } from '@tiptap/pm/state'
import { findSrCardSpans } from '../../lib/srCards'

/**
 * Highlights a review card's own text (P9-3) — decoration, not a node: the
 * underlying `::`/`{{...}}` text has to stay exactly as typed so it degrades
 * to readable plain Markdown in any other editor, so nothing is stored in
 * the document for this. Same "decoration not node" shape as `CodeLink`.
 */
const srCardHighlightKey = new PluginKey('srCardHighlight')

function decorate(state: EditorState): DecorationSet {
  const decorations: Decoration[] = []

  state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return true
    for (const span of findSrCardSpans(node.text)) {
      decorations.push(
        Decoration.inline(pos + span.from, pos + span.to, {
          class: span.kind === 'qa' ? 'sr-card-qa' : 'sr-cloze',
        }),
      )
    }
    return true
  })

  return DecorationSet.create(state.doc, decorations)
}

export const SrCardHighlight = Extension.create({
  name: 'srCardHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: srCardHighlightKey,
        state: {
          init: (_, state) => decorate(state),
          apply: (tr, old, _oldState, newState) => (tr.docChanged ? decorate(newState) : old),
        },
        props: {
          decorations(state) {
            return srCardHighlightKey.getState(state) as DecorationSet
          },
        },
      }),
    ]
  },
})
```

Register it in `src/editor/extensions/index.ts`. Add the import (after the `SrState` import from Task 9):

```ts
import { SrCardHighlight } from './SrCardHighlight'
```

Add it to `coreExtensions` (after `SrState,`):

```ts
  SrCardHighlight,
```

Add CSS to `src/index.css`, after the `.cross-ref-missing` block (find it near line 1604, add after that rule block):

```css
/* Review card highlighting (P9-3) — decoration only, the underlying text is
   unstyled outside the editor. Q::A gets a light underline like a code link;
   cloze spans get a subtle fill so hidden text is easy to spot while
   authoring without being illegible. */
.sr-card-qa {
  border-bottom: 1px dashed color-mix(in srgb, var(--accent) 50%, transparent);
}

.sr-cloze {
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  border-radius: 3px;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/editor/extensions/srCardHighlight.test.ts`
Expected: all 4 tests PASS.

- [ ] **Step 5: Run the full frontend suite**

Run: `npm test`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/editor/extensions/SrCardHighlight.ts src/editor/extensions/index.ts src/editor/extensions/srCardHighlight.test.ts src/index.css
git commit -m "feat(p9-3): highlight review cards in the editor"
```

---

## Task 11: `ReviewSession` component

**Files:**
- Create: `src/components/ReviewSession.tsx`
- Modify: `src/index.css`
- Test: `src/components/ReviewSession.test.tsx`

**Interfaces:**
- Consumes: `api.notes.listDueCards`, `api.notes.gradeCard` (Task 7), `useWorkspaceStore` (existing).
- Produces: `export function ReviewSession({ onClose }: { onClose: () => void })`. Consumed by Task 13 (`Layout.tsx`).

- [ ] **Step 1: Write the failing tests**

Create `src/components/ReviewSession.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ReviewSession } from './ReviewSession'
import { api } from '../lib/tauri'
import { useWorkspaceStore } from '../store/workspace'
import type { DueCard } from '../types'

vi.mock('../lib/tauri', () => ({
  api: {
    notes: {
      listDueCards: vi.fn(),
      gradeCard: vi.fn(),
    },
  },
}))

const cards: DueCard[] = [
  { notePath: '/ws/a.md', noteTitle: 'A', kind: 'qa', front: 'Q1', back: 'A1', position: 0 },
  { notePath: '/ws/b.md', noteTitle: 'B', kind: 'cloze', front: 'Q2 [...]', back: 'Q2 full', position: 3 },
]

beforeEach(() => {
  useWorkspaceStore.setState({ path: '/ws' })
  vi.mocked(api.notes.listDueCards).mockResolvedValue(cards)
  vi.mocked(api.notes.gradeCard).mockResolvedValue(undefined)
})

describe('ReviewSession', () => {
  it('shows the front of the first due card, answer hidden', async () => {
    render(<ReviewSession onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Q1')).toBeInTheDocument())
    expect(screen.queryByText('A1')).not.toBeInTheDocument()
    expect(screen.getByText('Reveal answer')).toBeInTheDocument()
  })

  it('reveals the back and grade buttons on click', async () => {
    render(<ReviewSession onClose={vi.fn()} />)
    await waitFor(() => screen.getByText('Q1'))
    fireEvent.click(screen.getByText('Reveal answer'))
    expect(screen.getByText('A1')).toBeInTheDocument()
    expect(screen.getByText('Again')).toBeInTheDocument()
    expect(screen.getByText('Hard')).toBeInTheDocument()
    expect(screen.getByText('Good')).toBeInTheDocument()
    expect(screen.getByText('Easy')).toBeInTheDocument()
  })

  it('grades the card and advances to the next one', async () => {
    render(<ReviewSession onClose={vi.fn()} />)
    await waitFor(() => screen.getByText('Q1'))
    fireEvent.click(screen.getByText('Reveal answer'))
    fireEvent.click(screen.getByText('Good'))

    expect(api.notes.gradeCard).toHaveBeenCalledWith('/ws/a.md', 0, 'good', '/ws')
    await waitFor(() => expect(screen.getByText('Q2 [...]')).toBeInTheDocument())
    expect(screen.queryByText('Reveal answer')).toBeInTheDocument()
  })

  it('shows "all done" once the queue is empty', async () => {
    vi.mocked(api.notes.listDueCards).mockResolvedValue([])
    render(<ReviewSession onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText(/all done/i)).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/ReviewSession.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/components/ReviewSession.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { api } from '../lib/tauri'
import { useWorkspaceStore } from '../store/workspace'
import type { DueCard, Grade } from '../types'

interface ReviewSessionProps {
  onClose: () => void
}

const GRADES: Array<{ grade: Grade; label: string }> = [
  { grade: 'again', label: 'Again' },
  { grade: 'hard', label: 'Hard' },
  { grade: 'good', label: 'Good' },
  { grade: 'easy', label: 'Easy' },
]

export function ReviewSession({ onClose }: ReviewSessionProps) {
  const workspacePath = useWorkspaceStore((s) => s.path)
  const [queue, setQueue] = useState<DueCard[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    if (!workspacePath) return
    setIsLoading(true)
    api.notes.listDueCards(workspacePath).then((cards) => {
      setQueue(cards)
      setIsLoading(false)
    })
  }, [workspacePath])

  const current = queue[0]

  // Grades the front card, then drops it from the local queue on success —
  // mirrors `TaskView.toggle`'s "drop it from local state, don't refetch"
  // shape, since the backend write already happened.
  function grade(g: Grade) {
    if (!workspacePath || !current) return
    void api.notes.gradeCard(current.notePath, current.position, g, workspacePath).then(() => {
      setQueue((prev) => prev.slice(1))
      setRevealed(false)
    })
  }

  return (
    <div className="search-overlay" onMouseDown={onClose}>
      <div className="review-session" onMouseDown={(e) => e.stopPropagation()}>
        <div className="settings-panel-header">
          <h2>Review{queue.length > 0 ? ` (${queue.length} due)` : ''}</h2>
          <button className="settings-panel-close" onClick={onClose} aria-label="Close review">
            <X size={16} />
          </button>
        </div>
        {isLoading ? (
          <p className="status">Loading…</p>
        ) : !current ? (
          <p className="empty-state">All done for today.</p>
        ) : (
          <div className="review-card">
            <p className="review-card-note">{current.noteTitle}</p>
            <p className="review-card-front">{current.front}</p>
            {revealed ? (
              <>
                <p className="review-card-back">{current.back}</p>
                <div className="review-card-grades">
                  {GRADES.map(({ grade: g, label }) => (
                    <button key={g} className="review-card-grade" onClick={() => grade(g)}>
                      {label}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <button className="review-card-reveal" onClick={() => setRevealed(true)}>
                Reveal answer
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
```

Add CSS to `src/index.css`, after the `.task-view-item-text:hover` rule (near line 1943):

```css
/* Review session (P9-3) — shares the settings-panel/task-view shell. */
.review-session {
  background: var(--bg-raised);
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  width: min(480px, calc(100vw - 40px));
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6);
  padding: var(--space-lg);
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
}

.review-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  padding: var(--space-lg) 0;
}

.review-card-note {
  color: var(--text-tertiary);
  font-size: 12px;
  margin: 0;
}

.review-card-front, .review-card-back {
  color: var(--text-primary);
  font-size: 15px;
  margin: 0;
}

.review-card-back {
  padding-top: var(--space-md);
  border-top: 1px solid var(--border-strong);
}

.review-card-reveal {
  align-self: flex-start;
  background: none;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  color: var(--text-primary);
  cursor: pointer;
  padding: 6px 14px;
  font-size: 13px;
}

.review-card-reveal:hover { border-color: var(--accent); }

.review-card-grades {
  display: flex;
  gap: var(--space-sm);
}

.review-card-grade {
  flex: 1;
  background: none;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  color: var(--text-primary);
  cursor: pointer;
  padding: 6px 0;
  font-size: 13px;
}

.review-card-grade:hover { border-color: var(--accent); color: var(--accent); }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/ReviewSession.test.tsx`
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ReviewSession.tsx src/components/ReviewSession.test.tsx src/index.css
git commit -m "feat(p9-3): add the review session modal"
```

---

## Task 12: Wire `HomeView`'s Study section live

**Files:**
- Modify: `src/components/HomeView.tsx`
- Modify: `src/components/HomeView.test.tsx`

**Interfaces:**
- Consumes: `api.notes.listDueCards` (Task 7).
- Produces: `HomeView` gains an `onOpenReview: () => void` prop (alongside its existing `onOpenTaskView`). Consumed by Task 13 (`Layout.tsx`).

- [ ] **Step 1: Write the failing test**

Read `src/components/HomeView.test.tsx` first to match its existing mocking style exactly (it already mocks `api.notes.listOpenTasks`), then add a test block modeled on the existing Tasks-section tests:

```tsx
  it('shows the due count and a Start review button, calling onOpenReview', async () => {
    vi.mocked(api.notes.listDueCards).mockResolvedValue([
      { notePath: '/ws/a.md', noteTitle: 'A', kind: 'qa', front: 'Q', back: 'A', position: 0 },
    ])
    const onOpenReview = vi.fn()
    render(<HomeView onOpenTaskView={vi.fn()} onOpenReview={onOpenReview} />)
    await waitFor(() => expect(screen.getByText('1 due')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Start review'))
    expect(onOpenReview).toHaveBeenCalled()
  })

  it('shows "Nothing due" when the queue is empty', async () => {
    vi.mocked(api.notes.listDueCards).mockResolvedValue([])
    render(<HomeView onOpenTaskView={vi.fn()} onOpenReview={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Nothing due.')).toBeInTheDocument())
  })
```

Add `listDueCards: vi.fn()` to the existing `vi.mock('../lib/tauri', ...)` block's `notes` object in this test file, and mock it to resolve `[]` by default in the shared `beforeEach` (matching however `listOpenTasks` is defaulted there).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/HomeView.test.tsx`
Expected: FAIL — `onOpenReview` prop missing / Study section still shows the disabled placeholder.

- [ ] **Step 3: Implement**

Edit `src/components/HomeView.tsx`. Add `DueCard` to the type import (line 5):

```ts
import type { OpenTask, DueCard } from '../types'
```

Change the props interface (lines 13-15):

```ts
interface HomeViewProps {
  onOpenTaskView: () => void
  onOpenReview: () => void
}
```

```ts
export function HomeView({ onOpenTaskView, onOpenReview }: HomeViewProps) {
```

Add state and a fetch effect alongside the existing tasks one (after the `taskItems` line, around line 40):

```ts
  const [dueCards, setDueCards] = useState<DueCard[]>([])

  useEffect(() => {
    if (!workspacePath) return
    api.notes.listDueCards(workspacePath).then(setDueCards)
  }, [workspacePath])
```

Replace the disabled Study section (lines 110-113):

```tsx
      <section className="home-section">
        <h2>Study</h2>
        {dueCards.length === 0 ? (
          <p className="home-empty">Nothing due.</p>
        ) : (
          <>
            <p className="home-count">{dueCards.length} due</p>
            <button className="home-view-all" onClick={onOpenReview}>
              Start review
            </button>
          </>
        )}
      </section>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/HomeView.test.tsx`
Expected: all tests PASS, including the pre-existing ones (Study is no longer `home-section-disabled`, so drop or update any existing test that asserted the old placeholder text).

- [ ] **Step 5: Commit**

```bash
git add src/components/HomeView.tsx src/components/HomeView.test.tsx
git commit -m "feat(p9-3): wire HomeView's Study section to real due-card data"
```

---

## Task 13: Wire `Layout.tsx`, `Ctrl Shift R`, and `ShortcutsOverlay`

**Files:**
- Modify: `src/components/Layout.tsx`
- Modify: `src/components/ShortcutsOverlay.tsx`

**Interfaces:**
- Consumes: `ReviewSession` (Task 11), `HomeView`'s new `onOpenReview` prop (Task 12).
- Produces: the `review` menu-action ID (registered in `lib.rs` in Task 6) opens `ReviewSession`; `HomeView`'s Start review button does the same.

- [ ] **Step 1: Wire the command and modal**

Edit `src/components/Layout.tsx`. Add the import (after `import { TaskView } from './TaskView'`, line 17):

```ts
import { ReviewSession } from './ReviewSession'
```

Add state (after `const [taskViewOpen, setTaskViewOpen] = useState(false)`, line 81):

```ts
  const [reviewOpen, setReviewOpen] = useState(false)
```

Add the `runCommand` case (after `case 'task-view':` block, around line 185-187):

```ts
        case 'review':
          if (workspacePath) setReviewOpen(true)
          break
```

Render the modal (after `{taskViewOpen && <TaskView onClose={() => setTaskViewOpen(false)} />}`, line 265):

```tsx
      {reviewOpen && <ReviewSession onClose={() => setReviewOpen(false)} />}
```

Wire `HomeView`'s new prop (line 328):

```tsx
              <HomeView
                onOpenTaskView={() => setTaskViewOpen(true)}
                onOpenReview={() => setReviewOpen(true)}
              />
```

- [ ] **Step 2: Add the shortcuts-overlay row**

Edit `src/components/ShortcutsOverlay.tsx`, add after `{ keys: 'Ctrl Shift K', label: 'Tasks' },` (line 18):

```ts
  { keys: 'Ctrl Shift R', label: 'Review' },
```

- [ ] **Step 3: Typecheck and run the full frontend suite**

Run: `npm run typecheck && npm test`
Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/Layout.tsx src/components/ShortcutsOverlay.tsx
git commit -m "feat(p9-3): wire the review session into Layout, Ctrl Shift R, and shortcuts"
```

---

## Task 14: End-to-end verification

**Files:**
- Create: `e2e/specs/p9-3-spaced-repetition.e2e.ts`

**Interfaces:**
- Consumes: the fully wired app from Tasks 1-13.
- Produces: a passing e2e spec, run per `.claude/skills/e2e-verify/`.

- [ ] **Step 1: Write the spec**

This mirrors `e2e/specs/p9-1-task-view.e2e.ts`'s helpers exactly (`clickButtonByText`, `focusEditorEnd`, `createNote`, the `__e2eRunCommand` hook) — read that file first if any of these conventions have since changed. Create `e2e/specs/p9-3-spaced-repetition.e2e.ts`:

```ts
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { browser, expect } from '@wdio/globals'
import { fixtureWorkspace } from '../fixtureWorkspace.js'
import { screenshot } from '../screenshot.js'

async function clickButtonByText(selector: string, text: string): Promise<void> {
  await browser.execute(
    (sel, t) => {
      const btn = Array.from(document.querySelectorAll(sel)).find((el) => el.textContent?.includes(t))
      if (!(btn instanceof HTMLElement)) throw new Error(`no ${sel} with text "${t}"`)
      btn.click()
    },
    selector,
    text,
  )
}

async function focusEditorEnd(): Promise<void> {
  await browser.execute(() => {
    const el = document.querySelector('.ProseMirror')
    if (!(el instanceof HTMLElement)) throw new Error('no element matching .ProseMirror')
    el.focus()
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
  })
}

async function createNote(title: string): Promise<string> {
  const notePath = join(fixtureWorkspace, `${title}.md`)
  rmSync(notePath, { force: true })

  await clickButtonByText('.sidebar-new-actions button', 'New Note')
  await browser.waitUntil(
    async () => {
      try {
        await browser.getAlertText()
        return true
      } catch {
        return false
      }
    },
    { timeout: 5000, timeoutMsg: 'the note-title prompt() never appeared' },
  )
  await browser.sendAlertText(title)
  await browser.acceptAlert()
  await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.ProseMirror')), {
    timeout: 5000,
    timeoutMsg: 'editor never mounted for the new note',
  })
  return notePath
}

// WebDriver automates the WebView, not the native menu bar — `review` (like
// `task-view`) is a menu-only action per the P6-6 postmortem's precedent.
async function runCommand(id: string): Promise<void> {
  await browser.execute((cmd) => {
    const fn = (window as unknown as { __e2eRunCommand?: (id: string) => void }).__e2eRunCommand
    if (!fn) throw new Error('__e2eRunCommand hook missing')
    fn(cmd)
  }, id)
}

async function openReview(): Promise<void> {
  await runCommand('review')
  await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.review-session')), {
    timeout: 5000,
    timeoutMsg: 'review session never rendered',
  })
}

function reviewFrontText() {
  return browser.execute(() => document.querySelector('.review-card-front')?.textContent ?? null)
}

async function gradeCurrentCard(label: string): Promise<void> {
  await clickButtonByText('.review-card-reveal', 'Reveal answer')
  await clickButtonByText('.review-card-grade', label)
}

describe('P9-3: spaced repetition', () => {
  it('reviews a Q::A and a cloze card, writing schedule state back to disk', async () => {
    const notePath = await createNote('P9-3 Review')
    await focusEditorEnd()
    await browser.keys(['Enter'])
    await browser.keys('What is Big-O of binary search? :: O(log n)')
    await browser.keys(['Enter'])
    await browser.keys('A binary search tree keeps {{all left descendants smaller}} than the node.')

    await browser.waitUntil(
      () =>
        existsSync(notePath) &&
        readFileSync(notePath, 'utf-8').includes('What is Big-O of binary search? :: O(log n)') &&
        readFileSync(notePath, 'utf-8').includes('{{all left descendants smaller}}'),
      { timeout: 10000, interval: 300, timeoutMsg: `${notePath} never contained both cards` },
    )
    // Reindex debounce (2500ms, REINDEX_DEBOUNCE_MS) so both cards land in
    // review_cards before the review session queries for them.
    await browser.pause(4000)

    await openReview()
    await browser.waitUntil(async () => (await reviewFrontText())?.includes('Big-O') ?? false, {
      timeout: 5000,
      timeoutMsg: 'review session never showed the Q::A card first',
    })
    await screenshot('p9-3-review-front')

    await gradeCurrentCard('Good')
    await browser.waitUntil(async () => (await reviewFrontText())?.includes('descendants') ?? false, {
      timeout: 5000,
      timeoutMsg: 'review session never advanced to the cloze card',
    })
    await screenshot('p9-3-review-revealed')

    await gradeCurrentCard('Good')
    await browser.waitUntil(
      async () =>
        browser.execute(() => document.querySelector('.empty-state')?.textContent?.includes('All done') ?? false),
      { timeout: 5000, timeoutMsg: 'review session never showed "All done for today"' },
    )

    await browser.waitUntil(
      () => (readFileSync(notePath, 'utf-8').match(/<!-- sr due=/g) ?? []).length === 2,
      { timeout: 10000, interval: 300, timeoutMsg: `${notePath} never got two schedule comments written back` },
    )
    const content = readFileSync(notePath, 'utf-8')
    expect(content).toMatch(
      /What is Big-O of binary search\? :: O\(log n\)\n<!-- sr due=\d{4}-\d{2}-\d{2} ease=2\.50 interval=1 reps=1 -->/,
    )
  })

  it("drops a graded card from Home's Study count", async () => {
    // Continues from the previous test: both cards were just graded Good
    // with a 1-day interval, so neither is due again today.
    await runCommand('home')
    await browser.waitUntil(
      async () => browser.execute(() => document.querySelector('.home-section h2')?.textContent === 'Continue'),
      { timeout: 5000, timeoutMsg: 'home view never rendered' },
    )
    const studyText = await browser.execute(() => {
      const sections = Array.from(document.querySelectorAll('.home-section'))
      const study = sections.find((s) => s.querySelector('h2')?.textContent === 'Study')
      return study?.textContent ?? null
    })
    expect(studyText).toContain('Nothing due.')
  })
})
```

- [ ] **Step 2: Run the spec**

Run: `npm run test:e2e -- --spec e2e/specs/p9-3-spaced-repetition.e2e.ts`
Expected: PASS. Debug against the real compiled app if not — this is the authoritative check that the `SrState` round-trip fix, `grade_card` write-back, and Home wiring all work together outside of mocks. If any selector or helper has drifted from what `p9-1-task-view.e2e.ts` now actually uses, update this spec to match the current convention rather than fighting it.

- [ ] **Step 3: Commit**

```bash
git add e2e/specs/p9-3-spaced-repetition.e2e.ts
git commit -m "test(p9-3): add spaced repetition e2e coverage"
```

---

## Task 15: Update the roadmap

**Files:**
- Modify: `docs/ROADMAP.md`
- Modify: `TODO.md`

**Interfaces:**
- None — documentation only.

- [ ] **Step 1: Mark P9-3 done in ROADMAP.md**

Edit `docs/ROADMAP.md`'s P9-3 section (around line 868-889): change the heading from `### P9-3 — Spaced repetition: **decision fork first** — **decision, then L**` to `### P9-3 — Spaced repetition: **decision fork first** — **decision, then L** ✅`, and add a `*Done: ...*` paragraph after the existing DoD bullet, in the file's established style (see P9-1/P9-2's own `*Done: ...*` paragraphs for the expected voice and level of technical detail), summarizing: the inline-comment storage decision as implemented, the verified-and-fixed editor round-trip risk, the SM-2 formula shipped, and that Home's Study section is now live. Update the phase-3 status table (around line 174-188) if P9's row is still blank, and add a dated entry at the top of the file (mirroring the existing entries' style) noting P9-3's completion and that M9 is now reached (P9-1, P9-2, P9-3, P9-4 are all done).

- [ ] **Step 2: Update TODO.md**

Edit `TODO.md`'s P9 section (search for `P9-3`): check the P9-3 box and update the "Now" line at the top (line 7) to reflect P9-3 closing M9, following the same strikethrough convention used for every prior completed phase in that line.

- [ ] **Step 3: Commit**

```bash
git add docs/ROADMAP.md TODO.md
git commit -m "docs(p9-3): mark spaced repetition done, closing M9"
```

---

## Self-Review Notes

- **Spec coverage:** storage decision (Tasks 1-5, 9), card syntax (Task 2), the verified round-trip risk and its fix (Task 9), SM-2 formula (Task 1), schema/commands (Tasks 3, 5, 6), frontend rendering (Tasks 9, 10), review session UI (Task 11), entry points (Tasks 12, 13), testing (all tasks + Task 14), out-of-scope items (theorem-block auto-cards, per-cloze sub-cards, frontmatter, configurable scheduling) are deliberately absent from every task — confirmed no task reintroduces them.
- **Type consistency check:** `sm2::Grade`/`Grade` (frontend `'again'|'hard'|'good'|'easy'`) used identically in Tasks 1, 5, 7, 11; `ExtractedCard`/`CardKind` (Task 2) match their use in Tasks 3-4; `DueCard` (Task 3) matches its use in Tasks 5, 7, 11-12; `grade_card_line`'s signature (Task 5) matches `toggle_task_line`'s established shape; `SrState`'s `data-*` attribute names match between `renderHTML` and `parseHTML`/`updateDOM` (Task 9).

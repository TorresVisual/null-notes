# Cram Mode Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Let a user pick a streak-based category of flashcards and drill all of them, shuffled, regardless of due date — without touching the existing due-queue scheduling logic.

**Architecture:** A new `streak` counter (`Grade` → `i64`) is added alongside the existing `ease`/`interval`/`reps`/`grade` fields on every card: parsed from and written to the card's `<!-- sr ... -->` comment, stored in a new `review_cards.streak` column, and surfaced through the existing `list_all_cards`/`list_due_cards` data path plus one new read path (`list_cards_by_category` → `list_cram_cards`). The frontend adds a category-chips row to `DeckView`, a `mode` prop to `ReviewSession` that swaps the fetch source and shuffles the result, and a small piece of `Layout.tsx` state (`pendingCramStreak`) that carries the chosen category from the chip click through to the review overlay — mirroring the existing `pendingFlashcardInsert` pattern exactly. No new Tauri command is added for grading; cram sessions grade through the exact same `grade_card`/`grade_mc_card` commands as a normal review.

**Tech Stack:** Rust (Tauri commands, sqlx/SQLite), React 19 + TypeScript, Vitest, WebdriverIO e2e.

**Spec:** `docs/specs/cram-mode-design.md`

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

- No `.unwrap()`/`.expect()` outside Rust tests; propagate with `?`.
- `cargo clippy -- -D warnings` and `cargo fmt --check` must pass before any Rust task is considered done.
- TypeScript strict mode: no `any`, no unnecessary non-null assertions.
- `streak` is additive-only: no cap, no "mastered" ceiling (explicitly out of scope per spec).
- Cram grading reuses `grade_card`/`grade_mc_card` verbatim — no new grading command.
- Category-level cram only; no per-card cram picker (out of scope per spec).

---

## Task 1: `next_streak` pure function

**Files:**
- Modify: `src-tauri/src/sm2.rs`

**Interfaces:**
- Produces: `pub fn next_streak(streak: i64, grade: Grade) -> i64` — consumed by Task 3's `grade_card_line`.

- [ ] **Step 1: Write the failing tests**

Add to `mod tests` in `src-tauri/src/sm2.rs`, right after `test_grade_as_str_round_trips_the_serde_names`:

```rust
    #[test]
    fn test_next_streak_again_resets_an_established_streak_to_zero() {
        assert_eq!(next_streak(3, Grade::Again), 0);
    }

    #[test]
    fn test_next_streak_again_on_a_new_card_stays_zero() {
        assert_eq!(next_streak(0, Grade::Again), 0);
    }

    #[test]
    fn test_next_streak_hard_leaves_an_established_streak_unchanged() {
        assert_eq!(next_streak(3, Grade::Hard), 3);
    }

    #[test]
    fn test_next_streak_hard_on_a_new_card_stays_zero() {
        assert_eq!(next_streak(0, Grade::Hard), 0);
    }

    #[test]
    fn test_next_streak_good_increments() {
        assert_eq!(next_streak(0, Grade::Good), 1);
        assert_eq!(next_streak(3, Grade::Good), 4);
    }

    #[test]
    fn test_next_streak_easy_increments() {
        assert_eq!(next_streak(0, Grade::Easy), 1);
        assert_eq!(next_streak(3, Grade::Easy), 4);
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml next_streak`
Expected: compile error, `cannot find function next_streak in this scope`.

- [ ] **Step 3: Implement `next_streak`**

Add to `src-tauri/src/sm2.rs`, directly below `next_state` (after line 119):

```rust
/// `reps` counts every non-`Again` grade, `Hard` included — `streak` is
/// stricter: only a clean `Good`/`Easy` promotes it, `Hard` holds it in
/// place, and `Again` always zeroes it. This is the grouping key cram mode
/// drills by, so it has to reflect "answered cleanly N times in a row," not
/// "reviewed N times."
pub fn next_streak(streak: i64, grade: Grade) -> i64 {
    match grade {
        Grade::Again => 0,
        Grade::Hard => streak,
        Grade::Good | Grade::Easy => streak + 1,
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml next_streak`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/sm2.rs
git commit -m "feat: add next_streak, the pure streak transition for cram mode"
```

---

## Task 2: `streak` column on `review_cards`

**Files:**
- Modify: `src-tauri/src/db/schema.rs`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: a `review_cards.streak INTEGER` column (nullable), which Task 4's `set_cards`/`due_cards`/`list_all_cards` bind against.

- [ ] **Step 1: Write the failing test**

Modify `test_run_migrations_adds_options_and_grade_columns` in `src-tauri/src/db/schema.rs` (lines 124-139) to also insert into the new column:

```rust
    #[tokio::test]
    async fn test_run_migrations_adds_options_and_grade_and_streak_columns() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        run_migrations(&pool).await.unwrap();

        // A row insert naming all three added columns is the simplest proof
        // they exist and accept NULL — sqlx has no schema-introspection
        // helper exposed here, and this exercises exactly what set_cards
        // will do.
        sqlx::query(
            "INSERT INTO review_cards (note_path, kind, front, back, position, due, ease, interval, reps, options, grade, streak)
             VALUES ('/a.md', 'mc', 'Q', '', 0, '2026-01-01', 2.5, 0, 0, NULL, NULL, NULL)",
        )
        .execute(&pool)
        .await
        .unwrap();
    }
```

(Renamed from `test_run_migrations_adds_options_and_grade_columns` to keep the name honest about what it now covers.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml test_run_migrations_adds_options_and_grade_and_streak_columns`
Expected: FAIL — `no such column: streak` (or `12 values for 11 columns`, depending on sqlx's error surface).

- [ ] **Step 3: Add the migration**

In `src-tauri/src/db/schema.rs`, right after line 115 (`add_column_if_missing(pool, "ALTER TABLE review_cards ADD COLUMN grade TEXT").await?;`):

```rust
    // Second column addition. `streak` counts consecutive clean (Good/Easy)
    // grades — see sm2::next_streak — and is the grouping key cram mode
    // drills by. NULL for a never-graded card, same posture as grade.
    add_column_if_missing(pool, "ALTER TABLE review_cards ADD COLUMN streak INTEGER").await?;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib db::schema`
Expected: both `test_run_migrations_adds_options_and_grade_and_streak_columns` and `test_run_migrations_is_idempotent_against_an_already_migrated_db` pass (the idempotency test re-runs `run_migrations` and must not choke on `streak` already existing either).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db/schema.rs
git commit -m "feat: add review_cards.streak column"
```

---

## Task 3: Thread `streak` through the `<!-- sr ... -->` comment

**Files:**
- Modify: `src-tauri/src/commands/notes.rs`

**Interfaces:**
- Consumes: `sm2::next_streak(streak: i64, grade: Grade) -> i64` (Task 1).
- Produces: `parse_sr_comment(line: &str) -> Option<(String, f64, i64, i64, Option<Grade>, Option<i64>)>` (streak is the new 6th element) — consumed by Task 4's `extract_cards`.

- [ ] **Step 1: Write the failing tests**

In `src-tauri/src/commands/notes.rs`'s `mod tests`, update the two exact-match round-trip tests (lines 2062-2079) — they now need a trailing `streak=1` (both start from an absent/no-streak comment, so `next_streak(0, Good) == 1`):

```rust
    #[test]
    fn test_grade_card_line_inserts_a_new_schedule_comment() {
        let result = grade_card_line("Q :: A\n", 0, sm2::Grade::Good, grade_today()).unwrap();
        assert_eq!(
            result,
            "Q :: A\n<!-- sr due=2026-08-21 ease=2.50 interval=1 reps=1 grade=good streak=1 -->\n"
        );
    }

    #[test]
    fn test_grade_card_line_replaces_an_existing_schedule_comment() {
        let content = "Q :: A\n<!-- sr due=2026-08-20 ease=2.50 interval=6 reps=2 -->\n";
        let result = grade_card_line(content, 0, sm2::Grade::Good, grade_today()).unwrap();
        assert_eq!(
            result,
            "Q :: A\n<!-- sr due=2026-09-04 ease=2.50 interval=15 reps=3 grade=good streak=1 -->\n"
        );
    }
```

Then add new tests directly after `test_grade_card_line_again_resets_progress` (line ~2086):

```rust
    #[test]
    fn test_grade_card_line_streak_increments_on_consecutive_good_grades() {
        let content = "Q :: A\n<!-- sr due=2026-08-20 ease=2.50 interval=6 reps=2 grade=good streak=2 -->\n";
        let result = grade_card_line(content, 0, sm2::Grade::Good, grade_today()).unwrap();
        assert!(result.contains("streak=3"));
    }

    #[test]
    fn test_grade_card_line_streak_resets_to_zero_on_again() {
        let content = "Q :: A\n<!-- sr due=2026-08-20 ease=2.50 interval=6 reps=2 grade=good streak=3 -->\n";
        let result = grade_card_line(content, 0, sm2::Grade::Again, grade_today()).unwrap();
        assert!(result.contains("streak=0"));
    }

    #[test]
    fn test_grade_card_line_streak_unchanged_on_hard() {
        let content = "Q :: A\n<!-- sr due=2026-08-20 ease=2.50 interval=6 reps=2 grade=good streak=2 -->\n";
        let result = grade_card_line(content, 0, sm2::Grade::Hard, grade_today()).unwrap();
        assert!(result.contains("streak=2"));
    }

    #[test]
    fn test_grade_card_line_old_format_comment_with_no_streak_field_defaults_to_zero() {
        // Graded before this field existed — no `streak=` at all, not even
        // `streak=0`. Must default the same way a never-graded card does.
        let content = "Q :: A\n<!-- sr due=2026-08-20 ease=2.50 interval=1 reps=1 grade=good -->\n";
        let result = grade_card_line(content, 0, sm2::Grade::Good, grade_today()).unwrap();
        assert!(result.contains("streak=1"));
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib commands::notes`
Expected: compile passes (nothing references `streak=` yet on the production side, so these are runtime assertion failures) — FAIL, e.g. `assertion failed: result.contains("streak=3")` and the two exact-match tests fail on the missing ` streak=1` suffix.

- [ ] **Step 3: Implement**

Update `parse_sr_comment` (`src-tauri/src/commands/notes.rs:254-274`):

```rust
fn parse_sr_comment(
    line: &str,
) -> Option<(String, f64, i64, i64, Option<sm2::Grade>, Option<i64>)> {
    let re = match Regex::new(
        r"^<!--\s+sr\s+due=(\S+)\s+ease=(\S+)\s+interval=(\S+)\s+reps=(\S+)(?:\s+grade=(\S+))?(?:\s+streak=(\S+))?\s+-->$",
    ) {
        Ok(re) => re,
        Err(_) => return None,
    };
    let caps = re.captures(line.trim())?;
    let due = caps[1].to_string();
    let ease = caps[2].parse::<f64>().ok()?;
    let interval = caps[3].parse::<i64>().ok()?;
    let reps = caps[4].parse::<i64>().ok()?;
    let grade = caps.get(5).and_then(|m| match m.as_str() {
        "again" => Some(sm2::Grade::Again),
        "hard" => Some(sm2::Grade::Hard),
        "good" => Some(sm2::Grade::Good),
        "easy" => Some(sm2::Grade::Easy),
        _ => None,
    });
    let streak = caps.get(6).and_then(|m| m.as_str().parse::<i64>().ok());
    Some((due, ease, interval, reps, grade, streak))
}
```

Update `extract_cards`'s two call sites (`src-tauri/src/commands/notes.rs:464-468` and `:496-500`) — streak isn't wired into `ExtractedCard` until Task 4, so capture and discard it here to keep this task's diff self-contained and compiling:

```rust
                let (due, ease, interval, reps, grade, _streak) = lines
                    .get(comment_idx)
                    .and_then(|l| parse_sr_comment(l))
                    .map(|(d, e, iv, r, g, s)| (Some(d), Some(e), Some(iv), Some(r), g, s))
                    .unwrap_or((None, None, None, None, None, None));
```

(apply the same `_streak` / 6-tuple change to the second site at line ~496-500 — identical shape, different surrounding variable names already in place).

Update `grade_card_line` (`src-tauri/src/commands/notes.rs:821-878`):

```rust
    let (current, current_streak) = lines
        .get(comment_idx)
        .and_then(|l| parse_sr_comment(l))
        .map(|(_, ease, interval, reps, _, streak)| {
            (
                sm2::CardState {
                    ease,
                    interval,
                    reps,
                },
                streak.unwrap_or(0),
            )
        })
        .unwrap_or((sm2::CardState::default(), 0));

    let next = sm2::next_state(current, grade, today);
    let next_streak = sm2::next_streak(current_streak, grade);
    let comment = format!(
        "<!-- sr due={} ease={:.2} interval={} reps={} grade={} streak={} -->",
        next.due,
        next.ease,
        next.interval,
        next.reps,
        grade.as_str(),
        next_streak
    );
```

Update `grade_mc_card_at`'s `parse_sr_comment` call (`src-tauri/src/commands/notes.rs:941-944`) — it only needs `grade`, so add one more ignored element:

```rust
    let last_grade = lines
        .get(idx + 1 + option_count)
        .and_then(|l| parse_sr_comment(l))
        .and_then(|(_, _, _, _, grade, _)| grade);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib commands::notes`
Expected: all pass, including the pre-existing round-trip tests.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/notes.rs
git commit -m "feat: parse and write streak= on the sr schedule comment"
```

---

## Task 4: `ExtractedCard`/`DueCard`/`CardSummary` gain `streak`; thread through `set_cards`/`due_cards`/`list_all_cards`

**Files:**
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/commands/notes.rs` (`extract_cards`)
- Modify: `src-tauri/src/db/notes.rs` (`set_cards`, `due_cards`, `list_all_cards`, test fixtures)

**Interfaces:**
- Consumes: `parse_sr_comment`'s 6-tuple (Task 3).
- Produces: `ExtractedCard.streak: Option<i64>`, `DueCard.streak: i64`, `CardSummary.streak: i64` — consumed by Task 5's `list_cards_by_category` and Task 6's frontend types.

- [ ] **Step 1: Write the failing test**

Add to `src-tauri/src/db/notes.rs`'s `mod tests`, directly after `test_due_cards_qa_card_has_empty_options` (~line 1549):

```rust
    #[tokio::test]
    async fn test_set_cards_defaults_streak_to_zero_when_absent_and_persists_a_given_value() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "A", "/ws/a.md", "/ws"))
            .await
            .unwrap();
        let mut with_streak = card(CardKind::Qa, "Q1", "A1", 0);
        with_streak.streak = Some(3);
        let mut without_streak = card(CardKind::Qa, "Q2", "A2", 1);
        without_streak.streak = None;
        set_cards(&pool, "/ws/a.md", &[with_streak, without_streak])
            .await
            .unwrap();

        let all = list_all_cards(&pool, "/ws").await.unwrap();
        let q1 = all.iter().find(|c| c.front == "Q1").unwrap();
        let q2 = all.iter().find(|c| c.front == "Q2").unwrap();
        assert_eq!(q1.streak, 3);
        assert_eq!(q2.streak, 0);
    }

    #[tokio::test]
    async fn test_due_cards_includes_streak() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "A", "/ws/a.md", "/ws"))
            .await
            .unwrap();
        let mut c = card(CardKind::Qa, "Q1", "A1", 0);
        c.streak = Some(2);
        set_cards(&pool, "/ws/a.md", &[c]).await.unwrap();

        let due = due_cards(&pool, "/ws", &sm2::today()).await.unwrap();
        assert_eq!(due[0].streak, 2);
    }
```

This won't compile yet — `card()` doesn't set `streak` and `ExtractedCard`/`DueCard`/`CardSummary` don't have the field. That's expected for this step.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: FAIL to compile — `no field streak on type ExtractedCard` (and similar for `DueCard`/`CardSummary` once referenced).

- [ ] **Step 3: Implement**

`src-tauri/src/models.rs` — add `streak` to all three structs (after `grade` on `ExtractedCard`, after `options`/`interval` respectively on the other two, matching each struct's existing field order style):

```rust
pub struct ExtractedCard {
    pub kind: CardKind,
    pub front: String,
    pub back: String,
    pub position: i64,
    pub due: Option<String>,
    pub ease: Option<f64>,
    pub interval: Option<i64>,
    pub reps: Option<i64>,
    pub grade: Option<sm2::Grade>,
    pub streak: Option<i64>,
    pub options: Vec<String>,
    pub correct: Vec<usize>,
}
```

```rust
pub struct DueCard {
    pub note_path: String,
    pub note_title: String,
    pub kind: String,
    pub front: String,
    pub back: String,
    pub position: i64,
    pub options: Vec<String>,
    pub streak: i64,
}
```

```rust
pub struct CardSummary {
    pub note_path: String,
    pub note_title: String,
    pub kind: String,
    pub front: String,
    pub back: String,
    pub position: i64,
    pub due: String,
    pub interval: i64,
    pub streak: i64,
    pub tags: Vec<String>,
}
```

`src-tauri/src/commands/notes.rs`'s `extract_cards` — change both destructures from `_streak` to `streak` and thread it into the two `ExtractedCard { ... }` literals:

```rust
                let (due, ease, interval, reps, grade, streak) = lines
                    .get(comment_idx)
                    .and_then(|l| parse_sr_comment(l))
                    .map(|(d, e, iv, r, g, s)| (Some(d), Some(e), Some(iv), Some(r), g, s))
                    .unwrap_or((None, None, None, None, None, None));
                cards.push(ExtractedCard {
                    kind: CardKind::Mc,
                    front,
                    back: String::new(),
                    position: i as i64,
                    due,
                    ease,
                    interval,
                    reps,
                    grade,
                    streak,
                    options,
                    correct,
                });
```

(same `streak,` addition to the second `cards.push(ExtractedCard { ... })` at line ~502).

`src-tauri/src/db/notes.rs`:

`set_cards` (lines 311-351) — bind streak, defaulting like `ease`/`interval`/`reps` do:

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
            CardKind::Mc => "mc",
        };
        let due = card.due.clone().unwrap_or_else(sm2::today);
        let ease = card.ease.unwrap_or(2.5);
        let interval = card.interval.unwrap_or(0);
        let reps = card.reps.unwrap_or(0);
        let grade = card.grade.map(sm2::Grade::as_str);
        let streak = card.streak.unwrap_or(0);
        let options = if card.options.is_empty() {
            None
        } else {
            Some(serde_json::to_string(&card.options)?)
        };
        sqlx::query(
            "INSERT INTO review_cards (note_path, kind, front, back, position, due, ease, interval, reps, options, grade, streak)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
        .bind(options)
        .bind(grade)
        .bind(streak)
        .execute(pool)
        .await?;
    }
    Ok(())
}
```

`due_cards` (lines 353-394) — add `streak` to the row struct, SELECT, and mapping:

```rust
#[derive(sqlx::FromRow)]
struct DueCardRow {
    note_path: String,
    note_title: String,
    kind: String,
    front: String,
    back: String,
    position: i64,
    options: Option<String>,
    streak: i64,
}

pub async fn due_cards(pool: &SqlitePool, workspace: &str, today: &str) -> Result<Vec<DueCard>> {
    let rows = sqlx::query_as::<_, DueCardRow>(
        "SELECT rc.note_path, n.title as note_title, rc.kind, rc.front, rc.back, rc.position, rc.options, rc.streak
         FROM review_cards rc
         JOIN notes n ON n.path = rc.note_path
         WHERE n.workspace = ? AND rc.due <= ?
         ORDER BY rc.due, n.title COLLATE NOCASE, rc.position",
    )
    .bind(workspace)
    .bind(today)
    .fetch_all(pool)
    .await?;

    let mut cards = Vec::with_capacity(rows.len());
    for r in rows {
        let options = match r.options {
            Some(json) => serde_json::from_str(&json)?,
            None => Vec::new(),
        };
        cards.push(DueCard {
            note_path: r.note_path,
            note_title: r.note_title,
            kind: r.kind,
            front: r.front,
            back: r.back,
            position: r.position,
            options,
            streak: r.streak,
        });
    }
    Ok(cards)
}
```

`list_all_cards` (lines 396-442) — same pattern:

```rust
#[derive(sqlx::FromRow)]
struct CardSummaryRow {
    note_path: String,
    note_title: String,
    kind: String,
    front: String,
    back: String,
    position: i64,
    due: String,
    interval: i64,
    streak: i64,
    tags: Option<String>,
}

pub async fn list_all_cards(pool: &SqlitePool, workspace: &str) -> Result<Vec<CardSummary>> {
    let rows = sqlx::query_as::<_, CardSummaryRow>(
        "SELECT rc.note_path, n.title as note_title, rc.kind, rc.front, rc.back,
                rc.position, rc.due, rc.interval, rc.streak,
                GROUP_CONCAT(DISTINCT nt.tag) as tags
         FROM review_cards rc
         JOIN notes n ON n.path = rc.note_path
         LEFT JOIN note_tags nt ON nt.note_path = rc.note_path
         WHERE n.workspace = ?
         GROUP BY rc.note_path, rc.position
         ORDER BY n.title COLLATE NOCASE, rc.position",
    )
    .bind(workspace)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| CardSummary {
            note_path: r.note_path,
            note_title: r.note_title,
            kind: r.kind,
            front: r.front,
            back: r.back,
            position: r.position,
            due: r.due,
            interval: r.interval,
            streak: r.streak,
            tags: r
                .tags
                .map(|t| t.split(',').map(String::from).collect())
                .unwrap_or_default(),
        })
        .collect())
}
```

Fix the now-broken struct literals in `src-tauri/src/db/notes.rs`'s test module — add `streak: None,` to the `card()` helper (line ~1327-1341) and to the three inline `ExtractedCard { ... }` literals (lines ~1496, ~1532, ~1569), e.g.:

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
            grade: None,
            streak: None,
            options: Vec::new(),
            correct: Vec::new(),
        }
    }
```

(add the same `streak: None,` line to each of the three inline literals at ~1496, ~1532, ~1569 — they follow the identical field order).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib db::notes`
Expected: all pass, including the two new tests and every pre-existing `due_cards`/`list_all_cards`/`set_cards` test.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/models.rs src-tauri/src/commands/notes.rs src-tauri/src/db/notes.rs
git commit -m "feat: thread streak through ExtractedCard, DueCard, and CardSummary"
```

---

## Task 5: `list_cards_by_category` + `list_cram_cards` command

**Files:**
- Modify: `src-tauri/src/db/notes.rs`
- Modify: `src-tauri/src/commands/notes.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `DueCard` (Task 4).
- Produces: `list_cram_cards(workspace: String, streak: i64) -> Result<Vec<DueCard>, String>` Tauri command — consumed by Task 6's frontend `api.notes.listCramCards`.

- [ ] **Step 1: Write the failing test**

Add to `src-tauri/src/db/notes.rs`'s `mod tests`, directly after the new `test_due_cards_includes_streak` from Task 4:

```rust
    #[tokio::test]
    async fn test_list_cards_by_category_filters_by_streak_and_excludes_others() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "A", "/ws/a.md", "/ws"))
            .await
            .unwrap();

        let mut streak_two = card(CardKind::Qa, "in category", "back", 0);
        streak_two.streak = Some(2);
        streak_two.due = Some("2099-01-01".to_string()); // far future — proves due-date is ignored
        let mut streak_zero = card(CardKind::Qa, "not in category", "back", 1);
        streak_zero.streak = Some(0);
        set_cards(&pool, "/ws/a.md", &[streak_two, streak_zero])
            .await
            .unwrap();

        let category = list_cards_by_category(&pool, "/ws", 2).await.unwrap();
        assert_eq!(category.len(), 1);
        assert_eq!(category[0].front, "in category");
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: FAIL to compile — `cannot find function list_cards_by_category`.

- [ ] **Step 3: Implement**

Add to `src-tauri/src/db/notes.rs`, directly after `due_cards` (after line 394) — same shape, filtered on `streak` instead of `due`, no `ORDER BY due` since the frontend shuffles:

```rust
pub async fn list_cards_by_category(
    pool: &SqlitePool,
    workspace: &str,
    streak: i64,
) -> Result<Vec<DueCard>> {
    let rows = sqlx::query_as::<_, DueCardRow>(
        "SELECT rc.note_path, n.title as note_title, rc.kind, rc.front, rc.back, rc.position, rc.options, rc.streak
         FROM review_cards rc
         JOIN notes n ON n.path = rc.note_path
         WHERE n.workspace = ? AND rc.streak = ?
         ORDER BY n.title COLLATE NOCASE, rc.position",
    )
    .bind(workspace)
    .bind(streak)
    .fetch_all(pool)
    .await?;

    let mut cards = Vec::with_capacity(rows.len());
    for r in rows {
        let options = match r.options {
            Some(json) => serde_json::from_str(&json)?,
            None => Vec::new(),
        };
        cards.push(DueCard {
            note_path: r.note_path,
            note_title: r.note_title,
            kind: r.kind,
            front: r.front,
            back: r.back,
            position: r.position,
            options,
            streak: r.streak,
        });
    }
    Ok(cards)
}
```

Add the Tauri command to `src-tauri/src/commands/notes.rs`, directly after `list_all_cards` (after line 1186):

```rust
#[tauri::command]
pub async fn list_cram_cards(
    workspace: String,
    streak: i64,
    db: State<'_, DbPool>,
) -> Result<Vec<DueCard>, String> {
    db::notes::list_cards_by_category(&db, &workspace, streak)
        .await
        .map_err(|e| e.to_string())
}
```

Register it in `src-tauri/src/lib.rs`, directly after `commands::notes::list_all_cards,` (line 246):

```rust
            commands::notes::list_cram_cards,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib db::notes`
Expected: pass, including `test_list_cards_by_category_filters_by_streak_and_excludes_others`.

Also run: `cargo build --manifest-path src-tauri/Cargo.toml && cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings && cargo fmt --manifest-path src-tauri/Cargo.toml --check`
Expected: all pass (this closes out the Rust side of the feature — run the full suite once here).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db/notes.rs src-tauri/src/commands/notes.rs src-tauri/src/lib.rs
git commit -m "feat: add list_cards_by_category and the list_cram_cards command"
```

---

## Task 6: Frontend types and API wrapper

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/lib/tauri.ts`

**Interfaces:**
- Consumes: `list_cram_cards(workspace, streak) -> DueCard[]` (Task 5, over Tauri IPC).
- Produces: `DueCard.streak: number`, `CardSummary.streak: number`, `api.notes.listCramCards(workspace: string, streak: number) -> Promise<DueCard[]>` — consumed by Task 7 (`DeckView`) and Task 8 (`ReviewSession`).

- [ ] **Step 1: Update the types**

In `src/types/index.ts`, add `streak: number` to both interfaces (lines 151-159 and 165-175):

```ts
export interface DueCard {
  notePath: string
  noteTitle: string
  kind: string
  front: string
  back: string
  position: number
  options: string[]
  streak: number
}
```

```ts
export interface CardSummary {
  notePath: string
  noteTitle: string
  kind: string
  front: string
  back: string
  position: number
  due: string
  interval: number
  streak: number
  tags: string[]
}
```

- [ ] **Step 2: Add the API wrapper**

In `src/lib/tauri.ts`, directly after `listAllCards` (line 73):

```ts
    listCramCards: (workspace: string, streak: number) =>
      invoke<DueCard[]>('list_cram_cards', { workspace, streak }),
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run typecheck`
Expected: FAIL — `DeckView.test.tsx`/`ReviewSession.test.tsx` fixtures are missing the now-required `streak` field on `DueCard`/`CardSummary` object literals, so this surfaces every call site Task 7/8 need to touch. (No production code references `streak` on these types yet, so production files still typecheck; only the two test fixture files fail.)

This step is diagnostic, not a gate to fix here — Tasks 7 and 8 fix these fixtures as part of their own test-writing steps.

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts src/lib/tauri.ts
git commit -m "feat: add streak to DueCard/CardSummary types and the listCramCards wrapper"
```

---

## Task 7: `DeckView` category chips

**Files:**
- Modify: `src/components/DeckView.tsx`
- Modify: `src/components/DeckView.test.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: `CardSummary.streak: number` (Task 6).
- Produces: `DeckViewProps.onOpenCram: (streak: number) => void` — consumed by Task 9 (`Layout.tsx`).

- [ ] **Step 1: Write the failing tests**

Update the `cards` fixture in `src/components/DeckView.test.tsx` (lines 12-35) to include `streak`, and add category-chip assertions:

```tsx
const cards: CardSummary[] = [
  {
    notePath: '/ws/a.md',
    noteTitle: 'A',
    kind: 'qa',
    front: 'Q1',
    back: 'A1',
    position: 0,
    due: '2026-01-01',
    interval: 0,
    streak: 0,
    tags: ['cs'],
  },
  {
    notePath: '/ws/b.md',
    noteTitle: 'B',
    kind: 'mc',
    front: 'Q2',
    back: '',
    position: 0,
    due: '2026-01-01',
    interval: 25,
    streak: 2,
    tags: ['algo'],
  },
]
```

Update every `render(<DeckView onClose={vi.fn()} />)` call in the file to pass the new required prop: `render(<DeckView onClose={vi.fn()} onOpenCram={vi.fn()} />)`.

Add a new `describe` block at the end of the file:

```tsx
describe('DeckView — cram categories', () => {
  it('shows one chip per streak value with correct counts, labeling streak 0 as New', async () => {
    render(<DeckView onClose={vi.fn()} onOpenCram={vi.fn()} />)
    await waitFor(() => screen.getByText('Q1'))
    expect(screen.getByText('New (1)')).toBeInTheDocument()
    expect(screen.getByText('Category 2 (1)')).toBeInTheDocument()
  })

  it('calls onOpenCram with the chip\'s streak value when Cram is clicked', async () => {
    const onOpenCram = vi.fn()
    render(<DeckView onClose={vi.fn()} onOpenCram={onOpenCram} />)
    await waitFor(() => screen.getByText('Category 2 (1)'))
    const chip = screen.getByText('Category 2 (1)').closest('.deck-view-category')
    if (!chip) throw new Error('chip not found')
    fireEvent.click(chip.querySelector('.deck-view-category-cram') as HTMLElement)
    expect(onOpenCram).toHaveBeenCalledWith(2)
  })

  it('respects the active tag filter', async () => {
    render(<DeckView onClose={vi.fn()} onOpenCram={vi.fn()} />)
    await waitFor(() => screen.getByText('Q1'))
    fireEvent.click(screen.getByLabelText('cs'))
    expect(screen.getByText('New (1)')).toBeInTheDocument()
    expect(screen.queryByText('Category 2 (1)')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- DeckView`
Expected: FAIL — `Unable to find an element with the text: New (1)` (chips don't exist yet), plus a TS error until Step 3 lands (`onOpenCram` prop doesn't exist on `DeckViewProps`).

- [ ] **Step 3: Implement**

In `src/components/DeckView.tsx`:

```tsx
interface DeckViewProps {
  onClose: () => void
  onOpenCram: (streak: number) => void
}
```

Add a `categories` memo, directly after `groups` (line 52):

```tsx
  const categories = useMemo(() => {
    const counts = new Map<number, number>()
    for (const c of filtered) {
      counts.set(c.streak, (counts.get(c.streak) ?? 0) + 1)
    }
    return Array.from(counts.entries())
      .sort(([a], [b]) => a - b)
      .map(([streak, count]) => ({ streak, count }))
  }, [filtered])
```

Update the function signature and render a categories row between `.deck-view-tags` and `.task-view-list`:

```tsx
export function DeckView({ onClose, onOpenCram }: DeckViewProps) {
```

```tsx
            {categories.length > 0 && (
              <div className="deck-view-categories">
                {categories.map(({ streak, count }) => (
                  <div key={streak} className="deck-view-category">
                    <span>{streak === 0 ? 'New' : `Category ${streak}`} ({count})</span>
                    <button className="deck-view-category-cram" onClick={() => onOpenCram(streak)}>
                      Cram
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="task-view-list">
```

In `src/index.css`, directly after the `.deck-view-tag` rule (line ~3518):

```css
.deck-view-categories {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
}

.deck-view-category {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 2px 6px;
}

.deck-view-category-cram {
  font-size: 11px;
  color: var(--text-tertiary);
  cursor: pointer;
}
```

(Confirm `--border-color`/`--text-tertiary`/`--space-sm` are the actual token names already in scope in `src/index.css` before using them — copy whatever the neighboring `.deck-view-tag`/`.deck-view-stats` rules use rather than assuming these exact names.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- DeckView`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/DeckView.tsx src/components/DeckView.test.tsx src/index.css
git commit -m "feat: add cram category chips to DeckView"
```

---

## Task 8: `ReviewSession` cram mode

**Files:**
- Modify: `src/components/ReviewSession.tsx`
- Modify: `src/components/ReviewSession.test.tsx`

**Interfaces:**
- Consumes: `api.notes.listCramCards(workspace, streak) -> Promise<DueCard[]>` (Task 6).
- Produces: `export type ReviewMode = { kind: 'due' } | { kind: 'cram'; streak: number }`, `ReviewSessionProps.mode?: ReviewMode` (default `{ kind: 'due' }`) — consumed by Task 9 (`Layout.tsx`).

- [ ] **Step 1: Write the failing tests**

Add `listCramCards: vi.fn()` to the mock in `src/components/ReviewSession.test.tsx` (lines 8-16):

```tsx
vi.mock('../lib/tauri', () => ({
  api: {
    notes: {
      listDueCards: vi.fn(),
      listCramCards: vi.fn(),
      gradeCard: vi.fn(),
      gradeMcCard: vi.fn(),
    },
  },
}))
```

Add `streak` to the `cards`/`mcCard` fixtures (lines 18-31) — any value works since due-mode tests don't assert on it:

```tsx
const cards: DueCard[] = [
  { notePath: '/ws/a.md', noteTitle: 'A', kind: 'qa', front: 'Q1', back: 'A1', position: 0, options: [], streak: 0 },
  { notePath: '/ws/b.md', noteTitle: 'B', kind: 'cloze', front: 'Q2 [...]', back: 'Q2 full', position: 3, options: [], streak: 0 },
]

const mcCard: DueCard = {
  notePath: '/ws/c.md',
  noteTitle: 'C',
  kind: 'mc',
  front: 'What is 2+2?',
  back: '',
  position: 0,
  options: ['3', '4', '5'],
  streak: 0,
}
```

Add a new `describe` block at the end of the file:

```tsx
describe('ReviewSession — cram mode', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ path: '/ws' })
    vi.mocked(api.notes.listCramCards).mockResolvedValue(cards)
  })

  it('fetches from listCramCards with the given streak, not listDueCards', async () => {
    render(<ReviewSession onClose={vi.fn()} mode={{ kind: 'cram', streak: 2 }} />)
    await waitFor(() => expect(api.notes.listCramCards).toHaveBeenCalledWith('/ws', 2))
    expect(api.notes.listDueCards).not.toHaveBeenCalled()
  })

  it('shows the cram header instead of the due-queue header', async () => {
    render(<ReviewSession onClose={vi.fn()} mode={{ kind: 'cram', streak: 2 }} />)
    await waitFor(() => expect(screen.getByText('Cram — Category 2')).toBeInTheDocument())
  })

  it('shows the cram-specific empty state when the category has no cards', async () => {
    vi.mocked(api.notes.listCramCards).mockResolvedValue([])
    render(<ReviewSession onClose={vi.fn()} mode={{ kind: 'cram', streak: 2 }} />)
    await waitFor(() => expect(screen.getByText('No cards in this category.')).toBeInTheDocument())
  })

  it('shuffles without dropping any fetched card', async () => {
    render(<ReviewSession onClose={vi.fn()} mode={{ kind: 'cram', streak: 2 }} />)
    await waitFor(() => {
      const front = screen.queryByText('Q1') ?? screen.queryByText('Q2 [...]')
      expect(front).toBeInTheDocument()
    })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- ReviewSession`
Expected: FAIL — TS error (`mode` prop doesn't exist), and `api.notes.listCramCards` is `undefined` until the mock/implementation land together.

- [ ] **Step 3: Implement**

In `src/components/ReviewSession.tsx`:

```tsx
export type ReviewMode = { kind: 'due' } | { kind: 'cram'; streak: number }

interface ReviewSessionProps {
  onClose: () => void
  mode?: ReviewMode
}
```

```tsx
export function ReviewSession({ onClose, mode = { kind: 'due' } }: ReviewSessionProps) {
  const workspacePath = useWorkspaceStore((s) => s.path)
  const cramStreak = mode.kind === 'cram' ? mode.streak : null
  const [queue, setQueue] = useState<DueCard[]>([])
```

Replace the fetch effect (lines 28-37):

```tsx
  useEffect(() => {
    if (!workspacePath) return
    setIsLoading(true)
    setError(null)
    const request =
      cramStreak !== null
        ? api.notes.listCramCards(workspacePath, cramStreak)
        : api.notes.listDueCards(workspacePath)
    request
      .then((fetched) => setQueue(cramStreak !== null ? shuffleCards(fetched) : fetched))
      .catch((e: unknown) => setError(`Couldn't load the review queue: ${String(e)}`))
      .finally(() => setIsLoading(false))
  }, [workspacePath, cramStreak])
```

Replace `refetch` (lines 49-55):

```tsx
  function refetch() {
    if (!workspacePath) return
    const request =
      cramStreak !== null
        ? api.notes.listCramCards(workspacePath, cramStreak)
        : api.notes.listDueCards(workspacePath)
    request.then((fetched) => {
      setQueue(cramStreak !== null ? shuffleCards(fetched) : fetched)
      setRevealed(false)
    })
  }
```

Add the shuffle helper near the top of the file, below the `GRADES` constant:

```tsx
// Good enough for study-order randomization — no seeding/fairness
// requirement, this is a shuffled drill order, not anything scored.
function shuffleCards(cards: DueCard[]): DueCard[] {
  return [...cards].sort(() => Math.random() - 0.5)
}
```

Update the header (line 113):

```tsx
          <h2>
            {cramStreak !== null
              ? `Cram — Category ${cramStreak}`
              : `Review${queue.length > 0 ? ` (${queue.length} due)` : ''}`}
          </h2>
```

Update the empty state (line 123):

```tsx
        ) : !current ? (
          <p className="empty-state">
            {cramStreak !== null ? 'No cards in this category.' : 'All done for today.'}
          </p>
        ) : (
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- ReviewSession`
Expected: all pass, including the pre-existing due-mode tests (unaffected — `mode` defaults to `{ kind: 'due' }`).

- [ ] **Step 5: Commit**

```bash
git add src/components/ReviewSession.tsx src/components/ReviewSession.test.tsx
git commit -m "feat: add cram mode to ReviewSession"
```

---

## Task 9: Wire cram mode through `Layout.tsx`

**Files:**
- Modify: `src/components/Layout.tsx`

**Interfaces:**
- Consumes: `DeckViewProps.onOpenCram` (Task 7), `ReviewSessionProps.mode` (Task 8).
- Produces: nothing new for later tasks — this closes the loop end-to-end.

There is no dedicated unit test for this task: `Layout.test.tsx` doesn't currently test overlay routing at all (no existing coverage of `pendingFlashcardInsert` wiring either), so a new test here would be the first of its kind with no established pattern to match. Verification is `npm run typecheck` plus the Task 10 e2e test, which exercises this wiring directly.

- [ ] **Step 1: Add `pendingCramStreak` state**

In `src/components/Layout.tsx`, directly after `pendingFlashcardInsert` (lines 97-99):

```tsx
  const [pendingCramStreak, setPendingCramStreak] = useState<number | null>(null)
```

- [ ] **Step 2: Clear it on every direct (non-cram) path into the review overlay**

Three call sites open `'review'` without going through a cram chip; each must reset `pendingCramStreak` first, or a stale value from a previous cram session (closed via Escape, which calls `useOverlayManager`'s own `closeOverlay` directly, bypassing any wrapper) leaks into the next plain "Review" open.

Menu command handler (lines 198-200):

```tsx
        case 'review':
          if (workspacePath) {
            setPendingCramStreak(null)
            openOverlay('review')
          }
          break
```

Sidebar prop (line 408):

```tsx
          onReviewOpen={() => {
            setPendingCramStreak(null)
            openOverlay('review')
          }}
```

HomeView prop (line 481):

```tsx
                  onOpenReview={() => {
                    setPendingCramStreak(null)
                    openOverlay('review')
                  }}
```

- [ ] **Step 3: Wire the overlay branches**

Replace the `'review'` and `'deck'` overlay branches (lines 378-379):

```tsx
      {activeOverlay === 'review' && (
        <ReviewSession
          mode={pendingCramStreak !== null ? { kind: 'cram', streak: pendingCramStreak } : { kind: 'due' }}
          onClose={() => {
            setPendingCramStreak(null)
            closeOverlay()
          }}
        />
      )}
      {activeOverlay === 'deck' && (
        <DeckView
          onClose={closeOverlay}
          onOpenCram={(streak) => {
            setPendingCramStreak(streak)
            openOverlay('review')
          }}
        />
      )}
```

- [ ] **Step 4: Verify it compiles and existing tests still pass**

Run: `npm run typecheck && npm test -- Layout`
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/Layout.tsx
git commit -m "feat: wire DeckView cram chips into ReviewSession via Layout"
```

---

## Task 10: End-to-end test

**Files:**
- Create: `e2e/specs/cram-mode.e2e.ts`

**Interfaces:**
- Consumes: the full stack from Tasks 1-9 (real compiled app).
- Produces: nothing further.

- [ ] **Step 1: Write the spec**

```ts
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { browser, expect } from '@wdio/globals'
import { fixtureWorkspace } from '../fixtureWorkspace.js'
import { screenshot } from '../screenshot.js'
import { fillPromptDialog } from '../promptDialog.js'

async function clickInPage(selector: string): Promise<void> {
  await browser.execute((sel) => {
    const el = document.querySelector(sel)
    if (!(el instanceof HTMLElement)) throw new Error(`clickInPage: no element matching ${sel}`)
    el.click()
  }, selector)
}

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

  await clickInPage('.sidebar-new-actions button')
  await fillPromptDialog(title)
  await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.ProseMirror')), {
    timeout: 5000,
    timeoutMsg: 'editor never mounted for the new note',
  })
  return notePath
}

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

async function closeReview(): Promise<void> {
  await browser.execute(() => {
    const closeBtn = document.querySelector('.review-session .settings-panel-close')
    if (closeBtn instanceof HTMLElement) closeBtn.click()
  })
  await browser.waitUntil(async () => browser.execute(() => !document.querySelector('.review-session')), {
    timeout: 5000,
    timeoutMsg: 'review session never closed',
  })
}

async function openDeckView(): Promise<void> {
  await runCommand('deck-view')
  await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.deck-view')), {
    timeout: 5000,
    timeoutMsg: 'deck view never rendered',
  })
}

function reviewFrontText() {
  return browser.execute(() => document.querySelector('.review-card-front')?.textContent ?? null)
}

function scheduleComment(notePath: string): string {
  const content = readFileSync(notePath, 'utf-8')
  const match = content.match(/<!-- sr due=[^\n]*-->/)
  if (!match) throw new Error(`${notePath}: no schedule comment found on disk yet`)
  return match[0]
}

async function clickCramButton(categoryLabel: string): Promise<void> {
  await browser.execute((label) => {
    const chips = Array.from(document.querySelectorAll('.deck-view-category'))
    const chip = chips.find((el) => el.textContent?.includes(label))
    if (!chip) throw new Error(`no category chip containing "${label}"`)
    const btn = chip.querySelector('.deck-view-category-cram')
    if (!(btn instanceof HTMLElement)) throw new Error(`no Cram button inside chip "${label}"`)
    btn.click()
  }, categoryLabel)
}

// A mocha retry re-runs the `it()` body from the top, but React state (the
// active overlay in Layout.tsx) survives across it — force every overlay
// this spec opens closed after each attempt, same precedent as
// flashcards.e2e.ts.
afterEach(async () => {
  await browser.execute(() => {
    document.querySelectorAll('.review-session .settings-panel-close, .deck-view .settings-panel-close').forEach((btn) => {
      if (btn instanceof HTMLElement) btn.click()
    })
  })
})

describe('cram mode', () => {
  it('drills a streak category ignoring due date, and the card drops out once regraded', async () => {
    const title = `Cram Card ${Date.now()}`
    const notePath = await createNote(title)

    await focusEditorEnd()
    await browser.keys(['End', 'Enter'])
    await browser.keys('Question :: Answer')

    await browser.waitUntil(
      () => existsSync(notePath) && readFileSync(notePath, 'utf-8').includes('Question :: Answer'),
      { timeout: 10000, interval: 300, timeoutMsg: `${notePath} never contained the QA card` },
    )
    // Reindex debounce (2500ms) so the card lands in review_cards before
    // Review's fetch queries see it.
    await browser.pause(2500)

    // Grade Good twice — streak reaches 2. The interval jump (1 day, then 6
    // days) pushes `due` days into the future, so a normal review queue
    // would never surface this card again today.
    await openReview()
    await browser.waitUntil(async () => (await reviewFrontText()) === 'Question', {
      timeout: 5000,
      timeoutMsg: 'review session never showed the QA card front',
    })
    await clickButtonByText('.review-card-reveal', 'Reveal answer')
    await clickButtonByText('.review-card-grade', 'Good')
    await browser.waitUntil(() => scheduleComment(notePath).includes('streak=1'), {
      timeout: 5000,
      timeoutMsg: `${notePath} never got a streak=1 schedule comment`,
    })
    await closeReview()

    await openReview()
    await browser.waitUntil(async () => (await reviewFrontText()) === 'Question', {
      timeout: 5000,
      timeoutMsg: 'review session never showed the QA card again for the second grading',
    })
    await clickButtonByText('.review-card-reveal', 'Reveal answer')
    await clickButtonByText('.review-card-grade', 'Good')
    await browser.waitUntil(() => scheduleComment(notePath).includes('streak=2'), {
      timeout: 5000,
      timeoutMsg: `${notePath} never got a streak=2 schedule comment`,
    })
    await closeReview()

    // Browse All Cards shows it under Category 2 even though `due` is days out.
    await openDeckView()
    await browser.waitUntil(
      async () =>
        browser.execute(() =>
          Array.from(document.querySelectorAll('.deck-view-category')).some((el) => el.textContent?.includes('Category 2')),
        ),
      { timeout: 5000, timeoutMsg: 'deck view never showed a Category 2 chip' },
    )
    await screenshot('cram-mode-category-chip')

    // Cram Category 2 — the card is due days from now, so only cram mode
    // (not a normal review) can reach it.
    await clickCramButton('Category 2')
    await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.review-session')), {
      timeout: 5000,
      timeoutMsg: 'cram session never opened from the deck view',
    })
    await browser.waitUntil(async () => (await reviewFrontText()) === 'Question', {
      timeout: 5000,
      timeoutMsg: 'cram session never showed the Category 2 card',
    })
    await screenshot('cram-mode-session')

    // Grade it Again — streak resets to 0, dropping it out of Category 2.
    await clickButtonByText('.review-card-reveal', 'Reveal answer')
    await clickButtonByText('.review-card-grade', 'Again')
    await browser.waitUntil(() => scheduleComment(notePath).includes('streak=0'), {
      timeout: 5000,
      timeoutMsg: `${notePath} never reset to a streak=0 schedule comment`,
    })
    await closeReview()

    await openDeckView()
    await browser.waitUntil(
      async () =>
        browser.execute(() =>
          Array.from(document.querySelectorAll('.deck-view-category')).some((el) => el.textContent?.includes('New (1)')),
        ),
      { timeout: 5000, timeoutMsg: 'deck view never showed the card back under New after it reset' },
    )
    expect(
      await browser.execute(() =>
        !Array.from(document.querySelectorAll('.deck-view-category')).some((el) => el.textContent?.includes('Category 2')),
      ),
    ).toBe(true)
  })
})
```

- [ ] **Step 2: Run it against the real compiled app**

Run: `npm run test:e2e`
Expected: rebuilds the app (`tauri build --debug`) and this spec passes alongside the existing suite.

- [ ] **Step 3: Commit**

```bash
git add e2e/specs/cram-mode.e2e.ts
git commit -m "test: add e2e coverage for cram mode"
```

---

## Self-Review Notes

- **Spec coverage:** every section of `docs/specs/cram-mode-design.md` maps to a task — `next_streak` (Task 1), storage/migration (Task 2), comment parsing/writing (Task 3), `ExtractedCard`/`DueCard`/`CardSummary` (Task 4), backend query + command (Task 5), frontend types/API (Task 6), `DeckView` (Task 7), `ReviewSession` (Task 8), `Layout` wiring (Task 9), and the three Testing bullets are covered by Tasks 1-5 (Rust), 7-8 (Vitest), and 10 (E2E).
- **Deliberate deviation from the spec's wording:** the spec says the category row should respect the tag filter "same as the stats strip already does" — but `dueCount`/`masteredCount` in the current `DeckView.tsx` are computed from the unfiltered `cards`, not `filtered`. This plan computes `categories` from `filtered` instead, matching the tag-filtered per-note list directly below it (the more useful and internally consistent choice for a "drill this category" flow), not the unfiltered stats span above it.
- **Out-of-scope items confirmed untouched:** no new grading command, no per-card cram picker, no streak cap — none of the tasks above introduce any of these.

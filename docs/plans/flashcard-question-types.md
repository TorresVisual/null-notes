# Flashcard Question Types Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (default) or superpowers:subagent-driven-development if explicitly requested.

**Goal:** Add multiple-choice flashcards (single- and multi-select, auto-graded), a `/flashcard` slash command that inserts any card type without hand-typing syntax, and a deck view that browses the whole card collection instead of only the due queue.

**Architecture:** MC cards are detected by a new "bare `::` question line + contiguous `- [ ]`/`- [x]` lines" shape in the existing line-based extractors (`extract_cards`/`extract_tasks`), sharing one new helper set so the two extractors can never disagree about which lines are MC syntax. Grading reuses the existing SM-2 pipeline unchanged — MC only computes *which* of the four grades to feed it, via a new one-rung-per-attempt ladder keyed off a grade field the schedule comment now always carries. The frontend adds one dialog (flashcard type picker, opened from the editor), extends the existing review session with an MC branch, and adds one new browse-all view (deck view) alongside the existing due-queue-only review.

**Tech Stack:** Rust (Tauri commands, sqlx/SQLite), React 19 + TypeScript, TipTap 3 slash-command extension.

**Spec:** `docs/specs/flashcard-question-types-design.md` — the plan below implements it task by task; read both together.

## Global Constraints

- MC grading is exact-set-match only — no partial credit for a multi-select answer (spec "Out of scope").
- The deck view is browse/review only; editing happens by opening the note, not inline (spec "Out of scope").
- `list_all_cards` has no server-side tag/note filtering — client-side only, matching every other list-and-filter view in this app (spec "Out of scope").
- `correct` (the `[x]` indices) is never persisted to the DB and never sent to the frontend for a *due* card — only `options`. Correctness is always resolved server-side against a fresh disk read.
- SQLite has no `ADD COLUMN IF NOT EXISTS`; every migration in this plan uses the discard-duplicate-column-error pattern, never a fresh-DB-only `CREATE TABLE` change.

---

## File Structure

Backend (`src-tauri/src/`):
- `sm2.rs` — modify: `Grade::as_str`, `Grade::from_rung`, `mc_auto_grade`.
- `db/schema.rs` — modify: two `ALTER TABLE review_cards ADD COLUMN` migrations.
- `models.rs` — modify: `CardKind::Mc`, `ExtractedCard` gains `grade`/`options`/`correct`, `DueCard` gains `options`; new `CardSummary`, `McGradeResult`.
- `commands/notes.rs` — modify: MC line-shape helpers, `extract_tasks`/`extract_cards`/`grade_card_line` updates, new `grade_mc_card`/`list_all_cards` commands.
- `db/notes.rs` — modify: `set_cards` persists `options`/`grade`/`mc` kind, `due_cards` returns `options`; new `list_all_cards`.
- `lib.rs` — modify: register the two new commands, add the "Browse All Cards" menu item.

Frontend (`src/`):
- `types/index.ts` — modify: `DueCard.options`, new `McGradeResult`, `CardSummary`.
- `lib/tauri.ts` — modify: `gradeMcCard`, `listAllCards`.
- `components/ReviewSession.tsx` — modify: MC branch (checkboxes, submit, highlight, Next).
- `components/ReviewSession.test.tsx` — modify: card fixtures gain `options`.
- `editor/extensions/NoteContext.ts` — modify: storage gains an `openFlashcardDialog` callback slot.
- `editor/extensions/SlashCommands.tsx` — modify: new `/flashcard` entry.
- `editor/NoteEditor.tsx` — modify: thread `onFlashcardCommand` prop into the storage bridge.
- `components/FlashcardTypeDialog.tsx` — create: type-picker dialog, same shell as `TemplateDialog`.
- `hooks/useOverlayManager.ts` — modify: `OverlayKind` gains `'flashcard'` and `'deck'`.
- `components/Layout.tsx` — modify: wire the flashcard-insert pending state, the two new overlays, the deck-view menu command.
- `lib/cardGroups.ts` — create: `groupCardsByNote`, mirrors `lib/taskGroups.ts`'s shape for `CardSummary`.
- `components/DeckView.tsx` — create: browse-all-cards view, same shell as `TaskView`.
- `components/HomeView.tsx` — modify: "Browse all cards" link next to "Start review".
- `index.css` — modify: MC option styling, deck view styling.

---

### Task 1: SM-2 auto-grade ladder

**Files:**
- Modify: `src-tauri/src/sm2.rs`

**Interfaces:**
- Produces: `Grade::as_str(self) -> &'static str`, `mc_auto_grade(last_grade: Option<Grade>, correct: bool) -> Grade` (both `pub`, used by `commands/notes.rs` in Task 4/6).

- [ ] **Step 1: Write the failing tests**

Add to the `tests` module in `src-tauri/src/sm2.rs`:

```rust
    #[test]
    fn test_mc_auto_grade_new_card_correct_lands_on_good() {
        assert_eq!(mc_auto_grade(None, true), Grade::Good);
    }

    #[test]
    fn test_mc_auto_grade_new_card_incorrect_lands_on_again() {
        assert_eq!(mc_auto_grade(None, false), Grade::Again);
    }

    #[test]
    fn test_mc_auto_grade_moves_one_rung_up_on_correct() {
        assert_eq!(mc_auto_grade(Some(Grade::Good), true), Grade::Easy);
    }

    #[test]
    fn test_mc_auto_grade_moves_one_rung_down_on_incorrect() {
        assert_eq!(mc_auto_grade(Some(Grade::Good), false), Grade::Hard);
    }

    #[test]
    fn test_mc_auto_grade_caps_at_easy() {
        assert_eq!(mc_auto_grade(Some(Grade::Easy), true), Grade::Easy);
    }

    #[test]
    fn test_mc_auto_grade_floors_at_again() {
        assert_eq!(mc_auto_grade(Some(Grade::Again), false), Grade::Again);
    }

    #[test]
    fn test_grade_as_str_round_trips_the_serde_names() {
        assert_eq!(Grade::Again.as_str(), "again");
        assert_eq!(Grade::Hard.as_str(), "hard");
        assert_eq!(Grade::Good.as_str(), "good");
        assert_eq!(Grade::Easy.as_str(), "easy");
    }
```

- [ ] **Step 2: Run to verify it fails**

Run (from `src-tauri/`): `cargo test sm2::tests::test_mc_auto_grade`
Expected: FAIL with "cannot find function `mc_auto_grade`"

- [ ] **Step 3: Implement**

Add to `src-tauri/src/sm2.rs`, after the `Scheduled` struct and before `next_state`:

```rust
impl Grade {
    pub fn as_str(self) -> &'static str {
        match self {
            Grade::Again => "again",
            Grade::Hard => "hard",
            Grade::Good => "good",
            Grade::Easy => "easy",
        }
    }

    fn from_rung(rung: i32) -> Grade {
        match rung {
            0 => Grade::Again,
            1 => Grade::Hard,
            2 => Grade::Good,
            _ => Grade::Easy,
        }
    }
}
```

Add after `next_state`'s closing brace, before `pub fn today()`:

```rust
/// MC grading moves one rung of the four SM-2 grades per attempt instead of
/// asking the reviewer to self-assess. A card with no prior grade starts at
/// the `Hard` baseline, so a first correct pick lands on `Good` and a first
/// miss lands on `Again` — matching what a manual first grade would produce
/// today.
pub fn mc_auto_grade(last_grade: Option<Grade>, correct: bool) -> Grade {
    let rung = last_grade.map_or(1, |g| g as i32); // Hard=1 baseline
    let next = if correct { rung + 1 } else { rung - 1 };
    Grade::from_rung(next.clamp(0, 3))
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test sm2::`
Expected: PASS (all sm2 tests, old and new)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/sm2.rs
git commit -m "feat: add MC auto-grade ladder to sm2"
```

---

### Task 2: `review_cards` schema migration

**Files:**
- Modify: `src-tauri/src/db/schema.rs`

**Interfaces:**
- Produces: `review_cards.options TEXT` (nullable, JSON array), `review_cards.grade TEXT` (nullable) — consumed by Task 4's `set_cards`/`due_cards`/`list_all_cards`.

- [ ] **Step 1: Write the failing test**

Add to `src-tauri/src/db/schema.rs` (new `#[cfg(test)] mod tests` block at the end of the file):

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_run_migrations_adds_options_and_grade_columns() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        run_migrations(&pool).await.unwrap();

        // A row insert naming both new columns is the simplest proof they
        // exist and accept NULL — sqlx has no schema-introspection helper
        // exposed here, and this exercises exactly what set_cards will do.
        sqlx::query(
            "INSERT INTO review_cards (note_path, kind, front, back, position, due, ease, interval, reps, options, grade)
             VALUES ('/a.md', 'mc', 'Q', '', 0, '2026-01-01', 2.5, 0, 0, NULL, NULL)",
        )
        .execute(&pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn test_run_migrations_is_idempotent_against_an_already_migrated_db() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        run_migrations(&pool).await.unwrap();
        // Re-running against an already-migrated DB must not error on the
        // "duplicate column name" the second ALTER TABLE always produces.
        run_migrations(&pool).await.unwrap();
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run (from `src-tauri/`): `cargo test db::schema::tests`
Expected: FAIL — "table review_cards has no column named options"

- [ ] **Step 3: Implement**

In `src-tauri/src/db/schema.rs`, add before `run_migrations`:

```rust
// SQLite has no `ADD COLUMN IF NOT EXISTS` — this is the standard sqlx
// workaround. Any error other than the column already existing still
// propagates; only that one specific case is treated as success so a
// re-run against an already-migrated `index.db` stays a no-op.
async fn add_column_if_missing(pool: &SqlitePool, sql: &str) -> Result<()> {
    match sqlx::query(sql).execute(pool).await {
        Ok(_) => Ok(()),
        Err(e) if e.to_string().contains("duplicate column name") => Ok(()),
        Err(e) => Err(e.into()),
    }
}
```

Then, immediately after the existing `review_cards_path` index block (before the final `Ok(())`):

```rust
    // First column addition this table has ever had. `options` is a JSON
    // array of MC option strings, NULL for qa/cloze. `grade` is the last
    // grade given (again/hard/good/easy), NULL if never graded — the MC
    // auto-grade ladder needs to know the previous rung, and this is also
    // written by qa/cloze grading now so the comment format stays uniform.
    add_column_if_missing(pool, "ALTER TABLE review_cards ADD COLUMN options TEXT").await?;
    add_column_if_missing(pool, "ALTER TABLE review_cards ADD COLUMN grade TEXT").await?;
```

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test db::schema::`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db/schema.rs
git commit -m "feat: add options/grade columns to review_cards"
```

---

### Task 3: Data model — `CardKind::Mc`, extended structs

**Files:**
- Modify: `src-tauri/src/models.rs`

**Interfaces:**
- Produces: `CardKind::Mc` variant; `ExtractedCard.grade: Option<sm2::Grade>`, `.options: Vec<String>`, `.correct: Vec<usize>`; `DueCard.options: Vec<String>` (drops `sqlx::FromRow` derive — Task 6 builds it by hand); `CardSummary`, `McGradeResult` (both `pub`, `Serialize`/`Deserialize`, `camelCase`).

- [ ] **Step 1: Implement (no test — this task only changes struct shape; behavior is covered by the tasks that populate the new fields)**

In `src-tauri/src/models.rs`, add `use crate::sm2;` near the top (alongside the existing `use` block).

Change the `CardKind` enum:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CardKind {
    Qa,
    Cloze,
    Mc,
}
```

Change `ExtractedCard`:

```rust
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
    pub grade: Option<sm2::Grade>,
    /// MC option text, in source order. Empty for `Qa`/`Cloze`.
    pub options: Vec<String>,
    /// 0-based indices of the `[x]` lines. Empty for `Qa`/`Cloze`. Never
    /// persisted to the DB and never sent to the frontend for a due card —
    /// see `DueCard`.
    pub correct: Vec<usize>,
}
```

Change `DueCard` (drop the `sqlx::FromRow` derive — Task 6's `due_cards` builds it from a private row struct by hand, since `options` needs JSON-decoding a `TEXT` column):

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DueCard {
    pub note_path: String,
    pub note_title: String,
    pub kind: String,
    pub front: String,
    pub back: String,
    pub position: i64,
    /// MC option text, in source order. Empty for `qa`/`cloze`. The
    /// answer (`correct`) is deliberately absent — resolved server-side at
    /// grading time against a fresh read of the note.
    pub options: Vec<String>,
}
```

Add after `DueCard`:

```rust
/// One card for the deck view (browse-all, not just due) — mirrors
/// `DueCard` plus scheduling/tag fields a due-queue card doesn't need.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardSummary {
    pub note_path: String,
    pub note_title: String,
    pub kind: String,
    pub front: String,
    pub back: String,
    pub position: i64,
    pub due: String,
    pub interval: i64,
    pub tags: Vec<String>,
}

/// What `grade_mc_card` hands back so the frontend can highlight the right
/// options without having been told the answer up front.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McGradeResult {
    pub correct: Vec<usize>,
}
```

- [ ] **Step 2: Verify the crate still type-checks**

Run (from `src-tauri/`): `cargo check`
Expected: FAIL — call sites in `commands/notes.rs` and `db/notes.rs` haven't been updated yet (Task 4/6 fix this). This is expected; the failure confirms the struct shape actually changed, and each construction site is fixed in its own task below.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/models.rs
git commit -m "feat: extend card data model for MC questions and the deck view"
```

(Committing a crate that doesn't yet `cargo check` clean is unusual — normally each commit should build. Here it's acceptable because Task 4 is the very next task and lands within the same session before any push; if you're executing this plan across a break, squash Tasks 3–4 before committing instead.)

---

### Task 4: MC line-shape parsing in `extract_cards`/`extract_tasks`

**Files:**
- Modify: `src-tauri/src/commands/notes.rs`

**Interfaces:**
- Consumes: `sm2::Grade` (Task 1), `CardKind::Mc`/`ExtractedCard` new fields (Task 3).
- Produces: `is_mc_question_line`, `mc_block_option_count`, `parse_mc_block`, `mc_option_line_positions` (all private, used again by Task 5's `grade_card_line` and Task 6's `grade_mc_card_at`).

- [ ] **Step 1: Write the failing tests**

Add to the existing test module in `src-tauri/src/commands/notes.rs` that already covers `extract_cards`/`extract_tasks` (search for `mod save_tests` or the nearest `#[cfg(test)]` block containing `extract_cards` tests, and add alongside):

```rust
    #[test]
    fn test_extract_cards_parses_a_single_select_mc_block() {
        let content = "What is 2+2? ::\n- [ ] 3\n- [x] 4\n- [ ] 5\n";
        let cards = extract_cards(content);
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].kind, CardKind::Mc);
        assert_eq!(cards[0].front, "What is 2+2?");
        assert_eq!(cards[0].options, vec!["3", "4", "5"]);
        assert_eq!(cards[0].correct, vec![1]);
        assert_eq!(cards[0].position, 0);
    }

    #[test]
    fn test_extract_cards_parses_a_multi_select_mc_block() {
        let content = "Which are primes? ::\n- [x] 2\n- [ ] 4\n- [x] 3\n";
        let cards = extract_cards(content);
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].correct, vec![0, 2]);
    }

    #[test]
    fn test_extract_cards_skips_an_mc_block_with_no_correct_option() {
        let content = "Bad question ::\n- [ ] a\n- [ ] b\n";
        assert!(extract_cards(content).is_empty());
    }

    #[test]
    fn test_extract_cards_mc_block_reads_its_sr_comment() {
        let content =
            "Q ::\n- [x] a\n<!-- sr due=2026-08-21 ease=2.50 interval=1 reps=1 grade=good -->\n";
        let cards = extract_cards(content);
        assert_eq!(cards[0].due.as_deref(), Some("2026-08-21"));
        assert_eq!(cards[0].grade, Some(sm2::Grade::Good));
    }

    #[test]
    fn test_extract_cards_qa_and_cloze_still_work_alongside_mc() {
        let content = "Q :: A\nText with {{gap}}.\nMC ::\n- [x] only\n";
        let cards = extract_cards(content);
        assert_eq!(cards.len(), 3);
        assert_eq!(cards[0].kind, CardKind::Qa);
        assert_eq!(cards[1].kind, CardKind::Cloze);
        assert_eq!(cards[2].kind, CardKind::Mc);
    }

    #[test]
    fn test_extract_tasks_excludes_mc_option_lines() {
        let content = "Q ::\n- [ ] a\n- [x] b\n\n- [ ] a real task\n";
        let tasks = extract_tasks(content);
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].text, "a real task");
    }

    #[test]
    fn test_extract_tasks_still_finds_tasks_when_no_mc_block_present() {
        let content = "- [ ] plain task\n- [x] done task\n";
        assert_eq!(extract_tasks(content).len(), 2);
    }
```

- [ ] **Step 2: Run to verify it fails**

Run (from `src-tauri/`): `cargo test extract_cards`
Expected: FAIL — MC blocks aren't recognized yet (they'd currently be silently skipped, since `classify_card_line` matches neither the bare-`::` line nor the checkbox lines).

- [ ] **Step 3: Implement**

In `src-tauri/src/commands/notes.rs`, add these helpers directly above `fn classify_card_line`:

```rust
fn checkbox_re() -> Regex {
    Regex::new(r"^\s*-\s\[([ xX])\]\s+(.+)$").expect("static checkbox regex")
}

// A bare "Question ::" with nothing after the "::" is the MC marker. Q::A
// always has content after it (`qa_re` in classify_card_line requires
// `\s(.+)$`), so this can never misfire on a real Q::A line.
fn is_mc_question_line(trimmed: &str) -> bool {
    Regex::new(r"^.+\s::$")
        .expect("static MC question regex")
        .is_match(trimmed)
}

// How many contiguous checkbox lines follow a bare-`::` question line at
// `start`, purely structural — used to skip past a block regardless of
// whether it turns out to have a marked correct answer.
fn mc_block_option_count(lines: &[&str], start: usize) -> usize {
    let re = checkbox_re();
    let mut j = start + 1;
    while j < lines.len() && re.is_match(lines[j]) {
        j += 1;
    }
    j - start - 1
}

// Returns (front, options, correct-indices) only if at least one option is
// marked `[x]` — an MC block with no correct answer marked isn't gradeable,
// so it isn't a card (mirrors `classify_card_line` returning `None` for text
// that merely looks card-shaped).
fn parse_mc_block(lines: &[&str], start: usize) -> Option<(String, Vec<String>, Vec<usize>)> {
    let re = checkbox_re();
    let front = lines[start].trim().trim_end_matches("::").trim().to_string();
    let mut options = Vec::new();
    let mut correct = Vec::new();
    let mut j = start + 1;
    while j < lines.len() {
        let caps = match re.captures(lines[j]) {
            Some(c) => c,
            None => break,
        };
        if caps[1].eq_ignore_ascii_case("x") {
            correct.push(options.len());
        }
        options.push(caps[2].trim().to_string());
        j += 1;
    }
    if correct.is_empty() {
        None
    } else {
        Some((front, options, correct))
    }
}

// Shared by extract_cards and extract_tasks so the two can never disagree
// about which lines are MC syntax: extract_tasks skips every line in this
// set (they'd otherwise leak into the Tasks view as fake to-dos, since
// `- [ ]`/`- [x]` is also extract_tasks's own pattern); extract_cards is the
// only consumer that treats them as content.
fn mc_option_line_positions(content: &str) -> HashSet<usize> {
    let lines: Vec<&str> = content.lines().collect();
    let mut in_fence = false;
    let mut positions = HashSet::new();
    let mut i = 0;
    while i < lines.len() {
        let trimmed = lines[i].trim();
        if trimmed.starts_with("```") {
            in_fence = !in_fence;
            i += 1;
            continue;
        }
        if in_fence {
            i += 1;
            continue;
        }
        if is_mc_question_line(trimmed) {
            let count = mc_block_option_count(&lines, i);
            positions.extend((i + 1)..=(i + count));
            i += 1 + count;
            continue;
        }
        i += 1;
    }
    positions
}
```

Update `extract_tasks` to skip MC option lines:

```rust
pub fn extract_tasks(content: &str) -> Vec<ExtractedTask> {
    let re = match Regex::new(r"^\s*-\s\[([ xX])\]\s+(.+)$") {
        Ok(re) => re,
        Err(_) => return Vec::new(),
    };
    let mc_positions = mc_option_line_positions(content);
    let mut in_fence = false;
    let mut tasks = Vec::new();
    for (i, line) in content.lines().enumerate() {
        if line.trim_start().starts_with("```") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        if mc_positions.contains(&i) {
            continue;
        }
        if let Some(caps) = re.captures(line) {
            tasks.push(ExtractedTask {
                text: caps[2].trim().to_string(),
                done: caps[1].eq_ignore_ascii_case("x"),
                position: i as i64,
            });
        }
    }
    tasks
}
```

Replace `parse_sr_comment` (5th capture group for `grade=`):

```rust
fn parse_sr_comment(line: &str) -> Option<(String, f64, i64, i64, Option<sm2::Grade>)> {
    let re = Regex::new(
        r"^<!--\s+sr\s+due=(\S+)\s+ease=(\S+)\s+interval=(\S+)\s+reps=(\S+)(?:\s+grade=(\S+))?\s+-->$",
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
    Some((due, ease, interval, reps, grade))
}
```

Replace `extract_cards` in full:

```rust
pub fn extract_cards(content: &str) -> Vec<ExtractedCard> {
    let lines: Vec<&str> = content.lines().collect();
    let mut in_fence = false;
    let mut cards = Vec::new();
    let mut i = 0;

    while i < lines.len() {
        let trimmed = lines[i].trim();
        if trimmed.starts_with("```") {
            in_fence = !in_fence;
            i += 1;
            continue;
        }
        if in_fence {
            i += 1;
            continue;
        }

        if is_mc_question_line(trimmed) {
            let option_count = mc_block_option_count(&lines, i);
            if let Some((front, options, correct)) = parse_mc_block(&lines, i) {
                let (due, ease, interval, reps, grade) = lines
                    .get(i + 1 + option_count)
                    .and_then(|l| parse_sr_comment(l))
                    .map(|(d, e, iv, r, g)| (Some(d), Some(e), Some(iv), Some(r), g))
                    .unwrap_or((None, None, None, None, None));
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
                    options,
                    correct,
                });
            }
            i += 1 + option_count;
            continue;
        }

        let (kind, front, back) = match classify_card_line(trimmed) {
            Some(c) => c,
            None => {
                i += 1;
                continue;
            }
        };

        let (due, ease, interval, reps, grade) = lines
            .get(i + 1)
            .and_then(|l| parse_sr_comment(l))
            .map(|(d, e, iv, r, g)| (Some(d), Some(e), Some(iv), Some(r), g))
            .unwrap_or((None, None, None, None, None));

        cards.push(ExtractedCard {
            kind,
            front,
            back,
            position: i as i64,
            due,
            ease,
            interval,
            reps,
            grade,
            options: Vec::new(),
            correct: Vec::new(),
        });
        i += 1;
    }

    cards
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test extract_cards && cargo test extract_tasks`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/notes.rs
git commit -m "feat: parse multiple-choice card blocks in extract_cards"
```

---

### Task 5: MC-aware `grade_card_line`

**Files:**
- Modify: `src-tauri/src/commands/notes.rs`

**Interfaces:**
- Consumes: `is_mc_question_line`, `mc_block_option_count` (Task 4), `Grade::as_str` (Task 1).
- Produces: `grade_card_line` now writes the schedule comment after an MC block's last option line, and every comment it writes carries `grade=`. Used unchanged by Task 6's `grade_mc_card_at` (via `grade_card_at`).

- [ ] **Step 1: Write the failing tests**

Add near the existing `grade_card_line` tests (search for a test module covering it, likely in `mod save_tests` or a dedicated block):

```rust
    #[test]
    fn test_grade_card_line_places_the_comment_after_an_mc_blocks_options() {
        let content = "Q ::\n- [ ] a\n- [x] b\n";
        let out =
            grade_card_line(content, 0, sm2::Grade::Good, chrono::NaiveDate::from_ymd_opt(2026, 8, 20).unwrap())
                .unwrap();
        let lines: Vec<&str> = out.lines().collect();
        assert_eq!(lines.len(), 4);
        assert!(lines[3].starts_with("<!-- sr "));
        assert!(lines[3].contains("grade=good"));
    }

    #[test]
    fn test_grade_card_line_updates_an_existing_mc_comment_in_place() {
        let content = "Q ::\n- [ ] a\n- [x] b\n<!-- sr due=2026-08-20 ease=2.50 interval=1 reps=1 grade=good -->\n";
        let out =
            grade_card_line(content, 0, sm2::Grade::Easy, chrono::NaiveDate::from_ymd_opt(2026, 8, 21).unwrap())
                .unwrap();
        assert_eq!(out.lines().count(), 4);
        assert!(out.contains("grade=easy"));
    }

    #[test]
    fn test_grade_card_line_writes_grade_field_for_plain_qa_too() {
        let content = "Q :: A\n";
        let out =
            grade_card_line(content, 0, sm2::Grade::Hard, chrono::NaiveDate::from_ymd_opt(2026, 8, 20).unwrap())
                .unwrap();
        assert!(out.contains("grade=hard"));
    }

    #[test]
    fn test_grade_card_line_rejects_an_mc_question_with_no_option_lines() {
        let content = "Q ::\nsome unrelated paragraph\n";
        assert!(
            grade_card_line(content, 0, sm2::Grade::Good, chrono::NaiveDate::from_ymd_opt(2026, 8, 20).unwrap())
                .is_none()
        );
    }
```

- [ ] **Step 2: Run to verify it fails**

Run (from `src-tauri/`): `cargo test grade_card_line`
Expected: FAIL — comment lands at `idx + 1` (right after the question line) instead of after the options, and carries no `grade=` field.

- [ ] **Step 3: Implement**

Replace `grade_card_line` in `src-tauri/src/commands/notes.rs`:

```rust
pub fn grade_card_line(
    content: &str,
    position: i64,
    grade: sm2::Grade,
    today: chrono::NaiveDate,
) -> Option<String> {
    let mut lines: Vec<String> = content.lines().map(str::to_string).collect();
    let idx = usize::try_from(position).ok()?;
    let trimmed = lines.get(idx)?.trim().to_string();

    let comment_idx = if is_mc_question_line(&trimmed) {
        let borrowed: Vec<&str> = lines.iter().map(String::as_str).collect();
        let option_count = mc_block_option_count(&borrowed, idx);
        if option_count == 0 {
            return None;
        }
        idx + 1 + option_count
    } else {
        classify_card_line(&trimmed)?;
        idx + 1
    };

    let current = lines
        .get(comment_idx)
        .and_then(|l| parse_sr_comment(l))
        .map(|(_, ease, interval, reps, _)| sm2::CardState { ease, interval, reps })
        .unwrap_or_default();

    let next = sm2::next_state(current, grade, today);
    let comment = format!(
        "<!-- sr due={} ease={:.2} interval={} reps={} grade={} -->",
        next.due,
        next.ease,
        next.interval,
        next.reps,
        grade.as_str()
    );

    let has_comment_line = lines
        .get(comment_idx)
        .map(|l| parse_sr_comment(l).is_some())
        .unwrap_or(false);
    if has_comment_line {
        lines[comment_idx] = comment;
    } else {
        lines.insert(comment_idx, comment);
    }

    let mut rewritten = lines.join("\n");
    if content.ends_with('\n') {
        rewritten.push('\n');
    }
    Some(rewritten)
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test grade_card_line && cargo test`
Expected: PASS — including every pre-existing `grade_card_line`/`extract_cards` test, since old-format comments (no `grade=`) still parse via the now-optional 5th capture group.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/notes.rs
git commit -m "feat: teach grade_card_line to place comments after MC option blocks"
```

---

### Task 6: `grade_mc_card` command

**Files:**
- Modify: `src-tauri/src/commands/notes.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `parse_mc_block`, `mc_block_option_count`, `is_mc_question_line` (Task 4), `mc_auto_grade` (Task 1), `grade_card_at` (existing), `McGradeResult` (Task 3).
- Produces: `grade_mc_card(path, position, picked, workspace) -> Result<McGradeResult, String>`, registered as a Tauri command.

- [ ] **Step 1: Write the failing tests**

Add near the existing `grade_card_at` tests in `src-tauri/src/commands/notes.rs`'s `mod save_tests`:

```rust
    #[tokio::test]
    async fn test_grade_mc_card_at_correct_pick_reports_the_answer_and_advances_grade() {
        let pool = DbPool::connect("sqlite::memory:").await.unwrap();
        run_migrations(&pool).await.unwrap();
        let tmp = tempdir().unwrap();
        let path = tmp.path().join("a.md");
        std::fs::write(&path, "Q ::\n- [ ] a\n- [x] b\n").unwrap();
        let path_str = path.to_string_lossy().into_owned();
        let ws = tmp.path().to_string_lossy().into_owned();
        index_note_at(&path_str, &ws, &std::fs::read_to_string(&path).unwrap(), &pool)
            .await
            .unwrap();

        let result = grade_mc_card_at(&path_str, 0, &[1], &ws, &pool).await.unwrap();

        assert_eq!(result.correct, vec![1]);
        let rewritten = std::fs::read_to_string(&path).unwrap();
        assert!(rewritten.contains("grade=good")); // no prior grade -> Hard baseline -> correct -> Good
    }

    #[tokio::test]
    async fn test_grade_mc_card_at_partial_multi_select_pick_is_still_wrong() {
        let pool = DbPool::connect("sqlite::memory:").await.unwrap();
        run_migrations(&pool).await.unwrap();
        let tmp = tempdir().unwrap();
        let path = tmp.path().join("a.md");
        std::fs::write(&path, "Q ::\n- [x] a\n- [x] b\n- [ ] c\n").unwrap();
        let path_str = path.to_string_lossy().into_owned();
        let ws = tmp.path().to_string_lossy().into_owned();
        index_note_at(&path_str, &ws, &std::fs::read_to_string(&path).unwrap(), &pool)
            .await
            .unwrap();

        let result = grade_mc_card_at(&path_str, 0, &[0], &ws, &pool).await.unwrap();

        assert_eq!(result.correct, vec![0, 1]);
        let rewritten = std::fs::read_to_string(&path).unwrap();
        assert!(rewritten.contains("grade=again")); // no prior grade -> Hard baseline -> incorrect -> Again
    }

    #[tokio::test]
    async fn test_grade_mc_card_at_reordered_picks_still_match() {
        let pool = DbPool::connect("sqlite::memory:").await.unwrap();
        run_migrations(&pool).await.unwrap();
        let tmp = tempdir().unwrap();
        let path = tmp.path().join("a.md");
        std::fs::write(&path, "Q ::\n- [x] a\n- [x] b\n- [ ] c\n").unwrap();
        let path_str = path.to_string_lossy().into_owned();
        let ws = tmp.path().to_string_lossy().into_owned();
        index_note_at(&path_str, &ws, &std::fs::read_to_string(&path).unwrap(), &pool)
            .await
            .unwrap();

        let result = grade_mc_card_at(&path_str, 0, &[1, 0], &ws, &pool).await.unwrap();

        assert!(std::fs::read_to_string(&path).unwrap().contains("grade=good"));
        assert_eq!(result.correct, vec![0, 1]);
    }

    #[tokio::test]
    async fn test_grade_mc_card_at_missing_note_purges_its_stale_card() {
        let pool = DbPool::connect("sqlite::memory:").await.unwrap();
        run_migrations(&pool).await.unwrap();
        index_note_at("/ws/gone.md", "/ws", "Q ::\n- [x] a\n", &pool)
            .await
            .unwrap();

        let result = grade_mc_card_at("/ws/gone.md", 0, &[0], "/ws", &pool).await;

        assert!(result.is_err());
        let due = db::notes::due_cards(&pool, "/ws", "9999-12-31").await.unwrap();
        assert!(due.is_empty());
    }
```

- [ ] **Step 2: Run to verify it fails**

Run (from `src-tauri/`): `cargo test grade_mc_card`
Expected: FAIL — "cannot find function `grade_mc_card_at`"

- [ ] **Step 3: Implement**

In `src-tauri/src/commands/notes.rs`, factor the existing NotFound-handling read out of `grade_card_at` into a shared helper (root-cause fix per the "fix once where all callers route through" rule — `grade_mc_card_at` needs the identical read-or-forget behavior):

```rust
// A card can outlive its note in the index: nothing purges a workspace
// scan's stale rows (see scan_workspace), so a note deleted outside the
// app (Explorer, a git pull) leaves its review_cards row queued forever.
// Reads are the one place that naturally discovers this, so clean up right
// here rather than guessing from a directory snapshot elsewhere. Shared by
// every grading path (grade_card_at, grade_mc_card_at) so this cleanup is
// written once, not duplicated per caller.
async fn read_note_or_forget(path: &str, db: &DbPool) -> anyhow::Result<String> {
    match tokio::fs::read_to_string(path).await {
        Ok(content) => Ok(content),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            forget_note(path, db).await?;
            anyhow::bail!("note no longer exists on disk; removed from review queue");
        }
        Err(e) => Err(e.into()),
    }
}
```

Replace the start of `grade_card_at` to use it:

```rust
async fn grade_card_at(
    path: &str,
    position: i64,
    grade: sm2::Grade,
    workspace: &str,
    db: &DbPool,
) -> anyhow::Result<()> {
    let content = read_note_or_forget(path, db).await?;
    let today = chrono::Utc::now().date_naive();
    let new_content = grade_card_line(&content, position, grade, today)
        .ok_or_else(|| anyhow::anyhow!("no card at line {position} in {path}"))?;
    write_atomic(Path::new(path), &new_content).await?;
    index_note_at(path, workspace, &new_content, db).await?;
    Ok(())
}
```

Add `grade_mc_card_at` and the command wrapper, near `grade_card`:

```rust
async fn grade_mc_card_at(
    path: &str,
    position: i64,
    picked: &[usize],
    workspace: &str,
    db: &DbPool,
) -> anyhow::Result<McGradeResult> {
    let content = read_note_or_forget(path, db).await?;
    let lines: Vec<&str> = content.lines().collect();
    let idx = usize::try_from(position)?;
    let trimmed = lines
        .get(idx)
        .ok_or_else(|| anyhow::anyhow!("no card at line {position} in {path}"))?
        .trim();
    if !is_mc_question_line(trimmed) {
        anyhow::bail!("line {position} in {path} is not a multiple-choice card");
    }
    let (_, _, correct) = parse_mc_block(&lines, idx)
        .ok_or_else(|| anyhow::anyhow!("no multiple-choice card at line {position} in {path}"))?;

    let mut picked_sorted = picked.to_vec();
    picked_sorted.sort_unstable();
    let mut correct_sorted = correct.clone();
    correct_sorted.sort_unstable();
    let is_correct = picked_sorted == correct_sorted;

    let option_count = mc_block_option_count(&lines, idx);
    let last_grade = lines
        .get(idx + 1 + option_count)
        .and_then(|l| parse_sr_comment(l))
        .and_then(|(_, _, _, _, grade)| grade);
    let resolved = sm2::mc_auto_grade(last_grade, is_correct);

    grade_card_at(path, position, resolved, workspace, db).await?;

    Ok(McGradeResult { correct })
}

#[tauri::command]
pub async fn grade_mc_card(
    path: String,
    position: i64,
    picked: Vec<usize>,
    workspace: String,
    db: State<'_, DbPool>,
) -> Result<McGradeResult, String> {
    grade_mc_card_at(&path, position, &picked, &workspace, &db)
        .await
        .map_err(|e| e.to_string())
}
```

Add `McGradeResult` to the `use crate::models::{...}` import list at the top of the file.

In `src-tauri/src/lib.rs`, add `commands::notes::grade_mc_card,` to the `generate_handler!` list, right after `commands::notes::grade_card,`.

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test grade_mc_card && cargo test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/notes.rs src-tauri/src/lib.rs
git commit -m "feat: add grade_mc_card command"
```

---

### Task 7: Persist MC data — `set_cards`/`due_cards`, `list_all_cards`

**Files:**
- Modify: `src-tauri/src/db/notes.rs`
- Modify: `src-tauri/src/commands/notes.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `review_cards.options`/`.grade` columns (Task 2), `ExtractedCard`/`DueCard`/`CardSummary` (Task 3).
- Produces: `db::notes::list_all_cards(pool, workspace) -> Result<Vec<CardSummary>>`; `commands::notes::list_all_cards(workspace) -> Result<Vec<CardSummary>, String>`, registered as a Tauri command.

- [ ] **Step 1: Write the failing tests**

Add to the `#[cfg(test)] mod tests` block in `src-tauri/src/db/notes.rs`:

```rust
    #[tokio::test]
    async fn test_set_cards_persists_mc_options_and_serves_them_via_due_cards() {
        let pool = make_pool().await;
        index_note(
            &pool,
            &NoteMetadata {
                id: "1".into(),
                title: "N".into(),
                path: "/ws/a.md".into(),
                workspace: "/ws".into(),
                updated_at: 0,
            },
        )
        .await
        .unwrap();
        let cards = vec![ExtractedCard {
            kind: CardKind::Mc,
            front: "Q".into(),
            back: String::new(),
            position: 0,
            due: None,
            ease: None,
            interval: None,
            reps: None,
            grade: None,
            options: vec!["a".into(), "b".into()],
            correct: vec![1],
        }];
        set_cards(&pool, "/ws/a.md", &cards).await.unwrap();

        let due = due_cards(&pool, "/ws", "9999-12-31").await.unwrap();
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].kind, "mc");
        assert_eq!(due[0].options, vec!["a", "b"]);
    }

    #[tokio::test]
    async fn test_due_cards_qa_card_has_empty_options() {
        let pool = make_pool().await;
        index_note(
            &pool,
            &NoteMetadata {
                id: "1".into(),
                title: "N".into(),
                path: "/ws/a.md".into(),
                workspace: "/ws".into(),
                updated_at: 0,
            },
        )
        .await
        .unwrap();
        let cards = vec![ExtractedCard {
            kind: CardKind::Qa,
            front: "Q".into(),
            back: "A".into(),
            position: 0,
            due: None,
            ease: None,
            interval: None,
            reps: None,
            grade: None,
            options: Vec::new(),
            correct: Vec::new(),
        }];
        set_cards(&pool, "/ws/a.md", &cards).await.unwrap();

        let due = due_cards(&pool, "/ws", "9999-12-31").await.unwrap();
        assert!(due[0].options.is_empty());
    }

    #[tokio::test]
    async fn test_list_all_cards_includes_cards_regardless_of_due_date_with_tags() {
        let pool = make_pool().await;
        index_note(
            &pool,
            &NoteMetadata {
                id: "1".into(),
                title: "N".into(),
                path: "/ws/a.md".into(),
                workspace: "/ws".into(),
                updated_at: 0,
            },
        )
        .await
        .unwrap();
        set_tags(&pool, "/ws/a.md", &["cs".into(), "algo".into()])
            .await
            .unwrap();
        let cards = vec![ExtractedCard {
            kind: CardKind::Qa,
            front: "Q".into(),
            back: "A".into(),
            position: 0,
            due: Some("2099-01-01".into()), // far future — would never show in due_cards
            ease: Some(2.5),
            interval: Some(30),
            reps: Some(2),
            grade: Some(sm2::Grade::Good),
            options: Vec::new(),
            correct: Vec::new(),
        }];
        set_cards(&pool, "/ws/a.md", &cards).await.unwrap();

        let all = list_all_cards(&pool, "/ws").await.unwrap();

        assert_eq!(all.len(), 1);
        assert_eq!(all[0].due, "2099-01-01");
        assert_eq!(all[0].interval, 30);
        let mut tags = all[0].tags.clone();
        tags.sort();
        assert_eq!(tags, vec!["algo", "cs"]);
    }
```

Check the top of `src-tauri/src/db/notes.rs`'s test module for its existing imports (`use super::*;` plus whatever it already brings in for `ExtractedCard`/`CardKind`/`NoteMetadata`) and add `use crate::sm2;` if `sm2::Grade` isn't already in scope there.

- [ ] **Step 2: Run to verify it fails**

Run (from `src-tauri/`): `cargo test db::notes::tests::test_set_cards_persists_mc`
Expected: FAIL — `due[0].options` doesn't exist yet / `list_all_cards` doesn't exist

- [ ] **Step 3: Implement**

Replace `set_cards` in `src-tauri/src/db/notes.rs`:

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
        let options = if card.options.is_empty() {
            None
        } else {
            Some(serde_json::to_string(&card.options)?)
        };
        sqlx::query(
            "INSERT INTO review_cards (note_path, kind, front, back, position, due, ease, interval, reps, options, grade)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
        .execute(pool)
        .await?;
    }
    Ok(())
}
```

Replace `due_cards`:

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
}

pub async fn due_cards(pool: &SqlitePool, workspace: &str, today: &str) -> Result<Vec<DueCard>> {
    let rows = sqlx::query_as::<_, DueCardRow>(
        "SELECT rc.note_path, n.title as note_title, rc.kind, rc.front, rc.back, rc.position, rc.options
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
        });
    }
    Ok(cards)
}
```

Add `list_all_cards`, after `due_cards`:

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
    tags: Option<String>,
}

pub async fn list_all_cards(pool: &SqlitePool, workspace: &str) -> Result<Vec<CardSummary>> {
    let rows = sqlx::query_as::<_, CardSummaryRow>(
        "SELECT rc.note_path, n.title as note_title, rc.kind, rc.front, rc.back,
                rc.position, rc.due, rc.interval,
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
            tags: r
                .tags
                .map(|t| t.split(',').map(String::from).collect())
                .unwrap_or_default(),
        })
        .collect())
}
```

Add to `src-tauri/src/commands/notes.rs`, near `list_due_cards`:

```rust
#[tauri::command]
pub async fn list_all_cards(
    workspace: String,
    db: State<'_, DbPool>,
) -> Result<Vec<CardSummary>, String> {
    db::notes::list_all_cards(&db, &workspace)
        .await
        .map_err(|e| e.to_string())
}
```

Add `CardSummary` to the `use crate::models::{...}` import list.

In `src-tauri/src/lib.rs`, add `commands::notes::list_all_cards,` to `generate_handler!`, after `commands::notes::list_due_cards,`.

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test db::notes:: && cargo test` (full backend suite — this task touches shared query paths)
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db/notes.rs src-tauri/src/commands/notes.rs src-tauri/src/lib.rs
git commit -m "feat: persist and serve MC options, add list_all_cards"
```

---

### Task 8: Backend cleanup pass

**Files:**
- Modify: `src-tauri/` (whichever files Tasks 1–7 touched)

- [ ] **Step 1: Run the full backend gate**

```bash
cargo fmt
cargo clippy -- -D warnings
cargo test
```

Fix anything either command flags (expected: none, if each task's steps were followed — this step exists because CI only checks `clippy`/`fmt` on `pull_request`/manual dispatch, not on push, so nothing else catches drift before it lands on `main`).

- [ ] **Step 2: Commit (only if Step 1 changed anything)**

```bash
git add -u
git commit -m "chore: fmt and clippy pass for flashcard backend work"
```

---

### Task 9: Frontend types and API bindings

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/lib/tauri.ts`

**Interfaces:**
- Produces: `DueCard.options: string[]`, `McGradeResult`, `CardSummary` (types); `api.notes.gradeMcCard`, `api.notes.listAllCards` (functions) — consumed by Tasks 10–12.

- [ ] **Step 1: Implement (types have no runtime behavior to test directly; correctness is exercised by every task that consumes them)**

In `src/types/index.ts`, change `DueCard` and add the two new interfaces, right after it:

```ts
export interface DueCard {
  notePath: string
  noteTitle: string
  kind: string
  front: string
  back: string
  position: number
  options: string[]
}

export interface McGradeResult {
  correct: number[]
}

export interface CardSummary {
  notePath: string
  noteTitle: string
  kind: string
  front: string
  back: string
  position: number
  due: string
  interval: number
  tags: string[]
}
```

In `src/lib/tauri.ts`, add `McGradeResult` and `CardSummary` to the type-only import from `'../types'`, and add two entries to `api.notes`, right after `gradeCard`:

```ts
    gradeMcCard: (path: string, position: number, picked: number[], workspace: string) =>
      invoke<McGradeResult>('grade_mc_card', { path, position, picked, workspace }),
    listAllCards: (workspace: string) =>
      invoke<CardSummary[]>('list_all_cards', { workspace }),
```

- [ ] **Step 2: Verify the frontend still typechecks**

Run: `npm run typecheck`
Expected: FAIL — `ReviewSession.test.tsx`'s `DueCard` fixtures are missing the now-required `options` field. This is expected; Task 10 fixes it. If you're executing tasks strictly in order and want a clean typecheck at every commit, add `options: []` to both fixtures in that test file as part of this task instead of deferring to Task 10.

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts src/lib/tauri.ts
git commit -m "feat: add frontend types and API bindings for MC cards and deck view"
```

---

### Task 10: MC review flow in `ReviewSession`

**Files:**
- Modify: `src/components/ReviewSession.tsx`
- Modify: `src/components/ReviewSession.test.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: `api.notes.gradeMcCard`, `DueCard.options`, `McGradeResult` (Task 9).

- [ ] **Step 1: Write the failing tests**

Add to `src/components/ReviewSession.test.tsx`. First, update the mock and fixtures at the top of the file:

```ts
vi.mock('../lib/tauri', () => ({
  api: {
    notes: {
      listDueCards: vi.fn(),
      gradeCard: vi.fn(),
      gradeMcCard: vi.fn(),
    },
  },
}))

const cards: DueCard[] = [
  { notePath: '/ws/a.md', noteTitle: 'A', kind: 'qa', front: 'Q1', back: 'A1', position: 0, options: [] },
  { notePath: '/ws/b.md', noteTitle: 'B', kind: 'cloze', front: 'Q2 [...]', back: 'Q2 full', position: 3, options: [] },
]

const mcCard: DueCard = {
  notePath: '/ws/c.md',
  noteTitle: 'C',
  kind: 'mc',
  front: 'What is 2+2?',
  back: '',
  position: 0,
  options: ['3', '4', '5'],
}
```

Then add a new `describe` block at the end of the file:

```ts
describe('ReviewSession — multiple choice', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ path: '/ws' })
    vi.mocked(api.notes.listDueCards).mockResolvedValue([mcCard])
  })

  it('renders options as checkboxes with Submit disabled until a pick', async () => {
    render(<ReviewSession onClose={vi.fn()} />)
    await waitFor(() => screen.getByText('What is 2+2?'))
    expect(screen.getByText('Submit')).toBeDisabled()
    fireEvent.click(screen.getByLabelText('4'))
    expect(screen.getByText('Submit')).not.toBeDisabled()
  })

  it('submits picked options and highlights correct/incorrect after grading', async () => {
    vi.mocked(api.notes.gradeMcCard).mockResolvedValue({ correct: [1] })
    render(<ReviewSession onClose={vi.fn()} />)
    await waitFor(() => screen.getByText('What is 2+2?'))
    fireEvent.click(screen.getByLabelText('3'))
    fireEvent.click(screen.getByText('Submit'))

    await waitFor(() => expect(api.notes.gradeMcCard).toHaveBeenCalledWith('/ws/c.md', 0, [0], '/ws'))
    expect(screen.getByLabelText('3').closest('li')).toHaveClass('review-card-option-incorrect')
    expect(screen.getByLabelText('4').closest('li')).toHaveClass('review-card-option-missed')
    expect(screen.getByText('Next')).toBeInTheDocument()
    expect(screen.getByLabelText('3')).toBeDisabled()
  })

  it('Next re-fetches the due queue', async () => {
    vi.mocked(api.notes.gradeMcCard).mockResolvedValue({ correct: [1] })
    let refetched = false
    vi.mocked(api.notes.listDueCards).mockImplementation(async () => (refetched ? [] : [mcCard]))
    render(<ReviewSession onClose={vi.fn()} />)
    await waitFor(() => screen.getByText('What is 2+2?'))
    fireEvent.click(screen.getByLabelText('4'))
    fireEvent.click(screen.getByText('Submit'))
    await waitFor(() => screen.getByText('Next'))
    refetched = true
    fireEvent.click(screen.getByText('Next'))
    await waitFor(() => expect(screen.getByText(/all done/i)).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- ReviewSession`
Expected: FAIL — no MC branch exists yet in `ReviewSession.tsx`

- [ ] **Step 3: Implement**

Replace the contents of `src/components/ReviewSession.tsx`:

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
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [mcResult, setMcResult] = useState<number[] | null>(null)

  useEffect(() => {
    if (!workspacePath) return
    setIsLoading(true)
    api.notes.listDueCards(workspacePath).then((cards) => {
      setQueue(cards)
      setIsLoading(false)
    })
  }, [workspacePath])

  const current = queue[0]

  // Resets per-card UI state whenever the front card changes — including
  // right after grading, since a new due-queue fetch always produces a new
  // `current` object even if the same note comes up again.
  useEffect(() => {
    setPicked(new Set())
    setMcResult(null)
  }, [current?.notePath, current?.position])

  function refetch() {
    if (!workspacePath) return
    api.notes.listDueCards(workspacePath).then((cards) => {
      setQueue(cards)
      setRevealed(false)
    })
  }

  // Grades the front card, then re-fetches the whole due queue — unlike
  // `TaskView.toggle`'s "drop it from local state" shortcut, a card's
  // position is a line number, and grading writes a schedule-comment line
  // into the note. If another due card sits later in the same note, that
  // insertion shifts its own position too, so the locally cached queue can
  // no longer be trusted after any grade — only a fresh read reflects it.
  function grade(g: Grade) {
    if (!workspacePath || !current) return
    // Grading can fail if the note was deleted outside the app (the backend
    // then drops its stale queue entry on its own) — refetch regardless so a
    // ghost card can't get stuck un-gradeable forever.
    void api.notes
      .gradeCard(current.notePath, current.position, g, workspacePath)
      .catch(() => {})
      .then(refetch)
  }

  function togglePick(i: number) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  function submitMc() {
    if (!workspacePath || !current) return
    void api.notes
      .gradeMcCard(current.notePath, current.position, Array.from(picked), workspacePath)
      .then((result) => setMcResult(result.correct))
  }

  function optionClass(i: number): string {
    if (!mcResult) return ''
    const isPicked = picked.has(i)
    const isCorrect = mcResult.includes(i)
    if (isPicked && isCorrect) return ' review-card-option-correct'
    if (isPicked && !isCorrect) return ' review-card-option-incorrect'
    if (!isPicked && isCorrect) return ' review-card-option-missed'
    return ''
  }

  return (
    <div className="search-overlay" onMouseDown={onClose}>
      <div className="review-session" onMouseDown={(e) => e.stopPropagation()}>
        <div className="settings-panel-header">
          <h2>Review{queue.length > 0 ? ` (${queue.length} due)` : ''}</h2>
          <button className="settings-panel-close" onClick={onClose} aria-label="Close review" title="Close review">
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
            {current.kind === 'mc' ? (
              <>
                <ul className="review-card-options">
                  {current.options.map((opt, i) => (
                    <li key={i} className={`review-card-option${optionClass(i)}`}>
                      <label>
                        <input
                          type="checkbox"
                          checked={picked.has(i)}
                          disabled={mcResult !== null}
                          onChange={() => togglePick(i)}
                          aria-label={opt}
                        />
                        {opt}
                      </label>
                    </li>
                  ))}
                </ul>
                {mcResult === null ? (
                  <button className="review-card-reveal" disabled={picked.size === 0} onClick={submitMc}>
                    Submit
                  </button>
                ) : (
                  <button className="review-card-reveal" onClick={refetch}>
                    Next
                  </button>
                )}
              </>
            ) : revealed ? (
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

Add to `src/index.css`, right after the existing `.review-card-grade:hover` rule (~line 3471):

```css
.review-card-options {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.review-card-option label {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: 6px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  font-size: 13px;
  color: var(--text-primary);
  cursor: pointer;
}

.review-card-option-correct label { border-color: var(--success, #3fb950); color: var(--success, #3fb950); }
.review-card-option-incorrect label { border-color: var(--danger, #f85149); color: var(--danger, #f85149); }
.review-card-option-missed label { border-color: var(--warning, #d29922); }
```

(If `--success`/`--danger`/`--warning` aren't already defined as CSS custom properties elsewhere in `index.css`, keep the literal fallback hex values shown above — check for an existing callout-type color set, e.g. near `.callout-danger`/`.callout-warning`, and reuse those tokens instead of the fallbacks if present.)

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- ReviewSession && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/ReviewSession.tsx src/components/ReviewSession.test.tsx src/index.css
git commit -m "feat: add multiple-choice review flow to ReviewSession"
```

---

### Task 11: `/flashcard` slash command and `FlashcardTypeDialog`

**Files:**
- Modify: `src/editor/extensions/NoteContext.ts`
- Modify: `src/editor/extensions/SlashCommands.tsx`
- Modify: `src/editor/NoteEditor.tsx`
- Create: `src/components/FlashcardTypeDialog.tsx`
- Modify: `src/hooks/useOverlayManager.ts`
- Modify: `src/components/Layout.tsx`
- Create: `src/components/FlashcardTypeDialog.test.tsx`

**Interfaces:**
- Consumes: `Cmd`/`SlashMenu` pattern (existing, `SlashCommands.tsx`), `Dialog`/`DialogContent`/`DialogTitle` shell (existing, `components/ui/dialog`).
- Produces: a bridge from the slash command (which only has access to `editor`/`range`) to app-level overlay state, the same shape `editor.storage.noteContext.notePath` already bridges `notePath` — `openFlashcardDialog(editor, range)` is set by `NoteEditor` from a new `onFlashcardCommand` prop threaded from `Layout`.

- [ ] **Step 1: Write the failing test**

Create `src/components/FlashcardTypeDialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FlashcardTypeDialog } from './FlashcardTypeDialog'

describe('FlashcardTypeDialog', () => {
  it('inserts the Q&A stub', () => {
    const onPick = vi.fn()
    render(<FlashcardTypeDialog onPick={onPick} onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Q&A'))
    expect(onPick).toHaveBeenCalledWith('Question :: Answer')
  })

  it('inserts the Cloze stub', () => {
    const onPick = vi.fn()
    render(<FlashcardTypeDialog onPick={onPick} onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Cloze'))
    expect(onPick).toHaveBeenCalledWith('Text with {{hidden}} span.')
  })

  it('inserts the Multiple choice stub', () => {
    const onPick = vi.fn()
    render(<FlashcardTypeDialog onPick={onPick} onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Multiple choice'))
    expect(onPick).toHaveBeenCalledWith(
      'Question ::\n- [ ] Option\n- [x] Correct option\n- [ ] Option',
    )
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- FlashcardTypeDialog`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Implement**

Create `src/components/FlashcardTypeDialog.tsx`:

```tsx
import { X } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'

interface FlashcardTypeDialogProps {
  onPick: (stub: string) => void
  onClose: () => void
}

interface FlashcardType {
  label: string
  description: string
  stub: string
}

const FLASHCARD_TYPES: FlashcardType[] = [
  { label: 'Q&A', description: 'Free-response, self-graded', stub: 'Question :: Answer' },
  { label: 'Cloze', description: 'Fill-in-the-blank span', stub: 'Text with {{hidden}} span.' },
  {
    label: 'Multiple choice',
    description: 'One or more correct options, auto-graded',
    stub: 'Question ::\n- [ ] Option\n- [x] Correct option\n- [ ] Option',
  },
]

export function FlashcardTypeDialog({ onPick, onClose }: FlashcardTypeDialogProps) {
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="settings-panel" showCloseButton={false}>
        <div className="settings-panel-header">
          <DialogTitle asChild>
            <h2>Insert Flashcard</h2>
          </DialogTitle>
          <button className="settings-panel-close" onClick={onClose} aria-label="Close" title="Close">
            <X size={16} />
          </button>
        </div>
        <div className="template-list">
          {FLASHCARD_TYPES.map((t) => (
            <button key={t.label} className="import-mode-option" onClick={() => onPick(t.stub)}>
              <span>
                <strong>{t.label}</strong>
                <small>{t.description}</small>
              </span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

Update `src/editor/extensions/NoteContext.ts`:

```ts
import { Extension } from '@tiptap/core'
import type { Editor, Range } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Storage {
    noteContext: {
      notePath: string
      // Bridges the /flashcard slash command (which only has access to the
      // editor and the range it fired from, not app-level React state) to
      // Layout's overlay — the same shape notePath already bridges for
      // Ink Block/Diagram, but for a callback instead of a plain value.
      openFlashcardDialog: ((editor: Editor, range: Range) => void) | null
    }
  }
}

export const NoteContext = Extension.create({
  name: 'noteContext',
  addStorage() {
    return { notePath: '' as string, openFlashcardDialog: null }
  },
})
```

In `src/editor/extensions/SlashCommands.tsx`, add one entry to `COMMANDS`, right after the `'Ink Block'` entry:

```ts
  {
    title: 'Flashcard',
    description: 'Q&A, cloze, or multiple-choice review card',
    run: ({ editor, range }) => {
      editor.storage.noteContext.openFlashcardDialog?.(editor, range)
    },
  },
```

In `src/editor/NoteEditor.tsx`, add a new prop and wire it into storage. Change the props interface:

```ts
interface NoteEditorProps {
  content: string
  notePath: string
  spellcheck: boolean
  spellcheckLanguage: string
  onChange: (markdown: string) => void
  onFlashcardCommand: (editor: Editor, range: Range) => void
}
```

(Add `import type { Editor, Range } from '@tiptap/core'` — `Editor`/`TextSelection` are already imported from `@tiptap/pm/state`/`@tiptap/react` in this file; add `Range` alongside whichever of the two already carries `Editor`, or add a fresh import line if neither does.)

Change the function signature:

```ts
export function NoteEditor({
  content,
  notePath,
  spellcheck,
  spellcheckLanguage,
  onChange,
  onFlashcardCommand,
}: NoteEditorProps) {
```

Extend the existing `notePath` storage-bridging effect (the one at `editor.storage.noteContext.notePath = notePath`):

```ts
  useEffect(() => {
    if (!editor) return
    editor.storage.noteContext.notePath = notePath
    editor.storage.noteContext.openFlashcardDialog = onFlashcardCommand
  }, [editor, notePath, onFlashcardCommand])
```

Update `src/hooks/useOverlayManager.ts`'s `OverlayKind`:

```ts
export type OverlayKind =
  | 'search'
  | 'switcher'
  | 'settings'
  | 'shortcuts'
  | 'template'
  | 'graph'
  | 'task'
  | 'review'
  | 'formulaSheet'
  | 'exportPdf'
  | 'print'
  | 'flashcard'
  | 'deck'
```

In `src/components/Layout.tsx`:

Add the import: `import { FlashcardTypeDialog } from './FlashcardTypeDialog'`.

Add state for the pending insert, near the other `useState` calls:

```ts
  const [pendingFlashcardInsert, setPendingFlashcardInsert] = useState<
    { editor: Editor; range: Range } | null
  >(null)
```

(Import `Editor`, `Range` types from `'@tiptap/core'`.)

Add a handler, near where other `NoteEditor`-facing callbacks are defined:

```ts
  const handleFlashcardCommand = useCallback((editor: Editor, range: Range) => {
    setPendingFlashcardInsert({ editor, range })
    openOverlay('flashcard')
  }, [openOverlay])
```

Pass it to `NoteEditor`:

```tsx
                <NoteEditor
                  content={content}
                  notePath={activeTab}
                  spellcheck={settings.spellcheck}
                  spellcheckLanguage={settings.spellcheckLanguage}
                  onChange={(md) => void save(md)}
                  onFlashcardCommand={handleFlashcardCommand}
                />
```

Render the dialog, alongside the other `activeOverlay === '...'` blocks:

```tsx
        {activeOverlay === 'flashcard' && pendingFlashcardInsert && (
          <FlashcardTypeDialog
            onPick={(stub) => {
              const { editor, range } = pendingFlashcardInsert
              editor.chain().focus().deleteRange(range).insertContent(stub).run()
              setPendingFlashcardInsert(null)
              closeOverlay()
            }}
            onClose={() => {
              setPendingFlashcardInsert(null)
              closeOverlay()
            }}
          />
        )}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- FlashcardTypeDialog && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/editor/extensions/NoteContext.ts src/editor/extensions/SlashCommands.tsx src/editor/NoteEditor.tsx src/components/FlashcardTypeDialog.tsx src/components/FlashcardTypeDialog.test.tsx src/hooks/useOverlayManager.ts src/components/Layout.tsx
git commit -m "feat: add /flashcard slash command and type-picker dialog"
```

---

### Task 12: Deck view

**Files:**
- Create: `src/lib/cardGroups.ts`
- Create: `src/lib/cardGroups.test.ts`
- Create: `src/components/DeckView.tsx`
- Create: `src/components/DeckView.test.tsx`
- Modify: `src/components/HomeView.tsx`
- Modify: `src/components/HomeView.test.tsx`
- Modify: `src/components/Layout.tsx`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: `api.notes.listAllCards`, `CardSummary` (Task 9), `groupByNote`'s shape (existing, `lib/taskGroups.ts`, not reused directly — `CardSummary` isn't `OpenTask`).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/cardGroups.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { groupCardsByNote } from './cardGroups'
import type { CardSummary } from '../types'

const card = (over: Partial<CardSummary>): CardSummary => ({
  notePath: '/ws/a.md',
  noteTitle: 'A',
  kind: 'qa',
  front: 'Q',
  back: 'A',
  position: 0,
  due: '2026-01-01',
  interval: 0,
  tags: [],
  ...over,
})

describe('groupCardsByNote', () => {
  it('groups cards under their note, preserving arrival order', () => {
    const cards = [
      card({ notePath: '/ws/a.md', position: 0 }),
      card({ notePath: '/ws/b.md', noteTitle: 'B', position: 0 }),
      card({ notePath: '/ws/a.md', position: 1 }),
    ]
    const groups = groupCardsByNote(cards)
    expect(groups.map((g) => g.notePath)).toEqual(['/ws/a.md', '/ws/b.md'])
    expect(groups[0]!.cards).toHaveLength(2)
    expect(groups[1]!.cards).toHaveLength(1)
  })
})
```

Create `src/components/DeckView.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DeckView } from './DeckView'
import { api } from '../lib/tauri'
import { useWorkspaceStore } from '../store/workspace'
import type { CardSummary } from '../types'

vi.mock('../lib/tauri', () => ({
  api: { notes: { listAllCards: vi.fn() } },
}))

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
    tags: ['algo'],
  },
]

beforeEach(() => {
  useWorkspaceStore.setState({ path: '/ws' })
  vi.mocked(api.notes.listAllCards).mockResolvedValue(cards)
})

describe('DeckView', () => {
  it('renders every card grouped by note', async () => {
    render(<DeckView onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Q1')).toBeInTheDocument())
    expect(screen.getByText('Q2')).toBeInTheDocument()
  })

  it('shows total, due, and mastered counts', async () => {
    render(<DeckView onClose={vi.fn()} />)
    await waitFor(() => screen.getByText('Q1'))
    expect(screen.getByText('2')).toBeInTheDocument() // total
  })

  it('narrows the list by tag', async () => {
    render(<DeckView onClose={vi.fn()} />)
    await waitFor(() => screen.getByText('Q1'))
    fireEvent.click(screen.getByLabelText('cs'))
    expect(screen.getByText('Q1')).toBeInTheDocument()
    expect(screen.queryByText('Q2')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- cardGroups DeckView`
Expected: FAIL — neither module exists yet

- [ ] **Step 3: Implement**

Create `src/lib/cardGroups.ts`:

```ts
import type { CardSummary } from '../types'

export interface CardGroup {
  notePath: string
  noteTitle: string
  cards: CardSummary[]
}

// list_all_cards orders by note title then position (matching due_cards'
// own ordering), so grouping here only has to preserve arrival order rather
// than re-sort — same shape as lib/taskGroups.ts's groupByNote, kept as its
// own function since CardSummary isn't OpenTask.
export function groupCardsByNote(cards: CardSummary[]): CardGroup[] {
  const groups: CardGroup[] = []
  const byPath = new Map<string, CardGroup>()
  for (const card of cards) {
    let group = byPath.get(card.notePath)
    if (!group) {
      group = { notePath: card.notePath, noteTitle: card.noteTitle, cards: [] }
      byPath.set(card.notePath, group)
      groups.push(group)
    }
    group.cards.push(card)
  }
  return groups
}
```

Create `src/components/DeckView.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { api } from '../lib/tauri'
import { useWorkspaceStore } from '../store/workspace'
import { groupCardsByNote } from '../lib/cardGroups'
import type { CardSummary } from '../types'

interface DeckViewProps {
  onClose: () => void
}

// The conventional SRS "graduated" threshold — a display bucket only, not a
// new scheduling concept.
const MASTERED_INTERVAL_DAYS = 21

function isDueToday(due: string): boolean {
  return due <= new Date().toISOString().slice(0, 10)
}

export function DeckView({ onClose }: DeckViewProps) {
  const workspacePath = useWorkspaceStore((s) => s.path)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const [cards, setCards] = useState<CardSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!workspacePath) return
    setIsLoading(true)
    api.notes.listAllCards(workspacePath).then((c) => {
      setCards(c)
      setIsLoading(false)
    })
  }, [workspacePath])

  const allTags = useMemo(
    () => Array.from(new Set(cards.flatMap((c) => c.tags))).sort(),
    [cards],
  )

  const filtered = useMemo(
    () =>
      activeTags.size === 0
        ? cards
        : cards.filter((c) => c.tags.some((t) => activeTags.has(t))),
    [cards, activeTags],
  )

  const groups = useMemo(() => groupCardsByNote(filtered), [filtered])
  const dueCount = useMemo(() => cards.filter((c) => isDueToday(c.due)).length, [cards])
  const masteredCount = useMemo(
    () => cards.filter((c) => c.interval >= MASTERED_INTERVAL_DAYS).length,
    [cards],
  )

  function toggleTag(tag: string) {
    setActiveTags((prev) => {
      const next = new Set(prev)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })
  }

  function openNote(path: string) {
    openTab(path)
    onClose()
  }

  return (
    <div className="search-overlay" onMouseDown={onClose}>
      <div className="task-view deck-view" onMouseDown={(e) => e.stopPropagation()}>
        <div className="settings-panel-header">
          <h2>All Cards</h2>
          <button className="settings-panel-close" onClick={onClose} aria-label="Close deck view" title="Close deck view">
            <X size={16} />
          </button>
        </div>
        {isLoading ? (
          <p className="status">Loading…</p>
        ) : cards.length === 0 ? (
          <p className="empty-state">No flashcards in this workspace yet.</p>
        ) : (
          <>
            <div className="deck-view-stats">
              <span>{cards.length}</span>
              <span>{dueCount} due</span>
              <span>{masteredCount} mastered</span>
            </div>
            {allTags.length > 0 && (
              <div className="deck-view-tags">
                {allTags.map((tag) => (
                  <label key={tag} className="deck-view-tag">
                    <input
                      type="checkbox"
                      checked={activeTags.has(tag)}
                      onChange={() => toggleTag(tag)}
                      aria-label={tag}
                    />
                    {tag}
                  </label>
                ))}
              </div>
            )}
            <div className="task-view-list">
              {groups.map((group) => (
                <div key={group.notePath} className="task-view-group">
                  <button className="task-view-note-title" onClick={() => openNote(group.notePath)}>
                    {group.noteTitle}
                  </button>
                  <ul>
                    {group.cards.map((c) => (
                      <li key={c.position} className="task-view-item">
                        <span className="task-view-item-text">{c.front}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
```

Add to `src/index.css`, after the `.review-card-option-missed` rule added in Task 10:

```css
.deck-view-stats {
  display: flex;
  gap: var(--space-lg);
  font-size: 12px;
  color: var(--text-tertiary);
}

.deck-view-tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
}

.deck-view-tag {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
}
```

Update `src/components/HomeView.tsx`: add `onOpenDeckView: () => void` to `HomeViewProps`, destructure it in the function signature, and add a second button next to "Start review":

```tsx
            <p className="home-count">{dueCards.length} due</p>
            <button className="home-view-all" onClick={onOpenReview}>
              Start review
            </button>
            <button className="home-view-all" onClick={onOpenDeckView}>
              Browse all cards
            </button>
```

Update `src/components/HomeView.test.tsx`: add `onOpenDeckView={vi.fn()}` to every `render(<HomeView .../>)` call in that file (search for the existing prop list and extend it the same way `onOpenReview`/`onOpenTaskView` are already passed).

In `src/components/Layout.tsx`:

Add the import: `import { DeckView } from './DeckView'`.

Add a `case` to the `runCommand` switch, right after `case 'review':`:

```ts
        case 'deck-view':
          if (workspacePath) openOverlay('deck')
          break
```

Render the overlay, alongside `{activeOverlay === 'review' && ...}`:

```tsx
        {activeOverlay === 'deck' && <DeckView onClose={closeOverlay} />}
```

Pass the new prop to `HomeView`:

```tsx
                <HomeView
                  onOpenTaskView={() => openOverlay('task')}
                  onOpenReview={() => openOverlay('review')}
                  onOpenDeckView={() => openOverlay('deck')}
                  onOpenSettings={() => openOverlay('settings')}
                />
```

In `src-tauri/src/lib.rs`, add a new menu item right after the existing `"review"` entry in `build_menu`:

```rust
            &MenuItem::with_id(
                handle,
                "deck-view",
                "Browse All Cards",
                true,
                Some("CmdOrCtrl+Shift+D"),
            )?,
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- cardGroups DeckView HomeView && npm run typecheck`
Expected: PASS

Run (from `src-tauri/`): `cargo check`
Expected: PASS (menu item change only, no logic to test)

- [ ] **Step 5: Commit**

```bash
git add src/lib/cardGroups.ts src/lib/cardGroups.test.ts src/components/DeckView.tsx src/components/DeckView.test.tsx src/components/HomeView.tsx src/components/HomeView.test.tsx src/components/Layout.tsx src-tauri/src/lib.rs src/index.css
git commit -m "feat: add deck view for browsing all flashcards"
```

---

### Task 13: Full-suite verification and E2E card

**Files:**
- None created — this task is a verification pass plus one new e2e spec.
- Create: `e2e/specs/flashcards.spec.ts` (check `e2e/specs/` for the exact existing naming convention — e.g. `*.spec.ts` vs `*.e2e.ts` — and match it; look at an existing spec such as the one covering task view or review session for the harness's setup/teardown boilerplate before writing this one).

- [ ] **Step 1: Run the full backend and frontend gates**

```bash
cd src-tauri && cargo fmt --check && cargo clippy -- -D warnings && cargo test
cd .. && npm run typecheck && npm test
```

Expected: PASS across the board.

- [ ] **Step 2: Write and run the E2E spec**

Following whatever pattern the existing review-session or task-view e2e spec uses (see `.claude/skills/e2e-verify/` for the harness's conventions — native dialogs, the `--workspace` arg, click/type timing, save debounce), write a spec that:
1. Creates a note with an MC card (`Question ::\n- [ ] wrong\n- [x] right\n`).
2. Opens the review session, picks the wrong option, submits, and confirms the schedule comment lands with `grade=again`.
3. Advances a mocked date, reviews the same card again, picks the right option, and confirms the schedule comment moves to `grade=good`.
4. Opens the deck view and confirms the card appears with its note title.

Run: `npm run test:e2e`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add e2e/specs/flashcards.spec.ts
git commit -m "test: add end-to-end coverage for MC flashcards and the deck view"
```

---

## Self-Review Notes

- **Spec coverage:** MC syntax + task/card collision (Task 4), auto-grade ladder (Task 1) and the `grade=` field (Tasks 2, 4, 5), data model (Task 3), `grade_mc_card`/`list_all_cards` commands (Tasks 6–7), `ReviewSession` MC UI (Task 10), `FlashcardTypeDialog` + `/flashcard` (Task 11), `DeckView` + entry points (Task 12), out-of-scope items are called out in Global Constraints rather than built. All three spec Testing bullets (Rust, Vitest, E2E) map onto a task each.
- **Known deviation from the spec text:** `list_tags`/`GROUP_CONCAT` — the spec says `list_all_cards` uses "the same aggregation shape `list_tags` already does per-note elsewhere," but `list_tags` (`db/notes.rs`) is a flat distinct-tag list with no `GROUP_CONCAT`; there is no existing per-note tag aggregation anywhere in this codebase. Task 7 introduces the `GROUP_CONCAT`/row-then-map pattern from scratch rather than reusing something that doesn't exist.
- **`DueCard` derive change:** the spec doesn't mention it, but adding a JSON-encoded `options` column forces `DueCard` off a direct `sqlx::FromRow` derive (Task 3/7) — `serde_json::from_str` can't happen inside a derive macro, so `due_cards` now builds `DueCard` from a private `DueCardRow` by hand, the same pattern Task 7 introduces for `CardSummary`/`CardSummaryRow`.

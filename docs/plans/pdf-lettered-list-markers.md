# PDF List-Marker Recognition Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (default) or superpowers:subagent-driven-development if explicitly requested.

**Goal:** Fix three related gaps in the PDF import pipeline's list handling: ordered items with a letter/roman marker (`(a)`, `iv)`) all render as the literal, non-incrementing `1.` instead of `1.`/`2.`/`3.` and never nest under a numbered parent; the same letter convention isn't recognized at all without its wrapping parens (`a)` vs `(a)`); and a bullet symbol pdfium can only decode as the control codepoint `U+0088` (collapsed to `U+FFFD` upstream) isn't recognized as a bullet marker at all.

**Architecture:** All three fixes live in `src-tauri/src/pdf/layout.rs`, entirely inside `list_marker()` (the leading-marker recognizer) and a new post-processing pass, `assign_list_numbers()`, that runs once at the end of `group_blocks()`. No pdfium types, no new public API, no changes to `Marker` or `Block::ListItem`'s existing fields.

**Tech Stack:** Rust, `cargo test` (synthetic `CharBox` fixtures in `layout_tests.rs` — no pdfium needed to test any of this).

## Global Constraints

- `layout.rs` must stay pdfium-free — plain `CharBox` input only (CLAUDE.md, "The PDF pipeline").
- No `.unwrap()`/`.expect()` outside tests; propagate with `?` (CLAUDE.md, "Rust Guidelines"). None of the code in this plan can fail, so this mostly means: don't introduce one while editing nearby.
- `cargo clippy -- -D warnings` must stay clean before any commit in this plan.
- No comments unless the WHY is non-obvious — match the file's existing voice (see any doc comment in `layout.rs` for the register: explain the reasoning and the document that motivated it, not what the code does).
- Full design rationale: `docs/specs/pdf-lettered-list-markers-design.md`.

---

## Task 1: Auto-number ordered list items and force-nest lettered sub-parts

**Files:**
- Modify: `src-tauri/src/pdf/layout.rs` — imports (~line 12-14), `group_blocks` (~line 1979-2050)
- Test: `src-tauri/src/pdf/layout_tests.rs` — update `a_sub_part_label_becomes_a_list_item` (~line 1007-1017), add new tests near it

**Interfaces:**
- Consumes: the existing `Block` enum (`layout.rs:196-217`) — specifically `Block::Heading { .. }` and `Block::ListItem { ordered: bool, number: Option<u32>, depth: usize, content: Vec<Inline> }`, unchanged. Consumes the existing `(a)`/`(iv)` parenthesized-marker recognition already in `list_marker()` (no changes to `list_marker` in this task).
- Produces: a private `fn assign_list_numbers(blocks: &mut [Block])`, called automatically at the end of `group_blocks()`. No new public API — every caller of `group_blocks`/`chars_to_markdown`/`chars_and_images_to_markdown` gets correct numbering and nesting for free. Tasks 2 and 3 rely on this already running.

- [ ] **Step 1: Update the existing test to assert the correct (currently failing) behavior**

Open `src-tauri/src/pdf/layout_tests.rs` and find:

```rust
#[test]
fn a_sub_part_label_becomes_a_list_item() {
    let mut chars = page(&["Answer each of the parts below in turn."]);
    chars.extend(set("(a) the first part", 72.0, 660.0, Style::default()));
    chars.extend(set("(b) the second part", 72.0, 648.0, Style::default()));

    let markdown = chars_to_markdown(&chars);

    assert!(markdown.contains("1. the first part"), "got: {markdown}");
    assert!(markdown.contains("1. the second part"), "got: {markdown}");
}
```

Change the last assertion so the two items are numbered `1.` and `2.` rather than both `1.`:

```rust
#[test]
fn a_sub_part_label_becomes_a_list_item() {
    let mut chars = page(&["Answer each of the parts below in turn."]);
    chars.extend(set("(a) the first part", 72.0, 660.0, Style::default()));
    chars.extend(set("(b) the second part", 72.0, 648.0, Style::default()));

    let markdown = chars_to_markdown(&chars);

    assert!(markdown.contains("1. the first part"), "got: {markdown}");
    assert!(markdown.contains("2. the second part"), "got: {markdown}");
}
```

Immediately below that test, add three more:

```rust
#[test]
fn a_lettered_sub_part_nests_under_its_digit_numbered_parent() {
    let mut chars = page(&["Answer the following."]);
    chars.extend(set("1. Solve the system:", 72.0, 660.0, Style::default()));
    chars.extend(set("(a) find the fixed points", 72.0, 648.0, Style::default()));
    chars.extend(set("(b) classify each one", 72.0, 636.0, Style::default()));

    let markdown = chars_to_markdown(&chars);

    assert!(markdown.contains("1. Solve the system:"), "got: {markdown}");
    assert!(markdown.contains("  1. find the fixed points"), "got: {markdown}");
    assert!(markdown.contains("  2. classify each one"), "got: {markdown}");
}

#[test]
fn each_digit_items_own_sub_list_restarts_its_own_numbering() {
    let mut chars = page(&["Two exercises, each with two sub-parts."]);
    chars.extend(set("1. First exercise", 72.0, 660.0, Style::default()));
    chars.extend(set("(a) part one", 72.0, 648.0, Style::default()));
    chars.extend(set("(b) part two", 72.0, 636.0, Style::default()));
    chars.extend(set("2. Second exercise", 72.0, 624.0, Style::default()));
    chars.extend(set("(a) part one", 72.0, 612.0, Style::default()));
    chars.extend(set("(b) part two", 72.0, 600.0, Style::default()));

    let markdown = chars_to_markdown(&chars);

    assert_eq!(markdown.matches("  1. part one").count(), 2, "got: {markdown}");
    assert_eq!(markdown.matches("  2. part two").count(), 2, "got: {markdown}");
}

#[test]
fn a_heading_resets_running_list_numbering() {
    let mut chars = set("Warm-up", 72.0, 700.0, Style { size: 15.0, ..Style::default() });
    chars.extend(set("(a) first warm-up part", 72.0, 680.0, Style::default()));
    chars.extend(set("(b) second warm-up part", 72.0, 668.0, Style::default()));
    chars.extend(set("Main Task", 72.0, 648.0, Style { size: 15.0, ..Style::default() }));
    chars.extend(set("(a) first main part", 72.0, 628.0, Style::default()));
    chars.extend(set("(b) second main part", 72.0, 616.0, Style::default()));

    let markdown = chars_to_markdown(&chars);

    assert_eq!(markdown.matches("1. first").count(), 2, "got: {markdown}");
    assert_eq!(markdown.matches("2. second").count(), 2, "got: {markdown}");
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `src-tauri/`): `cargo test --lib a_sub_part_label_becomes_a_list_item a_lettered_sub_part_nests_under_its_digit_numbered_parent each_digit_items_own_sub_list_restarts_its_own_numbering a_heading_resets_running_list_numbering -- --nocapture`

Expected: all four `FAIL` — every `(a)`/`(b)` item currently renders the literal `1.` with no nesting.

- [ ] **Step 3: Add the `BTreeMap` import**

In `src-tauri/src/pdf/layout.rs`, find:

```rust
use super::latex;
use super::maths::Family;
use unicode_normalization::UnicodeNormalization;
```

Replace with:

```rust
use super::latex;
use super::maths::Family;
use std::collections::BTreeMap;
use unicode_normalization::UnicodeNormalization;
```

- [ ] **Step 4: Hook the new pass into `group_blocks`**

Find the end of `group_blocks`:

```rust
    if !current.is_empty() {
        blocks.push(finish_block(&current, current_kind));
    }

    blocks
}
```

Replace with:

```rust
    if !current.is_empty() {
        blocks.push(finish_block(&current, current_kind));
    }

    assign_list_numbers(&mut blocks);
    blocks
}
```

- [ ] **Step 5: Add `assign_list_numbers`**

Immediately after `group_blocks`'s closing `}` (right before the `fn finish_block` doc comment), add:

```rust
/// Assigns sequential numbers to ordered list items that arrived with none
/// — a letter or roman-numeral marker (`(a)`, `iv)`) carries no numeric
/// value of its own, unlike a digit marker's source-preserved `number` — and
/// nests a letter-marked item under the digit-numbered item it immediately
/// follows when the source PDF gave it no extra indent to signal that on its
/// own. See docs/specs/pdf-lettered-list-markers-design.md.
fn assign_list_numbers(blocks: &mut [Block]) {
    // depth -> next number to auto-assign at that depth.
    let mut counters: BTreeMap<usize, u32> = BTreeMap::new();
    // depth -> whether the most recent ordered item seen at that depth
    // carried its own explicit source number, or was itself a letter marker.
    let mut last_was_digit: BTreeMap<usize, bool> = BTreeMap::new();

    for block in blocks.iter_mut() {
        match block {
            // A heading is a topic boundary: two unrelated lettered lists on
            // either side of one should not share a running count.
            Block::Heading { .. } => {
                counters.clear();
                last_was_digit.clear();
            }
            Block::ListItem { ordered: true, number, depth, .. } => {
                let orig_depth = *depth;
                let bump = number.is_none() && last_was_digit.get(&orig_depth) == Some(&true);
                let effective_depth = if bump { orig_depth + 1 } else { orig_depth };

                // A new item at this depth ends whatever was nested under
                // whatever came before it at a deeper level.
                counters.retain(|&d, _| d <= effective_depth);
                last_was_digit.retain(|&d, _| d <= effective_depth);

                match number {
                    Some(n) => {
                        counters.insert(effective_depth, *n + 1);
                        last_was_digit.insert(effective_depth, true);
                    }
                    None => {
                        let next = counters.remove(&effective_depth).unwrap_or(1);
                        *number = Some(next);
                        counters.insert(effective_depth, next + 1);
                        last_was_digit.insert(effective_depth, false);
                    }
                }
                *depth = effective_depth;
            }
            _ => {}
        }
    }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cargo test --lib a_sub_part_label_becomes_a_list_item a_lettered_sub_part_nests_under_its_digit_numbered_parent each_digit_items_own_sub_list_restarts_its_own_numbering a_heading_resets_running_list_numbering -- --nocapture`

Expected: all four `PASS`.

- [ ] **Step 7: Run the full `pdf` test suite to check for regressions**

Run: `cargo test --lib pdf::`

Expected: all pass, in particular `bulleted_lines_become_list_items_with_the_marker_removed`, `numbered_lines_become_an_ordered_list`, `an_indented_item_nests_under_the_one_above`, `a_wrapped_list_item_keeps_its_continuation_line`, and `converts_a_representative_exercise_sheet` — none of these use a markerless ordered item, so `assign_list_numbers` should leave their output unchanged.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/pdf/layout.rs src-tauri/src/pdf/layout_tests.rs
git commit -m "fix(pdf): auto-number lettered sub-parts and nest them under their digit parent"
```

---

## Task 2: Recognize bare letter/roman sub-part markers (`a)`, `iv)`)

**Files:**
- Modify: `src-tauri/src/pdf/layout.rs` — `list_marker()` (~line 1775-1828, shifted +1 line by Task 1's import)
- Test: `src-tauri/src/pdf/layout_tests.rs` — add new tests near `a_sub_part_label_becomes_a_list_item`

**Interfaces:**
- Consumes: `fn list_marker(text: &str) -> Option<Marker>` and `struct Marker { ordered: bool, number: Option<u32>, len: usize }` (both unchanged in shape). Consumes Task 1's `assign_list_numbers` (already wired into `group_blocks`) to get correct sequential numbering for the newly-recognized markers.
- Produces: `list_marker` now also matches a bare letter/roman-numeral marker (`a)`, `iv)`) at the start of a line. No new public API.

- [ ] **Step 1: Write the failing tests**

In `src-tauri/src/pdf/layout_tests.rs`, add:

```rust
#[test]
fn a_bare_letter_marker_becomes_a_list_item() {
    let mut chars = page(&["Answer each of the parts below in turn."]);
    chars.extend(set("a) the first part", 72.0, 660.0, Style::default()));
    chars.extend(set("b) the second part", 72.0, 648.0, Style::default()));
    chars.extend(set("c) the third part", 72.0, 636.0, Style::default()));

    let markdown = chars_to_markdown(&chars);

    assert!(markdown.contains("1. the first part"), "got: {markdown}");
    assert!(markdown.contains("2. the second part"), "got: {markdown}");
    assert!(markdown.contains("3. the third part"), "got: {markdown}");
    assert!(!markdown.contains("a) the first part"), "marker survived: {markdown}");
}

// "Solution) ..." is a real word directly followed by a parenthesis, not
// this convention's marker — the length cap (matching the existing "(a)"
// form's own cap) keeps an 8-letter word from being mistaken for one.
#[test]
fn a_long_word_directly_followed_by_a_parenthesis_does_not_start_a_list() {
    let markdown = chars_to_markdown(&page(&["Solution) this stays prose"]));
    assert!(markdown.starts_with("Solution)"), "got: {markdown}");
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --lib a_bare_letter_marker_becomes_a_list_item a_long_word_directly_followed_by_a_parenthesis_does_not_start_a_list -- --nocapture`

Expected: `a_bare_letter_marker_becomes_a_list_item` FAILs (the line stays plain prose, so the markdown never gets a `1.`/`2.`/`3.` prefix and still contains `"a) the first part"` verbatim). `a_long_word_directly_followed_by_a_parenthesis_does_not_start_a_list` already PASSes today — that's fine, it's here to stay green through Step 4, not to go red now.

- [ ] **Step 3: Add the bare-marker branch to `list_marker`**

In `src-tauri/src/pdf/layout.rs`, find:

```rust
        if inner > 0
            && inner <= 4
            && rest.get(inner + 1) == Some(&')')
            && rest.get(inner + 2).is_some_and(|c| c.is_whitespace())
        {
            return Some(Marker {
                ordered: true,
                number: None,
                len: leading + inner + 3,
            });
        }
    }

    None
}
```

Replace with:

```rust
        if inner > 0
            && inner <= 4
            && rest.get(inner + 1) == Some(&')')
            && rest.get(inner + 2).is_some_and(|c| c.is_whitespace())
        {
            return Some(Marker {
                ordered: true,
                number: None,
                len: leading + inner + 3,
            });
        }
    }

    // "a)" / "iv)" — the same sub-part convention as "(a)", without the
    // parens some sheets omit.
    if first.is_ascii_alphabetic() {
        let letters = rest.iter().take_while(|c| c.is_ascii_alphabetic()).count();
        if letters > 0
            && letters <= 4
            && rest.get(letters) == Some(&')')
            && rest.get(letters + 1).is_some_and(|c| c.is_whitespace())
        {
            return Some(Marker {
                ordered: true,
                number: None,
                len: leading + letters + 2,
            });
        }
    }

    None
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --lib a_bare_letter_marker_becomes_a_list_item a_long_word_directly_followed_by_a_parenthesis_does_not_start_a_list -- --nocapture`

Expected: both `PASS`.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/pdf/layout.rs src-tauri/src/pdf/layout_tests.rs
git commit -m "feat(pdf): recognize bare a)/iv)-style sub-part markers"
```

---

## Task 3: Recognize the unresolved-placeholder bullet (`U+FFFD`)

**Files:**
- Modify: `src-tauri/src/pdf/layout.rs` — `list_marker()`'s bullet branch (~line 1781)
- Test: `src-tauri/src/pdf/layout_tests.rs` — add a new test near `bulleted_lines_become_list_items_with_the_marker_removed`

**Interfaces:**
- Consumes: `list_marker()`'s existing bullet-character `matches!` branch, unchanged shape.
- Produces: `list_marker` now also matches a leading, whitespace-followed `U+FFFD` as an unordered bullet marker. No new public API.

- [ ] **Step 1: Write the failing test**

In `src-tauri/src/pdf/layout_tests.rs`, add (near `bulleted_lines_become_list_items_with_the_marker_removed`):

```rust
// Analysis_2_Blatt12.pdf's "Richtig oder Falsch" section: pdfium can only
// decode this bullet symbol as the control codepoint U+0088, which
// extract::resolve_fallback_char already (deliberately) collapses to
// U+FFFD before layout.rs ever sees it — see docs/specs/
// pdf-lettered-list-markers-design.md.
#[test]
fn an_unresolved_placeholder_glyph_becomes_a_bullet() {
    let mut chars = page(&["Prove the following statements about the set."]);
    chars.extend(set("\u{FFFD} first claim", 72.0, 660.0, Style::default()));
    chars.extend(set("\u{FFFD} second claim", 72.0, 648.0, Style::default()));

    let markdown = chars_to_markdown(&chars);

    assert!(markdown.contains("- first claim"), "got: {markdown}");
    assert!(markdown.contains("- second claim"), "got: {markdown}");
    assert!(!markdown.contains('\u{FFFD}'), "marker survived: {markdown}");
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test --lib an_unresolved_placeholder_glyph_becomes_a_bullet -- --nocapture`

Expected: FAIL — both lines stay one run-on paragraph, `�` still present in the output.

- [ ] **Step 3: Add `U+FFFD` to the recognized bullet characters**

In `src-tauri/src/pdf/layout.rs`, find:

```rust
    if matches!(first, '•' | '●' | '▪' | '◦' | '‣' | '·' | '−' | '–' | '-' | '*') {
```

Replace with:

```rust
    if matches!(first, '•' | '●' | '▪' | '◦' | '‣' | '·' | '−' | '–' | '-' | '*' | '\u{FFFD}') {
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cargo test --lib an_unresolved_placeholder_glyph_becomes_a_bullet -- --nocapture`

Expected: PASS.

- [ ] **Step 5: Run the full workspace test suite and clippy**

Run: `cargo test --lib pdf::`
Run: `cargo clippy -- -D warnings`

Expected: all tests pass, no clippy warnings.

- [ ] **Step 6: Verify against the real document**

From `src-tauri/`, run:

```bash
NULL_NOTES_PDF="../notes/exercise_sheets/Analysis_2_Blatt12.pdf" cargo test --lib dump_markdown -- --ignored --nocapture
```

Expected: exercise 6's sub-parts now read `1. Bestimmen Sie alle (drei) Fixpunkte...` / `2. Linearisieren Sie das System...`, each indented one level under `6. Gegeben ist das nichtlineare System:`; the "Richtig oder Falsch" section now shows four separate `- ` bullet items instead of one paragraph with `�` markers.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/pdf/layout.rs src-tauri/src/pdf/layout_tests.rs
git commit -m "fix(pdf): recognize the unresolved-placeholder glyph as a bullet marker"
```

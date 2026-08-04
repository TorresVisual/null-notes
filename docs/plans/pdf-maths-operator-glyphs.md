# PDF Maths Operator Glyph Classification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (default) or superpowers:subagent-driven-development if explicitly requested.

**Goal:** Stop large/stretchy maths operator glyphs (integrals, quantifiers, `\sum`, `\binom`/`\cases` delimiters) from corrupting into the literal letter `R` or `U+FFFD` in imported PDF notes.

**Architecture:** Two-part fix, both parts required together. `src-tauri/src/pdf/extract.rs` currently collapses any control-range fallback codepoint to `U+FFFD` before the glyph's maths-face family is consulted, destroying the one signal `src-tauri/src/pdf/latex.rs` needs to identify a symbol-font placeholder glyph. Task 1 stops that collapse for maths-family glyphs. Tasks 2–6 extend `latex.rs`'s existing per-family glyph-identification predicates (`is_radical`, `is_oint`, `is_integral`) with new ones for the operators the real-document comparison found broken, following the same crop-and-visually-confirm methodology those existing predicates already document. Task 7 re-validates against the real corpus.

**Tech Stack:** Rust, `src-tauri/src/pdf/extract.rs`, `src-tauri/src/pdf/latex.rs`. No new files, no new dependencies. Diagnostics already exist in `src-tauri/src/pdf/dump.rs` (`#[ignore]`d, driven by env vars) — this plan uses `dump_render_page0`, `dump_raw_chars_near`, `dump_chars_near`, and `dump_markdown`, all already implemented; none of them are modified by this plan.

## Global Constraints

- No `.unwrap()`/`.expect()` outside tests (per `CLAUDE.md`).
- `src-tauri/src/pdf/layout.rs` must stay free of any `pdfium` dependency — this plan does not touch `layout.rs`.
- `cargo clippy -- -D warnings` must pass clean before this is done (run from `src-tauri/`).
- Each task lands as its own commit.
- **Codepoint values are discovered empirically, not assumed.** Per the design spec (`docs/specs/pdf-maths-operator-glyphs-design.md`) and the existing precedent in `latex.rs` (`is_integral`'s doc comment: confirmed "by cropping it out of a real rendered page... not assumed from an encoding table that may not even match this document's font subset"), Tasks 3–6 each start with a real-document diagnostic step that determines the exact codepoint before any code is written against it. Do not skip the diagnostic step or guess a codepoint from memory of TeX font encodings.
- All commands in this plan assume the working directory is `src-tauri/` (the crate root — there is no root `Cargo.toml`). `pdf-native` is the default feature, so no `--features` flag is needed.
- Test documents live at `../notes/exercise_sheets/*.pdf` relative to `src-tauri/`. These are real files already in the repo working tree (added for this investigation), not fixtures to generate.

---

### Task 1: `extract.rs` — stop erasing maths-family fallback codepoints

**Files:**
- Modify: `src-tauri/src/pdf/extract.rs`
- Test: `src-tauri/src/pdf/extract.rs` (`#[cfg(test)] mod tests`, same file)

**Interfaces:**
- Produces: `fn resolve_fallback_char(value: char, family: Family, hyphenation_break: bool) -> char` — a new pure, unit-testable helper. Later tasks in `latex.rs` rely on maths-family `CharBox.ch` now being able to hold a raw control-range codepoint instead of always being either a printable character or `U+FFFD`.
- Consumes: `super::maths::Family` and its `is_maths()` method (already exist, unchanged).

This task is behavior-neutral for body text (`Family::Text`) and only changes behavior for maths-family glyphs whose fallback happens to land in the control range — there is no existing test that currently depends on those being collapsed to `U+FFFD`, so no existing test should need to change.

- [ ] **Step 1: Read the current code to confirm exact context**

Open `src-tauri/src/pdf/extract.rs` and find this block inside `extract_pages_native` (currently around line 199–280):

```rust
        for ch in text.chars().iter() {
            let Some(value) = ch.unicode_char() else {
                continue;
            };
            // ... (doc comments about layout filler and hyphenation) ...
            let hyphenation_break = ch.is_hyphen().unwrap_or(false);
            if !hyphenation_break && is_layout_filler(ch.scaled_font_size().value) {
                continue;
            }
            // ... (doc comment about ligatures) ...
            let value = if !hyphenation_break && value.is_control() {
                '\u{FFFD}'
            } else {
                value
            };
            let Ok(bounds) = ch.loose_bounds() else {
                continue;
            };
            let Ok(origin_y) = ch.origin_y() else {
                continue;
            };

            let font = ch.font_name();
            chars.push(CharBox {
                ch: if hyphenation_break {
                    layout::SOFT_HYPHEN
                } else {
                    value
                },
                x: bounds.left().value,
                y: origin_y.value,
                width: bounds.width().value,
                top: bounds.top().value,
                bottom: bounds.bottom().value,
                family: super::maths::family_of(&font),
                font_size: ch.scaled_font_size().value,
                bold: matches!(
                    ch.font_weight(),
                    Some(PdfFontWeight::Weight700Bold)
                        | Some(PdfFontWeight::Weight800)
                        | Some(PdfFontWeight::Weight900)
                ) || ch.font_is_bold_reenforced(),
                italic: ch.font_is_italic(),
                fixed_pitch: ch.font_is_fixed_pitch(),
            });
        }
```

Note that `font` (and therefore `family`) is currently computed *after* the FFFD-collapse decision, right before the `CharBox` is built. This step moves it earlier.

- [ ] **Step 2: Write the failing tests**

In `extract.rs`'s existing `#[cfg(test)] mod tests` block, add (this references `resolve_fallback_char`, which doesn't exist yet):

```rust
    #[test]
    fn a_control_fallback_in_body_text_becomes_fffd() {
        assert_eq!(
            resolve_fallback_char('\u{2}', super::super::maths::Family::Text, false),
            '\u{FFFD}'
        );
    }

    #[test]
    fn a_control_fallback_in_a_maths_face_is_kept_raw() {
        assert_eq!(
            resolve_fallback_char('\u{2}', super::super::maths::Family::Extensible, false),
            '\u{2}'
        );
    }

    #[test]
    fn a_printable_fallback_is_never_touched_regardless_of_family() {
        assert_eq!(resolve_fallback_char('R', super::super::maths::Family::Extensible, false), 'R');
        assert_eq!(resolve_fallback_char('Z', super::super::maths::Family::Text, false), 'Z');
    }

    #[test]
    fn a_hyphenation_break_is_never_collapsed_even_if_control() {
        assert_eq!(
            resolve_fallback_char('\u{2}', super::super::maths::Family::Text, true),
            '\u{2}'
        );
    }
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cargo test resolve_fallback_char -- --nocapture`
Expected: FAIL to compile — `resolve_fallback_char` is not defined yet.

- [ ] **Step 4: Add the pure helper function**

Just above `extract_pages_native` (or any top-level location in the same file outside the function), add:

```rust
/// A real (non-filler) glyph pdfium could only decode to a control-range
/// codepoint, most often a ligature (`ff`/`fi`/`ffi`) or a symbol-font
/// placeholder with no `ToUnicode` entry. Kept raw for a maths face —
/// `latex.rs`'s per-family glyph identification (`is_integral`, `is_oint`,
/// ...) needs the original fallback value to recognize a symbol-font
/// placeholder the same way it already recognizes printable ones like `'Z'`
/// or `'H'`. Collapsed to `U+FFFD` for body text, where the letters it
/// actually represents are producer- and font-specific and unsafe to guess
/// — see the ligature discussion this replaces, kept in git history.
fn resolve_fallback_char(value: char, family: super::maths::Family, hyphenation_break: bool) -> char {
    if !hyphenation_break && value.is_control() && !family.is_maths() {
        '\u{FFFD}'
    } else {
        value
    }
}
```

- [ ] **Step 5: Run the tests to verify they pass, then wire the helper into the extraction loop**

Run: `cargo test resolve_fallback_char -- --nocapture`
Expected: PASS on all four — the function is pure and self-contained, so the tests pass with no pdfium involvement.

Now wire it into the extraction loop so the real pdfium-driven path actually uses it:

Replace the block from Step 1 with:

```rust
        for ch in text.chars().iter() {
            let Some(value) = ch.unicode_char() else {
                continue;
            };
            // ... (keep the existing doc comments about layout filler and hyphenation unchanged) ...
            let hyphenation_break = ch.is_hyphen().unwrap_or(false);
            if !hyphenation_break && is_layout_filler(ch.scaled_font_size().value) {
                continue;
            }
            let font = ch.font_name();
            let family = super::maths::family_of(&font);
            // ... (keep the existing doc comment about ligatures unchanged, but update its
            // last two sentences to describe the new behavior: kept raw for a maths face so
            // latex.rs can identify it, collapsed to FFFD only for body text) ...
            let value = resolve_fallback_char(value, family, hyphenation_break);
            let Ok(bounds) = ch.loose_bounds() else {
                continue;
            };
            let Ok(origin_y) = ch.origin_y() else {
                continue;
            };

            chars.push(CharBox {
                ch: if hyphenation_break {
                    layout::SOFT_HYPHEN
                } else {
                    value
                },
                x: bounds.left().value,
                y: origin_y.value,
                width: bounds.width().value,
                top: bounds.top().value,
                bottom: bounds.bottom().value,
                family,
                font_size: ch.scaled_font_size().value,
                bold: matches!(
                    ch.font_weight(),
                    Some(PdfFontWeight::Weight700Bold)
                        | Some(PdfFontWeight::Weight800)
                        | Some(PdfFontWeight::Weight900)
                ) || ch.font_is_bold_reenforced(),
                italic: ch.font_is_italic(),
                fixed_pitch: ch.font_is_fixed_pitch(),
            });
        }
```

Note `font`/`family` are computed once, before the fallback decision, and reused in the `CharBox` literal (removing the old inline `family: super::maths::family_of(&font)` computed from a `font` variable declared later — that later declaration is now deleted since `font`/`family` already exist above).

- [ ] **Step 6: Run the full test suite**

Run: `cargo test`
Expected: all tests pass, including the four new ones and every pre-existing test in `extract.rs`, `layout.rs`, `latex.rs`, `maths.rs`, `columns.rs` unchanged.

- [ ] **Step 7: Clippy**

Run: `cargo clippy -- -D warnings`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/pdf/extract.rs
git commit -m "fix(pdf): keep maths-face fallback codepoints instead of erasing to FFFD"
```

---

### Task 2: `latex.rs` — safety net for still-unidentified control glyphs

**Files:**
- Modify: `src-tauri/src/pdf/latex.rs`

**Interfaces:**
- Consumes: nothing new — this only changes `glyph()`'s existing final fallback arm.
- Produces: the guarantee that `glyph()` never returns a string containing a raw Unicode control character, for any `Family`. Tasks 3–6 add specific predicates that intercept *known* symbols before reaching this fallback; this task ensures whatever isn't yet known degrades safely instead of leaking a raw byte into the note.

This task should land before Tasks 3–6 conceptually (it's the safety net those tasks rely on existing), but has no code dependency on Task 1 or on any specific codepoint discovery, so it can be implemented and tested immediately with a synthetic `CharBox`.

- [ ] **Step 1: Write the failing test**

In `latex.rs`'s existing `#[cfg(test)] mod tests` block, add:

```rust
    // Once extract.rs stops collapsing maths-face fallback codepoints to
    // FFFD (see extract.rs's resolve_fallback_char), latex.rs can receive a
    // real control character it has no predicate for yet. It must never
    // leak that raw byte into the rendered LaTeX — same "make the loss
    // visible instead of silent" principle extract.rs already applies to
    // body text, just enforced here for whatever the maths-face predicates
    // above this fallback don't recognize.
    #[test]
    fn an_unrecognized_control_glyph_in_a_maths_face_becomes_fffd_not_a_raw_byte() {
        assert_eq!(to_latex(&run("\u{3}", Family::Extensible)), "\u{FFFD}");
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test an_unrecognized_control_glyph_in_a_maths_face_becomes_fffd_not_a_raw_byte -- --nocapture`
Expected: FAIL — currently `glyph()`'s fallback arm returns `other.to_string()` unconditionally, so a `U+0003` input renders as a literal (invisible) `U+0003` in the output string, not `U+FFFD`.

- [ ] **Step 3: Implement the fix**

In `latex.rs`, find `glyph()`'s final match:

```rust
    // LaTeX's own metacharacters, which a PDF prints as ordinary glyphs.
    match ch.ch {
        '%' => "\\%".into(),
        '&' => "\\&".into(),
        '#' => "\\#".into(),
        '$' => "\\$".into(),
        '_' => "\\_".into(),
        '{' => "\\{".into(),
        '}' => "\\}".into(),
        other => other.to_string(),
    }
```

Replace the final arm:

```rust
    // LaTeX's own metacharacters, which a PDF prints as ordinary glyphs.
    match ch.ch {
        '%' => "\\%".into(),
        '&' => "\\&".into(),
        '#' => "\\#".into(),
        '$' => "\\$".into(),
        '_' => "\\_".into(),
        '{' => "\\{".into(),
        '}' => "\\}".into(),
        // Nothing above recognized this glyph, and extract.rs no longer
        // guarantees a maths-face control codepoint was already turned into
        // FFFD upstream (see resolve_fallback_char) — so make the loss
        // visible here instead of emitting an unprintable raw byte.
        other if other.is_control() => '\u{FFFD}'.to_string(),
        other => other.to_string(),
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cargo test an_unrecognized_control_glyph_in_a_maths_face_becomes_fffd_not_a_raw_byte -- --nocapture`
Expected: PASS.

- [ ] **Step 5: Run the full test suite**

Run: `cargo test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/pdf/latex.rs
git commit -m "fix(pdf): never leak a raw control byte from an unidentified maths glyph"
```

---

### Task 3: `latex.rs` — second integral placeholder (the `'R'` corruption)

**Files:**
- Modify: `src-tauri/src/pdf/latex.rs`

**Interfaces:**
- Consumes: `is_integral` (existing, defined in this file, currently `ch.ch == '∫' || (ch.family == Family::Extensible && ch.ch == 'Z')`).
- Produces: `is_integral` recognizing one additional confirmed codepoint. No signature or call-site changes — every caller of `is_integral` already exists and needs no changes.

- [ ] **Step 1: Confirm the codepoint against the real document**

The comparison against Notion references found `∬_S` (a surface-flux double integral) on `Analysis_2_Blatt7_2026.pdf` rendering as `$$RR$$` instead of `\iint_S` — two adjacent integral signs each independently corrupted to the letter `R`. Confirm this is really the CMEX integral glyph, not a coincidental letter, the same way `is_integral`'s existing `'Z'` mapping was confirmed:

```bash
cd src-tauri
NULL_NOTES_PDF="../notes/exercise_sheets/Analysis_2_Blatt7_2026.pdf" NULL_NOTES_NEEDLE="R" cargo test dump_chars_near -- --ignored --nocapture
```

In the output, find the entries whose `fam` is `Extensible` sitting immediately before/around the flux-surface equation (search the surrounding output for German text near "Fluss" or "Oberfläche" if the sheet uses those words, or scan for the `RR` pair directly — two adjacent `Extensible`-family characters both reporting `ch: 'R'`). Note their `x`/`y`.

- [ ] **Step 2: Render and visually confirm**

```bash
NULL_NOTES_PDF="../notes/exercise_sheets/Analysis_2_Blatt7_2026.pdf" cargo test dump_render_page0 -- --ignored --nocapture
```

This writes a PNG to the OS temp dir (path printed by the test — on Windows, typically `%TEMP%\null-notes-page0.png`). If the anchor equation isn't on page 0, adjust `dump_render_page0` locally to render the correct page index (`doc.pages().iter().nth(N)` in place of `.first()`) — do not commit that adjustment, it's a one-off local lookup. Open/read the PNG and visually locate the double-integral symbol (∬) at the coordinates from Step 1. Confirm by eye that this glyph is genuinely the doubled elongated-S integral shape, not some other CMEX symbol that happens to also fall back to `'R'`.

- [ ] **Step 3: Write the failing test**

In `latex.rs`'s test module:

```rust
    // Analysis_2_Blatt7_2026.pdf: a double integral (∬_S, surface flux)
    // rendered as $$RR$$ — each ∫ independently corrupted to the letter
    // 'R'. Confirmed by cropping it out of the rendered page, the same way
    // the 'Z' mapping above it was confirmed.
    #[test]
    fn a_second_integral_placeholder_glyph_becomes_int() {
        assert_eq!(to_latex(&run("R", Family::Extensible)), r"\int");
    }

    #[test]
    fn an_ordinary_r_is_not_mistaken_for_an_integral() {
        assert_eq!(to_latex(&run("R", Family::Text)), "R");
        assert_eq!(to_latex(&run("R", Family::Italic)), "R");
    }
```

(If Step 1/2 confirms a *different* character than `'R'`, use that character in these tests and their comments instead — the tests must match what was actually confirmed, not this plan's prediction.)

- [ ] **Step 4: Run the tests to verify they fail**

Run: `cargo test a_second_integral_placeholder_glyph_becomes_int an_ordinary_r_is_not_mistaken_for_an_integral -- --nocapture`
Expected: `a_second_integral_placeholder_glyph_becomes_int` FAILs (currently `'R'` falls through to the plain-character fallback and renders as literal `R`); `an_ordinary_r_is_not_mistaken_for_an_integral` already PASSes (nothing currently treats `'R'` specially) — confirm it stays passing after Step 5.

- [ ] **Step 5: Implement**

Find:

```rust
fn is_integral(ch: &CharBox) -> bool {
    ch.ch == '∫' || (ch.family == Family::Extensible && ch.ch == 'Z')
}
```

Replace with:

```rust
fn is_integral(ch: &CharBox) -> bool {
    ch.ch == '∫'
        || (ch.family == Family::Extensible && matches!(ch.ch, 'Z' | 'R'))
}
```

Also update the doc comment above `is_integral` to note the second confirmed placeholder and how it was found (mirroring the existing comment's own style), e.g. append: "A second placeholder, `'R'`, showed up on `Analysis_2_Blatt7_2026.pdf`'s `∬_S` — confirmed the same way, by rendering the page and cropping the glyph."

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cargo test a_second_integral_placeholder_glyph_becomes_int an_ordinary_r_is_not_mistaken_for_an_integral -- --nocapture`
Expected: both PASS.

- [ ] **Step 7: Run the full test suite and clippy**

Run: `cargo test && cargo clippy -- -D warnings`
Expected: all pass, clean.

- [ ] **Step 8: Spot-check against the real document**

```bash
NULL_NOTES_PDF="../notes/exercise_sheets/Analysis_2_Blatt7_2026.pdf" cargo test dump_markdown -- --ignored --nocapture
```

Confirm the `∬_S` equation (or whichever line contained `$$RR$$`) now renders `\iint` or `\int\int` rather than `RR`. (Collapsing `\int\int` into `\iint` is a cosmetic nicety, not required by this task — either output is an acceptable pass here, since correctness — not styling — is this task's deliverable.)

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/pdf/latex.rs
git commit -m "fix(pdf): recognise the second CMEX integral placeholder glyph"
```

---

### Task 4: `latex.rs` — `∀`/`∃` quantifiers

**Files:**
- Modify: `src-tauri/src/pdf/latex.rs`

**Interfaces:**
- Consumes: `symbol_command` (existing — already maps real Unicode `'∀'`/`'∃'` to `\forall`/`\exists`, unchanged) and `glyph()`'s dispatch chain (existing).
- Produces: a new predicate, e.g. `is_forall`/`is_exists` or a combined `quantifier_command(ch: &CharBox) -> Option<&'static str>`, plumbed into `glyph()` before the final fallback. Exact shape decided in Step 5 based on what Step 1 finds (whether `∀` and `∃` share one fallback codepoint or have distinct ones).

This task only becomes possible once Task 1 ships — before it, these glyphs' fallback codepoints never survive `extract.rs` to reach `latex.rs` at all (they're already `U+FFFD` by the time they get here).

- [ ] **Step 1: Confirm the codepoint(s) against the real document**

`Ue9.pdf` Beispiel 9.1 is a prenex-normal-form quantifier formula (`∀`, `∃`, nested parens) that rendered as a table saturated with `�`. Find the raw fallback values pdfium reports for the quantifier glyphs before any filtering:

```bash
cd src-tauri
NULL_NOTES_PDF="../notes/exercise_sheets/Ue9.pdf" NULL_NOTES_NEEDLE="Beispiel 9.1" cargo test dump_raw_chars_near -- --ignored --nocapture
```

If `"Beispiel 9.1"` doesn't appear verbatim in the raw text (accents/ligatures can break a literal match), search a shorter fragment of the surrounding German prose instead, or use `dump_chars_range` with `NULL_NOTES_LO`/`NULL_NOTES_HI` to page through the relevant page's characters manually. Look for `Extensible`- or `Symbol`-family characters whose `uni` is a control codepoint (printed as an escape like `\u{...}` or a control-picture) sitting where the quantifiers visually are. Record the codepoint(s) — `∀` and `∃` may share one raw fallback value or have two distinct ones; do not assume.

- [ ] **Step 2: Render and visually confirm**

```bash
NULL_NOTES_PDF="../notes/exercise_sheets/Ue9.pdf" cargo test dump_render_page0 -- --ignored --nocapture
```

(Adjust the page index locally as in Task 3 Step 2 if Beispiel 9.1 isn't on page 0; don't commit that adjustment.) Read the PNG, locate the quantifier symbols by their visual position, and confirm each recorded codepoint from Step 1 corresponds to `∀` or `∃` specifically (not, say, a nearby parenthesis or comma that happened to also be control-range).

- [ ] **Step 3: Write the failing tests**

Using the codepoint(s) confirmed in Steps 1–2 (shown here as `'\u{1}'` for `∀` and `'\u{4}'` for `∃` as placeholders for whatever was actually found — replace with the real values):

```rust
    // Ue9.pdf Beispiel 9.1: a prenex-normal-form formula with ∀/∃
    // quantifiers rendered as U+FFFD before extract.rs's
    // resolve_fallback_char started preserving maths-face fallback
    // codepoints. Confirmed by cropping the rendered page, the same way
    // every other placeholder mapping in this file was confirmed.
    #[test]
    fn the_forall_placeholder_glyph_becomes_forall() {
        assert_eq!(to_latex(&run("\u{1}", Family::Extensible)), r"\forall");
    }

    #[test]
    fn the_exists_placeholder_glyph_becomes_exists() {
        assert_eq!(to_latex(&run("\u{4}", Family::Extensible)), r"\exists");
    }
```

(Use `Family::Symbol` instead of `Family::Extensible` in both the test and the implementation below if Step 1/2 finds these glyphs actually came from the `CMSY` face rather than `CMEX` — quantifiers are logic symbols, which `maths.rs`'s doc comments already class under `CMSY`/`Family::Symbol` for their non-large forms, so check which face the font name in the raw dump actually reports rather than assuming `Extensible`.)

- [ ] **Step 4: Run the tests to verify they fail**

Run: `cargo test the_forall_placeholder_glyph_becomes_forall the_exists_placeholder_glyph_becomes_exists -- --nocapture`
Expected: both FAIL (the raw control codepoints currently fall through to Task 2's new FFFD safety net, so they'd render as `U+FFFD`, not `\forall`/`\exists`).

- [ ] **Step 5: Implement**

In `latex.rs`, near `is_oint`/`is_integral`, add (adjust the family and codepoints to match what Steps 1–2 confirmed):

```rust
/// `∀`/`∃` sometimes arrive as real Unicode (see `symbol_command`) and
/// sometimes as a font-specific fallback codepoint pdfium can't map to
/// Unicode — confirmed on Ue9.pdf's Beispiel 9.1 by rendering the page and
/// cropping the glyphs.
fn quantifier_command(ch: &CharBox) -> Option<&'static str> {
    if ch.family != Family::Extensible {
        return None;
    }
    match ch.ch {
        '\u{1}' => Some("\\forall"),
        '\u{4}' => Some("\\exists"),
        _ => None,
    }
}
```

In `glyph()`, add a check alongside the existing `is_oint`/`is_integral` calls, before the `symbol_command` lookup:

```rust
    if let Some(command) = quantifier_command(ch) {
        return command.to_string();
    }

    if let Some(command) = symbol_command(ch.ch) {
        return command.to_string();
    }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cargo test the_forall_placeholder_glyph_becomes_forall the_exists_placeholder_glyph_becomes_exists -- --nocapture`
Expected: both PASS.

- [ ] **Step 7: Run the full test suite and clippy**

Run: `cargo test && cargo clippy -- -D warnings`
Expected: all pass, clean.

- [ ] **Step 8: Spot-check against the real document**

```bash
NULL_NOTES_PDF="../notes/exercise_sheets/Ue9.pdf" cargo test dump_markdown -- --ignored --nocapture
```

Confirm Beispiel 9.1's formula no longer contains `�` where the quantifiers sit. (The formula may still be malformed by the separate table-misdetection bug — out of scope here, per the design spec — so judge only whether the quantifier glyphs themselves resolved correctly, not the overall formula layout.)

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/pdf/latex.rs
git commit -m "fix(pdf): recognise the forall/exists placeholder glyphs"
```

---

### Task 5: `latex.rs` — `\sum`

**Files:**
- Modify: `src-tauri/src/pdf/latex.rs`

**Interfaces:**
- Consumes: same dispatch chain in `glyph()` as Task 4.
- Produces: a new predicate, e.g. `is_sum(ch: &CharBox) -> bool`, following the exact shape of `is_integral`.

- [ ] **Step 1: Confirm the codepoint against the real document**

`Ue9.pdf` Beispiel 9.3 (the inclusion-exclusion formula, the worst corruption found in the whole corpus) contains `Σ_{k=1}^n`. Find its raw fallback value:

```bash
cd src-tauri
NULL_NOTES_PDF="../notes/exercise_sheets/Ue9.pdf" NULL_NOTES_NEEDLE="k=1" cargo test dump_chars_near -- --ignored --nocapture
```

If `"k=1"` doesn't match (it may be split across maths-region boundaries in the filtered stream), fall back to `dump_raw_chars_near` with a shorter needle, or `dump_chars_range` to page through Beispiel 9.3's character range directly. Record the raw codepoint and family immediately before the `k=1` subscript.

- [ ] **Step 2: Render and visually confirm**

```bash
NULL_NOTES_PDF="../notes/exercise_sheets/Ue9.pdf" cargo test dump_render_page0 -- --ignored --nocapture
```

(Adjust page index locally if Beispiel 9.3 isn't on page 0, as in prior tasks.) Confirm the codepoint from Step 1 is the large Σ glyph, not a nearby symbol.

- [ ] **Step 3: Write the failing test**

```rust
    // Ue9.pdf Beispiel 9.3: the inclusion-exclusion formula's leading Σ_{k=1}^n
    // rendered as U+FFFD before this mapping existed. Confirmed by cropping
    // the rendered page.
    #[test]
    fn the_sum_placeholder_glyph_becomes_sum() {
        assert_eq!(to_latex(&run("\u{6}", Family::Extensible)), r"\sum");
    }
```

(Replace `'\u{6}'` and `Family::Extensible` with whatever Steps 1–2 actually confirmed.)

- [ ] **Step 4: Run the test to verify it fails**

Run: `cargo test the_sum_placeholder_glyph_becomes_sum -- --nocapture`
Expected: FAIL.

- [ ] **Step 5: Implement**

Add near `is_integral`:

```rust
/// CMEX's large Σ has no Unicode entry in this font subset either —
/// confirmed on Ue9.pdf's Beispiel 9.3 by rendering the page and cropping
/// the glyph, the same way `is_integral`'s placeholders were confirmed.
fn is_sum(ch: &CharBox) -> bool {
    ch.family == Family::Extensible && ch.ch == '\u{6}'
}
```

(Use the real confirmed codepoint in place of `'\u{6}'`.) In `glyph()`, add alongside the `is_oint`/`is_integral` checks:

```rust
    if is_sum(ch) {
        return "\\sum".to_string();
    }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cargo test the_sum_placeholder_glyph_becomes_sum -- --nocapture`
Expected: PASS.

- [ ] **Step 7: Run the full test suite and clippy**

Run: `cargo test && cargo clippy -- -D warnings`
Expected: all pass, clean.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/pdf/latex.rs
git commit -m "fix(pdf): recognise the CMEX sum placeholder glyph"
```

---

### Task 6: `latex.rs` — `\binom`/`\cases` stretchy delimiters

**Files:**
- Modify: `src-tauri/src/pdf/latex.rs`

**Interfaces:**
- Consumes: same dispatch chain in `glyph()`.
- Produces: a predicate mapping CMEX's large paren/brace glyphs to plain `(`, `)`, `\{`, `\}`.

- [ ] **Step 1: Confirm the codepoint(s) against the real document**

`Analysis_2_Blatt11.pdf` item 6 has `\binom{3x^2-3y^2+2x+2y}{-6xy+2x-2y}`, preceded in the broken output by a stray `� �` pair — almost certainly the binomial's large opening/closing parenthesis glyphs.

```bash
cd src-tauri
NULL_NOTES_PDF="../notes/exercise_sheets/Analysis_2_Blatt11.pdf" NULL_NOTES_NEEDLE="6xy" cargo test dump_chars_near -- --ignored --nocapture
```

Record the raw codepoint(s) and family for the two control characters immediately surrounding the binomial's terms. There may be one shared codepoint for both parens (mirroring how `is_oint`'s `H`/`I` differ only by *size*, not by open/close) or two distinct ones — do not assume; read what the dump actually reports.

- [ ] **Step 2: Render and visually confirm**

```bash
NULL_NOTES_PDF="../notes/exercise_sheets/Analysis_2_Blatt11.pdf" cargo test dump_render_page0 -- --ignored --nocapture
```

(Adjust page index locally if item 6 isn't on page 0.) Confirm the codepoint(s) are the large stretchy parenthesis glyphs framing the binomial's two rows.

- [ ] **Step 3: Write the failing tests**

```rust
    // Analysis_2_Blatt11.pdf item 6: \binom{...}{...}'s large parentheses
    // rendered as stray U+FFFD tokens before this mapping existed.
    // Confirmed by cropping the rendered page. Mapped to plain ASCII
    // parens rather than \left(/\right) — KaTeX sizes them adequately for
    // this corpus without automatic stretch sizing.
    #[test]
    fn the_large_open_paren_placeholder_becomes_a_plain_paren() {
        assert_eq!(to_latex(&run("\u{7}", Family::Extensible)), "(");
    }

    #[test]
    fn the_large_close_paren_placeholder_becomes_a_plain_paren() {
        assert_eq!(to_latex(&run("\u{8}", Family::Extensible)), ")");
    }
```

(Replace `'\u{7}'`/`'\u{8}'` and `Family::Extensible` with whatever Steps 1–2 confirmed. If both open and close share one codepoint, this predicate can't distinguish them by codepoint alone — in that case, write the tests and implementation using position-based disambiguation instead, e.g. "the first occurrence in a run is open, the second is close," and note that constraint in the doc comment; do not guess silently.)

- [ ] **Step 4: Run the tests to verify they fail**

Run: `cargo test the_large_open_paren_placeholder_becomes_a_plain_paren the_large_close_paren_placeholder_becomes_a_plain_paren -- --nocapture`
Expected: both FAIL.

- [ ] **Step 5: Implement**

Add near `is_integral`:

```rust
/// CMEX's large stretchy parentheses (the delimiters a \binom or \cases
/// body needs) have no Unicode entry in this font subset — confirmed on
/// Analysis_2_Blatt11.pdf item 6 by rendering the page and cropping the
/// glyphs. Mapped to plain ASCII parens: KaTeX sizes a bare `(`/`)`
/// adequately around a \frac-shaped body without needing \left/\right for
/// automatic stretch sizing, which this corpus doesn't need.
fn large_paren_glyph(ch: &CharBox) -> Option<&'static str> {
    if ch.family != Family::Extensible {
        return None;
    }
    match ch.ch {
        '\u{7}' => Some("("),
        '\u{8}' => Some(")"),
        _ => None,
    }
}
```

(Use the real confirmed codepoint(s) in place of `'\u{7}'`/`'\u{8}'`, and adjust the match arms if Step 3 found they share one codepoint.) In `glyph()`, add alongside the other predicate checks:

```rust
    if let Some(paren) = large_paren_glyph(ch) {
        return paren.to_string();
    }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cargo test the_large_open_paren_placeholder_becomes_a_plain_paren the_large_close_paren_placeholder_becomes_a_plain_paren -- --nocapture`
Expected: both PASS.

- [ ] **Step 7: Run the full test suite and clippy**

Run: `cargo test && cargo clippy -- -D warnings`
Expected: all pass, clean.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/pdf/latex.rs
git commit -m "fix(pdf): recognise the CMEX large-parenthesis placeholder glyphs"
```

---

### Task 7: Real-corpus re-validation

**Files:** none modified — verification only, plus an optional doc update.

**Interfaces:** none — this task consumes the finished behavior of Tasks 1–6 and produces a written confirmation (or a follow-up note) of what's now fixed.

- [ ] **Step 1: Run the full suite one more time from a clean state**

```bash
cd src-tauri
cargo test && cargo clippy -- -D warnings
```

Expected: all pass, clean — this is a final gate before judging real-document output, catching anything a single task's narrower `cargo test <name>` runs might have missed.

- [ ] **Step 2: Re-run `dump_markdown` against every document the original comparison flagged for bug A**

For each of: `Analysis_2_Blatt5_2026.pdf`, `Analysis_2_Blatt7_2026.pdf`, `Analysis_2_Blatt10.pdf`, `Analysis_2_Blatt11.pdf`, `Analysis_2_Blatt12.pdf`, `Ue9.pdf` (the six documents whose bug-A findings are listed in the design spec's Problem section):

```bash
NULL_NOTES_PDF="../notes/exercise_sheets/<file>.pdf" cargo test dump_markdown -- --ignored --nocapture
```

For each, check specifically whether the bug-A symptom recorded for that document (the literal `R`/`RR` or `�` at the anchor text noted in the original comparison) is gone. Symptoms belonging to the explicitly out-of-scope bugs (table misdetection, exponent/subscript placement, vector-as-`\frac`) are expected to still be present — that is not a regression, it's the next spec's job.

- [ ] **Step 3: Record what's still open**

If any bug-A symptom persists after Tasks 1–6 (e.g. a symbol this plan didn't anticipate, or a codepoint that turned out to need more than the two-value disambiguation Task 6 assumed), do not silently leave it — note it plainly in the commit message or a short addition to `docs/specs/pdf-maths-operator-glyphs-design.md`'s own notes, the same way `latex.rs`'s existing doc comments record what each mapping does and doesn't cover, so the next person (or the next `/loop` of this same work) doesn't have to rediscover it from scratch.

- [ ] **Step 4: Commit if Step 3 produced any doc changes**

```bash
git add docs/specs/pdf-maths-operator-glyphs-design.md
git commit -m "docs(pdf): record real-corpus re-validation results for operator glyph fix"
```

(Skip this step entirely if Step 3 found nothing to record — an empty commit is not useful here.)

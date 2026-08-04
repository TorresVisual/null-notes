# PDF maths operator glyph classification

## Problem

Comparing the PDF pipeline's `dump_markdown` output against Notion-exported reference Markdown for 10 new exercise-sheet PDFs (`notes/exercise_sheets/`) surfaced a recurring corruption: large/stretchy operator glyphs — integrals (`∫`/`∬`/`∭`), quantifiers (`∀`/`∃`), `\sum`, and the stretchy parens/braces a `\binom` or `\cases` body needs — come out either as the literal Latin letter **`R`** or as **`U+FFFD`**, instead of the LaTeX command they represent. It hit 9 of the 10 documents and is the single largest source of unreadable maths in the batch (worst case: `docs/plans/` — see Ue9 Beispiel 9.3, a 6-row table of `�` fragments where an inclusion-exclusion formula should be).

This is the first of three related bugs found in that comparison; table false-positives on multi-line maths and exponent/subscript placement are separate, out of scope here (see **Out of scope** below).

## Root cause

Two independent gaps compound:

1. **`extract.rs` destroys the evidence before anything can use it.** When pdfium can't map a glyph to real Unicode (typical for TeX symbol fonts like `CMEX10`, which usually ship with no `ToUnicode` CMap for their extension glyphs), it falls back to *some* value — sometimes a printable ASCII letter (`'Z'` for `\int`, `'H'`/`'I'` for `\oint`, `'p'`–`'s'` for `\sqrt`, all already handled in `latex.rs`), sometimes a control-range codepoint. `extract.rs` unconditionally collapses any control-range fallback to `U+FFFD` — before the character's `family` (maths face vs. body text) is even consulted — which erases the one signal that would let `latex.rs` identify it. This is almost certainly why quantifiers, `\sum`, and delimiter glyphs come out as `�`: their fallback codepoints are being destroyed upstream of the code that could otherwise recognize them.

2. **`latex.rs`'s glyph-identification table is incomplete.** `is_radical`, `is_oint`, and `is_integral` each hard-code the specific fallback codepoint(s) verified, by rendering a real page and visually cropping the glyph, for exactly the symbols found before this batch. They haven't been extended for what this batch surfaced — including a second integral placeholder (`'R'`, printable, not related to gap 1) that is likely a text-style/display-style split the same way `is_oint` already distinguishes `H` (text) from `I` (display), since `is_integral` currently only recognizes `'Z'`.

Both gaps ship together in one fix — closing gap 1 without gap 2 surfaces raw fallback codepoints with nowhere to route them; closing gap 2 without gap 1 has no real codepoints to match against for the FFFD cases.

## Design

### `extract.rs`: stop erasing maths-family fallback codepoints

In the per-character loop (`extract_pages_native`), the control-codepoint collapse:

```rust
let value = if !hyphenation_break && value.is_control() {
    '\u{FFFD}'
} else {
    value
};
```

becomes conditional on the glyph's font *not* being a maths face:

```rust
let value = if !hyphenation_break && value.is_control() && !family.is_maths() {
    '\u{FFFD}'
} else {
    value
};
```

This requires moving the existing `let font = ch.font_name();` / `family_of(&font)` computation earlier in the loop, ahead of this check (currently computed later, inline in the `CharBox` struct literal). No field or struct changes — `CharBox.ch` already holds an arbitrary `char`; maths-family glyphs will now carry raw fallback values (printable or control) the same way `'Z'`/`'H'`/`'I'`/`'p'` already do today, they just weren't previously guaranteed to survive if the fallback landed in the control range.

The existing `is_layout_filler` check runs earlier in the loop and already removes pdfium's synthetic CR/LF/paragraph-marker filler characters (identified by their degenerate ~1.0pt font size) before this point, so this change cannot resurrect those — it only affects real, real-sized glyphs whose fallback value happens to be a control codepoint.

Body text (`family == Family::Text`) keeps today's behavior exactly: an unresolvable control-range fallback there is usually a ligature (`ff`/`fi`/`ffi`) whose exact letters are producer- and font-specific and unsafe to guess (per the existing comment in `extract.rs`), so it still collapses to `U+FFFD` to keep the loss visible without guessing wrong.

### `latex.rs`: extend the verified glyph-identification predicates

Following the exact pattern `is_radical`/`is_oint`/`is_integral` already establish — one `is_xxx(ch: &CharBox) -> bool` predicate per symbol, gated on `family` plus a specific confirmed codepoint, with a doc comment recording how the codepoint was verified — add predicates for whatever this batch's implementation work confirms among:

- A second integral placeholder alongside `'Z'` (the `'R'` found in the punch list), extending `is_integral` the same way `is_oint` already handles two style variants.
- `∀`/`∃` quantifiers, now reachable as raw fallback values instead of `U+FFFD` once the `extract.rs` change ships.
- `\sum`.
- The stretchy paren/brace glyphs a `\binom` or `\cases` body uses, mapped to plain `(`, `)`, `\{`, `\}`. KaTeX sizes plain delimiters adequately for the equations in this corpus; wrapping them in `\left`/`\right` for automatic stretch sizing is not needed for this pass.

Each new predicate is added to `glyph()`'s existing dispatch (the same `if is_oint(ch) { ... }` / `if is_integral(ch) { ... }` chain) and gets its own unit test with a synthetic `CharBox` at the confirmed codepoint/family, mirroring `the_contour_integral_placeholder_glyphs_become_oint` and `the_integral_placeholder_glyph_becomes_int`.

**Codepoint verification is an implementation-plan task, not a design-time decision.** Per the file's own stated methodology (see `is_integral`'s doc comment: confirmed "by cropping it out of a real rendered page... not assumed from an encoding table that may not even match this document's font subset"), each mapping above gets confirmed empirically during implementation: run `dump_render_page0` (already in `dump.rs`) against the specific sheet/anchor text from the comparison findings, crop the glyph, visually confirm what it is, then add the predicate and test. This spec does not pre-assign codepoint values because doing so would mean trusting exactly the kind of generic encoding-table assumption this file already documents as unsafe — a subsetted font can reindex glyphs per document.

### Safety net: never leak a raw control character into output

`glyph()`'s final fallback arm currently is:

```rust
other => other.to_string(),
```

This becomes:

```rust
other if other.is_control() => '\u{FFFD}'.to_string(),
other => other.to_string(),
```

Any maths-family control-range codepoint that reaches this point — i.e. still unidentified even after the predicates above — renders as `U+FFFD` in the note's Markdown/LaTeX rather than leaking a raw unprintable byte into it. This is the same "make the loss visible instead of silent" principle `extract.rs` already applies to body text, just enforced at the point where `latex.rs` gives up rather than upstream where the information would otherwise be destroyed before it could be examined at all.

### Testing

- Unit tests in `latex.rs` for each new predicate, following the existing `run(...)`/`ch(...)`/`script(...)` synthetic-`CharBox` test helpers already in the file's `#[cfg(test)] mod tests`.
- A regression test confirming the safety net: a `Family::Extensible` `CharBox` with an unrecognized control-range `ch` renders as `U+FFFD`, not the raw control character.
- `extract.rs` has no existing unit tests that exercise this path directly (it's behind `#[cfg(feature = "pdf-native")]` and drives off real pdfium output), so this change is validated primarily through `dump.rs`'s `#[ignore]`d diagnostics against the real corpus — `dump_markdown` re-run per affected sheet, confirming the specific anchors from the comparison findings now resolve correctly — the same validation method already established for this module.

## Out of scope

- **Table false-positives on multi-line maths** (`reconstruct_tables` misreading matrices/`\cases`/multi-term fraction sums as GFM tables) — separate spec.
- **Exponent/subscript placement** (scripts landing before their base or drifting far from it) — separate spec, despite being the same "one shared root cause across every occurrence" shape as this bug.
- **Column-vector-as-`\frac` misclassification** (`\binom`-style vectors becoming fractions, sometimes nested) — likely entangled with the table false-positive bug above; scope with that spec, not this one.
- Multi-column layout and image handling were not exercised by this corpus (no genuinely multi-column or image-bearing document among the 10) and are not touched by this fix.

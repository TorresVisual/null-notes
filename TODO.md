# null-notes — TODO

Feature checklist. **The [roadmap](docs/ROADMAP.md) holds the reasoning and the Definitions of Done; this file holds the boxes.** If the two disagree, the roadmap wins.

Effort: **S** ≈ hours · **M** ≈ a day or two · **L** ≈ several days.

**Now (revised 2026-08-19):** ~~finish ruled fractions~~ → ~~freeze the PDF pipeline~~ → ~~triage the three open bugs~~ → ~~P4-3 (closes M4)~~ → ~~the dogfood slice~~ → ~~P7-2 (closes M7)~~ → ~~P5-1~~ → ~~P5-2 → P5-3 → P5-4 → P5-5 (closes M5)~~ → ~~P6-1 → P6-2 → P6-3 → P6-4 → P6-6 → P6-7 → P6-5 (closes M6)~~ → ~~P9-1~~ → ~~P9-2~~ → **P9-3 → P9-4 (closes M9)**. **Phase numbers are identity, not order.**

> The plan was to re-derive P5/P6/P9 priorities from a couple of weeks of real dogfood use first. That's dropped (see ROADMAP.md §1, 2026-08-17) — the maintainer's mode right now is implementing and verifying features, not daily use, so the wait doesn't resolve on its own. Back to the pre-dogfood priority order.

| # | Work | Size | |
|---|---|---|---|
| 0 | Finish ruled fractions *(`c72a24e`…`851bfff`)* | — | ✅ |
| 1 | Freeze the PDF pipeline under P4-2e | S | ✅ |
| 2 | Triage the three open bugs below | S | ✅ |
| 3 | **P4-3** → **M4** | M | ✅ |
| 4 | Dogfood slice — ~~ignore list~~ → ~~P7-3~~ → ~~P7-4 + P7-1~~ → ~~P8-1~~ | M/L | ✅ |
| 5 | ~~Re-derive P5, P6, P9 from real use~~ | — | ✅❌ *superseded* |
| 6 | ~~**P5**~~ → **P6** → **P9** | — | ← |

> **The PDF pipeline is frozen** as of 2026-08-13. The corpus is the regression suite; a new bug earns work only if it is whole-document or recurs across ≥2 corpus documents; 2D-layout reconstruction is closed. See P4-2e.

**Two decisions owed:** split-pane editing (during P4); spaced-repetition storage (before any P9-3 code). *(The third — `<details open>`, collapse state in the file or presentation-only — was decided 2026-08-18: presentation-only. See P6-1.)*

---

## ▸ Step 2 — Open bugs ✅ *all three triaged 2026-08-13*

**All three were reported but unverified — triage began by reproducing them.** They sat on the daily-use path and were owned by no phase, which is why they had drifted to the top of this file with no place in the order. Two were real and are fixed; one did not reproduce.

- [x] **Math doesn't get rendered in block maths.** Reproduced, and it was two defects in `BlockMath.tsx`'s markdown-it rule — parsing, not KaTeX or the node view. **`$$…$$` was not recognised at all** (it landed as literal paragraph text), though it is what Obsidian, Notion, GitHub and plain LaTeX habit all write; and **a `$` fence directly under a prose line was swallowed into that paragraph**, because the rule never registered as one that can terminate a paragraph — `prose\n$\nx^2\n$` read as the single run of text `prose $ x^2 $`. Now parsed liberally (`$`, `$$`, and one-line `$$…$$`) and still serialized conservatively as the lone `$` this app has always written. The silent-mode return had to move *after* validation: markdown-it asks in silent mode whether a line ends the paragraph above, and saying yes to an unclosed fence would cut a paragraph in half and render neither half as maths. Covered by `blockMathParsing.test.ts` — nine cases, four of them guard rails that already passed.
- [x] **Derivatives like `y'` get parsed to `^'y`.** **Does not reproduce** — it did predate the fixes, as suspected. Converting all ten corpus sheets yields zero occurrences of `^'`, and every prime renders correctly: `y'`, `y''`, `y'_1`, `y'_2`, `\vec{y}'(t)`. `latex.rs`'s `is_prime_run` (added by the compact-fraction work) emits a prime run without a caret whenever it follows a base character. Closed as already fixed rather than fixed again; under the P4-2e freeze a bug that reproduces on no corpus document earns no work.
- [x] **Spellcheck for German.** **App side, and now fixed.** The WebView chooses its dictionary from the nearest `lang` attribute; the editor set `spellcheck` but never a `lang`, so a note inherited `index.html`'s `lang="en"` and German prose was checked against English — every word underlined, which reads as the feature being broken. Added `spellcheckLanguage` to `AppSettings` (BCP-47, defaults to `de`, `#[serde(default = …)]` so a `settings.json` from an older build loads with `de` rather than `String::default()`'s empty string) and it now drives `lang` on both the TipTap root and the raw `<textarea>`. **The P2-3 caveat still stands and is not fixed by this:** whether any squiggle appears at all needs the OS's German language pack installed — WebView2 uses that, not Hunspell dictionaries of its own. This change is what makes the pack *usable* once present.

---

## Progress

| Phase | Milestone | |
|---|---|---|
| P0 Trustworthy daily driver | M0 — I trust it with my real notes | ✅ |
| P1 Everyday-use completeness | M1 — I don't reach for another app | ✅ |
| P2 Feel & ergonomics | M2 — a pleasure to use for hours | ✅ |
| P3 Headline features | M3 — the CS superpowers land | ✅ |
| P4 PDF→Markdown & exercise sheets | M4 — a sheet becomes a workable note | ✅ |
| P5 Versioned workspaces (Git) | M5 — my notes commit themselves | ✅ |
| P6 STEM authoring | M6 — fastest place to write maths | ✅ |
| P7 IDE integration | M7 — notes and code are one workflow | ✅ |
| P8 Embedded terminal | M8 — `claude` runs against the open note | ✅ |
| P9 Study & revision | M9 — the app helps me *revise*, not just capture | |
| P10 Gated stretch | M10 — in-app AI + code execution | gated |

---

## ▸ P4 — PDF → Markdown & exercise sheets (M4) — *steps 0–3*

Both import modes, chosen at import time, the way Notion does it. **No OCR** — typeset sheets carry a real text layer, and `pdfium-render` (already a default dep) hands over per-character bounding boxes and font metrics.

### P4-1 Import mode picker + text-layer extraction — **L** ✅
- [x] "Pages" vs "Markdown" choice at import; remembered in `settings.json`
- [x] Extract the text layer via `page.text()` — chars, loose bounds, font metrics
- [x] Reconstruct lines (baseline y) and blocks (vertical gap vs median line height)
- [x] Headings from font size above the body median
- [x] Code blocks from monospace runs — `font_is_fixed_pitch()`, no font-name list needed
- [x] Lists from leading bullet/number glyph + indent, incl. nesting and wrapped items
- [x] Bold/italic font variants → `**` / `*`
- [x] Converted note is a normal editable note, and searchable via `Ctrl+K` *(closes the brief's "search should include PDFs" gap)*

> `pdf/layout.rs` takes plain `CharBox` values, **not** pdfium types — that's what makes it testable on a machine with no pdfium. `pdf/extract.rs` is the thin translation layer and holds no decisions. Since verified against a real Analysis sheet, which exposed four bugs synthetic fixtures could not.

### P4-2 Honest degradation — **M** ✅
- [x] Detect maths-font runs and **rebuild them as LaTeX** (`$…$` / `$$…$$`) rather than emitting mangled glyph text
- [x] Detect a near-empty text layer (scanned PDF) *before* converting — landed early in P4-1, since it was five lines and P4-1 must not write a garbage note
- [x] **Offer** Pages mode, not just name it — a button, not only a message
- [x] Never produce a garbled or empty note

> **Shipped as image crops first, replaced with LaTeX the same day.** Crops were visually exact but fail the actual use case — pasting a converted sheet into an LLM prompt needs *text*, not an image, and an image never renders through the editor's own KaTeX nodes either. `pdf/maths.rs` now classifies *which* maths face a glyph came from (`CMMI` variable, `CMSY` relation, `MSBM` blackboard bold, …); `pdf/latex.rs` turns face + geometry into LaTeX. Four real bugs along the way: a radical sits on its own baseline above its radicand and has to be row-merged before its region forms; the subscript-vs-superscript offset threshold was sized for exponents and silently ate every subscript (`T_3` read as `T3`); a maths region bypasses `layout.rs`'s own space synthesis entirely and needed its own; a footnote marker is geometrically identical to a real exponent except that it follows terminal punctuation, which is now the signal that stops it bleeding in.
>
> Verified against the real Analysis sheet: `$f : \mathbb{R}^2 \to \mathbb{R}$`, `$$f(x, y) = \sqrt{x^2 + y^2}.$$`, `$T_3(x, y)$`.
>
> **Known and out of scope (at the time):** multi-line vector/matrix notation has no single-baseline representation and comes out as glyph-order text, not valid LaTeX — a structurally different problem, not a tuning gap. `throwOnError: false` contains the failure to that one equation. *(Bracket-delimited vectors/matrices are now handled — see the P4-2c entry below. A gradient stacked into a column or a Hessian with no enclosing bracket glyph at all is a still-unaddressed variant of this same class.)*
>
> **Hyphenation, fixed separately (not by P4-2):** a word broken across a line was rejoining with a space (`Entwicklungsstel le`). pdfium reports the discretionary hyphen as `U+0002` with `is_hyphen()` set — the synthetic-character filter was dropping it as a control character, discarding the only record that the two halves are one word.

### P4-2b Second real-document pass — **found by comparing a hand-made reference against a converted complex-analysis sheet** ✅ all fixed
Converting a second real PDF and diffing the output against a note the user wrote by hand surfaced two bugs bad enough to matter more than anything P4-2 had already fixed. Later passes against further real documents (see P4-2c) fixed the rest but one.

- [x] **Whole-document prose loss.** The extraction filter used `font_name().is_empty()` to spot pdfium's synthetic layout characters. That signal held for the first document this pipeline was built against, but is producer-dependent — this PDF's real body-text font *also* reports an empty name, and the filter silently discarded every word of German prose in the sheet, keeping only the equations. Now keyed on a near-zero font size instead (pdfium's own filler is consistently ~1.0pt; no real glyph in either document is ever that small).
- [x] **Words torn apart mid-word with no maths or line break involved** (`wird jeweils` → `wirdj eweils`). A generated space's own `x` landed *inside* the following letter's advance box — sorting a row by raw `x` is exactly wrong when one character's coordinate lies. Rows are now ordered by position in the page's own extraction stream, which pdfium never gets wrong even when a glyph's geometry does.
- [x] **Fractions.** Bar-less fractions are now reconstructed into `\frac{}{}` (see commit `05339ad`).
- [x] **`∮` (contour integral) unrecognised.** The placeholder glyphs are now recognised and rendered as `\oint` (see commit `19814ee`).
- [x] **`(a$) C$` boundary artifact.** An enumeration label's closing paren no longer leaks into a following equation's region (see commit `32fb56f`).
- [x] **`ß` → `ÿ`.** Confirmed via `text_object().font()` that pdfium itself decodes this specific font's eszett glyph to `U+00FF`, not our pipeline. The font has no name to key a per-font fix off of, so the real glyph identity can't be recovered — but `ÿ` has no legitimate occurrence in this app's actual content (German/English CS notes), so `extract.rs` now unconditionally treats a body-text `ÿ` as this misdecode and corrects it to `ß`. A deliberate, documented substitution, not a guess.

### P4-2c Third through sixth real-document pass — **Analysis_2_Blatt12.pdf, Ue14.pdf, Analysis_2_Blatt11.pdf, Analysis_2_Blatt1_2026.pdf, Assignment10_DA.pdf** — all fixed
Five more real documents — four Analysis worksheets plus an English-language algorithms assignment, the first non-German, non-Analysis document this pipeline has been tested against — tested the same way: convert, read the output against the source. The ligature item below was closed later than the rest, by a different kind of fix (dictionary disambiguation rather than geometry) once pdfium's own signal was confirmed to genuinely contain nothing further to extract.

- [x] **A diaeresis attached to the wrong letter when its producer draws it *before* the vowel.** `combining_form`'s attachment rule (`layout.rs`) assumed an accent always sorts to just after its letter in stream order — true for the first document this was built against (`fu¨r`), false for Ue14.pdf, which draws `M¨o` (accent, then vowel) for "Möglichkeit". Stream order can't tell the two producers apart, so the rule is now x-proximity: the accent attaches to whichever neighbour, previous or next, its own glyph position is closer to. Fixed several words per page (`können`, `Möglichkeit`, `lösen`, `Reflexivität`, `Transitivität`, `Länge`).
- [x] **A Greek-letter command swallowed the variable right after it.** `\alpha` immediately followed by the variable `f` rendered as `\alphaf` — LaTeX reads a run of letters straight through a backslash as one command name, so that's the undefined command `\alphaf`, not "α then f" (found on Analysis_2_Blatt12.pdf: `L\{\alphaf+\betag\}`). `latex.rs`'s `render()` now inserts a boundary space whenever the text just pushed ends a bare command name and the next text starts with a letter — but only when a `\` actually started that trailing letter run, so two ordinary adjacent variables (`e^{xy}`) stay glued exactly as the source had them.
- [x] **An unrepresentable real glyph silently faked a word-space.** Same underlying discovery as the ligature item below, but the actual fix landed here: a real, body-sized glyph pdfium cannot map to Unicode (confirmed via *two* independent pdfium text APIs — the per-character path and `FPDFText_GetBoundedText` — both return the same result, so this is pdfium's own font data, not an artifact of our extraction) was being dropped outright in `extract.rs`. Dropping is worse than guessing wrong: the glyph vanishes but its geometric slot doesn't, so the gap reads to the space synthesizer as an ordinary word boundary — `Differentialgleichung` silently became the two plausible words `Di erentialgleichung`, with nothing to flag the sentence as broken. It's now kept as `U+FFFD`, which stays inside its word's geometry (`Di�erentialgleichung`) and makes the loss visible instead of silent. Caught the same class of bug in German typographic quotes too (`„Ableitung"` → `�Ableitung�`), not just the three ligatures originally diagnosed.
- [x] **An operator name touching its argument with no space at all was never absorbed into its equation.** `O(m log n)` converted as `$O(m$log$n),$` — three broken fragments, `log` sitting outside any equation as plain text (same shape as `cos(z)` → `cos$(z)$` on Analysis_2_Blatt11.pdf, and `to` correctly staying prose but `s`/`t` on either side of it also splitting apart, `$s \mathrm{to} t$`, on Assignment10_DA.pdf). TeX sets an operator name upright, in the same *text* font family as ordinary prose — indistinguishable from prose by family alone — so `maths_runs`' region-growing had always stopped dead at the first letter of one. Growing outward (and the separate seed-merge step that decides whether two nearby maths seeds fuse at all) now cross a letter run if, and only if, it spells a name from the same known-operator list `latex.rs` already used for rendering — shared as `latex::KNOWN_OPERATOR_NAMES` so the two can't drift apart. The first attempt used "next character is non-alphabetic" as the word-boundary check (to stop "cos" matching inside "cosh") and broke `O(m log n)` a second way: TeX's own math-mode spacing between an operator and a parenthesis-less argument can be *zero*, so `log` sits directly against the italic variable `n` with no space glyph anywhere, and that check rejected the real match too. Fixed by matching the *maximal same-family letter run* instead of a fixed-length prefix — `n` is `Family::Italic`, not a continuation of `log`'s own upright word, so the family change alone marks the boundary regardless of spacing.
- [x] **The plain integral `∫`, like `∮`, falls back to a placeholder pdfium can't identify.** Renders as a bare `Z` (Analysis_2_Blatt1_2026.pdf: `$$Z Z$$`). Confirmed by the same visual-verification standard as `∮`'s `H`/`I` — rendered the page to PNG and looked directly at the glyph before mapping anything, rather than assuming from an encoding table. `Z` at `Family::Extensible` now becomes `\int`. Less of a guess than `∮` even looked: `cmex10` is Knuth's own Metafont program, the same physical font essentially every LaTeX installation embeds unchanged, so this fallback behaviour is a property of that one standard font, not of any one document's producer. What still doesn't reconstruct is the *content* of a definite integral's limits when numerator/denominator/limits span multiple physical rows — the same 2D-layout limitation matrices already have, not a symbol-identity problem.
- [x] **A small inline stacked fraction (no separate physical lines) didn't reconstruct as `\frac{}{}`.** `reconstruct_fractions` only handled a numerator and denominator on two entirely separate physical rows (a fraction bar spanning real vertical space). A *compact* fraction set within one region — `R = \frac{1}{2}` typeset small enough that "1" and "2" are just script-sized glyphs stacked at the same x — has no separate rows to pair, so it fell through to ordinary super/subscript handling with no base character to attach to: `R = ^1_2` (Analysis_2_Blatt11.pdf, twice; Analysis_1_Blatt2_2025.pdf, four times). `render()` now recognises a superscript run immediately followed by a subscript run stacked at (about) the same x, with nothing at base level between them, as this shape specifically. The first version keyed only on x-alignment and immediately regressed a real case on Analysis_2_Blatt12.pdf: `y'_1(t)` (a prime, then a subscript, both on base `y`) started rendering as `y\frac{'}{1}(t)`, because the prime and the "1" *also* land at nearly the same x — both simply sit right where `y` ends. x-alignment alone can't tell "compact fraction" from "prime plus subscript on the same base" apart; what does is whether a real base character immediately precedes the superscript run at all — a fraction's numerator is never attached to one (nothing before `1` in `= 1/2` would sensibly take it as an exponent), while every genuine superscript follows some base glyph directly. Caught by re-running the full six-document sweep after the fix, not by the isolated unit test, which is the whole reason that sweep exists.
- [x] **Ligature glyphs (`ff`, `fi`, `ffi`) decode to font-specific control codepoints, not Unicode.** On Analysis_2_Blatt12.pdf, pdfium hands back `U+001B`/`U+001C`/`U+001E` for the `ff`/`fi`/`ffi` ligatures of a Type1 Computer Modern font. Geometry genuinely can't disambiguate them — `dump_ligature_widths` measured a confirmed `ff` glyph (`U+001B`) at exactly the same width as independently-decoded `f`+`i` — so `pdf::ligatures::disambiguate` (new module, `layout.rs`'s `join_lines`) instead tries every candidate (`ff`/`fi`/`fl`/`ffi`/`ffl`) against a bundled German+English word list (`random_word` crate) and keeps whichever makes the placeholder's whole word real, only when exactly one does. Runs after hyphenated line-wraps rejoin (a word can be split across two physical rows by the PDF's own line breaking, e.g. `di{FFFD}eren` / `zierbaren)`), so the full word is what gets checked. The same module also resolves the standalone-placeholder case for German typographic quotes (`„Ableitung"` was arriving as `�Ableitung�`) — deterministic from position alone (touching a letter on one side, whitespace/boundary on the other), no dictionary needed. Both leave `U+FFFD` visible, not silently wrong, whenever the signal is genuinely ambiguous (e.g. the bullet markers on this same document, `U+0088`, which have a space rather than a letter on the touching side, and stay unresolved).
- [x] **A compact fraction whose numerator carries its own nested exponent split across two rows instead of reconstructing.** `group_lines`'s script-attachment pass (the one that places superscripts/subscripts once body-text rows are set) measured every script glyph's baseline tolerance only against a row's single tallest anchor. Found on Analysis_2_Blatt12.pdf's `e^{-bs}/s` (Laplace transform of the Heaviside step): the numerator's base `e` sits within tolerance of *both* its own exponent `-bs` (touching it, horizontal distance ~0) and the true body row a few points below — and lost that tie-break to the exponent every time, purely on distance, stranding the whole numerator on an isolated row while the denominator `s` (correctly) landed in the body row, with no base character to attach to (rendered as a bare `_s`). Fixed two ways together: scripts are now placed largest-first (a numerator's own exponent is smaller again, the same convention TeX itself uses for nested script sizes, so placing the shallower script first gives the deeper one a real sibling already in the row), and each row's tolerance check now measures against whichever of its own members sits closest in `y` to the candidate, not always the row's single tallest character — letting a nested exponent measure against its own immediate base instead of the row's dominant body text.
- [x] **A piecewise (`\cases`) function definition scattered across four disconnected lines instead of reconstructing.** `H(t-b) = { 1 für t≥b, 0 für t<b` (Heaviside step function, Analysis_2_Blatt12.pdf) is genuine 2D layout: a prefix (`H(t-b) =`), a tall opening brace, and two case rows each splitting into a value and a condition — but the prefix row's own `y` sits *between* the two case rows (TeX centres it vertically against the whole block), which every other reconstruction pass in this file had assumed couldn't happen. New pass `reconstruct_cases` (`layout.rs`, runs in `group_lines` before `reconstruct_fraction_sums`/`reconstruct_tables`, or two aligned case rows read as a two-row table) finds the brace by `latex::is_cases_brace`, collects the case rows below it by left-aligned column rather than by `y`-order, and finds the prefix purely by `x` — the one row whose right edge sits flush against the brace's own left edge. Each case row's value/condition split reuses `split_into_terms`; the condition (`für t ≥ b`, real prose mixed with maths) needed a new `render_condition` helper, since `to_latex` on its own only recognises a fixed, ASCII-only list of operator names as upright text. One real bug caught only by testing against the actual document, not the hand-built fixture: the case-row search had no vertical bound at all, so the page's own footer page-number — coincidentally close to the brace's `x` — joined the candidates and broke the column-alignment check for all of them; `CASES_MAX_ROW_GAP` bounds how far below the brace a row may sit before it stops being a plausible case.
- [x] **A multi-row vector or matrix scattered across disconnected lines instead of reconstructing.** `⃗v(x, y) = (3x² − 3y² + 2x + 2y, −6xy + 2x − 2y)` (Analysis_2_Blatt11.pdf item 6, a 2-row column vector) is the same shape class as the `\cases` block above: a tall bracket pair, content rows between them, and a prefix row (`⃗v(x, y) =`, `.`) whose own `y` sits *between* the content rows rather than above or below all of them. New pass `reconstruct_matrices` (`layout.rs`, runs in `group_lines` right after `reconstruct_cases`) finds the bracket row via a new `latex::bracket_glyph`/`matrix_bracket_row` pair (mirroring `is_cases_brace`/`cases_brace_row`, generalized to two glyphs and tolerant of leading prose sharing the bracket row — confirmed on Analysis_2_Blatt5_2026.pdf item 3, `"3. Gegeben ist das Vektorfeld ("`), collects content rows by x-containment within the bracket's interior span, and splits the prefix row by x into a `before`/`after` pair around the bracket rather than only a `before` (the trailing `.` sits *after* the close bracket). Column count reuses `table_gutters`/`split_row_into_cells` — the same cross-row alignment judgment `reconstruct_tables` already relies on — verified against a genuine `pdflatex`-compiled 2×2 matrix (no real document in the corpus has 2+ columns) rather than a synthetic fixture, since the detection keys off real CMEX placeholder glyphs a mock PDF library never produces. Two real bugs caught only by testing against the actual document: `to_latex`/`synthesize_gaps` requires x-sorted input, but a raw pre-`build_line` row is only roughly x-ordered (final ordering is `build_line`'s own job) — a content row's superscript exponent came out detached and appended at the row's end until every row was explicitly x-sorted before rendering; and, exactly like the cases-block bug, the content-row search had no vertical bound at all, so a later exercise's own `\oint_C` and the page's footer number — both coincidentally sharing the bracket's x-band — joined the candidates from hundreds of points away, which `MATRIX_MAX_ROW_GAP` (mirroring `CASES_MAX_ROW_GAP`) now bounds.

  Follow-up, same entry: **Analysis_2_Blatt7_2026.pdf's six vector fields**, initially left unfixed for using a different, unconfirmed codepoint set, are now also confirmed reconstructing — rendering the page and reading exact geometry showed the "second bracket pair" was never a nested bracket at all: a taller 3-row pmatrix needs its bracket assembled from two stacked half-height Private-Use-Area glyph pieces per side (same x, same width, a fixed 21.519pt vertical offset, identical across all six instances), and the second piece lands glued directly onto the vector's own middle row — simultaneously its prefix (`⃗v(x, y, z) =`), its own second content row, and the stray delimiter piece. Fixed two ways: any `bracket_glyph`-matching character is now stripped from a content row before rendering, wherever it lands (handles the assembled piece without modelling why the font split it); and the prefix-row search now also checks whether that row's own characters include real content inside the bracket's column, folding it into the content set when they do. Along the way, `MATRIX_MAX_ROW_GAP` needed widening (3.0 → 5.0): it was calibrated only against Analysis_2_Blatt11.pdf's 2-row case and excluded the bottom row of a real 3-row one, since the gap is measured from the bracket's own (top-piece) row and grows with row count.

  A second, unrelated bug turned up in the same regression sweep: Ue9.pdf Beispiel 9.3's own large `\left(\right)` delimiter (an even taller, 4-piece assembly, wrapping the inclusion-exclusion formula's nested Σ operators) is geometrically indistinguishable from a real matrix's bracket row, and was swallowing the formula's summation limits as bogus matrix rows. Every real matrix in the corpus has content that's plain algebra with no big operators of its own, so `reconstruct_matrices` now bails out of a match entirely (not just drops the offending row — guessing which to keep would be exactly the kind of forced fix this pipeline avoids) whenever a candidate content row carries an Extensible-family character that isn't a bracket piece.

  Further follow-up: **a system of equations can place several independent small matrices/vectors inline in one sentence** — `⃗y'(t) = Ay(t) + b(t), mit ⃗y(0) = y₀` (Analysis_2_Blatt12.pdf items 4/5), three bracket pairs sharing one row, with both content rows holding all three matrices'/vectors' values interleaved. `matrix_bracket_row`/`reconstruct_matrices` generalize in place from exactly one bracket pair to N (N=1 degrades to the existing behavior, not a separate code path): the bracket-row predicate now accepts any number of alternating open/close pairs separated only by whitespace; content rows are found once across the whole row and sliced per bracket, so each bracket runs today's single-bracket column-splitting independently; and the prefix generalizes from a `before`/`after` pair to N+1 fragments (before the first bracket, between each adjacent pair, after the last). The real-document regression sweep this generalization requires (every prior real case, re-verified) surfaced two more false positives it unlocked: a run of independent `\binom{}{}`s (Ue9.pdf Beispiel 9.2) shares the exact same bracket-plus-two-rows geometry a real vector takes. Fixed with two guards grounded in what actually differs: a content row must touch at least one bracket's own physical column, not just the overall multi-bracket bounding envelope (which had let a stray prose fragment sitting in the gap between two unrelated brackets — "sowohl ... als auch ..." — corrupt the row count); and for N>1 specifically, some text must introduce the brackets (either on the bracket row itself or as prefix text before the first bracket), the way every confirmed real system of equations does and no standalone `\binom` ever does.
- [x] **An accent could be deferred arbitrarily far past its word in stream order, not just to an immediate neighbour.** Originally diagnosed as "grouped onto the wrong row" (Ue14.pdf: `isẗ (jeweils mit Begrundung!).̈`, the `ü` of "Begründung" seemingly attached to the previous row's "ist"), but the real mechanism turned out simpler and much more common: `group_lines`' own row-assignment was already correct — the accent and its letter land in the same row — the bug was entirely inside `build_line`'s stream-index sort, which can place a heavily-deferred accent many positions away from its true base letter within that (correctly identified) row. Confirmed on Analysis_2_Blatt1_2026.pdf's heading: the diaeresis for "Übungsblatt" arrives *eleven* characters after the word, immediately before the next line's own "1." list marker, though its x stays within 1.5pt of the "U" throughout. The existing forward/backward x-proximity attachment (see above) only ever checked immediate stream neighbours, so this fell through it entirely. A new pass, `relocate_stray_accents`, runs once per row before that logic does: for every accent, find the closest non-accent character anywhere else *in that same row* by x; if it isn't already an immediate neighbour, physically move the accent to sit right after it, leaving the existing combining logic to run unmodified. Fixed essentially every remaining accent failure across all six documents at once — `Übungsblatt` (four of six documents' own headings), `Überprüfen`, `erfüllt`, `Äquivalenzrelation`, `eingeführten`, `können/müssen`, and the original `Begründung` — not just the one case it was diagnosed from.
- [x] **A page-footer page number could still leak into the converted note as a stray line, outside the two incidental cases already caught above.** Both prior fixes only bounded a page number's *blast radius* on an unrelated reconstruction pass (`CASES_MAX_ROW_GAP`, `MATRIX_MAX_ROW_GAP`); neither removed the footer itself. `group_lines` now runs `strip_page_furniture` before any other row-level pass, dropping an isolated, pattern-matching page number/header (bare digit, "Seite N", "Page N of M", "- N -") from a region's topmost or bottommost row before it can become body content at all. See `docs/specs/pdf-page-furniture-design.md`.

### P4-2d Seventh real-document pass — Analysis_2_Blatt5_2026.pdf, revisited — all fixed
A closer read of a document already in the corpus (P4-2c's multi-bracket generalization was confirmed against it) turned up three more bugs, none of them matrix/vector-shaped this time.

- [x] **`\vec{}` rendered as a literal accent glued onto its letter.** Computer Modern draws `\vec` by placing the combining right-arrow accent `U+20D7` directly *before* its base letter (confirmed on this document's own char stream) — the opposite of Unicode's own convention, and with no precomposed codepoint the way `layout.rs`'s `combining_form` has for a diaeresis. Unhandled, `⃗v(x, y) = ...` rendered as the bare accent character next to `v` rather than `\vec{v}`; `latex.rs`'s `render()` now recognises the accent and wraps the following character before falling through to the per-character path. (This also fixed the display text of every vector/matrix test from P4-2c — those were asserting on `⃗v`, the un-rendered accent, not `\vec{v}`.)
- [x] **An upright Greek capital touching its word with no space glyph at all stayed stranded as plain prose.** `Potenzialfunktion Φ(x, y)` left `Φ` outside any equation — TeX sets an upright Greek capital in the same upright text font prose uses, so it's indistinguishable from a word by family alone, and unlike the `O(m log n)`/`cos(z)` case, there's no real word gap anywhere to anchor a whole-word match against; the fixed known-operator-name scan only ever matched a complete word, never a single bridgeable symbol glued straight onto one. New `is_bridgeable_symbol` (`layout.rs`) peels off one non-ASCII character at a time when it has its own known `latex::symbol_command` — restricted to non-ASCII so it can never fire mid-word on ordinary Latin prose.
- [x] **A big operator's subscripted limit (`\iiint_K`) reconstructed as a bar-less fraction instead.** Geometrically identical to a fraction's numerator/denominator pair — a maths-only row stacked above another, straddled by a baseline — so `find_fraction_pair` was pairing a triple-integral row with its limit row and emitting `\frac{\int\int\int}{K}` in place of `M = \iiint_K (y+1)\,dx\,dy\,dz`. Generalized `find_fraction_pair` into `find_stacked_pair` (shared geometry search, parameterized by which rows are eligible as the top half and how the two combine) with two callers: `reconstruct_fractions` (unchanged behaviour, now explicitly excluding a big-operator-only top row) and the new `reconstruct_operator_limits`, which collapses a run of identical operator glyphs (`is_repeated_operator_token`/`collapse_operator_run` — `\int \int \int` → `\iiint`) into the limit form instead.

### P4-2e Pipeline completion criteria — **S**, docs only ✅ *frozen 2026-08-13*

> The only subsystem here with no natural end. ~120 commits in the two weeks after P4-2 was declared done, none wrong individually, none bounded collectively. **Ruled fractions was the last 2D shape**; the freeze took effect on its completion. Full reasoning in [ROADMAP.md](docs/ROADMAP.md) §Phase 4.

- [x] Finish ruled fractions — the one named, finite carve-out *(`c72a24e`…`851bfff`; Blatt11 5 → 10 fractions, Blatt10 2 → 3, no sheet reduced)*
- [x] **Corpus frozen** at the documents already in it; adding one is a deliberate decision, not a reflex
- [x] **Bar is "faster than transcribing by hand," not "correct"** — M4's own DoD
- [x] **A new bug earns work only if it is whole-document** (prose loss, mid-word tearing) **or recurs across ≥2 corpus documents.** Single-document cosmetic bugs get recorded here and left — *the load-bearing rule, and the one that will feel wrong to apply*
- [x] **2D-layout reconstruction closed** — matrices, `\cases`, stacked fractions, operator limits, tables, ruled fractions is the complete set. Anything else renders as glyph text; `throwOnError: false` contains it
- [x] **Re-entry only** when real coursework use produces a document failing the by-hand bar — not from a diagnostic sweep

#### Filed, not fixed — the record the freeze creates
Bugs found after the freeze that do not clear the bar above. Recorded so they are not re-discovered, and so a second sighting is visible as a second sighting.

- **`Analysis_2_Blatt10` emits three of exercise 4's sub-parts at depth 0** (`1. Bestimmen Sie die zu $u$ harmonisch konjugierte…`, `2. Stellen Sie die Funktion…`, and the following item), so they read as top-level exercises and *Split Into Tasks* makes them tasks of their own — 7 tasks where the sheet has 4. **Single document**, and therefore filed rather than fixed: it is a depth-detection miss in `layout.rs`, not the intervening-block indent (that was a separate bug, hit two documents, and is fixed). A second sighting on another sheet clears the bar and earns the work.

### P4-3 Exercise splitting & solution scaffold — **M** ✅ — *step 3, closes M4*
- [x] Split on exercise headings (`Aufgabe N`, `Beispiel N.M`, `Task N`, `Exercise N`, `Problem N`, `N.`) into `## Task N` + `### Solution` pairs — **on request only**, via *Split Into Tasks* in the slash menu and File menu
- [x] **"Add next task"** command — appends the next correctly-numbered pair, **with its own canvas**, so space per task is never planned in advance
- [x] **Every `### Solution` holds a handwriting canvas** — the actual point of the workflow; an empty heading left you inserting ink by hand once per exercise
- [x] No heading match → convert as one unsplit document; never drop content

> **Importing a PDF never does this.** The first cut ran splitting unconditionally inside `pages_to_markdown`, which was wrong: asserting a document *is* an exercise sheet is a claim only the reader can make, and a lecture script or a paper would have been rewritten just as readily. A Markdown import now produces plain Markdown and `extract.rs` has a test pinning that; the splitter moved out of `pdf/` to `src/exercises.rs`, since the pipeline no longer calls it and a hand-written note is as valid an input. Nothing is remembered — a remembered "always split" setting would be the same automatic behaviour wearing a checkbox.
>
> **The pattern is chosen once per document, not per block.** Ue5/6/9 name their exercises `Beispiel N.M.` and use *top-level ordered items as sub-parts*, numbered continuously across exercises and restarting partway; the Analysis sheets do the exact opposite. Splitting either by the other's rule cuts inside every exercise it has, so the keyword pattern claims the document outright when it matches twice and ordered items are used only when it does not. Ordered items are then narrowed to the **longest consecutive run starting at 1** — which is what excludes the `11. Übungsblatt` line every Analysis sheet opens with, without a list of title words that would only be a guess about the next document.
>
> Bodies are copied verbatim, because a sub-part sits four spaces under its parent's marker and stripping the marker would leave the children as an indented code block. The cost is a visible `## Task 1` above a `1.` — cosmetic, and cheaper than the nesting damage the alternative risks. The one exception is an opener that is *itself* indented: Ue6's `Beispiel 6.3.` arrives eight spaces in and was silently missed while its four siblings split, costing the sheet an exercise. It is dedented along with its body.
>
> Measured across all ten corpus sheets: every one splits completely, labels taken from the source (`1`…`6`, or `5.1`…`5.5`), no gaps. `pdf/exercises.rs` runs on the assembled Markdown rather than on `Block`s — an exercise routinely spans a page break, and blocks only ever exist one page (one *region*) at a time.

- [ ] **Decide:** split-pane editing (sheet | solution) — *still owed.* Explicitly out of scope for P4-3 and not a dependency of anything shipped above; the scaffold works in one pane. See `docs/specs/pdf-exercise-splitting-design.md`.

---

## ▸ P5 — Versioned workspaces / Git automation (M5)

**Not the cloud sync that was cut** — no accounts, no server, no sync protocol. This drives *your* Git against *your* remote, which is P3-4's promise taken from docs to automation. It's the next tier of P0: P0 made the file on disk safe, this makes yesterday's version recoverable.

Two modes, different defaults — everything here follows from this:

| | Notes-only repo | Notes in a code repo |
|---|---|---|
| History is | yours alone | shared, others read it |
| Auto-push | ✅ yes | ❌ **never** |
| Risk to unrelated work | none | high — your source lives there |

> 🔒 **Don't touch what you didn't create.** Pathspec-scope every Git command; abandon rather than repair an unexpected repo state; leave staged and unstaged source work untouched. A skipped auto-commit costs minutes — a wrong one costs trust in the feature.

### P5-1 Repo detection + per-workspace config — **S/M** ✅
- [x] Detect mode on open: repo root ≈ workspace (notes-only) vs. subtree of a source repo (code repo)
- [x] Shell out to `git`, **not** `git2`/`gix` — inherits credential helpers, SSH agent, signing, `.gitconfig` for free
- [x] Per-workspace, machine-local config beside `.workspace.json` (already gitignored) — "should this machine autocommit" isn't a fact about the notes
- [x] **Opt-in**: detecting a repo prompts once, never starts committing on its own

> `git -C <workspace> rev-parse --show-toplevel`, canonicalized on both sides before comparing (git normalises its own output to forward slashes even on Windows, so a raw string compare against the workspace path would mismatch on separator style alone). Any failure — including `git` missing from `PATH` — reads as "not a repo," off the exit code rather than a parsed message, and never blocks the workspace from opening. Config is two fields only (`prompted`, `autoCommit`) on `WorkspaceState`; cadence and push policy are P5-2's and P5-3's own tasks, not scaffolded here ahead of the code that would read them. A one-time banner (`GitAutoCommitPrompt`) offers the toggle when a repo is first detected; a Settings-panel row (visible only when the open workspace is a detected repo) revisits it later — both go through one `useGitConfig` hook, so there's a single persistence path. Repo mode itself is never persisted, only re-detected each open — it's a fact about the disk that can change between sessions.

### P5-2 Batched auto-commit — **M** ✅
- [x] One commit per session / N minutes idle — never per-save (far coarser than the 600 ms save and 2.5 s reindex debounces)
- [x] Message summarizes which notes changed
- [x] **Always `git add -- <paths>` / `git commit -- <paths>`** — never `git add -A`, never a bare commit that sweeps in staged work
- [x] Skip entirely on mid-rebase/merge/cherry-pick, detached HEAD, or existing conflict markers; report quietly, never repair
- [x] Run hooks and abort on failure — no silent `--no-verify`; opt-in per-workspace toggle to skip them
- [x] **Test: staged and unstaged source changes are byte-identical after an auto-commit.** The one unforgivable failure.

> `checked_auto_commit` resolves the git dir once (`rev-parse --absolute-git-dir`) and answers detached-HEAD/merge/cherry-pick/rebase by reading it directly; only unresolved conflicts need a real `git` call (`ls-files -u`). A conflicted merge sets `MERGE_HEAD` too, so it reports as "a merge is in progress" rather than "unresolved conflicts" — the more specific, more actionable reason; exercising the conflicts check in isolation needed a conflicting `stash pop` instead of a merge. The idle timer lives on the frontend (`useGitAutoCommit`, resets on every new saved path, default 10 minutes via `git.idleMinutes`) and also flushes once on session end. A non-`Committed` outcome leaves the batch pending rather than clearing it, so the next trigger retries instead of losing the changes. First version of the "nothing else touched" test compared the whole-repo diff listing before/after, which is wrong — it shrinks once the note's own change lands; fixed to scope the comparison to the untouched file specifically.

### P5-3 Push policy — **S** ✅
- [x] Notes-only: push after commit (on by default, configurable)
- [x] Code repo: **never auto-push at any setting** — notes ride along with your next real push
- [x] Surface no-remote / auth failure / non-fast-forward; never retry blindly, never force

> `checked_push` refuses `RepoMode::CodeRepo` unconditionally as a Rust-level guard, on top of the frontend's own single call site being gated on `repoMode === 'notesOnly'` — two independent places a code-repo push would have to slip through, not one.

### P5-4 Fast-forward-only auto-pull — **M** ✅ — *most dangerous task on the roadmap*
- [x] Fetch and compare on workspace open (optionally on an interval)
- [x] No divergent local commits → fast-forward silently (P0-5's watcher already debounces the file burst; P3-4 traced this exact path)
- [x] Diverged → **stop.** Bar reusing the P0-5 conflict-bar pattern; you resolve it in the terminal (P8) or your Git tool
- [x] **Never** auto-merge, auto-rebase, or write a conflict marker into a `.md`
- [x] A dirty buffer is never overwritten by a pull — extends the existing CLAUDE.md rule to the pull path
- [x] Test: a deliberately diverged history produces **zero** conflict markers in any `.md`

> `git merge --ff-only` does the actual fast-forward — refuses rather than merging if it isn't a pure fast-forward, or if a local uncommitted change would be overwritten. No new reload logic was needed for the dirty-buffer rule: a fast-forward's resulting file changes are an ordinary external edit, and P0-5's watcher plus `useNote`'s existing conflict handling already cover exactly this path. `GitDivergedBar` reuses `ConflictBar`'s `.conflict-bar` styling rather than a second bar look.

### P5-5 Repo creation for a notes-only workspace — **S** ✅
- [x] Offer `git init` + the `.gitignore` P3-4 documents when the workspace isn't a repo
- [x] Optional GitHub remote via `gh repo create` — **private by default**
- [x] No `gh`? Init locally and print the exact remote command. Never a hard dependency

> `checked_init_notes_repo` never overwrites an existing `.gitignore`. Any `gh repo create` failure — absent, not logged in, network — falls through to `InitializedLocalOnly` with the exact `git remote add origin <url>` command surfaced in an alert. Settings sets `repoMode` to `'notesOnly'` directly after a successful init rather than re-running detection, which reuses P5-1's existing one-time-prompt wiring unchanged: `git.prompted` is still `false`, so the auto-commit banner appears right away.

**Exit check for M5:** notes commit themselves in both modes ✅; a code repo's staged work, unstaged work, branch and history are provably untouched outside note paths (tested) ✅; a fast-forward pull writes no conflict marker and a diverged one stops with a count instead ✅. **M5 reached (2026-08-17).**

---

## ▸ P6 — STEM authoring (M6) ✅

> ⚠️ Every new node needs `addStorage().markdown.serialize/parse`. Without one it serialises as escaped plain text — silent data loss.

> **Finding, 2026-08-13, still worth knowing before diving in: a stream of editor work has no roadmap representation at all.** `BlockHandle`, `Divider`, `TextAlignment`, `Highlight`, `Kbd`, `HTMLBlock`, `HTMLInline`, `SpanStyle`, `Superscript`/`Subscript` and `NoteImage` all exist in `src/editor/extensions/` and correspond to no phase or task here. The Notion half of the app — which [ROADMAP.md](docs/ROADMAP.md) §1 now names as a pillar — is being built off-book, which suggests "STEM authoring" is only part of the real frame ("Notion parity" is the other part). **No longer a blocking rescope** (the step-5 wait it was tied to is superseded, ROADMAP.md §1 2026-08-17) — just a caveat to keep in mind while working through the boxes below, which are genuinely missing either way.
>
> **M6 reached (2026-08-19) — all seven tasks done.**

### P6-1 Proof blocks + collapsible sections — **M** ✅
- [x] Theorem / Lemma / Corollary / Proof / Definition / Example blocks, optional numbering + title
- [x] Collapsible sections — decision made (below), now presentation-only and reachable from `/`
- [x] Build on the existing `Callout` node pattern — don't invent a second block mechanism
- [x] Round-trips through save→reload; prints correctly in PDF export

> **Decided, 2026-08-18: collapse state is presentation-only.** `Details.tsx`'s `open`/closed state is now plain React component state, never a node-attribute update — toggling a section no longer dirties the buffer, so it can't trigger a save or (under P5) an auto-commit for what is purely a view-state click. The tradeoff this gives up: collapse state doesn't survive reopening the note, and a raw `<details>` in the file (no `open` attribute) always renders closed in GitHub — accepted, since the DoD explicitly named this as the requirement, not an oversight. Reachable from `/` as *Collapsible Section*.
>
> **Theorem/Lemma/Corollary/Proof/Definition/Example are new `calloutType` values on the existing `Callout` node**, per the DoD's "don't invent a second block mechanism" — same `> [!TYPE] Title` admonition syntax, with a new `number` attribute (`> [!THEOREM 3.2] Squeeze Theorem`) so P6-7's cross-references have something to resolve against. A `Proof` block appends a QED mark (`∎`) after its last child — CSS only, never stored. All six reachable from `/`; the print stylesheet gets a palette pass and `break-inside: avoid` alongside the existing callout types. A collapsed `Details` section stays in the DOM (hidden via CSS, not unmounted) specifically so PDF export/print can force it visible — otherwise a collapsed section would silently vanish from the exported PDF.

### P6-2 Algorithm blocks — **M** *(after P6-1, reuse its machinery)* ✅
- [x] Complexity / Pseudocode / Implementation / References slots
- [x] Serialises to Markdown that still reads sensibly in any other editor

> **Reuses P6-1's machinery literally** — `algorithm` is one more `calloutType` on the same `Callout` node, no new node type. The four slots are bold-labeled paragraphs (`**Complexity:**`, `**Pseudocode:**`, …) inside the blockquote body rather than a fixed sub-schema, which is what makes it a plain, portable `.md` structure instead of the most bespoke node in the app — a bold line followed by a blank line and its content is legible in any Markdown viewer, GitHub included. Reachable from `/` as *Algorithm Block*, prefilled with all four slots (`Pseudocode`/`Implementation` as code blocks).
>
> **Building this found a real, pre-existing bug in `Callout`'s parser**, not introduced by P6-1/P6-2 but first exercised by them: a blockquote line directly under the marker line, with no blank line before it, is the *same* Markdown paragraph as the marker (a soft line break) — and the old parser's `firstP.remove()` deleted that whole paragraph, marker **and** body, rather than just the marker. Silent content loss on save→reload for any callout typed by hand without a blank line after `[!TYPE]`. Fixed: only the marker's own text characters are stripped from the DOM now: `Callout.tsx`'s `updateDOM` walks `firstP`'s child nodes, removing whole nodes that fall inside the marker line and `Text.deleteData`-splitting the one that straddles the boundary, leaving everything after it — including inline marks — as the callout's real first body paragraph.
>
> **Filed, not fixed — a separate, narrower bug surfaced while testing the fix above:** a `<strong>` (or presumably any mark) run that ends immediately adjacent to more plain text with **no space or line break between them**, inside a `Callout`'s `wrapBlock`-serialized body, round-trips with its closing `**` misplaced (`**Complexity**:X` instead of `**Complexity:**X`) — confirmed via raw JSON content, so it's in `wrapBlock`/`renderContent`'s interaction with prosemirror-markdown's own mark-boundary logic, not in the parser fixed above. Doesn't reproduce through the actual `/` insertion path (each slot's label and value are separate paragraphs), only through hand-typed Markdown with a mark glued straight onto trailing text. Single, narrow trigger condition — recorded rather than chased, same posture as the frozen PDF pipeline's filed-bugs list.

### P6-3 Templates — **S/M** ✅
- [x] `templates/` folder in the workspace; "New from template" in sidebar + File menu (`Ctrl Shift T`)
- [x] Placeholder substitution — `{{date}}`, `{{title}}`, and any `{{name}}` the template uses, prompted at creation time; no logic beyond literal find-and-replace
- [x] Ship the P4-3 exercise-sheet layout as the first template

> `templates/` is excluded from the ordinary note scan (`is_excluded_dir`, same plumbing as `node_modules`/sidecars) — a template is authored to be filled in, not a note in its own right. The dialog always asks for a note title (needed for the filename regardless of what the template contains) plus one field per `{{name}}` the template actually uses, `{{date}}` pre-filled with today. Seeding the starter template is its own opt-in button in the empty state — nothing writes into `templates/` until asked, same posture as P7-3's project-notes scaffold. `create_note_from_template` writes the filled content verbatim rather than synthesizing a `# {title}` heading, so a template's own structure survives exactly as authored.

### P6-4 Equation snippets — **S** ✅
- [x] `/gradient` → `\nabla f(x)` and friends, as one editable table
- [x] Offered only in a maths context

> `SlashCommands` turned out to be unreachable here: `InlineMath`/`BlockMath` edit LaTeX in a plain `<input>`/`<textarea>` outside ProseMirror, and the `Suggestion` plugin only sees PM transactions. `src/lib/mathSnippets.ts` holds the twenty-entry table plus three pure functions (`activeSlashQuery`, `matchMathSnippets`, `applyMathSnippet`); `useMathSnippetMenu` wires them to a live input (caret tracking, keyboard nav), shared by both node views via one `MathSnippetMenu` dropdown.

### P6-6 Outline / TOC panel — **S** ✅
- [x] Current note's headings in the right rail, click to jump
- [x] Highlight the heading currently in view
- [x] Share the rail with the backlinks panel — no third permanent column
- [x] Toggle on the P2-2 shortcut layer

> No backend work — heading data is already in the ProseMirror doc. Proposed with the P9 study features but moved here: it's **S** and serves any long note, so parking it behind three phases would waste it.
>
> The "rail" isn't literal — `BacklinksPanel` is an inline strip at the bottom of the note, not a persistent column — so `OutlinePanel` sits directly above it in the same flow rather than in a new column. Shown only via **Toggle Outline** (`Ctrl Shift O`), lifted to `Layout` state like `toggle-terminal`/`graph-view`. The active heading tracks `getBoundingClientRect()` against `.editor-scroll` on every scroll event.
>
> **Bug fix, 2026-08-19 (user-reported): toggling this on an empty note froze the app.** The original design collected headings via a `MutationObserver` on `.editor-pane`'s own rendered DOM — which includes ProseMirror's live contentEditable, a surface that mutates its own DOM for internal reasons unrelated to content (a trailing `<br>` it adds/removes for cursor placement). Watching it fed back into itself and pegged the main thread. Fixed by dropping DOM observation for the heading list entirely — `lib/outlineHeadings.ts` parses headings from the note's own markdown text (already live every keystroke), and the DOM is read only in direct response to a click or scroll, never continuously. Caught permanently by `e2e/specs/p6-6-outline-panel.e2e.ts`, which asserts the app stays responsive after toggling, not just that a DOM query resolves — the failure mode a passing assertion alone would have missed the first time. Reaching the toggle from e2e needed `Layout.tsx`'s new `__e2eRunCommand` hook, since WebDriver can't drive the native menu this was previously gated behind.

### P6-7 Cross-references — **S** *(added 2026-08-18, from a review pass)* ✅
- [x] Recognise `Theorem 3.2` (block-type keyword + its own number) in prose, resolved against P6-1's numbered blocks
- [x] `[[Theorem: name]]` continues to work unchanged — an ordinary wiki-link, just pointed at a block-bearing note
- [x] Clicking a resolved reference jumps to the block; an unresolvable one renders inert, same "prefer a miss" posture as P7-1/P1-1

> **Dependency:** P6-1 (block numbering is the referent).
>
> Built as `CodeLink`'s structural cousin: `src/lib/crossRefs.ts` recognises the seven numbered `calloutType` keywords + a dotted number; `CrossRef.ts` decorates and resolves them batched-and-cached, exactly like P7-1. Resolution reuses the FTS index rather than a new one — `db::notes::marker_like_pattern`/`note_containing_marker` LIKE-match a callout's own serialized `> [!TYPE NUMBER]` marker against `notes_fts`'s stored body, escaping `%`/`_` so a number containing `_` can't act as a wildcard. Jumping to the exact block needed `Callout.tsx`'s node view to actually carry `data-callout-type`/`data-callout-number` on its DOM, which it never had — the schema's own `renderHTML` attribute mapping is bypassed once a node view takes over.

### P6-5 Search refinement — **S** ✅ *(closes M6)*
- [x] Filter results by folder and by tag, without leaving the keyboard
- [x] Recent-searches list, persisted per workspace
- [x] `type:` (block type, once P6-1/P6-2 exist) — `task:` left out: P9-1's `note_tasks` table doesn't exist yet, per the roadmap's own "optional extension, not a blocker"

> `src/lib/searchQuery.ts` parses the fixed `folder:`/`tag:`/`type:` key list (no quoting, deliberately not a query language); filters compose freely with each other and with free text. Fixing this properly meant scoping `search_notes` to a workspace for the first time — it previously searched across every workspace this app's shared `index.db` has ever indexed, a real gap a `folder:`/`tag:` filter would otherwise have inherited. Recent searches persist through `WorkspaceState.recentSearches`, the same save/load checkpoints as `openTabs`/`expandedFolders`; a query is recorded only when a result is actually opened.

---

## ▸ P7 — IDE integration (M7) ✅ — ***step 4: the dogfood slice, moved ahead of P5 and P6***

The brief's second pillar. Notes stay plain `.md` — a deep link is ordinary Markdown that degrades to readable text elsewhere.

> **Why this moved ahead of P5 and P6 (2026-08-13).** It is the only item on the board that changes what *future* planning is based on — everything else produces a feature, this produces evidence. The roadmap prioritizes by `daily-use value × friction ÷ effort` and nobody is currently supplying the daily-use term: the maintainer has been building, not using. This project's own `docs/` — 18 specs, a plans folder, a 735-line roadmap — is a real daily Markdown workflow being done in another editor right now.
>
> **Milestone for the slice: this repo's `docs/` lives in null-notes and gets edited there.** Order within it: ignore list → P7-3 → P7-4 + P7-1 together → P8-1.

### P7-3a Scan ignore list — **S** ✅ — *done first; it was the whole unlock*

> `is_excluded_dir` skipped only `.ink` and dot-directories, so the scan walked `node_modules/` and `target/` — 580 `.md` files across 218 dependency directories in this repo, against the 46 in `docs/` actually wanted. Now excludes `node_modules`, `target`, `dist`, `build` (exact match, so a folder named `distributed` survives) and the `.pdf`/`.assets` sidecars that had been left in the tree alongside the already-excluded `.ink`.
- [x] Exclude `node_modules`, `target`, `dist`, `build` in `is_excluded_dir` (`src-tauri/src/commands/notes.rs`) — it had skipped only `.ink` and dot-directories
- [x] DoD: opening this repo as a workspace lists `docs/` and nothing from `node_modules/` or `target/`, as fast as a notes-only workspace — *unit-verified on the predicate and by file counts; the in-app open is part of the dogfood slice itself*

> A workspace is just a folder scanned for `.md`, so "open a code repo as a workspace" **already works** — the scan simply drowns in dependencies first. P7-3 was scheduled **M** behind three phases; the part that actually unblocks daily use is hours.

> 🔒 First feature to launch external processes **using text taken from note content.** Pass paths as arguments to a configured command, never through a shell; refuse paths escaping the workspace/project root.

### P7-1 Code deep links — **M** ✅ *(landed together with P7-4)*
- [x] Recognise `src/main.cpp:58` and `path/file.rs#L20-L30` in note text
- [x] Resolve relative to workspace root — *project root deferred with P5-1's repo detection; a link outside the workspace is inert rather than wrong*
- [x] Click opens the configured editor at that file and line
- [x] Unresolvable path renders inert with a "not found" affordance, like an unresolved wiki-link
- [x] Shell metacharacters in a path cannot cause command execution — **with a test**

> **Three structural guarantees, not checks.** No shell ever (`Command` with one `.arg()` per argument). The template is tokenized **before** substitution, never after — substituting first and splitting after would reintroduce word-splitting, so the tokenizer never sees a resolved path at all. And a target is refused unless every component is `Component::Normal`, following `assets.rs`: rejected *as written* rather than normalised and compared, because normalising invites a gap between the string checked and the string used. Ten backend tests, including a path containing `; rm -rf ~` staying one argument.
>
> Recognition is deliberately narrow — a separator **and** a file extension are both required, or `Analysis 2:`, a `10:30` timestamp and a bare `README` all become links. A wrong link that launches an editor is worse than no link. Existence comes from a batched, cached `resolve_code_links`; a failed lookup renders inert rather than failing open.

### P7-4 Editor command setting — **S** ✅ *(landed with P7-1, not after)*
- [x] Configurable launch command template (VS Code / JetBrains / Neovim / Sublime) in the settings panel
- [x] Detect what's installed — probes `PATH` via `where`/`which` on load, **only when the template is empty**, so a typed template is never overwritten
- [x] Switching editors changes where links open, with no code change

### P7-2 "Open in IDE" on code blocks — **S** ✅
- [x] Action on code blocks that carry a source path, reusing P7-1's launcher and guardrails
- [x] Appears only when the path resolves — never a dead button

> A block "carries a source path" when its first line, comment marker optional (`//`, `#`, `--`, `;`, `%`), is nothing but the path — `// src/main.rs` above a pasted function, which is already how this gets written by hand. `codeBlockSourcePath` (`lib/codeLinks.ts`) reuses `findCodeLinks` rather than a second recognizer; a path named only in passing ("see src/main.rs for details") or a block naming two paths matches nothing, same "prefer a miss" posture as P7-1. The button is a widget decoration — nothing new stored in the document, nothing to serialize — sharing `CodeLink`'s resolution cache and its `resolve_code_links`/`open_in_editor` backend commands directly (`resolveMissing` now exported for this). Hidden in the P3-2 print export as an interactive-only affordance.

### P7-3 Project awareness & project notes — **M** ✅
- [x] Open a code repo as a workspace; surface its `README.md` / `docs/` / `notes/` with no import step — *delivered by P7-3a, then verified: this repo now scans to ~60 real `.md` files across `docs/`, `notes/` and the root, and nothing else*
- [x] Opt-in scaffold of `notes/` (Architecture / Meeting / Research / Todo) — **never automatic**, never writes into source folders

> Reachable from **File > Scaffold Project Notes** and nowhere else, behind a confirm naming the folder — it is the one command in the app that can put files inside somebody's source repository, so nothing on the workspace-open path may call it. It never overwrites: a repo already keeping `notes/Todo.md` gets the missing three and keeps the real one, and a second run creates nothing. Four backend tests cover the folder boundary (a `src/` alongside it is untouched, byte for byte), the top-up, and the second-run no-op.

---

## ▸ P8 — Embedded terminal (M8) ✅

The brief's AI ask is a *terminal* feature, not an AI feature: no AI code, no API keys, works with any CLI. P0-5's watcher already makes externally-edited files safe.

### P8-1 Terminal pane — **M/L** ✅
- [x] PTY-backed pane rooted at the workspace
- [x] Active note's path available as an env var + one-key insert
- [x] `claude` editing the open note updates the editor through the **existing** watcher path — no new reload logic, no conflict special-case
- [x] Closing the pane leaves no orphaned process

> Done. `portable-pty` (ConPTY on Windows) + `xterm.js`, base64-chunked output over a Tauri event (same shape as `read_ink`/`read_pdf_page`). Toggling (`Ctrl+\``) only flips CSS visibility — the shell survives being hidden; only "Kill Terminal" or the app window closing actually tears it down. `NULL_NOTES_ACTIVE_NOTE` is frozen at spawn time; the header button covers the live case. One real bug found in manual QA: the insert-path button silently did nothing because `terminal_open`'s spawn wasn't awaited before the first write — a human's typing speed outlasted the race, a fast click didn't. Fixed by chaining every write onto the open promise; regression test confirmed against the pre-fix code via `git stash`. Design: `docs/specs/terminal-pane-design.md`.

---

## ▸ P9 — Study & revision (M9)

The only phase not from the brief. Everything before it is *capture*; this is *retrieval* — what happens at exam time.

> ⚠️ Study state is **data, not index.** Deleting `index.db` must lose nothing, so nothing here may keep its only copy in SQLite. Source of truth in the `.md`, derived table rebuilt by `reindex_note` — same shape as `note_tags`. **Test for every task: delete `index.db`, reopen, is anything gone?**

### P9-1 Workspace-wide task view — **S/M** ✅
- [x] Extract `- [ ]` / `- [x]` into a `note_tasks` table (path, text, done, position), mirroring `note_tags`
- [x] Build it in the existing `reindex_note` path — inherits the P0-3 debounce and P0-5 watcher for free
- [x] View of open tasks grouped by note/folder; click jumps to the task
- [x] Ticking from the view writes through the normal save path
- [x] Delete `index.db`, reopen → identical list (rebuildable the same way `note_tags`/`note_links` already are — lazily, on next reindex, not eagerly on scan)

### P9-2 Formula sheet generation — **M** ✅
- [x] Collect all block math across a scope (folder / tag / workspace)
- [x] Output a **generated note** — plain `.md`, editable afterwards, printable via P3-2
- [x] Deduplicate identical formulas
- [x] Optional caption: source note + heading
- [x] Generate on demand — **no live-updating magic file** that rewrites itself behind your back

### P9-3 Spaced repetition — **decision, then L**
- [ ] **Decide storage before writing any code** — not refactorable later; it determines what happens to every existing card when a note is renamed
  - **A — inline HTML comment beside each card** *(recommended)*: `<!-- sr due=… ease=… interval=… -->`. Survives renames/moves/Git with no key tracking — which matters because note `id` is non-stable and `path` is the real key. Cost: reviews write note files and churn Git history.
  - **B — `.review.json` sidecar**: notes stay pristine, but cards need stable keys — reintroduces the identity problem the app has avoided by never needing one. Editing a card or moving its note can silently orphan its schedule.
  - **C — frontmatter**: rejected on inspection. Cards are per-*card*, not per-note, so it's all of B's identity problem with none of A's locality.
- [ ] Card syntax: cloze deletion + `Question :: Answer`
- [ ] **P6-1 theorem/proof blocks become cards for free** — the real reason P6 precedes P9
- [ ] SM-2 scheduling + review session UI
- [ ] Derived `review_cards` table for "what's due", rebuildable from the notes
- [ ] Cards stay readable as plain Markdown in any other editor
- [ ] Renaming/moving a note does not orphan its cards

> This is the named trigger for the **frontmatter** decision deferred in the roadmap. If Option A wins, frontmatter may never be needed at all.

### P9-4 Workspace dashboard — **M** *(added 2026-08-18, from a review pass; capstone — sequence last in P9)*
- [ ] **Continue** — last few open notes, from `.workspace.json`'s existing session state
- [ ] **Recent** — recently edited notes, from existing mtime
- [ ] **Tasks** — open count, from P9-1's `note_tasks`
- [ ] **Study** — cards due today, from P9-3's `review_cards`
- [ ] **Git** — up-to-date / unpushed / diverged, from P5's existing status calls
- [ ] No new derived state — every section reads data another task already produces
- [ ] Clicking an item opens it exactly like its source view would

> **Dependency:** P9-1, P9-3, P5-2/P5-3/P5-4 — it has nothing to show without them.

---

## ▸ P10 — Gated stretch (M10)

Do not let these influence P0–P9 design.

- [ ] **P10-1 In-app AI assistant** — **L**. Gated on M0 *and* on P8 proving insufficient; if the terminal covers the need, this may never need building.
- [ ] **P10-2 In-editor code execution** (Python / C++) — **L**. Gated on a dedicated design + security pass.

---

## Done

<details>
<summary><strong>P0 — Trustworthy daily driver (M0 ✅)</strong></summary>

- [x] P0-1 Debounced autosave with `clean|dirty|saving|error` state; flushes on tab switch, unmount, window close
- [x] P0-2 Save failures surface with retry; buffer stays dirty on failure
- [x] P0-3 `save_note` writes the file only; `reindex_note` carries FTS/tags/links on a lazier debounce
- [x] P0-4 `write_atomic` — temp file → fsync → rename
- [x] P0-5 Workspace watcher; clean buffers follow disk, dirty ones get a conflict bar
- [x] Real-use soak — no data-loss incident

</details>

<details>
<summary><strong>P1 — Everyday-use completeness (M1 ✅)</strong></summary>

- [x] P1-1 Clicking an unresolved `[[link]]` creates and opens the note
- [x] P1-2 Recent workspaces + `Ctrl+P` quick switcher
- [x] P1-3 Rename a note; inbound `[[links]]` follow
- [x] P1-4 Destructive deletes confirm (was already true on audit)
- [x] P1-5 App identity — `null-notes`, `dev.nullnotes.app`, real README *(app icon still Tauri's default — needs an asset, not a code change)*

</details>

<details>
<summary><strong>P2 — Feel & ergonomics (M2 ✅)</strong></summary>

- [x] P2-1 Settings panel — autosave delay, editor width; persists to `settings.json` in the app data dir
- [x] P2-2 Native File/Edit/View menu + shortcuts overlay, one command dispatcher
- [x] P2-4 Onboarding empty states
- [x] P2-3 Editor niceties — all four boxes:
  - [x] Spellcheck toggle driving both editors, off by default; `#[serde(default)]` so a pre-existing `settings.json` still loads. Checks **prose only** — code, maths, mermaid, tags and wiki-link targets set `spellcheck="false"` and inherit out of it *(whether squiggles render at all is a WebView2/OS capability, not ours)*
  - [x] Paste/drop images into a `NoteName.assets/` sidecar as ordinary `![alt](path)` Markdown *(paths are URL-encoded only at the Markdown boundary — sidecar names contain spaces, and a bare space ends a link destination)*
  - [x] Cursor + scroll restored per note across tab switches
  - [x] Backspace at the start of a non-first list item joins into the previous item instead of tearing the list in half

> Append any new annoyance found in daily use to a fresh P2-3 box here rather than opening a new task.

</details>

<details>
<summary><strong>P3 — Headline features (M3 ✅)</strong></summary>

- [x] P3-1 PDF import as reference images; OCR pipeline deleted; pages land in a `NoteName.pdf/` sidecar
- [x] P3-2 Export to PDF via the WebView print pipeline + a `@media print` stylesheet
- [x] P3-3 Connections graph — `d3-force`, ticked to convergence, no per-frame re-render
- [x] P3-4 Git/Syncthing sync guidance *(mostly already true by construction)*

</details>

<details>
<summary><strong>Editing core (pre-roadmap)</strong></summary>

- [x] Live-preview WYSIWYG, plain `.md` as the only format, GitHub Markdown
- [x] KaTeX (inline + block), Mermaid, syntax-highlighted code, callouts, tables, task lists
- [x] Wiki-links + backlinks panel, `#tags` + tag browser, FTS search (`Ctrl+K`)
- [x] Vector ink blocks inline in notes — pen/eraser/shapes, pressure, palm rejection
- [x] Folder tree with create/rename/delete cascade, drag-to-move
- [x] Per-workspace session persistence (open tabs, expanded folders)
- [x] "Terminal Precision" design system

</details>

---

## Not doing

Cut with reasoning in [ROADMAP §4](docs/ROADMAP.md#4-challenged--cut--de-scoped-features). Adding any of these back is a scope change, not a task.

| | Why |
|---|---|
| ~~OCR→LaTeX pipeline~~ | Cut permanently — P4 reaches the same outcome from the text layer |
| ~~Handwriting search~~ | Needs handwriting recognition; ink is for working through a proof, not for retrieval |
| ~~Version history / snapshots~~ | Challenged — Git already does this and P3-4 assumes a Git-synced workspace. If ever wanted, it's a thin read-only wrapper over `git log`, not a second storage system |
| ~~Query blocks / Dataview-lite~~ | Challenged — a query language has no natural end, and it would pull frontmatter design forward speculatively. P6-5 filters + P9-1 task view cover the realistic 90% |
| ~~Lecture audio + timestamped notes~~ | A different product surface bolted onto an app whose value is plain-text portability. An audio file is not a `.md` |
| ~~Citations / BibTeX~~ | A thesis need, not a coursework one; Zotero exists |
| ~~Presentation / slides mode~~ | Niche — P3-2's PDF export already covers sharing with a study group |
| ~~Graphviz, TikZ export~~ | Challenged — Mermaid + PDF export already cover the real need |
| ~~Cloud sync, mobile, collaboration~~ | Local-first, desktop, single-user — all three are a different product. *(P5 automates your own Git against your own remote — that's P3-4 taken further, not a reversal.)* |
| ~~Resolving merge conflicts~~ | P5 commits and fast-forwards only. The app never merges, rebases, force-pushes, resets, or edits a conflicted file |
| ~~Workspace remembers AI conversations~~ | Belongs to the CLI tool once P8 lands, not to this app |
| ~~Becoming an IDE~~ | P7 integrates with your editor. If a task starts wanting a language server, it's out of scope |
| ~~Installers, auto-update, code-signing~~ | Personal tool; revisit only if the audience changes |
| ~~Stable note `id`~~ | `path` is the working key. Re-examine only if P7 needs a durable handle |
| ~~CodeMirror migration~~ | The brief named it; TipTap is what makes WYSIWYG-with-inline-ink possible |

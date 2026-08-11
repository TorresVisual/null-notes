# null-notes — TODO

## Issues Discovered

* [ ] Spellcheck for German
* [ ] Derivatives like y' get parsed to ^'y
* [ ] Math doesnt get rendered in block maths

Feature checklist. **The [roadmap](docs/ROADMAP.md) holds the reasoning and the Definitions of Done; this file holds the boxes.** If the two disagree, the roadmap wins.

Effort: **S** ≈ hours · **M** ≈ a day or two · **L** ≈ several days.

**Now:** M2 closed; P4-1 and P4-2 done. Next: P4-3 (exercise splitting), which closes M4.

**Two decisions owed before their phase starts:** split-pane editing (during P4) and spaced-repetition storage (before any P9-3 code).

---

## Progress

| Phase | Milestone | |
|---|---|---|
| P0 Trustworthy daily driver | M0 — I trust it with my real notes | ✅ |
| P1 Everyday-use completeness | M1 — I don't reach for another app | ✅ |
| P2 Feel & ergonomics | M2 — a pleasure to use for hours | ✅ |
| P3 Headline features | M3 — the CS superpowers land | ✅ |
| P4 PDF→Markdown & exercise sheets | M4 — a sheet becomes a workable note | 2/3 |
| P5 Versioned workspaces (Git) | M5 — my notes commit themselves | |
| P6 STEM authoring | M6 — fastest place to write maths | |
| P7 IDE integration | M7 — notes and code are one workflow | |
| P8 Embedded terminal | M8 — `claude` runs against the open note | |
| P9 Study & revision | M9 — the app helps me *revise*, not just capture | |
| P10 Gated stretch | M10 — in-app AI + code execution | gated |

---

## ▸ P4 — PDF → Markdown & exercise sheets (M4) — next up

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

### P4-3 Exercise splitting & solution scaffold — **M**
- [ ] Split on exercise headings (`Aufgabe N`, `Task N`, `Exercise N`, `Problem N`, `N.`) into `## Task N` + `### Solution` pairs
- [ ] **"Add next task"** command — appends the next correctly-numbered pair, so space per task is never planned in advance
- [ ] No heading match → convert as one unsplit document; never drop content

- [ ] **Decide:** split-pane editing (sheet | solution) — deferred until now, and this is the first case with a concrete argument for it

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

### P5-1 Repo detection + per-workspace config — **S/M**
- [ ] Detect mode on open: repo root ≈ workspace (notes-only) vs. subtree of a source repo (code repo)
- [ ] Shell out to `git`, **not** `git2`/`gix` — inherits credential helpers, SSH agent, signing, `.gitconfig` for free
- [ ] Per-workspace, machine-local config beside `.workspace.json` (already gitignored) — "should this machine autocommit" isn't a fact about the notes
- [ ] **Opt-in**: detecting a repo prompts once, never starts committing on its own

### P5-2 Batched auto-commit — **M**
- [ ] One commit per session / N minutes idle — never per-save (far coarser than the 600 ms save and 2.5 s reindex debounces)
- [ ] Message summarizes which notes changed
- [ ] **Always `git add -- <paths>` / `git commit -- <paths>`** — never `git add -A`, never a bare commit that sweeps in staged work
- [ ] Skip entirely on mid-rebase/merge/cherry-pick, detached HEAD, or existing conflict markers; report quietly, never repair
- [ ] Run hooks and abort on failure — no silent `--no-verify`; opt-in per-workspace toggle to skip them
- [ ] **Test: staged and unstaged source changes are byte-identical after an auto-commit.** The one unforgivable failure.

### P5-3 Push policy — **S**
- [ ] Notes-only: push after commit (on by default, configurable)
- [ ] Code repo: **never auto-push at any setting** — notes ride along with your next real push
- [ ] Surface no-remote / auth failure / non-fast-forward; never retry blindly, never force

### P5-4 Fast-forward-only auto-pull — **M** — *most dangerous task on the roadmap*
- [ ] Fetch and compare on workspace open (optionally on an interval)
- [ ] No divergent local commits → fast-forward silently (P0-5's watcher already debounces the file burst; P3-4 traced this exact path)
- [ ] Diverged → **stop.** Bar reusing the P0-5 conflict-bar pattern; you resolve it in the terminal (P8) or your Git tool
- [ ] **Never** auto-merge, auto-rebase, or write a conflict marker into a `.md`
- [ ] A dirty buffer is never overwritten by a pull — extends the existing CLAUDE.md rule to the pull path
- [ ] Test: a deliberately diverged history produces **zero** conflict markers in any `.md`

### P5-5 Repo creation for a notes-only workspace — **S**
- [ ] Offer `git init` + the `.gitignore` P3-4 documents when the workspace isn't a repo
- [ ] Optional GitHub remote via `gh repo create` — **private by default**
- [ ] No `gh`? Init locally and print the exact remote command. Never a hard dependency

---

## ▸ P6 — STEM authoring (M6)

> ⚠️ Every new node needs `addStorage().markdown.serialize/parse`. Without one it serialises as escaped plain text — silent data loss.

### P6-1 Proof blocks + collapsible sections — **M**
- [ ] Theorem / Lemma / Corollary / Proof / Definition / Example blocks, optional numbering + title
- [ ] Collapsible sections; collapse state is presentation-only, never touches the `.md`
- [ ] Build on the existing `Callout` node pattern — don't invent a second block mechanism
- [ ] Round-trips through save→reload; prints correctly in PDF export

### P6-2 Algorithm blocks — **M** *(after P6-1, reuse its machinery)*
- [ ] Complexity / Pseudocode / Implementation / References slots
- [ ] Serialises to Markdown that still reads sensibly in any other editor

### P6-3 Templates — **S/M**
- [ ] `templates/` folder in the workspace; "New from template" in sidebar + File menu
- [ ] Minimal placeholder substitution (date, title) — nothing more
- [ ] Ship the P4-3 exercise-sheet layout as the first template

### P6-4 Equation snippets — **S**
- [ ] `/gradient` → `\nabla f(x)` and friends, as one editable table
- [ ] Offered only in a maths context

### P6-5 Search refinement — **S**
- [ ] Filter results by folder and by tag, without leaving the keyboard
- [ ] Recent-searches list, persisted per workspace

### P6-6 Outline / TOC panel — **S**
- [ ] Current note's headings in the right rail, click to jump
- [ ] Highlight the heading currently in view
- [ ] Share the rail with the backlinks panel — no third permanent column
- [ ] Toggle on the P2-2 shortcut layer

> No backend work — heading data is already in the ProseMirror doc. Proposed with the P9 study features but moved here: it's **S** and serves any long note, so parking it behind three phases would waste it.

---

## ▸ P7 — IDE integration (M7)

The brief's second pillar. Notes stay plain `.md` — a deep link is ordinary Markdown that degrades to readable text elsewhere.

> 🔒 First feature to launch external processes **using text taken from note content.** Pass paths as arguments to a configured command, never through a shell; refuse paths escaping the workspace/project root.

### P7-1 Code deep links — **M** *(land together with P7-4)*
- [ ] Recognise `src/main.cpp:58` and `path/file.rs#L20-L30` in note text
- [ ] Resolve relative to workspace root, or project root if the workspace sits inside one
- [ ] Click opens the configured editor at that file and line
- [ ] Unresolvable path renders inert with a "not found" affordance, like an unresolved wiki-link
- [ ] Shell metacharacters in a path cannot cause command execution — **with a test**

### P7-4 Editor command setting — **S** *(not after P7-1 — with it)*
- [ ] Configurable launch command template (VS Code / JetBrains / Neovim) in the settings panel
- [ ] Detect what's installed
- [ ] Switching editors changes where links open, with no code change

### P7-2 "Open in IDE" on code blocks — **S**
- [ ] Action on code blocks that carry a source path, reusing P7-1's launcher and guardrails
- [ ] Appears only when the path resolves — never a dead button

### P7-3 Project awareness & project notes — **M**
- [ ] Open a code repo as a workspace; surface its `README.md` / `docs/` / `notes/` with no import step
- [ ] Opt-in scaffold of `notes/` (Architecture / Meeting / Research / Todo) — **never automatic**, never writes into source folders

---

## ▸ P8 — Embedded terminal (M8)

The brief's AI ask is a *terminal* feature, not an AI feature: no AI code, no API keys, works with any CLI. P0-5's watcher already makes externally-edited files safe.

### P8-1 Terminal pane — **M/L**
- [ ] PTY-backed pane rooted at the workspace
- [ ] Active note's path available as an env var + one-key insert
- [ ] `claude` editing the open note updates the editor through the **existing** watcher path — no new reload logic, no conflict special-case
- [ ] Closing the pane leaves no orphaned process

---

## ▸ P9 — Study & revision (M9)

The only phase not from the brief. Everything before it is *capture*; this is *retrieval* — what happens at exam time.

> ⚠️ Study state is **data, not index.** Deleting `index.db` must lose nothing, so nothing here may keep its only copy in SQLite. Source of truth in the `.md`, derived table rebuilt by `reindex_note` — same shape as `note_tags`. **Test for every task: delete `index.db`, reopen, is anything gone?**

### P9-1 Workspace-wide task view — **S/M** — *start here*
- [ ] Extract `- [ ]` / `- [x]` into a `note_tasks` table (path, text, done, position), mirroring `note_tags`
- [ ] Build it in the existing `reindex_note` path — inherits the P0-3 debounce and P0-5 watcher for free
- [ ] View of open tasks grouped by note/folder; click jumps to the task
- [ ] Ticking from the view writes through the normal save path
- [ ] Delete `index.db`, reopen → identical list

### P9-2 Formula sheet generation — **M**
- [ ] Collect all block math across a scope (folder / tag / workspace)
- [ ] Output a **generated note** — plain `.md`, editable afterwards, printable via P3-2
- [ ] Deduplicate identical formulas
- [ ] Optional caption: source note + heading
- [ ] Generate on demand — **no live-updating magic file** that rewrites itself behind your back

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

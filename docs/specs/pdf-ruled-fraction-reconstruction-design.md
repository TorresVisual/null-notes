# PDF fraction reconstruction from drawn rules

## Problem

`Analysis_2_Blatt11.pdf` page 0 sets ten fractions. The pipeline reconstructs five. Every miss is on a row carrying *several* fractions side by side — items 4 and 5, each a contour integral whose integrand is a sum of three or two fraction terms.

The rows involved, as `dump_lines` reports them:

| y | content | role |
|---|---|---|
| 247.63 | `cos(z)4z1` | all three numerators, concatenated |
| 242.05 | *three drawn bars* | the fraction bars, discarded by the pipeline |
| 239.54 | `++dz,` | baseline: connectors **and** integrand residue |
| 234.79 | `z2z−2z+ 1z324` | all three denominators, concatenated |

Note that the baseline row sits *between* the bars and the denominators, closer to the bars than the denominator row is. That ordering matters later.

The intended output is one line reading `\oint_C \frac{…}{…} + \frac{…}{…} + \frac{…}{…} dz,`. The actual output is three unrelated lines of fragments.

## Root cause

`reconstruct_fraction_sums` exists precisely for this shape and bails before doing any work. Instrumenting its guards on the real document prints:

```
PROBE bail=connector_baseline y=239.54 text="++dz,"
PROBE bail=connector_baseline y=122.99 text="dz,+"
```

`connector_baseline` requires the baseline row to contain nothing but `+`/`-` connectors and an optional trailing period. A contour integral's baseline carries `dz,` as well, so the row is rejected outright and the pass never reaches its splitting stage.

Widening that predicate would only move the failure one step later. The stage behind it, `split_into_terms`, infers the number of terms from the connector count and then locates the boundaries between them by ranking the row's horizontal gaps and taking the *n−1* widest, subject to a 1.5× dominance margin. On a numerator row like `cos(z)4z1`, whose terms differ wildly in width and whose internal spacing is comparable to the spacing between terms, that ranking has no reliable answer. Both stages are guessing at the same two facts: **how many terms there are**, and **where each one begins and ends**.

The PDF states both outright. pdfTeX draws every fraction bar as a page object, and page 0 carries eleven of them — one full-width header rule plus ten bars, one per fraction. The three bars belonging to the mangled row sit at `y = 242.05` with x-spans `[241.00, 272.70]`, `[288.56, 352.77]` and `[368.63, 380.29]`. Their count is the term count; their spans are the term boundaries. The pipeline discards all of it: `extract.rs` keeps `PdfPageObject::Image` and drops every other non-text object on the floor.

This is the same shape of gap as the operator-glyph bug in `docs/specs/pdf-maths-operator-glyphs-design.md` — a detector working with less information than the document actually encodes.

### What pdfium reports

Established by probe against the real sheets, and it contradicts the obvious assumption:

- Bars are **stroked lines** (`MoveTo` + `LineTo`, `fill = None`, `stroked = true`), not filled rectangles.
- Segment coordinates are in **object space** (`0,0 → 595.3,0`), not page space. Page geometry must come from `bounds()`; segments are usable only to classify shape.
- Bar thickness runs 0.96pt; the page-furniture header rule is 0.80pt and 596pt wide on a 595pt page.
- Bar widths span 5.19pt (a `\frac{1}{2}`) to 81.19pt.

## Design

### `pdf/rules.rs` (new)

Pure geometry, free of pdfium types, exactly as `columns.rs` is and for the same reason — it is the part that can be tested without the native library.

```rust
pub struct RuleBox { pub x0: f32, pub x1: f32, pub y: f32, pub thickness: f32 }
```

`y` is the rule's vertical centre: a 0.96pt thickness is noise, and what matters is where the bar sits between its numerator and denominator. `thickness` is retained as the discriminator against decorative bands, and as the field a later underline or table-rule spec would key on.

### Extraction (`extract.rs`)

`extract_rules(page) -> Vec<RuleBox>`, folded into the `page.objects()` loop that already collects images.

- Page-space geometry from `bounds()`, never from `segments()`.
- `segments()` classifies shape only: accept a two-segment `MoveTo`+`LineTo`, or a closed axis-aligned rectangle for producers that draw rules as `re f`. Reject any path containing a Bezier segment.
- Reject non-horizontal paths: require `height ≤ MAX_RULE_THICKNESS` and `width ≥ height × MIN_RULE_ASPECT`.
- `MAX_RULES_PER_PAGE`: beyond that count the page yields no rules at all. A page dense with vector paths is a chart, not a page of fractions, and this bounds the cost of a pathological drawing — the same posture `pdf-inspector`'s dense-line-chart guard takes.

`ExtractedPage` gains `rules: Vec<RuleBox>`.

No page-furniture filter is needed. The full-width header rule matches nothing because a bar is only used when numerator *and* denominator content is found inside its own x-span, and the header rule has neither. It falls out of the matching rather than requiring a threshold of its own.

### Plumbing

`group_lines(chars)` has thirty-two call sites — twenty-four in `layout_tests.rs`, five in `dump.rs`, three in `layout.rs`. Rather than churn them, add `group_lines_with_rules(chars, rules)` and define `group_lines(chars)` as that function with an empty slice. The rule-free default is today's behaviour exactly, which makes "rules first, existing geometry on the leftovers" a structural property rather than a promise.

`columns::segment_regions` routes each rule to the region whose x-extent overlaps it most — a no-op on the single-column sheets in the corpus, correct by construction on a two-column page.

### The pass

`reconstruct_ruled_fractions(rows, rules) -> (Vec<Line>, Vec<Vec<(usize, CharBox)>>)`, the same signature as its four sibling row-stage passes, running in `group_lines` between `reconstruct_matrices` and `reconstruct_fraction_sums`. Cases and matrices therefore claim their rows first, so a bar drawn inside a `pmatrix` is never visible here; the sequencing does the guarding.

1. **Band the bars.** Bars within `RULE_ROW_TOLERANCE` in `y` form one visual row. Blatt11's three sit at exactly 242.05.
2. **Identify the numerator and denominator rows.** Ranking candidates by vertical distance does not work, and this is the crux of the design: the baseline row at 239.54 is *closer* to the bar than the denominator at 234.79 is. What separates them is that the denominator's characters lie **inside** the bar spans while the baseline's lie **outside** them — the `+`s between bars, `dz,` past the last one. So a candidate row is accepted as the denominator when **more than half** of its non-whitespace characters fall within some bar's span. Candidates are the unconsumed rows below the band whose vertical distance from the band's `y` is within `FRACTION_MAX_ROW_GAP × font size`, nearest first; the first that passes the majority test wins. The same test, searching upward, finds the numerator.
3. **Bucket by span.** Each numerator and denominator character joins the bar whose span contains its centre x. A character outside every span joins the nearest span if it lies within `SPAN_SLACK`; if anything sits further out, the whole band bails and the rows pass through untouched. Half-reconstructed mathematics is worse than the status quo.
4. **Build each fraction** through `latex::to_latex`, as `reconstruct_fraction_sums` already does.
5. **Assemble.** Run the baseline row through the existing `build_line`, so `\oint_C`, the connectors and `dz,` receive their normal maths/text classification, then splice each fraction into it at its bar's x position. This generalizes `splice_into_baseline` from a single insertion to several in x order, and is the only genuinely new plumbing in the pass.
6. Consume the numerator, baseline and denominator rows; emit one `Line`.

A single-bar band is simply N = 1, so a lone display fraction takes the same path.

### Relationship to the existing passes

`connector_baseline`, `split_into_terms` and `reconstruct_fraction_sums` are left untouched and keep handling documents whose producer draws no rules. `reconstruct_fractions` keeps its role, and its doc comment's description of a "bar-less fraction" becomes literal: it is the fallback for fractions where no rule was found.

Whether the geometric passes still fire on any real document once this lands is an open question worth measuring, but retiring them is explicitly not part of this spec.

## Testing

- **`rules.rs` unit tests**: stroked line accepted, filled rectangle accepted, Bezier rejected, vertical line rejected, over-thick band rejected, under-long path rejected, `MAX_RULES_PER_PAGE` overflow yields an empty result.
- **`layout_tests.rs`**: the Blatt11 shape built synthetically — three bars, concatenated numerator and denominator rows, a baseline of `+ + dz,` — asserting one line carrying three `\frac`s interleaved with the residue in x order. Plus the denominator-versus-baseline discrimination in isolation, a single-bar band, an out-of-span character forcing the bail, and a no-rules case proving existing output is byte-identical. The existing tests in this file are the regression baseline and none should need to change.
- **Real-document acceptance**: `Analysis_2_Blatt11.pdf` page 0 goes from five reconstructed fractions to ten. The remaining sheets in `notes/exercise_sheets/` show no regression under `dump_markdown`. Constants (`MAX_RULE_THICKNESS`, `MIN_RULE_ASPECT`, `RULE_ROW_TOLERANCE`, `SPAN_SLACK`, `MAX_RULES_PER_PAGE`) are tuned against that corpus during implementation rather than asserted here, consistent with this pipeline's established practice of judging by real output.
- The probe used to diagnose this becomes a kept `dump_rules` diagnostic in `dump.rs`, `#[ignore]`d and driven by `NULL_NOTES_PDF`.
- `cargo clippy -- -D warnings` clean.

## Out of scope

- **Table detection from rules.** Horizontal rules are strong evidence for where a table begins and ends, and would likely let `TABLE_MATHS_GUARD_RATIO` be retired. Its own spec; the table code has its own accreted guards and deserves its own measurement.
- **Underline and strikethrough detection**, which the same `RuleBox` extraction makes possible. Its own spec.
- **Link annotations, bookmarks, tagged structure trees.** Separate opportunities identified in the same review of `firecrawl/pdf-inspector`, unrelated to this change.
- **Nested fractions.** A `\frac{\frac{a}{b}}{c}` presents two vertically-stacked, x-overlapping bars. The bail in step 3 is expected to reject them, leaving today's behaviour; positively reconstructing them is not attempted.
- **Vertical rules.** Extracted geometry is horizontal-only. Vertical rules matter for table cell boundaries, which is the table spec's concern.

## Implementation notes

What actually shipped, and how it diverged from this spec's predictions — recorded here rather than silently, following `docs/specs/pdf-table-fraction-maths-guards-design.md`.

**The claim that no page-furniture filter was needed is false, and it shipped as `MAX_BAR_WIDTH_RATIO = 0.9`.** The reasoning above — "a bar only matches if it finds numerator *and* denominator content inside its own x-span, and the header rule has neither" — does not survive contact with the corpus. A full-width rule's span covers the *entire* text column, so every prose row on the page scores 100% inside it. On the first real run the 596pt header rule claimed Blatt11's title as a numerator and its opening paragraph as a denominator, and the 482pt rule on page 1 did the same to the Bonusaufgabe heading. What actually separates the two is width: a fraction bar spans a single term (the widest on that page is 81.19pt against a 482pt text column, a ratio of 0.17), while a separator spans the column. Bars are now filtered against the surrounding content's own width before banding.

**Every other constant shipped at its planned starting value**: `MAX_RULE_THICKNESS` 2.0, `MIN_RULE_ASPECT` 3.0, `RULE_ROW_TOLERANCE` 2.0, `SPAN_SLACK_EMS` 0.5, `MAX_RULES_PER_PAGE` 200, `RULE_ROW_INSIDE_RATIO` 0.5. None needed tuning.

**`splice_into_baseline` was not generalized.** The plan proposed extending it to several x-ordered insertions; its own doc comment explains why that cannot work well — it operates on a finished `Line`, whose `Vec<Inline>` carries no per-piece position, so it infers the split point as "just before whatever comes last". The pass instead cuts the baseline row at the bars while real x coordinates are still available and runs each segment through `build_line`. `splice_into_baseline` is untouched and still serves the single-fraction geometric path.

**Four of the five planned tests for the pairing stage did not discriminate.** A single bar over a numerator and denominator, and the baseline-versus-denominator case, both already passed against a do-nothing stub, because the existing geometric `find_stacked_pair` handles a lone fraction perfectly well. They are kept as regression guards. The test that actually drives the work is a row carrying *three* bars — a shape no amount of whole-line pairing can recover. Likewise the baseline-interleaving test needed tightening twice: leaving the baseline row unconsumed already gets its content onto the right output line, because `group_blocks` merges the two rows into one display block. What it gets wrong is *order*, stranding the residue at the end as `\frac \frac \frac + + dz`. The assertion is now on the exact interleaved string.

**Measured result**, `dump_markdown` fraction counts across `notes/exercise_sheets/`, with rule extraction disabled versus enabled:

| Sheet | Before | After |
|---|---|---|
| Analysis_2_Blatt11 | 5 | **10** |
| Analysis_2_Blatt10 | 2 | **3** |
| Analysis_2_Blatt12 | 1 | 1 |
| Analysis_2_Blatt5_2026 | 1 | 1 |
| Analysis_2_Blatt7_2026 | 1 | 1 |
| Analysis_2_Blatt8_2026 | 2 | 2 |
| Analysis_2_Blatt9_2026, Ue5, Ue6, Ue9 | 0 | 0 |

Blatt11's items 4 and 5 now read `\frac{\cos(z)}{z^3} + \frac{4z}{2z^2-2z+1} + \frac{1}{z^4} dz,` and `\frac{1}{z^2+4} + \frac{1}{((2z-2)^2+1)^2} dz,`. Blatt10's gain is a genuine `\frac{1}{z}` the geometric path had missed. No sheet's count fell.

**The open question stays open.** The geometric `reconstruct_fraction_sums` and `reconstruct_fractions` passes still fire — six of the ten sheets get all their fractions from them, since only two sheets changed at all. Retiring them is not on the table.

## Provenance

The review that prompted this work looked at `firecrawl/anydoc` and, through it, `firecrawl/pdf-inspector` (both MIT). No code is ported here — pdf-inspector performs no LaTeX reconstruction and has no notion of a fraction. What transferred is the observation that a PDF's drawing operators carry structural information a text-only extractor discards, and the shape of two of its guards: `underline.rs`'s thickness-and-overlap test for what counts as a rule, and its dense-chart cap.

# PDF Ruled Fraction Reconstruction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (default) or superpowers:subagent-driven-development if explicitly requested.

**Goal:** Reconstruct side-by-side fractions from the rules pdfTeX actually draws, so `Analysis_2_Blatt11.pdf` page 0 yields ten fractions instead of five.

**Architecture:** A new pure-geometry `pdf/rules.rs` owns the `RuleBox` type and the "is this path a horizontal rule" predicate. `extract.rs` translates pdfium `PdfPageObject::Path` values into `RuleBox`es and hangs them off `ExtractedPage`. A new row-stage pass in `layout.rs`, `reconstruct_ruled_fractions`, runs between `reconstruct_matrices` and `reconstruct_fraction_sums`, using each bar's count and x-span to decide how many fraction terms a row carries and where each one begins.

**Tech Stack:** Rust, `pdfium-render` 0.9.2 (feature `pdf-native`), `cargo test`, `cargo clippy`.

**Spec:** `docs/specs/pdf-ruled-fraction-reconstruction-design.md`

## Global Constraints

- `layout.rs`, `columns.rs` and the new `rules.rs` must not gain a pdfium dependency. Nothing in CI has the pdfium native library; a pdfium-free module is the only testable part of this pipeline.
- No `.unwrap()` or `.expect()` outside tests. Use `?` to propagate.
- `cargo clippy -- -D warnings` must pass clean before each commit.
- Derive `Debug` on all structs.
- No comments unless the WHY is non-obvious.
- Existing tests in `layout_tests.rs` are the regression baseline. None should need to change.
- Constants start at the values given below and are re-tuned against the real corpus in Task 6.

**Constant starting values** (all defined in `src-tauri/src/pdf/rules.rs` unless noted):

| Constant | Value | Rationale |
|---|---|---|
| `MAX_RULE_THICKNESS` | `2.0` | Observed bars are 0.96pt, page-furniture rules 0.80pt. Matches `pdf-inspector`'s own rule-thickness cap. |
| `MIN_RULE_ASPECT` | `3.0` | Narrowest observed bar is 5.19pt wide × 0.96pt thick, an aspect of 5.4. |
| `RULE_ROW_TOLERANCE` | `2.0` | Bars on one visual row shared an identical y (242.05) on the real sheet; this is slack, not a fitting parameter. |
| `MAX_RULES_PER_PAGE` | `200` | Blatt11's busiest page has 11. A page past this is a chart, not a page of fractions. |
| `SPAN_SLACK_EMS` | `0.5` | In `layout.rs`, scaled by the row's font size. |

---

### Task 1: `pdf/rules.rs` — the RuleBox type and its geometry

**Files:**
- Create: `src-tauri/src/pdf/rules.rs`
- Modify: `src-tauri/src/pdf/mod.rs:1-8` (add `pub mod rules;`)

**Interfaces:**
- Consumes: `super::layout::CharBox` (for `chars_inside_spans`).
- Produces:
  - `pub struct RuleBox { pub x0: f32, pub x1: f32, pub y: f32, pub thickness: f32 }` (derives `Debug, Clone, Copy, PartialEq`)
  - `pub fn horizontal_rule(x0: f32, x1: f32, y0: f32, y1: f32) -> Option<RuleBox>`
  - `pub fn band(rules: &[RuleBox]) -> Vec<Vec<RuleBox>>`
  - `pub fn span_index(x: f32, bars: &[RuleBox], slack: f32) -> Option<usize>`
  - `pub fn chars_inside_spans(row: &[CharBox], bars: &[RuleBox], slack: f32) -> f32`
  - `pub const MAX_RULES_PER_PAGE: usize`

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/pdf/rules.rs` with only the test module at the bottom (the code above it comes in Step 3):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::pdf::layout::CharBox;
    use crate::pdf::maths::Family;

    fn bar(x0: f32, x1: f32, y: f32) -> RuleBox {
        RuleBox { x0, x1, y, thickness: 0.96 }
    }

    fn char_at(ch: char, x: f32, y: f32) -> CharBox {
        CharBox {
            ch,
            x,
            y,
            width: 5.0,
            top: y + 7.5,
            bottom: y - 2.5,
            font_size: 10.0,
            bold: false,
            italic: false,
            fixed_pitch: false,
            family: Family::Italic,
        }
    }

    // Exact geometry of the first fraction bar on Analysis_2_Blatt11.pdf
    // page 0, as pdfium reports it.
    #[test]
    fn a_thin_wide_path_is_a_rule() {
        let rule = horizontal_rule(241.00, 272.70, 242.05, 243.01).expect("a fraction bar");
        assert_eq!(rule.x0, 241.00);
        assert_eq!(rule.x1, 272.70);
        assert!((rule.y - 242.53).abs() < 0.01, "centre y, got {}", rule.y);
        assert!((rule.thickness - 0.96).abs() < 0.01, "got {}", rule.thickness);
    }

    #[test]
    fn a_tall_path_is_not_a_rule() {
        assert_eq!(horizontal_rule(100.0, 101.0, 200.0, 260.0), None);
    }

    #[test]
    fn a_stubby_path_is_not_a_rule() {
        // 2pt wide, 1.5pt thick: an aspect of 1.3, well under MIN_RULE_ASPECT.
        assert_eq!(horizontal_rule(100.0, 102.0, 200.0, 201.5), None);
    }

    #[test]
    fn a_zero_width_path_is_not_a_rule() {
        assert_eq!(horizontal_rule(100.0, 100.0, 200.0, 200.8), None);
    }

    // Bands read down the page, and each band reads left to right, so the
    // pass can walk bars in the order a reader meets them.
    #[test]
    fn bars_at_one_height_form_one_band_ordered_down_the_page() {
        let bars = vec![
            bar(368.63, 380.29, 242.05),
            bar(241.00, 272.70, 242.05),
            bar(100.00, 150.00, 605.36),
            bar(288.56, 352.77, 242.05),
        ];

        let bands = band(&bars);

        assert_eq!(bands.len(), 2);
        assert_eq!(bands[0].len(), 1, "the y=605 band comes first");
        assert_eq!(bands[1].len(), 3);
        let lefts: Vec<f32> = bands[1].iter().map(|b| b.x0).collect();
        assert_eq!(lefts, [241.00, 288.56, 368.63]);
    }

    #[test]
    fn a_character_inside_a_span_finds_its_bar() {
        let bars = [bar(240.0, 270.0, 242.0), bar(290.0, 330.0, 242.0)];
        assert_eq!(span_index(295.0, &bars, 0.0), Some(1));
        assert_eq!(span_index(245.0, &bars, 0.0), Some(0));
    }

    #[test]
    fn a_character_just_outside_a_span_is_pulled_in_by_slack() {
        let bars = [bar(240.0, 270.0, 242.0)];
        assert_eq!(span_index(272.0, &bars, 5.0), Some(0));
        assert_eq!(span_index(272.0, &bars, 1.0), None);
    }

    // The measurement that tells a denominator row from a baseline row.
    #[test]
    fn a_row_under_the_bars_reads_as_mostly_inside_them() {
        let bars = [bar(240.0, 270.0, 242.0), bar(290.0, 330.0, 242.0)];
        let row = vec![char_at('x', 245.0, 234.0), char_at('y', 295.0, 234.0)];
        assert_eq!(chars_inside_spans(&row, &bars, 0.0), 1.0);
    }

    #[test]
    fn a_baseline_row_between_the_bars_reads_as_mostly_outside_them() {
        let bars = [bar(240.0, 270.0, 242.0), bar(290.0, 330.0, 242.0)];
        let row = vec![
            char_at('+', 275.0, 240.0),
            char_at('d', 335.0, 240.0),
            char_at('z', 340.0, 240.0),
        ];
        assert_eq!(chars_inside_spans(&row, &bars, 0.0), 0.0);
    }

    #[test]
    fn whitespace_does_not_count_toward_the_inside_ratio() {
        let bars = [bar(240.0, 270.0, 242.0)];
        let row = vec![char_at(' ', 500.0, 234.0), char_at('x', 245.0, 234.0)];
        assert_eq!(chars_inside_spans(&row, &bars, 0.0), 1.0);
    }

    #[test]
    fn an_empty_row_is_inside_nothing() {
        let bars = [bar(240.0, 270.0, 242.0)];
        assert_eq!(chars_inside_spans(&[], &bars, 0.0), 0.0);
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src-tauri && cargo test --features pdf-native rules::`
Expected: FAIL to compile — `cannot find type RuleBox in this scope`, `cannot find function horizontal_rule`.

- [ ] **Step 3: Write the implementation**

Prepend to `src-tauri/src/pdf/rules.rs`, above the test module:

```rust
//! The horizontal rules a PDF draws, as plain geometry.
//!
//! LaTeX's fraction bar is a drawn rule, not a glyph, so it is invisible to
//! the text layer — and it is also the only record of how many fraction
//! terms a row carries and where each one begins. `layout.rs` reconstructs
//! several side-by-side fractions from that; this module is the geometry it
//! reasons over.
//!
//! Deliberately free of pdfium types, exactly like [`super::columns`]: the
//! translation from `PdfPageObject::Path` lives in [`super::extract`], and
//! keeping the judgement here is what makes it testable without the native
//! library.

use super::layout::CharBox;

/// Thickest a path may be and still read as a rule rather than a filled
/// band. Observed fraction bars are 0.96pt and page-furniture rules 0.80pt.
const MAX_RULE_THICKNESS: f32 = 2.0;

/// How many times longer than it is thick a path must be. The narrowest
/// real bar seen (a `\frac{1}{2}`) is 5.19pt over 0.96pt, an aspect of 5.4.
const MIN_RULE_ASPECT: f32 = 3.0;

/// How far apart in `y` two bars may sit and still belong to one visual row.
const RULE_ROW_TOLERANCE: f32 = 2.0;

/// Past this many rules a page is a diagram, not a page of mathematics, and
/// yields none at all — a bound on what a pathological vector drawing can
/// cost, the same posture `pdf-inspector`'s dense-chart guard takes.
pub const MAX_RULES_PER_PAGE: usize = 200;

/// A horizontal rule as the PDF draws it.
///
/// `y` is the rule's vertical centre: a bar's sub-point thickness is noise,
/// and what matters is where it sits between its numerator and denominator.
/// `thickness` is kept as the discriminator against decorative bands.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RuleBox {
    pub x0: f32,
    pub x1: f32,
    pub y: f32,
    pub thickness: f32,
}

impl RuleBox {
    pub fn width(&self) -> f32 {
        self.x1 - self.x0
    }
}

/// A rule from one path's page-space bounding box, or `None` when the path
/// is too thick, too short, or too stubby to be one.
pub fn horizontal_rule(x0: f32, x1: f32, y0: f32, y1: f32) -> Option<RuleBox> {
    let (x0, x1) = (x0.min(x1), x0.max(x1));
    let (y0, y1) = (y0.min(y1), y0.max(y1));
    let thickness = y1 - y0;
    let width = x1 - x0;

    if thickness > MAX_RULE_THICKNESS || width <= 0.0 {
        return None;
    }
    // A zero-thickness path still has to clear the aspect test, so compare
    // against the width directly rather than dividing by thickness.
    if width < thickness * MIN_RULE_ASPECT {
        return None;
    }

    Some(RuleBox { x0, x1, y: (y0 + y1) / 2.0, thickness })
}

/// Rules grouped into visual rows, bands ordered down the page and each
/// band's bars ordered left to right — the order a reader meets them.
pub fn band(rules: &[RuleBox]) -> Vec<Vec<RuleBox>> {
    let mut sorted: Vec<RuleBox> = rules.to_vec();
    sorted.sort_by(|a, b| {
        b.y.partial_cmp(&a.y)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.x0.partial_cmp(&b.x0).unwrap_or(std::cmp::Ordering::Equal))
    });

    let mut bands: Vec<Vec<RuleBox>> = Vec::new();
    for rule in sorted {
        match bands.last_mut() {
            Some(current) if (current[0].y - rule.y).abs() <= RULE_ROW_TOLERANCE => {
                current.push(rule);
            }
            _ => bands.push(vec![rule]),
        }
    }
    bands
}

/// Which bar's span `x` falls in, widened by `slack` at each end. The
/// nearest span wins when `slack` makes two of them reach the same point.
pub fn span_index(x: f32, bars: &[RuleBox], slack: f32) -> Option<usize> {
    bars.iter()
        .enumerate()
        .filter(|(_, bar)| x >= bar.x0 - slack && x <= bar.x1 + slack)
        .min_by(|(_, a), (_, b)| {
            let da = distance_to_span(x, a);
            let db = distance_to_span(x, b);
            da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
        })
        .map(|(i, _)| i)
}

fn distance_to_span(x: f32, bar: &RuleBox) -> f32 {
    if x < bar.x0 {
        bar.x0 - x
    } else if x > bar.x1 {
        x - bar.x1
    } else {
        0.0
    }
}

/// What fraction of `row`'s printing characters sit inside some bar's span.
///
/// This is what separates a denominator row from the baseline row beneath a
/// band: on a real contour integral the baseline sits *closer* to the bars
/// than the denominator does, so vertical distance cannot tell them apart,
/// but the denominator's characters lie under the bars and the baseline's
/// (`+` between them, `dz,` past the last) do not.
pub fn chars_inside_spans(row: &[CharBox], bars: &[RuleBox], slack: f32) -> f32 {
    let printing: Vec<&CharBox> = row.iter().filter(|c| !c.ch.is_whitespace()).collect();
    if printing.is_empty() {
        return 0.0;
    }
    let inside = printing
        .iter()
        .filter(|c| span_index(c.x + c.width / 2.0, bars, slack).is_some())
        .count();
    inside as f32 / printing.len() as f32
}
```

Add to `src-tauri/src/pdf/mod.rs`, keeping the list alphabetical:

```rust
pub mod renderer;
pub mod rules;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test --features pdf-native rules::`
Expected: PASS, 11 tests.

- [ ] **Step 5: Lint and commit**

```bash
cd src-tauri && cargo clippy --features pdf-native -- -D warnings
git add src-tauri/src/pdf/rules.rs src-tauri/src/pdf/mod.rs
git commit -m "feat(pdf): add RuleBox geometry for the rules a PDF draws"
```

---

### Task 2: Extract path objects into RuleBoxes

**Files:**
- Modify: `src-tauri/src/pdf/extract.rs:47-52` (`ExtractedPage`), `:315-325` (the object loop)
- Modify: `src-tauri/src/pdf/dump.rs` (append a `dump_rules` diagnostic)

**Interfaces:**
- Consumes: `rules::{RuleBox, horizontal_rule, MAX_RULES_PER_PAGE}` from Task 1.
- Produces: `ExtractedPage.rules: Vec<RuleBox>`.

This task's pdfium-facing half cannot be unit-tested — CI has no pdfium — so its deliverable is verified by the `dump_rules` diagnostic against a real sheet, exactly as `dump_raw_pdfium_chars` verifies the character path. The geometric predicate it calls is already covered by Task 1.

- [ ] **Step 1: Add the field to `ExtractedPage`**

In `src-tauri/src/pdf/extract.rs`, extend the struct:

```rust
#[derive(Debug, Clone)]
pub struct ExtractedPage {
    pub index: usize,
    pub chars: Vec<CharBox>,
    pub images: Vec<ExtractedImage>,
    /// The horizontal rules this page draws — a fraction bar is one, and is
    /// the only record that the row above and below it are a numerator and
    /// a denominator. See `pdf::rules`.
    pub rules: Vec<RuleBox>,
}
```

Add the import near the top of the file, beside the existing `layout` import:

```rust
use super::rules::{self, RuleBox};
```

- [ ] **Step 2: Run the build to see every construction site fail**

Run: `cd src-tauri && cargo build --features pdf-native`
Expected: FAIL — `missing field rules in initializer of ExtractedPage` at `extract.rs:325`, plus any test helpers that build one (`extract.rs`'s own `page_of` helper in its test module).

- [ ] **Step 3: Write the extraction**

Replace the object loop at `src-tauri/src/pdf/extract.rs:315-323` with one that collects both kinds:

```rust
        let mut images = Vec::new();
        let mut rules = Vec::new();
        for object in page.objects().iter() {
            match object {
                PdfPageObject::Image(ref image_object) => {
                    if let Some(extracted) = extract_image(image_object, &doc) {
                        images.push(extracted);
                    }
                }
                PdfPageObject::Path(ref path_object) => {
                    if let Some(rule) = extract_rule(path_object) {
                        rules.push(rule);
                    }
                }
                _ => {}
            }
        }
        if rules.len() > rules::MAX_RULES_PER_PAGE {
            rules.clear();
        }

        pages.push(ExtractedPage { index, chars, images, rules });
```

Add the translation function after `extract_image`:

```rust
/// One drawn path as a horizontal rule, or `None` when it isn't one.
///
/// Geometry comes from `bounds()` and never from `segments()`: pdfium
/// reports segment coordinates in the path's own object space (a full-width
/// page rule reads `0,0 → 595.3,0` whatever its position), so they are
/// meaningless as page positions. The segments are read only to reject
/// curves — a Bezier's bounding box can be thin and wide while the shape
/// itself is nothing like a rule.
#[cfg(feature = "pdf-native")]
fn extract_rule(path: &pdfium_render::prelude::PdfPagePathObject) -> Option<RuleBox> {
    use pdfium_render::prelude::{PdfPageObjectCommon, PdfPathSegmentType, PdfPathSegments};

    if path
        .segments()
        .iter()
        .any(|segment| segment.segment_type() == PdfPathSegmentType::BezierTo)
    {
        return None;
    }

    let bounds = path.bounds().ok()?;
    rules::horizontal_rule(
        bounds.left().value,
        bounds.right().value,
        bounds.bottom().value,
        bounds.top().value,
    )
}
```

Fix the test helper in the same file's `mod tests` — `page_of` builds an `ExtractedPage`; add `rules: Vec::new()` to its initializer.

- [ ] **Step 4: Run the build and the existing tests**

Run: `cd src-tauri && cargo build --features pdf-native && cargo test --features pdf-native`
Expected: PASS, no test count change.

- [ ] **Step 5: Add the `dump_rules` diagnostic**

Append inside `mod tests` in `src-tauri/src/pdf/dump.rs`, before the closing brace:

```rust
    /// Every horizontal rule the pipeline extracts, per page. A fraction bar
    /// is a drawn rule and invisible to the text layer, so this is the only
    /// way to see what `reconstruct_ruled_fractions` is actually working
    /// from. Analysis_2_Blatt11.pdf page 0 should report eleven: one
    /// full-width header rule and ten fraction bars.
    #[test]
    #[ignore]
    fn dump_rules() {
        let pages = crate::pdf::extract::extract_pages(&pdf_or_skip!()).unwrap();
        for page in &pages {
            println!("=== page {}: {} rule(s) ===", page.index, page.rules.len());
            for rule in &page.rules {
                println!(
                    "  x=[{:7.2},{:7.2}] w={:7.2} y={:8.2} thickness={:.2}",
                    rule.x0,
                    rule.x1,
                    rule.width(),
                    rule.y,
                    rule.thickness
                );
            }
        }
    }
```

- [ ] **Step 6: Verify against the real sheet**

Run:
```bash
cd src-tauri
NULL_NOTES_PDF=../notes/exercise_sheets/Analysis_2_Blatt11.pdf \
  cargo test --features pdf-native dump_rules -- --ignored --nocapture
```
Expected: page 0 reports 11 rules — one of width ~596.07 at y≈737 (the header) and ten between 5.19 and 81.19 wide, including three at y≈242.5 with x-spans starting at 241.00, 288.56 and 368.63.

If the count is wrong, the constants in `rules.rs` are the thing to adjust; do not adjust the extraction shape check.

- [ ] **Step 7: Lint and commit**

```bash
cd src-tauri && cargo clippy --features pdf-native -- -D warnings
git add src-tauri/src/pdf/extract.rs src-tauri/src/pdf/dump.rs
git commit -m "feat(pdf): extract drawn horizontal rules from page path objects"
```

---

### Task 3: Thread rules through to the row stage

**Files:**
- Modify: `src-tauri/src/pdf/layout.rs:939` (`group_lines`), `:3055` (`chars_to_markdown`), `:3086` (`chars_and_images_to_markdown`)
- Modify: `src-tauri/src/pdf/columns.rs` (add `rules_for_region`)
- Modify: `src-tauri/src/pdf/extract.rs:68-126` (`pages_to_markdown`)
- Test: `src-tauri/src/pdf/layout_tests.rs`

**Interfaces:**
- Consumes: `rules::RuleBox`, `ExtractedPage.rules`.
- Produces:
  - `pub fn group_lines_with_rules(chars: &[CharBox], rules: &[RuleBox]) -> Vec<Line>`
  - `pub fn chars_and_rules_to_markdown(chars: &[CharBox], rules: &[RuleBox]) -> String`
  - `pub fn chars_rules_and_images_to_markdown(chars: &[CharBox], rules: &[RuleBox], images: &[ImageRef]) -> String`
  - `pub fn rules_for_region(rules: &[RuleBox], bounds: (f32, f32)) -> Vec<RuleBox>` (in `columns.rs`)
  - `group_lines`, `chars_to_markdown` and `chars_and_images_to_markdown` keep their existing signatures and delegate with an empty slice.

This task changes no behaviour. Its deliverable is that rules reach the row stage and that a rule-free call is byte-identical to today.

- [ ] **Step 1: Write the failing tests**

Append to `src-tauri/src/pdf/layout_tests.rs`:

```rust
// Rules reach the row stage without changing anything on their own: the
// rule-free default has to stay byte-identical to today's output, because
// that is what makes "the existing geometric passes handle the leftovers" a
// structural property rather than a promise.
#[test]
fn a_page_with_no_rules_converts_exactly_as_before() {
    let chars = page_at(700.0, &["Hello world", "a second line of prose"]);

    assert_eq!(chars_and_rules_to_markdown(&chars, &[]), chars_to_markdown(&chars));
}

#[test]
fn group_lines_with_no_rules_matches_group_lines() {
    let chars = page_at(700.0, &["Hello world", "a second line of prose"]);

    assert_eq!(group_lines_with_rules(&chars, &[]), group_lines(&chars));
}
```

Append to `src-tauri/src/pdf/columns_tests.rs`. Its header already does `use super::columns::*;`, so `rules_for_region` is in scope unqualified; only the `RuleBox` import is new:

```rust
use super::rules::RuleBox;

fn rule_at(x0: f32, x1: f32, y: f32) -> RuleBox {
    RuleBox { x0, x1, y, thickness: 0.96 }
}

// A rule joins the column its span overlaps, so a two-column page's fraction
// bars reach the region that actually contains their numerator.
#[test]
fn a_rule_joins_the_region_it_overlaps() {
    let rules = [rule_at(80.0, 120.0, 500.0), rule_at(320.0, 360.0, 500.0)];

    let left = rules_for_region(&rules, (72.0, 280.0));
    let right = rules_for_region(&rules, (300.0, 520.0));

    assert_eq!(left.len(), 1);
    assert_eq!(left[0].x0, 80.0);
    assert_eq!(right.len(), 1);
    assert_eq!(right[0].x0, 320.0);
}

#[test]
fn a_rule_overlapping_nothing_joins_no_region() {
    let rules = [rule_at(80.0, 120.0, 500.0)];

    assert!(rules_for_region(&rules, (300.0, 520.0)).is_empty());
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src-tauri && cargo test --features pdf-native converts_exactly_as_before matches_group_lines joins_the_region overlapping_nothing`
Expected: FAIL to compile — `cannot find function chars_and_rules_to_markdown`, `group_lines_with_rules`, `rules_for_region`.

- [ ] **Step 3: Write the implementation**

In `src-tauri/src/pdf/layout.rs`, add the import beside the existing ones:

```rust
use super::rules::RuleBox;
```

Rename `group_lines` to `group_lines_with_rules` and give it the extra parameter, leaving its body untouched for now:

```rust
pub fn group_lines(chars: &[CharBox]) -> Vec<Line> {
    group_lines_with_rules(chars, &[])
}

pub fn group_lines_with_rules(chars: &[CharBox], rules: &[RuleBox]) -> Vec<Line> {
    // ... existing body, unchanged ...
}
```

Silence the unused parameter for this task only by prefixing nothing — instead, thread it into the pass list placeholder now so there is no dead parameter. At `layout.rs:1071`, immediately before the `reconstruct_fraction_sums` call, add:

```rust
    let (ruled_lines, rows) = reconstruct_ruled_fractions(rows, rules);
    lines.extend(ruled_lines);
```

and add a stub that Task 4 fills in, placed just above `reconstruct_fraction_sums`:

```rust
/// Reconstructs fractions from the rules the PDF draws — see
/// `docs/specs/pdf-ruled-fraction-reconstruction-design.md`. Filled in by
/// Task 4; passes every row through untouched until then.
fn reconstruct_ruled_fractions(
    rows: Vec<Vec<(usize, CharBox)>>,
    _rules: &[RuleBox],
) -> (Vec<Line>, Vec<Vec<(usize, CharBox)>>) {
    (Vec::new(), rows)
}
```

Add the two markdown entry points beside the existing ones at the end of `layout.rs`:

```rust
pub fn chars_and_rules_to_markdown(chars: &[CharBox], rules: &[RuleBox]) -> String {
    chars_rules_and_images_to_markdown(chars, rules, &[])
}
```

Rewrite `chars_to_markdown` and `chars_and_images_to_markdown` as delegates. Given today's bodies at `:3055` and `:3086`, the result is:

```rust
pub fn chars_to_markdown(chars: &[CharBox]) -> String {
    chars_rules_and_images_to_markdown(chars, &[], &[])
}

pub fn chars_and_images_to_markdown(chars: &[CharBox], images: &[ImageRef]) -> String {
    chars_rules_and_images_to_markdown(chars, &[], images)
}

pub fn chars_rules_and_images_to_markdown(
    chars: &[CharBox],
    rules: &[RuleBox],
    images: &[ImageRef],
) -> String {
    // The body of today's `chars_and_images_to_markdown`, with its
    // `group_lines(chars)` call replaced by
    // `group_lines_with_rules(chars, rules)`.
}
```

In `src-tauri/src/pdf/columns.rs`, add:

```rust
use super::rules::RuleBox;

/// The rules belonging to a region spanning `bounds`, by widest horizontal
/// overlap. A rule overlapping no region at all is dropped rather than
/// forced into the nearest one: unlike an image, a rule that does not sit
/// over a column's own content cannot be a fraction bar for it.
pub fn rules_for_region(rules: &[RuleBox], bounds: (f32, f32)) -> Vec<RuleBox> {
    let (x0, x1) = bounds;
    rules
        .iter()
        .filter(|rule| layout::range_overlap(rule.x0, rule.x1, x0, x1) > 0.0)
        .copied()
        .collect()
}
```

`range_overlap` is currently private in `layout.rs:3147`; change it to `pub(super) fn range_overlap`.

In `src-tauri/src/pdf/extract.rs`, use the new entry point in `pages_to_markdown`. The empty-region branch at `:86` becomes:

```rust
            let markdown = layout::chars_rules_and_images_to_markdown(&[], &[], &image_refs);
```

and the per-region loop at `:111-118` becomes:

```rust
        for ((region, bounds), imgs) in regions.iter().zip(&region_bounds).zip(images_by_region) {
            let owned: Vec<ExtractedImage> = imgs.into_iter().cloned().collect();
            let image_refs = take_images_as_refs(&owned, &mut pending, &mut next_placeholder);
            let region_rules = columns::rules_for_region(&page.rules, *bounds);
            let markdown =
                layout::chars_rules_and_images_to_markdown(region, &region_rules, &image_refs);
            if !markdown.trim().is_empty() {
                chunks.push(markdown.trim_end().to_string());
            }
        }
```

- [ ] **Step 4: Run the full suite**

Run: `cd src-tauri && cargo test --features pdf-native`
Expected: PASS, including the four new tests and every pre-existing test unchanged.

- [ ] **Step 5: Lint and commit**

```bash
cd src-tauri && cargo clippy --features pdf-native -- -D warnings
git add src-tauri/src/pdf/layout.rs src-tauri/src/pdf/columns.rs src-tauri/src/pdf/columns_tests.rs src-tauri/src/pdf/layout_tests.rs src-tauri/src/pdf/extract.rs
git commit -m "refactor(pdf): thread drawn rules through to the row stage"
```

---

### Task 4: Pair a bar's numerator and denominator rows

**Files:**
- Modify: `src-tauri/src/pdf/layout.rs` (fill in `reconstruct_ruled_fractions`)
- Test: `src-tauri/src/pdf/layout_tests.rs`

**Interfaces:**
- Consumes: `rules::{band, span_index, chars_inside_spans}`, `layout::{row_y, row_font_size, build_line, FRACTION_MAX_ROW_GAP}`, `latex::to_latex`.
- Produces: a working `reconstruct_ruled_fractions` for a band whose baseline carries no content of its own. Task 5 adds baseline residue.

- [ ] **Step 1: Write the failing tests**

Append to `src-tauri/src/pdf/layout_tests.rs`:

```rust
use super::rules::RuleBox;

fn rule_at(x0: f32, x1: f32, y: f32) -> RuleBox {
    RuleBox { x0, x1, y, thickness: 0.96 }
}

// The bar states outright what the geometric pass has to infer: the row
// above it is a numerator and the row below it is a denominator.
#[test]
fn a_drawn_bar_pairs_the_rows_it_separates() {
    let mut chars = set("a + b", 300.0, 700.0, maths_italic());
    chars.extend(set("c + d", 300.0, 680.0, maths_italic()));
    let rules = [rule_at(298.0, 330.0, 690.0)];

    let markdown = chars_and_rules_to_markdown(&chars, &rules);

    assert!(markdown.contains(r"\frac{a + b}{c + d}"), "got: {markdown}");
}

// The crux. On a real contour integral the baseline row sits *closer* to the
// bar than the denominator does, so ranking candidate rows by vertical
// distance picks the wrong one. Only "most of this row's characters sit
// under a bar" separates them.
#[test]
fn the_baseline_row_is_not_mistaken_for_the_denominator() {
    let mut chars = set("a", 245.0, 248.0, maths_italic());
    // Outside the bar's span, and nearer to the bar than the denominator is.
    chars.extend(set("dz", 275.0, 240.0, maths_italic()));
    // Under the bar, and further from it.
    chars.extend(set("x", 245.0, 234.0, maths_italic()));
    let rules = [rule_at(240.0, 270.0, 242.0)];

    let markdown = chars_and_rules_to_markdown(&chars, &rules);

    assert!(markdown.contains(r"\frac{a}{x}"), "got: {markdown}");
}

// A bar with nothing under it is page furniture — a header rule — and must
// not drag unrelated content into a fraction.
#[test]
fn a_bar_with_no_content_in_its_span_reconstructs_nothing() {
    let chars = page_at(700.0, &["Hello world", "a second line of prose"]);
    // Spans the full page width at the very top, like a header rule.
    let rules = [rule_at(-0.4, 595.67, 737.4)];

    let markdown = chars_and_rules_to_markdown(&chars, &rules);

    assert!(!markdown.contains(r"\frac"), "got: {markdown}");
}

// Half-reconstructed mathematics is worse than none: a numerator character
// stranded far outside every span means the bars do not describe this row,
// so the whole band gives up and leaves the rows to the existing passes.
#[test]
fn a_character_far_outside_every_span_abandons_the_band() {
    let mut chars = set("a", 245.0, 248.0, maths_italic());
    chars.extend(set("Q", 480.0, 248.0, maths_italic()));
    chars.extend(set("x", 245.0, 234.0, maths_italic()));
    let rules = [rule_at(240.0, 270.0, 242.0)];

    let markdown = chars_and_rules_to_markdown(&chars, &rules);

    assert!(!markdown.contains(r"\frac{a}{x}"), "got: {markdown}");
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src-tauri && cargo test --features pdf-native drawn_bar_pairs baseline_row_is_not_mistaken no_content_in_its_span far_outside_every_span`
Expected: FAIL — `a_drawn_bar_pairs_the_rows_it_separates` and `the_baseline_row_is_not_mistaken_for_the_denominator` fail their `contains` assertions (the stub reconstructs nothing). The two negative tests pass already; they are the guard rails for this task, not its driver.

- [ ] **Step 3: Write the implementation**

Replace the Task 3 stub in `src-tauri/src/pdf/layout.rs` with:

```rust
/// How much of a row's printing content must sit under a band's bars for it
/// to be that band's numerator or denominator, rather than the baseline row
/// that runs between them.
const RULE_ROW_INSIDE_RATIO: f32 = 0.5;

/// How far outside a bar's span, in ems of the row's own font size, a
/// character may sit and still be assigned to it.
const SPAN_SLACK_EMS: f32 = 0.5;

/// Reconstructs fractions from the rules the PDF draws.
///
/// LaTeX's fraction bar is a drawn rule, so a row of several side-by-side
/// fractions arrives as three unrelated rows — every numerator on one, every
/// denominator on another, the connectors and any surrounding integrand on a
/// third. `reconstruct_fraction_sums` infers the term count from the
/// connectors and the term boundaries from the widest x-gaps; both are
/// guesses, and both fail on a contour integral whose baseline carries `dz,`
/// as well as its `+`s. The bars state the same two facts exactly: how many
/// terms there are, and where each one begins.
///
/// Runs after `reconstruct_cases` and `reconstruct_matrices` have claimed
/// their rows, so a bar drawn inside a matrix is never visible here.
fn reconstruct_ruled_fractions(
    rows: Vec<Vec<(usize, CharBox)>>,
    rules: &[RuleBox],
) -> (Vec<Line>, Vec<Vec<(usize, CharBox)>>) {
    if rules.is_empty() {
        return (Vec::new(), rows);
    }

    let plain: Vec<Vec<CharBox>> = rows.iter().map(|r| r.iter().map(|(_, c)| *c).collect()).collect();
    let mut consumed = vec![false; rows.len()];
    let mut synthesized: Vec<Line> = Vec::new();

    for bars in super::rules::band(rules) {
        let band_y = bars[0].y;

        let Some(num_i) = flanking_row(&plain, &consumed, &bars, band_y, true) else {
            continue;
        };
        let Some(den_i) = flanking_row(&plain, &consumed, &bars, band_y, false) else {
            continue;
        };

        let slack = row_font_size(&plain[num_i]).max(1.0) * SPAN_SLACK_EMS;
        let Some(num_groups) = bucket_by_span(&plain[num_i], &bars, slack) else {
            continue;
        };
        let Some(den_groups) = bucket_by_span(&plain[den_i], &bars, slack) else {
            continue;
        };

        let content: Vec<Inline> = num_groups
            .iter()
            .zip(den_groups.iter())
            .map(|(n, d)| {
                Inline::Maths(format!("\\frac{{{}}}{{{}}}", latex::to_latex(n), latex::to_latex(d)))
            })
            .collect();

        let (num_x0, num_x1) = row_x_extent(&plain[num_i]);
        let (den_x0, den_x1) = row_x_extent(&plain[den_i]);

        synthesized.push(Line {
            content,
            x: num_x0.min(den_x0),
            right: num_x1.max(den_x1),
            y: band_y,
            font_size: row_font_size(&plain[num_i]).max(1.0),
            fixed_pitch: false,
            is_display_maths: true,
            ends_hyphenated: false,
        });

        consumed[num_i] = true;
        consumed[den_i] = true;
    }

    let remaining: Vec<Vec<(usize, CharBox)>> = rows
        .into_iter()
        .enumerate()
        .filter(|(i, _)| !consumed[*i])
        .map(|(_, row)| row)
        .collect();

    (synthesized, remaining)
}

/// The nearest unconsumed row above (`above`) or below a band whose printing
/// characters mostly sit under the band's own bars.
///
/// Vertical distance alone is not enough: the baseline row running between a
/// band's numerator and denominator is often the *closest* row below it. What
/// separates them is that the denominator sits under the bars and the
/// baseline does not.
fn flanking_row(
    plain: &[Vec<CharBox>],
    consumed: &[bool],
    bars: &[RuleBox],
    band_y: f32,
    above: bool,
) -> Option<usize> {
    let mut candidates: Vec<(usize, f32)> = plain
        .iter()
        .enumerate()
        .filter(|(i, row)| !consumed[*i] && !row.is_empty())
        .filter_map(|(i, row)| {
            let gap = if above { row_y(row) - band_y } else { band_y - row_y(row) };
            (gap > 0.0).then_some((i, gap))
        })
        .filter(|(i, gap)| *gap <= row_font_size(&plain[*i]).max(1.0) * FRACTION_MAX_ROW_GAP)
        .collect();
    candidates.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));

    candidates.into_iter().find_map(|(i, _)| {
        let slack = row_font_size(&plain[i]).max(1.0) * SPAN_SLACK_EMS;
        (super::rules::chars_inside_spans(&plain[i], bars, slack) > RULE_ROW_INSIDE_RATIO)
            .then_some(i)
    })
}

/// A row's characters split into one group per bar, by which span each falls
/// under. `None` when any character sits outside every span — the bars do not
/// describe this row, and a partial reconstruction is worse than none — or
/// when any bar ends up with nothing under it.
fn bucket_by_span(row: &[CharBox], bars: &[RuleBox], slack: f32) -> Option<Vec<Vec<CharBox>>> {
    let mut groups: Vec<Vec<CharBox>> = vec![Vec::new(); bars.len()];
    let mut sorted: Vec<CharBox> = row.iter().copied().filter(|c| !c.ch.is_whitespace()).collect();
    sorted.sort_by(|a, b| a.x.partial_cmp(&b.x).unwrap_or(std::cmp::Ordering::Equal));

    for ch in sorted {
        let index = super::rules::span_index(ch.x + ch.width / 2.0, bars, slack)?;
        groups[index].push(ch);
    }

    groups.iter().all(|g| !g.is_empty()).then_some(groups)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test --features pdf-native`
Expected: PASS, all four new tests plus every pre-existing test.

If `a_drawn_bar_pairs_the_rows_it_separates` fails on the exact LaTeX, print the markdown and check whether `latex::to_latex` renders `a + b` with the spacing the assertion expects; match the assertion to the existing `a_numerator_and_denominator_on_separate_lines_become_one_fraction` test, which asserts the same string through the geometric path.

- [ ] **Step 5: Lint and commit**

```bash
cd src-tauri && cargo clippy --features pdf-native -- -D warnings
git add src-tauri/src/pdf/layout.rs src-tauri/src/pdf/layout_tests.rs
git commit -m "feat(pdf): reconstruct fractions from drawn bars, one band at a time"
```

---

### Task 5: Interleave the baseline row's own content

**Files:**
- Modify: `src-tauri/src/pdf/layout.rs` (`reconstruct_ruled_fractions`)
- Test: `src-tauri/src/pdf/layout_tests.rs`

**Interfaces:**
- Consumes: everything from Task 4, plus `build_line`.
- Produces: the finished pass. A band's baseline row is consumed and its content interleaved with the fractions in x order.

**Divergence from the spec**, recorded here deliberately: the spec proposed generalizing `splice_into_baseline` to several x-ordered insertions. That function works on a finished `Line`, whose `Vec<Inline>` carries no per-piece position — its own doc comment says so and calls itself "not guaranteed for a baseline with several fractions". Working at the row stage we still have real x coordinates, so this task instead cuts the baseline row into segments between the bars and runs each through the existing `build_line`. `splice_into_baseline` is left untouched and keeps serving the single-fraction geometric path.

- [ ] **Step 1: Write the failing test**

Append to `src-tauri/src/pdf/layout_tests.rs`:

```rust
// Analysis_2_Blatt11.pdf item 4: a contour integral whose integrand is a sum
// of three fractions. Every numerator shares one row, every denominator
// another, and the baseline carries both the `+` connectors and the
// integral's own `dz,`. That trailing `dz,` is why `connector_baseline`
// rejects the row and the geometric pass never fires — it demands a baseline
// of nothing but connectors.
#[test]
fn three_bars_on_one_row_become_three_fractions_around_their_connectors() {
    let mut chars = set("a", 245.0, 248.0, maths_italic());
    chars.extend(set("b", 295.0, 248.0, maths_italic()));
    chars.extend(set("c", 355.0, 248.0, maths_italic()));

    chars.extend(set("+", 275.0, 240.0, maths()));
    chars.extend(set("+", 335.0, 240.0, maths()));
    chars.extend(set("dz", 375.0, 240.0, maths_italic()));

    chars.extend(set("x", 245.0, 234.0, maths_italic()));
    chars.extend(set("y", 295.0, 234.0, maths_italic()));
    chars.extend(set("z", 355.0, 234.0, maths_italic()));

    let rules = [
        rule_at(240.0, 270.0, 242.0),
        rule_at(290.0, 330.0, 242.0),
        rule_at(350.0, 370.0, 242.0),
    ];

    let markdown = chars_and_rules_to_markdown(&chars, &rules);

    assert!(markdown.contains(r"\frac{a}{x}"), "got: {markdown}");
    assert!(markdown.contains(r"\frac{b}{y}"), "got: {markdown}");
    assert!(markdown.contains(r"\frac{c}{z}"), "got: {markdown}");
    assert_eq!(
        markdown.lines().filter(|l| l.contains(r"\frac")).count(),
        1,
        "all three belong to one line: {markdown}"
    );
    assert!(markdown.contains("dz"), "the integrand's own dz survives: {markdown}");
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd src-tauri && cargo test --features pdf-native three_bars_on_one_row`
Expected: FAIL — the three `\frac`s are produced but `dz` is missing, because Task 4 never consumes or reads the baseline row.

- [ ] **Step 3: Write the implementation**

In `reconstruct_ruled_fractions`, after `den_groups` is computed and before `content` is built, find the baseline row and cut it into segments:

```rust
        let baseline_i = baseline_row(&plain, &consumed, &bars, band_y, num_i, den_i);

        let mut content: Vec<Inline> = Vec::new();
        for (i, (n, d)) in num_groups.iter().zip(den_groups.iter()).enumerate() {
            if let Some(b) = baseline_i {
                let before = if i == 0 { f32::NEG_INFINITY } else { bars[i - 1].x1 };
                content.extend(baseline_segment(&rows[b], before, bars[i].x0));
            }
            content.push(Inline::Maths(format!(
                "\\frac{{{}}}{{{}}}",
                latex::to_latex(n),
                latex::to_latex(d)
            )));
        }
        if let Some(b) = baseline_i {
            let last = bars.last().map(|bar| bar.x1).unwrap_or(f32::NEG_INFINITY);
            content.extend(baseline_segment(&rows[b], last, f32::INFINITY));
        }
```

Replace the old `content` binding with this block, and mark the baseline consumed alongside the other two:

```rust
        if let Some(b) = baseline_i {
            consumed[b] = true;
        }
```

`is_display_maths` is no longer always true — compute it the way `reconstruct_fraction_sums` does:

```rust
        let is_display_maths = content.iter().all(|i| match i {
            Inline::Text(span) => span.text.trim().is_empty(),
            Inline::Maths(_) => true,
            Inline::TableRow(_, _) | Inline::ImageRef(_, _) => false,
        });
```

Add the two helpers beside `flanking_row`:

```rust
/// The band's baseline row: the nearest unconsumed row to the band that is
/// neither its numerator nor its denominator and whose content sits mostly
/// *outside* the bars — the `+` connectors between them, an integrand's `dz`
/// past the last one. `None` when the band's fractions stand alone.
fn baseline_row(
    plain: &[Vec<CharBox>],
    consumed: &[bool],
    bars: &[RuleBox],
    band_y: f32,
    num_i: usize,
    den_i: usize,
) -> Option<usize> {
    let mut candidates: Vec<(usize, f32)> = plain
        .iter()
        .enumerate()
        .filter(|(i, row)| !consumed[*i] && *i != num_i && *i != den_i && !row.is_empty())
        .filter(|(i, row)| {
            let gap = (row_y(row) - band_y).abs();
            gap <= row_font_size(&plain[*i]).max(1.0) * FRACTION_MAX_ROW_GAP
        })
        .map(|(i, row)| (i, (row_y(row) - band_y).abs()))
        .collect();
    candidates.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));

    candidates.into_iter().find_map(|(i, _)| {
        let slack = row_font_size(&plain[i]).max(1.0) * SPAN_SLACK_EMS;
        (super::rules::chars_inside_spans(&plain[i], bars, slack) <= RULE_ROW_INSIDE_RATIO)
            .then_some(i)
    })
}

/// The baseline row's own content between two x positions, classified by the
/// normal `build_line` path so an operator, a connector and an integrand's
/// `dz` each read exactly as they would anywhere else.
fn baseline_segment(row: &[(usize, CharBox)], from: f32, to: f32) -> Vec<Inline> {
    let segment: Vec<(usize, CharBox)> = row
        .iter()
        .filter(|(_, c)| {
            let centre = c.x + c.width / 2.0;
            centre > from && centre < to
        })
        .copied()
        .collect();
    if segment.is_empty() {
        return Vec::new();
    }
    build_line(segment).content
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test --features pdf-native`
Expected: PASS, every test including Task 4's.

- [ ] **Step 5: Lint and commit**

```bash
cd src-tauri && cargo clippy --features pdf-native -- -D warnings
git add src-tauri/src/pdf/layout.rs src-tauri/src/pdf/layout_tests.rs
git commit -m "feat(pdf): interleave a ruled fraction band's baseline content"
```

---

### Task 6: Verify against the real corpus and tune

**Files:**
- Modify: `src-tauri/src/pdf/rules.rs` (constants, if the corpus demands it)
- Modify: `docs/specs/pdf-ruled-fraction-reconstruction-design.md` (append an "Implementation notes" section)
- Modify: `CLAUDE.md` (the PDF pipeline section)

The spec's acceptance criterion is measured here, not asserted. This is the task the whole plan exists to satisfy — every bug in this pipeline so far was invisible in synthetic fixtures.

- [ ] **Step 1: Measure the target sheet**

Run:
```bash
cd src-tauri
NULL_NOTES_PDF=../notes/exercise_sheets/Analysis_2_Blatt11.pdf \
  cargo test --features pdf-native dump_markdown -- --ignored --nocapture > /tmp/blatt11-after.txt
grep -c 'frac' /tmp/blatt11-after.txt
```
Expected: 10 fractions on page 0, up from the 5 recorded in the spec. Read the output and confirm items 4 and 5 read as contour integrals over a sum of fraction terms, with their `dz,` intact.

- [ ] **Step 2: Check every other sheet for regressions**

Run for each file in `notes/exercise_sheets/`:
```bash
cd src-tauri
for f in ../notes/exercise_sheets/*.pdf; do
  echo "=== $f"
  NULL_NOTES_PDF="$f" cargo test --features pdf-native dump_markdown -- --ignored --nocapture 2>/dev/null | grep -c 'frac'
done
```
Expected: no sheet's count goes *down*. A count going up is a fix; investigate any that go down before proceeding, since that is a regression in the geometric path this work was supposed to leave alone.

- [ ] **Step 3: Tune the constants if the corpus demands it**

Only if Steps 1-2 fall short. The constants to reach for, in order: `MIN_RULE_ASPECT` (if narrow bars are being rejected), `SPAN_SLACK_EMS` (if `bucket_by_span` is bailing on characters that visibly sit under a bar), `RULE_ROW_TOLERANCE` (if bars on one visual row are landing in separate bands). Re-run Steps 1-2 after each change. Record the final values and why in Step 5.

- [ ] **Step 4: Run the whole suite and lint**

```bash
cd src-tauri && cargo test --features pdf-native && cargo clippy --features pdf-native -- -D warnings
```
Expected: PASS, clean.

- [ ] **Step 5: Record what actually shipped**

Append an `## Implementation notes` section to `docs/specs/pdf-ruled-fraction-reconstruction-design.md` following the precedent in `docs/specs/pdf-table-fraction-maths-guards-design.md`: the final constant values and what forced each one away from its starting value, the measured before/after fraction counts per sheet, and anything the real corpus showed that the design did not predict. Note explicitly whether the geometric `reconstruct_fraction_sums` path still fires on any sheet, since the spec left that an open question.

- [ ] **Step 6: Update CLAUDE.md**

The PDF pipeline section states that equations are rebuilt from character geometry and font faces. Add that drawn rules are now a third input — a fraction bar is a path object, not a glyph, and it carries the term count and term boundaries that geometry alone can only guess at. While in there, correct the stale line claiming multi-line vector/matrix notation is out of scope: `reconstruct_cases` and `reconstruct_matrices` have since shipped.

- [ ] **Step 7: Commit**

```bash
git add docs/specs/pdf-ruled-fraction-reconstruction-design.md CLAUDE.md src-tauri/src/pdf/rules.rs
git commit -m "docs(pdf): record ruled-fraction results against the real corpus"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| `pdf/rules.rs`, `RuleBox` | 1 |
| Extraction, `bounds()` not `segments()`, Bezier rejection, `MAX_RULES_PER_PAGE` | 2 |
| No page-furniture filter (falls out of matching) | 4, verified by `a_bar_with_no_content_in_its_span_reconstructs_nothing` |
| `group_lines_with_rules`, region routing | 3 |
| Band the bars | 4 (`rules::band`, Task 1) |
| Numerator/denominator identification by majority-inside | 4 (`flanking_row`) |
| Bucket by span, `SPAN_SLACK`, bail on stray characters | 4 (`bucket_by_span`) |
| Build each fraction via `latex::to_latex` | 4 |
| Assemble with baseline residue interleaved | 5 |
| Consume all three rows | 5 |
| Ordering between `reconstruct_matrices` and `reconstruct_fraction_sums` | 3 (call site), 4 (implementation) |
| Existing passes untouched | 3, 4, 5 — no edits to `connector_baseline`, `split_into_terms`, `reconstruct_fraction_sums`, `splice_into_baseline` |
| `rules.rs` unit tests | 1 |
| `layout_tests.rs` synthetic Blatt11 shape | 5 |
| Real-document acceptance, constant tuning | 6 |
| `dump_rules` diagnostic | 2 |
| Clippy clean | every task |

**Known divergence:** Task 5 does not generalize `splice_into_baseline` as the spec proposed; it cuts the baseline row at the row stage instead, where real x coordinates still exist. Rationale recorded in Task 5.

**Type consistency:** `RuleBox` fields (`x0`, `x1`, `y`, `thickness`) are used identically in Tasks 1-5. `horizontal_rule(x0, x1, y0, y1)` takes bounds, not a centre, at both its definition (Task 1) and its one call site (Task 2). `chars_inside_spans` and `span_index` take `slack` as an absolute distance in both definition and every call, with the ems-to-points conversion done by the caller in `layout.rs`. `band` returns `Vec<Vec<RuleBox>>` and is consumed as such. `reconstruct_ruled_fractions(rows, rules)` has the same signature in Task 3's stub and Tasks 4-5's implementation, matching its four sibling passes.

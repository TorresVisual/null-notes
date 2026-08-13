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

/// How many times longer than it is thick a path must be. The narrowest real
/// bar seen (a `\frac{1}{2}`) is 5.19pt over 0.96pt, an aspect of 5.4.
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

/// A rule from one path's page-space bounding box, or `None` when the path is
/// too thick, too short, or too stubby to be one.
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

/// Which bar's span `x` falls in, widened by `slack` at each end. The nearest
/// span wins when `slack` makes two of them reach the same point.
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

//! Reconstructs document structure from the geometry of a PDF's text layer.
//!
//! Typeset exercise sheets carry a real text layer, so structure is a geometry
//! problem rather than a recognition one: characters know where they sit, how
//! big they are, and what font they are in. Grouping them back into lines,
//! blocks and headings is deterministic.
//!
//! Deliberately free of pdfium types. It takes plain [`CharBox`] values, which
//! keeps the entire algorithm unit-testable without the native library — the
//! test suite has no pdfium, so anything that touched it would be untestable.

use super::latex;
use super::maths::Family;
use unicode_normalization::UnicodeNormalization;

/// Marks where a word was broken across a line. Set by extraction from
/// pdfium's `is_hyphen` flag, and never emitted as text: reflowing the
/// paragraph puts the word back together, so the hyphen has no reason to
/// survive into the note.
pub const SOFT_HYPHEN: char = '\u{00AD}';

/// One character as the PDF places it. PDF user space puts the origin at the
/// bottom-left, so a **larger `y` is higher up the page**.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CharBox {
    pub ch: char,
    pub x: f32,
    /// Baseline origin, not the glyph's bottom — glyphs with descenders would
    /// otherwise not group with their own line.
    pub y: f32,
    pub width: f32,
    /// Top and bottom of the glyph's box, so a maths region can be cropped at
    /// its true extent rather than at a guess derived from the font size.
    pub top: f32,
    pub bottom: f32,
    pub font_size: f32,
    pub bold: bool,
    pub italic: bool,
    pub fixed_pitch: bool,
    /// Which maths face the glyph came from, if any. Computer Modern splits
    /// mathematics across faces by meaning, so this is most of what
    /// [`super::latex`] needs to rebuild the equation.
    pub family: Family,
}

impl CharBox {
    pub fn is_maths(&self) -> bool {
        self.family.is_maths()
    }
}

/// A piece of a line: prose, or an equation rebuilt as LaTeX.
#[derive(Debug, Clone, PartialEq)]
pub enum Inline {
    Text(Span),
    /// The LaTeX source, without delimiters. Text rather than an image so it can
    /// be copied into a prompt, searched, and edited in place.
    Maths(String),
    /// One table row's cells, each a `Vec<Inline>` in its own right so a cell
    /// can hold bold/italic spans or inline maths for free, plus whether this
    /// is the first row of its own detected table. `group_blocks` merges
    /// consecutive `TableRow`-only `Line`s into one `Block::Table`, using
    /// that flag — not a vertical-gap heuristic — to tell "this starts a new
    /// table" apart from "this continues the one before it": a wrapped
    /// cell's continuation line folds into its anchor row rather than
    /// becoming its own `Line` (see `reconstruct_tables`), so the gap to the
    /// *next* row is irregular by design, exactly the kind of row-height
    /// variation a gap-based heuristic would misread as a table boundary.
    TableRow(Vec<Vec<Inline>>, bool),
    /// A page image, referenced by a placeholder — not yet a real asset
    /// path. `import_pdf_markdown` (`commands/pdf.rs`) has no note to write
    /// a `.assets/` sidecar into at the point this Markdown is produced (see
    /// the design spec for why), so the actual file only exists once the
    /// frontend writes it and substitutes the placeholder for a real path.
    ImageRef(String, String),
}

/// A run of characters sharing one emphasis style.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Span {
    pub text: String,
    pub bold: bool,
    pub italic: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Line {
    pub content: Vec<Inline>,
    pub x: f32,
    /// Right edge of the line's own characters — `x` marks the left. Fraction
    /// detection needs both: a numerator and denominator are recognised by
    /// their horizontal *ranges* overlapping, not merely by a shared left
    /// edge, and unrelated trailing content (`dz` beside a fraction) is
    /// recognised by *not* overlapping either.
    pub right: f32,
    pub y: f32,
    pub font_size: f32,
    pub fixed_pitch: bool,
    /// True when everything on the line outside its maths regions is
    /// whitespace — a display equation rather than a sentence containing one.
    pub is_display_maths: bool,
    /// True when the line ends mid-word, so the next line resumes it and must
    /// join without a space.
    pub ends_hyphenated: bool,
}

impl Line {
    /// The line's text, with maths regions contributing nothing. Used for
    /// classification (list markers, blankness), never for output.
    pub fn text(&self) -> String {
        self.content
            .iter()
            .filter_map(|i| match i {
                Inline::Text(span) => Some(span.text.as_str()),
                Inline::Maths(_) | Inline::TableRow(_, _) | Inline::ImageRef(_, _) => None,
            })
            .collect()
    }

    pub(super) fn is_blank(&self) -> bool {
        // A table-row or image-ref line carries no `Text`/`Maths` content of
        // its own by this measure, so without this check either would be
        // filtered out as blank before `classify` ever saw it.
        self.text().trim().is_empty()
            && !self.content.iter().any(is_maths)
            && !matches!(self.content.as_slice(), [Inline::TableRow(_, _)])
            && !matches!(self.content.as_slice(), [Inline::ImageRef(_, _)])
    }
}

fn is_maths(inline: &Inline) -> bool {
    matches!(inline, Inline::Maths(_))
}

// How much of a line's non-whitespace content has to sit inside `Maths`
// regions, by character count, before the line counts as a display
// equation rather than prose that merely contains one. A display equation
// is allowed a short connector word ("mit", "für") without losing its own
// block — see `is_mostly_maths`'s doc comment — but an ordinary sentence
// that just references an inline formula ("Die Zahl $x$ ist gerade.")
// must not tip into becoming one, so the bar sits well above half.
const DISPLAY_MATHS_TEXT_RATIO: f32 = 0.75;

/// Whether `content`'s non-whitespace characters are dominated by `Maths`
/// regions, `Inline::Maths`'s own LaTeX standing in for the glyphs it
/// replaced (its length is not exact PDF character-for-character, but is
/// close enough to judge "mostly" by).
///
/// Loosened from an earlier all-or-nothing rule ("every non-maths
/// character must be whitespace") that read a display equation with even
/// one short connector word on it — "y'(t) + 2y(t) = 4cos(2t) mit
/// y(0) = 1." — as ordinary prose instead, dropping it into a paragraph as
/// two small inline `$…$` spans rather than the one centered display
/// equation the source PDF actually set. `finish_block`'s
/// `LineKind::MathsDisplay` arm wraps whatever non-whitespace text this
/// allows through in `\text{}`, LaTeX's own way to embed prose inside
/// display math, so the connector survives rather than being dropped.
///
/// Refuses a line whose text opens with a list marker — "(a) f(z) = z^3."
/// — even when the equation dominates its character count. `classify`
/// checks `is_display_maths` before it ever checks for a list marker (a
/// deliberate order: a real display equation would otherwise misread as a
/// heading or list item), so without this guard a whole run of labelled
/// sub-parts — "(a) ...", "(b) ...", "(c) ..." — each individually
/// display-worthy, collapsed into *one* `MathsDisplay` block spanning all
/// of them, silently erasing the separate list items a real document
/// found on Analysis_2_Blatt10.pdf and Ue5.pdf actually has.
fn is_mostly_maths(content: &[Inline]) -> bool {
    if content.iter().any(|i| matches!(i, Inline::TableRow(_, _) | Inline::ImageRef(_, _))) {
        return false;
    }
    let text_only: String = content
        .iter()
        .filter_map(|i| match i {
            Inline::Text(span) => Some(span.text.as_str()),
            _ => None,
        })
        .collect();
    if list_marker(&text_only).is_some() {
        return false;
    }
    let maths_chars: usize = content
        .iter()
        .filter_map(|i| match i {
            Inline::Maths(latex) => Some(latex.chars().count()),
            _ => None,
        })
        .sum();
    if maths_chars == 0 {
        return false;
    }
    let text_chars: usize = text_only.chars().filter(|c| !c.is_whitespace()).count();
    maths_chars as f32 >= (maths_chars + text_chars) as f32 * DISPLAY_MATHS_TEXT_RATIO
}

#[derive(Debug, Clone, PartialEq)]
pub enum Block {
    Heading { level: u8, content: Vec<Inline> },
    Paragraph { content: Vec<Inline> },
    Code { text: String },
    /// A standalone equation, cropped whole rather than inlined into a
    /// paragraph.
    MathsDisplay { latex: String },
    ListItem {
        ordered: bool,
        number: Option<u32>,
        depth: usize,
        content: Vec<Inline>,
    },
    /// Every row's cells, first row always the header — a table with no
    /// natural header row is out of scope (see the design spec's
    /// Non-goals).
    Table { rows: Vec<Vec<Vec<Inline>>> },
    /// A single embedded image, referenced by placeholder — see
    /// `Inline::ImageRef`.
    Image { placeholder: String, alt: String },
}

// Chars on one line share a baseline, but superscripts, subscripts and inline
// maths sit slightly off it. A fraction of the font size absorbs that without
// merging genuinely adjacent lines, whose spacing is at least ~1.0x.
const BASELINE_TOLERANCE: f32 = 0.4;
// Superscripts and subscripts sit further off the baseline than that, and an
// exponent on a display equation can clear it entirely — which splits the
// equation across two "lines" and leaks it into the prose as glyph soup. The
// wider window is granted only to visibly smaller glyphs, so two full-size
// lines still never merge.
const SCRIPT_BASELINE_TOLERANCE: f32 = 0.6;
// Below this fraction of the line's size, a glyph is a script rather than body
// text.
const SCRIPT_SIZE_RATIO: f32 = 0.85;
// PDFs frequently position words by moving the cursor instead of emitting a
// space character, so a wide gap has to become one.
const SPACE_GAP: f32 = 0.22;
// Below this multiple of the body size a line is body text; above it, a
// heading. Typeset headings are normally >= 1.2x.
const HEADING_RATIO: f32 = 1.15;
// A vertical gap this much larger than the document's usual line spacing
// separates paragraphs rather than lines.
const BLOCK_GAP_RATIO: f32 = 1.5;
// Indent per nesting level, in multiples of the body font size.
const LIST_INDENT_EMS: f32 = 2.0;
// How far apart two maths characters can sit and still belong to one equation.
// Wide enough to bridge " : " or "cos", narrow enough that the prose on either
// side of an equation is not swallowed into it.
const MATHS_BRIDGE_EMS: f32 = 2.5;
// Table cell padding is far narrower than a page-column gutter — chosen
// against notes/table_test.pdf's own ~12pt (ReportLab's LEFTPADDING +
// RIGHTPADDING) minimum cell spacing at an 11-12pt body size, comfortably
// above any ordinary inter-word gap.
const TABLE_MIN_GUTTER_EMS: f32 = 0.8;
// A table needs at least this many logical rows (a header plus at least
// one data row) to be worth reconstructing.
const TABLE_MIN_ROWS: usize = 2;
// ...and at least this fraction of its (row, cell) slots holding real
// content, so a coincidentally-aligned run of mostly-blank lines is never
// mistaken for a data grid.
const TABLE_MIN_FILL_RATIO: f32 = 0.5;
// A candidate table window whose non-whitespace characters are mostly
// covered by maths_runs' own per-row detection is a maths expression that
// happens to have internal alignment gaps (a \binom vector's two rows, a
// \cases block's value/condition columns, side-by-side binomial-coefficient
// pairs) rather than real tabular data. The real corpus's genuine tables
// (ID/Name/Owner-style data) sit at 0% maths-family content, giving real
// headroom below a majority threshold — needed because a real \cases
// condition often mixes prose directly into the maths ("1 für t≥b" is only
// ~43% maths by character count: maths_runs' word-boundary rule correctly
// refuses to absorb "für" into the run). Confirmed against
// Analysis_2_Blatt12.pdf's Heaviside definition, whose two condition rows
// measure ~43%/50% — see
// docs/specs/pdf-table-fraction-maths-guards-design.md.
const TABLE_MATHS_GUARD_RATIO: f32 = 0.4;

/// The standalone accent glyphs LaTeX's Computer Modern fonts emit, mapped to
/// their combining forms. CM has no precomposed "ü": it prints a `u` and then
/// a diaeresis positioned over it, so the text layer hands back "fu¨r" where
/// the document plainly says "für". Rewriting the accent as combining and
/// normalising puts the word back together.
fn combining_form(c: char) -> Option<char> {
    Some(match c {
        '\u{00A8}' => '\u{0308}', // diaeresis
        '\u{00B4}' => '\u{0301}', // acute
        '\u{0060}' => '\u{0300}', // grave
        '\u{005E}' => '\u{0302}', // circumflex
        '\u{007E}' => '\u{0303}', // tilde
        '\u{00AF}' => '\u{0304}', // macron
        '\u{02C7}' => '\u{030C}', // caron
        '\u{02D8}' => '\u{0306}', // breve
        '\u{02DA}' => '\u{030A}', // ring
        '\u{00B8}' => '\u{0327}', // cedilla
        _ => return None,
    })
}

/// Lower median. Deliberately not the upper one: line gaps outnumber paragraph
/// gaps, so when a document has only a couple of gaps to judge from, rounding
/// towards the smaller keeps the paragraph break detectable.
fn median(values: &mut [f32]) -> f32 {
    if values.is_empty() {
        return 0.0;
    }
    values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    values[(values.len() - 1) / 2]
}

/// Whether `ch` sits close enough to `anchor` in `y` to share its row, scaled
/// by whichever of the two is larger and loosened for a script (superscript,
/// subscript, footnote marker), which sits further off the baseline than a
/// same-size character would.
fn baseline_tolerance_ok(anchor: &CharBox, ch: &CharBox) -> bool {
    let scale = anchor.font_size.max(ch.font_size).max(1.0);
    // Symmetric: a raised exponent sorts above the line it belongs to and so
    // can become the anchor itself, which made a one-sided test compare the
    // body text against the script instead.
    let is_script = anchor.font_size.min(ch.font_size) < scale * SCRIPT_SIZE_RATIO;
    let tolerance = if is_script {
        SCRIPT_BASELINE_TOLERANCE
    } else {
        BASELINE_TOLERANCE
    };
    (anchor.y - ch.y).abs() <= scale * tolerance
}

/// Whether `ch` sits low enough to be the subscript of a lone big operator
/// (`∮`, `∑`, `∫`, …) — never the ordinary [`baseline_tolerance_ok`] window,
/// which is scaled to an *adjacent* character's own size and comes nowhere
/// close to reaching a subscript sitting at the foot of a much taller glyph.
/// On the real document this was built against, `∮`'s own glyph spans 27pt
/// top to bottom, and its "_C" subscript sits right at the bottom of that —
/// far outside any tolerance scaled from a normal single-line offset. The
/// operator's own measured height is the only signal wide enough to find it.
fn fits_below_big_operator(row: &[(usize, CharBox)], ch: &CharBox) -> bool {
    let [(_, op)] = row else { return false };
    if op.family != Family::Extensible {
        return false;
    }
    let margin = op.font_size.max(1.0) * SCRIPT_BASELINE_TOLERANCE;
    ch.y >= op.bottom - margin && ch.y <= op.top + margin
}

/// Horizontal distance between two glyphs' advance boxes — `0.0` if they
/// overlap in `x`, otherwise the gap between the nearer pair of edges.
fn horizontal_gap(a: &CharBox, b: &CharBox) -> f32 {
    let (a0, a1) = (a.x, a.x + a.width);
    let (b0, b1) = (b.x, b.x + b.width);
    if a1 < b0 {
        b0 - a1
    } else if b1 < a0 {
        a0 - b1
    } else {
        0.0
    }
}

/// A rough, whole-selection estimate of "what body text is sized at" —
/// whichever size the most non-whitespace characters share. Used only to
/// separate script-sized glyphs from body text in [`group_lines`]; the
/// per-document [`body_font_size`] is a different, later thing computed once
/// real lines exist.
fn dominant_font_size(chars: &[CharBox]) -> f32 {
    let mut weighted: Vec<(f32, usize)> = Vec::new();
    for c in chars.iter().filter(|c| !c.ch.is_whitespace()) {
        match weighted
            .iter_mut()
            .find(|(size, _)| (*size - c.font_size).abs() < 0.51)
        {
            Some((_, count)) => *count += 1,
            None => weighted.push((c.font_size, 1)),
        }
    }
    weighted
        .into_iter()
        .max_by_key(|(_, count)| *count)
        .map(|(size, _)| size)
        .unwrap_or(12.0)
}

/// The horizontal span of a row's printing characters — left edge of the
/// leftmost, right edge of the rightmost. Whitespace carries no width worth
/// counting, so it's excluded the same way `dominant_font_size` excludes it.
///
/// `pub(super)` (not private) because `layout_tests` is a sibling module of
/// `layout`, not a child of it — unlike `latex.rs`'s own `#[cfg(test)] mod
/// tests`, which sits inside the file it tests and so gets private access
/// for free, this file's tests live in `layout_tests.rs` and need explicit
/// visibility to unit-test these helpers directly rather than only through
/// `group_lines`/`chars_to_markdown`.
pub(super) fn row_x_extent(row: &[CharBox]) -> (f32, f32) {
    row.iter()
        .filter(|c| !c.ch.is_whitespace())
        .fold((f32::MAX, f32::MIN), |(lo, hi), c| (lo.min(c.x), hi.max(c.x + c.width)))
}

/// A row's own baseline `y` — every character on it shares one by
/// construction (`group_lines`'s baseline-tolerance grouping already
/// guaranteed that), so any one of them reads it off just as well as an
/// average would.
pub(super) fn row_y(row: &[CharBox]) -> f32 {
    row.iter().map(|c| c.y).fold(f32::MIN, f32::max)
}

/// The row's dominant font size, the same `median`-based measure
/// `build_line` uses for its own `Line::font_size`.
pub(super) fn row_font_size(row: &[CharBox]) -> f32 {
    let mut sizes: Vec<f32> = row
        .iter()
        .filter(|c| !c.ch.is_whitespace())
        .map(|c| c.font_size)
        .collect();
    median(&mut sizes)
}

/// Finds column-boundary x-positions shared by every row in `rows`, by
/// merging every non-whitespace character's x-interval — not each row's
/// own collapsed extent the way `row_x_extent` works, since a table needs
/// *sub-row* boundaries — into covered ranges. The gaps left over are
/// candidate cell boundaries, each returned as its midpoint. `None` when
/// there's no gap wide enough to be a real cell boundary rather than an
/// ordinary word-space within one cell.
///
/// Different rows' words rarely start and end at exactly the same x, so
/// merging *across* rows (not measuring each row alone) is what makes this
/// robust: two rows of ordinary prose with different word lengths leave no
/// gap anywhere in the union, while two rows of real tabular data — whose
/// column starts are genuinely aligned — do.
pub(super) fn table_gutters(rows: &[Vec<CharBox>]) -> Option<Vec<f32>> {
    let mut intervals: Vec<(f32, f32)> = rows
        .iter()
        .flatten()
        .filter(|c| !c.ch.is_whitespace())
        .map(|c| (c.x, c.x + c.width))
        .collect();
    if intervals.is_empty() {
        return None;
    }
    intervals.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));

    let mut merged: Vec<(f32, f32)> = Vec::new();
    for (s, e) in intervals {
        match merged.last_mut() {
            Some((_, last_e)) if s <= *last_e => *last_e = last_e.max(e),
            _ => merged.push((s, e)),
        }
    }

    let mut sizes: Vec<f32> = rows.iter().flatten().map(|c| c.font_size).collect();
    let threshold = median(&mut sizes).max(1.0) * TABLE_MIN_GUTTER_EMS;

    let gutters: Vec<f32> = merged
        .windows(2)
        .filter(|w| w[1].0 - w[0].1 >= threshold)
        .map(|w| (w[0].1 + w[1].0) / 2.0)
        .collect();

    (!gutters.is_empty()).then_some(gutters)
}

/// Splits `row` into `cut_xs.len() + 1` cells at the given x-positions,
/// preserving each character's original stream index — `build_line` (used
/// on each cell's characters in `reconstruct_tables`) sorts by that index,
/// not by `x`.
pub(super) fn split_row_into_cells(
    row: &[(usize, CharBox)],
    cut_xs: &[f32],
) -> Vec<Vec<(usize, CharBox)>> {
    let mut cells: Vec<Vec<(usize, CharBox)>> = vec![Vec::new(); cut_xs.len() + 1];
    for &(index, ch) in row {
        let cell = cut_xs.iter().filter(|&&cx| ch.x > cx).count();
        cells[cell].push((index, ch));
    }
    cells
}

pub(super) fn cell_has_content(cell: &[(usize, CharBox)]) -> bool {
    cell.iter().any(|(_, c)| !c.ch.is_whitespace())
}

/// Whether any character in `row` straddles one of `cut_xs` — the signal
/// that this row does not belong to the table the gutters were established
/// from, rather than merely being one more row of it.
pub(super) fn row_crosses_gutters(row: &[CharBox], cut_xs: &[f32]) -> bool {
    row.iter()
        .any(|c| cut_xs.iter().any(|&cx| c.x < cx && c.x + c.width > cx))
}

/// Splits `row`'s printing characters into exactly `n` left-to-right groups,
/// cut at its `n - 1` widest horizontal gaps.
///
/// This is how a numerator or denominator row holding several stacked
/// fraction terms actually divides, once `n` is known from the baseline's
/// own connector count (see `connector_baseline`) — measuring the row's own
/// gaps, rather than guessing from `MATHS_BRIDGE_EMS`, is what correctly
/// separates three denominators that sit closer together than their
/// numerators do.
///
/// `None` when there aren't enough characters to fill `n` non-empty groups,
/// or when the row's gaps don't clearly separate into `n` groups — the
/// narrowest cut chosen must be markedly wider than the widest gap left
/// uncut, or forcing a split would be a guess rather than a measurement.
pub(super) fn split_into_terms(row: &[CharBox], n: usize) -> Option<Vec<Vec<CharBox>>> {
    let mut sorted: Vec<CharBox> = row.iter().copied().filter(|c| !c.ch.is_whitespace()).collect();
    if n == 0 || sorted.len() < n {
        return None;
    }
    sorted.sort_by(|a, b| a.x.partial_cmp(&b.x).unwrap_or(std::cmp::Ordering::Equal));

    if n == 1 {
        return Some(vec![sorted]);
    }

    let mut gaps: Vec<(f32, usize)> = sorted
        .windows(2)
        .enumerate()
        .map(|(i, w)| (horizontal_gap(&w[0], &w[1]), i))
        .collect();
    gaps.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

    if gaps.len() < n - 1 {
        return None;
    }

    let cuts = &gaps[..n - 1];
    let widest_kept = cuts.iter().map(|(g, _)| *g).fold(f32::INFINITY, f32::min);
    let widest_dropped = gaps.get(n - 1).map(|(g, _)| *g).unwrap_or(0.0);
    if widest_kept <= widest_dropped * 1.5 {
        return None;
    }

    let mut cut_indices: Vec<usize> = cuts.iter().map(|(_, i)| *i).collect();
    cut_indices.sort_unstable();

    let mut groups = Vec::with_capacity(n);
    let mut start = 0;
    for cut in cut_indices {
        groups.push(sorted[start..=cut].to_vec());
        start = cut + 1;
    }
    groups.push(sorted[start..].to_vec());
    Some(groups)
}

/// Whether `row` is a "connector baseline": a row whose printing content,
/// once a leading enumeration label like `(b)` is stripped, is nothing but
/// `+`/`-` connectors and an optional trailing `.` — the shape a baseline
/// takes when it joins several side-by-side fraction terms, rather than
/// sitting beside a single one (`f(z) = ... .`) or carrying prose of its
/// own. `None` if the row has any other content, or no connectors at all —
/// zero connectors is a single fraction's baseline, already handled by
/// `reconstruct_fractions`.
///
/// Returns the connectors in left-to-right order and whether the row ends
/// in a trailing period.
pub(super) fn connector_baseline(row: &[CharBox]) -> Option<(Vec<char>, bool)> {
    let mut sorted: Vec<CharBox> = row.iter().copied().filter(|c| !c.ch.is_whitespace()).collect();
    sorted.sort_by(|a, b| a.x.partial_cmp(&b.x).unwrap_or(std::cmp::Ordering::Equal));

    let after_label = match sorted.iter().position(|c| c.ch == ')') {
        Some(i) => &sorted[i + 1..],
        None => &sorted[..],
    };
    if after_label.is_empty() {
        return None;
    }

    let last = after_label.len() - 1;
    let mut connectors = Vec::new();
    let mut trailing_period = false;
    for (i, c) in after_label.iter().enumerate() {
        match c.ch {
            '+' | '-' | '\u{2212}' => connectors.push(c.ch),
            '.' if i == last => trailing_period = true,
            _ => return None,
        }
    }
    (!connectors.is_empty()).then_some((connectors, trailing_period))
}

/// The leading enumeration label on a connector baseline — `"(b) "`. Empty
/// when the row opens with no such label.
///
/// Always ends in exactly one space, synthesized rather than read off the
/// row's own characters: PDFs frequently place the next glyph with a cursor
/// jump instead of an actual space character (confirmed on this exact
/// document — nothing but a cursor advance sits between `)` and the `+`
/// that follows it), and `list_marker`'s own `len` calculation always
/// counts the separator after an enumeration label as exactly one
/// character. Any literal whitespace `CharBox`es already present are
/// skipped rather than kept, so the two stay in agreement regardless of
/// what the source actually contained.
pub(super) fn baseline_label(row: &[CharBox]) -> String {
    let mut sorted: Vec<CharBox> = row.to_vec();
    sorted.sort_by(|a, b| a.x.partial_cmp(&b.x).unwrap_or(std::cmp::Ordering::Equal));

    let Some(paren) = sorted.iter().position(|c| c.ch == ')') else {
        return String::new();
    };
    let mut label: String = sorted[..=paren].iter().map(|c| c.ch).collect();
    label.push(' ');
    label
}

/// Finds and reconstructs a "sum of stacked fractions" — several fractions
/// joined by `+`/`-`, with every numerator on one row and every denominator
/// on another, the way exercise 1(b) on Analysis_1_Blatt2_2025.pdf sets
/// `1/x² + y²/(x⁴+x³y) + y³/(x⁵-x³y²)`.
///
/// Runs on the raw rows, before `build_line` collapses them into `Inline`s,
/// because splitting several terms sharing one row needs their real x-gaps:
/// once collapsed to a LaTeX string, a genuine fraction-boundary gap and a
/// gap synthesized around an ordinary internal operator both render as an
/// indistinguishable single space. A single fraction (no connectors) is
/// left alone for `reconstruct_fractions`, further down the pipeline, to
/// keep handling exactly as it does today.
///
/// Consumes rows nearest-baseline-first: every row is examined once as a
/// potential connector baseline, and whichever still-unconsumed numerator
/// and denominator row match it (by vertical gap and horizontal overlap,
/// the same tolerances `find_fraction_pair` uses) are claimed.
///
/// Returns the finished `Line`s for whatever matched, and every row that
/// didn't — for the caller to run through the normal `build_line` path.
fn reconstruct_fraction_sums(rows: Vec<Vec<(usize, CharBox)>>) -> (Vec<Line>, Vec<Vec<(usize, CharBox)>>) {
    let plain: Vec<Vec<CharBox>> = rows.iter().map(|r| r.iter().map(|(_, c)| *c).collect()).collect();
    let mut consumed = vec![false; rows.len()];
    let mut synthesized: Vec<Line> = Vec::new();

    for baseline_i in 0..plain.len() {
        if consumed[baseline_i] {
            continue;
        }
        let Some((connectors, trailing_period)) = connector_baseline(&plain[baseline_i]) else {
            continue;
        };
        let terms = connectors.len() + 1;
        let base_y = row_y(&plain[baseline_i]);
        let base_size = row_font_size(&plain[baseline_i]).max(1.0);
        let (base_x0, base_x1) = row_x_extent(&plain[baseline_i]);

        let nearest = |order: Vec<usize>| -> Option<usize> {
            order
                .into_iter()
                .filter(|&i| !consumed[i])
                .filter(|&i| {
                    let gap = (row_y(&plain[i]) - base_y).abs();
                    if gap <= 0.0 || gap > base_size * FRACTION_MAX_ROW_GAP {
                        return false;
                    }
                    let (x0, x1) = row_x_extent(&plain[i]);
                    let overlap = range_overlap(x0, x1, base_x0, base_x1);
                    let min_width = (x1 - x0).min(base_x1 - base_x0).max(1.0);
                    overlap >= min_width * FRACTION_MIN_OVERLAP_RATIO
                })
                .min_by(|&a, &b| {
                    let da = (row_y(&plain[a]) - base_y).abs();
                    let db = (row_y(&plain[b]) - base_y).abs();
                    da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
                })
        };

        let Some(num_i) = nearest((0..baseline_i).collect()) else { continue };
        let Some(den_i) = nearest((baseline_i + 1..plain.len()).collect()) else { continue };

        let Some(num_groups) = split_into_terms(&plain[num_i], terms) else { continue };
        let Some(den_groups) = split_into_terms(&plain[den_i], terms) else { continue };

        let fracs: Vec<String> = num_groups
            .iter()
            .zip(den_groups.iter())
            .map(|(n, d)| format!("\\frac{{{}}}{{{}}}", latex::to_latex(n), latex::to_latex(d)))
            .collect();

        let mut content: Vec<Inline> = Vec::new();
        let label = baseline_label(&plain[baseline_i]);
        if !label.is_empty() {
            content.push(Inline::Text(Span { text: label, bold: false, italic: false }));
        }
        for (i, frac) in fracs.iter().enumerate() {
            content.push(Inline::Maths(frac.clone()));
            if let Some(&c) = connectors.get(i) {
                let symbol = if c == '\u{2212}' { '-' } else { c };
                content.push(Inline::Text(Span {
                    text: format!(" {symbol} "),
                    bold: false,
                    italic: false,
                }));
            }
        }
        if trailing_period {
            content.push(Inline::Text(Span { text: ".".to_string(), bold: false, italic: false }));
        }

        let is_display_maths = content.iter().all(|i| match i {
            Inline::Text(span) => span.text.trim().is_empty(),
            Inline::Maths(_) => true,
            Inline::TableRow(_, _) | Inline::ImageRef(_, _) => false,
        });

        let (num_x0, num_x1) = row_x_extent(&plain[num_i]);
        let (den_x0, den_x1) = row_x_extent(&plain[den_i]);

        synthesized.push(Line {
            content,
            x: base_x0.min(num_x0).min(den_x0),
            right: base_x1.max(num_x1).max(den_x1),
            y: base_y,
            font_size: base_size,
            fixed_pitch: false,
            is_display_maths,
            ends_hyphenated: false,
        });

        consumed[baseline_i] = true;
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

/// Appends a wrapped cell's continuation content onto `cell`, space-joined
/// — a description that wraps across two PDF lines becomes one cell, not
/// two. Reuses the same `push_text` helper `join_lines` already uses to
/// join text runs.
fn append_cell_content(cell: &mut Vec<Inline>, extra: Vec<Inline>) {
    if extra.is_empty() {
        return;
    }
    if !cell.is_empty() {
        push_text(cell, ' ', false, false);
    }
    cell.extend(extra);
}

/// Every logical row this candidate found, and every physical row (primary
/// or wrapped-continuation) it absorbed, for the caller to mark consumed.
struct TableMatch {
    logical_rows: Vec<(usize, Vec<Vec<Inline>>)>,
    consumed_rows: Vec<usize>,
}

/// Fraction of `rows`' non-whitespace characters that fall inside some
/// row's own `maths_runs`-detected span, each row measured independently
/// at its own font size (the same per-row measure `build_line` uses when
/// it actually crops maths regions out of a line). High coverage means a
/// candidate table window is essentially one maths expression rather than
/// real tabular data, even though it satisfies the gutter/fill-ratio
/// checks above — see `TABLE_MATHS_GUARD_RATIO`.
fn maths_coverage_ratio(rows: &[Vec<CharBox>]) -> f32 {
    let mut total = 0usize;
    let mut covered = 0usize;
    for row in rows {
        let printing = row.iter().filter(|c| !c.ch.is_whitespace()).count();
        if printing == 0 {
            continue;
        }
        total += printing;
        let runs = maths_runs(row, row_font_size(row));
        covered += runs
            .iter()
            .map(|&(s, e)| row[s..e].iter().filter(|c| !c.ch.is_whitespace()).count())
            .sum::<usize>();
    }
    if total == 0 {
        0.0
    } else {
        covered as f32 / total as f32
    }
}

/// Attempts to grow a table starting at `plain[start]`. Establishes column
/// gutters from the first two rows, then greedily absorbs subsequent rows:
/// a row with content in most of the established cells is a new logical
/// row; a row with content in *exactly one* cell is a wrapped-cell
/// continuation, folded onto that cell in the row above; a row that
/// straddles a gutter, or has no content at all, ends the table. `None`
/// when the result doesn't clear `TABLE_MIN_ROWS`/`TABLE_MIN_FILL_RATIO` —
/// released back to normal paragraph processing rather than forced.
fn try_table_at(
    rows: &[Vec<(usize, CharBox)>],
    plain: &[Vec<CharBox>],
    start: usize,
) -> Option<TableMatch> {
    let cut_xs = table_gutters(&plain[start..start + 2])?;

    // Both seed rows must themselves show real multi-cell structure, not
    // merely that the two rows *combined* happen to leave a gap somewhere.
    // Without this, two entirely unrelated rows of different lengths — a
    // maths expression's numerator, and an unrelated line below it — can
    // produce a spurious gutter purely from their different content
    // lengths, even though neither row is itself tabular.
    let seed_is_tabular = |row: &[(usize, CharBox)]| {
        split_row_into_cells(row, &cut_xs)
            .iter()
            .filter(|c| cell_has_content(c))
            .count()
            >= 2
    };
    if !seed_is_tabular(&rows[start]) || !seed_is_tabular(&rows[start + 1]) {
        return None;
    }

    let cells_of = |row: &[(usize, CharBox)]| -> Vec<Vec<Inline>> {
        split_row_into_cells(row, &cut_xs)
            .into_iter()
            .map(|cell| if cell.is_empty() { Vec::new() } else { build_line(cell).content })
            .collect()
    };

    let mut consumed_rows: Vec<usize> = vec![start];
    let mut anchor_row = start;
    let mut anchor_cells = cells_of(&rows[start]);
    let mut logical_rows: Vec<(usize, Vec<Vec<Inline>>)> = Vec::new();

    let mut i = start + 1;
    while i < rows.len() {
        if row_crosses_gutters(&plain[i], &cut_xs) {
            break;
        }
        let raw_cells = split_row_into_cells(&rows[i], &cut_xs);
        let filled: Vec<usize> = raw_cells
            .iter()
            .enumerate()
            .filter(|(_, c)| cell_has_content(c))
            .map(|(idx, _)| idx)
            .collect();

        if filled.is_empty() {
            break;
        }
        if filled.len() == 1 {
            let cell_index = filled[0];
            let extra = if raw_cells[cell_index].is_empty() {
                Vec::new()
            } else {
                build_line(raw_cells[cell_index].clone()).content
            };
            append_cell_content(&mut anchor_cells[cell_index], extra);
            consumed_rows.push(i);
            i += 1;
            continue;
        }

        logical_rows.push((anchor_row, std::mem::take(&mut anchor_cells)));
        consumed_rows.push(i);
        anchor_row = i;
        anchor_cells = raw_cells
            .into_iter()
            .map(|cell| if cell.is_empty() { Vec::new() } else { build_line(cell).content })
            .collect();
        i += 1;
    }
    logical_rows.push((anchor_row, anchor_cells));

    if logical_rows.len() < TABLE_MIN_ROWS {
        return None;
    }
    let total = logical_rows.len() * (cut_xs.len() + 1);
    let filled_count = logical_rows
        .iter()
        .flat_map(|(_, cells)| cells.iter())
        .filter(|c| !c.is_empty())
        .count();
    if (filled_count as f32) < total as f32 * TABLE_MIN_FILL_RATIO {
        return None;
    }
    let consumed_plain: Vec<Vec<CharBox>> =
        consumed_rows.iter().map(|&i| plain[i].clone()).collect();
    if maths_coverage_ratio(&consumed_plain) >= TABLE_MATHS_GUARD_RATIO {
        return None;
    }

    Some(TableMatch { logical_rows, consumed_rows })
}

/// Finds and reconstructs runs of rows whose text aligns into a shared grid
/// of columns into `Line`s carrying `Inline::TableRow` — see the design
/// spec (`docs/specs/pdf-table-reconstruction-design.md`) for the full
/// detection rationale. Runs on the same raw rows `reconstruct_fraction_sums`
/// consumes, and for the same reason: this needs the raw `CharBox`
/// x-positions a `Line` no longer carries once `build_line` collapses a row.
fn reconstruct_tables(rows: Vec<Vec<(usize, CharBox)>>) -> (Vec<Line>, Vec<Vec<(usize, CharBox)>>) {
    let plain: Vec<Vec<CharBox>> = rows.iter().map(|r| r.iter().map(|(_, c)| *c).collect()).collect();
    let mut consumed = vec![false; rows.len()];
    let mut synthesized: Vec<Line> = Vec::new();

    let mut start = 0;
    while start < rows.len() {
        if consumed[start] || start + 1 >= rows.len() {
            start += 1;
            continue;
        }
        let Some(table) = try_table_at(&rows, &plain, start) else {
            start += 1;
            continue;
        };
        for &row_index in &table.consumed_rows {
            consumed[row_index] = true;
        }
        for (index, (anchor_row, cells)) in table.logical_rows.into_iter().enumerate() {
            let anchor = &plain[anchor_row];
            let (x, right) = row_x_extent(anchor);
            synthesized.push(Line {
                content: vec![Inline::TableRow(cells, index == 0)],
                x,
                right,
                y: row_y(anchor),
                font_size: row_font_size(anchor),
                fixed_pitch: false,
                is_display_maths: false,
                ends_hyphenated: false,
            });
        }
        start = table.consumed_rows.iter().copied().max().map(|m| m + 1).unwrap_or(start + 1);
    }

    let remaining: Vec<Vec<(usize, CharBox)>> = rows
        .into_iter()
        .enumerate()
        .filter(|(i, _)| !consumed[*i])
        .map(|(_, row)| row)
        .collect();

    (synthesized, remaining)
}

/// Groups characters into lines by baseline, then into styled spans.
pub fn group_lines(chars: &[CharBox]) -> Vec<Line> {
    if chars.is_empty() {
        return Vec::new();
    }

    // Paired with its position in the caller's own array before anything else
    // touches order. That position is what `build_line` sorts a row by, in
    // place of raw `x` — see the note there for why.
    let mut sorted: Vec<(usize, CharBox)> = chars.iter().copied().enumerate().collect();
    // Down the page first, then left to right within a line. The x here only
    // has to get characters into roughly the right row-local neighbourhood;
    // final intra-row order is decided in build_line.
    sorted.sort_by(|(_, a), (_, b)| {
        b.y.partial_cmp(&a.y)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.x.partial_cmp(&b.x).unwrap_or(std::cmp::Ordering::Equal))
    });

    // Body text sets its own rows first, and script-sized glyphs are placed
    // afterward against the finished result — see the comment below for why
    // this has to happen in two passes rather than one sequential scan.
    let body_ref = dominant_font_size(chars);
    let is_script_sized = |ch: &CharBox| ch.font_size < body_ref * SCRIPT_SIZE_RATIO;

    let mut rows: Vec<Vec<(usize, CharBox)>> = Vec::new();
    let mut scripts: Vec<(usize, CharBox)> = Vec::new();
    // The row's reference baseline, taken from the largest character in it so
    // far. Anchoring to the row's *first* character instead is wrong: a row
    // opened by something raised keeps measuring from that baseline instead
    // of the body text's, which is the larger and more representative of the
    // two. Only body text sets rows in this pass, so this can no longer be a
    // raised footnote marker or a script — see the second pass instead.
    let mut anchor: Option<CharBox> = None;

    for (index, ch) in sorted {
        if is_script_sized(&ch) {
            scripts.push((index, ch));
            continue;
        }
        let same_line = anchor.is_some_and(|a| baseline_tolerance_ok(&a, &ch));
        match rows.last_mut() {
            Some(row) if same_line => {
                if ch.font_size > anchor.map(|a| a.font_size).unwrap_or(0.0) {
                    anchor = Some(ch);
                }
                row.push((index, ch));
            }
            _ => {
                anchor = Some(ch);
                rows.push(vec![(index, ch)]);
            }
        }
    }

    // A script-sized glyph joins whichever row it sits horizontally nearest
    // to, not whichever row happened to be forming when it was scanned.
    //
    // A single running anchor cannot make this call correctly once a page has
    // more than one tall thing near each other: a fraction's numerator sits
    // on its own row, its own exponent one baseline-tolerance window above
    // that, and a big operator (∮, a radical) can easily sit closer in `y` to
    // that exponent than the exponent's own base character does — sorting the
    // exponent onto the operator's row instead of its numerator's, purely
    // because the operator was scanned first. Horizontal proximity is what a
    // reader actually uses to tell whose exponent something is, so it decides
    // here, gated by the same baseline-tolerance rule as everything else.
    if rows.is_empty() {
        // Nothing but scripts in the whole selection — a real document
        // should not produce this, but give every glyph a row rather than
        // silently dropping it.
        rows = scripts.into_iter().map(|c| vec![c]).collect();
    } else {
        // Largest (shallowest-nested) scripts first: a compact fraction's
        // numerator base ("e" in "e^{-bs}") is itself a script relative to
        // the body row, but its own exponent ("-bs") is a script relative to
        // *it* — smaller again, per the same convention TeX itself uses for
        // nested script sizes. Placing "e" before "-bs" gives "-bs" a real
        // sibling already sitting in the row by the time it's placed, which
        // the tolerance check below can then measure against directly.
        scripts.sort_by(|(_, a), (_, b)| b.font_size.partial_cmp(&a.font_size).unwrap_or(std::cmp::Ordering::Equal));

        for (index, ch) in scripts {
            let best_row = rows
                .iter()
                .enumerate()
                .filter_map(|(row_index, row)| {
                    // Whichever member already in the row sits closest to
                    // `ch` in `y`, not always the row's single tallest
                    // character — a nested exponent ("-bs") sits far enough
                    // above the row's own body text to fail tolerance
                    // against it, but well within tolerance of "e", the
                    // script that's already in the row and is `ch`'s actual
                    // base. Using only the tallest anchor made every row a
                    // flat, single-level thing; real nesting needs whichever
                    // member is actually `ch`'s neighbour.
                    let anchor = row.iter().min_by(|(_, a), (_, b)| {
                        (a.y - ch.y).abs().partial_cmp(&(b.y - ch.y).abs()).unwrap_or(std::cmp::Ordering::Equal)
                    })?;
                    let y_ok = baseline_tolerance_ok(&anchor.1, &ch)
                        || fits_below_big_operator(row, &ch);
                    y_ok.then(|| {
                        let distance = row
                            .iter()
                            .map(|(_, c)| horizontal_gap(c, &ch))
                            .fold(f32::INFINITY, f32::min);
                        (row_index, distance)
                    })
                })
                .min_by(|(_, a), (_, b)| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

            match best_row {
                Some((row_index, _)) => rows[row_index].push((index, ch)),
                // Nothing within baseline tolerance at all — its own row
                // rather than a forced, wrong attachment.
                None => rows.push(vec![(index, ch)]),
            }
        }
        // The second pass appends by best match, not by position, so a script
        // that opened its own new row may now sit out of top-to-bottom order.
        rows.sort_by(|a, b| {
            let y_of = |row: &[(usize, CharBox)]| {
                row.iter().map(|(_, c)| c.y).fold(f32::MIN, f32::max)
            };
            y_of(b).partial_cmp(&y_of(a)).unwrap_or(std::cmp::Ordering::Equal)
        });
    }

    merge_extensible_rows(&mut rows);
    let (mut lines, rows) = reconstruct_cases(rows);
    let (matrix_lines, rows) = reconstruct_matrices(rows);
    lines.extend(matrix_lines);
    let (frac_lines, rows) = reconstruct_fraction_sums(rows);
    lines.extend(frac_lines);
    let (table_lines, rows) = reconstruct_tables(rows);
    lines.extend(table_lines);
    lines.extend(rows.into_iter().map(build_line));
    lines.sort_by(|a, b| b.y.partial_cmp(&a.y).unwrap_or(std::cmp::Ordering::Equal));
    lines
}

/// Recognizes a row's full rendered text as nothing but a page-number
/// shape: a bare number ("3"), a dashed number ("- 3 -"), a labelled
/// number ("Seite 4", "Page 3", "S. 4", "p. 4"), a number/total pair
/// ("3/10", "3 von 10", "3 of 10"), or a labelled pair ("Seite 3 von 10",
/// "Page 3 of 10"). Deliberately hand-written, not `regex` — this file
/// stays free of it, following `list_marker`/`is_cases_brace`'s existing
/// style of small manual parsers for a fixed set of shapes.
///
/// Whole-row match only: "1. Aufgabe" fails this (its own trailing content
/// after the number rules it out) the same way a genuine page number never
/// carries a trailing word — this is what keeps a numbered list item or
/// exercise heading from ever being mistaken for a footer.
fn looks_like_page_number(text: &str) -> bool {
    let text = text.trim();
    if text.is_empty() {
        return false;
    }

    if let Some(inner) = strip_dashes(text) {
        return is_bare_number(inner.trim());
    }

    let tokens: Vec<&str> = text.split_whitespace().collect();
    match tokens.as_slice() {
        [only] => is_bare_number(only) || is_number_pair_no_space(only),
        [prefix, number] if is_page_word(prefix) => is_bare_number(number),
        [number, sep, total] => is_bare_number(number) && is_pair_separator(sep) && is_bare_number(total),
        [prefix, number, sep, total] => {
            is_page_word(prefix) && is_bare_number(number) && is_pair_separator(sep) && is_bare_number(total)
        }
        _ => false,
    }
}

/// "- 3 -" / "– 3 –" / "— 3 —" — the leading and trailing character must
/// both be a dash variant, with something between them, or a genuine
/// hyphenated word or a maths minus sign would match on either end alone.
fn strip_dashes(text: &str) -> Option<&str> {
    const DASHES: [char; 3] = ['-', '\u{2013}', '\u{2014}'];
    let first = text.chars().next()?;
    let last = text.chars().last()?;
    if text.chars().count() > 2 && DASHES.contains(&first) && DASHES.contains(&last) {
        Some(&text[first.len_utf8()..text.len() - last.len_utf8()])
    } else {
        None
    }
}

/// A page number is never more than 4 digits (this app's PDFs are lecture
/// sheets, not book-length documents) — bounding the length keeps a stray
/// long numeral (a formula's constant, a year in prose) from ever reading
/// as a page number on digit-shape alone.
fn is_bare_number(s: &str) -> bool {
    !s.is_empty() && s.len() <= 4 && s.chars().all(|c| c.is_ascii_digit())
}

/// "3/10" as a single token (no spaces around the slash).
fn is_number_pair_no_space(s: &str) -> bool {
    match s.split_once('/') {
        Some((a, b)) => is_bare_number(a) && is_bare_number(b),
        None => false,
    }
}

fn is_page_word(s: &str) -> bool {
    matches!(s.to_lowercase().trim_end_matches('.'), "seite" | "page" | "s" | "p")
}

fn is_pair_separator(s: &str) -> bool {
    matches!(s.to_lowercase().as_str(), "von" | "of" | "/")
}

/// Folds a row made only of extensible glyphs into the row beneath it.
///
/// A radical sign is set on its own baseline, above the expression it covers, so
/// `√(x² + y²)` arrives as one row holding nothing but the radical and another
/// holding the radicand. Left apart, the radical has no radicand to take and
/// renders as an empty `\sqrt{}` next to a stray expression. Merged, the two sit
/// in one row where the radical precedes its contents in reading order.
fn merge_extensible_rows(rows: &mut Vec<Vec<(usize, CharBox)>>) {
    let mut index = 0;
    while index + 1 < rows.len() {
        let printing: Vec<&CharBox> = rows[index]
            .iter()
            .map(|(_, c)| c)
            .filter(|c| !c.ch.is_whitespace())
            .collect();
        // Radicals specifically, not "any row that happens to be entirely
        // Extensible glyphs" — a lone `∮` is also a one-character Extensible
        // row, but it does not take the row beneath it as an argument the way
        // a radical takes its radicand. Merging it in anyway corrupts the
        // numerator it lands on: `to_latex` measures a region's baseline from
        // the first full-size character in stream order, and `∮` is drawn
        // before the numerator it now sits in front of, so every exponent in
        // that numerator reads as a subscript instead.
        let radical_only = !printing.is_empty() && printing.iter().all(|c| latex::is_radical(c));

        if radical_only {
            let row = std::mem::take(&mut rows[index]);
            rows[index + 1].extend(row);
            rows.remove(index);
            continue;
        }
        index += 1;
    }
}

/// A displaced accent's real base letter is still always its closest
/// neighbour by x, even when a producer defers drawing it until long after
/// the letter it sits over rather than right next to it. Found on
/// Analysis_2_Blatt1_2026.pdf: the diaeresis for "Übungsblatt" arrives
/// *eleven* characters later in the stream, immediately before the next
/// line's own "1." list marker — but its x still sits within 2pt of the
/// "U" it belongs to. `build_line`'s own combining logic already gets this
/// right the moment the two land next to each other in stream order (see
/// `push_latex`'s sibling below); this only has to handle the case where
/// they don't, by physically moving the accent there first, so that logic
/// never has to know the difference. Deliberately leaves alone any accent
/// whose nearest match is already an immediate neighbour — the common case,
/// already handled, and touching it risks undoing the forward-attach
/// direction (an accent already sitting *before* its letter must stay
/// there, not get pushed after it).
fn relocate_stray_accents(row: Vec<CharBox>) -> Vec<CharBox> {
    // Far enough that this is clearly a different letter's own position,
    // not a font's ordinary accent-to-base kerning.
    const MAX_RELOCATE_DISTANCE: f32 = 3.0;

    let relocations: Vec<(usize, usize)> = row
        .iter()
        .enumerate()
        .filter(|(_, ch)| combining_form(ch.ch).is_some())
        .filter_map(|(i, ch)| {
            let (j, target) = row
                .iter()
                .enumerate()
                .filter(|(j, c)| *j != i && combining_form(c.ch).is_none())
                .min_by(|(_, a), (_, b)| {
                    (ch.x - a.x)
                        .abs()
                        .partial_cmp(&(ch.x - b.x).abs())
                        .unwrap_or(std::cmp::Ordering::Equal)
                })?;
            let already_adjacent = j + 1 == i || i + 1 == j;
            (!already_adjacent && (target.x - ch.x).abs() <= MAX_RELOCATE_DISTANCE)
                .then_some((i, j))
        })
        .collect();

    if relocations.is_empty() {
        return row;
    }

    let mut out = Vec::with_capacity(row.len());
    for (i, ch) in row.iter().enumerate() {
        if relocations.iter().any(|(accent_i, _)| *accent_i == i) {
            continue; // placed right after its target below instead
        }
        out.push(*ch);
        for (accent_i, target_i) in &relocations {
            if *target_i == i {
                out.push(row[*accent_i]);
            }
        }
    }
    out
}

fn build_line(mut row: Vec<(usize, CharBox)>) -> Line {
    // Ordered by position in the page's own extraction stream, not by `x`.
    // `x` is right for everything geometric — gaps, scripts, region bounds —
    // but a PDF can hand back a generated space (or any other synthetic
    // filler) with a coordinate that makes no visual sense: found on a real
    // document where a word-gap space's x landed *inside* the following
    // letter's advance box, so an x-sort read "wird jeweils" as "wirdj
    // eweils". The stream position pdfium emitted it at never lies, because
    // it reflects the order the content was actually authored in.
    row.sort_by_key(|(index, _)| *index);
    let row: Vec<CharBox> = row.into_iter().map(|(_, c)| c).collect();
    let row = relocate_stray_accents(row);

    let mut sizes: Vec<f32> = row.iter().map(|c| c.font_size).collect();
    let font_size = median(&mut sizes);

    let printing = row.iter().filter(|c| !c.ch.is_whitespace()).count();
    let fixed = row
        .iter()
        .filter(|c| !c.ch.is_whitespace() && c.fixed_pitch)
        .count();
    let fixed_pitch = printing > 0 && fixed * 2 > printing;

    let runs = maths_runs(&row, font_size);
    let mut content: Vec<Inline> = Vec::new();
    let mut spans: Vec<Span> = Vec::new();
    let mut previous_end: Option<f32> = None;
    let mut index = 0usize;
    let mut ends_hyphenated = false;
    // The x of the last real (non-accent) character emitted, kept alongside
    // `previous_end` (its right edge) because the accent-attachment decision
    // below needs the character's own position, not where it ends.
    let mut previous_char_x: Option<f32> = None;
    // An accent whose base letter turned out to be the *next* character, not
    // the previous one — see the comment where it is set. Flushed onto the
    // very next real character pushed, or left standalone if the row ends
    // first.
    let mut pending_accent: Option<char> = None;

    while index < row.len() {
        // A maths region is opaque: the text layer cannot express what it says,
        // so the characters inside it are replaced wholesale by a crop.
        if let Some(run) = runs.iter().find(|r| r.0 == index) {
            let latex = latex::to_latex(&row[run.0..run.1]);
            if !latex.is_empty() {
                // The word gap before an equation is often only a cursor jump,
                // and the text path's space synthesis does not run here — so
                // "Funktion f(x)" came out as "Funktion![](…)".
                let needs_space = previous_end
                    .is_some_and(|end| row[run.0].x - end > font_size.max(1.0) * SPACE_GAP)
                    && !spans
                        .last()
                        .is_some_and(|s| s.text.ends_with(char::is_whitespace));
                if needs_space {
                    push_char(&mut spans, ' ', false, false);
                }
                flush_spans(&mut spans, &mut content);
                content.push(Inline::Maths(latex));
            }
            previous_end = row[run.0..run.1].last().map(|c| c.x + c.width);
            index = run.1;
            continue;
        }

        let ch = &row[index];
        index += 1;

        // The break itself is not content: the paragraph is about to be
        // reflowed, which puts the word back together.
        if ch.ch == SOFT_HYPHEN {
            ends_hyphenated = true;
            continue;
        }

        let after_space = spans
            .last()
            .is_some_and(|s| s.text.ends_with(char::is_whitespace));

        // Word separation is decided by geometry, so a run of space glyphs
        // (PDFs emit plenty, several of them zero-width) must not become a run
        // of spaces. Leading whitespace is the exception: it is indentation,
        // and a code block's indentation is the only structure it has.
        // previous_end is set by printing characters alone, so its absence
        // means the run being collapsed is still the leading one.
        if ch.ch.is_whitespace() {
            if previous_end.is_none() || !after_space {
                push_char(&mut spans, ' ', false, false);
            }
            continue;
        }

        // An accent glyph shares its letter's x position rather than
        // reliably sorting to either side of it — one real document draws
        // "u", then the diaeresis, then "r" (accent follows its vowel);
        // another draws "M", then the diaeresis, then "o" (accent precedes
        // it). Stream order alone cannot tell these apart, so whichever
        // neighbour — the letter just emitted, or the one about to be — sits
        // closer in x is the one it combines with.
        if let Some(combining) = combining_form(ch.ch) {
            let backward_dist = previous_char_x.map(|x| (ch.x - x).abs());
            let forward = row.get(index).filter(|n| !n.ch.is_whitespace() && combining_form(n.ch).is_none());
            let forward_dist = forward.map(|n| (ch.x - n.x).abs());

            let attach_forward = match (backward_dist, forward_dist) {
                (Some(back), Some(fwd)) => fwd < back,
                (None, Some(_)) => true,
                _ => false,
            };

            if attach_forward {
                pending_accent = Some(combining);
                continue;
            }

            if !after_space && !spans.is_empty() {
                push_char(&mut spans, combining, ch.bold, ch.italic);
                // Still advance the cursor. An accent usually overlays its
                // letter and takes no width, but where it does occupy a slot,
                // leaving the cursor behind makes the next letter look like it
                // sits across a word gap.
                previous_end = Some(previous_end.unwrap_or(ch.x).max(ch.x + ch.width));
                continue;
            }
        }

        // A cursor jump wide enough to be a word break, with no space glyph.
        let gap_is_a_space = previous_end
            .is_some_and(|end| ch.x - end > font_size.max(1.0) * SPACE_GAP)
            && !after_space;

        if gap_is_a_space {
            push_char(&mut spans, ' ', false, false);
        }
        push_char(&mut spans, ch.ch, ch.bold, ch.italic);
        previous_end = Some(ch.x + ch.width);
        previous_char_x = Some(ch.x);
        if let Some(combining) = pending_accent.take() {
            push_char(&mut spans, combining, ch.bold, ch.italic);
        }
    }

    // The row ended before the accent's chosen base letter arrived — a
    // maths run or a line break intervened. Emit it standalone rather than
    // silently dropping it.
    if let Some(combining) = pending_accent.take() {
        push_char(&mut spans, combining, false, false);
    }

    flush_spans(&mut spans, &mut content);

    let is_display_maths = is_mostly_maths(&content);

    let right = row
        .iter()
        .map(|c| c.x + c.width)
        .fold(f32::MIN, f32::max);

    Line {
        x: row.first().map(|c| c.x).unwrap_or_default(),
        right,
        y: row.first().map(|c| c.y).unwrap_or_default(),
        content,
        font_size,
        fixed_pitch,
        is_display_maths,
        ends_hyphenated,
    }
}

/// Moves the pending text spans into the line, composing accents back onto
/// their letters on the way out.
fn flush_spans(spans: &mut Vec<Span>, content: &mut Vec<Inline>) {
    for mut span in spans.drain(..) {
        // Composes each "u + combining diaeresis" into a single "ü".
        span.text = span.text.nfc().collect();
        if !span.text.is_empty() {
            content.push(Inline::Text(span));
        }
    }
}

/// Whether `row[start..]` begins with a known operator name (`cos`, `log`,
/// …), case-insensitively. Comes back with the word's length in characters.
///
/// Matches the *maximal* run of consecutive upright-text-family letters
/// starting here, not a fixed-length prefix — checking only "is the next
/// character non-alphabetic" mistakes "cos" for a match inside "cosh", but
/// also, wrongly, rejects a real match: TeX's own inter-atom spacing between
/// an operator and a parenthesis-less argument can be zero, so "log" sitting
/// directly against the variable "n" with no space glyph between them at
/// all is legitimate and has to match. What actually distinguishes the two
/// is font family, not adjacency — `n` is `Family::Italic`, the
/// maths-variable face, not a continuation of `log`'s own upright word, so
/// the run correctly stops there regardless of the missing space; "cosh"'s
/// `h` is the *same* family as "cos", so the run correctly continues
/// through it and (being itself a known name) still matches, just longer.
fn operator_word_at(row: &[CharBox], start: usize) -> Option<usize> {
    let run_len = row[start..]
        .iter()
        .take_while(|c| c.ch.is_alphabetic() && c.family == Family::Text)
        .count();
    let candidate: String = row[start..start + run_len].iter().map(|c| c.ch).collect();
    latex::KNOWN_OPERATOR_NAMES
        .iter()
        .any(|word| candidate.eq_ignore_ascii_case(word))
        .then_some(run_len)
}

/// The backward-scanning counterpart of [`operator_word_at`]: whether
/// `row[..end]` ends with a known operator name, matched against the
/// maximal same-family letter run ending here for the same reason. Comes
/// back with the word's start index.
fn operator_word_ending_at(row: &[CharBox], end: usize) -> Option<usize> {
    let run_len = row[..end]
        .iter()
        .rev()
        .take_while(|c| c.ch.is_alphabetic() && c.family == Family::Text)
        .count();
    let start = end - run_len;
    let candidate: String = row[start..end].iter().map(|c| c.ch).collect();
    latex::KNOWN_OPERATOR_NAMES
        .iter()
        .any(|word| candidate.eq_ignore_ascii_case(word))
        .then_some(start)
}

/// Whether every alphabetic run strictly between `from` and `to` (both
/// indices into `row`) is a whole, known operator name — i.e. whether the
/// stretch between two nearby maths seeds is safe to fuse into one run.
///
/// Punctuation, digits and operators impose no restriction here (`"f : R"`
/// bridges its colon this way, same as it always has); only *letters* are
/// gated, and only by the same fixed, known list `maths_runs`'s
/// outward-growth uses. Without this, two single-letter maths variables
/// separated only by a short, ordinary word — "paths from `s` to `t`" — sit
/// close enough in `x` for `MATHS_BRIDGE_EMS` to fuse them into one run with
/// "to" trapped inside it, rendering `$s \mathrm{to} t$` instead of leaving
/// "to" as the prose it is.
fn bridge_has_only_known_words(row: &[CharBox], from: usize, to: usize) -> bool {
    let mut index = from;
    while index < to {
        if row[index].ch.is_alphabetic() {
            match operator_word_at(row, index) {
                Some(len) if index + len <= to => index += len,
                _ => return false,
            }
        } else {
            index += 1;
        }
    }
    true
}

/// Index ranges `[start, end)` over an x-sorted row that should be cropped as
/// mathematics.
///
/// Maths glyphs are interleaved with ordinary ones — `f : R² → R` puts the
/// colon and the exponent in the body font — so a run absorbs whatever sits
/// between two maths characters that are close together. The threshold is
/// generous enough to bridge a `:` or a function name, and tight enough that
/// the prose on either side of an equation stays prose.
fn maths_runs(row: &[CharBox], font_size: f32) -> Vec<(usize, usize)> {
    let em = font_size.max(1.0);
    let seeds: Vec<usize> = row
        .iter()
        .enumerate()
        .filter(|(_, c)| c.is_maths() && !c.ch.is_whitespace())
        .map(|(i, _)| i)
        .collect();
    if seeds.is_empty() {
        return Vec::new();
    }

    let mut runs: Vec<(usize, usize)> = Vec::new();
    for index in seeds {
        match runs.last_mut() {
            Some(run)
                if row[index].x - row[run.1 - 1].x <= em * MATHS_BRIDGE_EMS
                    && bridge_has_only_known_words(row, run.1, index) =>
            {
                run.1 = index + 1
            }
            _ => runs.push((index, index + 1)),
        }
    }

    // Only part of an equation is set in a maths face. Computer Modern takes
    // the digits, parentheses, commas and the "=" from the body font, so a
    // region seeded on the maths glyphs alone stops short: "T3(x, y)" loses its
    // closing bracket and "(x0, y0) = (0, 0)" shatters into pieces with stray
    // punctuation between them. Growing outward over non-letters collects them.
    // Letters stop the growth, which is what keeps the surrounding prose out.
    let gap_ok = |left: usize, right: usize| {
        row[right].x - (row[left].x + row[left].width) <= em
    };
    for run in &mut runs {
        while run.0 > 0 && gap_ok(run.0 - 1, run.0) {
            if row[run.0 - 1].ch.is_alphabetic() {
                // An upright word is normally where an equation ends — but
                // "cos" in "cos(z)" is a known operator name, set upright,
                // sitting right against the maths that follows it. Absorb
                // the whole word in one step rather than stopping at its
                // first letter, so long as spelling it out backward from
                // here matches a name on the fixed, known list; anything
                // else (ordinary prose ending right before the equation)
                // still stops the growth exactly as before.
                let Some(word_start) = operator_word_ending_at(row, run.0) else {
                    break;
                };
                if word_start > 0 && !gap_ok(word_start - 1, word_start) {
                    break;
                }
                run.0 = word_start;
                continue;
            }
            // A ')' is never legitimate to pick up growing backward: an
            // equation opens a paren before its content and closes it after,
            // so backward growth only ever needs a '(' or an operator/digit.
            // A ')' encountered scanning backward is always the end of some
            // other, already-closed bracketed group — on a real sheet, an
            // enumeration label ("(a)") sitting right before a lone mathcal
            // variable with no source-level space wide enough to stop the
            // gap check, absorbing its closing paren and reading "(a$) C$"
            // instead of "(a) $\mathcal{C}$".
            if row[run.0 - 1].ch == ')' {
                break;
            }
            run.0 -= 1;
        }
        while run.1 < row.len() && gap_ok(run.1 - 1, run.1) {
            if row[run.1].ch.is_alphabetic() {
                // The forward-growth counterpart of the operator-name case
                // above — "log" in "O(m log n)".
                let Some(word_len) = operator_word_at(row, run.1) else {
                    break;
                };
                let word_end = run.1 + word_len;
                if word_end < row.len() && !gap_ok(word_end - 1, word_end) {
                    // The word butts against real prose on its far side —
                    // matching the spelling alone isn't enough evidence.
                    break;
                }
                run.1 = word_end;
                continue;
            }
            // A footnote marker is a raised, reduced digit glued onto the
            // sentence-ending punctuation right after an equation — the same
            // geometry a genuine exponent has, except for what it follows. An
            // exponent is never preceded by terminal punctuation, so growth
            // stops there rather than pulling a footnote call into the maths.
            let after_terminal =
                matches!(row[run.1 - 1].ch, '.' | ',' | ';' | ':' | '!' | '?');
            let candidate = &row[run.1];
            let is_script = candidate.font_size < font_size * SCRIPT_SIZE_RATIO
                && candidate.y > row[run.1 - 1].y + font_size * 0.1;
            if after_terminal && is_script {
                break;
            }
            run.1 += 1;
        }
        // Whitespace at either edge belongs to the sentence, not the equation:
        // it would crop as blank pixels and, worse, take the space that
        // separates the image from the surrounding words.
        while run.1 > run.0 + 1 && row[run.1 - 1].ch.is_whitespace() {
            run.1 -= 1;
        }
        while run.0 + 1 < run.1 && row[run.0].ch.is_whitespace() {
            run.0 += 1;
        }
    }

    // Growing outward can make neighbouring regions meet — but "meet" has to
    // mean physically adjacent, not merely index-adjacent. Two regions whose
    // own growth independently stopped at consecutive indices can still sit
    // far apart on the page, because that is *why* growth stopped where it
    // did: the gap between them was too wide to bridge. A baseline row on
    // either side of a fraction takes exactly this shape — "f(z) =" and "."
    // land on consecutive indices with nothing between them on this row at
    // all, because the numerator and denominator sit on different rows
    // entirely, 100pt away. Treating index-adjacency alone as "meet" merged
    // them into one region spanning the empty column where the fraction
    // itself belongs.
    runs.dedup_by(|later, earlier| {
        if later.0 < earlier.1 {
            // Genuine index overlap, not merely adjacency — always merge.
            earlier.1 = earlier.1.max(later.1);
            return true;
        }
        if later.0 > earlier.1 {
            return false;
        }
        // Consecutive array indices with nothing between them — which says
        // nothing about the page distance between the characters on either
        // side. That's the check that actually decides "meet".
        let last = &row[earlier.1 - 1];
        let touches = row[later.0].x - (last.x + last.width) <= em;
        if touches {
            earlier.1 = earlier.1.max(later.1);
        }
        touches
    });

    runs
}

/// Whether a maths region actually has to become an image.
///
fn push_char(spans: &mut Vec<Span>, ch: char, bold: bool, italic: bool) {
    match spans.last_mut() {
        Some(last) if last.bold == bold && last.italic == italic => last.text.push(ch),
        _ => spans.push(Span {
            text: ch.to_string(),
            bold,
            italic,
        }),
    }
}

fn body_size_of(lines: &[&Line]) -> f32 {
    let mut weighted: Vec<(f32, usize)> = Vec::new();
    for line in lines {
        let count = line.text().chars().filter(|c| !c.is_whitespace()).count();
        if count == 0 {
            continue;
        }
        match weighted
            .iter_mut()
            .find(|(size, _)| (*size - line.font_size).abs() < 0.51)
        {
            Some((_, total)) => *total += count,
            None => weighted.push((line.font_size, count)),
        }
    }
    weighted
        .into_iter()
        .max_by_key(|(_, count)| *count)
        .map(|(size, _)| size)
        .unwrap_or(12.0)
}

/// The document's body text size — the size the most characters are set in.
/// Weighted by character count rather than by line count, so a page of short
/// headings cannot outvote the prose.
pub fn body_font_size(lines: &[Line]) -> f32 {
    body_size_of(&lines.iter().collect::<Vec<_>>())
}

fn heading_level(font_size: f32, body: f32) -> Option<u8> {
    if body <= 0.0 {
        return None;
    }
    let ratio = font_size / body;
    if ratio < HEADING_RATIO {
        return None;
    }
    Some(if ratio >= 1.6 {
        1
    } else if ratio >= 1.3 {
        2
    } else {
        3
    })
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Marker {
    pub ordered: bool,
    /// The source's own number, kept so "Aufgabe 3" stays 3. Markdown would
    /// renumber from 1, which on an exercise sheet silently renames the
    /// exercises.
    pub number: Option<u32>,
    /// Length in `char`s — the caller strips the prefix by character, and a
    /// bullet glyph is multi-byte.
    pub len: usize,
}

/// A leading list marker, if the line has one.
fn list_marker(text: &str) -> Option<Marker> {
    let chars: Vec<char> = text.chars().collect();
    let leading = chars.iter().take_while(|c| c.is_whitespace()).count();
    let rest = &chars[leading..];
    let first = *rest.first()?;

    if matches!(first, '•' | '●' | '▪' | '◦' | '‣' | '·' | '−' | '–' | '-' | '*') {
        // A bullet is only a bullet when something separates it from the text,
        // or "-3 degrees" and "*emphasis*" become list items.
        return rest.get(1).filter(|c| c.is_whitespace()).map(|_| Marker {
            ordered: false,
            number: None,
            len: leading + 2,
        });
    }

    // "1." / "1)"
    if first.is_ascii_digit() {
        let digits = rest.iter().take_while(|c| c.is_ascii_digit()).count();
        if matches!(rest.get(digits), Some('.') | Some(')'))
            && rest.get(digits + 1).is_some_and(|c| c.is_whitespace())
        {
            let number: String = rest[..digits].iter().collect();
            return Some(Marker {
                ordered: true,
                number: number.parse().ok(),
                len: leading + digits + 2,
            });
        }
    }

    // "(a)" / "(iv)" — how exercise sheets label sub-parts, and common enough
    // in this document class to be worth recognising.
    if first == '(' {
        let inner = rest
            .iter()
            .skip(1)
            .take_while(|c| c.is_ascii_alphanumeric())
            .count();
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

/// Drops the first `count` characters of text, stepping over maths regions,
/// which have no characters to give.
fn strip_leading_chars(content: &[Inline], mut count: usize) -> Vec<Inline> {
    let mut out = Vec::new();
    for inline in content {
        let Inline::Text(span) = inline else {
            out.push(inline.clone());
            continue;
        };
        if count == 0 {
            out.push(inline.clone());
            continue;
        }
        let chars: Vec<char> = span.text.chars().collect();
        if chars.len() <= count {
            count -= chars.len();
            continue;
        }
        out.push(Inline::Text(Span {
            text: chars[count..].iter().collect(),
            bold: span.bold,
            italic: span.italic,
        }));
        count = 0;
    }
    out
}

fn trim_content(content: &[Inline]) -> Vec<Inline> {
    let mut out: Vec<Inline> = content.to_vec();
    if let Some(Inline::Text(first)) = out.first_mut() {
        first.text = first.text.trim_start().to_string();
    }
    if let Some(Inline::Text(last)) = out.last_mut() {
        last.text = last.text.trim_end().to_string();
    }
    out.retain(|i| !matches!(i, Inline::Text(s) if s.text.is_empty()));
    out
}

/// Merges several lines into one flowing run, so a paragraph broken across
/// three PDF lines becomes one Markdown paragraph.
fn join_lines(lines: &[&Line]) -> Vec<Inline> {
    let mut out: Vec<Inline> = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        // The line before this one ended mid-word, so the halves close up.
        // Suppressing the joining space is not enough: that line also carries a
        // trailing space of its own, at the very line end where it means
        // nothing.
        let resumes_word = index > 0 && lines[index - 1].ends_hyphenated;
        if resumes_word {
            if let Some(Inline::Text(last)) = out.last_mut() {
                last.text = last.text.trim_end().to_string();
            }
        }

        let needs_space = index > 0
            && !resumes_word
            && !matches!(out.last(), Some(Inline::Text(s)) if s.text.ends_with(' '))
            && !out.is_empty();
        if needs_space {
            push_text(&mut out, ' ', false, false);
        }
        for inline in &line.content {
            match inline {
                Inline::Maths(latex) => out.push(Inline::Maths(latex.clone())),
                Inline::Text(span) => {
                    for ch in span.text.chars() {
                        push_text(&mut out, ch, span.bold, span.italic);
                    }
                }
                // Unreachable in practice: `classify` diverts a table-row or
                // image-ref line before either ever reaches `join_lines`
                // (only Heading/List/Prose-kind lines do). Kept as a no-op
                // rather than a panic — see CLAUDE.md on trusting internal
                // invariants without crashing if one is ever violated.
                Inline::TableRow(_, _) | Inline::ImageRef(_, _) => {}
            }
        }
    }
    // Run only now, after hyphenated halves have rejoined into one span above
    // (`resumes_word`): a word pdfium split across a line wrap — e.g.
    // "di\u{FFFD}eren" / "zierbaren)" either side of a soft hyphen — needs
    // its full spelling to resolve a ligature or quote correctly, and isn't
    // whole yet at the per-row level `flush_spans` runs at.
    for inline in &mut out {
        if let Inline::Text(span) = inline {
            span.text = super::ligatures::disambiguate(&span.text);
        }
    }
    trim_content(&out)
}

fn push_text(content: &mut Vec<Inline>, ch: char, bold: bool, italic: bool) {
    match content.last_mut() {
        Some(Inline::Text(last)) if last.bold == bold && last.italic == italic => {
            last.text.push(ch)
        }
        _ => content.push(Inline::Text(Span {
            text: ch.to_string(),
            bold,
            italic,
        })),
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum LineKind {
    Prose,
    Code,
    Heading(u8),
    List(bool, usize),
    MathsDisplay,
    Table,
    Image,
}

fn classify(line: &Line, body: f32, left_margin: f32) -> LineKind {
    // Checked before everything else, for the same reason as the
    // display-maths check just below: a table row's own font size or
    // leading whitespace could otherwise misread as a heading or list.
    if matches!(line.content.as_slice(), [Inline::TableRow(_, _)]) {
        return LineKind::Table;
    }
    if matches!(line.content.as_slice(), [Inline::ImageRef(_, _)]) {
        return LineKind::Image;
    }
    // Checked before everything else: a display equation is centred and set in
    // maths fonts, so heading and list detection would both misread it.
    if line.is_display_maths {
        return LineKind::MathsDisplay;
    }
    if line.fixed_pitch {
        return LineKind::Code;
    }
    if let Some(level) = heading_level(line.font_size, body) {
        return LineKind::Heading(level);
    }
    if let Some(marker) = list_marker(&line.text()) {
        // Indent past the page's left margin, in ems, is a stable proxy for
        // nesting depth across font sizes.
        let ems = (line.x - left_margin) / body.max(1.0);
        let depth = (ems / LIST_INDENT_EMS).round().max(0.0) as usize;
        return LineKind::List(marker.ordered, depth);
    }
    LineKind::Prose
}

/// Groups lines into blocks, splitting on vertical gaps and on changes of kind.
pub fn group_blocks(lines: &[Line]) -> Vec<Block> {
    let lines: Vec<&Line> = lines.iter().filter(|l| !l.is_blank()).collect();
    if lines.is_empty() {
        return Vec::new();
    }

    let body = body_size_of(&lines);
    let left_margin = lines.iter().map(|l| l.x).fold(f32::INFINITY, f32::min);

    let mut gaps: Vec<f32> = lines
        .windows(2)
        .map(|pair| (pair[0].y - pair[1].y).abs())
        .collect();
    let typical_gap = median(&mut gaps);

    let mut blocks: Vec<Block> = Vec::new();
    let mut current: Vec<&Line> = Vec::new();
    let mut current_kind = classify(lines[0], body, left_margin);

    for (index, line) in lines.iter().enumerate() {
        let kind = classify(line, body, left_margin);
        // A table row that isn't the first row of its own detected table is
        // a continuation of whatever table came right before it, by
        // construction — `reconstruct_tables` already decided that at the
        // geometry level, and is the source of truth for where a table
        // starts and ends, not a gap measured after the fact. That matters
        // because a wrapped cell's continuation line folds into its anchor
        // row's own synthesized Line rather than becoming its own `Line`
        // (see `reconstruct_tables`), so the gap from one table row to the
        // next is legitimately irregular — exactly the row-height variation
        // the vertical-gap heuristic below would otherwise misread as a
        // table boundary.
        let starts_new_table = matches!(line.content.as_slice(), [Inline::TableRow(_, true)]);
        let continues_same_table = kind == LineKind::Table && !starts_new_table;
        let gap_break = !continues_same_table
            && index > 0
            && typical_gap > 0.0
            && (lines[index - 1].y - line.y).abs() > typical_gap * BLOCK_GAP_RATIO;

        // An unmarked line indented past the item it follows is that item's
        // second line, not a new paragraph.
        let continues_item = matches!(current_kind, LineKind::List(_, _))
            && kind == LineKind::Prose
            && !gap_break
            && current.first().is_some_and(|first| line.x > first.x + 1.0);

        // A list marker always opens a new item, nothing accumulates onto a
        // heading, a table row that starts a new table always opens its own
        // block, and every image always opens its own block too — an image
        // never merges with a neighbor the way a table row's continuation
        // can, so there is no equivalent "still the same one" flag to check.
        let opens_block = matches!(kind, LineKind::List(_, _))
            || matches!(current_kind, LineKind::Heading(_))
            || starts_new_table
            || kind == LineKind::Image;
        let kind_break = opens_block || (kind != current_kind && !continues_item);

        if !current.is_empty() && (gap_break || kind_break) {
            blocks.push(finish_block(&current, current_kind));
            current.clear();
        }
        if current.is_empty() {
            current_kind = kind;
        }
        current.push(line);
    }
    if !current.is_empty() {
        blocks.push(finish_block(&current, current_kind));
    }

    blocks
}

fn finish_block(lines: &[&Line], kind: LineKind) -> Block {
    match kind {
        LineKind::MathsDisplay => Block::MathsDisplay {
            // One display equation can span several baselines — a radical sign
            // or a fraction bar is set on its own row — so the rows' pieces
            // concatenate into a single expression rather than becoming
            // separate equations. `is_mostly_maths` now tolerates a short
            // connector word ("mit", "für") inside an otherwise
            // maths-dominated line, so that text is wrapped in `\text{}` —
            // LaTeX's own way to embed prose inside display math — rather
            // than being dropped the way it used to be.
            latex: lines
                .iter()
                .flat_map(|l| l.content.iter())
                .filter_map(|i| match i {
                    Inline::Maths(latex) => Some(latex.clone()),
                    Inline::Text(span) if !span.text.trim().is_empty() => {
                        Some(format!("\\text{{{}}}", escape_text_for_maths(&span.text)))
                    }
                    Inline::Text(_) | Inline::TableRow(_, _) | Inline::ImageRef(_, _) => None,
                })
                .collect::<Vec<_>>()
                .join(" "),
        },
        LineKind::Heading(level) => Block::Heading {
            level,
            content: join_lines(lines),
        },
        // Code keeps its own line breaks and indentation — reflowing it would
        // destroy the only structure it has.
        LineKind::Code => Block::Code {
            text: lines
                .iter()
                .map(|l| l.text().trim_end().to_string())
                .collect::<Vec<_>>()
                .join("\n"),
        },
        LineKind::List(ordered, depth) => {
            let marker = list_marker(&lines[0].text());
            // Declared before `refs` so it outlives the reference to it.
            let first = Line {
                content: strip_leading_chars(
                    &lines[0].content,
                    marker.map(|m| m.len).unwrap_or(0),
                ),
                ..lines[0].clone()
            };
            let mut refs: Vec<&Line> = vec![&first];
            refs.extend(lines.iter().skip(1).copied());
            Block::ListItem {
                ordered,
                number: marker.and_then(|m| m.number),
                depth,
                content: join_lines(&refs),
            }
        }
        LineKind::Prose => Block::Paragraph {
            content: join_lines(lines),
        },
        // Every line here was classified `Table` by `classify`, so its
        // content is always `[Inline::TableRow(cells)]` by construction —
        // `filter_map` rather than an unwrap/panic if that invariant is
        // ever violated, per CLAUDE.md.
        LineKind::Table => Block::Table {
            rows: lines
                .iter()
                .filter_map(|l| match l.content.as_slice() {
                    [Inline::TableRow(cells, _)] => Some(cells.clone()),
                    _ => None,
                })
                .collect(),
        },
        // `opens_block` guarantees exactly one line here whenever kind is
        // Image — every image-kind line forces its own block, never
        // accumulating with a neighbor.
        LineKind::Image => {
            let (placeholder, alt) = lines
                .first()
                .and_then(|l| match l.content.as_slice() {
                    [Inline::ImageRef(placeholder, alt)] => Some((placeholder.clone(), alt.clone())),
                    _ => None,
                })
                .unwrap_or_default();
            Block::Image { placeholder, alt }
        }
    }
}

/// GFM's pipe-table syntax uses `|` to separate cells, so a literal `|`
/// inside a cell's own content has to be escaped or it would corrupt that
/// row's column structure. Nothing else in this pipeline escapes markdown
/// syntax — every other block either renders characters safe to emit as-is,
/// or generates its own syntax (list markers, headings) rather than passing
/// arbitrary content through a character that means something structural.
/// Scoped to table cells because tables are the one place this pipeline's
/// own choice of output syntax collides with a character real prose can
/// contain.
pub(super) fn escape_table_cell(text: &str) -> String {
    text.replace('|', "\\|")
}

/// Escapes the characters that would break LaTeX's own `\text{}` parsing —
/// backslash and braces are structural to LaTeX itself, not this
/// pipeline's syntax (contrast [`escape_table_cell`], which only escapes
/// `|`, this pipeline's own table syntax). A connector word lifted
/// straight off a PDF page is never expected to contain either, but
/// `finish_block`'s `MathsDisplay` arm feeds arbitrary extracted text
/// through this, so it must not silently corrupt the equation around it if
/// one ever does.
fn escape_text_for_maths(text: &str) -> String {
    text.replace('\\', "\\textbackslash ").replace('{', "\\{").replace('}', "\\}")
}

/// Renders a case row's condition half ("für t ≥ b") as LaTeX: each maximal
/// run of non-maths-family characters is real prose and gets `\text{}`
/// wrapped (`to_latex` on its own only recognises a fixed, ASCII-only list
/// of operator names as upright text — a German connector word like "für"
/// falls through that and would otherwise render as bare, implicitly
/// italicised maths variables), each maths-family run renders through
/// `to_latex` exactly as it already does anywhere else in this pipeline.
///
/// A literal space is inserted between two consecutive pieces only when the
/// source's own horizontal gap between them is wide enough to have been a
/// real word-space (mirrors `SPACE_GAP`, the same threshold `build_line`
/// and `latex::to_latex` already use) — never unconditionally, which would
/// insert spaces a tightly-kerned run never had.
pub(super) fn render_condition(chars: &[CharBox]) -> String {
    let em = chars.iter().map(|c| c.font_size).fold(0.0_f32, f32::max).max(1.0);
    let mut out = String::new();
    let mut previous_end: Option<f32> = None;
    let mut index = 0;

    while index < chars.len() {
        let is_maths = chars[index].is_maths();
        let start = index;
        while index < chars.len() && chars[index].is_maths() == is_maths {
            index += 1;
        }
        let run = &chars[start..index];

        let piece = if is_maths {
            let latex = latex::to_latex(run);
            (!latex.is_empty()).then_some(latex)
        } else {
            let text: String = run.iter().map(|c| c.ch).collect();
            let trimmed = text.trim();
            (!trimmed.is_empty()).then(|| format!("\\text{{{}}}", escape_text_for_maths(trimmed)))
        };

        let Some(piece) = piece else { continue };

        let run_start = run.iter().map(|c| c.x).fold(f32::MAX, f32::min);
        if let Some(end) = previous_end {
            if run_start - end > em * SPACE_GAP && !out.ends_with(' ') {
                out.push(' ');
            }
        }
        out.push_str(&piece);
        previous_end = Some(run.iter().map(|c| c.x + c.width).fold(f32::MIN, f32::max));
    }

    out
}

/// The single cases-brace glyph in `row`, and every character before it —
/// the "ist " that shares its row, whitespace kept in place so a
/// multi-word leading phrase stays correctly spaced — as long as the brace
/// is the last *printing* character on the row (never followed by
/// anything but trailing whitespace, which is the only shape a real
/// `\cases` block's opening brace takes). `None` when the row has no
/// brace, more than one, or real content after it — any of those means
/// this row is not a plausible cases-brace row at all.
fn cases_brace_row(row: &[CharBox]) -> Option<(CharBox, Vec<CharBox>)> {
    let mut sorted: Vec<CharBox> = row.to_vec();
    sorted.sort_by(|a, b| a.x.partial_cmp(&b.x).unwrap_or(std::cmp::Ordering::Equal));

    if sorted.iter().filter(|c| latex::is_cases_brace(c)).count() != 1 {
        return None;
    }
    let last_printing = sorted.iter().rev().find(|c| !c.ch.is_whitespace())?;
    if !latex::is_cases_brace(last_printing) {
        return None;
    }
    let brace_pos = sorted.iter().position(latex::is_cases_brace)?;
    let brace = sorted[brace_pos];
    sorted.truncate(brace_pos);
    Some((brace, sorted))
}

/// One open/close bracket-glyph pair, left to right within its row.
pub(super) type BracketPair = (CharBox, CharBox);

/// Every bracket-glyph pair in `row`, left to right, and every character
/// before the first open bracket — leading prose like "3. Gegeben ist das
/// Vektorfeld " (Analysis_2_Blatt5_2026.pdf item 3) or "Ordnung: "
/// (Analysis_2_Blatt12.pdf item 5), kept in place so a leading phrase
/// stays correctly spaced. `None` unless the row's last printing
/// character is a close bracket and every printing character from the
/// first bracket glyph onward is itself a bracket glyph, strictly
/// alternating open/close/open/close/…, with only whitespace between any
/// two of them — whether within one pair or between two adjacent pairs
/// (Analysis_2_Blatt12.pdf items 4/5: three independent small matrices
/// share one bracket row, separated only by spaces). A single bracket
/// pair is just the `N = 1` case of this same rule.
pub(super) fn matrix_bracket_row(row: &[CharBox]) -> Option<(Vec<BracketPair>, Vec<CharBox>)> {
    let mut sorted: Vec<CharBox> = row.to_vec();
    sorted.sort_by(|a, b| a.x.partial_cmp(&b.x).unwrap_or(std::cmp::Ordering::Equal));

    let bracket_positions: Vec<usize> = sorted
        .iter()
        .enumerate()
        .filter(|(_, c)| latex::bracket_glyph(c).is_some())
        .map(|(i, _)| i)
        .collect();
    if bracket_positions.is_empty() || !bracket_positions.len().is_multiple_of(2) {
        return None;
    }
    let last_printing = sorted.iter().rev().find(|c| !c.ch.is_whitespace())?;
    if latex::bracket_glyph(last_printing) != Some(false) {
        return None;
    }
    for (i, &pos) in bracket_positions.iter().enumerate() {
        if latex::bracket_glyph(&sorted[pos]) != Some(i % 2 == 0) {
            return None;
        }
        if i > 0 {
            let prev_pos = bracket_positions[i - 1];
            if sorted[prev_pos + 1..pos].iter().any(|c| !c.ch.is_whitespace()) {
                return None;
            }
        }
    }

    let first_pos = bracket_positions[0];
    let brackets: Vec<BracketPair> =
        bracket_positions.chunks_exact(2).map(|pair| (sorted[pair[0]], sorted[pair[1]])).collect();
    let leading = sorted[..first_pos].to_vec();
    Some((brackets, leading))
}

/// Finds and reconstructs a piecewise ("cases") function definition: a
/// prefix ("H(t-b) ="), a tall opening brace, and two or more case rows
/// beneath it, each splitting into a value and a condition — the shape
/// Analysis_2_Blatt12.pdf's Heaviside step function definition sets.
///
/// Runs on the raw rows, before `build_line` collapses them into `Inline`s,
/// for the same reason `reconstruct_fraction_sums` does: splitting a case
/// row into its value and condition needs the row's own real x-gap, which a
/// finished `Inline` string no longer distinguishes from an ordinary
/// internal space. It also has to run *before* `reconstruct_tables`, or two
/// left-aligned case rows read exactly like a two-row table.
///
/// The prefix row cannot be found by `y`-order the way every other row in
/// this file is processed: TeX sets it vertically centered against the
/// whole cases block, so it sits *between* the case rows in `y`, not above
/// or below them. It is identified purely by `x` instead — the one
/// unconsumed row whose right edge sits flush against the brace's own left
/// edge.
///
/// Returns the finished `Line`s for whatever matched, and every row that
/// didn't — for the caller to run through the remaining reconstruction
/// passes and finally `build_line`, unchanged.
fn reconstruct_cases(rows: Vec<Vec<(usize, CharBox)>>) -> (Vec<Line>, Vec<Vec<(usize, CharBox)>>) {
    let plain: Vec<Vec<CharBox>> = rows.iter().map(|r| r.iter().map(|(_, c)| *c).collect()).collect();
    let mut consumed = vec![false; rows.len()];
    let mut synthesized: Vec<Line> = Vec::new();

    for brace_i in 0..plain.len() {
        if consumed[brace_i] {
            continue;
        }
        let Some((brace, leading)) = cases_brace_row(&plain[brace_i]) else { continue };
        let brace_size = brace.font_size.max(1.0);
        let brace_left = brace.x;
        let brace_right = brace.x + brace.width;

        let mut case_candidates: Vec<usize> = (0..plain.len())
            .filter(|&i| i != brace_i && !consumed[i])
            .filter(|&i| row_y(&plain[i]) < brace.y)
            .filter(|&i| brace.y - row_y(&plain[i]) <= brace_size * CASES_MAX_ROW_GAP)
            .filter(|&i| (row_x_extent(&plain[i]).0 - brace_right).abs() <= brace_size * CASES_MAX_COLUMN_GAP)
            .collect();
        if case_candidates.len() < 2 {
            continue;
        }
        case_candidates.sort_by(|&a, &b| row_y(&plain[b]).partial_cmp(&row_y(&plain[a])).unwrap_or(std::cmp::Ordering::Equal));

        let column_x = row_x_extent(&plain[case_candidates[0]]).0;
        let aligned = case_candidates
            .iter()
            .all(|&i| (row_x_extent(&plain[i]).0 - column_x).abs() <= brace_size * CASES_COLUMN_TOLERANCE);
        if !aligned {
            continue;
        }

        let top_y = row_y(&plain[case_candidates[0]]);
        let bottom_y = row_y(&plain[*case_candidates.last().unwrap_or(&case_candidates[0])]);
        let prefix_i = (0..plain.len()).find(|&i| {
            i != brace_i
                && !consumed[i]
                && !case_candidates.contains(&i)
                && (row_x_extent(&plain[i]).1 - brace_left).abs() <= brace_size * CASES_MAX_COLUMN_GAP
                && row_y(&plain[i]) <= top_y
                && row_y(&plain[i]) >= bottom_y
        });
        let Some(prefix_i) = prefix_i else { continue };

        let mut case_lines: Vec<String> = Vec::with_capacity(case_candidates.len());
        let mut split_failed = false;
        for &ci in &case_candidates {
            let Some(parts) = split_into_terms(&plain[ci], 2) else {
                split_failed = true;
                break;
            };
            let value = latex::to_latex(&parts[0]);
            let condition = render_condition(&parts[1]);
            case_lines.push(format!("{value} & {condition}"));
        }
        if split_failed {
            continue;
        }

        let prefix_latex = latex::to_latex(&plain[prefix_i]);
        let latex = format!(
            "{prefix_latex} \\begin{{cases}} {} \\end{{cases}}",
            case_lines.join(" \\\\ ")
        );

        let base_size = row_font_size(&plain[prefix_i]).max(1.0);
        let mut x = row_x_extent(&plain[prefix_i]).0.min(brace_left);
        let mut right = brace_right;
        for &ci in &case_candidates {
            let (x0, x1) = row_x_extent(&plain[ci]);
            x = x.min(x0);
            right = right.max(x1);
        }
        if let Some(leading_x0) = leading.iter().map(|c| c.x).fold(None, |acc: Option<f32>, v| {
            Some(acc.map_or(v, |a| a.min(v)))
        }) {
            x = x.min(leading_x0);
        }

        // The word(s) introducing the definition ("ist ") stay as ordinary
        // text ahead of the equation, the same way `reconstruct_fraction_sums`
        // keeps a baseline's own enumeration label ahead of its fractions —
        // it is prose, not part of the LaTeX. The trailing space is
        // synthesized rather than read off `leading`'s own characters, the
        // same reasoning `baseline_label` already documents: a PDF often
        // places the next glyph via a bare cursor jump, no space character
        // at all, between a word and what follows it.
        let mut content: Vec<Inline> = Vec::new();
        let leading_text: String = leading.iter().map(|c| c.ch).collect();
        let leading_trimmed = leading_text.trim();
        if !leading_trimmed.is_empty() {
            content.push(Inline::Text(Span {
                text: format!("{leading_trimmed} "),
                bold: false,
                italic: false,
            }));
        }
        content.push(Inline::Maths(latex));
        let is_display_maths = content.iter().all(|i| match i {
            Inline::Text(span) => span.text.trim().is_empty(),
            Inline::Maths(_) => true,
            Inline::TableRow(_, _) | Inline::ImageRef(_, _) => false,
        });

        // Not `top_y` (the topmost *case* row): the brace's own row — "ist
        // {" — sits visually above every case, and using only the cases'
        // own top understated the block's real height, reading as a much
        // larger gap than normal to whatever paragraph line precedes it and
        // wrongly starting a new one (found against the real document,
        // where "Dabei" and this block's own "ist" are one sentence).
        let block_top_y = row_y(&plain[brace_i]).max(top_y).max(row_y(&plain[prefix_i]));

        synthesized.push(Line {
            content,
            x,
            right,
            y: block_top_y,
            font_size: base_size,
            fixed_pitch: false,
            is_display_maths,
            ends_hyphenated: false,
        });

        consumed[brace_i] = true;
        consumed[prefix_i] = true;
        for &ci in &case_candidates {
            consumed[ci] = true;
        }
    }

    let remaining: Vec<Vec<(usize, CharBox)>> = rows
        .into_iter()
        .enumerate()
        .filter(|(i, _)| !consumed[*i])
        .map(|(_, row)| row)
        .collect();

    (synthesized, remaining)
}

/// Finds and reconstructs a multi-row vector or matrix: a tall bracket
/// pair with two or more content rows between them, and — as on
/// Analysis_2_Blatt11.pdf item 6 — a prefix row (`⃗v(x, y) =`, `.`) whose
/// own `y` sits *between* the content rows rather than above or below all
/// of them, the same quirk `reconstruct_cases` already solved for
/// `H(t-b) =`.
///
/// Runs on the raw rows, before `build_line` collapses them into
/// `Inline`s, for the same reason `reconstruct_cases` does: column
/// splitting needs each row's own real x-gaps, which a finished `Inline`
/// string no longer distinguishes from an ordinary internal space. Must
/// run before `reconstruct_tables`, or a genuine 2+ column matrix's own
/// rows read exactly like a table.
///
/// Column count comes from `table_gutters` run across every content row
/// together — the same cross-row alignment judgment `reconstruct_tables`
/// already relies on, not a new algorithm. A single wide expression's own
/// internal operator spacing never produces a false column split, because
/// a gutter only counts where *every* content row is simultaneously
/// empty.
///
/// Returns the finished `Line`s for whatever matched, and every row that
/// didn't — for the caller to run through the remaining reconstruction
/// passes and finally `build_line`, unchanged.
fn reconstruct_matrices(rows: Vec<Vec<(usize, CharBox)>>) -> (Vec<Line>, Vec<Vec<(usize, CharBox)>>) {
    let plain: Vec<Vec<CharBox>> = rows.iter().map(|r| r.iter().map(|(_, c)| *c).collect()).collect();
    let mut consumed = vec![false; rows.len()];
    let mut synthesized: Vec<Line> = Vec::new();

    for bracket_i in 0..plain.len() {
        if consumed[bracket_i] {
            continue;
        }
        let Some((brackets, leading)) = matrix_bracket_row(&plain[bracket_i]) else { continue };
        let bracket_size = brackets[0].0.font_size.max(1.0);
        // The overall span from the first bracket's own interior to the
        // last bracket's own interior — content rows are found once and
        // shared across every bracket, then sliced per-bracket below.
        let open_right = brackets[0].0.x + brackets[0].0.width;
        let close_left = brackets[brackets.len() - 1].1.x;
        if open_right >= close_left {
            continue;
        }

        let bracket_y = row_y(&plain[bracket_i]);
        let mut content_candidates: Vec<usize> = (0..plain.len())
            .filter(|&i| i != bracket_i && !consumed[i])
            .filter(|&i| {
                let (x0, x1) = row_x_extent(&plain[i]);
                x0 >= open_right - bracket_size * MATRIX_MAX_COLUMN_GAP
                    && x1 <= close_left + bracket_size * MATRIX_MAX_COLUMN_GAP
            })
            // Column-proximity alone is not enough: unrelated content far
            // down the page (a later exercise's own symbol, a page-number
            // footer) can coincidentally share this x-band — the same
            // failure `CASES_MAX_ROW_GAP` already guards against for
            // `reconstruct_cases`. A content row must sit within a few row
            // heights of the bracket itself, not merely somewhere on the
            // same page.
            .filter(|&i| (bracket_y - row_y(&plain[i])).abs() <= bracket_size * MATRIX_MAX_ROW_GAP)
            // The *overall* envelope (first bracket's open to last
            // bracket's close) can span most of the line once several
            // brackets sit on one row, so falling inside it is not enough
            // either — a row must actually touch at least one bracket's
            // own physical column. Found on Ue9.pdf Beispiel 9.2: four
            // consecutive `\binom{}{}`s (the same bracket-plus-two-rows
            // shape a real vector takes) left a gap between bracket 2 and
            // bracket 3 wide enough for the surrounding sentence's own
            // "als auch als" (German "sowohl ... als auch ...", both...
            // and) to sit at a y between the numerator/denominator rows
            // and pass the checks above without ever touching a bracket.
            .filter(|&i| {
                brackets.iter().any(|b| plain[i].iter().any(|c| c.x >= b.0.x && c.x <= b.1.x + b.1.width))
            })
            .collect();
        if content_candidates.len() < 2 {
            continue;
        }
        content_candidates.sort_by(|&a, &b| {
            row_y(&plain[b]).partial_cmp(&row_y(&plain[a])).unwrap_or(std::cmp::Ordering::Equal)
        });

        let top_y = row_y(&plain[content_candidates[0]]);
        let bottom_y = row_y(&plain[*content_candidates.last().unwrap_or(&content_candidates[0])]);

        let prefix_i = (0..plain.len()).find(|&i| {
            i != bracket_i
                && !consumed[i]
                && !content_candidates.contains(&i)
                && row_y(&plain[i]) <= top_y
                && row_y(&plain[i]) >= bottom_y
        });

        // A row's contribution to one bracket's own column: bracket-glyph
        // pieces stripped (a delimiter piece is never real content,
        // wherever it lands — Analysis_2_Blatt7_2026.pdf's assembled
        // delimiter), and always restricted to that one bracket's own
        // physical edges — not the wider `MATRIX_MAX_COLUMN_GAP`
        // tolerance used to judge whether an entire other row counts as
        // content at all. With a single bracket this restriction is a
        // no-op (real content always sits well inside the bracket's own
        // span); with several brackets sharing one row, every ordinary
        // content row spans *all* of them, and only this per-bracket
        // slice is what belongs to any one pmatrix.
        let inside_of = |row_index: usize, bracket: &BracketPair| -> Vec<(usize, CharBox)> {
            rows[row_index]
                .iter()
                .copied()
                .filter(|(_, c)| latex::bracket_glyph(c).is_none())
                .filter(|(_, c)| c.x >= bracket.0.x && c.x <= bracket.1.x + bracket.1.width)
                .collect()
        };

        // The prefix row can also carry real matrix content on the same
        // baseline (Analysis_2_Blatt7_2026.pdf's assembled delimiter) —
        // checked against every bracket's own column, since any one of
        // them might be the one whose second piece landed here.
        if let Some(pi) = prefix_i {
            if brackets.iter().any(|b| !inside_of(pi, b).is_empty()) {
                content_candidates.push(pi);
                content_candidates.sort_by(|&a, &b| {
                    row_y(&plain[b]).partial_cmp(&row_y(&plain[a])).unwrap_or(std::cmp::Ordering::Equal)
                });
            }
        }

        // A genuine matrix's own content rows are simple algebraic
        // expressions — every real example in the corpus lacks big
        // operators of its own. Found on Ue9.pdf Beispiel 9.3: an
        // unrelated tall delimiter wrapping a nested formula is
        // geometrically indistinguishable from a real matrix's bracket
        // row. Bailing out entirely (rather than only dropping the
        // offending row) is deliberate: a "matrix" that claims a big
        // operator as one of its own rows isn't a matrix, and guessing
        // which of its rows to keep would be exactly the kind of forced
        // fix this pipeline's own practice warns against.
        if content_candidates.iter().any(|&i| {
            plain[i].iter().any(|c| c.family == Family::Extensible && latex::bracket_glyph(c).is_none())
        }) {
            continue;
        }

        // Several independent brackets sharing one row is also exactly
        // the shape a run of `\binom{}{}`s takes — each one column-pair
        // tall content, no big operator inside either. What tells the two
        // apart is *introduction*: every confirmed real system of
        // equations (Analysis_2_Blatt12.pdf items 4/5) names the object
        // it's assigning into right before the first bracket
        // (`⃗y'(t) =`), while a `\binom` is plugged into a sentence or
        // formula with nothing of the kind (Ue9.pdf Beispiel 9.2: neither
        // the four combinatorial `\binom`s in "sowohl ... als auch ..."
        // nor the three in the lottery formula have any text — on the
        // bracket row or the prefix row — before their first bracket).
        // Only checked for N > 1: a single bracket already has its own
        // real-document evidence (Blatt11/Blatt5/Blatt7) that no
        // introduction is required.
        if brackets.len() > 1 {
            let leading_present = !leading.is_empty();
            let before_present = prefix_i.is_some_and(|pi| {
                plain[pi].iter().any(|c| c.x < brackets[0].0.x && !c.ch.is_whitespace())
            });
            if !leading_present && !before_present {
                continue;
            }
        }

        // Each bracket gets its own pmatrix, built from the shared
        // content rows sliced down to that bracket's own column — the
        // same single-bracket column-splitting algorithm as before, run
        // once per bracket, so a 2-column matrix and two 1-column vectors
        // sharing the same rows each get their own independent split.
        let mut pmatrices: Vec<String> = Vec::with_capacity(brackets.len());
        let mut x = brackets[0].0.x;
        let mut right = brackets[brackets.len() - 1].1.x + brackets[brackets.len() - 1].1.width;
        for bracket in &brackets {
            let content_rows: Vec<Vec<(usize, CharBox)>> =
                content_candidates.iter().map(|&ci| inside_of(ci, bracket)).collect();
            let content_plain: Vec<Vec<CharBox>> =
                content_rows.iter().map(|row| row.iter().map(|(_, c)| *c).collect()).collect();
            let cut_xs = table_gutters(&content_plain).filter(|cuts| {
                !cuts.is_empty()
                    && content_plain.iter().all(|row| !row_crosses_gutters(row, cuts))
                    && content_rows.iter().all(|row| {
                        split_row_into_cells(row, cuts).iter().filter(|c| cell_has_content(c)).count()
                            == cuts.len() + 1
                    })
            });

            let row_lines: Vec<String> = content_rows
                .iter()
                .map(|row| match &cut_xs {
                    Some(cuts) => split_row_into_cells(row, cuts)
                        .into_iter()
                        .map(|cell| {
                            let mut cell_chars: Vec<CharBox> = cell.into_iter().map(|(_, c)| c).collect();
                            cell_chars.sort_by(|a, b| a.x.partial_cmp(&b.x).unwrap_or(std::cmp::Ordering::Equal));
                            latex::to_latex(&cell_chars)
                        })
                        .collect::<Vec<_>>()
                        .join(" & "),
                    None => {
                        let mut row_chars: Vec<CharBox> = row.iter().map(|(_, c)| *c).collect();
                        row_chars.sort_by(|a, b| a.x.partial_cmp(&b.x).unwrap_or(std::cmp::Ordering::Equal));
                        latex::to_latex(&row_chars)
                    }
                })
                .collect();

            for row in &content_plain {
                let (x0, x1) = row_x_extent(row);
                x = x.min(x0);
                right = right.max(x1);
            }

            pmatrices.push(format!("\\begin{{pmatrix}} {} \\end{{pmatrix}}", row_lines.join(" \\\\ ")));
        }

        // The prefix splits into one fragment more than there are
        // brackets: before the first, between each adjacent pair, and
        // after the last — generalizing the single-bracket before/after
        // split the same way.
        let fragments: Vec<String> = if let Some(pi) = prefix_i {
            // Strict inequalities at both ends, matching exactly what the
            // single-bracket `before`/`after` split used (`c.x < open.x`,
            // `c.x > close.x + close.width`) — `w == 0`/`w == brackets.len()`
            // carry no bound at all on that side, rather than an inclusive
            // one, so this degrades to byte-identical behavior at `N = 1`.
            (0..=brackets.len())
                .map(|w| {
                    let mut fragment_chars: Vec<CharBox> = plain[pi]
                        .iter()
                        .copied()
                        .filter(|c| {
                            let after_prev =
                                w == 0 || c.x > brackets[w - 1].1.x + brackets[w - 1].1.width;
                            let before_next = w == brackets.len() || c.x < brackets[w].0.x;
                            after_prev && before_next && latex::bracket_glyph(c).is_none()
                        })
                        .collect();
                    fragment_chars.sort_by(|a, b| a.x.partial_cmp(&b.x).unwrap_or(std::cmp::Ordering::Equal));
                    latex::to_latex(&fragment_chars)
                })
                .collect()
        } else {
            vec![String::new(); brackets.len() + 1]
        };

        let mut latex = String::new();
        for (i, pmatrix) in pmatrices.iter().enumerate() {
            let frag = &fragments[i];
            if !frag.is_empty() {
                if i > 0 {
                    latex.push(' ');
                }
                latex.push_str(frag);
                latex.push(' ');
            }
            latex.push_str(pmatrix);
        }
        let last_frag = &fragments[brackets.len()];
        if !last_frag.is_empty() {
            latex.push_str(last_frag);
        }

        let mut content: Vec<Inline> = Vec::new();
        let leading_text: String = leading.iter().map(|c| c.ch).collect();
        let leading_trimmed = leading_text.trim();
        if !leading_trimmed.is_empty() {
            content.push(Inline::Text(Span {
                text: format!("{leading_trimmed} "),
                bold: false,
                italic: false,
            }));
        }
        content.push(Inline::Maths(latex));
        let is_display_maths = content.iter().all(|i| match i {
            Inline::Text(span) => span.text.trim().is_empty(),
            Inline::Maths(_) => true,
            Inline::TableRow(_, _) | Inline::ImageRef(_, _) => false,
        });

        let base_size = prefix_i.map(|pi| row_font_size(&plain[pi])).unwrap_or(bracket_size).max(1.0);
        if let Some(leading_x0) =
            leading.iter().map(|c| c.x).fold(None, |acc: Option<f32>, v| Some(acc.map_or(v, |a| a.min(v))))
        {
            x = x.min(leading_x0);
        }
        let mut block_top_y = row_y(&plain[bracket_i]).max(top_y);
        if let Some(pi) = prefix_i {
            block_top_y = block_top_y.max(row_y(&plain[pi]));
        }

        synthesized.push(Line {
            content,
            x,
            right,
            y: block_top_y,
            font_size: base_size,
            fixed_pitch: false,
            is_display_maths,
            ends_hyphenated: false,
        });

        consumed[bracket_i] = true;
        if let Some(pi) = prefix_i {
            consumed[pi] = true;
        }
        for &ci in &content_candidates {
            consumed[ci] = true;
        }
    }

    let remaining: Vec<Vec<(usize, CharBox)>> = rows
        .into_iter()
        .enumerate()
        .filter(|(i, _)| !consumed[*i])
        .map(|(_, row)| row)
        .collect();

    (synthesized, remaining)
}

fn render_content(content: &[Inline]) -> String {
    let mut out = String::new();
    for inline in content {
        let span = match inline {
            Inline::Maths(latex) => {
                out.push_str(&format!("${latex}$"));
                continue;
            }
            Inline::Text(span) => span,
            // Unreachable: a cell's own content never nests another table
            // row or an image ref, and `render_content` is never called on
            // a `Block::Table`/`Block::Image` directly — each renders
            // through its own arm in `blocks_to_markdown` instead.
            Inline::TableRow(_, _) | Inline::ImageRef(_, _) => continue,
        };
        let marker = match (span.bold, span.italic) {
            (true, true) => "***",
            (true, false) => "**",
            (false, true) => "*",
            (false, false) => "",
        };
        let trimmed = span.text.trim();
        // Maths italic supplies its own comma and full stop, so a coordinate
        // pair came out as "(3*.*02*,*3*.*99)" — emphasis marks around
        // punctuation that carry no meaning and read as line noise.
        let worth_marking = trimmed.chars().any(char::is_alphanumeric);
        if marker.is_empty() || trimmed.is_empty() || !worth_marking {
            out.push_str(&span.text);
            continue;
        }
        // Markdown will not open emphasis against whitespace, so any padding
        // has to sit outside the markers rather than inside them.
        let leading = &span.text[..span.text.len() - span.text.trim_start().len()];
        let trailing = &span.text[span.text.trim_end().len()..];
        out.push_str(leading);
        out.push_str(marker);
        out.push_str(trimmed);
        out.push_str(marker);
        out.push_str(trailing);
    }
    out
}

/// Renders blocks to Markdown, equations included: `$…$` inline, and a
/// display equation as its own block delimited by a lone `$` on its own
/// line before and after — not the more common `$$…$$` — because that is
/// the markdown dialect the editor's own `BlockMath` TipTap extension
/// actually parses (see `src/editor/extensions/BlockMath.tsx`'s markdown-it
/// rule). `$$…$$` isn't recognized as a block there at all: it falls
/// through to `InlineMath`'s regex instead, which pairs the first two
/// (adjacent) `$` as an empty match and renders the equation as small
/// inline math with stray `$` characters left over.
pub fn blocks_to_markdown(blocks: &[Block]) -> String {
    let mut parts: Vec<String> = Vec::new();
    for block in blocks {
        match block {
            Block::Heading { level, content } => {
                let hashes = "#".repeat((*level).clamp(1, 6) as usize);
                parts.push(format!("{hashes} {}", render_content(content)));
            }
            Block::Paragraph { content } => parts.push(render_content(content)),
            Block::Code { text } => parts.push(format!("```\n{text}\n```")),
            // Display maths gets its own block so it renders centred, the way
            // the source set it.
            Block::MathsDisplay { latex } => parts.push(format!("$\n{latex}\n$")),
            Block::ListItem {
                ordered,
                number,
                depth,
                content,
            } => {
                let indent = "  ".repeat(*depth);
                let marker = match (ordered, number) {
                    (true, Some(n)) => format!("{n}."),
                    (true, None) => "1.".to_string(),
                    (false, _) => "-".to_string(),
                };
                parts.push(format!(
                    "{indent}{marker} {}",
                    render_content(content)
                ));
            }
            Block::Table { rows } => {
                let mut table_lines: Vec<String> = Vec::new();
                for (index, row) in rows.iter().enumerate() {
                    let cells: Vec<String> = row
                        .iter()
                        .map(|cell| escape_table_cell(&render_content(cell)))
                        .collect();
                    table_lines.push(format!("| {} |", cells.join(" | ")));
                    if index == 0 {
                        let delimiter = vec!["---"; row.len()].join(" | ");
                        table_lines.push(format!("| {delimiter} |"));
                    }
                }
                parts.push(table_lines.join("\n"));
            }
            // The placeholder travels through verbatim — it isn't a real
            // path yet (see `Inline::ImageRef`), so there is nothing here
            // that needs the escaping a table cell's content does.
            Block::Image { placeholder, alt } => {
                parts.push(format!("![{alt}]({placeholder})"));
            }
        }
    }
    let mut out = parts.join("\n\n");
    if !out.is_empty() {
        out.push('\n');
    }
    out
}

/// The whole pipeline: characters in, Markdown out.
pub fn chars_to_markdown(chars: &[CharBox]) -> String {
    blocks_to_markdown(&group_blocks(&reconstruct_fractions(group_lines(chars))))
}

/// One page image, ready to be interleaved into reading order. `left`/
/// `right`/`y` are in the same PDF user-space coordinates `CharBox` already
/// uses (bottom-left origin, larger `y` higher on the page) — `y` is the
/// image's own vertical center, since it has no baseline the way text does.
pub struct ImageRef {
    pub placeholder: String,
    pub alt: String,
    pub left: f32,
    pub right: f32,
    pub y: f32,
}

/// Like `chars_to_markdown`, but also places `images` into reading order.
/// Reuses the same pattern proven for tables, simpler here because an image
/// never wraps or merges with a neighbor: each becomes a synthetic `Line`
/// carrying a single `Inline::ImageRef`, appended to the `Line`s
/// `group_lines` already built from `chars` (which is untouched — no new
/// parameter, nothing about its own sort changes), then the combined list
/// is re-sorted by `y` before block grouping runs.
///
/// Each synthetic `Line` uses the image's own `left`/`right` for `x`/
/// `right` rather than a placeholder `0.0` — `group_blocks`'s own
/// `left_margin` computation folds `f32::min` over every line's `x`
/// (image lines included, since they are not blank), so a `0.0` here would
/// silently collapse the page's computed left margin and inflate every
/// list item's indent depth on any page containing an image.
pub fn chars_and_images_to_markdown(chars: &[CharBox], images: &[ImageRef]) -> String {
    let mut lines = group_lines(chars);
    lines.extend(images.iter().map(|img| Line {
        content: vec![Inline::ImageRef(img.placeholder.clone(), img.alt.clone())],
        x: img.left,
        right: img.right,
        y: img.y,
        font_size: 0.0,
        fixed_pitch: false,
        is_display_maths: false,
        ends_hyphenated: false,
    }));
    lines.sort_by(|a, b| b.y.partial_cmp(&a.y).unwrap_or(std::cmp::Ordering::Equal));
    blocks_to_markdown(&group_blocks(&reconstruct_fractions(lines)))
}

// How far apart (in multiples of the larger line's font size) two maths-only
// lines can sit and still be considered a numerator/denominator pair, rather
// than two unrelated equations that happen to be nearby.
const FRACTION_MAX_ROW_GAP: f32 = 4.0;
// How much of the narrower line's width the two must share to count as
// "stacked on the same column" rather than merely nearby.
const FRACTION_MIN_OVERLAP_RATIO: f32 = 0.3;

// How far a case row's own left edge, or a prefix row's own right edge, may
// sit from the brace's edge and still count as "that row belongs to this
// brace" — scaled by the brace's own font size the same way
// FRACTION_MAX_ROW_GAP scales by a fraction's own body size.
const CASES_MAX_COLUMN_GAP: f32 = 2.5;

// How far a content row's own x-extent may sit outside the bracket's
// interior span (open's right edge to close's left edge) and still count
// as belonging to this matrix — scaled by the bracket's own font size, the
// same reasoning `CASES_MAX_COLUMN_GAP` already documents.
const MATRIX_MAX_COLUMN_GAP: f32 = 2.5;
// How far above or below the bracket row (in multiples of its own font
// size) a row may sit and still be a candidate content row — the same
// reasoning `CASES_MAX_ROW_GAP` documents: x-band coincidence alone lets a
// page footer or a later exercise's own symbol pass the column check from
// anywhere on the page. Measured from the bracket's own row, which for an
// assembled two-piece delimiter is anchored at its top piece — so this has
// to cover a whole matrix's height, not just one row's worth. Confirmed
// against Analysis_2_Blatt7_2026.pdf's 3-row vectors, whose bottom row
// sits 3.21 bracket-heights below the top piece (3.0 was calibrated only
// against Analysis_2_Blatt11.pdf's 2-row case and excluded it); still an
// order of magnitude below the hundreds-of-points distance of genuinely
// unrelated page content this guard exists to reject.
const MATRIX_MAX_ROW_GAP: f32 = 5.0;
// How far a case row's left edge may drift from the first case row's own
// left edge and still count as the same left-aligned column.
const CASES_COLUMN_TOLERANCE: f32 = 1.0;
// How far below the brace (in multiples of its own font size) a row may
// sit and still be a candidate case row. Column-proximity alone is not
// enough: a page footer's page number can land within `CASES_MAX_COLUMN_GAP`
// of the brace's own x by pure coincidence, however far down the page it
// actually is — found on Analysis_2_Blatt12.pdf, where the footer "1" at
// y=26.8 (the brace sits at y=348.3) passed the x-proximity filter and broke
// the column-alignment check for the two real case rows above it.
const CASES_MAX_ROW_GAP: f32 = 3.0;

fn range_overlap(a0: f32, a1: f32, b0: f32, b1: f32) -> f32 {
    (a1.min(b1) - a0.max(b0)).max(0.0)
}

/// A display-maths line's content, flattened to one LaTeX string. Meant only
/// for lines that are already [`Line::is_display_maths`] — anything that
/// isn't maths on such a line is whitespace by definition, so dropping the
/// `Text` pieces loses nothing.
fn combined_maths_latex(line: &Line) -> String {
    line.content
        .iter()
        .filter_map(|i| match i {
            Inline::Maths(s) => Some(s.as_str()),
            Inline::Text(_) | Inline::TableRow(_, _) | Inline::ImageRef(_, _) => None,
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Whether `line`'s content is nothing but large paren/brace delimiter
/// glyphs (and whitespace between them) — the shape a `\binom`/`\cases`
/// delimiter line takes once `latex::to_latex` has already turned the
/// glyph into a plain `"("`, `")"`, or `"\{"` (see `large_paren_glyph` in
/// `latex.rs`). Evidence that a candidate fraction pair is really a
/// delimiter-flanked multi-row construct, not a bare fraction.
fn is_delimiter_only_line(line: &Line) -> bool {
    if line.content.is_empty() {
        return false;
    }
    line.content.iter().all(|inline| match inline {
        Inline::Maths(latex) => matches!(latex.trim(), "(" | ")" | "\\{"),
        Inline::Text(span) => span.text.trim().is_empty(),
        Inline::TableRow(_, _) | Inline::ImageRef(_, _) => false,
    })
}

/// A line that is a *single*, unbroken maths region — the shape a genuine
/// numerator or denominator takes. `is_display_maths` alone is not enough: a
/// baseline row like `f(z) = ... .` also reads as maths-only once its own
/// prefix and suffix are each their own region, and pairing it against the
/// numerator as if *it* were the denominator was exactly the wrong match this
/// was found producing.
fn is_single_region(line: &Line) -> bool {
    matches!(line.content.as_slice(), [Inline::Maths(_)])
}

/// The closest vertically-stacked, horizontally-overlapping pair of
/// single-region maths lines still left to reconstruct, read as (numerator
/// index, denominator index).
///
/// Pairing is scoped to one paragraph: without that, a generous vertical
/// window meant to span a fraction's own numerator/baseline/denominator rows
/// just as easily reaches across an actual paragraph break to the *next*
/// exercise's own equation, pairing unrelated content — found happening
/// exactly that way on the real document this was built against.
fn find_fraction_pair(lines: &[Line]) -> Option<(usize, usize)> {
    let mut gaps: Vec<f32> = lines
        .windows(2)
        .map(|w| (w[0].y - w[1].y).abs())
        .collect();
    let typical_gap = median(&mut gaps);

    let mut best: Option<(usize, usize, f32)> = None;
    for i in 0..lines.len() {
        if !is_single_region(&lines[i]) {
            continue;
        }
        for j in (i + 1)..lines.len() {
            if !is_single_region(&lines[j]) {
                continue;
            }
            let gap = lines[i].y - lines[j].y;
            if gap <= 0.0 {
                continue;
            }
            let body = lines[i].font_size.max(lines[j].font_size).max(1.0);
            if gap > body * FRACTION_MAX_ROW_GAP {
                continue;
            }
            let crosses_a_paragraph_break = (i..j).any(|k| {
                typical_gap > 0.0
                    && (lines[k].y - lines[k + 1].y).abs() > typical_gap * BLOCK_GAP_RATIO
            });
            if crosses_a_paragraph_break {
                continue;
            }
            let overlap = range_overlap(lines[i].x, lines[i].right, lines[j].x, lines[j].right);
            let min_width = (lines[i].right - lines[i].x)
                .min(lines[j].right - lines[j].x)
                .max(1.0);
            if overlap < min_width * FRACTION_MIN_OVERLAP_RATIO {
                continue;
            }
            let margin = body * FRACTION_MAX_ROW_GAP;
            let flanked = lines
                .iter()
                .any(|l| is_delimiter_only_line(l) && l.y <= lines[i].y + margin && l.y >= lines[j].y - margin);
            if flanked {
                continue;
            }
            if best.is_none_or(|(_, _, best_gap)| gap < best_gap) {
                best = Some((i, j, gap));
            }
        }
    }
    best.map(|(i, j, _)| (i, j))
}

/// Inserts `frac` into a baseline line's own content, at the gap that its
/// numerator and denominator were found to leave — see [`reconstruct_fractions`].
///
/// Best-effort rather than exact: a baseline's `Vec<Inline>` carries no
/// per-piece position, only the order pieces were assembled in, so the split
/// point is inferred as "just before whatever comes last" — right for the
/// common shape (`prefix = \frac{}{} suffix`, one trailing piece like a
/// period or nothing) and not guaranteed for a baseline with several
/// fractions or several trailing pieces of its own.
fn splice_into_baseline(line: &mut Line, frac: Inline) {
    // Before the last piece when there's more than one (prefix, ..., suffix —
    // insert ahead of the suffix); appended when there's nothing to split
    // ("R =" with nothing trailing at all).
    let insert_at = if line.content.len() > 1 {
        line.content.len() - 1
    } else {
        line.content.len()
    };
    line.content.insert(insert_at, frac);
}

/// Reconstructs a bar-less fraction: the vinculum LaTeX draws between a
/// numerator and denominator is a graphics path, not a character, so it is
/// invisible to the text layer and the two arrive as separate lines with
/// nothing connecting them. Detected by geometry alone — vertical stacking
/// and horizontal column overlap between two otherwise-unrelated maths-only
/// lines — and spliced into whichever baseline row (if any) straddles them.
///
/// Best-effort in the same spirit as `RADICAL_TAKES_REST`: a fully general
/// reconstruction needs the drawn vinculum itself, which this pipeline does
/// not read. With no baseline row present at all — an operator sitting
/// directly above the fraction, trailing content like `dz` beside it —
/// surrounding lines are ordered by which side of the fraction's own column
/// they fall on rather than spliced into a specific gap.
fn reconstruct_fractions(mut lines: Vec<Line>) -> Vec<Line> {
    while let Some((num_i, den_i)) = find_fraction_pair(&lines) {
        let frac = Inline::Maths(format!(
            "\\frac{{{}}}{{{}}}",
            combined_maths_latex(&lines[num_i]).trim(),
            combined_maths_latex(&lines[den_i]).trim(),
        ));
        let frac_x0 = lines[num_i].x.min(lines[den_i].x);

        // A baseline straddles the fraction: it starts before the fraction's
        // own column, with a prefix like "f(z) =" leading into it. Trailing
        // content that merely sits a little to the right of the fraction —
        // "dz" beside it, never in front of it — can extend past the
        // fraction's own right edge on its own, but never *starts* before
        // frac_x0, which is what actually distinguishes "wraps around the
        // fraction" from "sits beside it".
        let baseline = (num_i + 1..den_i).find(|&k| lines[k].x < frac_x0 - 1.0);

        if let Some(k) = baseline {
            splice_into_baseline(&mut lines[k], frac);
            let mut remove: Vec<usize> = (num_i..=den_i).filter(|&i| i != k).collect();
            remove.sort_unstable_by(|a, b| b.cmp(a));
            for i in remove {
                lines.remove(i);
            }
        } else {
            // No baseline: anything else between the pair sits beside the
            // fraction rather than around it — ordered by which side of the
            // fraction's own column it falls on.
            let mut prefix: Vec<Inline> = Vec::new();
            let mut suffix: Vec<Inline> = Vec::new();
            for between in &lines[(num_i + 1)..den_i] {
                if between.right <= frac_x0 {
                    prefix.extend(between.content.clone());
                } else {
                    suffix.extend(between.content.clone());
                }
            }
            let mut content = prefix;
            content.push(frac);
            content.extend(suffix);

            let replacement = Line {
                content,
                ..lines[den_i].clone()
            };
            lines.splice(num_i..=den_i, std::iter::once(replacement));
        }
    }
    lines
}

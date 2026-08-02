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
                Inline::Maths(_) => None,
            })
            .collect()
    }

    fn is_blank(&self) -> bool {
        self.text().trim().is_empty() && !self.content.iter().any(is_maths)
    }
}

fn is_maths(inline: &Inline) -> bool {
    matches!(inline, Inline::Maths(_))
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

/// The leading enumeration label on a connector baseline — `"(b) "` — read
/// straight off the row's own characters (including whatever whitespace
/// follows the `)`) so the reconstructed line keeps the source's own
/// spacing. Empty when the row opens with no such label.
pub(super) fn baseline_label(row: &[CharBox]) -> String {
    let mut sorted: Vec<CharBox> = row.iter().copied().collect();
    sorted.sort_by(|a, b| a.x.partial_cmp(&b.x).unwrap_or(std::cmp::Ordering::Equal));

    let Some(paren) = sorted.iter().position(|c| c.ch == ')') else {
        return String::new();
    };
    let trailing_space = sorted[paren + 1..].iter().take_while(|c| c.ch.is_whitespace()).count();
    sorted[..=paren + trailing_space].iter().map(|c| c.ch).collect()
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
        for (index, ch) in scripts {
            let best_row = rows
                .iter()
                .enumerate()
                .filter_map(|(row_index, row)| {
                    let anchor = row.iter().max_by(|(_, a), (_, b)| {
                        a.font_size.partial_cmp(&b.font_size).unwrap_or(std::cmp::Ordering::Equal)
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
    rows.into_iter().map(build_line).collect()
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

    // Everything outside the maths is whitespace, so the line *is* the
    // equation rather than a sentence containing one.
    let is_display_maths = content.iter().any(is_maths)
        && content.iter().all(|i| match i {
            Inline::Text(span) => span.text.trim().is_empty(),
            Inline::Maths(_) => true,
        });

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
            }
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
}

fn classify(line: &Line, body: f32, left_margin: f32) -> LineKind {
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
        let gap_break = index > 0
            && typical_gap > 0.0
            && (lines[index - 1].y - line.y).abs() > typical_gap * BLOCK_GAP_RATIO;

        // An unmarked line indented past the item it follows is that item's
        // second line, not a new paragraph.
        let continues_item = matches!(current_kind, LineKind::List(_, _))
            && kind == LineKind::Prose
            && !gap_break
            && current.first().is_some_and(|first| line.x > first.x + 1.0);

        // A list marker always opens a new item, and nothing accumulates onto
        // a heading; everything else only breaks when the kind changes.
        let opens_block =
            matches!(kind, LineKind::List(_, _)) || matches!(current_kind, LineKind::Heading(_));
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
            // separate equations.
            latex: lines
                .iter()
                .flat_map(|l| l.content.iter())
                .filter_map(|i| match i {
                    Inline::Maths(latex) => Some(latex.as_str()),
                    Inline::Text(_) => None,
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
    }
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

/// Renders blocks to Markdown, equations included: `$…$` inline and `$…$$` as
/// their own block.
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
            Block::MathsDisplay { latex } => parts.push(format!("$${latex}$$")),
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

// How far apart (in multiples of the larger line's font size) two maths-only
// lines can sit and still be considered a numerator/denominator pair, rather
// than two unrelated equations that happen to be nearby.
const FRACTION_MAX_ROW_GAP: f32 = 4.0;
// How much of the narrower line's width the two must share to count as
// "stacked on the same column" rather than merely nearby.
const FRACTION_MIN_OVERLAP_RATIO: f32 = 0.3;

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
            Inline::Text(_) => None,
        })
        .collect::<Vec<_>>()
        .join(" ")
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

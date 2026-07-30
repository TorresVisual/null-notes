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

        // An accent glyph sorts to just after the letter it sits above, so it
        // attaches to whatever was last emitted. With nothing before it there
        // is nothing to combine with, and it stays the standalone character.
        if let Some(combining) = combining_form(ch.ch) {
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
    }

    flush_spans(&mut spans, &mut content);

    // Everything outside the maths is whitespace, so the line *is* the
    // equation rather than a sentence containing one.
    let is_display_maths = content.iter().any(is_maths)
        && content.iter().all(|i| match i {
            Inline::Text(span) => span.text.trim().is_empty(),
            Inline::Maths(_) => true,
        });

    Line {
        x: row.first().map(|c| c.x).unwrap_or_default(),
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
            Some(run) if row[index].x - row[run.1 - 1].x <= em * MATHS_BRIDGE_EMS => {
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
        while run.0 > 0
            && !row[run.0 - 1].ch.is_alphabetic()
            // A ')' is never legitimate to pick up growing backward: an
            // equation opens a paren before its content and closes it after,
            // so backward growth only ever needs a '(' or an operator/digit.
            // A ')' encountered scanning backward is always the end of some
            // other, already-closed bracketed group — on a real sheet, an
            // enumeration label ("(a)") sitting right before a lone mathcal
            // variable with no source-level space wide enough to stop the
            // gap check, absorbing its closing paren and reading "(a$) C$"
            // instead of "(a) $\mathcal{C}$".
            && row[run.0 - 1].ch != ')'
            && gap_ok(run.0 - 1, run.0)
        {
            run.0 -= 1;
        }
        while run.1 < row.len() && !row[run.1].ch.is_alphabetic() && gap_ok(run.1 - 1, run.1) {
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

    // Growing outward can make neighbouring regions meet.
    runs.dedup_by(|later, earlier| {
        if later.0 <= earlier.1 {
            earlier.1 = earlier.1.max(later.1);
            true
        } else {
            false
        }
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
    blocks_to_markdown(&group_blocks(&group_lines(chars)))
}

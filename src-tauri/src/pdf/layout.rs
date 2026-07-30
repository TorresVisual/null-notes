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

use unicode_normalization::UnicodeNormalization;

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
    /// Set from the character's font family — see [`super::maths`].
    pub maths: bool,
    /// A maths *symbol* rather than a maths italic letter. Decides whether a
    /// region has to be cropped: `→` and `√` cannot be written as text, a lone
    /// italic `f` plainly can.
    pub symbol: bool,
}

/// A rectangle in PDF user space: origin bottom-left, `y1` above `y0`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub x0: f32,
    pub y0: f32,
    pub x1: f32,
    pub y1: f32,
}

impl Rect {
    fn around(chars: &[CharBox]) -> Option<Rect> {
        let first = chars.first()?;
        let mut rect = Rect {
            x0: first.x,
            y0: first.bottom,
            x1: first.x + first.width,
            y1: first.top,
        };
        for c in chars {
            rect.x0 = rect.x0.min(c.x);
            rect.y0 = rect.y0.min(c.bottom);
            rect.x1 = rect.x1.max(c.x + c.width);
            rect.y1 = rect.y1.max(c.top);
        }
        Some(rect)
    }

    pub fn width(&self) -> f32 {
        self.x1 - self.x0
    }

    pub fn height(&self) -> f32 {
        self.y1 - self.y0
    }

    /// The smallest rectangle containing all of them.
    fn union_all(rects: &[Rect]) -> Option<Rect> {
        let mut out = *rects.first()?;
        for r in rects {
            out.x0 = out.x0.min(r.x0);
            out.y0 = out.y0.min(r.y0);
            out.x1 = out.x1.max(r.x1);
            out.y1 = out.y1.max(r.y1);
        }
        Some(out)
    }

    /// Grows the rectangle on all sides, so a crop does not shave the
    /// antialiased edge off a glyph.
    pub fn padded(&self, pad: f32) -> Rect {
        Rect {
            x0: self.x0 - pad,
            y0: self.y0 - pad,
            x1: self.x1 + pad,
            y1: self.y1 + pad,
        }
    }

    /// Maps the rectangle onto a rendered page image as `(x, y, width, height)`.
    ///
    /// The two coordinate systems disagree about which way is up: PDF user
    /// space starts at the bottom-left, an image at the top-left, so the
    /// rectangle's *top* becomes the crop's `y`. Results are clamped to the
    /// image, and never zero-sized — a zero-width crop is an error in every
    /// image library.
    pub fn to_pixels(
        &self,
        page_width: f32,
        page_height: f32,
        image_width: u32,
        image_height: u32,
    ) -> (u32, u32, u32, u32) {
        if page_width <= 0.0 || page_height <= 0.0 {
            return (0, 0, 1, 1);
        }
        let scale_x = image_width as f32 / page_width;
        let scale_y = image_height as f32 / page_height;

        let left = (self.x0 * scale_x).floor().max(0.0) as u32;
        let top = ((page_height - self.y1) * scale_y).floor().max(0.0) as u32;
        let left = left.min(image_width.saturating_sub(1));
        let top = top.min(image_height.saturating_sub(1));

        let width = (self.width() * scale_x).ceil().max(1.0) as u32;
        let height = (self.height() * scale_y).ceil().max(1.0) as u32;

        (
            left,
            top,
            width.min(image_width - left).max(1),
            height.min(image_height - top).max(1),
        )
    }
}

/// A piece of a line: either text, or a region of mathematics that has to be
/// cropped from the rendered page because the text layer cannot express it.
#[derive(Debug, Clone, PartialEq)]
pub enum Inline {
    Text(Span),
    Maths(Rect),
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
    MathsDisplay { rects: Vec<Rect> },
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

/// Groups characters into lines by baseline, then into styled spans.
pub fn group_lines(chars: &[CharBox]) -> Vec<Line> {
    if chars.is_empty() {
        return Vec::new();
    }

    let mut sorted: Vec<CharBox> = chars.to_vec();
    // Down the page first, then left to right within a line.
    sorted.sort_by(|a, b| {
        b.y.partial_cmp(&a.y)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.x.partial_cmp(&b.x).unwrap_or(std::cmp::Ordering::Equal))
    });

    let mut rows: Vec<Vec<CharBox>> = Vec::new();
    // The row's reference baseline, taken from the largest character in it so
    // far. Anchoring to the row's *first* character instead is wrong twice
    // over: a row opened by a raised footnote marker keeps measuring from that
    // marker's baseline, which shifts the whole tolerance window up and drops
    // a diacritic sitting at the bottom of it — the umlaut of "abzuschätzen"
    // ends up stranded on a line of its own. Body text is the largest thing on
    // a line, so it is what the line should be measured from.
    let mut anchor: Option<CharBox> = None;

    for ch in sorted {
        let same_line = anchor.is_some_and(|a| {
            let scale = a.font_size.max(ch.font_size).max(1.0);
            // Symmetric: a raised exponent sorts above the line it belongs to
            // and so becomes the anchor itself, which made a one-sided test
            // compare the body text against the script instead.
            let is_script = a.font_size.min(ch.font_size) < scale * SCRIPT_SIZE_RATIO;
            let tolerance = if is_script {
                SCRIPT_BASELINE_TOLERANCE
            } else {
                BASELINE_TOLERANCE
            };
            (a.y - ch.y).abs() <= scale * tolerance
        });

        match rows.last_mut() {
            Some(row) if same_line => {
                if ch.font_size > anchor.map(|a| a.font_size).unwrap_or(0.0) {
                    anchor = Some(ch);
                }
                row.push(ch);
            }
            _ => {
                anchor = Some(ch);
                rows.push(vec![ch]);
            }
        }
    }

    rows.into_iter().map(build_line).collect()
}

fn build_line(mut row: Vec<CharBox>) -> Line {
    row.sort_by(|a, b| {
        a.x.partial_cmp(&b.x)
            .unwrap_or(std::cmp::Ordering::Equal)
            // An accent is placed at its letter's own x, so the two tie. It has
            // to land after the letter to combine with it, and which side of
            // the tie it fell on was otherwise decided by the order pdfium
            // happened to emit them in.
            .then_with(|| {
                combining_form(a.ch)
                    .is_some()
                    .cmp(&combining_form(b.ch).is_some())
            })
    });

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

    while index < row.len() {
        // A maths region is opaque: the text layer cannot express what it says,
        // so the characters inside it are replaced wholesale by a crop.
        if let Some(run) = runs.iter().find(|r| r.0 == index) {
            if let Some(rect) = Rect::around(&row[run.0..run.1]) {
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
                content.push(Inline::Maths(rect));
            }
            previous_end = row[run.0..run.1].last().map(|c| c.x + c.width);
            index = run.1;
            continue;
        }

        let ch = &row[index];
        index += 1;
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
        .filter(|(_, c)| c.maths && !c.ch.is_whitespace())
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
        while run.0 > 0 && !row[run.0 - 1].ch.is_alphabetic() && gap_ok(run.0 - 1, run.0) {
            run.0 -= 1;
        }
        while run.1 < row.len() && !row[run.1].ch.is_alphabetic() && gap_ok(run.1 - 1, run.1) {
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

    runs.retain(|run| needs_crop(&row[run.0..run.1]));
    runs
}

/// Whether a maths region actually has to become an image.
///
/// Being set in a maths font is not enough. Most inline maths on a page like
/// this is a single italic variable — `f`, `x`, `T` — which text says perfectly
/// well, and cropping each one litters the note with postage-stamp images that
/// read far worse than the letters would have. Only regions holding something
/// text genuinely cannot express earn a crop.
fn needs_crop(chars: &[CharBox]) -> bool {
    // Arrows, set operators, radicals, extensible brackets, blackboard bold.
    if chars.iter().any(|c| c.symbol) {
        return true;
    }

    // Anything outside ASCII is a symbol that survives extraction as mojibake
    // at best.
    if chars.iter().any(|c| !c.ch.is_ascii()) {
        return true;
    }

    // More than one baseline means superscripts or subscripts, and a flat
    // string cannot say "x squared".
    let printing: Vec<&CharBox> = chars.iter().filter(|c| !c.ch.is_whitespace()).collect();
    let Some(first) = printing.first() else {
        return false;
    };
    printing
        .iter()
        .any(|c| (c.y - first.y).abs() > first.font_size.max(1.0) * 0.1)
}

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
        let needs_space = index > 0
            && !matches!(out.last(), Some(Inline::Text(s)) if s.text.ends_with(' '))
            && !out.is_empty();
        if needs_space {
            push_text(&mut out, ' ', false, false);
        }
        for inline in &line.content {
            match inline {
                Inline::Maths(rect) => out.push(Inline::Maths(*rect)),
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
        LineKind::MathsDisplay => {
            let parts: Vec<Rect> = lines
                .iter()
                .flat_map(|l| l.content.iter())
                .filter_map(|i| match i {
                    Inline::Maths(rect) => Some(*rect),
                    Inline::Text(_) => None,
                })
                .collect();
            // One display equation routinely spans several baselines: a radical
            // sign, a fraction bar or a big operator is set on its own, so
            // "√(x² + y²)" arrives as one row holding the radical and another
            // holding what is under it. Cropping row by row cuts the equation
            // into unreadable slivers, so the block becomes a single crop of
            // the whole thing. Blocks are already split on vertical gaps, so
            // two genuinely separate equations stay separate.
            Block::MathsDisplay {
                rects: Rect::union_all(&parts).into_iter().collect(),
            }
        }
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

fn render_content(content: &[Inline], maths_src: &mut impl FnMut(Rect) -> String) -> String {
    let mut out = String::new();
    for inline in content {
        let span = match inline {
            Inline::Maths(rect) => {
                out.push_str(&format!("![]({})", maths_src(*rect)));
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

/// Renders blocks to Markdown. `maths_src` names the image each cropped maths
/// region will be written to — the crop itself happens where the rendered page
/// is available, which is not here.
pub fn blocks_to_markdown(
    blocks: &[Block],
    maths_src: &mut impl FnMut(Rect) -> String,
) -> String {
    let mut parts: Vec<String> = Vec::new();
    for block in blocks {
        match block {
            Block::Heading { level, content } => {
                let hashes = "#".repeat((*level).clamp(1, 6) as usize);
                parts.push(format!("{hashes} {}", render_content(content, maths_src)));
            }
            Block::Paragraph { content } => parts.push(render_content(content, maths_src)),
            Block::Code { text } => parts.push(format!("```\n{text}\n```")),
            Block::MathsDisplay { rects } => parts.push(
                rects
                    .iter()
                    .map(|rect| format!("![]({})", maths_src(*rect)))
                    .collect::<Vec<_>>()
                    .join(" "),
            ),
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
                    render_content(content, maths_src)
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

/// Every maths region on the page, in reading order — what the caller has to
/// crop, in the order `blocks_to_markdown` will ask for them.
pub fn maths_rects(blocks: &[Block]) -> Vec<Rect> {
    let mut rects = Vec::new();
    for block in blocks {
        match block {
            Block::MathsDisplay { rects: display } => rects.extend(display.iter().copied()),
            Block::Heading { content, .. }
            | Block::Paragraph { content }
            | Block::ListItem { content, .. } => {
                rects.extend(content.iter().filter_map(|i| match i {
                    Inline::Maths(rect) => Some(*rect),
                    Inline::Text(_) => None,
                }))
            }
            Block::Code { .. } => {}
        }
    }
    rects
}

/// The whole pipeline, with maths regions named but not cropped. Callers that
/// can render the page substitute real filenames; this shape is what the tests
/// and the no-image case use.
pub fn chars_to_markdown(chars: &[CharBox]) -> String {
    let blocks = group_blocks(&group_lines(chars));
    let mut index = 0;
    blocks_to_markdown(&blocks, &mut |_| {
        index += 1;
        format!("maths-{index}.png")
    })
}

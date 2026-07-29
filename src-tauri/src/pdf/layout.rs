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
    pub font_size: f32,
    pub bold: bool,
    pub italic: bool,
    pub fixed_pitch: bool,
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
    pub spans: Vec<Span>,
    pub x: f32,
    pub y: f32,
    pub font_size: f32,
    pub fixed_pitch: bool,
}

impl Line {
    pub fn text(&self) -> String {
        self.spans.iter().map(|s| s.text.as_str()).collect()
    }

    fn is_blank(&self) -> bool {
        self.text().trim().is_empty()
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Block {
    Heading { level: u8, spans: Vec<Span> },
    Paragraph { spans: Vec<Span> },
    Code { text: String },
    ListItem {
        ordered: bool,
        number: Option<u32>,
        depth: usize,
        spans: Vec<Span>,
    },
}

// Chars on one line share a baseline, but superscripts, subscripts and inline
// maths sit slightly off it. A fraction of the font size absorbs that without
// merging genuinely adjacent lines, whose spacing is at least ~1.0x.
const BASELINE_TOLERANCE: f32 = 0.4;
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

/// Lower median. Deliberately not the upper one: line gaps outnumber
/// paragraph gaps, so when a document has only a couple of gaps to judge from,
/// rounding towards the smaller keeps the paragraph break detectable.
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
            (a.y - ch.y).abs() <= scale * BASELINE_TOLERANCE
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

    let mut spans: Vec<Span> = Vec::new();
    let mut previous_end: Option<f32> = None;

    for ch in &row {
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

    // Composes each "u + combining diaeresis" back into a single "ü".
    for span in &mut spans {
        span.text = span.text.nfc().collect();
    }

    Line {
        x: row.first().map(|c| c.x).unwrap_or_default(),
        y: row.first().map(|c| c.y).unwrap_or_default(),
        spans,
        font_size,
        fixed_pitch,
    }
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

fn strip_leading_chars(spans: &[Span], mut count: usize) -> Vec<Span> {
    let mut out = Vec::new();
    for span in spans {
        if count == 0 {
            out.push(span.clone());
            continue;
        }
        let chars: Vec<char> = span.text.chars().collect();
        if chars.len() <= count {
            count -= chars.len();
            continue;
        }
        out.push(Span {
            text: chars[count..].iter().collect(),
            bold: span.bold,
            italic: span.italic,
        });
        count = 0;
    }
    out
}

fn trim_spans(spans: &[Span]) -> Vec<Span> {
    let mut out: Vec<Span> = spans.to_vec();
    if let Some(first) = out.first_mut() {
        first.text = first.text.trim_start().to_string();
    }
    if let Some(last) = out.last_mut() {
        last.text = last.text.trim_end().to_string();
    }
    out.retain(|s| !s.text.is_empty());
    out
}

/// Merges several lines into one flowing run, so a paragraph broken across
/// three PDF lines becomes one Markdown paragraph.
fn join_lines(lines: &[&Line]) -> Vec<Span> {
    let mut out: Vec<Span> = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        if index > 0 && !out.last().is_some_and(|s| s.text.ends_with(' ')) {
            push_char(&mut out, ' ', false, false);
        }
        for span in &line.spans {
            for ch in span.text.chars() {
                push_char(&mut out, ch, span.bold, span.italic);
            }
        }
    }
    trim_spans(&out)
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum LineKind {
    Prose,
    Code,
    Heading(u8),
    List(bool, usize),
}

fn classify(line: &Line, body: f32, left_margin: f32) -> LineKind {
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
        LineKind::Heading(level) => Block::Heading {
            level,
            spans: join_lines(lines),
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
                spans: strip_leading_chars(
                    &lines[0].spans,
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
                spans: join_lines(&refs),
            }
        }
        LineKind::Prose => Block::Paragraph {
            spans: join_lines(lines),
        },
    }
}

fn render_spans(spans: &[Span]) -> String {
    let mut out = String::new();
    for span in spans {
        let marker = match (span.bold, span.italic) {
            (true, true) => "***",
            (true, false) => "**",
            (false, true) => "*",
            (false, false) => "",
        };
        let trimmed = span.text.trim();
        if marker.is_empty() || trimmed.is_empty() {
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

pub fn blocks_to_markdown(blocks: &[Block]) -> String {
    let mut parts: Vec<String> = Vec::new();
    for block in blocks {
        match block {
            Block::Heading { level, spans } => {
                let hashes = "#".repeat((*level).clamp(1, 6) as usize);
                parts.push(format!("{hashes} {}", render_spans(spans)));
            }
            Block::Paragraph { spans } => parts.push(render_spans(spans)),
            Block::Code { text } => parts.push(format!("```\n{text}\n```")),
            Block::ListItem {
                ordered,
                number,
                depth,
                spans,
            } => {
                let indent = "  ".repeat(*depth);
                let marker = match (ordered, number) {
                    (true, Some(n)) => format!("{n}."),
                    (true, None) => "1.".to_string(),
                    (false, _) => "-".to_string(),
                };
                parts.push(format!("{indent}{marker} {}", render_spans(spans)));
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
    let lines = group_lines(chars);
    let blocks = group_blocks(&lines);
    blocks_to_markdown(&blocks)
}

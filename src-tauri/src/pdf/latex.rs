//! Rebuilds LaTeX from the glyphs of a typeset equation.
//!
//! The PDF holds no LaTeX, but it holds nearly enough to recover it. Which face
//! a glyph came from carries the meaning Computer Modern encoded there —
//! variables in `CMMI`, relations in `CMSY`, blackboard bold in `MSBM` — and the
//! geometry carries the structure: a smaller glyph above the baseline is an
//! exponent, below it a subscript.
//!
//! Cropping the region as an image was the previous answer and was visually
//! exact, but an image cannot be copied into a prompt, searched, or edited.
//! LaTeX can, and it renders natively in the editor.
//!
//! What this cannot recover is anything whose structure lives in *drawn rules*
//! rather than glyphs: a fraction's bar and a radical's vinculum are path
//! objects, not characters, so their extent is unknowable from the text layer.
//! Those degrade to a best-effort guess — see [`RADICAL_TAKES_REST`].
//!
//! Pure, and free of pdfium types, so all of it is testable.

use super::layout::CharBox;
use super::maths::Family;

/// A radical's vinculum — the bar over its radicand — is a drawn rule, not a
/// character, so nothing in the text layer says where it ends. The radicand is
/// assumed to run to the end of the region, which is right when the root is the
/// last term (`= √(x² + y²)`, the common shape) and too greedy when it is not.
const RADICAL_TAKES_REST: bool = true;

// A glyph this much smaller than the region's own size is a script rather than
// part of the base expression.
const SCRIPT_SIZE_RATIO: f32 = 0.9;
// And it has to sit at least this far off the baseline, in multiples of the
// base size, before its offset counts as deliberate.
//
// Deliberately small. The size test above has already established that the
// glyph is a script; this only has to pick which way. TeX drops a subscript far
// less than it raises a superscript — on a 12pt line the drop measures 1.8pt,
// against 4.4pt of rise — so a threshold sized for exponents silently swallows
// every subscript, turning "T_3" into "T3".
const SCRIPT_OFFSET_RATIO: f32 = 0.05;

#[derive(Debug, Clone, Copy, PartialEq)]
enum Level {
    Base,
    Super,
    Sub,
}

// A cursor jump this many multiples of the body size, with no space glyph
// between, is treated as a word gap — mirrors layout::SPACE_GAP. A maths region
// is built by slicing straight out of the page's character row, which bypasses
// layout's own gap-based space synthesis, so it has to be redone here or
// "= √(...)" loses its space and reads "=√(...)".
const SPACE_GAP: f32 = 0.22;

/// Renders a maths region as LaTeX, without the surrounding `$`.
pub fn to_latex(chars: &[CharBox]) -> String {
    // Spaces are kept even though LaTeX ignores them for layout: the output is
    // read by people and pasted into prompts, and "f(x) = 1" is far easier to
    // follow than "f(x)=1".
    let printing: Vec<CharBox> = synthesize_gaps(chars);
    if printing.iter().all(|c| c.ch.is_whitespace()) {
        return String::new();
    }

    let base_size = printing
        .iter()
        .filter(|c| !c.ch.is_whitespace())
        .map(|c| c.font_size)
        .fold(0.0_f32, f32::max);
    // The baseline of the full-size glyphs, not of whatever sorted first: a
    // region can open on an exponent.
    let base_y = printing
        .iter()
        .filter(|c| !c.ch.is_whitespace() && c.font_size >= base_size * SCRIPT_SIZE_RATIO)
        .map(|c| c.y)
        .next()
        .unwrap_or_else(|| printing[0].y);

    render(&printing, base_size, base_y).trim().to_string()
}

/// Inserts a synthetic space wherever two glyphs sit further apart than a
/// normal letter gap, chars is expected pre-sorted by `x`. A region is a
/// direct slice of the page row, so it never went through layout's own
/// gap-based synthesis.
fn synthesize_gaps(chars: &[CharBox]) -> Vec<CharBox> {
    let base = chars
        .iter()
        .filter(|c| !c.ch.is_whitespace())
        .map(|c| c.font_size)
        .fold(0.0_f32, f32::max)
        .max(1.0);

    let mut out = Vec::with_capacity(chars.len());
    let mut previous_end: Option<f32> = None;
    for &c in chars {
        let gap = previous_end.is_some_and(|end| c.x - end > base * SPACE_GAP);
        if gap && !c.ch.is_whitespace() && !out.last().is_some_and(|p: &CharBox| p.ch.is_whitespace()) {
            out.push(CharBox {
                ch: ' ',
                ..c
            });
        }
        previous_end = Some(c.x + c.width);
        out.push(c);
    }
    out
}

fn level_of(ch: &CharBox, base_size: f32, base_y: f32) -> Level {
    // A space carries no script level of its own; letting it take one would
    // split an exponent in two.
    if ch.ch.is_whitespace() {
        return Level::Base;
    }
    let smaller = ch.font_size < base_size * SCRIPT_SIZE_RATIO;
    let offset = ch.y - base_y;
    let threshold = base_size * SCRIPT_OFFSET_RATIO;

    if smaller && offset > threshold {
        Level::Super
    } else if smaller && offset < -threshold {
        Level::Sub
    } else {
        Level::Base
    }
}

fn render(chars: &[CharBox], base_size: f32, base_y: f32) -> String {
    let mut out = String::new();
    let mut index = 0usize;

    while index < chars.len() {
        let level = level_of(&chars[index], base_size, base_y);

        if level != Level::Base {
            // A run of glyphs at the same script level is one exponent, so
            // "e^{xy}" does not become "e^{x}^{y}".
            let start = index;
            while index < chars.len() && level_of(&chars[index], base_size, base_y) == level {
                index += 1;
            }
            let run = &chars[start..index];
            // Recursed so a nested script keeps working, measured against the
            // script's own size.
            let inner_size = run.iter().map(|c| c.font_size).fold(0.0_f32, f32::max);

            // A superscript run immediately followed by a subscript run
            // stacked at (about) the same x, with no base character drawn
            // between them, is not "raised to nothing, then lowered to
            // nothing" — it's a compact inline fraction set too small for a
            // separate numerator/denominator row pair: "R = 1/2" typeset
            // small enough that both digits are just script-sized glyphs at
            // one x.
            //
            // x-alignment alone is not enough to tell that apart from a
            // genuine sequential pair, though — found on Analysis_2_Blatt12.pdf:
            // "y'_1(t)" (a prime, then a subscript, both on base "y") sets the
            // prime and the "1" at nearly the same x too, since both simply
            // sit right where "y" ends. What actually distinguishes them is
            // whether a real base character immediately precedes the run at
            // all: a fraction's numerator is never attached to one — nothing
            // before "1" in "= 1/2" would sensibly take it as an exponent —
            // while every real superscript follows some base glyph directly.
            let has_preceding_base = start > 0 && !chars[start - 1].ch.is_whitespace();
            if level == Level::Super && !has_preceding_base && index < chars.len() {
                let aligned = (chars[index].x - run[0].x).abs() <= inner_size.max(1.0);
                if aligned && level_of(&chars[index], base_size, base_y) == Level::Sub {
                    let den_start = index;
                    while index < chars.len()
                        && level_of(&chars[index], base_size, base_y) == Level::Sub
                    {
                        index += 1;
                    }
                    let denominator = &chars[den_start..index];
                    let den_size =
                        denominator.iter().map(|c| c.font_size).fold(0.0_f32, f32::max);
                    let num = render(run, inner_size, run[0].y);
                    let den = render(denominator, den_size, denominator[0].y);
                    out.push_str("\\frac{");
                    out.push_str(num.trim());
                    out.push_str("}{");
                    out.push_str(den.trim());
                    out.push('}');
                    continue;
                }
            }

            let inner = render(run, inner_size, run[0].y);

            // A derivative prime is not a true exponent: LaTeX (and KaTeX)
            // render "y'" and "y''" as first/second-derivative notation on
            // their own, no "^" needed. Emitting one anyway ("y^'") still
            // renders identically, but it is not what anyone would actually
            // type, and it stops reading as prime notation the moment a
            // subscript follows it — "y^'_1" reads as "y, raised to ',
            // subscript 1", not "y-prime, sub 1".
            let is_prime_run = level == Level::Super
                && has_preceding_base
                && run.iter().all(|c| matches!(c.ch, '\'' | '′'));
            if is_prime_run {
                out.push_str(&inner);
                continue;
            }

            let marker = if level == Level::Super { '^' } else { '_' };
            out.push(marker);
            out.push_str(&brace(&inner));
            continue;
        }

        // A radical swallows the rest of the region, so it has to be handled
        // before the per-character path.
        if is_radical(&chars[index]) && RADICAL_TAKES_REST {
            let mut end = chars.len();
            // Sentence punctuation glued onto the end almost never belongs to
            // the radicand: the source reads "√(x²+y²)." with the period after
            // the equation, never inside it.
            while end > index + 1 && matches!(chars[end - 1].ch, '.' | ',' | ';' | ':' | '!' | '?')
            {
                end -= 1;
            }
            let rest = render(&chars[index + 1..end], base_size, base_y);
            out.push_str("\\sqrt{");
            out.push_str(rest.trim());
            out.push('}');
            out.push_str(&render(&chars[end..], base_size, base_y));
            return out;
        }

        // Consecutive upright letters are a function name or an operator name,
        // never a product of variables: "cos" must not become "c·o·s" in
        // italics.
        if let Some(word_len) = upright_word(&chars[index..]) {
            let word: String = chars[index..index + word_len].iter().map(|c| c.ch).collect();
            push_latex(&mut out, &operator_name(&word));
            index += word_len;
            continue;
        }

        if chars[index].ch.is_whitespace() {
            if !out.is_empty() && !out.ends_with(' ') {
                out.push(' ');
            }
            index += 1;
            continue;
        }

        push_latex(&mut out, &glyph(&chars[index]));
        index += 1;
    }

    out
}

/// LaTeX reads a run of letters straight through a backslash as one command
/// name — `\alpha` immediately followed by the variable `f` is not "α then
/// f", it is the single, undefined command `\alphaf`. A space breaks the
/// run without adding a visible gap: LaTeX (and KaTeX) consume whitespace
/// right after a control word as the command's own terminator, so it never
/// renders.
///
/// Only a *command's* trailing letters are ambiguous — two bare adjacent
/// variables ("xy", meaning x times y) must stay glued exactly as the source
/// had them, or `e^{xy}` grows a spurious `e^{x y}`. So the check walks back
/// from the end of `out` through its trailing letter run and asks whether a
/// `\` started it, not merely whether the last character was a letter.
fn push_latex(out: &mut String, next: &str) {
    let letters_start = out
        .rfind(|c: char| !c.is_ascii_alphabetic())
        .map(|i| i + 1)
        .unwrap_or(0);
    let ends_a_command = letters_start > 0
        && letters_start < out.len()
        && out.as_bytes()[letters_start - 1] == b'\\';

    if ends_a_command && next.chars().next().is_some_and(|c| c.is_ascii_alphabetic()) {
        out.push(' ');
    }
    out.push_str(next);
}

/// Wraps in braces unless it is a single token that does not need them.
fn brace(inner: &str) -> String {
    let bare_char = inner.chars().count() == 1 && !inner.starts_with('\\');
    if bare_char {
        inner.to_string()
    } else {
        format!("{{{inner}}}")
    }
}

pub(super) fn is_radical(ch: &CharBox) -> bool {
    // CMEX's radical is the glyph at 'p'; a Unicode maths font gives the real
    // character.
    ch.ch == '√' || (ch.family == Family::Extensible && matches!(ch.ch, 'p' | 'q' | 'r' | 's'))
}

/// CMEX10 has no Unicode contour-integral character; pdfium falls back to an
/// ASCII placeholder that varies with the symbol's rendered size — 'I' at
/// display style, 'H' at the smaller text style. Verified by cropping both
/// out of a real rendered page and looking at them, the same way every other
/// glyph-identity decision in this file was verified, rather than assumed
/// from an encoding table that may not even match this document's font
/// subset.
fn is_oint(ch: &CharBox) -> bool {
    ch.ch == '∮' || (ch.family == Family::Extensible && matches!(ch.ch, 'H' | 'I'))
}

/// CMEX10 has no Unicode plain-integral character either; pdfium falls back
/// to 'Z'. Verified the same way as [`is_oint`] — cropping it out of a real
/// rendered page (Analysis_2_Blatt1_2026.pdf's `∫ 1/(x√(ln x)) dx`) and
/// looking at it — not assumed from an encoding table. Less of a guess than
/// it looks: `cmex10` is Knuth's own Metafont program, the same physical
/// font essentially every LaTeX installation embeds unchanged, so pdfium's
/// "no ToUnicode entry, fall back to the glyph's raw index" behaviour for it
/// is a property of that one font, not of this document's producer — the
/// same reasoning that already justified `H`/`I` for `is_oint`.
///
/// A second placeholder, `'R'`, showed up on `Analysis_2_Blatt7_2026.pdf`'s
/// `∬_S` (item 1's surface flux) — confirmed the same way, by rendering the
/// page and cropping the glyph: two `'R'`s at Family::Extensible, raised
/// above the body-text baseline, immediately followed by an italic 'S'
/// subscript.
fn is_integral(ch: &CharBox) -> bool {
    ch.ch == '∫'
        || (ch.family == Family::Extensible && matches!(ch.ch, 'Z' | 'R'))
}

/// CMEX's large Σ has no Unicode entry in this font subset either —
/// confirmed on Ue9.pdf's Beispiel 9.3 by rendering the page: 'X' at
/// Family::Extensible immediately followed by a subscript/superscript pair,
/// the same way `is_integral`'s placeholders were confirmed.
fn is_sum(ch: &CharBox) -> bool {
    ch.family == Family::Extensible && ch.ch == 'X'
}

/// The large opening brace a `\cases`/piecewise definition needs — see
/// `large_paren_glyph`'s own doc comment for how this codepoint was
/// confirmed on Analysis_2_Blatt12.pdf. A dedicated predicate (rather than
/// matching `large_paren_glyph`'s string output) because `layout.rs`'s
/// `reconstruct_cases` pass needs to identify this specific glyph — not
/// render it — before any `Line`/`Inline` exists to render into, and
/// `large_paren_glyph` itself is private to this file.
pub(super) fn is_cases_brace(ch: &CharBox) -> bool {
    ch.family == Family::Extensible && ch.ch == '\u{1a}'
}

/// CMEX's large stretchy parentheses (the delimiters a multi-row vector or
/// a parenthesized subexpression needs) have no Unicode entry in this font
/// subset — confirmed on two documents by rendering the page and cropping
/// the glyphs: `'\u{12}'`/`'\u{13}'` on Analysis_2_Blatt11.pdf item 6 (a
/// 2-row vector field, 11.96pt), and `'\u{10}'`/`'\u{11}'` (outer) plus
/// `'\0'`/`'\u{1}'` (inner) on Ue9.pdf Beispiel 9.1(a) (nested logical
/// grouping, 10.91pt) — a different codepoint set in a different document,
/// because cmex is embedded per document at whatever design size that
/// document's body text uses. Mapped to plain ASCII parens: KaTeX sizes a
/// bare `(`/`)` adequately around a \frac-shaped body without needing
/// \left/\right for automatic stretch sizing, which this corpus doesn't
/// need.
///
/// The large opening brace a `\cases`/piecewise definition needs is a
/// separate glyph slot in the same font instance — confirmed on
/// Analysis_2_Blatt12.pdf's Heaviside definition (`'\u{1a}'`, same 11.96pt
/// document as Blatt11 but a different codepoint from its parens). There is
/// deliberately no matching close-brace case: real `\cases` LaTeX output
/// only ever draws a left brace, confirmed by the rendered page showing no
/// right brace either.
fn large_paren_glyph(ch: &CharBox) -> Option<&'static str> {
    if ch.family != Family::Extensible {
        return None;
    }
    if is_cases_brace(ch) {
        return Some("\\{");
    }
    match ch.ch {
        '\u{12}' | '\u{10}' | '\0' => Some("("),
        '\u{13}' | '\u{11}' | '\u{1}' => Some(")"),
        _ => None,
    }
}

/// Whether `ch` is one of the confirmed large stretchy bracket glyphs
/// `large_paren_glyph` already maps to plain ASCII parens — and if so,
/// whether it is the open or close half of the pair. A dedicated predicate
/// (rather than matching `large_paren_glyph`'s string output) because
/// `layout.rs`'s `reconstruct_matrices` pass needs to identify a row that
/// holds exactly one open and one close bracket glyph — not render them —
/// before any `Line`/`Inline` exists to render into. Same visibility
/// pattern as `is_cases_brace`, for the same reason.
pub(super) fn bracket_glyph(ch: &CharBox) -> Option<bool> {
    if ch.family != Family::Extensible {
        return None;
    }
    match ch.ch {
        '\u{12}' | '\u{10}' | '\0' => Some(true),
        '\u{13}' | '\u{11}' | '\u{1}' => Some(false),
        _ => None,
    }
}

/// How many characters from the front form an upright multi-letter word.
fn upright_word(chars: &[CharBox]) -> Option<usize> {
    let count = chars
        .iter()
        .take_while(|c| c.family == Family::Text && c.ch.is_ascii_alphabetic())
        .count();
    (count >= 2).then_some(count)
}

/// LaTeX operator names that TeX sets upright, in the *text* font family —
/// the same family as ordinary prose — rather than the maths-italic face
/// every variable uses. `layout.rs`'s region-growing needs this same list to
/// recognise one sitting inside an equation ("O(m log n)") rather than
/// treating its letters as the sentence that follows; keeping one shared
/// list is what stops the two from silently drifting apart.
pub(super) const KNOWN_OPERATOR_NAMES: [&str; 22] = [
    "arccos", "arcsin", "arctan", "cos", "cosh", "cot", "csc", "deg", "det", "dim", "exp", "gcd",
    "inf", "ker", "lim", "ln", "log", "max", "min", "sec", "sin", "sup",
];

/// The LaTeX for a run of upright letters: a known operator gets its command,
/// anything else stays upright inside `\mathrm`.
fn operator_name(word: &str) -> String {
    // Longest first, so "arccos" is not matched as "cos".
    if KNOWN_OPERATOR_NAMES.contains(&word.to_ascii_lowercase().as_str()) {
        format!("\\{}", word.to_ascii_lowercase())
    } else {
        format!("\\mathrm{{{word}}}")
    }
}

fn glyph(ch: &CharBox) -> String {
    match ch.family {
        Family::Blackboard => return format!("\\mathbb{{{}}}", ch.ch),
        Family::Script => return format!("\\mathcal{{{}}}", ch.ch),
        Family::Fraktur => return format!("\\mathfrak{{{}}}", ch.ch),
        _ => {}
    }

    // No "takes the rest" behaviour needed, unlike the radical: an oint's
    // subscript is an ordinary raised-or-lowered glyph immediately after it
    // in the stream, which the script-detection in render() already handles
    // the same way it handles every other subscript.
    if is_oint(ch) {
        return "\\oint".to_string();
    }

    if is_integral(ch) {
        return "\\int".to_string();
    }

    if is_sum(ch) {
        return "\\sum".to_string();
    }

    if let Some(paren) = large_paren_glyph(ch) {
        return paren.to_string();
    }

    if let Some(command) = symbol_command(ch.ch) {
        return command.to_string();
    }

    // LaTeX's own metacharacters, which a PDF prints as ordinary glyphs.
    match ch.ch {
        '%' => "\\%".into(),
        '&' => "\\&".into(),
        '#' => "\\#".into(),
        '$' => "\\$".into(),
        '_' => "\\_".into(),
        '{' => "\\{".into(),
        '}' => "\\}".into(),
        // Nothing above recognized this glyph, and extract.rs no longer
        // guarantees a maths-face control codepoint was already turned into
        // FFFD upstream (see resolve_fallback_char) — so make the loss
        // visible here instead of emitting an unprintable raw byte.
        other if other.is_control() => '\u{FFFD}'.to_string(),
        other => other.to_string(),
    }
}

/// Unicode maths characters mapped to the commands that produce them.
///
/// The text layer hands over real Unicode for most symbols, so this is a
/// translation rather than a guess.
fn symbol_command(ch: char) -> Option<&'static str> {
    Some(match ch {
        // Relations
        '→' | '⟶' => "\\to",
        '←' => "\\leftarrow",
        '↦' => "\\mapsto",
        '⇒' => "\\Rightarrow",
        '⇔' => "\\iff",
        '≤' => "\\leq",
        '≥' => "\\geq",
        '≠' => "\\neq",
        '≈' => "\\approx",
        '≡' => "\\equiv",
        '∼' => "\\sim",
        '≪' => "\\ll",
        '≫' => "\\gg",
        // Sets
        '∈' => "\\in",
        '∉' => "\\notin",
        '⊂' => "\\subset",
        '⊆' => "\\subseteq",
        '⊃' => "\\supset",
        '⊇' => "\\supseteq",
        '∪' => "\\cup",
        '∩' => "\\cap",
        '∅' => "\\emptyset",
        '∖' => "\\setminus",
        // Operators
        '−' => "-",
        '±' => "\\pm",
        '∓' => "\\mp",
        '×' => "\\times",
        '÷' => "\\div",
        '⋅' | '·' => "\\cdot",
        '∘' => "\\circ",
        '⊕' => "\\oplus",
        '⊗' => "\\otimes",
        // Large operators and calculus
        '∑' => "\\sum",
        '∏' => "\\prod",
        '∫' => "\\int",
        '∂' => "\\partial",
        '∇' => "\\nabla",
        '∞' => "\\infty",
        '′' => "'",
        // Logic
        '∀' => "\\forall",
        '∃' => "\\exists",
        '¬' => "\\neg",
        '∧' => "\\wedge",
        '∨' => "\\vee",
        // Greek, lower case
        'α' => "\\alpha",
        'β' => "\\beta",
        'γ' => "\\gamma",
        'δ' => "\\delta",
        'ε' | 'ϵ' => "\\varepsilon",
        'ζ' => "\\zeta",
        'η' => "\\eta",
        'θ' => "\\theta",
        'ι' => "\\iota",
        'κ' => "\\kappa",
        'λ' => "\\lambda",
        'μ' => "\\mu",
        'ν' => "\\nu",
        'ξ' => "\\xi",
        'π' => "\\pi",
        'ρ' => "\\rho",
        'σ' => "\\sigma",
        'τ' => "\\tau",
        'υ' => "\\upsilon",
        'φ' | 'ϕ' => "\\varphi",
        'χ' => "\\chi",
        'ψ' => "\\psi",
        'ω' => "\\omega",
        // Greek, upper case
        'Γ' => "\\Gamma",
        'Δ' => "\\Delta",
        'Θ' => "\\Theta",
        'Λ' => "\\Lambda",
        'Ξ' => "\\Xi",
        'Π' => "\\Pi",
        'Σ' => "\\Sigma",
        'Φ' => "\\Phi",
        'Ψ' => "\\Psi",
        'Ω' => "\\Omega",
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const BODY: f32 = 12.0;

    fn ch(c: char, x: f32, y: f32, size: f32, family: Family) -> CharBox {
        CharBox {
            ch: c,
            x,
            y,
            width: size * 0.5,
            top: y + size * 0.75,
            bottom: y - size * 0.25,
            font_size: size,
            bold: false,
            italic: false,
            fixed_pitch: false,
            family,
        }
    }

    #[test]
    fn recognises_the_cases_brace_placeholder_and_nothing_else_at_that_codepoint() {
        let brace = ch('\u{1a}', 300.0, 700.0, 12.0, Family::Extensible);
        assert!(is_cases_brace(&brace));

        // Same codepoint in a non-maths face is not the brace — it is
        // whatever ordinary character U+001A happens to be in that
        // document's body font, the same reasoning every other
        // placeholder-glyph predicate in this file already applies.
        let not_extensible = ch('\u{1a}', 300.0, 700.0, 12.0, Family::Text);
        assert!(!is_cases_brace(&not_extensible));

        let different_glyph = ch('\u{10}', 300.0, 700.0, 12.0, Family::Extensible);
        assert!(!is_cases_brace(&different_glyph));
    }

    /// Lays a string out on the baseline in one face.
    fn run(text: &str, family: Family) -> Vec<CharBox> {
        let mut out = Vec::new();
        let mut x = 100.0;
        for c in text.chars() {
            out.push(ch(c, x, 700.0, BODY, family));
            x += BODY * 0.5;
        }
        out
    }

    /// Lays a string out immediately after the end of an existing run, with no
    /// gap — the shape two adjacent glyph runs actually take in a PDF.
    fn adjoin(before: &[CharBox], text: &str, family: Family) -> Vec<CharBox> {
        let x = before.last().map(|c| c.x + c.width).unwrap_or(100.0);
        let mut out = before.to_vec();
        out.extend(run(text, family).into_iter().enumerate().map(|(i, mut c)| {
            c.x = x + i as f32 * BODY * 0.5;
            c
        }));
        out
    }

    /// A smaller glyph parked off the baseline, the way TeX sets a script.
    fn script(text: &str, x: f32, dy: f32, family: Family) -> Vec<CharBox> {
        let size = BODY * 0.7;
        let mut out = Vec::new();
        let mut cursor = x;
        for c in text.chars() {
            out.push(ch(c, cursor, 700.0 + dy, size, family));
            cursor += size * 0.5;
        }
        out
    }

    // Exact geometry captured from Analysis_2_Blatt12.pdf's "e^{-bs}/s ." (the
    // Laplace transform of the Heaviside step), via dump_chars_range. The
    // numerator "e^{-bs}" is itself two script levels deep — "e" is a script
    // relative to the body row, and "-bs" a further, smaller script relative
    // to "e" — which used to come out as "e^{-bs}s" (a bare superscript, the
    // denominator glued on after as plain text) once `group_lines` correctly
    // grouped every character into one row; this is `to_latex`'s own share
    // of that fix, using real widths (not the `.5*size` approximation `ch()`
    // gives every glyph) since gap synthesis is width-sensitive.
    //
    // The trailing "." is not decoration: `maths_runs` (`layout.rs`) grows a
    // region backward and forward over non-letter punctuation, so the real
    // region this function is ever called with includes it — and it is what
    // makes "e" itself body-size-relatively-small enough to read as the
    // numerator's own script in the first place. A numerator-only slice with
    // no period has no full-size character anywhere in it, so its own
    // `base_size` collapses to "e"'s size and there is nothing left for "e"
    // to be a script *of* — a shape `to_latex` is never actually called with
    // on a real document, which is why this test includes the period rather
    // than testing the fraction glyphs in isolation.
    #[test]
    fn a_compact_fraction_whose_numerator_has_its_own_nested_exponent() {
        fn real(c: char, x: f32, w: f32, y: f32, size: f32, family: Family) -> CharBox {
            CharBox {
                ch: c,
                x,
                y,
                width: w,
                top: y + size * 0.75,
                bottom: y - size * 0.25,
                font_size: size,
                bold: false,
                italic: false,
                fixed_pitch: false,
                family,
            }
        }
        let chars = vec![
            real('e', 484.506, 3.921, 369.074, 7.97, Family::Italic),
            real('\u{2212}', 488.434, 5.756, 371.887, 5.98, Family::Symbol),
            real('b', 494.190, 3.270, 371.887, 5.98, Family::Italic),
            real('s', 497.460, 3.491, 371.887, 5.98, Family::Italic),
            real('s', 491.023, 3.913, 360.245, 7.97, Family::Italic),
            real('.', 502.651, 3.252, 364.367, 11.96, Family::Text),
        ];
        assert_eq!(to_latex(&chars), r"\frac{e^{-bs}}{s} .");
    }

    #[test]
    fn plain_variables_pass_straight_through() {
        assert_eq!(to_latex(&run("f(x)", Family::Italic)), "f(x)");
    }

    #[test]
    fn a_raised_smaller_glyph_becomes_an_exponent() {
        let mut chars = run("x", Family::Italic);
        chars.extend(script("2", 106.0, 4.0, Family::Text));

        assert_eq!(to_latex(&chars), "x^2");
    }

    // Found on Analysis_2_Blatt11.pdf: "R = 1/2" typeset small enough that
    // the numerator and denominator are just two script-sized glyphs
    // stacked at one x, with no base character for either to attach to —
    // the digits arrived as `R = ^1_2`, "1" raised to nothing and "2"
    // lowered to nothing, rather than a fraction. Real coordinates: both "1"
    // and "2" sit at x=276.341, size 7.97, against a 11.96pt "R = ".
    #[test]
    fn a_stacked_pair_with_no_base_becomes_a_fraction() {
        let mut chars = run("R = ", Family::Text);
        let frac_x = chars.last().map(|c| c.x + c.width).unwrap_or(100.0);
        chars.extend(script("1", frac_x, 3.0, Family::Text));
        chars.extend(script("2", frac_x, -3.0, Family::Text));

        assert_eq!(to_latex(&chars), r"R = \frac{1}{2}");
    }

    // A regression the fraction fix above introduced and real-document
    // testing caught: "y'_1(t)" on Analysis_2_Blatt12.pdf — a prime
    // superscript immediately followed by a subscript, both on base "y" —
    // started rendering as `y\frac{'}{1}(t)` instead of `y'_1(t)`. x-alignment
    // alone doesn't tell a fraction's numerator apart from a real exponent:
    // both the prime and the "1" sit at essentially the same x here too,
    // simply because both attach right where "y" ends. What actually
    // distinguishes them is whether a real base character immediately
    // precedes the superscript run — "y" does, "= " (whitespace) doesn't.
    #[test]
    fn a_prime_and_subscript_on_the_same_base_is_not_mistaken_for_a_fraction() {
        let mut chars = run("y", Family::Italic);
        let x = chars.last().map(|c| c.x + c.width).unwrap_or(100.0);
        chars.extend(script("′", x, 3.0, Family::Symbol));
        chars.extend(script("1", x, -3.0, Family::Text));

        assert_eq!(to_latex(&chars), "y'_1");
    }

    // A derivative prime is real prime notation, not a genuine exponent:
    // LaTeX/KaTeX render "y'" on its own, no "^" needed. "y^'" renders
    // identically but is not what anyone would type by hand.
    #[test]
    fn a_prime_superscript_renders_without_a_caret() {
        let mut chars = run("y", Family::Italic);
        let x = chars.last().map(|c| c.x + c.width).unwrap_or(100.0);
        chars.extend(script("′", x, 3.0, Family::Symbol));

        assert_eq!(to_latex(&chars), "y'");
    }

    // A second derivative's double prime is still prime notation — "y''",
    // not "y^{''}" — and still needs no braces since it renders as two
    // plain characters straight after the base.
    #[test]
    fn a_double_prime_superscript_renders_without_a_caret_or_braces() {
        let mut chars = run("y", Family::Italic);
        let x = chars.last().map(|c| c.x + c.width).unwrap_or(100.0);
        chars.extend(script("′′", x, 3.0, Family::Symbol));

        assert_eq!(to_latex(&chars), "y''");
    }

    #[test]
    fn a_lowered_smaller_glyph_becomes_a_subscript() {
        let mut chars = run("T", Family::Italic);
        chars.extend(script("1", 106.0, -3.0, Family::Text));

        assert_eq!(to_latex(&chars), "T_1");
    }

    // A run at one script level is a single exponent: "e^{xy}", not "e^x^y".
    #[test]
    fn a_multi_glyph_exponent_is_braced_as_one() {
        let mut chars = run("e", Family::Italic);
        chars.extend(script("xy", 106.0, 4.0, Family::Italic));

        assert_eq!(to_latex(&chars), "e^{xy}");
    }

    #[test]
    fn blackboard_bold_becomes_mathbb() {
        assert_eq!(to_latex(&run("R", Family::Blackboard)), r"\mathbb{R}");
    }

    #[test]
    fn script_and_fraktur_faces_get_their_own_commands() {
        assert_eq!(to_latex(&run("F", Family::Script)), r"\mathcal{F}");
        assert_eq!(to_latex(&run("g", Family::Fraktur)), r"\mathfrak{g}");
    }

    #[test]
    fn symbols_become_their_commands() {
        assert_eq!(to_latex(&run("→", Family::Symbol)), r"\to");
        assert_eq!(to_latex(&run("∈", Family::Symbol)), r"\in");
        assert_eq!(to_latex(&run("≤", Family::Symbol)), r"\leq");
        assert_eq!(to_latex(&run("α", Family::Italic)), r"\alpha");
    }

    // Found against a real document: "αf+βg" rendered as `\alphaf+\betag` —
    // LaTeX reads the letters right through the backslash as one command
    // name, so `\alpha` glued to the variable `f` is the undefined command
    // `\alphaf`, not "α then f".
    #[test]
    fn a_greek_command_does_not_swallow_the_variable_after_it() {
        let chars = adjoin(&run("α", Family::Italic), "f", Family::Italic);
        assert_eq!(to_latex(&chars), r"\alpha f");
    }

    // The fix above must not glue together two bare variables that were
    // never separated by a command name — "xy" (x times y) stays "xy".
    #[test]
    fn two_bare_variables_stay_glued_with_no_command_between_them() {
        assert_eq!(to_latex(&run("xy", Family::Italic)), "xy");
    }

    // U+2212 is the real minus sign; a bare "-" is a hyphen and reads wrong.
    #[test]
    fn the_minus_sign_becomes_a_plain_hyphen_for_latex() {
        assert_eq!(to_latex(&run("−", Family::Symbol)), "-");
    }

    // Consecutive upright letters inside maths are a function name, never a
    // product of variables — "cos" must not come out as italic c·o·s.
    #[test]
    fn a_function_name_becomes_its_operator_command() {
        let chars = adjoin(&run("cos", Family::Text), "(x)", Family::Italic);
        assert_eq!(to_latex(&chars), r"\cos(x)");
    }

    #[test]
    fn an_unknown_upright_word_stays_upright() {
        assert_eq!(to_latex(&run("grad", Family::Text)), r"\mathrm{grad}");
    }

    #[test]
    fn a_single_upright_letter_is_not_treated_as_a_word() {
        assert_eq!(to_latex(&run("d", Family::Text)), "d");
    }

    // CMEX10 has no Unicode contour-integral character; pdfium hands back an
    // ASCII placeholder that differs by rendered size. Confirmed by cropping
    // both out of a real page and looking at them, not by trusting an
    // encoding table.
    #[test]
    fn the_contour_integral_placeholder_glyphs_become_oint() {
        assert_eq!(
            to_latex(&run("I", Family::Extensible)),
            r"\oint",
            "display-style placeholder"
        );
        assert_eq!(
            to_latex(&run("H", Family::Extensible)),
            r"\oint",
            "text-style placeholder"
        );
    }

    #[test]
    fn an_oints_subscript_is_an_ordinary_subscript() {
        let mut chars = run("I", Family::Extensible);
        // A plain subscript variable, not the mathcal contour label — that
        // combination is covered by the real-document check below.
        chars.extend(script("n", 106.0, -3.0, Family::Italic));
        assert_eq!(to_latex(&chars), "\\oint_n");
    }

    // The exact shape a real contour integral takes: \oint with a \mathcal
    // subscript, both resolved through the normal per-glyph machinery with no
    // special-casing between them.
    #[test]
    fn an_oint_with_a_mathcal_contour_label_matches_the_real_document() {
        let mut chars = run("I", Family::Extensible);
        chars.extend(script("C", 106.0, -3.0, Family::Script));
        assert_eq!(to_latex(&chars), r"\oint_{\mathcal{C}}");
    }

    // A body-font 'H'/'I' is an ordinary letter and must not be mistaken for
    // the symbol — the mapping is scoped to Family::Extensible specifically.
    #[test]
    fn an_ordinary_h_or_i_is_not_mistaken_for_oint() {
        assert_eq!(to_latex(&run("H", Family::Text)), "H");
        assert_eq!(to_latex(&run("I", Family::Text)), "I");
    }

    // CMEX10 has no Unicode plain-integral character either; pdfium hands
    // back 'Z'. Confirmed the same way as the oint placeholders — cropping
    // it out of a real rendered page (Analysis_2_Blatt1_2026.pdf) and
    // looking at it.
    #[test]
    fn the_integral_placeholder_glyph_becomes_int() {
        assert_eq!(to_latex(&run("Z", Family::Extensible)), r"\int");
    }

    // A body-font or maths-italic 'Z' is an ordinary letter/variable and
    // must not be mistaken for the symbol — scoped to Family::Extensible.
    #[test]
    fn an_ordinary_z_is_not_mistaken_for_an_integral() {
        assert_eq!(to_latex(&run("Z", Family::Text)), "Z");
        assert_eq!(to_latex(&run("Z", Family::Italic)), "Z");
    }

    // Analysis_2_Blatt7_2026.pdf: a double integral (∬_S, surface flux)
    // rendered as $$RR$$ — each ∫ independently corrupted to the letter
    // 'R'. Confirmed by cropping it out of the rendered page (item 1's
    // "∬_S v⃗ · do⃗"), the same way the 'Z' mapping above it was confirmed:
    // both 'R' glyphs sit at 11.96pt, Family::Extensible, raised above the
    // surrounding body-text baseline, immediately followed by an italic 'S'
    // subscript — exactly the shape of a double integral with a region
    // label.
    #[test]
    fn a_second_integral_placeholder_glyph_becomes_int() {
        assert_eq!(to_latex(&run("R", Family::Extensible)), r"\int");
    }

    #[test]
    fn an_ordinary_r_is_not_mistaken_for_an_integral() {
        assert_eq!(to_latex(&run("R", Family::Text)), "R");
        assert_eq!(to_latex(&run("R", Family::Italic)), "R");
    }

    // Ue9.pdf Beispiel 9.3: the inclusion-exclusion formula's leading
    // Σ_{k=1}^n rendered as U+FFFD before this mapping existed (extract.rs
    // was erasing its control-range fallback upstream). Confirmed by
    // rendering the page: 'X' at Family::Extensible immediately followed by
    // a subscript "k=1" and superscript "n" — exactly the shape of a
    // sum with explicit limits.
    #[test]
    fn the_sum_placeholder_glyph_becomes_sum() {
        assert_eq!(to_latex(&run("X", Family::Extensible)), r"\sum");
    }

    #[test]
    fn an_ordinary_x_is_not_mistaken_for_a_sum() {
        assert_eq!(to_latex(&run("X", Family::Text)), "X");
        assert_eq!(to_latex(&run("X", Family::Italic)), "X");
    }

    // Analysis_2_Blatt11.pdf item 6: a 2-row vector field `⃗v(x, y) =
    // (3x²-3y²+2x+2y, -6xy+2x-2y)` rendered with stray U+FFFD before and
    // after its rows — the large open/close parens. Confirmed by rendering
    // the page: '\u{12}' immediately before the top row, '\u{13}'
    // immediately after the bottom row, both at Family::Extensible,
    // 11.96pt.
    #[test]
    fn the_blatt11_large_paren_placeholders_become_plain_parens() {
        assert_eq!(to_latex(&run("\u{12}", Family::Extensible)), "(");
        assert_eq!(to_latex(&run("\u{13}", Family::Extensible)), ")");
    }

    #[test]
    fn bracket_glyph_identifies_open_and_close_placeholders() {
        let open = ch('\u{12}', 300.0, 700.0, 11.96, Family::Extensible);
        let close = ch('\u{13}', 300.0, 700.0, 11.96, Family::Extensible);
        assert_eq!(bracket_glyph(&open), Some(true));
        assert_eq!(bracket_glyph(&close), Some(false));

        // The second confirmed codepoint pair (Ue9.pdf's outer nesting level).
        assert_eq!(bracket_glyph(&ch('\u{10}', 300.0, 700.0, 11.96, Family::Extensible)), Some(true));
        assert_eq!(bracket_glyph(&ch('\u{11}', 300.0, 700.0, 11.96, Family::Extensible)), Some(false));

        // The cases-brace glyph is a real Extensible glyph but not a bracket.
        assert_eq!(bracket_glyph(&ch('\u{1a}', 300.0, 700.0, 11.96, Family::Extensible)), None);

        // Same codepoint outside Family::Extensible is not a bracket at all.
        assert_eq!(bracket_glyph(&ch('\u{12}', 300.0, 700.0, 11.96, Family::Text)), None);
    }

    // Ue9.pdf Beispiel 9.1(a): ¬∀y((∃xP(x,y)) → ∀z¬(∃xQ(x,y,z))). rendered
    // with U+FFFD in place of every paren of the two nesting depths.
    // Confirmed by rendering the page: '\u{10}'/'\u{11}' bracket the whole
    // parenthesized implication (the outer, taller pair), '\0'/'\u{1}'
    // bracket each ∃-subexpression (the inner, shorter pair) — all four at
    // Family::Extensible, 10.91pt. Different codepoints from Blatt11's pair
    // above: cmex is embedded per document at whatever design size that
    // document's body text uses, so the same visual glyph can land at a
    // different raw code in a different font instance — exactly the
    // per-subset variability `is_integral`'s doc comment already warns
    // about, confirmed here to actually occur rather than assumed.
    #[test]
    fn the_ue9_nested_large_paren_placeholders_become_plain_parens() {
        assert_eq!(to_latex(&run("\u{10}", Family::Extensible)), "(");
        assert_eq!(to_latex(&run("\u{11}", Family::Extensible)), ")");
        assert_eq!(to_latex(&run("\u{0}", Family::Extensible)), "(");
        assert_eq!(to_latex(&run("\u{1}", Family::Extensible)), ")");
    }

    #[test]
    fn ordinary_control_codepoints_outside_the_confirmed_set_are_not_mistaken_for_parens() {
        assert_eq!(to_latex(&run("\u{2}", Family::Extensible)), "\u{FFFD}");
    }

    // Analysis_2_Blatt12.pdf: the Heaviside piecewise definition
    // "H(t-b) = { 1 for t≥b, 0 for t<b" rendered its opening brace as
    // U+FFFD. Confirmed by rendering the page: '\u{1a}' at
    // Family::Extensible, 11.96pt (same document, same size as item 6's
    // vector parens but a distinct codepoint — a different glyph slot in
    // the same font instance). No closing-brace codepoint exists to find:
    // \cases/piecewise notation only ever draws a left brace in real LaTeX
    // output, confirmed by the rendered page showing no matching right
    // brace either.
    #[test]
    fn the_cases_open_brace_placeholder_becomes_a_plain_brace() {
        assert_eq!(to_latex(&run("\u{1a}", Family::Extensible)), "\\{");
    }

    // Once extract.rs stops collapsing maths-face fallback codepoints to
    // FFFD (see extract.rs's resolve_fallback_char), latex.rs can receive a
    // real control character it has no predicate for yet. It must never
    // leak that raw byte into the rendered LaTeX — same "make the loss
    // visible instead of silent" principle extract.rs already applies to
    // body text, just enforced here for whatever the maths-face predicates
    // above this fallback don't recognize.
    #[test]
    fn an_unrecognized_control_glyph_in_a_maths_face_becomes_fffd_not_a_raw_byte() {
        assert_eq!(to_latex(&run("\u{3}", Family::Extensible)), "\u{FFFD}");
    }

    #[test]
    fn a_radical_takes_the_rest_of_the_expression() {
        let chars = adjoin(&run("√", Family::Extensible), "x + y", Family::Italic);
        assert_eq!(to_latex(&chars), r"\sqrt{x + y}");
    }

    // "√(x²+y²)." — the radicand must not swallow the sentence's own full stop.
    #[test]
    fn trailing_punctuation_stays_outside_the_radical() {
        let chars = adjoin(&run("√", Family::Extensible), "x+y.", Family::Italic);
        assert_eq!(to_latex(&chars), r"\sqrt{x+y}.");
    }

    // CMEX has no Unicode radical: the glyph is named after an ASCII letter.
    #[test]
    fn the_computer_modern_radical_glyph_is_recognised() {
        let chars = adjoin(&run("p", Family::Extensible), "2", Family::Text);
        assert_eq!(to_latex(&chars), r"\sqrt{2}");
    }

    #[test]
    fn latex_metacharacters_are_escaped() {
        assert_eq!(to_latex(&run("%", Family::Text)), r"\%");
        assert_eq!(to_latex(&run("&", Family::Text)), r"\&");
    }

    // Spacing is cosmetic in LaTeX but not in a prompt.
    #[test]
    fn the_sources_own_spacing_survives() {
        assert_eq!(to_latex(&run("f = 1", Family::Italic)), "f = 1");
    }

    // A region is sliced straight out of the page's character row, bypassing
    // layout's own gap-based space synthesis — found on a real sheet, where
    // "f(x, y) = √(...)" merged into "=\sqrt{...}" with no space at all.
    #[test]
    fn a_wide_cursor_jump_with_no_space_glyph_still_gets_a_space() {
        let mut chars = run("=", Family::Text);
        chars.extend(run("x", Family::Italic).into_iter().map(|mut c| {
            c.x += 30.0; // well past a normal letter gap
            c
        }));

        assert_eq!(to_latex(&chars), "= x");
    }

    #[test]
    fn an_empty_or_blank_region_produces_nothing() {
        assert_eq!(to_latex(&[]), "");
        assert_eq!(to_latex(&run("   ", Family::Text)), "");
    }
}

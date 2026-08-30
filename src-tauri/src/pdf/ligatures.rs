//! Recovers two kinds of real, body-sized glyph that pdfium could only
//! report as a font-specific control codepoint — collapsed to `U+FFFD` by
//! `extract::resolve_fallback_char` for body text specifically because the
//! letters they represent are producer- and font-specific and unsafe to
//! guess from geometry alone:
//!
//! - a `ff`/`fi`/`fl`/`ffi`/`ffl` ligature, embedded inside a word
//! - a German typographic quote (opening `„` or closing `"`), standing at a
//!   word's edge with nothing but whitespace or text-boundary beyond it
//!
//! Geometry gives up nothing more for the ligature case —
//! `dump_ligature_widths` measured a confirmed `ff` glyph at the same width
//! as independently-decoded `f`+`i`, so even ligature *length* isn't
//! distinguishable by width (see `TODO.md`). The one signal that *is*
//! font-agnostic: which candidate, substituted back in, turns the
//! surrounding letters into a real word. The quote case needs no dictionary
//! at all — position alone (touching a letter on one side, a boundary on the
//! other) tells opening from closing unambiguously, the same way it does for
//! a human reader.
//!
//! Pure string logic, no `pdfium` dependency, so it lives alongside
//! `layout.rs`'s other judgement calls rather than in `extract.rs`.

/// Every ligature a Computer Modern text font can collapse to one glyph.
/// Ordered longest-first so a 3-letter candidate is tried before the
/// 2-letter prefix it contains.
const CANDIDATES: [&str; 5] = ["ffi", "ffl", "ff", "fi", "fl"];

/// German's opening quote — low, turned the other way from the closing mark.
const OPENING_QUOTE: char = '\u{201E}';
/// German's closing quote — reuses the *English opening* curly-quote glyph.
const CLOSING_QUOTE: char = '\u{201C}';

fn is_word_char(c: char) -> bool {
    c.is_alphabetic() || c == '\u{FFFD}'
}

/// Replaces every body-text `U+FFFD` in `text` that has an unambiguous
/// resolution: a lone placeholder at a word's edge, touching a letter with
/// only whitespace or a text boundary beyond it, is a German quote mark —
/// direction read straight off which side the letter is on. A placeholder
/// embedded inside a word is a ligature, resolved to whichever candidate
/// makes that word real in German or English, when exactly one does.
/// Anything left ambiguous — no candidate, more than one, or more than one
/// placeholder in the same word — stays `U+FFFD`: visible, not silently
/// wrong.
pub fn disambiguate(text: &str) -> String {
    if !text.contains('\u{FFFD}') {
        return text.to_string();
    }

    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while i < chars.len() {
        if chars[i] != '\u{FFFD}' {
            out.push(chars[i]);
            i += 1;
            continue;
        }

        if let Some(quote) = quote_replacement(&chars, i) {
            out.push(quote);
            i += 1;
            continue;
        }

        let start = word_start(&chars, i);
        let end = word_end(&chars, i);
        // A ligature sits *inside* a word — real letters on both sides of
        // it — never standing alone. Without this, a stray marker flanked
        // by whitespace on both sides (already ruled out as a quote above)
        // would be "resolved" by checking whether a bare candidate like
        // "ff" happens to be a dictionary entry on its own, which is a
        // different, wrong question.
        let embedded = start < i && i + 1 < end;
        let word: String = chars[start..end].iter().collect();

        // Only the placeholder itself is replaced: `out` already holds
        // `word`'s prefix (pushed char-by-char on earlier iterations of this
        // same loop) and its suffix is still to come on later ones — the
        // ligature candidate is the only part this iteration owns.
        if embedded && word.matches('\u{FFFD}').count() == 1 {
            if let Some(ligature) = resolve_ligature(&word) {
                out.push_str(ligature);
                i += 1;
                continue;
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

/// Whether `chars[index]` (a placeholder) sits at a German quote's position:
/// touching a letter on one side and nothing but whitespace or a text
/// boundary on the other. `„` opens right against the word that follows;
/// `"` closes right against the word that precedes — never the reverse, and
/// never both a letter *and* whitespace on the same side, so the two cases
/// can't collide.
fn quote_replacement(chars: &[char], index: usize) -> Option<char> {
    let before_is_boundary = index == 0 || chars[index - 1].is_whitespace();
    let after_is_letter = chars.get(index + 1).is_some_and(|c| c.is_alphabetic());
    if before_is_boundary && after_is_letter {
        return Some(OPENING_QUOTE);
    }

    let before_is_letter = index > 0 && chars[index - 1].is_alphabetic();
    let after_is_boundary = index + 1 >= chars.len() || chars[index + 1].is_whitespace();
    if before_is_letter && after_is_boundary {
        return Some(CLOSING_QUOTE);
    }

    None
}

fn word_start(chars: &[char], index: usize) -> usize {
    let mut start = index;
    while start > 0 && is_word_char(chars[start - 1]) {
        start -= 1;
    }
    start
}

fn word_end(chars: &[char], index: usize) -> usize {
    let mut end = index + 1;
    while end < chars.len() && is_word_char(chars[end]) {
        end += 1;
    }
    end
}

/// Tries every ligature candidate in `word`'s single `U+FFFD` slot; returns
/// the candidate itself (not the substituted word) when exactly one turns
/// `word` into a real dictionary word, `None` when zero or more than one do.
fn resolve_ligature(word: &str) -> Option<&'static str> {
    let mut matches = CANDIDATES
        .iter()
        .copied()
        .filter(|candidate| is_known_word(&word.replacen('\u{FFFD}', candidate, 1)));

    let first = matches.next()?;
    match matches.next() {
        None => Some(first),
        Some(_) => None,
    }
}

fn is_known_word(word: &str) -> bool {
    let lower = word.to_lowercase();
    dictionary::contains(&lower)
}

mod dictionary {
    use std::collections::HashSet;
    use std::sync::OnceLock;

    static WORDS: OnceLock<HashSet<String>> = OnceLock::new();

    pub fn contains(lowercase_word: &str) -> bool {
        WORDS
            .get_or_init(|| {
                random_word::all(random_word::Lang::De)
                    .iter()
                    .chain(random_word::all(random_word::Lang::En).iter())
                    .map(|w| w.to_lowercase())
                    .collect()
            })
            .contains(lowercase_word)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_a_single_unambiguous_ligature() {
        assert_eq!(disambiguate("getro\u{FFFD}en"), "getroffen");
    }

    #[test]
    fn leaves_the_placeholder_when_no_candidate_is_a_real_word() {
        assert_eq!(disambiguate("qx\u{FFFD}zq"), "qx\u{FFFD}zq");
    }

    #[test]
    fn leaves_text_without_a_placeholder_untouched() {
        assert_eq!(disambiguate("ordinary text"), "ordinary text");
    }

    #[test]
    fn leaves_a_word_with_two_placeholders_untouched() {
        let word = "\u{FFFD}\u{FFFD}";
        assert_eq!(disambiguate(word), word);
    }

    #[test]
    fn resolves_an_opening_quote_touching_its_word() {
        assert_eq!(
            disambiguate("Art \u{FFFD}Ableitung\u{FFFD} der"),
            "Art „Ableitung\u{201C} der"
        );
    }

    #[test]
    fn resolves_a_closing_quote_at_the_end_of_text() {
        assert_eq!(disambiguate("classy\u{FFFD}"), "classy\u{201C}");
    }

    #[test]
    fn resolves_an_opening_quote_at_the_start_of_text() {
        assert_eq!(disambiguate("\u{FFFD}classy"), "„classy");
    }

    // A bullet-style marker — a placeholder with a *space* after it, not a
    // letter — is not a quote (a real opening quote touches its word directly)
    // and has no dictionary word to resolve either; must stay a visible loss.
    #[test]
    fn a_standalone_marker_with_space_on_both_sides_is_left_alone() {
        assert_eq!(
            disambiguate(".\n\u{FFFD} Wenn alle"),
            ".\n\u{FFFD} Wenn alle"
        );
    }

    // Empirical coverage probe, not a correctness assertion — prints which of
    // the real words from Analysis_2_Blatt12.pdf the bundled dictionary
    // actually contains, so the design (whole-word lookup vs. a fallback) is
    // chosen from evidence rather than assumption. Run with --nocapture.
    #[test]
    fn dictionary_coverage_probe() {
        for word in [
            "differentialgleichung",
            "getroffen",
            "trifft",
            "koeffizienten",
            "klassifizieren",
            "differenzierbaren",
        ] {
            println!("{word}: {}", dictionary::contains(word));
        }
    }
}

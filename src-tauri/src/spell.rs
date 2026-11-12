use spellbook::Dictionary;
use std::sync::OnceLock;

const TECH_WORDS: &str = include_str!("../dictionaries/tech.txt");

static DE: OnceLock<Option<Dictionary>> = OnceLock::new();
static EN: OnceLock<Option<Dictionary>> = OnceLock::new();

/// Hunspell dictionaries are compiled into the binary rather than read from the
/// OS: the WebView's own checker depends on whichever language packs the
/// machine has, which is exactly the inconsistency this replaces.
///
/// `None` only if a bundled file fails to parse; the tests below pin that it doesn't.
fn build(aff: &str, dic: &str) -> Option<Dictionary> {
    let mut dict = Dictionary::new(aff, dic).ok()?;
    for word in TECH_WORDS.lines().map(str::trim).filter(|w| !w.is_empty()) {
        let _ = dict.add(word);
    }
    Some(dict)
}

fn dictionary(lang: &str) -> Option<&'static Dictionary> {
    let lang = lang.to_ascii_lowercase();
    if lang == "de" || lang.starts_with("de-") {
        DE.get_or_init(|| {
            build(
                include_str!("../dictionaries/de.aff"),
                include_str!("../dictionaries/de.dic"),
            )
        })
        .as_ref()
    } else {
        EN.get_or_init(|| {
            build(
                include_str!("../dictionaries/en.aff"),
                include_str!("../dictionaries/en.dic"),
            )
        })
        .as_ref()
    }
}

fn normalise(word: &str) -> String {
    word.replace('\u{2019}', "'")
}

/// The words from `words` that `lang` does not accept, without duplicates.
pub fn misspelled(lang: &str, words: &[String]) -> Vec<String> {
    let Some(dict) = dictionary(lang) else {
        return Vec::new();
    };
    let mut seen = std::collections::HashSet::new();
    words
        .iter()
        .filter(|w| seen.insert(w.as_str()))
        .filter(|w| !dict.check(&normalise(w)))
        .cloned()
        .collect()
}

pub fn suggestions(lang: &str, word: &str) -> Vec<String> {
    let mut out = Vec::new();
    if let Some(dict) = dictionary(lang) {
        dict.suggest(&normalise(word), &mut out);
    }
    out.truncate(6);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bad(lang: &str, words: &[&str]) -> Vec<String> {
        let owned: Vec<String> = words.iter().map(|w| w.to_string()).collect();
        misspelled(lang, &owned)
    }

    #[test]
    fn bundled_dictionaries_parse() {
        assert!(dictionary("de").is_some());
        assert!(dictionary("en").is_some());
    }

    #[test]
    fn german_accepts_compounds_and_inflection() {
        assert!(bad(
            "de",
            &["Rechtschreibprüfung", "Datenstrukturen", "Haus", "laufen"]
        )
        .is_empty());
    }

    #[test]
    fn german_flags_typos_and_wrong_case() {
        assert_eq!(bad("de", &["Rechtschreibpruefung", "haus"]).len(), 2);
    }

    #[test]
    fn english_flags_typos() {
        assert_eq!(bad("en", &["recieve", "the", "receive"]), vec!["recieve"]);
    }

    #[test]
    fn programming_terms_pass_in_both_languages() {
        assert!(bad("en", &["cout", "stdout", "Mutex"]).is_empty());
        assert!(bad("de", &["cout", "stdout", "Mutex"]).is_empty());
    }

    #[test]
    fn suggests_the_intended_word() {
        assert!(suggestions("en", "recieve").contains(&"receive".to_string()));
        assert!(suggestions("de", "Hauss").contains(&"Haus".to_string()));
    }

    #[test]
    fn curly_apostrophes_match_the_dictionary() {
        assert!(bad("en", &["don\u{2019}t"]).is_empty());
    }

    #[test]
    fn unknown_language_falls_back_to_english() {
        assert_eq!(bad("fr", &["recieve"]).len(), 1);
    }
}

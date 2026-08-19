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

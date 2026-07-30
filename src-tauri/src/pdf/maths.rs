//! Recognises which characters belong to typeset mathematics.
//!
//! A LaTeX PDF contains no LaTeX. An equation arrives as a run of glyphs in
//! maths fonts, and reading it as text produces confident nonsense: `√(x²+y²)`
//! comes back as `p x2 + y2`, because the radical is a glyph named `p` in an
//! extension font and the exponents are ordinary digits parked above the
//! baseline. There is no reconstruction to be had from the text layer — the
//! honest move is to detect these runs and crop them out of the rendered page
//! instead.
//!
//! Pure and font-name-only, so the judgement stays testable.

/// Font families that carry mathematics rather than prose.
///
/// Computer Modern splits maths across several: `CMMI` (math italic — every
/// variable), `CMSY` (symbols — the arrows, set operators, minus signs),
/// `CMEX` (extensible delimiters and radicals), and the AMS faces `MSAM`/`MSBM`
/// (blackboard bold, so `R` for the reals). `RSFS` is the script alphabet.
/// The rest cover the common non-LaTeX producers.
const MATHS_FAMILIES: [&str; 10] = [
    "CMMI", "CMSY", "CMEX", "MSAM", "MSBM", "RSFS", "EUFRAK", "EUSM", "STIX", "MATHJAX",
];

/// The subset of those that carry *symbols* rather than italic letters.
///
/// The distinction decides whether a region has to be cropped. `CMMI` holds the
/// maths italic alphabet, so a lone `f` or `x` from it is a perfectly ordinary
/// italic letter and cropping it produces a postage-stamp image where a word
/// would do. These faces hold the things text genuinely cannot say: `→`, `∈`,
/// `≤`, radicals, extensible brackets, blackboard bold.
const SYMBOL_FAMILIES: [&str; 7] = ["CMSY", "CMEX", "MSAM", "MSBM", "RSFS", "EUFRAK", "EUSM"];

fn family_matches(font_name: &str, families: &[&str]) -> bool {
    // Subset prefixes are six uppercase letters and a '+'.
    let name = font_name.split_once('+').map_or(font_name, |(_, rest)| rest);
    let upper = name.to_ascii_uppercase();
    families.iter().any(|family| upper.contains(family))
}

/// Whether a PDF font name denotes a maths face.
///
/// Names arrive subsetted and versioned — `ABCDEF+CMMI12`, `STIXTwoMath-Regular`
/// — so this matches on the family within the name rather than equality.
pub fn is_maths_font(font_name: &str) -> bool {
    family_matches(font_name, &MATHS_FAMILIES)
        // Catches "…Math-Regular", "XITSMath", "Asana-Math".
        || font_name.to_ascii_uppercase().contains("MATH")
}

/// Whether the face holds symbols rather than italic letters.
pub fn is_symbol_font(font_name: &str) -> bool {
    family_matches(font_name, &SYMBOL_FAMILIES)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_the_computer_modern_maths_faces() {
        assert!(is_maths_font("CMMI12"));
        assert!(is_maths_font("CMSY10"));
        assert!(is_maths_font("CMEX10"));
        assert!(is_maths_font("MSBM10"));
        assert!(is_maths_font("MSAM10"));
    }

    #[test]
    fn sees_through_a_subset_prefix() {
        assert!(is_maths_font("ABCDEF+CMMI12"));
        assert!(is_maths_font("QWERTY+MSBM10"));
    }

    #[test]
    fn recognises_non_latex_maths_faces() {
        assert!(is_maths_font("STIXTwoMath-Regular"));
        assert!(is_maths_font("XITSMath"));
        assert!(is_maths_font("Asana-Math"));
    }

    // CMR is Computer Modern Roman — the body text of the very documents this
    // runs on, and the single most damaging false positive available.
    #[test]
    fn does_not_mistake_body_text_for_maths() {
        assert!(!is_maths_font("CMR12"));
        assert!(!is_maths_font("CMR8"));
        assert!(!is_maths_font("ABCDEF+CMR17"));
        assert!(!is_maths_font("CMBX12"));
        assert!(!is_maths_font("CMTI12"));
        assert!(!is_maths_font("Times-Roman"));
        assert!(!is_maths_font("Helvetica"));
        assert!(!is_maths_font(""));
    }
}

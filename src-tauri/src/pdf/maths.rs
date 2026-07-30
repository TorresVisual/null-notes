//! Recognises which characters belong to typeset mathematics.
//!
//! A LaTeX PDF contains no LaTeX. An equation arrives as a run of glyphs in
//! maths fonts, and reading it as flat text produces confident nonsense:
//! `√(x²+y²)` comes back as `p x2 + y2`, because the radical is a glyph named
//! `p` in an extension font and the exponents are ordinary digits parked above
//! the baseline.
//!
//! Which face a glyph came from is most of what is needed to put it back
//! together, because Computer Modern splits mathematics across faces by
//! *meaning*: variables in one, relations in another, blackboard bold in a
//! third. [`super::latex`] turns that plus the geometry into LaTeX.
//!
//! Pure and font-name-only, so the judgement stays testable.

/// Which kind of maths face a character came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Family {
    /// Not a maths face at all — ordinary prose, or the roman digits and
    /// parentheses that an equation borrows from the body font.
    #[default]
    Text,
    /// `CMMI` — the maths italic alphabet: every variable.
    Italic,
    /// `CMSY` — relations and operators: `→`, `∈`, `≤`, the true minus sign.
    Symbol,
    /// `CMEX` — extensible glyphs: radicals, big delimiters, large operators.
    Extensible,
    /// `MSBM`/`BBOLD` — blackboard bold, so `R` means `\mathbb{R}`.
    Blackboard,
    /// `RSFS`/`EUSM` — the script alphabet, `\mathcal`.
    Script,
    /// `EUFRAK` — fraktur, `\mathfrak`.
    Fraktur,
    /// A maths face from a non-LaTeX producer, where the glyph's own Unicode
    /// value is the best information available.
    Other,
}

impl Family {
    pub fn is_maths(self) -> bool {
        self != Family::Text
    }
}

/// Classifies a PDF font name.
///
/// Names arrive subsetted and versioned — `ABCDEF+CMMI12`,
/// `STIXTwoMath-Regular` — so this matches on the family within the name
/// rather than on equality.
pub fn family_of(font_name: &str) -> Family {
    // Subset prefixes are six uppercase letters and a '+'.
    let name = font_name.split_once('+').map_or(font_name, |(_, rest)| rest);
    let upper = name.to_ascii_uppercase();

    // Ordered: the specific faces before the generic "…Math" catch-all, so
    // "CMMI" is not mistaken for an unknown maths font.
    for (needle, family) in [
        ("CMMI", Family::Italic),
        ("CMSY", Family::Symbol),
        ("CMEX", Family::Extensible),
        ("MSBM", Family::Blackboard),
        ("BBOLD", Family::Blackboard),
        ("MSAM", Family::Symbol),
        ("RSFS", Family::Script),
        ("EUSM", Family::Script),
        ("EUFRAK", Family::Fraktur),
    ] {
        if upper.contains(needle) {
            return family;
        }
    }

    // Catches "…Math-Regular", "XITSMath", "Asana-Math", "STIXTwoMath".
    if upper.contains("MATH") || upper.contains("STIX") {
        return Family::Other;
    }

    Family::Text
}

#[cfg(test)]
mod tests {
    use super::*;

    // The faces this document class actually uses, each carrying a different
    // meaning — which is the whole reason the distinction is worth keeping.
    #[test]
    fn tells_the_computer_modern_maths_faces_apart() {
        assert_eq!(family_of("CMMI12"), Family::Italic);
        assert_eq!(family_of("CMSY10"), Family::Symbol);
        assert_eq!(family_of("CMEX10"), Family::Extensible);
        assert_eq!(family_of("MSBM10"), Family::Blackboard);
        assert_eq!(family_of("MSAM10"), Family::Symbol);
        assert_eq!(family_of("RSFS10"), Family::Script);
        assert_eq!(family_of("EUFRAK10"), Family::Fraktur);
    }

    #[test]
    fn sees_through_a_subset_prefix() {
        assert_eq!(family_of("ABCDEF+CMMI12"), Family::Italic);
        assert_eq!(family_of("QWERTY+MSBM10"), Family::Blackboard);
    }

    #[test]
    fn recognises_non_latex_maths_faces() {
        assert_eq!(family_of("STIXTwoMath-Regular"), Family::Other);
        assert_eq!(family_of("XITSMath"), Family::Other);
        assert_eq!(family_of("Asana-Math"), Family::Other);
    }

    // CMR is Computer Modern Roman — the body text of the very documents this
    // runs on, and the single most damaging false positive available.
    #[test]
    fn does_not_mistake_body_text_for_maths() {
        for name in ["CMR12", "CMR8", "ABCDEF+CMR17", "CMBX12", "CMTI12", "Times-Roman", "Helvetica", ""] {
            assert_eq!(family_of(name), Family::Text, "{name} read as maths");
            assert!(!family_of(name).is_maths());
        }
    }
}

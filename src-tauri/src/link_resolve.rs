//! Which note a `[[target]]` names. Mirrored by `src/lib/wikiLinkResolve.ts`;
//! the editor, graph, backlinks and rename must all agree, so keep them in sync.
//!
//! A target holding `/` is a path suffix (`Course/Sheet 01` matches
//! `…/Course/Sheet 01.md`); anything else is a title. Several matches resolve
//! to the shallowest path, then the alphabetically first.

fn stem_key(path: &str) -> String {
    let p = path.replace('\\', "/").to_lowercase();
    p.strip_suffix(".md").unwrap_or(&p).to_string()
}

fn matches(target: &str, path: &str, title: &str) -> bool {
    let t = target.trim().replace('\\', "/").to_lowercase();
    let t = t.trim_matches('/');
    if t.contains('/') {
        let key = stem_key(path);
        if key == t || key.ends_with(&format!("/{t}")) {
            return true;
        }
    }
    title.to_lowercase() == t
}

/// `notes` is `(path, title)` for every note in the workspace.
pub fn resolve(target: &str, notes: &[(String, String)]) -> Option<String> {
    notes
        .iter()
        .filter(|(path, title)| matches(target, path, title))
        .min_by(|a, b| (a.0.len(), &a.0).cmp(&(b.0.len(), &b.0)))
        .map(|(path, _)| path.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn notes() -> Vec<(String, String)> {
        vec![
            ("/ws/A/Sheet 01.md".into(), "Sheet 01".into()),
            ("/ws/B/Sheet 01.md".into(), "Sheet 01".into()),
            ("/ws/B/Deep/Summary.md".into(), "Summary".into()),
        ]
    }

    #[test]
    fn bare_title_picks_the_alphabetically_first_of_equal_depth() {
        assert_eq!(
            resolve("sheet 01", &notes()).as_deref(),
            Some("/ws/A/Sheet 01.md")
        );
    }

    #[test]
    fn qualified_target_picks_its_own_folder() {
        assert_eq!(
            resolve("B/Sheet 01", &notes()).as_deref(),
            Some("/ws/B/Sheet 01.md")
        );
        assert_eq!(
            resolve("Deep/Summary", &notes()).as_deref(),
            Some("/ws/B/Deep/Summary.md")
        );
    }

    #[test]
    fn qualified_target_must_align_on_a_segment() {
        assert_eq!(resolve("ep/Summary", &notes()), None);
    }

    #[test]
    fn unknown_target_is_unresolved() {
        assert_eq!(resolve("Nope", &notes()), None);
    }
}

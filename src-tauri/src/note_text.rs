use regex::Regex;
use std::collections::HashSet;

/// Splits a leading `---` ... `---` YAML block off a note, verbatim (delimiter
/// lines and their line endings included), so `frontmatter + body == content`.
/// Kept in sync by hand with `src/lib/frontmatter.ts`.
pub fn split_frontmatter(content: &str) -> (&str, &str) {
    let mut lines = content.split_inclusive('\n');
    let Some(first) = lines.next() else {
        return ("", content);
    };
    if first.trim_end() != "---" {
        return ("", content);
    }
    let mut end = first.len();
    for line in lines {
        end += line.len();
        if line.trim_end() == "---" {
            return content.split_at(end);
        }
    }
    ("", content)
}

pub fn extract_links(content: &str) -> Vec<String> {
    let re = match Regex::new(r"\[\[([^\]\n]+)\]\]") {
        Ok(re) => re,
        Err(_) => return Vec::new(),
    };
    let mut seen = HashSet::new();
    let mut links = Vec::new();
    for cap in re.captures_iter(split_frontmatter(content).1) {
        if let Some(m) = cap.get(1) {
            // `[[Note#Heading|shown text]]` — only the part before the first
            // `#` or `|` names the note.
            let body = m.as_str();
            let title = body
                .split(['#', '|'])
                .next()
                .unwrap_or(body)
                .trim()
                .to_string();
            if !title.is_empty() && seen.insert(title.to_lowercase()) {
                links.push(title);
            }
        }
    }
    links
}

// `new_tag` has to match the shape `extract_tags` recognizes, or the rewrite
// silently drops the tag from the index instead of renaming it.
pub fn is_valid_tag(tag: &str) -> bool {
    Regex::new(r"^[A-Za-z][\w-]*$")
        .map(|re| re.is_match(tag))
        .unwrap_or(false)
}

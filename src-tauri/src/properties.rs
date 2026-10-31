use crate::commands::notes::split_frontmatter;
use serde_json::{Map, Value};

pub type Properties = Map<String, Value>;

pub fn parse_properties(frontmatter: &str) -> Result<Properties, String> {
    // Through serde_yaml_ng's own Value: it rejects duplicate keys, serde_json's Value would not.
    let yaml: serde_yaml_ng::Value =
        serde_yaml_ng::from_str(inner_yaml(frontmatter)).map_err(|e| e.to_string())?;
    match serde_json::to_value(yaml).map_err(|e| e.to_string())? {
        Value::Null => Ok(Properties::new()),
        Value::Object(map) => Ok(map),
        _ => Err("frontmatter must be a key: value mapping".into()),
    }
}

pub fn set_property(content: &str, key: &str, value: &Value) -> Result<String, String> {
    let mut expected = parse_properties(split_frontmatter(content).0)?;
    expected.insert(key.to_string(), value.clone());
    let out = match Block::of(content) {
        None => {
            let eol = if content.contains("\r\n") {
                "\r\n"
            } else {
                "\n"
            };
            let entry = entry_lines(&yaml_string(key, false), value, &ListStyle::default(), eol)?;
            format!("---{eol}{entry}---{eol}{content}")
        }
        Some(mut block) => {
            let eol = block.eol;
            match find_range(&block.inner, key) {
                Some((start, end)) => {
                    let (name_end, _) = key_of(&block.inner[start]).unwrap_or_default();
                    let token = block.inner[start][..name_end].to_string();
                    let style = ListStyle::of(&block.inner[start..end]);
                    let entry = entry_lines(&token, value, &style, eol)?;
                    block.inner.splice(start..end, [entry]);
                }
                None => {
                    let entry =
                        entry_lines(&yaml_string(key, false), value, &ListStyle::default(), eol)?;
                    block.inner.push(entry);
                }
            }
            block.render()
        }
    };
    verified(out, &expected)
}

pub fn remove_property(content: &str, key: &str) -> Result<String, String> {
    let mut expected = parse_properties(split_frontmatter(content).0)?;
    let Some(mut block) = Block::of(content) else {
        return Ok(content.to_string());
    };
    let Some((start, end)) = find_range(&block.inner, key) else {
        return Ok(content.to_string());
    };
    block.inner.drain(start..end);
    expected.remove(key);
    verified(block.render(), &expected)
}

pub fn rename_property(content: &str, from: &str, to: &str) -> Result<String, String> {
    let mut expected = parse_properties(split_frontmatter(content).0)?;
    let Some(mut block) = Block::of(content) else {
        return Ok(content.to_string());
    };
    let Some((start, _)) = find_range(&block.inner, from) else {
        return Ok(content.to_string());
    };
    if from == to {
        return Ok(content.to_string());
    }
    if expected.contains_key(to) {
        return Err(format!("property \"{to}\" already exists"));
    }
    let (_, after_colon) = key_of(&block.inner[start]).unwrap_or_default();
    let renamed = format!(
        "{}{}",
        yaml_string(to, false),
        &block.inner[start][after_colon - 1..]
    );
    block.inner[start] = renamed;
    if let Some(value) = expected.remove(from) {
        expected.insert(to.to_string(), value);
    }
    verified(block.render(), &expected)
}

pub fn frontmatter_for(props: &Properties) -> String {
    if props.is_empty() {
        return String::new();
    }
    let mut out = String::from("---\n");
    for (key, value) in props {
        if let Ok(entry) = entry_lines(&yaml_string(key, false), value, &ListStyle::default(), "\n")
        {
            out.push_str(&entry);
        }
    }
    out.push_str("---\n");
    out
}

/// The YAML between the `---` fences; the whole input when it has none.
fn inner_yaml(frontmatter: &str) -> &str {
    let (fm, _) = split_frontmatter(frontmatter);
    if fm.is_empty() {
        return frontmatter;
    }
    let after_open = fm.find('\n').map_or(fm.len(), |i| i + 1);
    let trimmed = fm.trim_end_matches(['\r', '\n']);
    let before_close = trimmed.rfind('\n').map_or(after_open, |i| i + 1);
    &fm[after_open..before_close.max(after_open)]
}

struct Block<'a> {
    eol: &'static str,
    open: &'a str,
    inner: Vec<String>,
    close: &'a str,
    body: &'a str,
}

impl<'a> Block<'a> {
    fn of(content: &'a str) -> Option<Self> {
        let (fm, body) = split_frontmatter(content);
        if fm.is_empty() {
            return None;
        }
        let lines: Vec<&str> = fm.split_inclusive('\n').collect();
        let (open, close) = (lines[0], lines[lines.len() - 1]);
        Some(Block {
            eol: if open.ends_with("\r\n") { "\r\n" } else { "\n" },
            open,
            inner: lines[1..lines.len() - 1]
                .iter()
                .map(|l| l.to_string())
                .collect(),
            close,
            body,
        })
    }

    fn render(&self) -> String {
        format!(
            "{}{}{}{}",
            self.open,
            self.inner.concat(),
            self.close,
            self.body
        )
    }
}

/// Every edit is re-parsed; if it doesn't yield exactly the intended properties the edit is
/// refused rather than written (flow-style roots, odd layouts the line editor can't handle).
fn verified(out: String, expected: &Properties) -> Result<String, String> {
    match parse_properties(split_frontmatter(&out).0) {
        Ok(actual) if &actual == expected => Ok(out),
        _ => Err("edit would not round-trip; frontmatter left untouched".into()),
    }
}

/// Offsets of a top-level `key:` line: (end of the key token, start of the text after the colon).
fn key_of(line: &str) -> Option<(usize, usize)> {
    let first = line.chars().next()?;
    if first.is_whitespace() || first == '#' || line.trim_end() == "-" || line.starts_with("- ") {
        return None;
    }
    if first == '"' || first == '\'' {
        let mut chars = line.char_indices().skip(1);
        while let Some((i, c)) = chars.next() {
            if first == '"' && c == '\\' {
                chars.next();
            } else if c == first {
                if first == '\'' && line[i + 1..].starts_with('\'') {
                    chars.next();
                    continue;
                }
                let after = &line[i + 1..];
                let colon = after.find(':')?;
                return after[..colon]
                    .trim()
                    .is_empty()
                    .then_some((i + 1, i + 1 + colon + 1));
            }
        }
        return None;
    }
    let bytes = line.as_bytes();
    (0..bytes.len())
        .find(|&i| bytes[i] == b':' && bytes.get(i + 1).is_none_or(|b| b.is_ascii_whitespace()))
        .map(|i| (i, i + 1))
}

fn key_name(line: &str) -> Option<String> {
    let (end, _) = key_of(line)?;
    let token = line[..end].trim();
    Some(match token.chars().next() {
        Some('"') => serde_json::from_str::<String>(token).ok()?,
        Some('\'') => token[1..token.len() - 1].replace("''", "'"),
        _ => token.to_string(),
    })
}

/// Line range of `key` inside the frontmatter: its own line plus continuation lines, without
/// the blank/comment lines that sit between it and the next key.
fn find_range(inner: &[String], key: &str) -> Option<(usize, usize)> {
    let start = inner
        .iter()
        .position(|l| key_name(l).as_deref() == Some(key))?;
    let mut end = inner
        .iter()
        .enumerate()
        .skip(start + 1)
        .find(|(_, l)| key_of(l).is_some())
        .map_or(inner.len(), |(i, _)| i);
    while end > start + 1 && (inner[end - 1].trim().is_empty() || inner[end - 1].starts_with('#')) {
        end -= 1;
    }
    Some((start, end))
}

enum ListStyle {
    Flow,
    Block(String),
}

impl Default for ListStyle {
    fn default() -> Self {
        ListStyle::Block("  ".into())
    }
}

impl ListStyle {
    fn of(range: &[String]) -> Self {
        let first_value = key_of(&range[0]).map_or("", |(_, after)| range[0][after..].trim());
        if first_value.starts_with('[') {
            return ListStyle::Flow;
        }
        range[1..]
            .iter()
            .find(|l| l.trim_start().starts_with("- ") || l.trim_end() == "-")
            .map_or_else(ListStyle::default, |l| {
                ListStyle::Block(l[..l.len() - l.trim_start().len()].to_string())
            })
    }
}

fn entry_lines(token: &str, value: &Value, style: &ListStyle, eol: &str) -> Result<String, String> {
    match value {
        Value::Array(items) if items.is_empty() => Ok(format!("{token}: []{eol}")),
        Value::Array(items) => match style {
            ListStyle::Flow => {
                let parts: Result<Vec<_>, _> = items.iter().map(|i| scalar(i, true)).collect();
                Ok(format!("{token}: [{}]{eol}", parts?.join(", ")))
            }
            ListStyle::Block(indent) => {
                let mut out = format!("{token}:{eol}");
                for item in items {
                    out.push_str(&format!("{indent}- {}{eol}", scalar(item, false)?));
                }
                Ok(out)
            }
        },
        Value::Null => Ok(format!("{token}:{eol}")),
        other => Ok(format!("{token}: {}{eol}", scalar(other, false)?)),
    }
}

fn scalar(value: &Value, flow: bool) -> Result<String, String> {
    match value {
        Value::Null => Ok("null".into()),
        Value::Bool(b) => Ok(b.to_string()),
        Value::Number(n) => Ok(n.to_string()),
        Value::String(s) => Ok(yaml_string(s, flow)),
        Value::Array(_) | Value::Object(_) => Err("nested values are not supported".into()),
    }
}

/// Plain when that reads back as the same string, otherwise quoted.
fn yaml_string(s: &str, flow: bool) -> String {
    if plain_safe(s, flow) {
        s.to_string()
    } else if s.contains(['\n', '\r']) {
        Value::String(s.to_string()).to_string()
    } else {
        format!("'{}'", s.replace('\'', "''"))
    }
}

fn plain_safe(s: &str, flow: bool) -> bool {
    if s.is_empty()
        || s != s.trim()
        || s.contains(['\n', '\r'])
        || s.ends_with(':')
        || s.starts_with(|c| "[]{}!&*|>'\"%@`#,?:-".contains(c))
        || (flow && s.contains([',', '[', ']', '{', '}']))
    {
        return false;
    }
    matches!(
        serde_yaml_ng::from_str::<Value>(&format!("v: {s}")),
        Ok(Value::Object(m)) if m.get("v") == Some(&Value::String(s.to_string()))
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn set(content: &str, key: &str, value: Value) -> String {
        set_property(content, key, &value).expect("set_property")
    }

    #[test]
    fn set_property_replaces_only_that_keys_lines() {
        let src = "---\n# course notes\ntitle: \"a: b\"\nstatus: 'done'\nsummary: >\n  long text\n  more\n\n# gap comment\ndue: 2026-10-31\n---\n# Body\n";
        assert_eq!(
            set(src, "status", json!("todo")),
            "---\n# course notes\ntitle: \"a: b\"\nstatus: todo\nsummary: >\n  long text\n  more\n\n# gap comment\ndue: 2026-10-31\n---\n# Body\n"
        );
        assert_eq!(
            set(src, "summary", json!("short")),
            "---\n# course notes\ntitle: \"a: b\"\nstatus: 'done'\nsummary: short\n\n# gap comment\ndue: 2026-10-31\n---\n# Body\n"
        );
    }

    #[test]
    fn set_property_appends_before_closing_delimiter_when_key_is_new() {
        assert_eq!(
            set("---\ntitle: x\n---\nbody\n", "status", json!("todo")),
            "---\ntitle: x\nstatus: todo\n---\nbody\n"
        );
    }

    #[test]
    fn set_property_creates_block_when_note_has_none() {
        assert_eq!(
            set("# Body\ntext\n", "status", json!("todo")),
            "---\nstatus: todo\n---\n# Body\ntext\n"
        );
        assert_eq!(set("", "n", json!(1)), "---\nn: 1\n---\n");
    }

    #[test]
    fn set_list_keeps_flow_style_when_existing_is_flow_and_block_when_block() {
        let list = json!(["x", "y z"]);
        assert_eq!(
            set("---\ntags: [a, b]\n---\n", "tags", list.clone()),
            "---\ntags: [x, y z]\n---\n"
        );
        assert_eq!(
            set("---\ntags:\n  - a\n---\n", "tags", list.clone()),
            "---\ntags:\n  - x\n  - y z\n---\n"
        );
        assert_eq!(
            set("---\ntags:\n- a\nother: 1\n---\n", "tags", list.clone()),
            "---\ntags:\n- x\n- y z\nother: 1\n---\n"
        );
        assert_eq!(
            set("---\ntags: a, b\n---\n", "tags", list.clone()),
            "---\ntags:\n  - x\n  - y z\n---\n"
        );
        assert_eq!(
            set("---\na: 1\n---\n", "tags", json!([])),
            "---\na: 1\ntags: []\n---\n"
        );
    }

    #[test]
    fn scalar_quoting() {
        let cases = [
            (json!("true"), "k: 'true'"),
            (json!("123"), "k: '123'"),
            (json!("a: b"), "k: 'a: b'"),
            (json!("[x]"), "k: '[x]'"),
            (json!("it's # x"), "k: 'it''s # x'"),
            (json!(""), "k: ''"),
            (json!("line1\nline2"), "k: \"line1\\nline2\""),
            (json!("2026-10-31"), "k: 2026-10-31"),
            (json!("plain words"), "k: plain words"),
            (json!(true), "k: true"),
            (json!(3), "k: 3"),
            (json!(null), "k:"),
        ];
        for (value, line) in cases {
            let out = set("---\nz: 1\n---\n", "k", value.clone());
            assert_eq!(out, format!("---\nz: 1\n{line}\n---\n"));
            let props = parse_properties(&out).expect("round-trips");
            assert_eq!(props["k"], value);
        }
        assert_eq!(
            set("---\nz: 1\n---\n", "k", json!(["a,b", "c"])),
            "---\nz: 1\nk:\n  - a,b\n  - c\n---\n"
        );
        assert_eq!(
            set("---\nk: []\n---\n", "k", json!(["a,b", "c"])),
            "---\nk: ['a,b', c]\n---\n"
        );
        assert_eq!(
            set("---\nk: [x]\n---\n", "k", json!(["a,b", "c"])),
            "---\nk: ['a,b', c]\n---\n"
        );
    }

    #[test]
    fn crlf_and_no_trailing_newline_preserved() {
        assert_eq!(
            set(
                "---\r\ntitle: x\r\nstatus: a\r\n---\r\nbody",
                "status",
                json!("b")
            ),
            "---\r\ntitle: x\r\nstatus: b\r\n---\r\nbody"
        );
        assert_eq!(
            set("---\r\ntitle: x\r\n---\r\nbody", "k", json!(1)),
            "---\r\ntitle: x\r\nk: 1\r\n---\r\nbody"
        );
        assert_eq!(
            set("---\r\ntags: [a]\r\n---\r\n", "tags", json!(["a", "b"])),
            "---\r\ntags: [a, b]\r\n---\r\n"
        );
        assert_eq!(set("---\na: 1\n---", "b", json!(2)), "---\na: 1\nb: 2\n---");
        assert_eq!(
            set("body\r\n", "k", json!("v")),
            "---\r\nk: v\r\n---\r\nbody\r\n"
        );
    }

    #[test]
    fn remove_property_removes_key_and_its_continuation_lines() {
        let src = "---\na: 1\nsummary: >\n  x\n  y\n\n# c\nb: 2\ntags:\n- t\n---\nbody\n";
        assert_eq!(
            remove_property(src, "summary").unwrap(),
            "---\na: 1\n\n# c\nb: 2\ntags:\n- t\n---\nbody\n"
        );
        assert_eq!(
            remove_property(src, "tags").unwrap(),
            "---\na: 1\nsummary: >\n  x\n  y\n\n# c\nb: 2\n---\nbody\n"
        );
        assert_eq!(remove_property(src, "missing").unwrap(), src);
        assert_eq!(
            remove_property("no frontmatter\n", "a").unwrap(),
            "no frontmatter\n"
        );
    }

    #[test]
    fn rename_property_keeps_value_and_position() {
        let src = "---\n# c\nstatus: todo # note\n\"my key\": 1\nother: 1\n---\nb";
        assert_eq!(
            rename_property(src, "status", "state").unwrap(),
            "---\n# c\nstate: todo # note\n\"my key\": 1\nother: 1\n---\nb"
        );
        assert_eq!(
            rename_property(src, "my key", "k2").unwrap(),
            "---\n# c\nstatus: todo # note\nk2: 1\nother: 1\n---\nb"
        );
        assert_eq!(
            rename_property(src, "status", "a: b").unwrap(),
            "---\n# c\n'a: b': todo # note\n\"my key\": 1\nother: 1\n---\nb"
        );
        assert!(rename_property(src, "status", "other").is_err());
        assert_eq!(rename_property(src, "missing", "x").unwrap(), src);
    }

    #[test]
    fn unparseable_frontmatter_is_never_edited() {
        for src in [
            "---\na: [unclosed\n---\nbody",
            "---\n- just\n- a list\n---\nbody",
            "---\na: 1\na: 2\n---\nbody",
        ] {
            assert!(set_property(src, "k", &json!(1)).is_err(), "{src}");
            assert!(remove_property(src, "a").is_err(), "{src}");
            assert!(rename_property(src, "a", "b").is_err(), "{src}");
        }
    }

    #[test]
    fn flow_style_root_is_refused_not_corrupted() {
        let src = "---\n{a: 1}\n---\nbody";
        assert!(set_property(src, "k", &json!(1)).is_err());
        assert_eq!(remove_property(src, "a").unwrap(), src);
        assert_eq!(rename_property(src, "a", "b").unwrap(), src);
    }

    #[test]
    fn parse_properties_maps_scalars_lists_dates_and_reports_yaml_errors() {
        let fm = "---\ntitle: Hi\nn: 3\ndone: true\ndue: 2026-10-31\ntags:\n  - a\n  - b\nnothing:\n---\n";
        assert_eq!(
            Value::Object(parse_properties(fm).unwrap()),
            json!({"title":"Hi","n":3,"done":true,"due":"2026-10-31","tags":["a","b"],"nothing":null})
        );
        assert!(parse_properties("").unwrap().is_empty());
        assert!(parse_properties("---\n---\n").unwrap().is_empty());
        let err = parse_properties("---\na: [x\n---\n").unwrap_err();
        assert!(!err.is_empty());
    }

    #[test]
    fn frontmatter_for_writes_a_delimited_block() {
        assert_eq!(frontmatter_for(&Properties::new()), "");
        let mut props = Properties::new();
        props.insert("status".into(), json!("todo"));
        props.insert("tags".into(), json!(["a"]));
        assert_eq!(
            frontmatter_for(&props),
            "---\nstatus: todo\ntags:\n  - a\n---\n"
        );
    }
}

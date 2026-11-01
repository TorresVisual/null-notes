use serde_json::Value;
use std::path::PathBuf;

const PATH_KEYS: &[&str] = &["path", "notePath", "sourcePath", "originalPath"];

// Segments are checked as written, never normalised and compared (see
// commands/CLAUDE.md). `:` is refused so a drive letter or an NTFS stream
// name cannot ride in on a segment.
pub fn to_absolute(workspace: &str, rel: &str) -> Result<String, String> {
    if rel.starts_with('-') {
        return Err(format!("path may not start with '-': {rel}"));
    }
    let mut abs = PathBuf::from(workspace);
    if rel.is_empty() {
        return Ok(abs.to_string_lossy().into_owned());
    }
    let mut segments: Vec<&str> = rel.split(['/', '\\']).collect();
    if segments.last() == Some(&"") {
        segments.pop();
    }
    for segment in segments {
        if segment.is_empty() || segment == "." || segment == ".." || segment.contains(':') {
            return Err(format!("not a workspace-relative path: {rel}"));
        }
        abs.push(segment);
    }
    Ok(abs.to_string_lossy().into_owned())
}

fn forward(path: &str) -> String {
    path.replace('\\', "/")
}

pub fn to_relative(workspace: &str, abs: &str) -> String {
    let abs = forward(abs);
    let prefix = format!("{}/", forward(workspace).trim_end_matches('/'));
    match abs.get(..prefix.len()) {
        Some(head) if head.eq_ignore_ascii_case(&prefix) => abs[prefix.len()..].to_string(),
        _ => abs,
    }
}

pub fn relativize_paths(value: &mut Value, workspace: &str) {
    match value {
        Value::Array(items) => items
            .iter_mut()
            .for_each(|item| relativize_paths(item, workspace)),
        Value::Object(map) => {
            for (key, child) in map.iter_mut() {
                match child {
                    Value::String(text) if PATH_KEYS.contains(&key.as_str()) => {
                        *text = to_relative(workspace, text);
                    }
                    _ => relativize_paths(child, workspace),
                }
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::path::Path;

    fn joined(ws: &str, parts: &[&str]) -> String {
        let mut p = Path::new(ws).to_path_buf();
        p.extend(parts);
        p.to_string_lossy().into_owned()
    }

    #[test]
    fn to_absolute_joins_segments_onto_the_workspace() {
        assert_eq!(
            to_absolute("C:/ws", "a/b.md"),
            Ok(joined("C:/ws", &["a", "b.md"]))
        );
    }

    #[test]
    fn to_absolute_maps_the_empty_path_to_the_workspace_root() {
        assert_eq!(to_absolute("C:/ws", ""), Ok("C:/ws".to_string()));
    }

    #[test]
    fn to_absolute_refuses_hostile_paths() {
        for hostile in [
            "../x",
            "a/../../x",
            "a/..",
            "/etc/x",
            r"\x",
            "C:/x",
            "C:x",
            r"\\srv\share\x",
            "-rf",
            "./a",
            "a//b",
            "a.md:stream",
        ] {
            assert!(
                to_absolute("C:/ws", hostile).is_err(),
                "{hostile} should be refused"
            );
        }
    }

    #[test]
    fn to_absolute_allows_a_dash_inside_a_name() {
        assert!(to_absolute("C:/ws", "a/-rf.md").is_ok());
    }

    #[test]
    fn to_relative_strips_the_workspace_and_uses_forward_slashes() {
        assert_eq!(to_relative(r"C:\ws", r"C:\ws\a\b.md"), "a/b.md");
        assert_eq!(to_relative("C:/ws/", r"c:\WS\a\b.md"), "a/b.md");
    }

    #[test]
    fn to_relative_leaves_a_foreign_path_alone() {
        assert_eq!(to_relative(r"C:\ws", r"D:\other\b.md"), "D:/other/b.md");
        assert_eq!(to_relative(r"C:\ws", r"C:\ws2\b.md"), "C:/ws2/b.md");
    }

    #[test]
    fn relativize_paths_rewrites_nested_path_keys_only() {
        let mut v = json!([{
            "path": "C:/ws/a.md",
            "title": "C:/ws/a.md",
            "note": { "notePath": r"C:\ws\x\y.md" }
        }]);
        relativize_paths(&mut v, "C:/ws");
        assert_eq!(
            v,
            json!([{
                "path": "a.md",
                "title": "C:/ws/a.md",
                "note": { "notePath": "x/y.md" }
            }])
        );
    }
}

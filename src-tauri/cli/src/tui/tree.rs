use super::wire::NoteMeta;
use std::collections::{BTreeSet, HashSet};

#[derive(Debug, Clone, PartialEq)]
pub enum Row {
    Folder {
        path: String,
        name: String,
        depth: usize,
        open: bool,
    },
    Note {
        path: String,
        title: String,
        depth: usize,
    },
}

pub fn build(notes: &[NoteMeta], expanded: &HashSet<String>) -> Vec<Row> {
    let mut rows = Vec::new();
    level(notes, "", 0, expanded, &mut rows);
    rows
}

fn level(
    notes: &[NoteMeta],
    prefix: &str,
    depth: usize,
    expanded: &HashSet<String>,
    rows: &mut Vec<Row>,
) {
    let mut folders = BTreeSet::new();
    let mut here = Vec::new();
    for note in notes {
        let Some(rest) = note.path.strip_prefix(prefix) else {
            continue;
        };
        match rest.split_once('/') {
            Some((folder, _)) => {
                folders.insert(folder);
            }
            None => here.push(note),
        }
    }
    let mut folders: Vec<&str> = folders.into_iter().collect();
    folders.sort_by_key(|name| name.to_lowercase());
    here.sort_by_key(|note| note.title.to_lowercase());

    for name in folders {
        let path = format!("{prefix}{name}");
        let open = expanded.contains(&path);
        rows.push(Row::Folder {
            path: path.clone(),
            name: name.to_string(),
            depth,
            open,
        });
        if open {
            level(notes, &format!("{path}/"), depth + 1, expanded, rows);
        }
    }
    for note in here {
        rows.push(Row::Note {
            path: note.path.clone(),
            title: note.title.clone(),
            depth,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note(path: &str) -> NoteMeta {
        NoteMeta {
            id: path.into(),
            title: path
                .rsplit('/')
                .next()
                .unwrap()
                .trim_end_matches(".md")
                .into(),
            path: path.into(),
            workspace: "W".into(),
            updated_at: 0,
        }
    }

    fn open(paths: &[&str]) -> HashSet<String> {
        paths.iter().map(|p| p.to_string()).collect()
    }

    fn labels(rows: &[Row]) -> Vec<String> {
        rows.iter()
            .map(|row| match row {
                Row::Folder {
                    name, depth, open, ..
                } => format!("{depth}:{name}/{}", if *open { "-" } else { "+" }),
                Row::Note { title, depth, .. } => format!("{depth}:{title}"),
            })
            .collect()
    }

    #[test]
    fn root_notes_have_depth_zero() {
        let rows = build(&[note("a.md"), note("b.md")], &open(&[]));
        assert_eq!(labels(&rows), ["0:a", "0:b"]);
    }

    #[test]
    fn nested_paths_make_folders_with_depth() {
        let rows = build(&[note("a/b/c.md")], &open(&["a", "a/b"]));
        assert_eq!(labels(&rows), ["0:a/-", "1:b/-", "2:c"]);
        assert!(matches!(&rows[1], Row::Folder { path, .. } if path == "a/b"));
        assert!(matches!(&rows[2], Row::Note { path, .. } if path == "a/b/c.md"));
    }

    #[test]
    fn collapsed_folders_hide_their_children() {
        let rows = build(&[note("a/b/c.md"), note("a/d.md")], &open(&["a"]));
        assert_eq!(labels(&rows), ["0:a/-", "1:b/+", "1:d"]);
    }

    #[test]
    fn folders_sort_before_notes_case_insensitively() {
        let rows = build(
            &[
                note("zeta.md"),
                note("Alpha.md"),
                note("beta/x.md"),
                note("Gamma/x.md"),
            ],
            &open(&[]),
        );
        assert_eq!(
            labels(&rows),
            ["0:beta/+", "0:Gamma/+", "0:Alpha", "0:zeta"]
        );
    }

    #[test]
    fn empty_input_gives_no_rows() {
        assert!(build(&[], &open(&[])).is_empty());
    }

    #[test]
    fn unicode_and_spaced_names_sort_without_panic() {
        let rows = build(
            &[note("Lecture 7/Ünï.md"), note("Lecture 7/abc.md")],
            &open(&["Lecture 7"]),
        );
        assert_eq!(labels(&rows), ["0:Lecture 7/-", "1:abc", "1:Ünï"]);
    }
}

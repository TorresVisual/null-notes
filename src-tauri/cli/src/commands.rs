use clap::{Parser, Subcommand, ValueEnum};
use serde_json::{json, Map, Value};
use std::io::Read;
use std::path::PathBuf;

#[derive(Debug)]
pub struct UsageError(pub String);

/// Every wire command with the shell form that reaches it; `--help` prints
/// this, so an agent can see the whole surface without walking subcommands.
pub const COMMAND_TABLE: &[(&str, &str)] = &[
    ("note.list", "note list"),
    ("note.read", "note read <PATH>"),
    (
        "note.create",
        "note create --folder <DIR> --title <T> [--content <TEXT|->]",
    ),
    ("note.write", "note write <PATH> --content <TEXT|->"),
    ("note.append", "note append <PATH> --content <TEXT|->"),
    ("note.rename", "note rename <PATH> --title <T>"),
    ("note.move", "note move <PATH> --folder <DIR>"),
    ("note.duplicate", "note duplicate <PATH>"),
    ("note.delete", "note delete <PATH>   (moves to the trash)"),
    (
        "search",
        "search <QUERY> [--folder] [--tag] [--block-type] [--all-workspaces] [--offset]",
    ),
    ("tags.list", "tags list"),
    ("tags.notes", "tags notes <TAG>"),
    ("tags.rename", "tags rename <OLD> <NEW>"),
    ("backlinks", "backlinks <TITLE>"),
    ("backlinks.code", "backlinks-code <TARGET>"),
    ("mentions", "mentions <TITLE> <PATH>"),
    ("graph.links", "graph links"),
    ("graph.tags", "graph tags"),
    ("tasks.list", "tasks list"),
    ("tasks.toggle", "tasks toggle <PATH> <POSITION>"),
    ("cards.due", "cards due"),
    ("cards.list", "cards list"),
    (
        "cards.grade",
        "cards grade <PATH> <POSITION> <again|hard|good|easy>",
    ),
    (
        "cards.suspend",
        "cards suspend <PATH> <POSITION> [--resume]",
    ),
    ("folder.create", "folder create <PARENT> <NAME>"),
    ("folder.rename", "folder rename <OLD> <NEW>"),
    (
        "folder.delete",
        "folder delete <PATH>   (moves to the trash)",
    ),
    ("template.list", "template list"),
    ("template.read", "template read <PATH>"),
    (
        "template.create",
        "template create --folder <DIR> --title <T> --template <PATH>",
    ),
    ("trash.list", "trash list"),
    ("trash.restore", "trash restore <ID>"),
    ("bookmarks.read", "bookmarks read"),
    ("bookmarks.write", "bookmarks write --content <TEXT|->"),
    ("bases.rows", "bases rows"),
    (
        "property.set",
        "property set <PATH> <KEY> [--value <JSON>] [--expected <JSON>]",
    ),
    ("git.repo", "git repo"),
    ("git.history", "git history <PATH>"),
    ("git.commit", "git commit <PATH>..."),
];

fn after_help() -> String {
    let mut text = String::from(
        "Paths are relative to the workspace and use forward slashes. Output is one JSON line on \
         stdout. Exit codes: 0 ok, 1 failed, 2 usage, 3 no workspace, 4 app unreachable, \
         5 note has unsaved edits, 6 CLI access off, 7 version mismatch.\n\nCommands:\n",
    );
    for (wire, usage) in COMMAND_TABLE {
        text.push_str(&format!("  {wire:<16} nullnotes {usage}\n"));
    }
    text
}

#[derive(Debug, Parser)]
#[command(name = "nullnotes", about = "Read and edit a Null Notes workspace", after_long_help = after_help())]
pub struct Cli {
    /// Workspace folder; defaults to the one containing the current directory.
    #[arg(long, global = true)]
    pub workspace: Option<PathBuf>,
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    #[command(subcommand)]
    Note(NoteCmd),
    Search {
        query: String,
        #[arg(long)]
        folder: Option<String>,
        #[arg(long)]
        tag: Option<String>,
        #[arg(long)]
        block_type: Option<String>,
        #[arg(long)]
        all_workspaces: bool,
        #[arg(long)]
        offset: Option<i64>,
    },
    #[command(subcommand)]
    Tags(TagsCmd),
    Backlinks {
        title: String,
    },
    BacklinksCode {
        target: String,
    },
    Mentions {
        title: String,
        path: String,
    },
    #[command(subcommand)]
    Graph(GraphCmd),
    #[command(subcommand)]
    Tasks(TasksCmd),
    #[command(subcommand)]
    Cards(CardsCmd),
    #[command(subcommand)]
    Folder(FolderCmd),
    #[command(subcommand)]
    Template(TemplateCmd),
    #[command(subcommand)]
    Trash(TrashCmd),
    #[command(subcommand)]
    Bookmarks(BookmarksCmd),
    #[command(subcommand)]
    Bases(BasesCmd),
    #[command(subcommand)]
    Property(PropertyCmd),
    #[command(subcommand)]
    Git(GitCmd),
    /// Interactive full-screen browser; needs a terminal.
    Tui,
}

#[derive(Debug, Subcommand)]
pub enum NoteCmd {
    List,
    Read {
        path: String,
    },
    Create {
        #[arg(long)]
        folder: String,
        #[arg(long)]
        title: String,
        #[arg(long)]
        content: Option<String>,
    },
    Write {
        path: String,
        #[arg(long)]
        content: String,
    },
    Append {
        path: String,
        #[arg(long)]
        content: String,
    },
    Rename {
        path: String,
        #[arg(long)]
        title: String,
    },
    Move {
        path: String,
        #[arg(long)]
        folder: String,
    },
    Duplicate {
        path: String,
    },
    Delete {
        path: String,
    },
}

#[derive(Debug, Subcommand)]
pub enum TagsCmd {
    List,
    Notes { tag: String },
    Rename { old: String, new: String },
}

#[derive(Debug, Subcommand)]
pub enum GraphCmd {
    Links,
    Tags,
}

#[derive(Debug, Subcommand)]
pub enum TasksCmd {
    List,
    Toggle { path: String, position: i64 },
}

#[derive(Debug, Clone, Copy, ValueEnum)]
pub enum GradeArg {
    Again,
    Hard,
    Good,
    Easy,
}

impl GradeArg {
    fn wire(self) -> &'static str {
        match self {
            GradeArg::Again => "again",
            GradeArg::Hard => "hard",
            GradeArg::Good => "good",
            GradeArg::Easy => "easy",
        }
    }
}

#[derive(Debug, Subcommand)]
pub enum CardsCmd {
    Due,
    List,
    Grade {
        path: String,
        position: i64,
        grade: GradeArg,
    },
    Suspend {
        path: String,
        position: i64,
        #[arg(long)]
        resume: bool,
    },
}

#[derive(Debug, Subcommand)]
pub enum FolderCmd {
    Create { parent: String, name: String },
    Rename { old: String, new: String },
    Delete { path: String },
}

#[derive(Debug, Subcommand)]
pub enum TemplateCmd {
    List,
    Read {
        path: String,
    },
    Create {
        #[arg(long)]
        folder: String,
        #[arg(long)]
        title: String,
        #[arg(long)]
        template: String,
    },
}

#[derive(Debug, Subcommand)]
pub enum TrashCmd {
    List,
    Restore { id: String },
}

#[derive(Debug, Subcommand)]
pub enum BookmarksCmd {
    Read,
    Write {
        #[arg(long)]
        content: String,
    },
}

#[derive(Debug, Subcommand)]
pub enum BasesCmd {
    Rows,
}

#[derive(Debug, Subcommand)]
pub enum PropertyCmd {
    Set {
        path: String,
        key: String,
        #[arg(long)]
        value: Option<String>,
        #[arg(long)]
        expected: Option<String>,
    },
}

#[derive(Debug, Subcommand)]
pub enum GitCmd {
    Repo,
    History { path: String },
    Commit { paths: Vec<String> },
}

// `-` means "read the text from stdin": it keeps multi-line markdown out of
// shell quoting, which is where agents lose backslashes and quotes.
fn text(value: &str, stdin: &mut impl Read) -> Result<String, UsageError> {
    if value != "-" {
        return Ok(value.to_string());
    }
    let mut bytes = Vec::new();
    stdin
        .read_to_end(&mut bytes)
        .map_err(|e| UsageError(format!("cannot read stdin: {e}")))?;
    String::from_utf8(bytes).map_err(|_| UsageError("stdin is not valid UTF-8".to_string()))
}

fn json_arg(flag: &str, raw: &str) -> Result<Value, UsageError> {
    serde_json::from_str(raw).map_err(|e| {
        UsageError(format!(
            "--{flag} is not valid JSON ({e}); strings need quotes"
        ))
    })
}

fn args(entries: Vec<(&str, Option<Value>)>) -> Value {
    Value::Object(
        entries
            .into_iter()
            .filter_map(|(key, value)| value.map(|v| (key.to_string(), v)))
            .collect::<Map<String, Value>>(),
    )
}

fn some(value: impl Into<Value>) -> Option<Value> {
    Some(value.into())
}

pub fn build_request(cli: &Cli, stdin: &mut impl Read) -> Result<(String, Value), UsageError> {
    let (wire, args) = match &cli.command {
        Command::Note(cmd) => match cmd {
            NoteCmd::List => ("note.list", Value::Null),
            NoteCmd::Read { path } => ("note.read", json!({ "path": path })),
            NoteCmd::Create {
                folder,
                title,
                content,
            } => {
                let content = content.as_deref().map(|c| text(c, stdin)).transpose()?;
                (
                    "note.create",
                    args(vec![
                        ("folder", some(folder.as_str())),
                        ("title", some(title.as_str())),
                        ("content", content.map(Value::from)),
                    ]),
                )
            }
            NoteCmd::Write { path, content } => (
                "note.write",
                json!({ "path": path, "content": text(content, stdin)? }),
            ),
            NoteCmd::Append { path, content } => (
                "note.append",
                json!({ "path": path, "content": text(content, stdin)? }),
            ),
            NoteCmd::Rename { path, title } => {
                ("note.rename", json!({ "path": path, "title": title }))
            }
            NoteCmd::Move { path, folder } => {
                ("note.move", json!({ "path": path, "folder": folder }))
            }
            NoteCmd::Duplicate { path } => ("note.duplicate", json!({ "path": path })),
            NoteCmd::Delete { path } => ("note.delete", json!({ "path": path })),
        },
        Command::Search {
            query,
            folder,
            tag,
            block_type,
            all_workspaces,
            offset,
        } => (
            "search",
            args(vec![
                ("query", some(query.as_str())),
                ("folder", folder.as_deref().map(Value::from)),
                ("tag", tag.as_deref().map(Value::from)),
                ("block_type", block_type.as_deref().map(Value::from)),
                (
                    "all_workspaces",
                    all_workspaces.then_some(Value::Bool(true)),
                ),
                ("offset", offset.map(Value::from)),
            ]),
        ),
        Command::Tags(cmd) => match cmd {
            TagsCmd::List => ("tags.list", Value::Null),
            TagsCmd::Notes { tag } => ("tags.notes", json!({ "tag": tag })),
            TagsCmd::Rename { old, new } => ("tags.rename", json!({ "old": old, "new": new })),
        },
        Command::Backlinks { title } => ("backlinks", json!({ "title": title })),
        Command::BacklinksCode { target } => ("backlinks.code", json!({ "target": target })),
        Command::Mentions { title, path } => ("mentions", json!({ "title": title, "path": path })),
        Command::Graph(cmd) => match cmd {
            GraphCmd::Links => ("graph.links", Value::Null),
            GraphCmd::Tags => ("graph.tags", Value::Null),
        },
        Command::Tasks(cmd) => match cmd {
            TasksCmd::List => ("tasks.list", Value::Null),
            TasksCmd::Toggle { path, position } => (
                "tasks.toggle",
                json!({ "path": path, "position": position }),
            ),
        },
        Command::Cards(cmd) => match cmd {
            CardsCmd::Due => ("cards.due", Value::Null),
            CardsCmd::List => ("cards.list", Value::Null),
            CardsCmd::Grade {
                path,
                position,
                grade,
            } => (
                "cards.grade",
                json!({ "path": path, "position": position, "grade": grade.wire() }),
            ),
            CardsCmd::Suspend {
                path,
                position,
                resume,
            } => (
                "cards.suspend",
                json!({ "path": path, "position": position, "suspended": !resume }),
            ),
        },
        Command::Folder(cmd) => match cmd {
            FolderCmd::Create { parent, name } => {
                ("folder.create", json!({ "parent": parent, "name": name }))
            }
            FolderCmd::Rename { old, new } => ("folder.rename", json!({ "old": old, "new": new })),
            FolderCmd::Delete { path } => ("folder.delete", json!({ "path": path })),
        },
        Command::Template(cmd) => match cmd {
            TemplateCmd::List => ("template.list", Value::Null),
            TemplateCmd::Read { path } => ("template.read", json!({ "path": path })),
            TemplateCmd::Create {
                folder,
                title,
                template,
            } => (
                "template.create",
                json!({ "folder": folder, "title": title, "template": template }),
            ),
        },
        Command::Trash(cmd) => match cmd {
            TrashCmd::List => ("trash.list", Value::Null),
            TrashCmd::Restore { id } => ("trash.restore", json!({ "id": id })),
        },
        Command::Bookmarks(cmd) => match cmd {
            BookmarksCmd::Read => ("bookmarks.read", Value::Null),
            BookmarksCmd::Write { content } => (
                "bookmarks.write",
                json!({ "content": text(content, stdin)? }),
            ),
        },
        Command::Bases(BasesCmd::Rows) => ("bases.rows", Value::Null),
        Command::Property(PropertyCmd::Set {
            path,
            key,
            value,
            expected,
        }) => {
            let value = value.as_deref().map(|v| json_arg("value", v)).transpose()?;
            let expected = expected
                .as_deref()
                .map(|v| json_arg("expected", v))
                .transpose()?;
            (
                "property.set",
                args(vec![
                    ("path", some(path.as_str())),
                    ("key", some(key.as_str())),
                    ("expected", expected),
                    ("value", value),
                ]),
            )
        }
        Command::Git(cmd) => match cmd {
            GitCmd::Repo => ("git.repo", Value::Null),
            GitCmd::History { path } => ("git.history", json!({ "path": path })),
            GitCmd::Commit { paths } => ("git.commit", json!({ "paths": paths })),
        },
        Command::Tui => return Err(UsageError("tui is interactive, not a wire command".into())),
    };
    Ok((wire.to_string(), args))
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::CommandFactory;

    fn build(argv: &[&str], stdin: &[u8]) -> Result<(String, Value), UsageError> {
        let cli = Cli::try_parse_from(argv).expect("argv parses");
        build_request(&cli, &mut &stdin[..])
    }

    #[test]
    fn tui_is_not_a_wire_command() {
        let cli = Cli::try_parse_from(["nullnotes", "tui"]).expect("argv parses");
        assert!(build_request(&cli, &mut &b""[..]).is_err());
    }

    #[test]
    fn note_read_maps_to_its_wire_command() {
        let (wire, args) = build(&["nullnotes", "note", "read", "a/b.md"], b"").unwrap();
        assert_eq!(wire, "note.read");
        assert_eq!(args, json!({ "path": "a/b.md" }));
    }

    #[test]
    fn search_sends_only_the_options_that_were_given() {
        let (wire, args) = build(&["nullnotes", "search", "foo", "--tag", "x"], b"").unwrap();
        assert_eq!(wire, "search");
        assert_eq!(args, json!({ "query": "foo", "tag": "x" }));
    }

    #[test]
    fn search_flags_use_snake_case_on_the_wire() {
        let (_, args) = build(
            &[
                "nullnotes",
                "search",
                "foo",
                "--block-type",
                "code",
                "--all-workspaces",
                "--offset",
                "20",
            ],
            b"",
        )
        .unwrap();
        assert_eq!(
            args,
            json!({ "query": "foo", "block_type": "code", "all_workspaces": true, "offset": 20 })
        );
    }

    #[test]
    fn content_dash_reads_stdin_verbatim() {
        let (wire, args) = build(
            &["nullnotes", "note", "append", "a.md", "--content", "-"],
            b"hi\r\n",
        )
        .unwrap();
        assert_eq!(wire, "note.append");
        assert_eq!(args, json!({ "path": "a.md", "content": "hi\r\n" }));
    }

    #[test]
    fn stdin_that_is_not_utf8_is_a_usage_error() {
        let result = build(
            &["nullnotes", "note", "write", "a.md", "--content", "-"],
            &[0xff, 0xfe, 0x00],
        );
        assert!(result.is_err());
    }

    #[test]
    fn note_create_content_is_optional() {
        let (_, args) = build(
            &[
                "nullnotes",
                "note",
                "create",
                "--folder",
                "",
                "--title",
                "T",
            ],
            b"",
        )
        .unwrap();
        assert_eq!(args, json!({ "folder": "", "title": "T" }));
    }

    #[test]
    fn cards_suspend_defaults_to_suspending() {
        let (wire, args) = build(&["nullnotes", "cards", "suspend", "a.md", "3"], b"").unwrap();
        assert_eq!(wire, "cards.suspend");
        assert_eq!(
            args,
            json!({ "path": "a.md", "position": 3, "suspended": true })
        );
        let (_, args) = build(
            &["nullnotes", "cards", "suspend", "a.md", "3", "--resume"],
            b"",
        )
        .unwrap();
        assert_eq!(args["suspended"], json!(false));
    }

    #[test]
    fn property_values_are_parsed_as_json() {
        let (wire, args) = build(
            &[
                "nullnotes",
                "property",
                "set",
                "a.md",
                "done",
                "--value",
                "true",
                "--expected",
                "false",
            ],
            b"",
        )
        .unwrap();
        assert_eq!(wire, "property.set");
        assert_eq!(
            args,
            json!({ "path": "a.md", "key": "done", "value": true, "expected": false })
        );
        assert!(build(
            &[
                "nullnotes",
                "property",
                "set",
                "a.md",
                "k",
                "--value",
                "{nope"
            ],
            b""
        )
        .is_err());
    }

    #[test]
    fn git_commit_takes_several_paths() {
        let (wire, args) = build(&["nullnotes", "git", "commit", "a.md", "b.md"], b"").unwrap();
        assert_eq!(wire, "git.commit");
        assert_eq!(args, json!({ "paths": ["a.md", "b.md"] }));
    }

    #[test]
    fn an_unknown_subcommand_is_a_clap_usage_error() {
        let error = Cli::try_parse_from(["nullnotes", "bogus"]).unwrap_err();
        assert_eq!(error.exit_code(), 2);
    }

    #[test]
    fn help_lists_every_wire_command() {
        let help = Cli::command().render_long_help().to_string();
        for (wire, _) in COMMAND_TABLE {
            assert!(help.contains(wire), "{wire} missing from --help");
        }
    }
}

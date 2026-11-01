use super::paths::{relativize_paths, to_absolute};
use super::protocol::{ErrorCode, Request, Response, PROTOCOL_VERSION};
use crate::commands::{bases, bookmarks, git, notes, trash};
use crate::db::DbPool;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, Runtime};

struct Fail(ErrorCode, String);

impl From<String> for Fail {
    fn from(message: String) -> Self {
        Fail(ErrorCode::Failed, message)
    }
}

fn usage(message: impl Into<String>) -> Fail {
    Fail(ErrorCode::Usage, message.into())
}

#[derive(Deserialize)]
struct PathArg {
    path: String,
}

#[derive(Deserialize)]
struct TagArg {
    tag: String,
}

#[derive(Deserialize)]
struct TitleArg {
    title: String,
}

#[derive(Deserialize)]
struct TargetArg {
    target: String,
}

#[derive(Deserialize)]
struct MentionsArgs {
    title: String,
    path: String,
}

#[derive(Deserialize)]
struct SearchArgs {
    query: String,
    folder: Option<String>,
    tag: Option<String>,
    block_type: Option<String>,
    #[serde(default)]
    all_workspaces: bool,
    offset: Option<i64>,
}

pub async fn dispatch<R: Runtime>(app: &AppHandle<R>, req: Request) -> Response {
    if req.v != PROTOCOL_VERSION {
        return Response::err(
            ErrorCode::VersionMismatch,
            format!(
                "protocol version {} is not supported (expected {PROTOCOL_VERSION}); update the CLI or the app",
                req.v
            ),
        );
    }
    match run(app, &req).await {
        Ok(mut result) => {
            if let Some(workspace) = &req.workspace {
                relativize_paths(&mut result, workspace);
            }
            Response::ok(result)
        }
        Err(Fail(code, message)) => Response::err(code, message),
    }
}

fn parse_args<T: DeserializeOwned>(req: &Request) -> Result<T, Fail> {
    serde_json::from_value(req.args.clone()).map_err(|e| usage(format!("bad arguments: {e}")))
}

fn json<T: Serialize>(value: T) -> Result<Value, Fail> {
    serde_json::to_value(value).map_err(|e| Fail(ErrorCode::Failed, e.to_string()))
}

async fn run<R: Runtime>(app: &AppHandle<R>, req: &Request) -> Result<Value, Fail> {
    let ws = || {
        req.workspace
            .clone()
            .ok_or_else(|| usage("this command needs a workspace"))
    };
    let abs = |rel: &str| -> Result<String, Fail> { to_absolute(&ws()?, rel).map_err(usage) };
    let db = || app.state::<DbPool>();

    match req.command.as_str() {
        "note.list" => json(notes::list_notes(ws()?, db()).await?),
        "note.read" => {
            let a: PathArg = parse_args(req)?;
            json(notes::open_note(ws()?, abs(&a.path)?).await?)
        }
        "search" => {
            let a: SearchArgs = parse_args(req)?;
            let folder = a.folder.as_deref().map(abs).transpose()?;
            json(
                notes::search_notes(
                    ws()?,
                    a.query,
                    folder,
                    a.tag,
                    a.block_type,
                    a.all_workspaces,
                    None,
                    a.offset,
                    db(),
                )
                .await?,
            )
        }
        "tags.list" => json(notes::list_tags(ws()?, db()).await?),
        "tags.notes" => {
            let a: TagArg = parse_args(req)?;
            json(notes::notes_with_tag(ws()?, a.tag, db()).await?)
        }
        "backlinks" => {
            let a: TitleArg = parse_args(req)?;
            json(notes::backlinks_for_with_context(ws()?, a.title, db()).await?)
        }
        "backlinks.code" => {
            let a: TargetArg = parse_args(req)?;
            json(notes::code_backlinks_for_with_context(ws()?, a.target, db()).await?)
        }
        "mentions" => {
            let a: MentionsArgs = parse_args(req)?;
            json(
                notes::unlinked_mentions_for_with_context(ws()?, a.title, abs(&a.path)?, db())
                    .await?,
            )
        }
        "graph.links" => json(notes::graph_links(ws()?, db()).await?),
        "graph.tags" => json(notes::graph_tags(ws()?, db()).await?),
        "tasks.list" => json(notes::list_open_tasks(ws()?, db()).await?),
        "cards.due" => json(notes::list_due_cards(ws()?, db()).await?),
        "cards.list" => json(notes::list_all_cards(ws()?, db()).await?),
        "template.list" => json(notes::list_templates(ws()?).await?),
        "template.read" => {
            let a: PathArg = parse_args(req)?;
            json(notes::read_template(ws()?, abs(&a.path)?).await?)
        }
        "trash.list" => json(trash::list_trash(app.clone(), ws()?).await?),
        "bookmarks.read" => json(bookmarks::read_bookmarks(ws()?).await?),
        "bases.rows" => json(bases::list_base_rows(ws()?, db()).await?),
        "git.repo" => json(git::detect_repo(ws()?).await?),
        "git.history" => {
            let a: PathArg = parse_args(req)?;
            json(git::list_note_history(ws()?, abs(&a.path)?).await?)
        }
        other => Err(usage(format!("command not exposed: {other}"))),
    }
}

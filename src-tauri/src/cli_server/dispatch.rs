use super::paths::{relativize_paths, to_absolute, to_relative};
use super::protocol::{ErrorCode, Request, Response, PROTOCOL_VERSION};
use super::state::CliState;
use crate::commands::workspace::InitialWorkspace;
use crate::commands::{bases, bookmarks, git, notes, trash};
use crate::db::DbPool;
use crate::sm2::Grade;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;
use tauri::{AppHandle, Manager, Runtime, State};
use tokio::sync::OwnedMutexGuard;

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

#[derive(Deserialize)]
struct CreateArgs {
    folder: String,
    title: String,
    content: Option<String>,
}

#[derive(Deserialize)]
struct WriteArgs {
    path: String,
    content: String,
}

#[derive(Deserialize)]
struct RenameArgs {
    path: String,
    title: String,
}

#[derive(Deserialize)]
struct MoveArgs {
    path: String,
    folder: String,
}

#[derive(Deserialize)]
struct FolderCreateArgs {
    parent: String,
    name: String,
}

#[derive(Deserialize)]
struct FromToArgs {
    old: String,
    new: String,
}

#[derive(Deserialize)]
struct TaskToggleArgs {
    path: String,
    position: i64,
}

#[derive(Deserialize)]
struct CardGradeArgs {
    path: String,
    position: i64,
    grade: Grade,
}

#[derive(Deserialize)]
struct CardSuspendArgs {
    path: String,
    position: i64,
    suspended: bool,
}

#[derive(Deserialize)]
struct TemplateCreateArgs {
    folder: String,
    title: String,
    template: String,
}

#[derive(Deserialize)]
struct TrashRestoreArgs {
    id: String,
}

#[derive(Deserialize)]
struct ContentArg {
    content: String,
}

#[derive(Deserialize)]
struct PropertySetArgs {
    path: String,
    key: String,
    expected: Option<Value>,
    value: Option<Value>,
}

#[derive(Deserialize)]
struct GitCommitArgs {
    paths: Vec<String>,
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
    app.state::<CliState>().touch();
    let ctx = Ctx { app, req: &req };
    match ctx.run().await {
        Ok(mut result) => {
            if let Some(workspace) = &req.workspace {
                relativize_paths(&mut result, workspace);
            }
            Response::ok(result)
        }
        Err(Fail(code, message)) => Response::err(code, message),
    }
}

fn json<T: Serialize>(value: T) -> Result<Value, Fail> {
    serde_json::to_value(value).map_err(|e| Fail(ErrorCode::Failed, e.to_string()))
}

struct Ctx<'a, R: Runtime> {
    app: &'a AppHandle<R>,
    req: &'a Request,
}

impl<R: Runtime> Ctx<'_, R> {
    fn db(&self) -> State<'_, DbPool> {
        self.app.state::<DbPool>()
    }

    fn state(&self) -> State<'_, CliState> {
        self.app.state::<CliState>()
    }

    fn args<T: DeserializeOwned>(&self) -> Result<T, Fail> {
        serde_json::from_value(self.req.args.clone())
            .map_err(|e| usage(format!("bad arguments: {e}")))
    }

    // The first workspace-scoped request of a server session catches the index
    // up with whatever changed on disk while nothing was watching.
    async fn ws(&self) -> Result<String, Fail> {
        let ws = self
            .req
            .workspace
            .clone()
            .ok_or_else(|| usage("this command needs a workspace"))?;
        if self.state().take_first_scan(&ws) {
            notes::scan_workspace(ws.clone(), self.db()).await?;
        }
        Ok(ws)
    }

    async fn abs(&self, rel: &str) -> Result<String, Fail> {
        to_absolute(&self.ws().await?, rel).map_err(usage)
    }

    // Takes the per-path lock first, then checks for unsaved edits, so a
    // refusal never races a write that is already in flight.
    async fn locked(
        &self,
        rel: &str,
        refuse_dirty: bool,
    ) -> Result<(String, OwnedMutexGuard<()>), Fail> {
        let abs = self.abs(rel).await?;
        // Every caller edits a note. Without this, `note.write` could drop an
        // executable into `.git/hooks/` for the next `git.commit` to run.
        if !abs.to_lowercase().ends_with(".md") {
            return Err(usage(format!("not a note (expected .md): {rel}")));
        }
        let guard = self.state().lock_path(&abs).await;
        if refuse_dirty && self.state().is_dirty(&abs) {
            return Err(Fail(
                ErrorCode::DirtyBuffer,
                format!("{rel} has unsaved edits in Null Notes"),
            ));
        }
        Ok((abs, guard))
    }

    // The CLI is not a keystroke path, so it reindexes right after saving.
    async fn write_note(&self, ws: &str, abs: &str, content: String) -> Result<(), Fail> {
        notes::save_note(ws.to_string(), abs.to_string(), content.clone()).await?;
        notes::reindex_note(
            self.app.clone(),
            abs.to_string(),
            ws.to_string(),
            content,
            self.db(),
        )
        .await?;
        Ok(())
    }

    async fn run(&self) -> Result<Value, Fail> {
        let db = || self.db();
        match self.req.command.as_str() {
            "note.list" => json(notes::list_notes(self.ws().await?, db()).await?),
            "note.read" => {
                let a: PathArg = self.args()?;
                json(notes::open_note(self.ws().await?, self.abs(&a.path).await?).await?)
            }
            "search" => {
                let a: SearchArgs = self.args()?;
                let folder = match &a.folder {
                    Some(folder) => Some(self.abs(folder).await?),
                    None => None,
                };
                json(
                    notes::search_notes(
                        self.ws().await?,
                        a.query,
                        folder,
                        a.tag,
                        a.block_type,
                        None,
                        a.all_workspaces,
                        None,
                        a.offset,
                        db(),
                    )
                    .await?,
                )
            }
            "tags.list" => json(notes::list_tags(self.ws().await?, db()).await?),
            "tags.notes" => {
                let a: TagArg = self.args()?;
                json(notes::notes_with_tag(self.ws().await?, a.tag, db()).await?)
            }
            "backlinks" => {
                let a: TitleArg = self.args()?;
                json(
                    notes::backlinks_for_target_with_context(self.ws().await?, a.title, db())
                        .await?,
                )
            }
            "backlinks.code" => {
                let a: TargetArg = self.args()?;
                json(
                    notes::code_backlinks_for_with_context(self.ws().await?, a.target, db())
                        .await?,
                )
            }
            "mentions" => {
                let a: MentionsArgs = self.args()?;
                json(
                    notes::unlinked_mentions_for_with_context(
                        self.ws().await?,
                        a.title,
                        self.abs(&a.path).await?,
                        db(),
                    )
                    .await?,
                )
            }
            "graph.links" => json(notes::graph_links(self.ws().await?, db()).await?),
            "graph.tags" => json(notes::graph_tags(self.ws().await?, db()).await?),
            "tasks.list" => json(notes::list_open_tasks(self.ws().await?, db()).await?),
            "cards.due" => json(notes::list_due_cards(self.ws().await?, false, db()).await?),
            "cards.list" => json(notes::list_all_cards(self.ws().await?, db()).await?),
            "template.list" => json(notes::list_templates(self.ws().await?).await?),
            "template.read" => {
                let a: PathArg = self.args()?;
                json(notes::read_template(self.ws().await?, self.abs(&a.path).await?).await?)
            }
            "trash.list" => json(trash::list_trash(self.app.clone(), self.ws().await?).await?),
            "bookmarks.read" => json(bookmarks::read_bookmarks(self.ws().await?).await?),
            "bases.rows" => json(bases::list_base_rows(self.ws().await?, db()).await?),
            "git.repo" => json(git::detect_repo(self.ws().await?).await?),
            "git.history" => {
                let a: PathArg = self.args()?;
                json(git::list_note_history(self.ws().await?, self.abs(&a.path).await?).await?)
            }

            "note.create" => {
                let a: CreateArgs = self.args()?;
                let ws = self.ws().await?;
                let folder = self.abs(&a.folder).await?;
                let meta = notes::create_note(ws.clone(), folder, a.title, db()).await?;
                if let Some(content) = a.content {
                    self.write_note(&ws, &meta.path, content).await?;
                }
                json(meta)
            }
            "note.write" => {
                let a: WriteArgs = self.args()?;
                let (abs, _guard) = self.locked(&a.path, true).await?;
                self.write_note(&self.ws().await?, &abs, a.content).await?;
                Ok(Value::Null)
            }
            "note.append" => {
                let a: WriteArgs = self.args()?;
                let ws = self.ws().await?;
                let (abs, _guard) = self.locked(&a.path, true).await?;
                let mut text = notes::open_note(ws.clone(), abs.clone()).await?;
                if !text.is_empty() && !text.ends_with('\n') {
                    text.push('\n');
                }
                text.push_str(&a.content);
                self.write_note(&ws, &abs, text).await?;
                Ok(Value::Null)
            }
            "note.rename" => {
                let a: RenameArgs = self.args()?;
                let (abs, _guard) = self.locked(&a.path, true).await?;
                json(notes::rename_note(abs, a.title, self.ws().await?, db()).await?)
            }
            "note.move" => {
                let a: MoveArgs = self.args()?;
                let (abs, _guard) = self.locked(&a.path, true).await?;
                let folder = self.abs(&a.folder).await?;
                let ws = self.ws().await?;
                let moved = notes::move_note(abs, folder, ws.clone(), db()).await?;
                json(to_relative(&ws, &moved))
            }
            "note.duplicate" => {
                let a: PathArg = self.args()?;
                let (abs, _guard) = self.locked(&a.path, false).await?;
                json(notes::duplicate_note(abs, self.ws().await?, db()).await?)
            }
            "note.delete" => {
                let a: PathArg = self.args()?;
                let (abs, _guard) = self.locked(&a.path, true).await?;
                json(trash::delete_note(self.app.clone(), self.ws().await?, abs, db()).await?)
            }
            "folder.create" => {
                let a: FolderCreateArgs = self.args()?;
                let ws = self.ws().await?;
                let created = notes::create_folder(self.abs(&a.parent).await?, a.name).await?;
                json(to_relative(&ws, &created))
            }
            "folder.rename" => {
                let a: FromToArgs = self.args()?;
                let old = self.abs(&a.old).await?;
                let new = self.abs(&a.new).await?;
                json(notes::rename_folder(old, new, db()).await?)
            }
            "folder.delete" => {
                let a: PathArg = self.args()?;
                let abs = self.abs(&a.path).await?;
                json(trash::delete_folder(self.app.clone(), self.ws().await?, abs, db()).await?)
            }
            "tags.rename" => {
                let a: FromToArgs = self.args()?;
                json(notes::rename_tag(a.old, a.new, self.ws().await?, db()).await?)
            }
            "tasks.toggle" => {
                let a: TaskToggleArgs = self.args()?;
                let (abs, _guard) = self.locked(&a.path, true).await?;
                json(notes::toggle_task(abs, a.position, self.ws().await?, db()).await?)
            }
            "cards.grade" => {
                let a: CardGradeArgs = self.args()?;
                let (abs, _guard) = self.locked(&a.path, true).await?;
                json(notes::grade_card(abs, a.position, a.grade, self.ws().await?, db()).await?)
            }
            "cards.suspend" => {
                let a: CardSuspendArgs = self.args()?;
                let (abs, _guard) = self.locked(&a.path, true).await?;
                json(
                    notes::set_card_suspended(abs, a.position, a.suspended, self.ws().await?, db())
                        .await?,
                )
            }
            "template.create" => {
                let a: TemplateCreateArgs = self.args()?;
                let ws = self.ws().await?;
                let content =
                    notes::read_template(ws.clone(), self.abs(&a.template).await?).await?;
                let folder = self.abs(&a.folder).await?;
                json(notes::create_note_from_template(ws, folder, a.title, content, db()).await?)
            }
            "trash.restore" => {
                let a: TrashRestoreArgs = self.args()?;
                let ws = self.ws().await?;
                let restored =
                    trash::restore_trash_entry(self.app.clone(), ws.clone(), a.id, db()).await?;
                json(to_relative(&ws, &restored))
            }
            "bookmarks.write" => {
                let a: ContentArg = self.args()?;
                json(bookmarks::write_bookmarks(self.ws().await?, a.content).await?)
            }
            "property.set" => {
                let a: PropertySetArgs = self.args()?;
                let (abs, _guard) = self.locked(&a.path, true).await?;
                json(
                    bases::write_note_property(
                        self.ws().await?,
                        abs,
                        a.key,
                        a.expected,
                        a.value,
                        db(),
                    )
                    .await?,
                )
            }
            "git.commit" => {
                let a: GitCommitArgs = self.args()?;
                let mut paths = Vec::with_capacity(a.paths.len());
                for path in &a.paths {
                    paths.push(self.abs(path).await?);
                }
                let ws = self.ws().await?;
                let Some(mode) = git::detect_repo(ws.clone()).await? else {
                    return Err(Fail(ErrorCode::Failed, "not a git repository".into()));
                };
                json(git::auto_commit(ws, mode, paths, false).await?)
            }
            "status" => Ok(json!({
                "shown": self.state().is_shown(),
                "workspace": self
                    .app
                    .try_state::<InitialWorkspace>()
                    .and_then(|initial| initial.0.clone()),
            })),
            "promote" => {
                self.state().mark_shown();
                if let Some(window) = self.app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
                Ok(Value::Null)
            }
            // Quits only an instance nobody has seen: a visible window may hold
            // unsaved edits, and exiting here skips the close veto that flushes them.
            "shutdown" => {
                if self.state().is_shown() {
                    return Err(Fail(
                        ErrorCode::Failed,
                        "the window is visible; not quitting".into(),
                    ));
                }
                let app = self.app.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(Duration::from_millis(200)).await;
                    app.exit(0);
                });
                Ok(Value::Null)
            }
            other => Err(usage(format!("command not exposed: {other}"))),
        }
    }
}

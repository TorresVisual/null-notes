#![cfg(windows)]

use null_notes_lib::cli_server::dispatch::dispatch;
use null_notes_lib::cli_server::protocol::PROTOCOL_VERSION;
use null_notes_lib::cli_server::protocol::{ErrorCode, Request, Response};
use null_notes_lib::cli_server::state::CliState;
use null_notes_lib::db::{self, DbPool};
use serde_json::{json, Value};
use tauri::test::{mock_app, MockRuntime};
use tauri::{App, Manager};
use tempfile::TempDir;

const NEVER_EXPOSED: &[&str] = &[
    "run_code",
    "send_input",
    "stop_run",
    "format_code",
    "open_in_editor",
    "open_note_externally",
    "reveal_note",
    "terminal_spawn",
    "terminal_write",
    "get_git_token",
    "set_git_token",
    "window_close",
    "clone_repo",
    "push_notes",
    "fetch_and_compare",
    "rebase_onto_remote",
    "purge_trash_entry",
    "empty_trash",
];

struct Fixture {
    app: App<MockRuntime>,
    workspace: TempDir,
    _data: TempDir,
}

async fn fixture() -> Fixture {
    let data = tempfile::tempdir().unwrap();
    let pool: DbPool = db::init_db(data.path()).await.unwrap();
    let app = mock_app();
    app.manage(pool);
    app.manage(CliState::default());
    Fixture {
        app,
        workspace: tempfile::tempdir().unwrap(),
        _data: data,
    }
}

fn request(fx: &Fixture, command: &str, args: Value) -> Request {
    Request {
        v: PROTOCOL_VERSION,
        token: String::new(),
        command: command.to_string(),
        workspace: Some(fx.workspace.path().to_string_lossy().into_owned()),
        args,
    }
}

fn code_of(response: &Response) -> Option<ErrorCode> {
    response.error.as_ref().map(|e| e.code)
}

#[tokio::test]
async fn tags_list_on_an_empty_workspace_is_an_empty_array() {
    let fx = fixture().await;
    let response = dispatch(fx.app.handle(), request(&fx, "tags.list", Value::Null)).await;
    assert!(response.ok, "{response:?}");
    assert_eq!(response.result, Some(json!([])));
}

#[tokio::test]
async fn a_command_outside_the_allowlist_is_refused_as_not_exposed() {
    let fx = fixture().await;
    let response = dispatch(fx.app.handle(), request(&fx, "run_code", Value::Null)).await;
    assert!(!response.ok);
    assert_eq!(code_of(&response), Some(ErrorCode::Usage));
    let message = response.error.map(|e| e.message).unwrap_or_default();
    assert!(message.contains("not exposed"), "{message}");
}

#[tokio::test]
async fn every_never_exposed_command_is_refused() {
    let fx = fixture().await;
    for name in NEVER_EXPOSED {
        let response = dispatch(fx.app.handle(), request(&fx, name, Value::Null)).await;
        let message = response.error.map(|e| e.message).unwrap_or_default();
        assert!(message.contains("not exposed"), "{name}: {message}");
    }
}

#[tokio::test]
async fn a_mismatched_protocol_version_is_refused() {
    let fx = fixture().await;
    let mut req = request(&fx, "tags.list", Value::Null);
    req.v = 99;
    let response = dispatch(fx.app.handle(), req).await;
    assert_eq!(code_of(&response), Some(ErrorCode::VersionMismatch));
}

#[tokio::test]
async fn note_read_returns_the_file_for_a_workspace_relative_path() {
    let fx = fixture().await;
    std::fs::write(fx.workspace.path().join("a.md"), "# A\n").unwrap();
    let response = dispatch(
        fx.app.handle(),
        request(&fx, "note.read", json!({ "path": "a.md" })),
    )
    .await;
    assert_eq!(response.result, Some(json!("# A\n")));
}

#[tokio::test]
async fn a_hostile_path_is_refused_before_touching_disk() {
    let fx = fixture().await;
    for path in ["../x.md", "-rf", "C:/Windows/win.ini"] {
        let response = dispatch(
            fx.app.handle(),
            request(&fx, "note.read", json!({ "path": path })),
        )
        .await;
        assert_eq!(code_of(&response), Some(ErrorCode::Usage), "{path}");
    }
}

#[tokio::test]
async fn malformed_args_are_a_usage_error() {
    let fx = fixture().await;
    let response = dispatch(
        fx.app.handle(),
        request(&fx, "note.read", json!({ "nope": 1 })),
    )
    .await;
    assert_eq!(code_of(&response), Some(ErrorCode::Usage));
}

#[tokio::test]
async fn trash_list_with_nothing_trashed_is_an_empty_array() {
    let fx = fixture().await;
    let response = dispatch(fx.app.handle(), request(&fx, "trash.list", Value::Null)).await;
    assert!(response.ok, "{response:?}");
    assert_eq!(response.result, Some(json!([])));
}

async fn call(fx: &Fixture, command: &str, args: Value) -> Response {
    dispatch(fx.app.handle(), request(fx, command, args)).await
}

fn workspace_file(fx: &Fixture, name: &str) -> std::path::PathBuf {
    fx.workspace.path().join(name)
}

fn mark_dirty(fx: &Fixture, name: &str) {
    let path = workspace_file(fx, name).to_string_lossy().into_owned();
    fx.app
        .state::<CliState>()
        .set_dirty(&fx.workspace.path().to_string_lossy(), vec![path]);
}

#[tokio::test]
async fn a_write_to_a_dirty_buffer_is_refused_and_leaves_the_file_alone() {
    let fx = fixture().await;
    std::fs::write(
        workspace_file(&fx, "a.md"),
        "# A
",
    )
    .unwrap();
    mark_dirty(&fx, "A.MD");
    for (command, args) in [
        ("note.write", json!({ "path": "a.md", "content": "new" })),
        ("note.append", json!({ "path": "a.md", "content": "new" })),
        ("note.rename", json!({ "path": "a.md", "title": "B" })),
        ("note.delete", json!({ "path": "a.md" })),
    ] {
        let response = call(&fx, command, args).await;
        assert_eq!(
            code_of(&response),
            Some(ErrorCode::DirtyBuffer),
            "{command}"
        );
    }
    assert_eq!(
        std::fs::read_to_string(workspace_file(&fx, "a.md")).unwrap(),
        "# A
"
    );
}

#[tokio::test]
async fn a_write_to_a_clean_note_lands_and_is_searchable() {
    let fx = fixture().await;
    std::fs::write(
        workspace_file(&fx, "a.md"),
        "# A
",
    )
    .unwrap();
    let response = call(
        &fx,
        "note.write",
        json!({ "path": "a.md", "content": "# A

zebra
" }),
    )
    .await;
    assert!(response.ok, "{response:?}");
    assert_eq!(
        std::fs::read_to_string(workspace_file(&fx, "a.md")).unwrap(),
        "# A

zebra
"
    );
    let found = call(&fx, "search", json!({ "query": "zebra" })).await;
    let result = found.result.unwrap_or_default();
    assert_eq!(result["results"][0]["path"], json!("a.md"), "{result}");
}

#[tokio::test]
async fn concurrent_appends_to_one_note_both_land() {
    let fx = fixture().await;
    std::fs::write(
        workspace_file(&fx, "a.md"),
        "# A
",
    )
    .unwrap();
    let (one, two) = tokio::join!(
        call(
            &fx,
            "note.append",
            json!({ "path": "a.md", "content": "first
" })
        ),
        call(
            &fx,
            "note.append",
            json!({ "path": "a.md", "content": "second
" })
        ),
    );
    assert!(one.ok && two.ok, "{one:?} {two:?}");
    let text = std::fs::read_to_string(workspace_file(&fx, "a.md")).unwrap();
    assert!(text.contains("first") && text.contains("second"), "{text}");
}

#[tokio::test]
async fn note_delete_trashes_and_trash_restore_brings_it_back() {
    let fx = fixture().await;
    std::fs::write(
        workspace_file(&fx, "a.md"),
        "# A
",
    )
    .unwrap();
    let deleted = call(&fx, "note.delete", json!({ "path": "a.md" })).await;
    assert!(deleted.ok, "{deleted:?}");
    assert!(!workspace_file(&fx, "a.md").exists());
    let listed = call(&fx, "trash.list", Value::Null)
        .await
        .result
        .unwrap_or_default();
    assert_eq!(listed.as_array().map(Vec::len), Some(1), "{listed}");
    assert_eq!(listed[0]["originalPath"], json!("a.md"));
    let id = listed[0]["id"].as_str().unwrap_or_default().to_string();
    let restored = call(&fx, "trash.restore", json!({ "id": id })).await;
    assert_eq!(restored.result, Some(json!("a.md")), "{restored:?}");
    assert!(workspace_file(&fx, "a.md").exists());
}

#[tokio::test]
async fn the_first_request_scans_the_workspace_and_later_ones_do_not() {
    let fx = fixture().await;
    std::fs::write(
        workspace_file(&fx, "before.md"),
        "# Before
",
    )
    .unwrap();
    let first = call(&fx, "note.list", Value::Null)
        .await
        .result
        .unwrap_or_default();
    assert_eq!(first.as_array().map(Vec::len), Some(1), "{first}");
    std::fs::write(
        workspace_file(&fx, "after.md"),
        "# After
",
    )
    .unwrap();
    let second = call(&fx, "note.list", Value::Null)
        .await
        .result
        .unwrap_or_default();
    assert_eq!(second.as_array().map(Vec::len), Some(1), "{second}");
}

#[tokio::test]
async fn note_create_writes_the_given_content() {
    let fx = fixture().await;
    let created = call(
        &fx,
        "note.create",
        json!({ "folder": "", "title": "Fresh", "content": "# Fresh

body
" }),
    )
    .await;
    assert!(created.ok, "{created:?}");
    assert_eq!(
        created.result.unwrap_or_default()["path"],
        json!("Fresh.md")
    );
    assert_eq!(
        std::fs::read_to_string(workspace_file(&fx, "Fresh.md")).unwrap(),
        "# Fresh

body
"
    );
}

#[tokio::test]
async fn git_commit_refuses_a_dash_leading_path_before_spawning_anything() {
    let fx = fixture().await;
    let response = call(&fx, "git.commit", json!({ "paths": ["-rf"] })).await;
    assert_eq!(code_of(&response), Some(ErrorCode::Usage), "{response:?}");
    let message = response.error.map(|e| e.message).unwrap_or_default();
    assert!(!message.contains("not exposed"), "{message}");
}

mod pipe_helpers {
    use super::*;
    use null_notes_lib::cli_server::pipe::serve;

    pub const TOKEN: &str = "secret-token";

    fn unique_pipe() -> String {
        format!(r"\\.\pipe\nullnotes-test-{}", uuid::Uuid::new_v4())
    }

    pub async fn serving(fx: &Fixture) -> String {
        let name = unique_pipe();
        let (bound_tx, bound_rx) = tokio::sync::oneshot::channel();
        let app = fx.app.handle().clone();
        let served = name.clone();
        tokio::spawn(async move {
            let _ = serve(app, TOKEN.to_string(), served, move || {
                let _ = bound_tx.send(());
            })
            .await;
        });
        bound_rx.await.unwrap();
        name
    }

    pub fn with_token(fx: &Fixture, token: &str, command: &str) -> Request {
        Request {
            token: token.to_string(),
            ..request(fx, command, Value::Null)
        }
    }
}

mod pipe {
    use super::pipe_helpers::*;
    use super::*;
    use null_notes_lib::cli_server::pipe::{send, send_raw, serve};

    #[tokio::test]
    async fn a_valid_request_round_trips() {
        let fx = fixture().await;
        let name = serving(&fx).await;
        let response = send(&name, &with_token(&fx, TOKEN, "tags.list"))
            .await
            .unwrap();
        assert!(response.ok, "{response:?}");
        assert_eq!(response.result, Some(json!([])));
    }

    #[tokio::test]
    async fn a_wrong_token_is_unauthorized() {
        let fx = fixture().await;
        let name = serving(&fx).await;
        let response = send(&name, &with_token(&fx, "nope", "tags.list"))
            .await
            .unwrap();
        assert_eq!(code_of(&response), Some(ErrorCode::Unauthorized));
    }

    #[tokio::test]
    async fn a_wrong_version_is_a_version_mismatch() {
        let fx = fixture().await;
        let name = serving(&fx).await;
        let mut req = with_token(&fx, TOKEN, "tags.list");
        req.v = 99;
        let response = send(&name, &req).await.unwrap();
        assert_eq!(code_of(&response), Some(ErrorCode::VersionMismatch));
    }

    #[tokio::test]
    async fn an_unknown_command_is_a_usage_error() {
        let fx = fixture().await;
        let name = serving(&fx).await;
        let response = send(&name, &with_token(&fx, TOKEN, "run_code"))
            .await
            .unwrap();
        assert_eq!(code_of(&response), Some(ErrorCode::Usage));
    }

    #[tokio::test]
    async fn garbage_gets_an_error_and_the_server_keeps_serving() {
        let fx = fixture().await;
        let name = serving(&fx).await;

        let malformed = send_raw(&name, b"{not json\n").await.unwrap();
        let malformed: Response = serde_json::from_str(&malformed).unwrap();
        assert_eq!(code_of(&malformed), Some(ErrorCode::Usage));

        let mut oversized = vec![b'a'; 1024 * 1024 + 10];
        oversized.push(b'\n');
        let oversized = send_raw(&name, &oversized).await.unwrap();
        let oversized: Response = serde_json::from_str(&oversized).unwrap();
        assert_eq!(code_of(&oversized), Some(ErrorCode::Usage));

        let response = send(&name, &with_token(&fx, TOKEN, "tags.list"))
            .await
            .unwrap();
        assert!(response.ok, "{response:?}");
    }

    #[tokio::test]
    async fn a_second_server_on_the_same_pipe_fails_before_announcing_itself() {
        let fx = fixture().await;
        let name = serving(&fx).await;
        let announced = std::sync::atomic::AtomicBool::new(false);
        let second = serve(
            fx.app.handle().clone(),
            "other".to_string(),
            name.clone(),
            || announced.store(true, std::sync::atomic::Ordering::SeqCst),
        )
        .await;
        assert!(second.is_err());
        assert!(!announced.load(std::sync::atomic::Ordering::SeqCst));
        let response = send(&name, &with_token(&fx, TOKEN, "tags.list"))
            .await
            .unwrap();
        assert!(response.ok, "{response:?}");
    }
}

mod lifecycle {
    use super::pipe_helpers::*;
    use super::*;
    use null_notes_lib::cli_server::lifecycle::{defer_via, Handshake};

    async fn status(fx: &Fixture) -> Value {
        call(fx, "status", Value::Null)
            .await
            .result
            .unwrap_or_default()
    }

    #[tokio::test]
    async fn a_fresh_instance_reports_its_window_as_never_shown() {
        let fx = fixture().await;
        assert_eq!(status(&fx).await["shown"], json!(false));
    }

    #[tokio::test]
    async fn promote_marks_the_instance_shown() {
        let fx = fixture().await;
        assert!(call(&fx, "promote", Value::Null).await.ok);
        assert_eq!(status(&fx).await["shown"], json!(true));
    }

    #[tokio::test]
    async fn shutdown_is_refused_once_the_window_has_been_shown() {
        let fx = fixture().await;
        call(&fx, "promote", Value::Null).await;
        let response = call(&fx, "shutdown", Value::Null).await;
        assert_eq!(code_of(&response), Some(ErrorCode::Failed), "{response:?}");
    }

    #[tokio::test]
    async fn with_no_token_file_there_is_no_instance_to_defer_to() {
        let fx = fixture().await;
        let name = serving(&fx).await;
        let empty = tempfile::tempdir().unwrap();
        assert_eq!(
            defer_via(empty.path(), &name, false).await,
            Handshake::NoInstance
        );
    }

    #[tokio::test]
    async fn a_launch_without_target_args_promotes_a_hidden_instance() {
        let fx = fixture().await;
        let name = serving(&fx).await;
        std::fs::write(fx._data.path().join("cli-token"), TOKEN).unwrap();
        assert_eq!(
            defer_via(fx._data.path(), &name, false).await,
            Handshake::Promoted
        );
        assert_eq!(status(&fx).await["shown"], json!(true));
    }

    #[tokio::test]
    async fn a_launch_beside_an_already_visible_instance_runs_on_its_own() {
        let fx = fixture().await;
        let name = serving(&fx).await;
        std::fs::write(fx._data.path().join("cli-token"), TOKEN).unwrap();
        call(&fx, "promote", Value::Null).await;
        assert_eq!(
            defer_via(fx._data.path(), &name, true).await,
            Handshake::NoInstance
        );
    }
}

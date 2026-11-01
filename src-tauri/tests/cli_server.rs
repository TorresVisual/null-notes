#![cfg(windows)]

use null_notes_lib::cli_server::dispatch::dispatch;
use null_notes_lib::cli_server::protocol::PROTOCOL_VERSION;
use null_notes_lib::cli_server::protocol::{ErrorCode, Request, Response};
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

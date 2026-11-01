use super::pipe::{pipe_name, send};
use super::protocol::{Request, PROTOCOL_VERSION};
use super::state::CliState;
use super::TOKEN_FILE;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Manager, Runtime};
use tokio::net::windows::named_pipe::ClientOptions;

pub const IDLE_QUIT: Duration = Duration::from_secs(10 * 60);
const IDLE_CHECK: Duration = Duration::from_secs(30);
const SHUTDOWN_WAIT: Duration = Duration::from_secs(3);
const APP_IDENTIFIER: &str = "dev.nullnotes.app";

#[derive(Debug, PartialEq, Eq)]
pub enum Handshake {
    NoInstance,
    Promoted,
    ShutDown,
}

pub fn should_idle_quit(shown: bool, idle: Duration) -> bool {
    !shown && idle >= IDLE_QUIT
}

pub fn spawn_idle_quit<R: Runtime>(app: &AppHandle<R>) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(IDLE_CHECK).await;
            let state = app.state::<CliState>();
            if should_idle_quit(state.is_shown(), state.idle_for()) {
                app.exit(0);
            }
        }
    });
}

// Runs before the Tauri app exists, so the app-data dir is derived from the
// identifier rather than asked of an `AppHandle`.
fn app_data_dir() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(|appdata| PathBuf::from(appdata).join(APP_IDENTIFIER))
}

// A normal launch asks a running instance first: a hidden one (started by the
// CLI, window never shown) is promoted when this launch has nothing to open,
// and shut down when it has, so the new process can take the pipe and the
// target. A visible instance is left alone and both run, as they always have.
pub fn defer_to_hidden_instance(has_target_args: bool) -> Handshake {
    let Some(dir) = app_data_dir() else {
        return Handshake::NoInstance;
    };
    let Ok(runtime) = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    else {
        return Handshake::NoInstance;
    };
    runtime.block_on(defer_via(&dir, &pipe_name(), has_target_args))
}

pub async fn defer_via(data_dir: &Path, pipe_name: &str, has_target_args: bool) -> Handshake {
    let Ok(token) = std::fs::read_to_string(data_dir.join(TOKEN_FILE)) else {
        return Handshake::NoInstance;
    };
    let token = token.trim().to_string();
    let ask = |command: &'static str| {
        let req = Request {
            v: PROTOCOL_VERSION,
            token: token.clone(),
            command: command.to_string(),
            workspace: None,
            args: Value::Null,
        };
        async move { send(pipe_name, &req).await }
    };

    let hidden = ask("status")
        .await
        .ok()
        .and_then(|response| response.result)
        .and_then(|status| status["shown"].as_bool())
        == Some(false);
    if !hidden {
        return Handshake::NoInstance;
    }
    if !has_target_args {
        return match ask("promote").await {
            Ok(response) if response.ok => Handshake::Promoted,
            _ => Handshake::NoInstance,
        };
    }
    match ask("shutdown").await {
        Ok(response) if response.ok => {
            wait_for_pipe_to_close(pipe_name).await;
            Handshake::ShutDown
        }
        _ => Handshake::NoInstance,
    }
}

async fn wait_for_pipe_to_close(pipe_name: &str) {
    let deadline = tokio::time::Instant::now() + SHUTDOWN_WAIT;
    while tokio::time::Instant::now() < deadline {
        if ClientOptions::new().open(pipe_name).is_err() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_never_shown_instance_idles_out() {
        let eleven = Duration::from_secs(11 * 60);
        let nine = Duration::from_secs(9 * 60);
        assert!(should_idle_quit(false, eleven));
        assert!(!should_idle_quit(true, eleven));
        assert!(!should_idle_quit(false, nine));
    }
}

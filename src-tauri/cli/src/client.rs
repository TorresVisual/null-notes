use crate::protocol::{ErrorBody, ErrorCode, Request, Response, PROTOCOL_VERSION};
use serde_json::Value;
use std::io;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::windows::named_pipe::ClientOptions;

const APP_IDENTIFIER: &str = "dev.nullnotes.app";
const LAUNCH_TIMEOUT: Duration = Duration::from_secs(15);
const POLL: Duration = Duration::from_millis(200);
const ERROR_PIPE_BUSY: i32 = 231;
const DETACHED_NO_WINDOW: u32 = 0x0800_0008;

#[derive(Debug)]
pub enum ClientError {
    Disabled,
    Unreachable(String),
    Rejected(ErrorBody),
}

pub struct Env {
    pub data_dir: PathBuf,
    pub pipe_name: String,
    pub app_exe: Option<PathBuf>,
    pub launch_timeout: Duration,
}

impl Env {
    pub fn from_system() -> Self {
        let appdata = std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_default();
        let user = std::env::var("USERNAME").unwrap_or_else(|_| "user".to_string());
        let own_dir = std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(Path::to_path_buf));
        Env {
            data_dir: appdata.join(APP_IDENTIFIER),
            pipe_name: format!(r"\\.\pipe\nullnotes-cli-{user}"),
            app_exe: find_app_exe(
                std::env::var_os("NULLNOTES_APP_EXE").map(PathBuf::from),
                own_dir.as_deref(),
                Path::new(env!("CARGO_MANIFEST_DIR")),
            ),
            launch_timeout: LAUNCH_TIMEOUT,
        }
    }

    pub fn recents_file(&self) -> PathBuf {
        self.data_dir.join("recent-workspaces.json")
    }
}

// An explicit override wins even when it is wrong, so a typo is not papered
// over by a different build.
pub fn find_app_exe(
    override_exe: Option<PathBuf>,
    own_exe_dir: Option<&Path>,
    manifest_dir: &Path,
) -> Option<PathBuf> {
    if let Some(exe) = override_exe {
        return exe.is_file().then_some(exe);
    }
    let beside = own_exe_dir.map(|dir| dir.join("null-notes.exe"));
    let built = manifest_dir.ancestors().flat_map(|dir| {
        ["target", "src-tauri/target"]
            .into_iter()
            .flat_map(move |target| {
                ["release", "debug"]
                    .into_iter()
                    .map(move |profile| dir.join(target).join(profile).join("null-notes.exe"))
            })
    });
    beside.into_iter().chain(built).find(|exe| exe.is_file())
}

pub fn request_with(
    env: &Env,
    command: &str,
    workspace: Option<&Path>,
    args: Value,
) -> Result<Value, ClientError> {
    if !access_enabled(&env.data_dir) {
        return Err(ClientError::Disabled);
    }
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| ClientError::Unreachable(e.to_string()))?;
    runtime.block_on(run(env, command, workspace, args))
}

fn access_enabled(data_dir: &Path) -> bool {
    std::fs::read_to_string(data_dir.join("settings.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|settings| settings["cliAccess"].as_bool())
        .unwrap_or(true)
}

async fn run(
    env: &Env,
    command: &str,
    workspace: Option<&Path>,
    args: Value,
) -> Result<Value, ClientError> {
    let workspace = workspace.map(|w| w.to_string_lossy().into_owned());
    let ask = || attempt(env, command, workspace.clone(), args.clone());

    if let Some(response) = ask().await {
        return finish(response);
    }
    launch(env, workspace.as_deref())?;

    // The token file is written just after the pipe is bound, so the first
    // answers from a fresh instance can still be "bad token" from a stale file.
    let deadline = Instant::now() + env.launch_timeout;
    let mut stale_token = None;
    while Instant::now() < deadline {
        tokio::time::sleep(POLL).await;
        match ask().await {
            Some(response) if is_unauthorized(&response) => stale_token = Some(response),
            Some(response) => return finish(response),
            None => {}
        }
    }
    match stale_token {
        Some(response) => finish(response),
        None => Err(ClientError::Unreachable(format!(
            "Null Notes did not start within {} s",
            env.launch_timeout.as_secs()
        ))),
    }
}

fn is_unauthorized(response: &Response) -> bool {
    response
        .error
        .as_ref()
        .is_some_and(|e| e.code == ErrorCode::Unauthorized)
}

fn finish(response: Response) -> Result<Value, ClientError> {
    if response.ok {
        return Ok(response.result.unwrap_or(Value::Null));
    }
    Err(ClientError::Rejected(response.error.unwrap_or(ErrorBody {
        code: ErrorCode::Failed,
        message: "the app returned an error without details".to_string(),
    })))
}

// `None` means nobody usable answered: no token file, no pipe, or a
// connection that died mid-request. All of those mean "start the app".
async fn attempt(
    env: &Env,
    command: &str,
    workspace: Option<String>,
    args: Value,
) -> Option<Response> {
    let token = std::fs::read_to_string(env.data_dir.join("cli-token")).ok()?;
    let request = Request {
        v: PROTOCOL_VERSION,
        token: token.trim().to_string(),
        command: command.to_string(),
        workspace,
        args,
    };
    let mut line = serde_json::to_vec(&request).ok()?;
    line.push(b'\n');
    exchange(&env.pipe_name, &line).await.ok()
}

async fn exchange(pipe_name: &str, line: &[u8]) -> io::Result<Response> {
    let mut client = loop {
        match ClientOptions::new().open(pipe_name) {
            Err(e) if e.raw_os_error() == Some(ERROR_PIPE_BUSY) => {
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            other => break other?,
        }
    };
    client.write_all(line).await?;
    let mut reply = String::new();
    BufReader::new(client).read_line(&mut reply).await?;
    serde_json::from_str(&reply).map_err(io::Error::other)
}

fn launch(env: &Env, workspace: Option<&str>) -> Result<(), ClientError> {
    let exe = env.app_exe.as_ref().ok_or_else(|| {
        ClientError::Unreachable(
            "Null Notes is not running and null-notes.exe was not found (set NULLNOTES_APP_EXE)"
                .to_string(),
        )
    })?;
    let mut command = Command::new(exe);
    command.arg("--headless");
    if let Some(workspace) = workspace {
        command.arg(format!("--workspace={workspace}"));
    }
    command
        .creation_flags(DETACHED_NO_WINDOW)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(drop)
        .map_err(|e| ClientError::Unreachable(format!("could not start {}: {e}", exe.display())))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::net::windows::named_pipe::ServerOptions;

    const TOKEN: &str = "tok";

    fn unique_pipe() -> String {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or_default();
        format!(
            r"\\.\pipe\nullnotes-cli-test-{}-{nanos}",
            std::process::id()
        )
    }

    fn env(dir: &Path, pipe_name: &str) -> Env {
        Env {
            data_dir: dir.to_path_buf(),
            pipe_name: pipe_name.to_string(),
            app_exe: None,
            launch_timeout: Duration::from_millis(400),
        }
    }

    // Answers one request with `reply`, handing back the line it received.
    fn fake_server(name: &str, reply: &'static str) -> std::sync::mpsc::Receiver<String> {
        let (seen_tx, seen_rx) = std::sync::mpsc::channel();
        let (ready_tx, ready_rx) = std::sync::mpsc::channel();
        let name = name.to_string();
        std::thread::spawn(move || {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap();
            runtime.block_on(async move {
                let mut server = ServerOptions::new().create(&name).unwrap();
                ready_tx.send(()).unwrap();
                server.connect().await.unwrap();
                let mut reader = BufReader::new(&mut server);
                let mut line = String::new();
                reader.read_line(&mut line).await.unwrap();
                seen_tx.send(line).unwrap();
                server.write_all(reply.as_bytes()).await.unwrap();
                server.write_all(b"\n").await.unwrap();
                server.flush().await.unwrap();
            });
        });
        ready_rx.recv().unwrap();
        seen_rx
    }

    #[test]
    fn a_running_app_answers_and_the_result_comes_back() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("cli-token"), format!("{TOKEN}\n")).unwrap();
        let name = unique_pipe();
        let seen = fake_server(&name, r#"{"ok":true,"result":[],"error":null}"#);

        let result = request_with(
            &env(tmp.path(), &name),
            "tags.list",
            Some(Path::new("C:/ws")),
            Value::Null,
        );

        assert_eq!(result.unwrap(), json!([]));
        let sent: Value = serde_json::from_str(&seen.recv().unwrap()).unwrap();
        assert_eq!(sent["token"], json!(TOKEN));
        assert_eq!(sent["v"], json!(1));
        assert_eq!(sent["command"], json!("tags.list"));
        assert_eq!(sent["workspace"], json!("C:/ws"));
    }

    #[test]
    fn an_error_response_is_handed_back_as_rejected() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("cli-token"), TOKEN).unwrap();
        let name = unique_pipe();
        let _seen = fake_server(
            &name,
            r#"{"ok":false,"result":null,"error":{"code":"dirty_buffer","message":"open"}}"#,
        );

        let result = request_with(&env(tmp.path(), &name), "note.write", None, Value::Null);

        match result {
            Err(ClientError::Rejected(body)) => assert_eq!(body.message, "open"),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn cli_access_off_stops_before_any_connection() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("settings.json"), r#"{"cliAccess":false}"#).unwrap();
        let name = unique_pipe();
        let seen = fake_server(&name, r#"{"ok":true,"result":null,"error":null}"#);

        let result = request_with(&env(tmp.path(), &name), "tags.list", None, Value::Null);

        assert!(matches!(result, Err(ClientError::Disabled)));
        assert!(seen.try_recv().is_err());
    }

    #[test]
    fn no_app_and_nothing_to_launch_is_unreachable() {
        let tmp = tempfile::tempdir().unwrap();
        let result = request_with(
            &env(tmp.path(), &unique_pipe()),
            "tags.list",
            Some(Path::new("C:/ws")),
            Value::Null,
        );
        assert!(matches!(result, Err(ClientError::Unreachable(_))));
    }

    #[test]
    fn the_app_exe_is_found_by_override_then_beside_then_in_a_target_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let touch = |p: &Path| {
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(p, "").unwrap();
        };
        let overridden = tmp.path().join("custom.exe");
        let beside_dir = tmp.path().join("install");
        let beside = beside_dir.join("null-notes.exe");
        let manifest = tmp.path().join("repo").join("src-tauri").join("cli");
        let built = tmp
            .path()
            .join("repo/src-tauri/target/debug/null-notes.exe");
        touch(&built);
        fs::create_dir_all(&manifest).unwrap();

        assert_eq!(find_app_exe(None, None, &manifest), Some(built.clone()));
        touch(&beside);
        assert_eq!(
            find_app_exe(None, Some(&beside_dir), &manifest),
            Some(beside)
        );
        touch(&overridden);
        assert_eq!(
            find_app_exe(Some(overridden.clone()), Some(&beside_dir), &manifest),
            Some(overridden)
        );
        assert_eq!(
            find_app_exe(
                Some(tmp.path().join("missing.exe")),
                None,
                &tmp.path().join("nowhere")
            ),
            None
        );
    }
}

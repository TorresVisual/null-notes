use super::dispatch::dispatch;
use super::protocol::{ErrorCode, Request, Response};
use std::io;
use std::time::Duration;
use tauri::{AppHandle, Runtime};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::windows::named_pipe::{
    ClientOptions, NamedPipeClient, NamedPipeServer, ServerOptions,
};

const MAX_LINE: u64 = 1024 * 1024;
const ERROR_PIPE_BUSY: i32 = 231;
const BUSY_RETRIES: u32 = 40;

pub fn pipe_name() -> String {
    let user = std::env::var("USERNAME").unwrap_or_else(|_| "user".to_string());
    format!(r"\\.\pipe\nullnotes-cli-{user}")
}

// `on_bound` runs once the first pipe instance exists and before the first
// client is accepted: the caller publishes its token there, so an instance
// that lost the bind never overwrites the winner's token file.
pub async fn serve<R: Runtime>(
    app: AppHandle<R>,
    token: String,
    name: String,
    on_bound: impl FnOnce(),
) -> io::Result<()> {
    let mut server = ServerOptions::new()
        .first_pipe_instance(true)
        .reject_remote_clients(true)
        .create(&name)?;
    on_bound();
    loop {
        server.connect().await?;
        let next = ServerOptions::new()
            .reject_remote_clients(true)
            .create(&name)?;
        let connected = std::mem::replace(&mut server, next);
        tokio::spawn(handle(connected, app.clone(), token.clone()));
    }
}

async fn handle<R: Runtime>(pipe: NamedPipeServer, app: AppHandle<R>, token: String) {
    let mut reader = BufReader::new(pipe);
    let mut line = Vec::new();
    loop {
        line.clear();
        let read = (&mut reader)
            .take(MAX_LINE + 1)
            .read_until(b'\n', &mut line)
            .await;
        let (response, hang_up) = match read {
            Ok(0) | Err(_) => return,
            Ok(_) if line.len() as u64 > MAX_LINE => (
                Response::err(ErrorCode::Usage, "request exceeds 1 MiB"),
                true,
            ),
            Ok(_) => (respond(&app, &token, &line).await, false),
        };
        if write_response(reader.get_mut(), &response).await.is_err() || hang_up {
            return;
        }
    }
}

async fn respond<R: Runtime>(app: &AppHandle<R>, token: &str, line: &[u8]) -> Response {
    let req: Request = match serde_json::from_slice(line) {
        Ok(req) => req,
        Err(e) => return Response::err(ErrorCode::Usage, format!("malformed request: {e}")),
    };
    if !token_matches(&req.token, token) {
        return Response::err(ErrorCode::Unauthorized, "bad token");
    }
    dispatch(app, req).await
}

fn token_matches(given: &str, expected: &str) -> bool {
    given.len() == expected.len()
        && given
            .bytes()
            .zip(expected.bytes())
            .fold(0u8, |diff, (a, b)| diff | (a ^ b))
            == 0
}

async fn write_response(pipe: &mut NamedPipeServer, response: &Response) -> io::Result<()> {
    let mut line = serde_json::to_vec(response).map_err(io::Error::other)?;
    line.push(b'\n');
    pipe.write_all(&line).await?;
    pipe.flush().await
}

async fn open(name: &str) -> io::Result<NamedPipeClient> {
    for _ in 0..BUSY_RETRIES {
        match ClientOptions::new().open(name) {
            Err(e) if e.raw_os_error() == Some(ERROR_PIPE_BUSY) => {
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            other => return other,
        }
    }
    Err(io::Error::new(io::ErrorKind::TimedOut, "pipe is busy"))
}

// Write errors are ignored on purpose: the server answers an oversized
// request and hangs up before reading all of it, and its answer is still
// waiting for us to read.
pub async fn send_raw(name: &str, payload: &[u8]) -> io::Result<String> {
    let mut client = open(name).await?;
    let _ = client.write_all(payload).await;
    let mut line = String::new();
    BufReader::new(client).read_line(&mut line).await?;
    Ok(line)
}

pub async fn send(name: &str, req: &Request) -> io::Result<Response> {
    let mut payload = serde_json::to_vec(req).map_err(io::Error::other)?;
    payload.push(b'\n');
    let line = send_raw(name, &payload).await?;
    serde_json::from_str(&line).map_err(io::Error::other)
}

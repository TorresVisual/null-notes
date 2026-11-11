//! GitHub OAuth device flow for the mobile first-run screen: the user approves a short code
//! at github.com/login/device instead of creating and pasting a personal access token. Only
//! the public client ID is needed (no secret), and the resulting token is written straight to
//! the platform credential store by `set_git_token` — it never crosses to the frontend.
//!
//! The requests run here rather than in the webview because github.com sends no CORS headers
//! for these endpoints.

use crate::commands::git::GithubRepo;
use crate::commands::git_credentials::{get_git_token, set_git_token};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};

const CLIENT_ID: &str = "Ov23liedZAvJHn6RYzie";
const SCOPE: &str = "repo";
const DEVICE_CODE_URL: &str = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL: &str = "https://github.com/login/oauth/access_token";
const USER_REPOS_URL: &str =
    "https://api.github.com/user/repos?sort=pushed&per_page=100&affiliation=owner,collaborator,organization_member";

#[derive(Debug, Deserialize)]
struct DeviceCodeResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    expires_in: u64,
    interval: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCode {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
}

impl From<DeviceCodeResponse> for DeviceCode {
    fn from(r: DeviceCodeResponse) -> Self {
        Self {
            device_code: r.device_code,
            user_code: r.user_code,
            verification_uri: r.verification_uri,
            expires_in: r.expires_in,
            interval: r.interval,
        }
    }
}

#[derive(Debug, Deserialize)]
struct PollResponse {
    access_token: Option<String>,
    error: Option<String>,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PollOutcome {
    Pending,
    SlowDown,
    Authorized,
    Expired,
    Denied,
}

#[derive(Debug, Deserialize)]
struct ApiRepo {
    full_name: String,
    html_url: String,
    private: bool,
}

/// reqwest's default rustls verifier asks the OS through JNI, which panics on Android
/// until the app has initialised it. Bundled Mozilla roots need no platform setup.
fn client() -> anyhow::Result<Client> {
    let roots = webpki_root_certs::TLS_SERVER_ROOT_CERTS
        .iter()
        .filter_map(|der| reqwest::Certificate::from_der(der.as_ref()).ok());
    Ok(Client::builder()
        .user_agent("null-notes")
        .tls_certs_only(roots)
        .build()?)
}

fn interpret_poll(body: &str) -> anyhow::Result<(PollOutcome, Option<String>)> {
    let parsed: PollResponse = serde_json::from_str(body)?;
    if let Some(token) = parsed.access_token {
        return Ok((PollOutcome::Authorized, Some(token)));
    }
    let outcome = match parsed.error.as_deref() {
        Some("authorization_pending") => PollOutcome::Pending,
        Some("slow_down") => PollOutcome::SlowDown,
        Some("expired_token") => PollOutcome::Expired,
        Some("access_denied") => PollOutcome::Denied,
        Some(other) => anyhow::bail!("GitHub sign-in failed: {other}"),
        None => anyhow::bail!("GitHub sign-in returned an unexpected response"),
    };
    Ok((outcome, None))
}

fn parse_repos(body: &str) -> anyhow::Result<Vec<GithubRepo>> {
    let repos: Vec<ApiRepo> = serde_json::from_str(body)?;
    Ok(repos
        .into_iter()
        .map(|r| GithubRepo {
            name_with_owner: r.full_name,
            url: r.html_url,
            is_private: r.private,
        })
        .collect())
}

fn start() -> anyhow::Result<DeviceCode> {
    let body = client()?
        .post(DEVICE_CODE_URL)
        .header("Accept", "application/json")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(format!("client_id={CLIENT_ID}&scope={SCOPE}"))
        .send()?
        .error_for_status()?
        .text()?;
    Ok(serde_json::from_str::<DeviceCodeResponse>(&body)?.into())
}

fn poll(device_code: &str) -> anyhow::Result<PollOutcome> {
    if device_code.is_empty()
        || !device_code
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        anyhow::bail!("invalid device code");
    }
    let body = client()?
        .post(ACCESS_TOKEN_URL)
        .header("Accept", "application/json")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(format!(
            "client_id={CLIENT_ID}&device_code={device_code}&grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code"
        ))
        .send()?
        .error_for_status()?
        .text()?;
    let (outcome, token) = interpret_poll(&body)?;
    if let Some(token) = token {
        set_git_token(token).map_err(anyhow::Error::msg)?;
    }
    Ok(outcome)
}

/// The signed-in user's repos, most recently pushed first. One page of 100: a notes repo
/// that isn't among a user's 100 latest pushes is reachable through the manual URL path.
pub fn list_repos() -> anyhow::Result<Vec<GithubRepo>> {
    let token = get_git_token().map_err(anyhow::Error::msg)?;
    if token.is_empty() {
        anyhow::bail!("not signed in to GitHub");
    }
    let body = client()?
        .get(USER_REPOS_URL)
        .header("Accept", "application/vnd.github+json")
        .header("Authorization", format!("Bearer {token}"))
        .send()?
        .error_for_status()?
        .text()?;
    parse_repos(&body)
}

#[tauri::command]
pub async fn github_device_start() -> Result<DeviceCode, String> {
    tokio::task::spawn_blocking(start)
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn github_device_poll(device_code: String) -> Result<PollOutcome, String> {
    tokio::task::spawn_blocking(move || poll(&device_code))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_token_response_is_authorized_and_carries_the_token() {
        let (outcome, token) =
            interpret_poll(r#"{"access_token":"gho_x","token_type":"bearer","scope":"repo"}"#)
                .unwrap();
        assert_eq!(outcome, PollOutcome::Authorized);
        assert_eq!(token.as_deref(), Some("gho_x"));
    }

    #[test]
    fn pending_and_slow_down_keep_polling() {
        let (pending, _) = interpret_poll(r#"{"error":"authorization_pending"}"#).unwrap();
        let (slow, _) = interpret_poll(r#"{"error":"slow_down","interval":10}"#).unwrap();
        assert_eq!(pending, PollOutcome::Pending);
        assert_eq!(slow, PollOutcome::SlowDown);
    }

    #[test]
    fn expiry_and_denial_are_terminal_outcomes_not_errors() {
        let (expired, _) = interpret_poll(r#"{"error":"expired_token"}"#).unwrap();
        let (denied, _) = interpret_poll(r#"{"error":"access_denied"}"#).unwrap();
        assert_eq!(expired, PollOutcome::Expired);
        assert_eq!(denied, PollOutcome::Denied);
    }

    #[test]
    fn an_unknown_error_surfaces_as_a_failure() {
        assert!(interpret_poll(r#"{"error":"incorrect_client_credentials"}"#).is_err());
        assert!(interpret_poll("{}").is_err());
    }

    #[test]
    fn repos_map_to_the_picker_shape() {
        let repos = parse_repos(
            r#"[{"full_name":"me/notes","html_url":"https://github.com/me/notes","private":true,"id":1}]"#,
        )
        .unwrap();
        assert_eq!(repos.len(), 1);
        assert_eq!(repos[0].name_with_owner, "me/notes");
        assert_eq!(repos[0].url, "https://github.com/me/notes");
        assert!(repos[0].is_private);
    }

    #[test]
    #[ignore = "hits github.com; run with --ignored to check TLS and the client ID"]
    fn start_requests_a_real_device_code() {
        let code = start().unwrap();
        assert!(!code.user_code.is_empty());
        assert!(code.verification_uri.starts_with("https://github.com/"));
    }

    #[test]
    fn a_device_code_with_form_metacharacters_is_refused() {
        assert!(poll("abc&client_id=evil").is_err());
        assert!(poll("").is_err());
    }
}

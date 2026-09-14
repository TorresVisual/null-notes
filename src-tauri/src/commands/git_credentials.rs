//! Stores the single git PAT mobile needs for `push_notes`/`fetch_and_compare`/
//! `clone_repo` in the iOS Keychain via the `keyring` crate directly — not
//! `tauri-plugin-keyring`, whose iOS backend only implements a `ping` stub and
//! doesn't actually reach the Keychain. Desktop builds don't depend on
//! `keyring` at all (see `Cargo.toml`'s iOS-only target table), so these
//! commands compile everywhere but only do real work on iOS.

#[cfg(target_os = "ios")]
const SERVICE: &str = "dev.nullnotes.app";
#[cfg(target_os = "ios")]
const USER: &str = "git-pat";

#[tauri::command]
pub fn get_git_token() -> Result<String, String> {
    #[cfg(target_os = "ios")]
    {
        let entry = keyring::Entry::new(SERVICE, USER).map_err(|e| e.to_string())?;
        match entry.get_password() {
            Ok(token) => Ok(token),
            Err(keyring::Error::NoEntry) => Ok(String::new()),
            Err(e) => Err(e.to_string()),
        }
    }
    #[cfg(not(target_os = "ios"))]
    Err("git credential storage is only available on iOS".to_string())
}

#[tauri::command]
pub fn set_git_token(token: String) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    {
        let entry = keyring::Entry::new(SERVICE, USER).map_err(|e| e.to_string())?;
        entry.set_password(&token).map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = token;
        Err("git credential storage is only available on iOS".to_string())
    }
}

//! Stores the single git PAT mobile needs for `push_notes`/`fetch_and_compare`/
//! `clone_repo` in the iOS Keychain via `keyring-core` directly — not
//! `tauri-plugin-keyring`, whose iOS backend only implements a `ping` stub and
//! doesn't actually reach the Keychain. Desktop builds don't depend on
//! `keyring-core` at all (see `Cargo.toml`'s iOS-only target table), so these
//! commands compile everywhere but only do real work on iOS.

#[cfg(target_os = "ios")]
const SERVICE: &str = "dev.nullnotes.app";
#[cfg(target_os = "ios")]
const USER: &str = "git-pat";

#[cfg(target_os = "ios")]
fn token_entry() -> Result<keyring_core::Entry, String> {
    static STORE: std::sync::OnceLock<Result<(), String>> = std::sync::OnceLock::new();
    STORE
        .get_or_init(|| {
            let store =
                apple_native_keyring_store::protected::Store::new().map_err(|e| e.to_string())?;
            keyring_core::set_default_store(store);
            Ok(())
        })
        .clone()?;
    keyring_core::Entry::new(SERVICE, USER).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_git_token() -> Result<String, String> {
    #[cfg(target_os = "ios")]
    {
        let entry = token_entry()?;
        match entry.get_password() {
            Ok(token) => Ok(token),
            Err(keyring_core::Error::NoEntry) => Ok(String::new()),
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
        let entry = token_entry()?;
        entry.set_password(&token).map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = token;
        Err("git credential storage is only available on iOS".to_string())
    }
}

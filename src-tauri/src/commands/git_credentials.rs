//! Stores the single git PAT mobile needs for `push_notes`/`fetch_and_compare`/
//! `clone_repo` in the platform credential store via `keyring-core` directly — the iOS
//! Keychain or the Android Keystore — not `tauri-plugin-keyring`, whose iOS backend only
//! implements a `ping` stub and doesn't actually reach the Keychain. Desktop builds don't
//! depend on `keyring-core` at all (see `Cargo.toml`'s mobile-only target tables), so
//! these commands compile everywhere but only do real work on mobile.

#[cfg(mobile)]
const SERVICE: &str = "dev.nullnotes.app";
#[cfg(mobile)]
const USER: &str = "git-pat";

#[cfg(target_os = "ios")]
fn install_store() -> Result<(), String> {
    let store = apple_native_keyring_store::protected::Store::new().map_err(|e| e.to_string())?;
    keyring_core::set_default_store(store);
    Ok(())
}

#[cfg(target_os = "android")]
fn install_store() -> Result<(), String> {
    let store = android_native_keyring_store::Store::new().map_err(|e| e.to_string())?;
    keyring_core::set_default_store(store);
    Ok(())
}

#[cfg(mobile)]
fn token_entry() -> Result<keyring_core::Entry, String> {
    static STORE: std::sync::OnceLock<Result<(), String>> = std::sync::OnceLock::new();
    STORE.get_or_init(install_store).clone()?;
    keyring_core::Entry::new(SERVICE, USER).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_git_token() -> Result<String, String> {
    #[cfg(mobile)]
    {
        let entry = token_entry()?;
        match entry.get_password() {
            Ok(token) => Ok(token),
            Err(keyring_core::Error::NoEntry) => Ok(String::new()),
            Err(e) => Err(e.to_string()),
        }
    }
    #[cfg(not(mobile))]
    Err("git credential storage is not available on this platform".to_string())
}

#[tauri::command]
pub fn set_git_token(token: String) -> Result<(), String> {
    #[cfg(mobile)]
    {
        let entry = token_entry()?;
        entry.set_password(&token).map_err(|e| e.to_string())
    }
    #[cfg(not(mobile))]
    {
        let _ = token;
        Err("git credential storage is not available on this platform".to_string())
    }
}

#[cfg(all(test, not(mobile)))]
mod tests {
    use super::*;

    #[test]
    fn credential_commands_report_unsupported_off_mobile() {
        assert!(get_git_token().is_err());
        assert!(set_git_token("token".to_string()).is_err());
    }
}

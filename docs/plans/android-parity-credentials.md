# Android Parity: Keystore Credentials Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Make `get_git_token` / `set_git_token` store the HTTPS PAT in the Android Keystore, so onboarding's clone and the later push/fetch have a token on Android the way they do on iOS.

**Architecture:** The spec's open question ("`keyring` has no Android store usable without Java-side setup") resolves to the official `android-native-keyring-store` 1.0.0 crate — a `keyring-core` credential store, the same API iOS already uses via `apple-native-keyring-store`. `git_credentials.rs` already routes through `keyring_core::Entry`; this plan adds a second `install_store()` for Android and widens the other gates from `ios` to `mobile`. The crate keeps ciphertext in a dedicated SharedPreferences file under a dedicated Keystore key and needs `ndk-context` initialised; Tauri Mobile does that itself, so the expected path needs no Kotlin. Task 2 proves that on the emulator and carries the documented Kotlin fix-forward if it doesn't hold.

**Tech Stack:** Rust (`keyring-core` 1, `android-native-keyring-store` 1), Tauri 2 Android, `adb`, Chrome DevTools Protocol over a forwarded WebView socket.

**Spec:** docs/specs/android-parity-design.md (Approach, step 3 — "Credentials"). The spec's spike ("keyring-core Android store or JNI/Tauri plugin") was done while writing this plan, by reading crates.io and docs.rs: `android-native-keyring-store` 1.0.0 (2026-04-21, `open-source-cooperative`, same org as `keyring-core`) exists and targets `keyring-core`. `android-keyring` 0.2.0 does not fit — it depends on the old `keyring` 3.x API. What the spike could *not* establish — that the store's JNI init is satisfied by Tauri, and that it works in an app whose Rust is a `cdylib` named `null_notes_lib` — is Task 2's job and gates shipping.

## Execution Options

Leave every box below unchecked. The executing skill resolves them with
your human partner before Step 1 and checks the chosen boxes itself.

**Execution Target:**
- [ ] Current branch (no isolation)
- [ ] New feature branch (no worktree)
- [ ] Worktree (superpowers:using-git-worktrees)

**Execution Mode:**
- [ ] Inline execution (superpowers:executing-plans)
- [ ] Subagent-driven execution (superpowers:subagent-driven-development)

## Global Constraints

- **Precondition: plan 2 is done** (`docs/plans/android-parity-shared-mobile-git.md`, commit `7aa8294`): `git_mobile` is routed on Android, the `mobile` cfg is in use, and `npx tauri android build --debug --target x86_64` succeeds. If it doesn't on a clean tree, stop and fix that first.
- Spec: "Store the HTTPS token in the Android Keystore." Spec fallback: "If nothing viable exists, the fallback is app-private encrypted storage, reported as a weaker guarantee than Keychain before it ships." This plan does **not** build the fallback. If Task 2 shows the Keystore store is unusable, stop and report to the user — do not ship a weaker store silently.
- **The token never enters the workspace folder** (project CLAUDE.md, storage boundary): not `.workspace.json`, not a sidecar, not a note. It lives only in the OS credential store.
- **No desktop and no iOS behaviour change.** Desktop must still not depend on `keyring-core`; iOS keeps `apple-native-keyring-store` with `protected`. No iOS build is run (macOS CI minutes bill 10x).
- **No `.unwrap()` / `.expect()` outside tests**; commands return `Result<_, String>`.
- No new comments except where the WHY is non-obvious.
- Run `cargo fmt` and `cargo clippy -- -D warnings` before committing (CI only checks on PRs; this repo commits to `main`).
- PowerShell does not persist env vars between tool calls; set `ANDROID_HOME`, `NDK_HOME`, `JAVA_HOME` inline in every Android command. Use whichever JDK plan 1 settled on (25 below is the installed one; `05d39d9` pinned Gradle 8.14.3).
- The working tree may hold unrelated edits (`src/ink/*`). Stage only the files each task names.

## Review Focus

Failure modes this change implies that host tests cannot exercise, most likely first:

1. **Store init fails or panics because `ndk-context` isn't initialised** (or the JNI symbol isn't exported from `null_notes_lib`). Must surface as a clean `Err(String)` in the UI, never a crash. Pinned by Task 2 Steps 3 and 7.
2. **Token stored readable.** The whole point of the Keystore is that app storage never holds the PAT. Pinned by Task 2 Step 6 (`run-as` grep of the app's data dir for the token string).
3. **Token lost on process death / restart.** Pinned by Task 2 Step 5 (force-stop, relaunch, read back).
4. **Reading before any write.** A fresh install must return `""` (the `NoEntry → Ok("")` arm), not an error — `tauri.ts` calls `getStoredGitToken()` before every clone/push/fetch, so an error here blocks all git on first run. Pinned by Task 2 Step 3.
5. **Auto-backup restoring ciphertext without its Keystore key.** The manifest doesn't set `allowBackup`, so it defaults to true; a restore onto another device would bring back the SharedPreferences file but not the Keystore key, and every `get_password` would then fail permanently. Pinned by Task 1 Step 6 (`allowBackup="false"`, checked in the merged manifest). Not exercisable on the emulator.
6. **Two `keyring-core` versions in the graph**, making `keyring_core::Entry` and the store's `Entry` nominally different types. Pinned by Task 1 Step 3.

---

### Task 1: Add the Android store and widen the credential gates

**Files:**
- Modify: `src-tauri/Cargo.toml:63-68` (the `cfg(target_os = "ios")` dependency table)
- Modify: `src-tauri/src/commands/git_credentials.rs` (whole file)
- Modify: `src-tauri/gen/android/app/src/main/AndroidManifest.xml:8-12`
- Modify (generated): `src-tauri/Cargo.lock`

**Interfaces:**
- Consumes: the `mobile` cfg emitted by `tauri-build`; `keyring_core::{Entry, Error, set_default_store}`.
- Produces: on Android, `get_git_token() -> Result<String, String>` returns the stored token or `""` if none; `set_git_token(token: String) -> Result<(), String>` stores it. Signatures are unchanged on every target, so `src/lib/gitCredentials.ts` and the `generate_handler!` list in `lib.rs` need no edits.

- [ ] **Step 1: Write the desktop characterisation test**

Append to `src-tauri/src/commands/git_credentials.rs`:

```rust
#[cfg(all(test, not(mobile)))]
mod tests {
    use super::*;

    #[test]
    fn credential_commands_report_unsupported_off_mobile() {
        assert!(get_git_token().is_err());
        assert!(set_git_token("token".to_string()).is_err());
    }
}
```

- [ ] **Step 2: Run it**

Run: `cd src-tauri; cargo test credential_commands_report_unsupported_off_mobile`
Expected: PASS. This pins today's desktop behaviour so the gate widening in Step 4 cannot flip it; it is not a red-green test.

- [ ] **Step 3: Add the dependency and confirm one `keyring-core`**

In `src-tauri/Cargo.toml`, replace the iOS table:

```toml
[target.'cfg(target_os = "ios")'.dependencies]
keyring-core = "1"
# keyring's v1 `Entry` auto-selects the macOS keychain store, which doesn't
# exist on iOS, so every call failed with NoDefaultStore. Using keyring-core
# with the Apple protected store set explicitly (git_credentials.rs) avoids it.
apple-native-keyring-store = { version = "1", features = ["protected"] }
```

with:

```toml
[target.'cfg(any(target_os = "ios", target_os = "android"))'.dependencies]
keyring-core = "1"

[target.'cfg(target_os = "ios")'.dependencies]
# keyring's v1 `Entry` auto-selects the macOS keychain store, which doesn't
# exist on iOS, so every call failed with NoDefaultStore. Using keyring-core
# with the Apple protected store set explicitly (git_credentials.rs) avoids it.
apple-native-keyring-store = { version = "1", features = ["protected"] }

[target.'cfg(target_os = "android")'.dependencies]
android-native-keyring-store = "1"
```

Then:

```powershell
cd src-tauri
cargo fetch --target x86_64-linux-android
cargo tree --target x86_64-linux-android -i keyring-core
```

Expected: exactly one `keyring-core v1.x.y` root, with both `null-notes` and `android-native-keyring-store` listed beneath it. Two versions (`v1.x` and `v2.x`) means the store pins a different major — stop and report; do not shim it.

- [ ] **Step 4: Confirm the store constructor, then rewrite `git_credentials.rs`**

Check the real signature (docs.rs did not expose it):

```powershell
Select-String -Path "$env:USERPROFILE\.cargo\registry\src\*\android-native-keyring-store-1.*\src\by_store\*.rs" -Pattern "pub fn new"
```

Expected: `pub fn new() -> Result<Arc<Store>>` (or a `Result` whose error implements `Display`). The code below assumes that, mirroring the Apple store. If `new` takes arguments, or only `new_with_configuration` exists, change just the one `Store::new()` call in `install_store` for Android and keep everything else.

Replace the whole of `src-tauri/src/commands/git_credentials.rs` (keeping the test module from Step 1 at the bottom) with:

```rust
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
```

- [ ] **Step 5: Verify desktop is unchanged**

```powershell
cd src-tauri
cargo fmt
cargo clippy -- -D warnings
cargo test
```

Expected: all pass, including `credential_commands_report_unsupported_off_mobile`. Then confirm desktop still has no `keyring-core`: `cargo tree -i keyring-core` must fail with "did not match any packages".

- [ ] **Step 6: Disable auto-backup**

In `AndroidManifest.xml`, add `android:allowBackup="false"` to the `<application>` element (next to `android:icon`):

```xml
    <application
        android:allowBackup="false"
        android:icon="@mipmap/ic_launcher"
```

The PAT's ciphertext lives in app storage and its key in the Keystore; backup would restore one without the other. The app's valuable data is the git-synced workspace, so nothing worth backing up is lost.

- [ ] **Step 7: Lint the Android target**

```powershell
$env:ANDROID_HOME = "C:\Users\Moritz\AppData\Local\Android\Sdk"
$env:NDK_HOME = "$env:ANDROID_HOME\ndk\29.0.14206865"
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-25.0.1.8-hotspot"
$ndkBin = "$env:NDK_HOME\toolchains\llvm\prebuilt\windows-x86_64\bin"
$env:CC_x86_64_linux_android = "$ndkBin\x86_64-linux-android34-clang.cmd"
$env:AR_x86_64_linux_android = "$ndkBin\llvm-ar.exe"
cd src-tauri
cargo clippy --target x86_64-linux-android -- -D warnings
```

Expected: clean. A type error on `set_default_store(store)` means `Store::new()` returned something other than what `set_default_store` accepts — adapt per Step 4's note (for example `Arc::clone` or `.into()`), keeping iOS untouched. If `cc` cannot find the toolchain despite these variables, run `npx tauri android build --debug --target x86_64` and read its `warning:`/`error:` lines instead.

- [ ] **Step 8: Commit**

```bash
cd /d/Coding/Apps/null-notes
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/commands/git_credentials.rs src-tauri/gen/android/app/src/main/AndroidManifest.xml
git commit -m "feat(android): store the git token in the Android Keystore via keyring-core

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Prove it on the emulator (and fix JNI init only if it fails)

**Files:**
- Create (only if Step 3 shows an init failure): `src-tauri/gen/android/app/src/main/java/io/crates/keyring/Keyring.kt`
- Modify (only if Step 3 shows an init failure): `src-tauri/gen/android/app/src/main/java/dev/nullnotes/app/MainActivity.kt`
- Create (outside the repo): `$env:TEMP\cdp-eval.mjs`

**Interfaces:**
- Consumes: Task 1's build; a booted AVD (`adb devices` first — the emulator died once during a long Gradle build).
- Produces: a recorded verdict — Keystore store works / does not — and the evidence for the spec's "iOS delta" and plan 4 (live sync needs a working token).

- [ ] **Step 1: Build, reinstall clean, launch**

```powershell
$env:ANDROID_HOME = "C:\Users\Moritz\AppData\Local\Android\Sdk"
$env:NDK_HOME = "$env:ANDROID_HOME\ndk\29.0.14206865"
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-25.0.1.8-hotspot"
npx tauri android build --debug --target x86_64
$adb = "$env:ANDROID_HOME\platform-tools\adb.exe"
& $adb devices
& $adb uninstall dev.nullnotes.app
$apk = (Get-ChildItem -Recurse "src-tauri\gen\android\app\build\outputs\apk" -Filter "*x86_64*debug*.apk" | Select-Object -First 1).FullName
& $adb install $apk
& $adb logcat -c
& $adb shell monkey -p dev.nullnotes.app -c android.intent.category.LAUNCHER 1
Start-Sleep -Seconds 10
```

Expected: build succeeds, `adb devices` shows one `device`, install prints `Success`. Uninstalling first wipes any earlier SharedPreferences so Step 3 sees a truly fresh install. Also confirm the merged manifest picked up the backup change: `Select-String -Path (Get-ChildItem -Recurse src-tauri\gen\android\app\build\intermediates\merged_manifests -Filter AndroidManifest.xml | Select-Object -First 1).FullName -Pattern allowBackup` must show `false`.

- [ ] **Step 2: Create the WebView eval helper and attach to the WebView**

`$env:TEMP\cdp-eval.mjs` (needs Node 22+ for the global `WebSocket`; check `node --version`):

```js
const [, , wsUrl, expression] = process.argv
const sock = new WebSocket(wsUrl)
sock.onopen = () =>
  sock.send(
    JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression, awaitPromise: true, returnByValue: true },
    }),
  )
sock.onmessage = (e) => {
  console.log(JSON.stringify(JSON.parse(e.data).result))
  sock.close()
}
sock.onerror = (e) => {
  console.error('ws error', e.message)
  process.exit(1)
}
```

Attach:

```powershell
$procId = (& $adb shell pidof dev.nullnotes.app).Trim()
& $adb forward tcp:9222 "localabstract:webview_devtools_remote_$procId"
$ws = (Invoke-RestMethod http://127.0.0.1:9222/json)[0].webSocketDebuggerUrl
$ws
```

Expected: a `ws://127.0.0.1:9222/devtools/page/…` URL. If the forward or `/json` fails (WebView debugging not enabled in this build), skip to the Fallback at the end of this task for Steps 3–5.

Define a helper for the next steps:

```powershell
function Invoke-Tauri($cmd, $args_ = '{}') {
  node "$env:TEMP\cdp-eval.mjs" $ws "window.__TAURI_INTERNALS__.invoke('$cmd', $args_)"
}
```

- [ ] **Step 3: Read before write, then write and read back**

```powershell
Invoke-Tauri get_git_token
Invoke-Tauri set_git_token '{ token: "ghp_parity_AAAA" }'
Invoke-Tauri get_git_token
Invoke-Tauri set_git_token '{ token: "ghp_parity_BBBB" }'
Invoke-Tauri get_git_token
```

Expected `result.value` in order: `""` (Review Focus 4 — fresh install, no error), `null`, `"ghp_parity_AAAA"`, `null`, `"ghp_parity_BBBB"` (overwrite works).

If any call returns an `exceptionDetails` / error string mentioning `JavaVM`, `ndk`, `context`, `NoClassDefFoundError`, `UnsatisfiedLinkError` or "not initialized", that is Review Focus 1: go to Step 7 before continuing. A logcat `FATAL`/`panicked` is also Review Focus 1 and must be fixed, not tolerated:

```powershell
& $adb logcat -d | Select-String -Pattern "FATAL|panicked|keyring|nullnotes"
```

- [ ] **Step 4: Check the clean-error property**

Not separately testable if Step 3 passed first time. If Step 7 was needed, record the exact pre-fix error text — it is the evidence that a failed init surfaced as an error string rather than a crash.

- [ ] **Step 5: Survive process death**

```powershell
& $adb shell am force-stop dev.nullnotes.app
& $adb shell monkey -p dev.nullnotes.app -c android.intent.category.LAUNCHER 1
Start-Sleep -Seconds 10
$procId = (& $adb shell pidof dev.nullnotes.app).Trim()
& $adb forward tcp:9222 "localabstract:webview_devtools_remote_$procId"
$ws = (Invoke-RestMethod http://127.0.0.1:9222/json)[0].webSocketDebuggerUrl
Invoke-Tauri get_git_token
```

Expected: `"ghp_parity_BBBB"` (Review Focus 3).

- [ ] **Step 6: Check the token is not readable at rest**

```powershell
& $adb shell run-as dev.nullnotes.app find . -path "*shared_prefs*" -type f
& $adb shell run-as dev.nullnotes.app grep -rl "ghp_parity" .
```

Expected: the first lists at least one file under `shared_prefs/` (the store's dedicated file, proving it wrote there); the second prints **nothing** (no file contains the plaintext token). Any hit is a failure of Review Focus 2 — stop and report. `run-as` works because this is a debuggable build.

- [ ] **Step 7: Only if Step 3 showed an init failure — add the Kotlin context init**

The store's README says to add a Kotlin class `io.crates.keyring.Keyring` and call `initializeNdkContext` from `MainActivity`, unless the framework initialises `ndk-context` itself (Tauri Mobile is documented to). Create `src-tauri/gen/android/app/src/main/java/io/crates/keyring/Keyring.kt` (no `init { System.loadLibrary(...) }` block — Tauri already loads `null_notes_lib`, which is where the native symbol must live):

```kotlin
package io.crates.keyring

import android.content.Context

class Keyring {
  companion object {
    @JvmStatic
    external fun initializeNdkContext(context: Context)
  }
}
```

and in `MainActivity.kt`, after `super.onCreate(savedInstanceState)`:

```kotlin
    io.crates.keyring.Keyring.initializeNdkContext(applicationContext)
```

Rebuild and redo Steps 1–6. If the app now throws `UnsatisfiedLinkError` for `Java_io_crates_keyring_Keyring_00024Companion_initializeNdkContext`, the dependency's exported symbol was dropped from `null_notes_lib`: stop and report to the user (the options are a `pub use` re-export to force linkage, or the spec's encrypted-storage fallback, which needs their explicit sign-off). Do not iterate on linker flags unattended.

- [ ] **Step 8: Exercise the real onboarding path**

On the no-workspace screen choose "Clone workspace…", enter `https://example.invalid/notes.git` and a token `ghp_parity_CCCC`, submit. Capture:

```powershell
& $adb exec-out screencap -p > $env:TEMP\clone-with-token.png
& $adb logcat -d | Select-String -Pattern "FATAL|panicked"
```

Read the screenshot. Expected: a gix/network error for `example.invalid`, not a credential error and not a crash — meaning `set_git_token` (WorkspacePicker) and `get_git_token` (before the clone, `tauri.ts`) both worked through the real UI. Then re-run `Invoke-Tauri get_git_token` (reattach `$ws` if the page reloaded): expected `"ghp_parity_CCCC"`.

- [ ] **Step 9: Commit any fix-forward and report**

Only if Step 7 changed files:

```bash
cd /d/Coding/Apps/null-notes
git add src-tauri/gen/android/app/src/main/java/io/crates/keyring/Keyring.kt src-tauri/gen/android/app/src/main/java/dev/nullnotes/app/MainActivity.kt
git commit -m "fix(android): initialise ndk-context for the Keystore credential store

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Tell the user: whether Step 7 was needed, the Step 6 at-rest result, the Step 8 on-screen result, and that plan 4 (live sync) is unblocked. Do not edit the spec here; the "iOS delta" section collects findings at the end of the pass. Note for that section: Android Keystore behaviour proves nothing about iOS Keychain, and `allowBackup` restore behaviour was never exercised.

**Fallback if the WebView debug socket is unavailable (Steps 3–5 only):** use the UI path from Step 8 with a token typed into the form, then verify persistence and at-rest storage with Step 6's `run-as` commands, and verify read-back by re-running Step 8's clone attempt with the token field left empty after a `force-stop`/relaunch — a network error rather than a credential error means the stored token was read. This is weaker evidence (no direct read-back value); say so in the report.

---

## Out of scope (this plan)

- The encrypted-file fallback (only on explicit user sign-off after a failed Task 2).
- Live clone/sync against the fixture remote (plan 4), WebView shell checks (plan 5), pdfium (plan 6).
- Biometric gating, token rotation UI, multiple-account tokens (one `git-pat` entry, as on iOS).
- Any iOS build or CI run.

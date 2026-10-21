# Android Parity: Shared Mobile Cfg and Git Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Route Android's git commands through `git_mobile` (gix) instead of desktop's CLI-shelling `git.rs`, by replacing the iOS-only `target_os = "ios"` gate with the existing `mobile` cfg wherever the gate means "mobile" — so iOS inherits the same change for free.

**Architecture:** Tauri's `tauri-build` already emits a `mobile` cfg alias (`target_os = "ios"` or `"android"`; `src-tauri/src/lib.rs:19` already uses it in `cfg_attr(mobile, …)`). The 22 git command wrappers (11 in `git.rs` gated `not(target_os = "ios")`, 11 in `git_mobile.rs` gated `target_os = "ios"`) and `lib.rs`'s `git_impl` alias swap to `not(mobile)` / `mobile`. Gates that mean "Apple-specific" (`git_credentials.rs`'s Keychain code, `renderer.rs`'s iOS `assets/` fallback, `lib.rs`'s iOS pdfium smoke hooks, `Cargo.toml`'s `apple-native-keyring-store`) stay iOS-only; Android credential storage is plan 3 and pdfium is plan 6.

**Tech Stack:** Rust cfg attributes, Tauri 2 Android build (`npx tauri android build`), `adb`.

**Spec:** docs/specs/android-parity-design.md (Approach, step 2 — "Shared mobile cfg and git"). Deviation from the spec's wording: it says `any(target_os = "ios", target_os = "android")`; this plan uses the `mobile` alias, which is exactly that expression and is already used in `lib.rs`, so it is one token instead of a 40-character expression repeated 23 times.

## Execution Options

Leave every box below unchecked. The executing skill resolves them with
your human partner before Step 1 and checks the chosen boxes itself.

**Execution Target:**
- [x] Current branch (no isolation)
- [ ] New feature branch (no worktree)
- [ ] Worktree (superpowers:using-git-worktrees)

**Execution Mode:**
- [x] Inline execution (superpowers:executing-plans)
- [ ] Subagent-driven execution (superpowers:subagent-driven-development)

## Global Constraints

- **Precondition: plan 1 is done** — `docs/plans/mobile-android-scaffold.md` Tasks 2–3 (x86_64 debug APK builds, installs and launches on the AVD `Pixel_3a_API_34_extension_level_7_x86_64`). If `npx tauri android build --debug --target x86_64` does not succeed on a clean tree, stop and finish plan 1 first.
- **No behavior change on desktop.** Desktop must keep resolving `git_impl` to `commands::git`.
- **No iOS behavior change, and no iOS build is run here.** macOS CI minutes bill 10x (memory: iOS CI cost); iOS correctness is argued from `mobile ⊇ ios` and confirmed in the eventual single iOS CI run.
- **Credentials and pdfium are out of scope.** `git_credentials.rs` keeps its iOS Keychain code untouched; only the Android-side error text changes. `renderer.rs`, `Cargo.toml`, and `lib.rs`'s `target_os = "ios"` smoke-test hooks (lines 41, 70) are not modified.
- **No new comments except where the WHY is non-obvious** (project CLAUDE.md). Existing doc comments that name the old gate are updated, not added to.
- Run `cargo fmt` and `cargo clippy -- -D warnings` before committing (CI only checks these on PRs; this repo commits to `main`).
- PowerShell does not persist env vars between tool calls; set `ANDROID_HOME`, `NDK_HOME`, `JAVA_HOME` inline in every Android command (see `mobile-android-scaffold.md` Task 1 Step 4).

## Review Focus

Failure modes this change implies that the host tests cannot exercise, most likely first:

1. **A wrapper left on the old gate.** If one `git.rs` wrapper keeps `not(target_os = "ios")` while its `git_mobile.rs` twin moves to `mobile`, Android compiles both and `#[tauri::command]`'s crate-global helper macro collides (`git_mobile.rs`'s own header warns of this); the reverse leaves a command unregistered. Pinned by the 11/11 count check in Task 1 and the Android build in Task 2.
2. **Desktop silently flipping to `git_mobile`.** `mobile` must be false on Windows. Pinned by `cargo test` still running the desktop `git.rs` suite and by the count check showing `not(mobile)` on `git.rs`.
3. **Android credential commands panicking or hanging instead of returning `Err`.** They must return a clean `Err(String)` so the UI shows a message; pinned in Task 3 by observing the on-device error text.
4. **Any desktop `git` spawn reachable on Android.** There is no `git` binary in the app sandbox; an error mentioning `git` failing to launch / "program not found" means a path still routes to `git.rs`. Pinned in Task 3.
5. **`unexpected_cfgs` / dead-code warnings under `-D warnings` on the Android target** (helpers in `git.rs` used only by the now-excluded wrappers). Pinned by Task 2's Android clippy run.

---

### Task 1: Swap the git gates from `ios` to `mobile`

**Files:**
- Modify: `src-tauri/src/lib.rs:12-15`
- Modify: `src-tauri/src/commands/git.rs` (11 attributes: lines 153, 190, 455, 554, 600, 680, 885, 941, 1139, 1188, 1244)
- Modify: `src-tauri/src/commands/git_mobile.rs` (11 attributes: lines 801, 810, 819, 833, 849, 858, 867, 876, 888, 901, 910; plus the header doc comment lines 1-19)
- Modify: `src-tauri/src/commands/git_credentials.rs:38-53`

**Interfaces:**
- Consumes: the `mobile` cfg emitted by `tauri-build` (`src-tauri/build.rs` calls `tauri_build::try_build`).
- Produces: on Android, `lib.rs`'s `git_impl` is `commands::git_mobile`, so `invoke("clone_repo", { url, parentDir, token })` etc. resolve to the gix implementation. `get_git_token` / `set_git_token` still exist on every target (they are in the unconditional `generate_handler!` list) and return `Err` on non-iOS.

- [ ] **Step 1: Record the baseline counts**

Run (bash):

```bash
cd /d/Coding/Apps/null-notes/src-tauri/src
grep -c '^#\[cfg(not(target_os = "ios"))\]' commands/git.rs
grep -c '^#\[cfg(target_os = "ios")\]' commands/git_mobile.rs
```

Expected: `11` and `11`.

- [ ] **Step 2: Swap the 22 wrapper gates**

```bash
cd /d/Coding/Apps/null-notes/src-tauri/src
sed -i 's/^#\[cfg(not(target_os = "ios"))\]$/#[cfg(not(mobile))]/' commands/git.rs
sed -i 's/^#\[cfg(target_os = "ios")\]$/#[cfg(mobile)]/' commands/git_mobile.rs
```

Both files' only `target_os = "ios"` attributes are these wrappers (confirmed by grep before writing this plan); the anchored patterns do not touch indented `cfg(all(…))` or `git_credentials.rs`.

- [ ] **Step 3: Swap `lib.rs`'s `git_impl` alias**

In `src-tauri/src/lib.rs`, replace:

```rust
#[cfg(not(target_os = "ios"))]
use commands::git as git_impl;
#[cfg(target_os = "ios")]
use commands::git_mobile as git_impl;
```

with:

```rust
#[cfg(not(mobile))]
use commands::git as git_impl;
#[cfg(mobile)]
use commands::git_mobile as git_impl;
```

Leave lines 41 and 70 (`cfg(all(target_os = "ios", debug_assertions))` pdfium smoke hooks) alone.

- [ ] **Step 4: Update the stale header doc in `git_mobile.rs`**

Replace the module doc's first sentence and its `#[cfg(not(target_os = "ios"))]` mention so they say "mobile":

```rust
//! The mobile-target replacement for `git.rs` (iOS and Android): the same 11 operations,
//! reimplemented against `gix` instead of shelling out to `git` — neither the iOS App
//! Sandbox nor the Android app sandbox ships (or, on iOS, permits spawning) a `git`
//! binary to shell out to.
```

and in the last paragraph change `#[cfg(not(target_os =\n//! "ios"))]` to `#[cfg(not(mobile))]` (reflow the comment so it stays under rustfmt's width; `cargo fmt` does not reflow comments, so keep lines ≤ 100 columns by hand).

- [ ] **Step 5: Make the Android credential error accurate**

In `src-tauri/src/commands/git_credentials.rs`, the two `#[cfg(not(target_os = "ios"))]` arms both return `"git credential storage is only available on iOS"`. That is now wrong on Android in intent (it is "not implemented yet", plan 3) and misleading on desktop. Change both strings to:

```rust
Err("git credential storage is not available on this platform".to_string())
```

Update the file's first doc paragraph's last sentence to match: `…so these commands compile everywhere but only do real work on iOS (Android storage is added separately).` No `cfg` changes in this file.

- [ ] **Step 6: Verify the counts and that nothing else moved**

```bash
cd /d/Coding/Apps/null-notes/src-tauri/src
grep -c '^#\[cfg(not(mobile))\]' commands/git.rs
grep -c '^#\[cfg(mobile)\]' commands/git_mobile.rs
grep -rn 'target_os = "ios"' . | grep -v 'git_credentials.rs'
```

Expected: `11`, `11`, and the third command lists only `lib.rs` lines 41 and 70 and `pdf/renderer.rs:52` (the Apple-specific gates deliberately left alone).

- [ ] **Step 7: Format, lint, and test on the desktop target**

```bash
cd /d/Coding/Apps/null-notes/src-tauri
cargo fmt
cargo clippy -- -D warnings
cargo test
```

Expected: all pass; `cargo test` still runs the `git.rs` and `git_mobile.rs` host suites unchanged.

- [ ] **Step 8: Commit**

```bash
cd /d/Coding/Apps/null-notes
git add src-tauri/src/lib.rs src-tauri/src/commands/git.rs src-tauri/src/commands/git_mobile.rs src-tauri/src/commands/git_credentials.rs
git commit -m "feat(mobile): route Android git through git_mobile via the mobile cfg

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Prove the Android target compiles and lints clean

**Files:** none expected. Fix-forward edits only to files from Task 1 if the build or clippy reports a problem.

**Interfaces:**
- Consumes: Task 1's gates; the Android toolchain from plan 1 (`ANDROID_HOME`, `NDK_HOME`, `JAVA_HOME`, the four Android rustup targets).
- Produces: `src-tauri/gen/android/app/build/outputs/apk/**/app-x86_64-debug.apk` built from the new gates — Task 3 installs it.

- [ ] **Step 1: Build the debug APK for the emulator ABI**

```powershell
$env:ANDROID_HOME = "C:\Users\Moritz\AppData\Local\Android\Sdk"
$env:NDK_HOME = "$env:ANDROID_HOME\ndk\29.0.14206865"
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-25.0.1.8-hotspot"
npx tauri android build --debug --target x86_64
```

(Use whichever JDK plan 1 settled on if it replaced 25 with 17/21.) Expected: succeeds. A `E0428`-style "defined multiple times" error for a command name (`detect_repo`, `clone_repo`, …) or "cannot find … `__cmd__…`" means a wrapper kept the wrong gate — re-run Task 1 Step 6's counts and fix the odd one out.

- [ ] **Step 2: Lint the Android target**

```powershell
$ndkBin = "$env:NDK_HOME\toolchains\llvm\prebuilt\windows-x86_64\bin"
$env:CC_x86_64_linux_android = "$ndkBin\x86_64-linux-android34-clang.cmd"
$env:AR_x86_64_linux_android = "$ndkBin\llvm-ar.exe"
cd src-tauri
cargo clippy --target x86_64-linux-android -- -D warnings
```

Expected: clean. If the `cc` crate cannot find the toolchain despite these variables, fall back to re-running Step 1 and reading its output for `warning:` lines pointing into `src-tauri/src/`; treat any in the files from Task 1 as failures. Fix any dead-code warnings by gating the offending helper with `#[cfg(not(mobile))]`, matching how iOS would have hit the same warning.

- [ ] **Step 3: Commit any fix-forward changes**

Only if Steps 1–2 required source edits:

```bash
git add <files actually changed>
git commit -m "fix(mobile): clear Android-target warnings after the mobile cfg swap

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Skip if nothing changed.

---

### Task 3: Confirm routing on the emulator

**Files:** none (evidence only; findings go in the final report to the user, and in the "iOS delta" section of the spec once it exists).

**Interfaces:**
- Consumes: the APK from Task 2 Step 1; a booted AVD (re-check `adb devices` first — the emulator process died once during a long Gradle build in plan 1).
- Produces: a recorded statement of what a git action does on Android after this change — the handoff to plan 3 (credentials) and plan 4 (live sync).

- [ ] **Step 1: Install and launch**

```powershell
$adb = "$env:ANDROID_HOME\platform-tools\adb.exe"
& $adb devices
$apk = (Get-ChildItem -Recurse "src-tauri\gen\android\app\build\outputs\apk" -Filter "*x86_64*debug*.apk" | Select-Object -First 1).FullName
& $adb install -r $apk
& $adb shell monkey -p dev.nullnotes.app -c android.intent.category.LAUNCHER 1
Start-Sleep -Seconds 10
& $adb logcat -c
```

Expected: `adb devices` lists one device in state `device`; install prints `Success`.

- [ ] **Step 2: Trigger a clone from onboarding**

On the no-workspace screen choose "Clone workspace…", enter `https://example.invalid/notes.git`, submit. Capture the result:

```powershell
& $adb exec-out screencap -p > clone-attempt.png
& $adb logcat -d | Select-String -Pattern "nullnotes|null_notes|FATAL|panicked"
```

Read `clone-attempt.png` as an image. Expected, in order of likelihood:
- an error mentioning the credential ("git credential storage is not available on this platform") — correct for now: the form stores/reads a token before cloning, and Android storage is plan 3. This also confirms Review Focus 3 (clean `Err`, no crash).
- a gix/network error for `example.invalid` — also correct (the mobile path ran).

Fail if the message mentions `git` failing to spawn / program not found / `No such file`, or logcat shows `FATAL` / `panicked` (Review Focus 3, 4).

- [ ] **Step 3: Report**

Tell the user: the Android build passes, which of the two expected errors appeared, and that live clone/sync stays blocked until plan 3 supplies a working `get_git_token`/`set_git_token` on Android. Do not edit other docs in this plan.

---

## Out of scope (this plan)

- Android Keystore credential storage (plan 3), live sync round trip against the smart-HTTP fixture (plan 4), WebView shell/feature-cut checks (plan 5), pdfium for Android (plan 6).
- Any iOS CI run. Remaining iOS-only gates (`renderer.rs` assets fallback, smoke-test hooks, Keychain code) are Apple-specific and intentionally untouched.

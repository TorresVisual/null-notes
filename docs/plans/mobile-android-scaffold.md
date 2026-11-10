# Android Mobile Scaffold Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Get the existing null-notes Tauri app building and launching on a local Android emulator, showing its existing (no-workspace) UI — the foundation every later Android task (git_mobile onboarding wiring, feature-cut gating, UI reflow, pdfium-for-Android) builds on, mirroring what `mobile-ios-scaffold.md` already did for iOS.

**Architecture:** Add Tauri 2's Android target to the *existing* Tauri project via `tauri android init`, which generates an Android Studio/Gradle project under `src-tauri/gen/android/`. The Rust mobile entry point already exists and is platform-generic (`#[cfg_attr(mobile, tauri::mobile_entry_point)]`, `src-tauri/src/lib.rs:19`) — no Rust entry-point changes needed. Unlike iOS, this runs entirely locally: no Mac/CI stand-in is needed because Android's toolchain (SDK, NDK, emulator) runs natively on the user's Windows machine, which is also why this plan exists — iOS work is paused on exhausted GitHub Actions minutes, Android is not CI-gated at all.

**Tech Stack:** Tauri 2 mobile (Android), Rust cross-compilation to Android NDK targets (`x86_64-linux-android` for the local emulator, plus `aarch64-linux-android`/`armv7-linux-androideabi`/`i686-linux-android` for a general Android Studio project), Android SDK/NDK/Gradle — run directly in this session against the user's local Android SDK install, no GitHub Actions.

**Spec:** docs/specs/mobile-app-design.md

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

- **Everything in this plan runs locally, in this session, against the user's own Windows machine.** No GitHub Actions workflow, no `gh workflow run`/`gh run watch` loop, no CI YAML file — the entire reason this plan exists is that Android doesn't need the Mac-via-CI workaround `mobile-ios-scaffold.md` required (Global Constraints there: "The user has no Mac... GitHub Student Pro is the only paid-tool access available"). iOS's `ios-scaffold.yml` is untouched by this plan.
- **iOS work is paused, not abandoned.** This plan does not modify `src-tauri/gen/apple/`, `src-tauri/tauri.ios.conf.json`, or any `#[cfg(target_os = "ios")]` block. iOS resumes whenever GitHub Actions budget is available again.
- **Scaffold only, same scope discipline as the iOS plan.** No `git_mobile.rs` onboarding wiring, no `Platform.isMobile` feature-cut gating, no app-shell UI reflow. In particular, `src-tauri/src/lib.rs:12-15` currently selects `git_impl` as `commands::git` (desktop's CLI-shelling implementation) for every non-iOS target, Android included — that means a build from this plan will compile and launch, but any git operation will fail at runtime (there is no `git` binary in the Android app sandbox). This is a known, deliberate gap for a later plan to close, exactly as iOS's own first scaffold plan launched with the same gap before a later plan wired up `git_mobile.rs`.
- **Do not pre-emptively gate `pdfium-render` or `portable-pty` out of the Android dependency graph.** `mobile-ios-scaffold.md` Task 1 Step 2's actual (not planned) result: both crates cross-compiled to iOS without any target-gating — `pdfium-render` binds to its native library at runtime via `Pdfium::bind_to_library`, not at link time, so its absence doesn't surface until something calls `bind_pdfium()`; `portable-pty` simply compiled clean. Try the Android build ungated first. Only add a `[target.'cfg(target_os = "android")'.dependencies]` gate (or a `#[cfg]` adjustment) if `tauri android build` actually fails on one of them, and only enough to fix the actual error.
- **No behavior change to desktop or iOS.** This plan only adds a new build target.

---

### Task 1: Bootstrap and verify the local Android toolchain

**Files:** None — this task is entirely environment/tooling verification, no repo changes.

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `ANDROID_HOME`, `NDK_HOME`, and `JAVA_HOME` set correctly for this session (and persistently for future sessions), the four Android Rust targets installed via `rustup`, and a confirmed-booting emulator that `adb` can see — Task 2 assumes all of this before running `tauri android init`.

Current machine state, already checked before writing this plan (re-verify rather than trust blindly — this was checked once, on 2026-09-16):
- Android SDK present at `C:\Users\<you>\AppData\Local\Android\Sdk` (`ANDROID_SDK_ROOT` already points here) — contains `platforms\android-34`, `build-tools\34.0.0` and `36.1.0`, `ndk\29.0.14206865`, `platform-tools` (with a working `adb`), and an existing AVD: `Pixel_3a_API_34_extension_level_7_x86_64`.
- `ANDROID_HOME`, `NDK_HOME`, and `JAVA_HOME` are **not** set — Tauri's Android tooling specifically looks for `ANDROID_HOME` and `NDK_HOME` (not `ANDROID_SDK_ROOT`/`ANDROID_NDK_HOME`), per Tauri's own prerequisites docs.
- A JDK is installed (Eclipse Temurin 25) at `C:\Program Files\Eclipse Adoptium\jdk-25.0.1.8-hotspot`, but nothing points `JAVA_HOME` at it.
- Only `x86_64-pc-windows-msvc` is installed via `rustup target list --installed` — none of the four Android targets are present yet.

- [x] **Step 1: Set the required environment variables for this session and persistently**

Persistently (so future sessions/terminals also have them — takes effect in *new* shells only):

```powershell
setx ANDROID_HOME "C:\Users\<you>\AppData\Local\Android\Sdk"
setx NDK_HOME "C:\Users\<you>\AppData\Local\Android\Sdk\ndk\29.0.14206865"
setx JAVA_HOME "C:\Program Files\Eclipse Adoptium\jdk-25.0.1.8-hotspot"
```

And for the current session (this tool's shell state doesn't persist across calls, so every subsequent PowerShell call in this plan that needs these vars must set them inline or rely on a fresh shell already having picked up the `setx` values — confirm which before Task 2):

```powershell
$env:ANDROID_HOME = "C:\Users\<you>\AppData\Local\Android\Sdk"
$env:NDK_HOME = "C:\Users\<you>\AppData\Local\Android\Sdk\ndk\29.0.14206865"
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-25.0.1.8-hotspot"
```

- [x] **Step 2: Install the Android Rust targets**

```powershell
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
```

Expected: all four install cleanly (they're prebuilt `std` targets, no NDK needed for this step itself).

- [x] **Step 3: Confirm the emulator boots and `adb` sees it**

```powershell
Start-Process -FilePath "$env:ANDROID_HOME\emulator\emulator.exe" -ArgumentList "-avd","Pixel_3a_API_34_extension_level_7_x86_64","-no-snapshot","-no-audio"
```

Wait for it to finish booting (first boot can take a minute or two), then:

```powershell
& "$env:ANDROID_HOME\platform-tools\adb.exe" devices
```

Expected: one line listing the emulator's serial (e.g. `emulator-5554`) with state `device` — not `offline` and not absent. If nothing shows up, the emulator is still booting; re-run `adb devices` rather than assuming failure.

- [x] **Step 4: Record the toolchain state**

**Actual result:** JDK/NDK as listed above, confirmed working — `rustup` installed all four targets cleanly, the AVD booted (`emulator-5554`, state `device`) within ~90s. One thing not anticipated: `PowerShell`'s own shell state doesn't persist between tool calls in this environment (each invocation is a fresh process), so `$env:ANDROID_HOME`/`NDK_HOME`/`JAVA_HOME` had to be re-set inline in every subsequent PowerShell command in this plan rather than relying on Step 1's session-scoped block carrying forward — the `setx` (persistent, HKCU) values also don't propagate to already-running child processes spawned by this session. A second, more consequential finding: the emulator process (`qemu-system`) silently died at some point during Task 2's ~10-minute Gradle build (only its `qemu-ga` helper was still running afterward) — cause not diagnosed (plausibly CPU/RAM contention with the concurrent Gradle/Kotlin build), but it required relaunching and re-polling `adb devices` before Task 3 could proceed. Anyone re-running this plan should expect to re-check `adb devices` right before Task 3, not assume Task 1's boot is still alive.

---

### Task 2: Generate the Android project and get the Rust core building

**Files:**
- Create: `src-tauri/gen/android/` (Android Studio/Gradle project — generated by `tauri android init`, tracked in git per this repo's existing convention of committing `gen/` except `gen/schemas`, per `src-tauri/.gitignore`, same as `gen/apple/`)
- Modify (only if Step 2's build actually fails — see Global Constraints): `src-tauri/Cargo.toml`, and whichever of `src-tauri/src/pdf/renderer.rs`, `src-tauri/src/pdf/extract.rs`, `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs` the actual compile error points at.

**Interfaces:**
- Consumes: the bootstrapped toolchain from Task 1 (`ANDROID_HOME`, `NDK_HOME`, `JAVA_HOME`, Android rustup targets, a booted emulator).
- Produces: a generated `gen/android/` project and a debug APK build that succeeds for `x86_64-linux-android` (the emulator's ABI) — Task 3 installs and launches this APK.

Note: unlike iOS (where `cargo check --target aarch64-apple-ios-sim` works standalone because Xcode's toolchain is already on `PATH` on a macOS runner), a bare `cargo check --target x86_64-linux-android` here would fail on a missing linker even for code with no real Android incompatibility, because nothing has told `rustc` where the NDK's clang linker lives yet. `tauri android init` and `tauri android build` set that wiring up themselves, so this task drives the Rust cross-compile check through Tauri's own CLI rather than a raw `cargo check`, mirroring how `mobile-ios-scaffold.md` Task 2 used `tauri ios init` to get a real, working project rather than hand-assembling one.

- [x] **Step 1: Generate the Android project**

From the repo root:

```powershell
npx tauri android init
```

Expected: creates `src-tauri/gen/android/` (Gradle project: `app/`, `build.gradle.kts`, `settings.gradle.kts`, `gradle/`, etc.) and picks up the existing Android icons already committed at `src-tauri/icons/android/` (generated as a byproduct of a prior `npx tauri icon` run during the iOS scaffold work — confirm they're present rather than assuming; if `tauri android init` reports missing icons, run `npx tauri icon src-tauri/icons/icon.png` first, then re-run `init`).

If this step errors instead, read the error before continuing — likely causes given the toolchain check in Task 1: `ANDROID_HOME`/`NDK_HOME` not visible in this exact shell (re-set them per Task 1 Step 1's session-scoped block), or a Gradle/JDK version mismatch (Temurin 25 is very new; if Gradle reports it can't run on this JDK, that's a real, no-shortcut blocker — install a JDK in the range the bundled Android Gradle Plugin supports, e.g. 17 or 21, alongside the existing JDK 25, and point `JAVA_HOME` at that one instead of replacing 25 system-wide).

- [x] **Step 2: Commit the generated project**

```bash
git add src-tauri/gen/android
git commit -m "build: generate the Android Studio project via tauri android init"
```

- [x] **Step 3: Attempt a debug build for the emulator's ABI**

```powershell
npx tauri android build --debug --target x86_64
```

Expected: this is where any real Android cross-compilation problem in the Rust dependency graph would surface (unlike iOS, this is untested territory — don't assume it'll be as clean as iOS's was). Read whatever error appears rather than guessing:
- If `pdfium-render` or something it depends on fails to compile (not just bind at runtime) for `x86_64-linux-android`, gate it the same way `mobile-ios-scaffold.md` Task 1 Step 3 was written to (but never needed) for iOS: move it into `[target.'cfg(not(target_os = "android"))'.dependencies]` in `src-tauri/Cargo.toml`, and wrap the `pdfium_render`-referencing code in `src-tauri/src/pdf/renderer.rs` and `src-tauri/src/pdf/extract.rs` with `#[cfg(all(feature = "pdf-native", not(target_os = "android")))]` / the inverse, matching the existing `not(target_os = "ios")` pattern already in those files if iOS ended up needing it, or adding a fresh `target_os = "android"` arm if not.
- If `portable-pty` fails to compile for Android, gate it the same way `mobile-ios-scaffold.md` Task 1 Step 4 describes: target-specific `[dependencies]` table, `#[cfg(not(target_os = "android"))] pub mod terminal;` in `src-tauri/src/commands/mod.rs`, and Android-side no-op stubs (or a hidden `app.manage`/handler-list entry) in `src-tauri/src/lib.rs`, mirroring whatever `terminal.rs` already does for iOS if that gating exists, or building fresh if iOS never needed it either.
- If the error is neither of these, diagnose it on its own terms — do not force-fit it into the pdfium/portable-pty pattern above.

Re-run `npx tauri android build --debug --target x86_64` after each fix attempt until it succeeds. Commit whatever source changes were actually needed (if any):

```bash
git add src-tauri/Cargo.toml src-tauri/src/pdf/renderer.rs src-tauri/src/pdf/extract.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "build: gate <whatever actually needed gating> out of the Android dependency graph"
```

(Only `git add` the files actually touched — if nothing needed gating, skip this commit entirely, same as iOS's Task 1 Steps 3-4 which turned out unnecessary and were left unchecked.)

- [x] **Step 4: Confirm the built APK exists**

```powershell
Get-ChildItem -Recurse "src-tauri\gen\android" -Filter "*.apk" | Select-Object FullName
```

Expected: at least one `app-x86_64-debug.apk` (or similarly named) under `gen/android/app/build/outputs/apk/`. Note the exact path — Task 3 installs this file.

---

### Task 3: Install, launch, and verify the app on the local emulator

**Files:** None — this task only drives `adb`/the emulator, no repo changes expected (Task 4's known-gaps note aside).

**Interfaces:**
- Consumes: the debug APK built in Task 2.
- Produces: a running app on the emulator, a before/after screenshot pair proving rendering + touch input work — the same kind of evidence `mobile-ios-scaffold.md` Task 3 produced for iOS, which the next Android plan (git_mobile onboarding wiring) can point back to.

- [x] **Step 1: Install and launch**

```powershell
$apk = (Get-ChildItem -Recurse "src-tauri\gen\android" -Filter "*.apk" | Select-Object -First 1).FullName
& "$env:ANDROID_HOME\platform-tools\adb.exe" install -r $apk
& "$env:ANDROID_HOME\platform-tools\adb.exe" shell monkey -p dev.nullnotes.app -c android.intent.category.LAUNCHER 1
Start-Sleep -Seconds 10
& "$env:ANDROID_HOME\platform-tools\adb.exe" exec-out screencap -p > before.png
```

(`monkey -p <package> -c android.intent.category.LAUNCHER 1` is the standard `adb`-only way to launch an app by package name without needing its exact launcher-activity class name — no new tooling, just `adb` itself, same "no new project dependency" spirit as iOS's use of `idb`.)

- [x] **Step 2: Verify the app launched without crashing**

Expected: `before.png` isn't blank/black, and shows null-notes' existing no-workspace screen (sidebar, "Choose a folder…"/"Clone workspace…" buttons) — the same screen `mobile-ios-scaffold.md` Task 3 confirmed for iOS. If it's blank, check `adb logcat -d | Select-String -Pattern "nullnotes|null_notes|FATAL"` for a crash before assuming it just needs more time.

Look at `before.png` directly to confirm — read it as an image, don't just check the file exists.

- [x] **Step 3: Verify basic touch interaction**

Find a real tap target's on-screen pixel coordinates from `before.png` (e.g. a sidebar button), then:

```powershell
& "$env:ANDROID_HOME\platform-tools\adb.exe" shell input tap <X> <Y>
Start-Sleep -Seconds 1
& "$env:ANDROID_HOME\platform-tools\adb.exe" exec-out screencap -p > after.png
```

Compare `before.png` and `after.png` — the goal is confirming touch input, rendering, and the WebView/IPC bridge all work (the screen visibly changed), not that any specific feature is functional (a git-backed action won't work yet — see Global Constraints).

- [x] **Step 4: Record the result and known follow-ups**

Note in the commit/PR description (or directly to the user) that this plan's three tasks are complete once Steps 1-3 above pass, plus the known gaps the next Android plan needs to close:
- `git_impl` still resolves to desktop's `git.rs` for Android (Global Constraints) — the next plan should extend `src-tauri/src/lib.rs:12`'s `cfg(not(target_os = "ios"))` to also exclude Android, and route it through `git_mobile.rs` instead, same as iOS.
- Whatever the no-workspace screen's layout looked like on the emulator (does it overflow like iOS's did, is the desktop window-chrome menu bar visible) — feeds the future Android UI reflow plan the same way iOS's Task 3 result fed `mobile-app-shell-reflow.md`.
- Whether Step 3 of Task 2 needed any dependency gating at all, and if so, what — feeds whatever pdfium-for-Android spike comes later.

---

## Out of scope (this plan)

- `git_mobile.rs` wiring for Android (currently iOS-only in `lib.rs`'s target selection), `Platform.isMobile` feature-cut gating, and app-shell UI reflow for Android — separate, later plans, mirroring iOS's own decomposition.
- pdfium-for-Android (rendering/text-extraction support) — a later spike, exactly as it was for iOS, if Task 2 doesn't already resolve it by finding pdfium simply works ungated.
- Physical-device builds/signing (a real Android keystore, Play Store or sideload distribution) — emulator only for this plan.
- Any iOS work — paused on exhausted Actions budget, untouched by this plan.

> Ticked by the Android parity pass (P16-9): the project was generated (`e4f4327`), `tauri android build --debug` succeeds for x86_64 and aarch64, and the APK installs, launches and takes touch on the AVD; see `android-parity-shell-verification.md` and `android-parity-pdfium.md`.


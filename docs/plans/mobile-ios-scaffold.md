# iOS Mobile Scaffold Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Get the existing null-notes Tauri app building and launching in the iOS Simulator, showing its existing (no-workspace) UI — the foundation every later mobile task (the `git_mobile.rs` gix rewrite, code-block toolbar gating, the pdfium spike, app-shell UI reflow) builds on.

**Architecture:** Add Tauri 2's iOS target to the *existing* Tauri project via `tauri ios init`, which generates an Xcode project under `src-tauri/gen/apple/`. The Rust mobile entry point already exists (`#[cfg_attr(mobile, tauri::mobile_entry_point)]` in `src-tauri/src/lib.rs:14`) — no Rust entry-point changes are needed. The actual work is making the existing Rust dependency graph cross-compile cleanly for an iOS target (excluding what can't/shouldn't build there) and then verifying the generated Xcode project actually launches.

**Tech Stack:** Tauri 2 mobile (iOS), Rust cross-compilation to `aarch64-apple-ios-sim`, Xcode.

**Spec:** docs/specs/mobile-app-design.md

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

- **Requires a macOS host with Xcode installed.** Every command in this plan that isn't plain `cargo check`/`git` must run on a Mac — Apple's toolchain has no cross-platform alternative, and this plan cannot be executed or verified from a Windows machine. (Spec's Platform decision: iOS first, chosen with this requirement already disclosed and accepted.)
- Android is out of scope for this plan (spec, "Out of scope (v1)").
- No behavior change to desktop: `git.rs`, `code_run.rs`, `editor_launch.rs`, and `terminal.rs` keep their current desktop behavior untouched. This plan only adds a build target and, where a dependency can't cross-compile to iOS, target-gates it — it does not implement any mobile-specific feature yet (no `git_mobile.rs`, no toolbar gating — those are later plans).
- The iOS build must succeed with `pdf-native` (pdfium) disabled. Making pdfium actually work on iOS is a separate, later spike (spec, "Engineering risk") — this plan only needs the *rest* of the app to build and launch with that one feature off for the iOS target.

---

### Task 1: Gate iOS-incompatible dependencies so the Rust core cross-compiles

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/pdf/renderer.rs:10,14,30,72`
- Modify: `src-tauri/src/pdf/extract.rs:201,205,249,390,424`
- Modify (conditionally, only if the portable-pty step below actually fails — see Step 3): `src-tauri/src/commands/mod.rs:15`, `src-tauri/src/lib.rs:68,149-152`

**Interfaces:**
- Consumes: nothing from other tasks (this is the first task).
- Produces: a working `cargo check --target aarch64-apple-ios-sim` from `src-tauri/` — Task 2 assumes this passes before generating the Xcode project.

- [ ] **Step 1: Install the iOS Rust targets and attempt a cross-compile check**

```bash
rustup target add aarch64-apple-ios-sim aarch64-apple-ios
cd src-tauri
cargo check --target aarch64-apple-ios-sim
```

- [ ] **Step 2: Confirm the expected failure (pdfium)**

Expected: FAIL. `pdfium-render` (or its build script) errors trying to link/find a pdfium binary for the iOS target — none exists yet (that binary is the subject of the separate pdfium spike). This is the expected, known failure; anything else at this step is a *different* problem and should be diagnosed on its own before continuing.

- [ ] **Step 3: Gate `pdfium-render` out of the iOS dependency graph**

In `src-tauri/Cargo.toml`, move the dependency out of the general `[dependencies]` table into a target-specific one (the same mechanism this file already uses for `webview2-com`/`windows` under `[target.'cfg(windows)'.dependencies]`):

```toml
# remove this line from [dependencies]:
# pdfium-render = { version = "0.9", optional = true }

# add a new table:
[target.'cfg(not(target_os = "ios"))'.dependencies]
pdfium-render = { version = "0.9", optional = true }
```

`pdf-native` stays a default feature (desktop behavior is unaffected) — but the crate itself is now simply absent from the iOS dependency graph, so feature-gated code that references `pdfium_render` types must not be compiled for iOS either, or it'll fail to resolve the crate. Update both existing `#[cfg(feature = "pdf-native")]` / `#[cfg(not(feature = "pdf-native"))]` pairs to also account for the target:

In `src-tauri/src/pdf/renderer.rs`, lines 10 and 14:
```rust
    #[cfg(all(feature = "pdf-native", not(target_os = "ios")))]
    {
        render_pages_native(pdf_path, out_dir, progress).await
    }
    #[cfg(any(not(feature = "pdf-native"), target_os = "ios"))]
    {
        let _ = (out_dir, progress);
        anyhow::bail!(
            "PDF rendering requires the pdf-native feature: {:?}",
            pdf_path
        )
    }
```
And lines 30 and 72 (both currently bare `#[cfg(feature = "pdf-native")]` on a function item) become `#[cfg(all(feature = "pdf-native", not(target_os = "ios")))]`.

In `src-tauri/src/pdf/extract.rs`, the same substitution at lines 201/205 (the `extract_pages` branch pair, identical shape to `renderer.rs`'s) and at lines 249, 390, 424 (bare `#[cfg(feature = "pdf-native")]` on function items, each becomes `#[cfg(all(feature = "pdf-native", not(target_os = "ios")))]`).

Re-run:
```bash
cargo check --target aarch64-apple-ios-sim
```
Expected: pdfium-related errors are gone. If a *different* error appears, continue to Step 4 rather than treating this as done.

- [ ] **Step 4: Handle `portable-pty` if it fails to cross-compile**

`portable-pty` (used only by `src-tauri/src/commands/terminal.rs`, the P8 terminal) is not feature-gated today and its iOS support is unverified. If `cargo check` from Step 3 already succeeds, skip this step entirely — do not gate it pre-emptively. If it fails specifically on `portable-pty`, apply the same target-table technique:

```toml
# in [dependencies], change:
# portable-pty = "0.9.0"
# to a target-specific table:
[target.'cfg(not(target_os = "ios"))'.dependencies]
portable-pty = "0.9.0"
```

Then gate every consumer of `commands::terminal` behind the same condition so the crate's absence doesn't break the build:
- `src-tauri/src/commands/mod.rs:15` — `pub mod terminal;` becomes `#[cfg(not(target_os = "ios"))] pub mod terminal;`
- `src-tauri/src/lib.rs:68` — wrap `app.manage(commands::terminal::PtyState::default());` in `#[cfg(not(target_os = "ios"))]`
- `src-tauri/src/lib.rs:149-152` — the four `commands::terminal::*` entries in the `tauri::generate_handler!` list need to drop out for iOS. `generate_handler!` doesn't accept a `cfg` on individual list entries, so pull the whole invocation into a helper hidden behind `cfg`, or (simpler, smaller diff) leave the four entries in the macro unconditionally and instead make each terminal command function itself a no-op stub for iOS inside `terminal.rs` (`#[cfg(target_os = "ios")]` versions of `terminal_open`/`terminal_write`/`terminal_resize`/`terminal_close` that return an error immediately) rather than trying to conditionally shrink the generated-handler list. Pick whichever compiles — confirm with `cargo check --target aarch64-apple-ios-sim` either way.

Re-run the check until it passes.

- [ ] **Step 5: Full verification and commit**

```bash
cargo check --target aarch64-apple-ios-sim
cargo clippy --target aarch64-apple-ios-sim -- -D warnings
cargo build   # desktop build, unaffected — confirm nothing broke
cargo clippy -- -D warnings
cargo fmt --check
```

Expected: all pass.

```bash
git add src-tauri/Cargo.toml src-tauri/src/pdf/renderer.rs src-tauri/src/pdf/extract.rs
# plus src-tauri/src/commands/mod.rs, src-tauri/src/lib.rs, src-tauri/src/commands/terminal.rs if Step 4 was needed
git commit -m "build: cross-compile the Rust core for iOS (pdf-native off, portable-pty gated if needed)"
```

---

### Task 2: Generate the iOS Xcode project

**Files:**
- Modify: `src-tauri/icons/` (new iOS icon sizes, generated)
- Create: `src-tauri/gen/apple/` (Xcode project, Info.plist, entitlements — generated by the CLI, tracked in git per this repo's existing convention of committing `gen/` except `gen/schemas`, per `src-tauri/.gitignore`)

**Interfaces:**
- Consumes: a passing `cargo check --target aarch64-apple-ios-sim` from Task 1.
- Produces: an Xcode project Task 3 opens/builds.

- [ ] **Step 1: Regenerate icons including iOS sizes**

`src-tauri/icons/` currently only has desktop sizes (32x32, 128x128, 128x128@2x, .icns, .ico) — no iOS iconset.

```bash
npx tauri icon src-tauri/icons/icon.png
```

Expected: PASS, and a new iOS-sized icon set appears under `src-tauri/icons/` (exact subfolder name comes from the CLI's own output — confirm by checking `git status` after running it).

- [ ] **Step 2: Generate the Xcode project**

```bash
npx tauri ios init
```

Expected: PASS, creates `src-tauri/gen/apple/` containing an `.xcodeproj`, `Info.plist`, an entitlements file, and the build-phase script that invokes `cargo build` for the selected target during an Xcode build.

- [ ] **Step 3: Confirm the generated bundle identifier**

Open `src-tauri/gen/apple/*.xcodeproj/project.pbxproj` (or the generated `Info.plist`) and confirm the bundle identifier is `dev.nullnotes.app`, matching `src-tauri/tauri.conf.json`'s `identifier` field. `tauri ios init` derives this automatically — this step is a check, not an edit.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/gen/apple src-tauri/icons
git commit -m "build: generate the iOS Xcode project via tauri ios init"
```

---

### Task 3: Launch the app in the iOS Simulator

**Files:** none (verification-only task).

**Interfaces:**
- Consumes: the Xcode project from Task 2.
- Produces: a confirmed working iOS build target — the DoD every later mobile plan (git_mobile, toolbar gating, pdfium spike, UI reflow) can assume holds.

- [ ] **Step 1: Run the mobile dev server**

```bash
npm run tauri ios dev
```

(Add a simulator name if the default doesn't suit, e.g. `npm run tauri ios dev -- 'iPhone 15'`.)

- [ ] **Step 2: Verify the app launches without crashing**

Expected: the iOS Simulator opens, Xcode finishes building the Rust static library plus the Swift shell, and null-notes' existing no-workspace screen (the same one a fresh desktop install with no `initial_workspace` shows) renders — no crash, no blank white screen, no immediate exit.

- [ ] **Step 3: Verify basic interaction**

Tap through whatever the no-workspace screen offers (e.g. attempting to start the existing "Clone workspace…" flow far enough to see it prompt for input, without needing it to actually succeed — the git clone itself is git.rs's desktop CLI-based implementation, which won't work on iOS regardless, and is exactly what the next plan replaces). The goal here is confirming touch input, rendering, and the WebView bridge all work, not that any specific feature is functional yet.

- [ ] **Step 4: Record the result**

No code changes to commit for this task. If Steps 1–3 pass, this plan is complete — note the outcome (which simulator/OS version was used) in the PR/commit description for the next plan (`git_mobile.rs`) to reference. If something in Steps 1–3 fails, that failure is the next thing to fix before any later mobile plan can be executed or verified.

---

## Out of scope (this plan)

- The `git_mobile.rs` gix rewrite, code-block toolbar mobile gating (Run/Open-in-IDE/terminal hidden in the *UI*, not just the Rust build), the pdfium iOS spike, and app-shell UI reflow are separate, later plans per the spec's decomposition — nothing here implements them.
- Physical-device builds/signing (Apple Developer account, provisioning profiles) — Simulator only for this plan. Device builds are whatever is needed once there's an actual feature to test on hardware (e.g. touch/stylus ink).
- Android targets.

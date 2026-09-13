# iOS Mobile Scaffold Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Get the existing null-notes Tauri app building and launching in the iOS Simulator, showing its existing (no-workspace) UI — the foundation every later mobile task (the `git_mobile.rs` gix rewrite, code-block toolbar gating, the pdfium spike, app-shell UI reflow) builds on.

**Architecture:** Add Tauri 2's iOS target to the *existing* Tauri project via `tauri ios init`, which generates an Xcode project under `src-tauri/gen/apple/`. The Rust mobile entry point already exists (`#[cfg_attr(mobile, tauri::mobile_entry_point)]` in `src-tauri/src/lib.rs:14`) — no Rust entry-point changes are needed. The actual work is making the existing Rust dependency graph cross-compile cleanly for an iOS target (excluding what can't/shouldn't build there) and then verifying the generated Xcode project actually launches.

**Tech Stack:** Tauri 2 mobile (iOS), Rust cross-compilation to `aarch64-apple-ios-sim`, Xcode — run via a GitHub Actions `macos-latest` runner, not a physical Mac (see Global Constraints).

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

- **Requires a macOS host with Xcode installed — supplied here by a GitHub Actions `macos-latest` runner, not a physical Mac.** The user has no Mac and will not acquire one (Windows desktop + iPhone only; GitHub Student Pro is the only paid-tool access available, no card/cloud-Mac budget). Every command in this plan that needs Xcode runs as a step in `.github/workflows/ios-scaffold.yml` (created in Task 1, Step 0), triggered from the executing agent's Windows machine via `gh workflow run` / `gh run watch` — never typed by hand on a Mac. Apple's toolchain still has no cross-platform alternative; this only moves "the Mac" into CI instead of removing the requirement.
- **Execution loop for every task below:** edit files → `git add`/`git commit`/`git push` → `gh workflow run ios-scaffold.yml` → `gh run watch --exit-status` → on failure, `gh run view --log-failed` to read the failing step → fix → repeat. Anything the workflow generates that git needs to track (Xcode project, icons, screenshots) comes back via `gh run download <run-id> -n <artifact-name>`, then gets `git add`-ed normally from Windows — copying already-generated files into git needs no Mac, only generating them does.
- **Task 3's manual Simulator tap-through is replaced.** No human will ever sit at this Mac to tap the screen, so Task 3 uses `idb` (Meta's open-source iOS Simulator automation CLI, installed in the same CI job — no new project dependency) to send a synthetic tap, and `xcrun simctl io booted screenshot` to capture before/after images as artifacts. That's visual proof the WebView renders and responds to touch, reviewed by eye from the downloaded PNGs instead of confirmed by a person physically present.
- Android is out of scope for this plan (spec, "Out of scope (v1)").
- No behavior change to desktop: `git.rs`, `code_run.rs`, `editor_launch.rs`, and `terminal.rs` keep their current desktop behavior untouched. This plan only adds a build target and, where a dependency can't cross-compile to iOS, target-gates it — it does not implement any mobile-specific feature yet (no `git_mobile.rs`, no toolbar gating — those are later plans).
- The iOS build must succeed with `pdf-native` (pdfium) disabled. Making pdfium actually work on iOS is a separate, later spike (spec, "Engineering risk") — this plan only needs the *rest* of the app to build and launch with that one feature off for the iOS target.

---

### Task 1: Gate iOS-incompatible dependencies so the Rust core cross-compiles

**Files:**
- Create: `.github/workflows/ios-scaffold.yml` — the CI workflow standing in for the Mac this plan otherwise requires (see Global Constraints).
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/pdf/renderer.rs:10,14,30,72`
- Modify: `src-tauri/src/pdf/extract.rs:201,205,249,390,424`
- Modify (conditionally, only if the portable-pty step below actually fails — see Step 3): `src-tauri/src/commands/mod.rs:15`, `src-tauri/src/lib.rs:68,149-152`

**Interfaces:**
- Consumes: nothing from other tasks (this is the first task).
- Produces: a passing `ios-scaffold.yml` run (its `cargo check --target aarch64-apple-ios-sim` step green) — Task 2 assumes this before generating the Xcode project, and appends its own steps to the same workflow file rather than creating a second one.

- [x] **Step 0: Create the CI workflow**

```yaml
# .github/workflows/ios-scaffold.yml
name: iOS scaffold
on: workflow_dispatch
jobs:
  ios:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: aarch64-apple-ios-sim,aarch64-apple-ios
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - name: cargo check (iOS)
        working-directory: src-tauri
        run: cargo check --target aarch64-apple-ios-sim
      - name: cargo clippy (iOS)
        working-directory: src-tauri
        run: cargo clippy --target aarch64-apple-ios-sim -- -D warnings
      - name: cargo build (desktop, unaffected)
        working-directory: src-tauri
        run: cargo build
      - name: cargo clippy (desktop)
        working-directory: src-tauri
        run: cargo clippy -- -D warnings
      - name: cargo fmt --check
        working-directory: src-tauri
        run: cargo fmt --check
```

Commit and push this file by itself first:

```bash
git add .github/workflows/ios-scaffold.yml
git commit -m "ci: add iOS scaffold workflow (stands in for a Mac host)"
git push
```

- [x] **Step 1: Trigger the workflow and attempt a cross-compile check**

```bash
gh workflow run ios-scaffold.yml
gh run watch --exit-status
```

- [x] **Step 2: Confirm the expected failure (pdfium)**

Expected: FAIL on the "cargo check (iOS)" step. Read it with `gh run view --log-failed` if the summary isn't enough. `pdfium-render` (or its build script) errors trying to link/find a pdfium binary for the iOS target — none exists yet (that binary is the subject of the separate pdfium spike). This is the expected, known failure; anything else at this step is a *different* problem and should be diagnosed on its own before continuing.

**Actual result (deviates from the plan):** the first run failed, but not on pdfium — `tauri-build`'s build script validates every `bundle.resources` path in `tauri.conf.json` unconditionally at compile time, and the base config listed two Windows-only artifacts (`identity-package/*.msix`, the context-menu-handler DLL) that don't exist on a macOS runner with no prior Windows build step. Fixed by moving both entries into a new `src-tauri/tauri.windows.conf.json` (Tauri's platform-specific config, RFC 7396 JSON Merge Patch on top of the base file) and removing them from the base — verified `cargo check`/`clippy`/`fmt` still pass on Windows afterward. Commit `5f474f7`.

The second run then failed on `cargo clippy (iOS)`, not pdfium either: pre-existing `#[cfg(not(windows))]` branches in `git.rs` (unused `mut`) and `printing.rs` (unused params, one dead-code fn) had never been clippy-checked before, since `ci.yml` only runs on `windows-latest` — cross-compiling to iOS was the first time those branches were compiled at all. Fixed in place (restructured `no_window_command` to build the `Command` per-branch instead of carrying a conditionally-mutated `mut` across the `cfg` split; discarded unused params via `let _ = (...)`; `#[cfg_attr(not(windows), allow(dead_code))]` on `mark_default`, which is deliberately kept callable cross-platform for its unit test). No Windows behavior change. Commit `0c27b35`.

`pdfium-render` and `portable-pty` themselves never actually broke the build — `pdfium-render` binds to the native library at runtime (`Pdfium::bind_to_library`), not link time, so its absence on iOS doesn't surface until something calls `bind_pdfium()`; `portable-pty` cross-compiled to iOS without issue. Steps 3 and 4 below turned out to be unnecessary and were skipped — left unchecked and in place in case a *later* run needs them (e.g. if a future dependency bump makes either crate fail to cross-compile).

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

Commit, push, and re-run:
```bash
git add src-tauri/Cargo.toml src-tauri/src/pdf/renderer.rs src-tauri/src/pdf/extract.rs
git commit -m "build: gate pdfium-render out of the iOS dependency graph"
git push
gh workflow run ios-scaffold.yml
gh run watch --exit-status
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

Commit, push, and re-run via `gh workflow run ios-scaffold.yml` / `gh run watch --exit-status` until it passes:

```bash
git add src-tauri/src/commands/mod.rs src-tauri/src/lib.rs src-tauri/src/commands/terminal.rs src-tauri/Cargo.toml
git commit -m "build: gate portable-pty out of the iOS dependency graph"
git push
gh workflow run ios-scaffold.yml
gh run watch --exit-status
```

- [x] **Step 5: Full verification**

The workflow's five `cargo` steps (check, clippy ×2, build, fmt --check) from Step 0 already cover exactly what a local "full verification" pass would — there's no separate local pass to run, since there's no local Mac to run it on. Task 1 is done once a single `gh run watch --exit-status` exits `0` end to end, with every commit from Steps 0/3/4 already pushed.

---

### Task 2: Generate the iOS Xcode project

**Files:**
- Modify: `.github/workflows/ios-scaffold.yml` (append icon + init + artifact-upload steps)
- Modify: `src-tauri/icons/` (new iOS icon sizes, generated in CI, then downloaded and committed locally)
- Create: `src-tauri/gen/apple/` (Xcode project, Info.plist, entitlements — generated in CI, tracked in git per this repo's existing convention of committing `gen/` except `gen/schemas`, per `src-tauri/.gitignore`)

**Interfaces:**
- Consumes: a passing `ios-scaffold.yml` run from Task 1.
- Produces: an Xcode project, downloaded into the repo, that Task 3's workflow steps build.

- [x] **Step 1: Append icon + init steps to the workflow**

Add to `.github/workflows/ios-scaffold.yml`'s `steps:` list, after the Task 1 steps (`src-tauri/icons/` currently only has desktop sizes — 32x32, 128x128, 128x128@2x, .icns, .ico — no iOS iconset):

```yaml
      - name: Regenerate icons (adds iOS sizes)
        run: npx tauri icon src-tauri/icons/icon.png
      - name: Generate iOS Xcode project
        run: npx tauri ios init
      - name: Upload generated project + icons
        uses: actions/upload-artifact@v4
        with:
          name: ios-gen
          path: |
            src-tauri/gen/apple
            src-tauri/icons
```

Commit, push, trigger, and watch:
```bash
git add .github/workflows/ios-scaffold.yml
git commit -m "ci: generate the iOS Xcode project and icons"
git push
gh workflow run ios-scaffold.yml
gh run watch --exit-status
```
Expected: PASS. `tauri ios init` creates `src-tauri/gen/apple/` containing an `.xcodeproj`, `Info.plist`, an entitlements file, and the build-phase script that invokes `cargo build` for the selected target during an Xcode build.

- [x] **Step 2: Download the generated files and commit them locally**

```bash
gh run download -n ios-gen -D .
git add src-tauri/gen/apple src-tauri/icons
git commit -m "build: generate the iOS Xcode project via tauri ios init"
git push
```

Note: `gh run download -D .` extracts each `upload-artifact` path with the artifact's shared root (`src-tauri/`) stripped, landing `gen/` and `icons/` at the repo root instead of under `src-tauri/`. Moved by hand (`cp -r` into `src-tauri/gen` and `src-tauri/icons`, then removed the top-level copies) before staging — `mv` hit a Windows permission error on the Xcode project's nested directories, `cp -r` + `rm -rf` worked around it.

- [x] **Step 3: Confirm the generated bundle identifier**

Open the now-local `src-tauri/gen/apple/*.xcodeproj/project.pbxproj` (or the generated `Info.plist`) and confirm the bundle identifier is `dev.nullnotes.app`, matching `src-tauri/tauri.conf.json`'s `identifier` field — a plain text check, no Mac needed. `tauri ios init` derives this automatically; this step is a check, not an edit.

---

### Task 3: Launch the app in the iOS Simulator (CI, no human present)

`npm run tauri ios dev` is an interactive command meant for a person watching a locally-opened Simulator window — nothing this project has. This task replaces it with a non-interactive CI build + `simctl`/`idb` smoke test, since no human will ever be available to do this by hand, here or in any later mobile plan.

**Files:**
- Modify: `.github/workflows/ios-scaffold.yml` (append build + simulator + `idb` tap steps)

**Interfaces:**
- Consumes: the Xcode project committed in Task 2.
- Produces: downloadable before/after screenshots + a boot/launch log — the DoD every later mobile plan (git_mobile, toolbar gating, pdfium spike, UI reflow) can point back to, reviewed by eye instead of confirmed by a person physically present.

- [x] **Step 1: Append a non-interactive Simulator build + smoke test to the workflow**

**Deviations from this step as written:**
- `tauri ios build`'s `--target`/`-t` flag takes the CLI's short target names (`aarch64`, `aarch64-sim`, `x86_64`), not a Rust target triple — `--target aarch64-apple-ios-sim` (as first drafted here) is not one of the accepted values. Used `--target aarch64-sim` instead (confirmed against the `tauri ios build --help` reference).
- Removed the Task 2 "Regenerate icons" / "Generate iOS Xcode project" / "Upload generated project + icons" steps from the workflow rather than leaving them in place ahead of these new ones. Task 2's project and icons are now committed to the repo, so every future run would otherwise re-run `tauri ios init` against an already-initialized `gen/apple` — undocumented behavior Tauri's own docs only describe via `rm -r src-tauri/gen` first when *intentionally* recreating a project, not as a safe no-op to run unconditionally. `tauri ios build` is designed to operate against an already-generated project, so the checked-out committed one is used directly.
- Added `if: always()` to the "Upload screenshots" step. The `idb ui tap <X> <Y>` placeholder is expected to fail the first time this runs (Step 3 below explains why), and without `always()` that failure would skip the upload step entirely, losing `before.png` along with it.
- The `find` for `APP_PATH` originally searched `src-tauri/gen/apple` for a `*Debug-iphonesimulator*` match. The actual first run showed `xcodebuild -configuration debug` puts the built `.app` under `~/Library/Developer/Xcode/DerivedData/null-notes-<hash>/Build/Products/debug-iphonesimulator/` (lowercase `debug`, and outside the repo entirely, in Xcode's own DerivedData cache) — the original path matched nothing, so `APP_PATH` was empty and `simctl install` crashed with `NSInternalInconsistencyException: installURL`. A second attempt broadened the search to all of DerivedData for `*debug-iphonesimulator*`, which found a `.app` — but DerivedData also contains an `ArchiveIntermediates/.../BuildProductsPath/debug-iphonesimulator/null-notes.app` copy alongside the real `Build/Products` one, and `find`'s traversal order picked that one first; installing it failed with "Failed to extract IPA" (domain=IXErrorDomain, code=42), since it's an incomplete intermediate, not the actual build product. Fixed by matching the `Build/Products/debug-iphonesimulator` path segment specifically, excluding the archive-intermediates copy.

```yaml
      - name: Build for iOS Simulator
        run: npx tauri ios build --target aarch64-sim --debug
      - name: Boot Simulator and install
        run: |
          UDID=$(xcrun simctl create nullnotes-ci "iPhone 15")
          xcrun simctl boot "$UDID"
          APP_PATH=$(find ~/Library/Developer/Xcode/DerivedData -path "*/Build/Products/debug-iphonesimulator/*.app" | head -n1)
          xcrun simctl install "$UDID" "$APP_PATH"
          xcrun simctl launch "$UDID" dev.nullnotes.app
          sleep 3
          xcrun simctl io "$UDID" screenshot before.png
          echo "UDID=$UDID" >> "$GITHUB_ENV"
      - name: Install idb and send a synthetic tap
        run: |
          brew tap facebook/fb
          brew install facebook/fb/idb-companion
          pip3 install fb-idb
          idb connect "$UDID"
          # Coordinates depend on what `before.png` actually shows — read them
          # off the downloaded screenshot the first time this runs, there is
          # no way to know them ahead of time without seeing the rendered UI.
          idb ui tap <X> <Y> --udid "$UDID"
          sleep 1
          xcrun simctl io "$UDID" screenshot after.png
      - name: Upload screenshots
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: ios-smoke-test
          path: |
            before.png
            after.png
```

Commit, push, trigger, and watch:
```bash
git add .github/workflows/ios-scaffold.yml
git commit -m "ci: smoke-test the iOS build in the Simulator"
git push
gh workflow run ios-scaffold.yml
gh run watch --exit-status
```

- [ ] **Step 2: Verify the app launched without crashing**

Expected: the "Boot Simulator and install" step completes without `simctl launch` erroring, and `before.png` isn't blank/black — Xcode finished building the Rust static library plus the Swift shell, and null-notes' existing no-workspace screen (the same one a fresh desktop install with no `initial_workspace` shows) rendered.

Download and look at it:
```bash
gh run download -n ios-smoke-test -D .
```

- [ ] **Step 3: Verify basic interaction from the screenshots**

Open `before.png`, find a real tap target on the no-workspace screen (e.g. the "Clone workspace…" button), and fix the `<X> <Y>` placeholder in Step 1 to that pixel location — then re-run. Compare `before.png` and `after.png`: the goal is confirming touch input, rendering, and the WebView bridge all work (the screen visibly changed after the tap), not that any specific feature is functional yet — the git clone itself is git.rs's desktop CLI-based implementation, which won't work on iOS regardless, and is exactly what the next plan replaces.

- [ ] **Step 4: Record the result**

No further code changes for this task once Steps 1–3 pass. Note the outcome (workflow run URL, which simulator/OS version `macos-latest` resolved to) in the PR/commit description for the next plan (`git_mobile.rs`) to reference. If something in Steps 1–3 fails, that failure is the next thing to fix before any later mobile plan can be executed or verified.

---

## Out of scope (this plan)

- The `git_mobile.rs` gix rewrite, code-block toolbar mobile gating (Run/Open-in-IDE/terminal hidden in the *UI*, not just the Rust build), the pdfium iOS spike, and app-shell UI reflow are separate, later plans per the spec's decomposition — nothing here implements them.
- Physical-device builds/signing (Apple Developer account, provisioning profiles) — Simulator only for this plan. Device builds are whatever is needed once there's an actual feature to test on hardware (e.g. touch/stylus ink).
- Android targets.

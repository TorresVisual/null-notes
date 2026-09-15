# PDFium iOS Spike Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Answer, with real evidence from a running iOS Simulator (not a guess), whether `pdfium-render` can load and read a real PDF on iOS at all — vendor a prebuilt iOS pdfium binary, get it inside the Tauri iOS app bundle where `bind_pdfium()` can find it, and prove a real fixture PDF's text layer extracts successfully on-device via CI. Record a Go/No-Go decision in the spec before any PDF-import mobile work is planned in detail.

**Architecture:** `pdfium-render` (`src-tauri/src/pdf/renderer.rs:31`, `bind_pdfium()`) binds to an external `libpdfium` dynamic library at *runtime*, not compile time — it already compiles clean for `aarch64-apple-ios-sim` today (confirmed: `ios-scaffold.yml`'s existing `cargo check --target aarch64-apple-ios-sim` step passes with `pdf-native`, the default feature, still on). What's missing is a real `libpdfium.dylib` for iOS to bind to at runtime, and confirmation that iOS actually permits `dlopen`-style loading of a bundled (not statically linked) dylib from inside a sandboxed, code-signed app — the specific unknown the spec's Engineering risk section flags and that no desktop testing can answer.

[bblanchon/pdfium-binaries](https://github.com/bblanchon/pdfium-binaries) — already the exact project `bind_pdfium()`'s own error message points users to (`renderer.rs:61-63`) — ships iOS `.tgz` releases (`pdfium-ios-simulator-arm64.tgz`, `pdfium-ios-device-arm64.tgz`, `pdfium-ios-simulator-x64.tgz`) containing a `libpdfium.dylib` per architecture, which already matches the filename `pdfium-render`'s `Pdfium::pdfium_platform_library_name()` computes on Apple platforms (`libloading::library_filename("pdfium")` → `libpdfium.dylib` on both macOS and iOS — confirmed by reading `pdfium-render-0.9.2/src/pdfium.rs:162-170` directly, not assumed). No crate-level change or renaming is needed — only getting a real file with that name into a place `bind_pdfium()`'s existing lookup order (`./`, then next to the executable, then the OS's system-library search) can reach.

The dylib is **fetched in CI, not committed to git** — binary blobs don't belong in this repo (the existing convention: `Cargo.lock` tracks the Rust dependency graph, nothing vendors a binary crate output) — and bundled via a new `src-tauri/tauri.ios.conf.json` platform-override file, the exact mechanism `tauri.windows.conf.json` already establishes for Windows-only bundle resources (`bundle.resources`, source-path → target-path map). Whether the iOS bundle's resource root lands where `bind_pdfium()`'s exe-dir lookup already checks, or needs a small iOS-specific fallback added to `bind_pdfium()`, is confirmed empirically in Task 1 rather than assumed either way.

Verification runs through the same idb-driven Simulator automation `mobile-ios-scaffold.md` and `mobile-credentials-onboarding.md` already built into `ios-scaffold.yml` — because `dlopen`/code-signing behavior is iOS-sandbox-specific, a native `cargo test` on the macOS CI runner (as `git-mobile-gix.md`'s `git_mobile` tests do) cannot exercise the actual unknown; only a running Simulator process can.

**Tech Stack:** `pdfium-render` 0.9.2 (already a dependency, `pdf-native` feature, already on by default), a fetched `bblanchon/pdfium-binaries` iOS-simulator-arm64 release, Tauri 2's `tauri.ios.conf.json` platform-config override, `xcrun simctl` (app-container file access — already available on the `macos-latest` runner, no new tool), the existing `ios-scaffold.yml` GitHub Actions workflow.

**Spec:** `docs/specs/mobile-app-design.md` (Engineering risk section: "PDF pipeline on iOS... called out as a spike, gated before the rest of the PDF-import work is planned"); this plan is that spike, the second and last of the spec's two named "Engineering risk" unknowns (the first, `git_mobile.rs`, is done — `docs/plans/git-mobile-gix.md`, `docs/plans/git-mobile-push.md`).

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

- **Requires the same macOS-host-via-CI setup `docs/plans/mobile-ios-scaffold.md` already built.** Every command below that needs Xcode/Simulator runs as a step appended to the existing `.github/workflows/ios-scaffold.yml`, triggered via `gh workflow run` / `gh run watch --exit-status` from Windows — never typed by hand on a Mac.
- **No behavior change to desktop.** `pdf-native`'s existing Windows path (`bind_to_library("./")` → exe-dir → `bind_to_system_library`) is untouched; any code added to `bind_pdfium()` for an iOS-specific fallback is gated `#[cfg(target_os = "ios")]`, mirroring the pattern `Cargo.toml`'s `[target.'cfg(target_os = "ios")'.dependencies]` already uses for `keyring`. Desktop's `cargo test`/`cargo clippy` in `ci.yml` must stay green.
- **No binary blobs committed to git.** The fetched pdfium dylib and any derived `.dylib`/`.tgz` artifacts live only inside the CI run's workspace and the built `.ipa`/Simulator app — never `git add`-ed.
- **This is a spike, not a feature.** Its DoD is a recorded Go/No-Go answer with real evidence, not shippable PDF-import UI — per the spec's own framing ("If the spike shows it's genuinely not feasible... PDF import becomes a documented v1 gap").

---

### Task 1: Vendor the iOS pdfium binary and confirm where iOS resources land

**Files:**
- Modify: `.github/workflows/ios-scaffold.yml` (new steps, inserted before the existing "Build for iOS Simulator" step)
- Create: `src-tauri/tauri.ios.conf.json`

**Interfaces:**
- Consumes: `Pdfium::pdfium_platform_library_name()` (`pdfium-render` 0.9.2, confirmed above to resolve to `libpdfium.dylib` on iOS)
- Produces: a `libpdfium.dylib` present inside the built `.app`'s bundle root, and a written answer (in this task's own "Result:" note) to whether that root is exe-dir-relative today or needs a fallback added in Task 2.

- [ ] **Step 1: Add a "Fetch iOS pdfium binary" step to `ios-scaffold.yml`**

Insert immediately before the existing `- name: Build for iOS Simulator` step:

```yaml
      - name: Fetch iOS pdfium binary
        run: |
          set -euo pipefail
          curl -L -o pdfium-ios-sim.tgz \
            "https://github.com/bblanchon/pdfium-binaries/releases/latest/download/pdfium-ios-simulator-arm64.tgz"
          mkdir -p src-tauri/gen/pdfium-ios
          tar -xzf pdfium-ios-sim.tgz -C src-tauri/gen/pdfium-ios
          find src-tauri/gen/pdfium-ios -iname "*pdfium*"
```

The last line is deliberate, not decoration — `bblanchon/pdfium-binaries`' release layout has changed structure across versions before (per its own release notes), so this step's log is how the next step's exact source path gets confirmed against what the download actually contains, rather than assumed from today's naming.

- [ ] **Step 2: Locate the extracted dylib and rename Step 1's placeholder path if needed**

Run the workflow once (`gh workflow run ios-scaffold.yml && gh run watch --exit-status`), then `gh run view --log` and read the `find` output from Step 1. Confirm the path to the actual `.dylib` (commonly `src-tauri/gen/pdfium-ios/lib/libpdfium.dylib` for this project's release layout, but verify against the real log rather than trusting that path). If it differs, fix the `tauri.ios.conf.json` source path in Step 3 to match before continuing — do not guess.

- [ ] **Step 3: Create `src-tauri/tauri.ios.conf.json`**

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "bundle": {
    "resources": {
      "gen/pdfium-ios/lib/libpdfium.dylib": ""
    }
  }
}
```

(Adjust the source key if Step 2 found a different path.) This mirrors `src-tauri/tauri.windows.conf.json`'s existing `bundle.resources` map exactly — a platform-override file Tauri merges automatically when building for that platform, no build-script or manual Xcode-project editing needed.

- [ ] **Step 4: Confirm the dylib lands in the installed `.app` and locate it relative to the executable**

Add a step to `ios-scaffold.yml`, after the existing `- name: Boot Simulator and install` step:

```yaml
      - name: Locate bundled pdfium relative to the executable
        run: |
          set -euo pipefail
          APP_PATH=$(xcrun simctl get_app_container "$UDID" dev.nullnotes.app app)
          echo "App bundle: $APP_PATH"
          ls -la "$APP_PATH" | grep -i pdfium || { echo "libpdfium.dylib NOT found in app bundle root"; exit 1; }
          echo "$APP_PATH/null-notes" # the executable's own path, for comparison
```

`$UDID` is the same simulator-instance variable the existing steps above this one already set (`xcrun simctl create nullnotes-ci "iPhone 15"`, `ios-scaffold.yml:37`) — reuse it, don't switch to the `booted` shorthand the rest of this file doesn't use.

- [ ] **Step 5: Run the workflow and record the result**

`gh workflow run ios-scaffold.yml && gh run watch --exit-status`, then `gh run view --log-failed` if it fails.

**Result:** Confirmed via CI run [34903359819](https://github.com/TorresVisual/null-notes/actions/runs/34903359819) — `libpdfium.dylib` lands at `null-notes.app/assets/libpdfium.dylib`, **not** the bundle root. The executable (`null-notes.app/null-notes`) is a sibling of the `assets/` directory, not of the dylib itself, so `bind_pdfium()`'s existing exe-dir-relative lookup (`renderer.rs:47-51`) does not find it. Tauri's iOS bundling places every `bundle.resources` entry with an empty target path under a fixed `assets/` subdirectory next to the executable — Task 2 adds an iOS-only fallback that checks `<exe_dir>/assets/` directly, no env var or `AppHandle` plumbing needed since the subdirectory name is fixed, not app-specific.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/ios-scaffold.yml src-tauri/tauri.ios.conf.json docs/plans/mobile-pdfium-ios-spike.md
git commit -m "ci(mobile): fetch and bundle a real iOS pdfium binary"
```

---

### Task 2: Prove `bind_pdfium()` succeeds and reads real text, on-device

**Files:**
- Modify: `src-tauri/src/pdf/renderer.rs` (only if Task 1's Result says the fallback is needed)
- Modify: `src-tauri/src/lib.rs` (a CI-only smoke-test hook, feature-gated)
- Create: `src-tauri/gen/pdfium-smoke-fixture.pdf` (copy of `src-tauri/tests/fixtures/sample.pdf`, itself a copy of `notes/tests/multi_column_test.pdf` — smallest real corpus fixture, 2.6K, already has a genuine text layer; `notes/` is gitignored, so the fixture is committed under `src-tauri/tests/fixtures/` — the path the existing `#[ignore]`d `renderer.rs` test already expected — so CI's checkout actually has it)
- Modify: `.github/workflows/ios-scaffold.yml` (bundle the fixture, pull the result file, assert)

**Interfaces:**
- Consumes: `crate::pdf::extract::extract_pages(pdf_path: &Path) -> anyhow::Result<Vec<ExtractedPage>>` (`src-tauri/src/pdf/extract.rs:200`, already calls `bind_pdfium()` internally — reused as-is, not reimplemented) and `crate::pdf::extract::pages_to_text(pages: &[ExtractedPage]) -> String` (`extract.rs:142`)
- Produces: a result file inside the app's sandboxed container that CI reads directly off the Simulator's filesystem.

- [ ] **Step 1: If Task 1 found the fallback is needed, add it to `bind_pdfium()`**

Only if Task 1's Result says the resource root isn't exe-dir-relative. In `src-tauri/src/pdf/renderer.rs`, add one more candidate to the existing `.or_else` chain, gated to iOS only (desktop's chain is untouched):

```rust
    let attempt = Pdfium::bind_to_library(Pdfium::pdfium_platform_library_name_at_path("./"))
        .or_else(|e| match e {
            PdfiumError::PdfiumLibraryBindingsAlreadyInitialized => Err(e),
            _ => {
                #[cfg(target_os = "ios")]
                {
                    if let Ok(dir) = std::env::var("NULLNOTES_IOS_RESOURCE_DIR") {
                        if let Ok(b) = Pdfium::bind_to_library(
                            Pdfium::pdfium_platform_library_name_at_path(&dir),
                        ) {
                            return Ok(b);
                        }
                    }
                }
                exe_dir_candidate
                    .map(|dir| {
                        Pdfium::bind_to_library(Pdfium::pdfium_platform_library_name_at_path(&dir))
                    })
                    .unwrap_or_else(Pdfium::bind_to_system_library)
                    .or_else(|_| Pdfium::bind_to_system_library())
            }
        });
```

`NULLNOTES_IOS_RESOURCE_DIR` is read from the environment rather than threaded through as a new parameter — `bind_pdfium()` and its callers (`extract_pages`, `render_pages_native`) are shared, cross-platform, zero-argument functions today; adding an `AppHandle` parameter to resolve Tauri's resource-dir API would cascade that signature change through every call site on every platform for one iOS-only fallback. This keeps the change to the one function that needs it.

- [ ] **Step 2: Add a CI-only smoke-test hook to `src-tauri/src/lib.rs`**

Find the existing `run()` / app-builder setup in `lib.rs` (where `tauri::Builder::default()` is constructed) and add, immediately after the builder is created:

```rust
    #[cfg(all(target_os = "ios", debug_assertions))]
    if std::env::var("NULLNOTES_PDFIUM_SMOKE_TEST").is_ok() {
        std::thread::spawn(|| {
            let result = crate::pdf::extract::extract_pages(std::path::Path::new(
                "pdfium-smoke-fixture.pdf",
            ))
            .map(|pages| {
                let text = crate::pdf::extract::pages_to_text(&pages);
                format!("PASS pages={} chars={}", pages.len(), text.len())
            })
            .unwrap_or_else(|e| format!("FAIL {e}"));

            let out = std::env::temp_dir().join("pdfium_smoke_result.txt");
            let _ = std::fs::write(&out, result);
        });
    }
```

This runs once, only in a debug iOS build, only when the CI-set env var is present — it does not exist in a release build or on any other platform, so it needs no separate cleanup task.

- [ ] **Step 3: Bundle the fixture PDF the same way as the dylib**

Add to `src-tauri/tauri.ios.conf.json`'s `resources` map (alongside the dylib entry from Task 1):

```json
      "gen/pdfium-smoke-fixture.pdf": ""
```

Copy the fixture into place before the build step in `ios-scaffold.yml`:

```yaml
      - name: Copy pdfium smoke-test fixture
        run: cp src-tauri/tests/fixtures/sample.pdf src-tauri/gen/pdfium-smoke-fixture.pdf
```

(Insert this before the "Build for iOS Simulator" step, after Task 1's fetch step.)

- [ ] **Step 4: Relaunch with the smoke-test flag and pull the result**

`std::env::var` in Step 2's hook reads the *launched process's* environment, not the build's — setting an env var on `npx tauri ios build` has no effect on it. `simctl` passes host-shell env vars into a launched Simulator process only when prefixed `SIMCTL_CHILD_`, so the app needs relaunching with that prefix rather than relying on the build step or the existing plain `xcrun simctl launch` at `ios-scaffold.yml:41` (which stays as it is, unmodified, for the screenshot steps that already depend on it). Add both steps after Task 1's "Locate bundled pdfium" step:

```yaml
      - name: Relaunch app with the pdfium smoke-test flag
        run: |
          set -euo pipefail
          xcrun simctl terminate "$UDID" dev.nullnotes.app || true
          SIMCTL_CHILD_NULLNOTES_PDFIUM_SMOKE_TEST=1 xcrun simctl launch "$UDID" dev.nullnotes.app
          sleep 3 # let the background thread (lib.rs Step 2) finish before reading its output
      - name: Read pdfium smoke-test result
        run: |
          set -euo pipefail
          RESULT_PATH=$(xcrun simctl spawn "$UDID" getconf DARWIN_USER_TEMP_DIR)pdfium_smoke_result.txt
          xcrun simctl spawn "$UDID" cat "$RESULT_PATH" | tee smoke-result.txt
          grep -q "^PASS" smoke-result.txt
```

- [ ] **Step 5: Run the workflow**

`gh workflow run ios-scaffold.yml && gh run watch --exit-status`. On failure, `gh run view --log-failed` to see which step failed and why — a `grep -q "^PASS"` failure with a `FAIL ...` line in `smoke-result.txt` is real evidence (the actual pdfium error), not a CI plumbing bug; read it before assuming the harness is wrong.

**Result:** **PASS** — `pages=1 chars=11`, confirmed via CI run [34907294797](https://github.com/TorresVisual/null-notes/actions/runs/34907294797) (iPhone 15 Simulator, iOS Simulator arm64, debug build). `bind_pdfium()`'s `assets/`-relative fallback located `libpdfium.dylib` and `extract_pages()` successfully opened and read a real text layer from `src-tauri/tests/fixtures/sample.pdf` entirely on-device. Getting here took three additional evidence-driven fixes beyond the plan's original text, all committed and CI-verified in sequence: (1) the fetch step had to run before `cargo check`, not after, since the build script validates `tauri.ios.conf.json`'s resource paths at compile time; (2) `notes/tests/multi_column_test.pdf` is gitignored and never reached CI's checkout, so the fixture was committed at `src-tauri/tests/fixtures/sample.pdf` — the path an existing `#[ignore]`d `renderer.rs` test already expected; (3) the smoke-test fixture path and the "read result" step both assumed things (CWD = bundle root; `DARWIN_USER_TEMP_DIR` via `simctl spawn getconf` = the sandboxed app's own temp dir) that turned out false on iOS Simulator — both were switched to exe-dir-relative and direct-data-container-search approaches respectively, each confirmed by a real CI run's error message before the fix, not guessed.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/pdf/renderer.rs src-tauri/tauri.ios.conf.json .github/workflows/ios-scaffold.yml docs/plans/mobile-pdfium-ios-spike.md
git commit -m "feat(mobile): add an iOS pdfium load-and-extract smoke test"
```

(Skip `renderer.rs` from `git add` if Task 1 found no fallback was needed.)

---

### Task 3: Record the Go/No-Go decision

**Files:**
- Modify: `docs/specs/mobile-app-design.md` (Engineering risk section)

**Interfaces:** None — this task only records Task 2's already-obtained result; it does not run new code.

- [ ] **Step 1: Update the spec's Engineering risk section with the real finding**

If Task 2's Result was `PASS`: replace the "PDF pipeline on iOS" bullet's final paragraph (the "spike, gated..." sentence) with a short dated note recording success — page count and character count extracted, the Simulator OS/arch used, and a pointer to this plan and its CI run URL. Leave the rest of the spec's PDF-import scope (in "Everything else is in scope for parity") as-is; nothing about it changes on a PASS.

If Task 2's Result was `FAIL`: add a dated note under the same bullet recording the exact failure (the `FAIL ...` line from `smoke-result.txt`) and the CI run URL, and add one sentence to the spec's "Out of scope (v1)" list: **"PDF import — the iOS pdfium spike (`docs/plans/mobile-pdfium-ios-spike.md`) found \<one-line reason\>; PDF import is a documented v1 gap on iOS until that's resolved."** Do not attempt a workaround in this task — per the spec's own framing, a FAIL result is itself the deliverable that triggers a separate, deliberate scoping decision, not something this spike plan solves inline.

- [ ] **Step 2: Commit**

```bash
git add docs/specs/mobile-app-design.md
git commit -m "docs(mobile): record the iOS pdfium spike's Go/No-Go result"
```

---

## Out of scope (this plan)

- **The physical iOS device path (`pdfium-ios-device-arm64.tgz`).** This plan only proves the Simulator case, which is what CI can actually run without a paid Apple Developer account for device provisioning. A device-specific pdfium binary swap is the same mechanism (Task 1, different `.tgz`) but isn't exercised here — real device behavior (different code-signing enforcement than the Simulator) is a known gap this plan does not close, called out explicitly rather than assumed to transfer.
- **Rendering a page to an image on iOS** (`render_pages_native`'s bitmap path, `renderer.rs:72`). The spike only proves text extraction (`extract_pages`) works — rendering exercises more of pdfium's surface (font loading, bitmap allocation) and is left for the actual PDF-import mobile plan once this spike's answer is Go — addressed in `docs/plans/mobile-pdfium-render-spike.md`, Go.
- **A production PDF-import UI/flow for mobile.** Explicitly a spike per the spec's own framing — its DoD is a recorded answer, not shippable functionality.
- **Android.** Same footnote as every prior mobile plan.

# PDFium iOS Rendering Spike Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Answer, with real evidence from a running iOS Simulator, whether `render_pages`' bitmap-rendering path — not just `extract_pages`' text-layer path, which `docs/plans/mobile-pdfium-ios-spike.md` already proved — works on-device. That prior spike's own "Out of scope" section named this exact gap: *"Rendering a page to an image on iOS... is left for the actual PDF-import mobile plan once this spike's answer is Go."* This is that plan. Once it's Go, no further PDF-import work is needed — `import_pdf_pages` and `import_pdf_markdown` (`src-tauri/src/commands/pdf.rs`) already call `render_pages`/`extract_pages` and are platform-agnostic per the spec's "Other shared commands... are platform-agnostic and continue to run as-is."

**Architecture:** The existing CI-only smoke-test hook in `src-tauri/src/lib.rs` (`#[cfg(all(target_os = "ios", debug_assertions))]`, gated on `NULLNOTES_PDFIUM_SMOKE_TEST`) already proves `bind_pdfium()` + `extract_pages()` work on-device and is left untouched. This plan adds a second, independent check in the same file: call `crate::pdf::renderer::render_pages()` (the same bundled fixture, same `bind_pdfium()` binding) and write its own result file, so a render-path failure can never be masked by the existing extract-path check passing.

`render_pages` is `async fn`, but the only `tauri::async_runtime::block_on` precedent in this file (`lib.rs`, present-recents on Windows) runs inside `.setup()`, after `tauri::Builder::default()` has been constructed and Tauri's own runtime is live. The smoke-test hook's `std::thread::spawn` runs *before* that point (same insertion spot as the existing extract check), so this plan spins up its own throwaway `tokio::runtime::Runtime` inside the thread rather than assuming Tauri's global runtime is already initialized that early — self-contained, no dependency on Builder-lifecycle timing that hasn't been verified.

Verification runs through the same `xcrun simctl`-driven CI automation `mobile-ios-scaffold.md` and `mobile-pdfium-ios-spike.md` already built into `ios-scaffold.yml` — a native `cargo test` on the macOS runner can't exercise pdfium's real bitmap/font-loading path inside iOS's sandbox; only a running Simulator process can.

**Tech Stack:** `pdfium-render` 0.9.2 (already a dependency), the `tokio` runtime (already a full dependency via `tokio::fs`/`tokio::task::spawn_blocking` elsewhere in `src-tauri`), the already-vendored `pdfium-ios-simulator-arm64` dylib and bundled fixture PDF from `mobile-pdfium-ios-spike.md`, the existing `ios-scaffold.yml` GitHub Actions workflow.

**Spec:** `docs/specs/mobile-app-design.md` (Engineering risk section, "Resolved 2026-09-14 — Go" paragraph: *"Not yet exercised: ...pdfium's rendering (as opposed to text-extraction) surface — both left to the actual PDF-import mobile plan"*); this plan closes that named gap.

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
- **No behavior change to desktop or to the existing extract-path smoke test.** The new render check is a second, independent `#[cfg(all(target_os = "ios", debug_assertions))]` block in `lib.rs` — it does not touch the existing `NULLNOTES_PDFIUM_SMOKE_TEST` extract-check block, `bind_pdfium()`, or any non-iOS code path.
- **The `pdf/` pipeline itself is frozen** (`src-tauri/src/pdf/CLAUDE.md`: "The pipeline is frozen"). This plan proves the existing `render_pages`/`bind_pdfium()` code runs on iOS — it does not modify `layout.rs`, `extract.rs`, `maths.rs`, or any reconstruction logic.
- **No binary blobs committed to git.** Reuses the dylib and fixture PDF `mobile-pdfium-ios-spike.md` already vendors in CI; nothing new is fetched or committed here.
- **This is a spike, not a feature.** Its DoD is a recorded Go/No-Go answer with real evidence (a result string plus a pulled PNG a human actually looks at), not new UI — the command layer needs no changes on a Go result.
- **Out of scope, explicitly: the physical iOS device path and real code signing.** `tauri ios build`'s device target (`-t aarch64`, Tauri CLI's default) requires an `APPLE_DEVELOPMENT_TEAM` and a real signing identity (confirmed against current Tauri docs: automatic signing needs an Apple Developer account either in local Xcode or via `APPLE_API_ISSUER`/`APPLE_API_KEY`/`APPLE_API_KEY_PATH` in CI) — this repo's CI has none of that configured. Getting a signed device build is an Apple Developer Program + GitHub secrets decision for the maintainer to make, not something this plan can route around by writing more code. This plan proves only the Simulator case, exactly as `mobile-pdfium-ios-spike.md` did before it.

---

### Task 1: Prove `render_pages` succeeds and produces a real image, on-device

**Files:**
- Modify: `src-tauri/src/lib.rs` (a second CI-only smoke-test hook, feature-gated, added after the existing extract-check block)
- Modify: `.github/workflows/ios-scaffold.yml` (read the new result file, pull the rendered PNG as an artifact)

**Interfaces:**
- Consumes: `crate::pdf::renderer::render_pages(pdf_path: &Path, out_dir: &Path, progress: impl Fn(usize, usize)) -> anyhow::Result<Vec<PdfPage>>` (`src-tauri/src/pdf/renderer.rs:5`, already calls `bind_pdfium()` internally — reused as-is) and `PdfPage { index: usize, path: String, width: u32, height: u32 }` (`src-tauri/src/pdf/models.rs:5`)
- Produces: a second result file (`pdfium_render_smoke_result.txt`) and a rendered `page-0.png` inside the app's sandboxed container, both read directly off the Simulator's filesystem by CI.

- [ ] **Step 1: Add the render-check hook to `src-tauri/src/lib.rs`**

Insert immediately after the existing `#[cfg(all(target_os = "ios", debug_assertions))]` block (the one ending at the `});` that closes its `std::thread::spawn`, currently around `lib.rs:59`) — as its own separate block, not folded into the existing one, so either check's failure is unambiguous in the result files:

```rust
    #[cfg(all(target_os = "ios", debug_assertions))]
    if std::env::var("NULLNOTES_PDFIUM_SMOKE_TEST").is_ok() {
        std::thread::spawn(|| {
            let fixture = std::env::current_exe()
                .ok()
                .and_then(|p| {
                    p.parent()
                        .map(|p| p.join("assets/pdfium-smoke-fixture.pdf"))
                })
                .unwrap_or_else(|| "assets/pdfium-smoke-fixture.pdf".into());
            let out_dir = std::env::temp_dir();

            // render_pages is async, but this hook runs before
            // tauri::Builder::default() is constructed (same insertion point
            // as the existing extract-check hook above), so Tauri's own
            // async_runtime isn't guaranteed live yet — a throwaway runtime
            // here is self-contained and doesn't depend on that timing.
            let result = tokio::runtime::Runtime::new()
                .map_err(|e| anyhow::anyhow!("runtime: {e}"))
                .and_then(|rt| {
                    rt.block_on(crate::pdf::renderer::render_pages(
                        &fixture,
                        &out_dir,
                        |_, _| {},
                    ))
                })
                .map(|pages| match pages.first() {
                    Some(p) => format!(
                        "PASS pages={} width={} height={} path={}",
                        pages.len(),
                        p.width,
                        p.height,
                        p.path
                    ),
                    None => "FAIL rendered zero pages".to_string(),
                })
                .unwrap_or_else(|e| format!("FAIL {e}"));

            let out = std::env::temp_dir().join("pdfium_render_smoke_result.txt");
            let _ = std::fs::write(&out, result);
        });
    }
```

This runs once, only in a debug iOS build, only when the CI-set env var is present — same lifecycle as the existing extract-check block, no separate cleanup needed.

- [ ] **Step 2: Run `cargo check`/`cargo clippy` for iOS locally to catch typos before spending a CI run**

```bash
cd src-tauri
cargo check --target aarch64-apple-ios-sim
cargo clippy --target aarch64-apple-ios-sim -- -D warnings
```

Expected: both pass clean — `tokio::runtime::Runtime` and `anyhow` are already dependencies used elsewhere in this crate, so this should not need a `Cargo.toml` change.

- [ ] **Step 3: Add a "Read pdfium render smoke-test result" step to `ios-scaffold.yml`**

Insert immediately after the existing `- name: Read pdfium smoke-test result` step (the one that greps `smoke-result.txt` for `^PASS`):

```yaml
      - name: Read pdfium render smoke-test result
        run: |
          set -euo pipefail
          APP_DATA=$(xcrun simctl get_app_container "$UDID" dev.nullnotes.app data)
          RESULT_PATH=$(find "$APP_DATA" -iname "pdfium_render_smoke_result.txt" | head -n1)
          if [ -z "$RESULT_PATH" ]; then
            echo "pdfium_render_smoke_result.txt not found anywhere in the data container"
            echo "--- data container layout (2 levels) ---"
            find "$APP_DATA" -maxdepth 2
            exit 1
          fi
          echo "Found at: $RESULT_PATH"
          cat "$RESULT_PATH" | tee render-smoke-result.txt
          grep -q "^PASS" render-smoke-result.txt
      - name: Pull the rendered page PNG for visual confirmation
        run: |
          set -euo pipefail
          APP_DATA=$(xcrun simctl get_app_container "$UDID" dev.nullnotes.app data)
          PNG_PATH=$(find "$APP_DATA" -iname "page-0.png" | head -n1)
          if [ -z "$PNG_PATH" ]; then
            echo "page-0.png not found anywhere in the data container"
            exit 1
          fi
          cp "$PNG_PATH" rendered-page-0.png
```

A `grep -q "^PASS"` pass is necessary but not sufficient — a render call can return an all-black or all-white bitmap and still report plausible-looking `width`/`height` values. The PNG itself is what actually confirms this, per Step 5.

- [ ] **Step 4: Upload the PNG as a CI artifact**

Add to the existing "Upload screenshots" artifact step's sibling list, or as its own step — either is fine, but keep it a separate named artifact so it's easy to find:

```yaml
      - name: Upload rendered page PNG
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: pdfium-render-smoke
          path: |
            render-smoke-result.txt
            rendered-page-0.png
```

- [ ] **Step 5: Run the workflow and visually inspect the artifact**

```bash
gh workflow run ios-scaffold.yml
gh run watch --exit-status
gh run download --name pdfium-render-smoke
```

Open `rendered-page-0.png`. Expected: a real rendered page of `src-tauri/tests/fixtures/sample.pdf`'s content (readable text/layout, not a blank or garbage image) at roughly the `1700`-wide / up-to-`2200`-tall bounds `render_pages_native`'s `PdfRenderConfig` requests. If the workflow fails, `gh run view --log-failed` — a `grep -q "^PASS"` failure with a `FAIL ...` line in `render-smoke-result.txt` is real evidence (the actual pdfium error), not a CI plumbing bug; read it before assuming the harness is wrong. If the PNG opens but looks wrong (blank, corrupted, wrong dimensions) despite a `PASS` result string, that is itself the finding for Task 2 — record it as a Go with caveats or a No-Go, not a passed check.

- [ ] **Step 6: Record the result as a short addendum to this task**

Note the CI run URL and what the opened PNG actually showed (matching `mobile-pdfium-ios-spike.md`'s own "Result:" convention) directly below this step in this plan file, before moving to Task 2.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/lib.rs .github/workflows/ios-scaffold.yml docs/plans/mobile-pdfium-render-spike.md
git commit -m "feat(mobile): add an iOS pdfium page-rendering smoke test"
```

---

### Task 2: Record the Go/No-Go decision

**Files:**
- Modify: `docs/specs/mobile-app-design.md` (Engineering risk section)
- Modify: `docs/plans/mobile-pdfium-ios-spike.md` (Out of scope section — close out the rendering bullet it left open)

**Interfaces:** None — this task only records Task 1's already-obtained result; it does not run new code.

- [ ] **Step 1: Update the spec's Engineering risk section**

If Task 1's result was Go: append a new dated paragraph directly after the existing "Resolved 2026-09-14 — Go." paragraph in `docs/specs/mobile-app-design.md`, following that paragraph's own convention (what was proven, the CI run URL, what's still not exercised). State plainly that PDF import's Simulator-side unknowns are now fully resolved (both text extraction and rendering), and that the one remaining open item — a signed physical-device build — is blocked on the maintainer provisioning an Apple Developer Program account and the corresponding GitHub Actions secrets (`APPLE_DEVELOPMENT_TEAM` or the `APPLE_API_ISSUER`/`APPLE_API_KEY`/`APPLE_API_KEY_PATH` trio), not on further engineering spikes — so it isn't silently forgotten, and so nobody assumes it's covered by this Simulator-only proof.

If Task 1's result was No-Go: add a dated note recording the exact failure (or the visual defect found in Step 5) and the CI run URL, and add a sentence to the spec's "Out of scope (v1)" list naming PDF-import rendering as a documented v1 gap on iOS, matching the framing `mobile-pdfium-ios-spike.md` Task 3 already established for a No-Go outcome. Do not attempt a workaround in this task.

- [ ] **Step 2: Close out the parent spike's deferred bullet**

In `docs/plans/mobile-pdfium-ios-spike.md`'s "Out of scope (this plan)" section, the bullet reading *"Rendering a page to an image on iOS... is left for the actual PDF-import mobile plan once this spike's answer is Go"* — append one clause pointing to this plan and its result (e.g. "— addressed in `docs/plans/mobile-pdfium-render-spike.md`, \<Go/No-Go\>"), so a future reader following that bullet's own pointer lands on a resolved answer instead of a dead end.

- [ ] **Step 3: Commit**

```bash
git add docs/specs/mobile-app-design.md docs/plans/mobile-pdfium-ios-spike.md
git commit -m "docs(mobile): record the iOS pdfium render spike's Go/No-Go result"
```

---

## Out of scope (this plan)

- **The physical iOS device path and real code signing.** Requires an Apple Developer Program account and CI secrets this repo doesn't have configured — a provisioning decision for the maintainer, not an engineering unknown this plan can spike its way around. See Global Constraints.
- **A production PDF-import UI/flow for mobile.** Not needed on a Go result — `import_pdf_pages`/`import_pdf_markdown` (`src-tauri/src/commands/pdf.rs`) are already platform-agnostic and call exactly the functions this plan proves work on-device.
- **Rendering quality/fidelity comparison against desktop output.** This plan confirms pdfium renders *something* real and correctly-shaped on iOS; pixel-level parity with desktop's Windows pdfium binary isn't asserted or expected to differ in a way that matters for a note's rendered PDF pages.
- **Android.** Same footnote as every prior mobile plan.

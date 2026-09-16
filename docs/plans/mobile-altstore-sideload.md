# Mobile AltStore Sideload Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Get the real iOS build running on the maintainer's own physical iPhone, with no Mac and no paid Apple Developer Program membership — using a free Apple ID and AltStore's free-tier sideloading instead of the App Store Connect signing path `docs/specs/mobile-app-design.md` originally assumed.

**Architecture:** `docs/specs/mobile-app-design.md`'s Engineering-risk section records the physical-device path as "blocked on the maintainer provisioning an Apple Developer Program account" — that assumption no longer holds because it was never a hard requirement, just the path every prior mobile plan happened to use for Simulator CI, which doesn't need signing at all. Two independent pieces close the gap instead: (1) a CI change to `.github/workflows/ios-scaffold.yml` that builds an **unsigned, device-architecture** (`arm64`, not simulator) archive and packages it into a plain `.ipa`, uploaded as a workflow artifact; (2) a one-time, human-only setup of **AltServer** (runs on Windows, not just Mac) paired with **AltStore** on the iPhone, which performs the actual free-tier code signing itself using the maintainer's own Apple ID — no CI involvement, no Mac, no $99/year fee. AltServer/AltStore are the standard, above-board mechanism free Apple IDs use to install non-App-Store apps on a personal device; Apple's own free-tier developer signing allowance is what makes this legal without a paid account.

**Tech Stack:** Tauri 2 `tauri ios build` (device target), `xcodebuild` unsigned archive as a documented fallback, AltServer 1.7.x for Windows, AltStore on iOS (Developer Mode required, iOS 16+).

**Spec:** `docs/specs/mobile-app-design.md`

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

- **No Apple Developer Program membership, ever.** This plan exists specifically to avoid the $99/year fee; any step that requires it is a plan bug, not an acceptable fallback.
- **No Mac, ever.** Every automatable step runs on the existing `macos-latest` GitHub Actions runner (already used by `ios-scaffold.yml`) or on the maintainer's own Windows machine. Nothing in this plan assumes local Mac access.
- **Real Apple ID credentials never touch CI.** AltServer needs the maintainer's Apple ID email + password (or app-specific password) to sign; that only ever gets typed into the AltServer GUI running locally on the maintainer's Windows machine, never into a GitHub Actions secret, workflow file, or committed anywhere in this repo — mirroring the "no real credential, ever" rule `docs/plans/mobile-editor-sync-verification.md` already established for the same underlying reason (nothing this sensitive belongs in CI).
- **Single personal device, single user.** No App Store distribution, no TestFlight, no multi-user provisioning. This plan's DoD is "installed and runnable on the maintainer's own iPhone," not general distribution.
- **`cargo fmt --check`, `cargo clippy -- -D warnings` (both targets) and desktop `cargo test` stay green** — Task 1 only adds workflow steps after the existing gates, so this holds automatically as long as those steps aren't touched.

---

### Task 1: Build an unsigned, device-architecture `.ipa` in CI

**Files:**
- Modify: `.github/workflows/ios-scaffold.yml` (new steps, appended after the existing `Build for iOS Simulator` / Simulator smoke-test steps — this task doesn't touch or depend on them, it's an independent build)

**Interfaces:**
- Produces: `null-notes-unsigned.ipa`, a standard `.ipa` (a zip with `Payload/null-notes_iOS.app/` at its root) built for `arm64` real-device architecture, unsigned, uploaded as a workflow artifact named `mobile-altstore-ipa`.

- [ ] **Step 1: Probe whether the installed Tauri CLI supports `--no-sign`/`--archive-only`**

`package-lock.json` pins `@tauri-apps/cli` at `2.11.4`; whether that version has the `--no-sign`/`--archive-only` flags (added in `tauri-apps/tauri#15061`) isn't confirmed for this exact version, so check it directly in CI rather than assuming:

```yaml
      - name: Check tauri CLI ios build flags
        run: npx tauri ios build --help
```

Read the output. If `--no-sign` and `--archive-only` are listed, use Step 2a. If not, use Step 2b (manual `xcodebuild`). Don't guess — the rest of this task branches on what this step actually prints.

- [ ] **Step 2a: (if the flags exist) Build unsigned via the Tauri CLI**

```yaml
      - name: Build unsigned device archive (Tauri CLI)
        run: npx tauri ios build --target aarch64 --archive-only --no-sign
      - name: Locate the unsigned .xcarchive
        run: |
          set -euo pipefail
          ARCHIVE_PATH=$(find ~/Library/Developer/Xcode/DerivedData -name "*.xcarchive" | head -n1)
          echo "ARCHIVE_PATH=$ARCHIVE_PATH" >> "$GITHUB_ENV"
          echo "Found: $ARCHIVE_PATH"
```

Continue at Step 3.

- [ ] **Step 2b: (if the flags don't exist) Build unsigned via `xcodebuild` directly**

The existing Simulator build already runs `npx tauri ios build` once, which generates and keeps `src-tauri/gen/apple/` up to date (the Xcode project checked into this repo's build output, per the existing workflow's `Fetch iOS pdfium binary` / `cargo check --target aarch64-apple-ios-sim` steps that already assume `gen/apple` exists). Archive that project directly for the device destination with signing disabled:

```yaml
      - name: Build unsigned device archive (xcodebuild)
        working-directory: src-tauri/gen/apple
        run: |
          set -euo pipefail
          xcodebuild archive \
            -project null-notes.xcodeproj \
            -scheme null-notes_iOS \
            -destination "generic/platform=iOS" \
            -archivePath "$RUNNER_TEMP/null-notes.xcarchive" \
            CODE_SIGN_IDENTITY="" \
            CODE_SIGNING_REQUIRED=NO \
            CODE_SIGNING_ALLOWED=NO
          echo "ARCHIVE_PATH=$RUNNER_TEMP/null-notes.xcarchive" >> "$GITHUB_ENV"
```

Continue at Step 3.

- [ ] **Step 3: Package the `.xcarchive` into a plain `.ipa`**

An unsigned archive can't go through `xcodebuild -exportArchive` (it refuses without a signing identity) — AltStore doesn't need that anyway, since it re-signs on install. A `.ipa` is just `Payload/<AppName>.app/` zipped, so build it by hand:

```yaml
      - name: Package the archive's .app into a plain .ipa
        run: |
          set -euo pipefail
          APP_PATH=$(find "$ARCHIVE_PATH/Products/Applications" -maxdepth 1 -name "*.app" | head -n1)
          if [ -z "$APP_PATH" ]; then
            echo "no .app found under $ARCHIVE_PATH/Products/Applications"
            find "$ARCHIVE_PATH" -maxdepth 4
            exit 1
          fi
          mkdir -p "$RUNNER_TEMP/Payload"
          cp -R "$APP_PATH" "$RUNNER_TEMP/Payload/"
          (cd "$RUNNER_TEMP" && zip -r -y null-notes-unsigned.ipa Payload)
          mv "$RUNNER_TEMP/null-notes-unsigned.ipa" .
          unzip -l null-notes-unsigned.ipa | head -20
```

- [ ] **Step 4: Upload the `.ipa` as a workflow artifact**

```yaml
      - name: Upload unsigned ipa
        uses: actions/upload-artifact@v4
        with:
          name: mobile-altstore-ipa
          path: null-notes-unsigned.ipa
```

- [ ] **Step 5: Run the workflow and confirm the artifact downloads and unzips to a `Payload/null-notes_iOS.app/` with a real `null-notes_iOS` executable inside**

```bash
gh workflow run ios-scaffold.yml
gh run watch --exit-status
gh run download --name mobile-altstore-ipa
unzip -l null-notes-unsigned.ipa | grep "Payload/null-notes_iOS.app/null-notes_iOS"
```

If the executable isn't listed, the archive step produced an empty or wrongly-shaped `.app` — check `Step 3`'s `find` output in the run log before re-running.

**Result:**

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/ios-scaffold.yml
git commit -m "ci(mobile): build an unsigned device-arch ipa for AltStore sideloading"
```

---

### Task 2: One-time AltServer/AltStore setup and sideload (human-only — not agent-executable)

This task has no commands an agent can run: it requires the maintainer's own Apple ID password typed into a GUI running on their own Windows machine, and physical access to their iPhone via USB. Nothing here belongs in CI or in this repo. It's recorded as a checklist so the DoD in Task 3 has something concrete to point at, not as a script.

- [ ] **Step 1: Install Apple's device drivers on Windows**

Apple discontinued iTunes for Windows; device drivers now ship via the **Apple Devices** app from the Microsoft Store (search "Apple Devices"). AltServer needs this installed and the iPhone unlocked and trusted over USB at least once before pairing will work.

- [ ] **Step 2: Install AltServer for Windows**

Download from `altstore.io` (Windows build, currently AltServer 1.7.x). Run it — it sits in the system tray, not a normal window.

- [ ] **Step 3: Pair the iPhone and install AltStore**

Connect the iPhone via USB. In the AltServer tray icon menu: "Install AltStore" → select the device. AltServer prompts for the Apple ID email and password (or an app-specific password — recommended, generated at `appleid.apple.com`, avoids handing AltServer the real account password). This creates a free "Personal Team" App ID under that Apple ID and installs the AltStore app itself onto the phone using it.

- [ ] **Step 4: Trust the developer profile on-device**

On the iPhone: Settings → General → VPN & Device Management → trust the new developer profile. Without this the AltStore app icon exists but refuses to launch ("Untrusted Developer").

- [ ] **Step 5: Enable Developer Mode (iOS 16+)**

Settings → Privacy & Security → Developer Mode → on → device reboots and prompts to confirm. Required for any non-App-Store app to run at all, independent of AltStore.

- [ ] **Step 6: Download Task 1's `.ipa` artifact onto the Windows machine**

```bash
gh run download --name mobile-altstore-ipa
```

(Or download it from the Actions run page in a browser — either lands `null-notes-unsigned.ipa` on the Windows machine's disk, which is all AltServer needs.)

- [ ] **Step 7: Sideload via AltServer**

AltServer tray icon → "Install .ipa" (or drag the `.ipa` onto the tray icon) → select the connected device. AltServer re-signs the unsigned `.ipa` with the free provisioning profile from Step 3 and pushes it over USB. Watch the iPhone home screen for the null-notes icon to appear with an install progress ring.

- [ ] **Step 8: Launch and confirm**

Tap the icon. Expected: the app launches to the mobile onboarding screen (`WorkspacePicker`), matching what the Simulator screenshots in `docs/plans/mobile-ios-scaffold.md` and `mobile-credentials-onboarding.md` already show — this is the same UI, just running on real hardware for the first time. If it crashes on launch instead, that's real product-code signal (not a signing problem, since it got past Apple's install-time signature check to run at all) — worth filing as its own bug, out of scope for this plan to diagnose blind.

**Result:** record here whether Steps 1–8 succeeded, and on what iOS version / device model, once actually run — this section is the plan's evidence, not something to pre-fill.

---

### Task 3: Record the result and update the spec's stale blocker text

**Files:**
- Modify: `docs/specs/mobile-app-design.md` (Engineering-risk section's "blocked on the maintainer provisioning an Apple Developer Program account" line)

**Interfaces:** None — this task only records Task 1/2's outcome; it runs no new code.

- [ ] **Step 1: Replace the stale paid-account assumption**

The current text (`docs/specs/mobile-app-design.md`, end of the pdfium-render-spike "Resolved" paragraph) reads: *"The one remaining open item — a signed physical-device build — is blocked on the maintainer provisioning an Apple Developer Program account and the corresponding GitHub Actions secrets... not on further engineering spikes."* That was only ever true for App Store Connect-style signing; it was never actually load-bearing for getting the app running on a personal device. Replace it with a dated resolution note pointing at this plan: what Task 1/2 actually proved (device install works via free-tier AltStore signing, no paid account), the concrete limitation this path carries (AltServer re-signs every **7 days** — the free-tier certificate expiry Apple enforces regardless of signing method; AltStore's background refresh handles this automatically only while the iPhone and the Windows machine running AltServer share the same Wi-Fi network periodically, otherwise it's Task 2 Steps 6–7 run again by hand), and what's still not covered (on-device debugging/crash-log access without a Mac's `lldb`/Console.app — out of scope here, revisit only if a real bug needs it).

- [ ] **Step 2: Commit**

```bash
git add docs/specs/mobile-app-design.md
git commit -m "docs(mobile): record the free-tier AltStore sideload path, supersede the paid-account blocker"
```

---

## Out of scope (this plan)

- **App Store / TestFlight distribution.** This plan is single-device, free-tier sideloading only.
- **Automating Task 2.** AltServer's pairing and signing flow is an interactive GUI tied to a real Apple ID login on the maintainer's own machine; there is no headless/CI path for it without a paid Apple Developer Program account's App Store Connect API key, which this plan exists specifically to avoid needing.
- **Automatic background refresh reliability.** AltStore's Wi-Fi-based auto-refresh is a known-flaky mechanism (depends on both devices being on the same network when the 7-day window elapses); this plan documents the manual fallback but doesn't build tooling around it.
- **On-device debugging (crash logs, console output, breakpoints) without a Mac.** Real gap, not addressed here — `lldb` and Console.app are Mac-only; Windows has no equivalent for a Tauri/Rust iOS binary. Revisit only if a real on-device bug needs it.
- **Ink-canvas stroke/stylus fidelity, diverged-pull states, and anything else `mobile-editor-sync-verification.md` already scoped as out of scope for the Simulator-based verification pass** — unaffected by this plan, which only changes how the build reaches a physical device, not what's tested on it.

# Mobile Editor + Sync Round-Trip Verification Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Close the two `docs/specs/mobile-app-design.md` DoD bullets that no prior mobile plan has actually exercised end to end — "a fresh iOS install can clone an existing Git-backed workspace and show its notes" and "a note edited on mobile, once synced, shows the edit on desktop and vice versa" — with real evidence from a running iOS Simulator, not a unit-test proxy for it.

**Architecture:** Every prior mobile CI step that touched cloning used a deliberately unreachable URL (`mobile-credentials-onboarding.md`'s own out-of-scope note: "no safe way to hold a real credential in this repo's CI"), so the real clone → edit → sync path has never actually run. This plan closes that gap without ever holding a real credential: it stands up a throwaway `git http-backend` smart-HTTP server bound to the CI runner's loopback interface (reachable from the iOS Simulator, which — unlike a physical device — shares the host's network stack directly) and drives the app's real onboarding form, real touch-driven editing, and the real "Sync now" button against it. `gix`'s HTTP transport (`Cargo.toml`: `blocking-http-transport-reqwest-rust-tls`) is a Rust-native `reqwest`/`rustls` socket client, not `NSURLSession`/`CFNetwork` — so it is not subject to iOS's App Transport Security policy, and a plain `http://` remote needs no ATS exception to work. This also happens to be the one gix code path none of the existing `git_mobile.rs` unit tests exercise: those tests clone/fetch/push between local `tempfile` directories (`gix`'s local transport), never over HTTP — so this plan is the first real exercise of `checked_push`'s hand-rolled receive-pack wire protocol (`git-mobile-push.md`'s own doc comment: "gix has no porcelain send-pack API... this hand-rolls the git wire protocol") against an actual HTTP server, not just against a local filesystem remote.

**Tech Stack:** `git http-backend` (ships with the `git` already on `macos-latest`), Python 3's stdlib `http.server --cgi` (no new dependency — Python 3 ships on `macos-latest`), the existing `ios-scaffold.yml` GitHub Actions workflow, `idb` (already installed by a prior step in that workflow), `xcrun simctl`.

**Spec:** `docs/specs/mobile-app-design.md` (DoD list, the two bullets without a "Resolved" annotation: the clone-and-show-notes bullet and the edit-and-sync-both-ways bullet); also closes the two "beyond verification" notes left open by `docs/plans/mobile-app-shell-reflow.md` ("If a future plan wants this confirmed live on-device, that's a separate CI Simulator smoke-test addition... out of scope here") and by the spec's own UI section (the TipTap/ink pointer-event layer "is not a focus area of the implementation plan beyond verification" — this plan is that verification, for the editor's text-input side; ink-canvas stroke drawing is explicitly out of scope, see below).

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

- **Requires the same macOS-host-via-CI setup `docs/plans/mobile-ios-scaffold.md` already built.** Every command below runs as a step appended to `.github/workflows/ios-scaffold.yml`, triggered via `gh workflow run` / `gh run watch --exit-status` from Windows — never typed by hand on a Mac.
- **No real credential, ever.** The HTTP server this plan stands up enforces no auth at all — `git http-backend`'s default is open read; `git config http.receivepack true` on the served repo is the only auth-relevant setting touched, and it grants write to anyone who can reach the port, which is fine because the port is loopback-only and the whole VM is torn down at the end of the CI job. The onboarding form's token field still gets a non-empty dummy value (it's a required form field), which is simply never checked by anything.
- **No behavior change to desktop or to any existing mobile command.** This plan adds CI steps only; it does not modify `git_mobile.rs`, `git.rs`, `WorkspacePicker.tsx`, or any other production source file.
- **This is a spike/verification pass, not a feature.** Its DoD is the two spec bullets recorded as resolved with real evidence, matching the framing every prior spike plan (`mobile-pdfium-ios-spike.md`, `mobile-pdfium-render-spike.md`) already established.
- **`cargo fmt --check`, `cargo clippy -- -D warnings` (both targets) and desktop `cargo test` stay green** — unaffected in practice since no Rust source changes, but the existing CI steps ahead of this plan's new ones already assert it.

---

### Task 1: Stand up a local smart-HTTP git remote in CI and confirm it works with real `git` before ever touching the Simulator

**Files:**
- Modify: `.github/workflows/ios-scaffold.yml` (new steps, inserted before the existing `- name: Build for iOS Simulator` step)

**Interfaces:**
- Produces: a `git http-backend` server bound to `127.0.0.1:8080` inside the CI job, serving one bare repo (`fixture-remote.git`) seeded with a single commit containing `note.md`, with `http.receivepack` enabled. `$GITHUB_ENV`'s `FIXTURE_REMOTE_URL` is set to `http://127.0.0.1:8080/fixture-remote.git` for later steps to reuse.

- [ ] **Step 1: Add the "Stand up a local git HTTP remote" step**

Insert immediately before the existing `- name: Build for iOS Simulator` step:

```yaml
      - name: Stand up a local git HTTP remote
        run: |
          set -euo pipefail
          # Seed the bare repo's initial content in a throwaway working copy,
          # then push it into a real bare repo the same way a real "desktop"
          # would have created it — not `git init --bare` with hand-crafted
          # objects, so the fixture is exactly as real as any other repo.
          mkdir -p /tmp/git-http-root
          git init --bare --initial-branch=main /tmp/git-http-root/fixture-remote.git
          git -C /tmp/git-http-root/fixture-remote.git config http.receivepack true

          mkdir -p /tmp/fixture-seed
          git -C /tmp/fixture-seed init --initial-branch=main
          git -C /tmp/fixture-seed config user.name "ci-seed"
          git -C /tmp/fixture-seed config user.email "ci-seed@example.com"
          echo "# Fixture note" > /tmp/fixture-seed/note.md
          git -C /tmp/fixture-seed add note.md
          git -C /tmp/fixture-seed commit -m "seed: fixture note"
          git -C /tmp/fixture-seed push /tmp/git-http-root/fixture-remote.git main

          # git-http-backend is a CGI binary; Python's stdlib CGI HTTP server
          # execs it with the right CGI env vars set, no new dependency needed
          # on a runner that already ships git and python3.
          mkdir -p /tmp/git-http-root/cgi-bin
          cp "$(git --exec-path)/git-http-backend" /tmp/git-http-root/cgi-bin/
          (
            cd /tmp/git-http-root
            GIT_HTTP_EXPORT_ALL=1 GIT_PROJECT_ROOT=/tmp/git-http-root \
              python3 -m http.server --cgi 8080 &
            echo $! > /tmp/git-http-server.pid
          )
          sleep 1

          echo "FIXTURE_REMOTE_URL=http://127.0.0.1:8080/fixture-remote.git" >> "$GITHUB_ENV"
```

- [ ] **Step 2: Confirm the server actually speaks smart HTTP, using real `git` — before trusting the Simulator with it**

Add immediately after Step 1's step:

```yaml
      - name: Sanity-check the local git remote with a real host-side clone
        run: |
          set -euo pipefail
          rm -rf /tmp/sanity-clone
          git clone "$FIXTURE_REMOTE_URL" /tmp/sanity-clone
          test -f /tmp/sanity-clone/note.md
          grep -q "Fixture note" /tmp/sanity-clone/note.md
          echo "smart-HTTP clone: OK"
```

If this step fails, the problem is the CGI server setup (wrong `GIT_PROJECT_ROOT`, `git-http-backend` not executable, wrong port) — diagnose and fix it here, before Task 2 ever spends CI minutes booting a Simulator against a broken remote.

- [ ] **Step 3: Run the workflow and confirm both new steps pass**

```bash
gh workflow run ios-scaffold.yml
gh run watch --exit-status
```

On failure, `gh run view --log-failed`.

**Result:** Passed in the slim workflow `.github/workflows/ios-sync-verify.yml` (build + boot + clone only; the full `ios-scaffold.yml` stays for release-style runs). Real `git clone` over `http://127.0.0.1:8080/cgi-bin/git-http-backend/fixture-remote.git` works; the earlier "repository not found" was the missing `/cgi-bin/git-http-backend/` prefix (ade39c6).

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ios-scaffold.yml
git commit -m "ci(mobile): stand up a local smart-HTTP git remote for sync verification"
```

---

### Task 2: Clone the fixture remote through the real onboarding UI and confirm the note shows up on-device

**Files:**
- Modify: `.github/workflows/ios-scaffold.yml` (new steps, inserted after the existing onboarding-smoke-test steps, i.e. after `- name: Screenshot the result` / before the artifact-upload steps)

**Interfaces:**
- Consumes: `FIXTURE_REMOTE_URL` from Task 1; the onboarding form fields at the tap coordinates `mobile-credentials-onboarding.md` already recorded (URL field `(320, 605)`, token field `(320, 677)`, Clone workspace button `(320, 726)`) — reused as a starting guess, re-verified against a fresh screenshot in Step 1 below since those coordinates predate `mobile-app-shell-reflow.md`'s layout changes and that plan's own result note already flagged them as likely stale ("the next mobile plan (app-shell reflow) will resize/reposition this form... leaving a record here is what lets that plan know to re-verify rather than assume this smoke test still passes").
- Produces: a cloned workspace at `Documents/fixture-remote` inside the app's sandboxed data container, containing a real `note.md` with real Git history.

- [ ] **Step 1: Re-run the onboarding form against the real fixture remote instead of the unreachable one**

The existing steps `Tap the URL field and type` / `Tap the token field and type` / `Tap Clone workspace` (lines ~136–145 of `ios-scaffold.yml` as of this plan's writing) type `https://example.com/no-such-repo.git` and expect a failure. Leave those steps exactly as they are — they're their own plan's regression check for "the clone attempt dispatches and fails visibly." Add new steps after them, on a **second, independent onboarding attempt** — the WorkspacePicker's onboarding form doesn't disappear after a failed clone (per `mobile-credentials-onboarding.md`'s own screenshot evidence: "the button reverted from 'Cloning…' back to 'Clone workspace'"), so the same form fields can be reused:

```yaml
      - name: Clear the failed attempt's form fields and retype the real remote URL
        run: |
          idb ui tap --udid "$UDID" 320 605
          # Select-all + delete: the field already has the unreachable URL in it.
          idb ui key --udid "$UDID" --key-sequence CMD+A
          idb ui key --udid "$UDID" --key-sequence DELETE
          idb ui text --udid "$UDID" "$FIXTURE_REMOTE_URL"
      - name: Retype the token field
        run: |
          idb ui tap --udid "$UDID" 320 677
          idb ui key --udid "$UDID" --key-sequence CMD+A
          idb ui key --udid "$UDID" --key-sequence DELETE
          idb ui text --udid "$UDID" "dummy-token-for-ci"
      - name: Tap Clone workspace again
        run: idb ui tap --udid "$UDID" 320 726
      - name: Wait for the real clone to complete
        run: sleep 8
      - name: Screenshot after the real clone
        run: xcrun simctl io "$UDID" screenshot clone-success.png
```

If `idb ui key --key-sequence` doesn't accept `CMD+A`/`DELETE` as written (idb's key-sequence syntax has changed across versions before, the same caveat `mobile-ios-scaffold.md` and `mobile-pdfium-ios-spike.md` both flagged for their own external tools), fall back to seven `idb ui key --udid "$UDID" --key-sequence BACKSPACE` calls per field (the unreachable URL is short) — confirm empirically which works, don't guess blind.

- [ ] **Step 2: Pull `clone-success.png` and confirm it shows notes, not an error toast**

```yaml
      - name: Upload clone-success screenshot
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: mobile-editor-sync-clone
          path: clone-success.png
```

Open the downloaded PNG. Expected: the onboarding form is gone, replaced by the app's normal note-list/editor view showing "Fixture note" (or whatever the note-list row renders the note's title as) — not a toast, not the still-filled-in form. If the tap coordinates from Step 1 landed wrong (a real risk after the app-shell reflow resized this form), the screenshot shows the form still sitting there or a different failure — adjust the coordinates from this screenshot and re-run, the same iterative process every prior plan's on-device tap step has used.

- [ ] **Step 3: Confirm the clone by reading the actual file off the device, not just the screenshot**

```yaml
      - name: Read the cloned note directly from the app's data container
        run: |
          set -euo pipefail
          APP_DATA=$(xcrun simctl get_app_container "$UDID" dev.nullnotes.app data)
          NOTE_PATH=$(find "$APP_DATA/Documents" -iname "note.md" | head -n1)
          if [ -z "$NOTE_PATH" ]; then
            echo "note.md not found under $APP_DATA/Documents"
            find "$APP_DATA/Documents" -maxdepth 3
            exit 1
          fi
          echo "Found at: $NOTE_PATH"
          grep -q "Fixture note" "$NOTE_PATH"
          echo "on-device clone content: OK"
```

This is the real DoD evidence for "a fresh iOS install can clone an existing Git-backed workspace... and show its notes" — a file that only exists because `checked_clone_repo` fetched it over the loopback HTTP remote and checked it out, read directly off the Simulator's filesystem rather than inferred from a screenshot.

- [ ] **Step 4: Run the workflow and record the result**

```bash
gh workflow run ios-scaffold.yml
gh run watch --exit-status
```

**Result:** Passed, CI run [38182288140](https://github.com/TorresVisual/null-notes/actions/runs/38182288140): `note.md` found in the app's data container with "Fixture note", dashboard lists it under Recent with Git "Up to date". Getting there found and fixed a real bug: `keyring`'s v1 `Entry` has no iOS store, so every token save failed with NoDefaultStore (955ba0c; the earlier unreachable-host onboarding check never reached it). Input method that works: tap the URL field at (196, 585) pt, then `idb ui text`, Tab (`key 43`) to the token field, tap Clone workspace at (196, 663) pt. Return (`key 40`) does not submit; Tab with nothing focused does nothing; `idb ui describe-all` only exposes the app root, so label-based taps are not possible. Observed, not fixed: the post-clone dashboard is clipped on the right edge at 393pt width.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ios-scaffold.yml
git commit -m "ci(mobile): verify a real clone shows real notes on-device"
```

---

### Task 3: Edit the note through real touch input, push via "Sync now", and confirm the push landed on the host-side remote

**Files:**
- Modify: `.github/workflows/ios-scaffold.yml` (new steps, appended after Task 2's steps)

**Interfaces:**
- Consumes: the cloned workspace from Task 2; `TabBar.tsx`'s `.git-sync-now` button (`src/components/TabBar.tsx:87-93`, wired to `flushGitCommit(true)` per `src/hooks/useGitAutoCommit.ts:21` — `force=true` bypasses the idle-minutes auto-commit gate entirely, so this doesn't need to wait out `idleMinutes * 60_000`); `SAVE_DEBOUNCE_MS = 600` (`src/hooks/useNote.ts:10`) for how long to wait after typing before the file write lands.
- Produces: a second commit on `main` in `/tmp/git-http-root/fixture-remote.git`, readable directly by the CI job's own `git` (not through the app at all) — the "does a second, independent git client see the edit" half of the DoD's sync bullet.

- [ ] **Step 1: Tap into the open note and type new content**

Since Task 2 leaves the app on the note view (not the note-list), find the real tap coordinates for the editor's content area from `clone-success.png` (the same "look at the screenshot, don't guess" step every prior UI-tap task in this plan set has used):

```yaml
      - name: Tap into the note body and type an edit
        run: |
          idb ui tap --udid "$UDID" <EDITOR_X> <EDITOR_Y>
          idb ui text --udid "$UDID" " — edited on mobile"
          sleep 1  # let the SAVE_DEBOUNCE_MS=600 write-atomic save land
      - name: Screenshot after typing
        run: xcrun simctl io "$UDID" screenshot after-edit.png
```

`<EDITOR_X> <EDITOR_Y>` is a placeholder in this plan's text only — the executing agent replaces it with a real coordinate read off `clone-success.png` before running, per this plan's own Step 2 methodology below, not a guess baked into the plan.

- [ ] **Step 2: Confirm the edit actually landed on disk before trying to sync it**

```yaml
      - name: Confirm the edited content is on disk
        run: |
          set -euo pipefail
          APP_DATA=$(xcrun simctl get_app_container "$UDID" dev.nullnotes.app data)
          NOTE_PATH=$(find "$APP_DATA/Documents" -iname "note.md" | head -n1)
          grep -q "edited on mobile" "$NOTE_PATH"
          echo "on-device edit write: OK"
```

If this fails, the tap in Step 1 didn't land inside the editor's content area (it may have landed on a toolbar button, or the tab bar) — re-derive `<EDITOR_X> <EDITOR_Y>` from `after-edit.png` (which will show whatever the mistaken tap actually did) and retry, rather than proceeding to Step 3 against an unedited file.

- [ ] **Step 3: Tap "Sync now" and confirm the push**

`.git-sync-now`'s screen position needs the same real-screenshot derivation as every other tap coordinate in this plan set:

```yaml
      - name: Tap Sync now
        run: |
          idb ui tap --udid "$UDID" <SYNC_NOW_X> <SYNC_NOW_Y>
          sleep 5  # commit + HTTP push round trip
      - name: Screenshot after sync
        run: xcrun simctl io "$UDID" screenshot after-sync.png
```

- [ ] **Step 4: Confirm the push landed, by reading the host-side bare repo directly — not through the app**

```yaml
      - name: Confirm the pushed commit exists on the remote, using a fresh host-side clone
        run: |
          set -euo pipefail
          rm -rf /tmp/verify-push
          git clone "$FIXTURE_REMOTE_URL" /tmp/verify-push
          grep -q "edited on mobile" /tmp/verify-push/note.md
          git -C /tmp/verify-push log --oneline | head -5
          echo "push round trip: OK"
```

A fresh `git clone` from a plain, unmodified `git` binary is the "second machine" this DoD bullet describes — it never touches `git_mobile.rs` or anything mobile-specific, so a pass here is real, independent confirmation that `checked_push`'s hand-rolled receive-pack implementation produced a well-formed push a completely different git implementation can read back correctly.

- [ ] **Step 5: Upload screenshots and run the workflow**

```yaml
      - name: Upload edit/sync screenshots
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: mobile-editor-sync-edit
          path: |
            after-edit.png
            after-sync.png
```

```bash
gh workflow run ios-scaffold.yml
gh run watch --exit-status
```

**Result:**

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/ios-scaffold.yml
git commit -m "ci(mobile): verify a mobile edit really pushes to the remote"
```

---

### Task 4: Simulate a desktop-side push, and confirm mobile pulls it on next workspace open

**Files:**
- Modify: `.github/workflows/ios-scaffold.yml` (new steps, appended after Task 3's steps)

**Interfaces:**
- Consumes: `useGitAutoPull.ts`'s `checkForUpdates` (`src/hooks/useGitAutoPull.ts:18-` — runs "on workspace open," per that file's own doc comment) as the trigger; `WorkspacePicker.tsx`'s Recent-workspaces list (`src/components/WorkspacePicker.tsx:46-62`) as the on-device UI path back into the same workspace, since this app has no auto-reopen-last-workspace-on-launch behavior (confirmed: no code path reads `recentWorkspaces[0]` on startup) — closing and relaunching the app lands on `WorkspacePicker`, not straight back into the note.
- Produces: on-device confirmation that a fast-forward pull, triggered by real workspace-open UI flow (not a direct Rust function call), correctly updates the checked-out `note.md`.

- [ ] **Step 1: Push a second, independent commit into the fixture remote from the host — standing in for "desktop"**

```yaml
      - name: Simulate a desktop-side edit by pushing directly to the fixture remote
        run: |
          set -euo pipefail
          echo "Fixture note — edited on mobile — and also edited on desktop" > /tmp/verify-push/note.md
          git -C /tmp/verify-push add note.md
          git -C /tmp/verify-push -c user.name=desktop-sim -c user.email=desktop-sim@example.com commit -m "desktop: further edit"
          git -C /tmp/verify-push push origin main
```

(`/tmp/verify-push` is the fresh clone Task 3 Step 4 already made — reused here as the "desktop machine," since it's already configured with the right remote.)

- [ ] **Step 2: Terminate and relaunch the app, then reopen the workspace from the Recent list**

```yaml
      - name: Terminate and relaunch the app
        run: |
          xcrun simctl terminate "$UDID" dev.nullnotes.app || true
          xcrun simctl launch "$UDID" dev.nullnotes.app
          sleep 3
      - name: Screenshot the relaunch (expect WorkspacePicker with a Recent entry)
        run: xcrun simctl io "$UDID" screenshot after-relaunch.png
```

Pull this artifact and find the real tap coordinates for the "fixture-remote" row under "Recent" (`WorkspacePicker.tsx`'s `<li>` per recent path) before continuing — same derive-from-screenshot discipline as every prior tap in this plan set.

```yaml
      - name: Tap the Recent workspace entry to reopen it
        run: |
          idb ui tap --udid "$UDID" <RECENT_ROW_X> <RECENT_ROW_Y>
          sleep 5  # let checkForUpdates' fetch-and-compare + fast-forward land
      - name: Screenshot after reopening
        run: xcrun simctl io "$UDID" screenshot after-pull.png
```

- [ ] **Step 3: Confirm the desktop-side edit landed on-device, by reading the file — not by eye**

```yaml
      - name: Confirm the pulled content is on disk
        run: |
          set -euo pipefail
          APP_DATA=$(xcrun simctl get_app_container "$UDID" dev.nullnotes.app data)
          NOTE_PATH=$(find "$APP_DATA/Documents" -iname "note.md" | head -n1)
          grep -q "and also edited on desktop" "$NOTE_PATH"
          echo "pull round trip: OK"
```

- [ ] **Step 4: Upload the remaining screenshots and run the workflow**

```yaml
      - name: Upload relaunch/pull screenshots
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: mobile-editor-sync-pull
          path: |
            after-relaunch.png
            after-pull.png
```

```bash
gh workflow run ios-scaffold.yml
gh run watch --exit-status
```

On failure: `gh run view --log-failed`. A failure in Step 3's `grep` with the file present but stale content is real evidence `checked_pull`'s fast-forward path or `useGitAutoPull`'s open-time trigger has a real bug — read it before assuming a CI plumbing issue, per this whole plan set's established discipline.

**Result:**

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ios-scaffold.yml
git commit -m "ci(mobile): verify a desktop-side push is pulled on next workspace open"
```

---

### Task 5: Record the result in the spec

**Files:**
- Modify: `docs/specs/mobile-app-design.md` (DoD list)

**Interfaces:** None — this task only records Tasks 1–4's already-obtained results; it runs no new code.

- [ ] **Step 1: Annotate both previously-unresolved DoD bullets**

If all four tasks passed: add a dated "Resolved 2026-09-15" (or the actual date this plan executes) parenthetical to both bullets — "A fresh iOS install can clone an existing Git-backed workspace... and show its notes" and "A note edited on mobile, once synced, shows the edit on desktop and vice versa..." — following the exact convention the Engineering risk section's own two "Resolved" paragraphs already established (what was proven, the CI run URL, what's still not covered). Explicitly note what this plan does **not** cover, so a future reader doesn't over-read the result:

- The physical-device path (loopback networking between a real device and the CI runner doesn't exist the way it does for a co-located Simulator) — still blocked on the same Apple Developer Program provisioning named in the pdfium render spike's result.
- Ink-canvas stroke drawing (only text editing was exercised) — Simulator touch input has no pressure/tilt data regardless, so a meaningful stylus-input verification needs the same physical-device path.
- The diverged/blocked pull states — already covered by `git_mobile.rs`'s existing unit-test suite against local fixtures (`git-mobile-gix.md`), not re-verified live here; this plan only adds the live fast-forward case those unit tests can't reach (a real HTTP round trip).

If any task failed: record the exact failure and the CI run URL under the relevant bullet instead, and do not mark it resolved — per this whole plan set's established rule, a spike's failure is itself the deliverable, not something to route around inline.

- [ ] **Step 2: Commit**

```bash
git add docs/specs/mobile-app-design.md
git commit -m "docs(mobile): record the editor/sync round-trip verification result"
```

---

## Out of scope (this plan)

- **Ink-canvas stroke drawing and stylus/pressure input.** Simulator touch has no pressure or tilt data, so it can only prove basic touch-to-pointer-event plumbing, not the actual stylus-fidelity question the spec's "not a focus area... beyond verification" note is really about. That needs the physical-device path, already blocked on Apple Developer Program provisioning (`mobile-pdfium-render-spike.md`'s result note).
- **The diverged/blocked pull-outcome states.** Already covered by `git_mobile.rs`'s unit-test suite (`git-mobile-gix.md`) against local fixtures; this plan only adds the one case those tests structurally can't reach — a live fast-forward over a real HTTP transport.
- **Any change to `git_mobile.rs`, `git.rs`, or any frontend source.** Pure CI-workflow addition; if any step in this plan turns up a real bug, fixing it is a separate, follow-up change — not folded into this verification pass.
- **Reusing this local-HTTP-remote mechanism as an ongoing regression test.** This is a one-time verification pass closing two specific DoD bullets, in the same spirit as the pdfium spikes — not the start of a maintained mobile e2e suite, which the spec's own Testing section already rules out as YAGNI ("building one is out of scope here... until mobile ships and regresses").
- **Android.** Same footnote as every prior mobile plan.

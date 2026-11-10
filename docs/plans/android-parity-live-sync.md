# Android Parity: Live Sync Round Trip Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Prove on the Android emulator that a fresh install can clone a git-backed workspace over HTTP through the real onboarding form, that an edit made on the device reaches a second git client via "Sync now", and that a commit pushed from the host is pulled on the next workspace open.

**Architecture:** A throwaway smart-HTTP git remote runs on the Windows host (`git http-backend` behind Python's `http.server --cgi`, the same mechanism `ios-sync-verify.yml` uses on macOS). The emulator reaches the host's loopback at `10.0.2.2`. Debug builds already set `usesCleartextTraffic=true` (`src-tauri/gen/android/app/build.gradle.kts:29`), so no manifest change is needed. The app is driven through its WebView over a forwarded DevTools socket (`Runtime.evaluate`) for focusing/clicking, and through `adb shell input text` for the actual keystrokes. Every pass/fail is read off disk (`run-as` on the device, a plain `git clone` on the host), never inferred from a screenshot. This plan changes no production source; it is a verification pass.

**Tech Stack:** `git http-backend`, Python 3.13 `http.server --cgi`, `adb`, Node 24 (global `WebSocket`) for the CDP helper, PowerShell.

**Spec:** docs/specs/android-parity-design.md (Approach, step 4 — "Live sync round trip"). Executes the clone/edit/sync/pull DoD of `docs/plans/mobile-editor-sync-verification.md` against Android; that plan's Tasks 1–5 stay iOS-only and unrun.

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

- **Depends on `android-parity-credentials.md` Task 2 having passed** (token storage works on-device). If it has not run, run it first; onboarding's `setStoredGitToken` fails otherwise.
- **No real credential.** The fixture server enforces no auth. The token field gets the dummy value `dummy-token-for-android`.
- **Fixture binds `127.0.0.1` only**, never `0.0.0.0` (emulator's `10.0.2.2` maps to host loopback), and is stopped at the end.
- **No production source changes.** A bug found here is recorded as the result and fixed in a separate commit, not folded in.
- **Environment per session:** `ANDROID_HOME=C:\Users\<you>\AppData\Local\Android\Sdk`, `NDK_HOME`, `JAVA_HOME` as in the credentials plan; drive the device with `adb`, not the Android Studio UI.
- **Windows quirk (verified while writing this plan):** Python's CGI handler only execs `.exe` scripts when the URL names the extension. The remote URL is `/cgi-bin/git-http-backend.exe/fixture-remote.git`; without `.exe` the server answers 404 and git reports "repository not found". The `cgi-bin` directory is a junction to `git --exec-path`.

## Review Focus

- A note whose filename contains a space (`Lecture 7.md`) must clone, show, and survive an edit/sync (sidecar paths on Android routinely contain spaces).
- "Sync now" with the remote unreachable must surface an error or an "ahead" indicator, not crash or lose the commit; the next sync after the server returns must push it.
- A commit made on the device must carry a non-empty author name (`checked_commit` only sets a fallback identity in clone), so the host's `git log` is attributable.
- After `force-stop` and relaunch, the cloned workspace must appear under Recent (recents persistence on Android) and reopen with its notes intact.
- A pull of a host-side commit onto a clean checkout must fast-forward silently with the new content on disk, with no conflict banner.

---

### Task 1: Host fixture remote, proven with real git

**Files:**
- Create (outside the repo): `$env:TEMP\android-fixture\` (bare repo, junction, seed)
- Create (outside the repo): `$env:TEMP\android-fixture-up.ps1`

**Interfaces:**
- Produces: `http://127.0.0.1:8080/cgi-bin/git-http-backend.exe/fixture-remote.git` on the host, reachable from the emulator as `http://10.0.2.2:8080/cgi-bin/git-http-backend.exe/fixture-remote.git`; seeded with `note.md` ("# Fixture note") and `Lecture 7.md` ("# Lecture seven"). Helper scripts for later tasks: `android-fixture-up.ps1` (start server), `$env:TEMP\android-fixture.pid`.

- [ ] **Step 1: Write the startup script**

`$env:TEMP\android-fixture-up.ps1`:

```powershell
$root = Join-Path $env:TEMP 'android-fixture'
if (-not (Test-Path "$root\fixture-remote.git")) {
  New-Item -ItemType Directory $root | Out-Null
  git init --bare --initial-branch=main "$root\fixture-remote.git" | Out-Null
  git -C "$root\fixture-remote.git" config http.receivepack true
  $seed = Join-Path $env:TEMP 'android-fixture-seed'
  Remove-Item -Recurse -Force $seed -ErrorAction SilentlyContinue
  git init --initial-branch=main $seed | Out-Null
  git -C $seed config user.name seed
  git -C $seed config user.email seed@example.com
  Set-Content "$seed\note.md" '# Fixture note'
  Set-Content "$seed\Lecture 7.md" '# Lecture seven'
  git -C $seed add -A
  git -C $seed commit -m 'seed: fixture notes' | Out-Null
  git -C $seed push "$root\fixture-remote.git" main 2>&1 | Out-Null
  New-Item -ItemType Junction "$root\cgi-bin" -Target (git --exec-path) | Out-Null
}
$env:GIT_HTTP_EXPORT_ALL = '1'
$env:GIT_PROJECT_ROOT = $root
$p = Start-Process python -ArgumentList '-m','http.server','--cgi','--bind','127.0.0.1','8080' -WorkingDirectory $root -PassThru -WindowStyle Hidden
$p.Id | Set-Content (Join-Path $env:TEMP 'android-fixture.pid')
Start-Sleep -Seconds 2
```

- [ ] **Step 2: Start it and clone with plain git**

```powershell
& "$env:TEMP\android-fixture-up.ps1"
$url = 'http://127.0.0.1:8080/cgi-bin/git-http-backend.exe/fixture-remote.git'
$c = "$env:TEMP\android-fixture-check"
Remove-Item -Recurse -Force $c -ErrorAction SilentlyContinue
git clone $url $c
Get-ChildItem $c -Exclude .git | Select-Object -ExpandProperty Name
```

Expected: `Lecture 7.md` and `note.md` listed. (PowerShell prints git's stderr progress as a red `NativeCommandError`; ignore it, judge by the file listing.) If you see "repository not found", the URL is missing `.exe`.

- [ ] **Step 3: Prove push works over this transport with plain git**

```powershell
Add-Content "$c\note.md" 'host push check'
git -C $c -c user.name=host -c user.email=host@example.com commit -am 'host: push check'
git -C $c push origin main
git -C $c reset --hard HEAD~1
git -C $c push --force origin main
git -C $c log --oneline
```

Expected: first push succeeds; after the reset + force push, `git log` shows only the seed commit. This confirms `http.receivepack` is live and leaves the remote at the seed state for Task 2.

- [ ] **Step 4: Record, no commit**

Nothing in the repo changed. Note the pid file path for teardown (Task 5).

---

### Task 2: Clone through the real onboarding form

**Files:**
- Create (outside the repo): `$env:TEMP\cdp-eval.mjs`, `$env:TEMP\android-attach.ps1`

**Interfaces:**
- Consumes: Task 1's server; a debug x86_64 APK from the current branch.
- Produces: a cloned workspace in the app's private storage; PowerShell functions `Attach-Webview`, `Eval-Page <js>`, `Get-DeviceNote <relative-name>` defined in `android-attach.ps1` and dot-sourced by later tasks.

- [ ] **Step 1: Create the helpers**

`$env:TEMP\cdp-eval.mjs` (Node 22+):

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

`$env:TEMP\android-attach.ps1`:

```powershell
$env:ANDROID_HOME = "C:\Users\<you>\AppData\Local\Android\Sdk"
$adb = "$env:ANDROID_HOME\platform-tools\adb.exe"
function Attach-Webview {
  $procId = (& $adb shell pidof dev.nullnotes.app).Trim()
  & $adb forward tcp:9222 "localabstract:webview_devtools_remote_$procId" | Out-Null
  $script:ws = (Invoke-RestMethod http://127.0.0.1:9222/json)[0].webSocketDebuggerUrl
}
function Eval-Page($js) { node "$env:TEMP\cdp-eval.mjs" $script:ws $js }
function Get-DeviceNote($name) {
  $path = (& $adb shell "run-as dev.nullnotes.app find . -name '$name' -not -path '*/.git/*'").Trim()
  if (-not $path) { return $null }
  & $adb shell "run-as dev.nullnotes.app cat '$path'"
}
```

- [ ] **Step 2: Boot the AVD if needed, build, install clean, launch**

```powershell
. "$env:TEMP\android-attach.ps1"
& $adb devices
```

If no device is listed: `Start-Process "$env:ANDROID_HOME\emulator\emulator.exe" -ArgumentList '-avd','Pixel_3a_API_34_extension_level_7_x86_64'`, then `& $adb wait-for-device` and poll `& $adb shell getprop sys.boot_completed` until it prints `1`.

```powershell
$env:NDK_HOME = "$env:ANDROID_HOME\ndk\29.0.14206865"
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-25.0.1.8-hotspot"
npx tauri android build --debug --target x86_64
& $adb uninstall dev.nullnotes.app
$apk = (Get-ChildItem -Recurse "src-tauri\gen\android\app\build\outputs\apk" -Filter "*x86_64*debug*.apk" | Select-Object -First 1).FullName
& $adb install $apk
& $adb logcat -c
& $adb shell monkey -p dev.nullnotes.app -c android.intent.category.LAUNCHER 1
Start-Sleep -Seconds 10
Attach-Webview
Eval-Page "document.querySelector('.workspace-picker-onboarding') !== null"
```

Expected: `Success` from install and `{"type":"boolean","value":true}` — the mobile onboarding form is rendered. If `false`, screenshot (`& $adb exec-out screencap -p > $env:TEMP\a.png`) and read it before going on.

- [ ] **Step 3: Type the URL and token with real key input**

Focus is set through the page; characters go through Android's input pipeline:

```powershell
Eval-Page "document.querySelectorAll('.workspace-picker-field input')[0].focus()"
& $adb shell input text 'http://10.0.2.2:8080/cgi-bin/git-http-backend.exe/fixture-remote.git'
Eval-Page "document.querySelectorAll('.workspace-picker-field input')[1].focus()"
& $adb shell input text 'dummy-token-for-android'
Eval-Page "[...document.querySelectorAll('.workspace-picker-field input')].map(i => i.value)"
```

Expected: both values echoed back exactly, URL first. If the URL is truncated or mangled, `input text` choked on a character: retype it in two `input text` calls split at `cgi-bin`.

- [ ] **Step 4: Submit and wait**

```powershell
Eval-Page "document.querySelector('.workspace-picker-onboarding button[type=submit]').click()"
Start-Sleep -Seconds 10
& $adb exec-out screencap -p > "$env:TEMP\clone-done.png"
& $adb logcat -d | Select-String -Pattern "FATAL|panicked"
```

Read `clone-done.png`: expected the workspace open with `note.md` and `Lecture 7` in the sidebar/dashboard, no toast. The logcat grep must print nothing. If the form is still showing with a toast, read the toast text — a `Connection refused`/cleartext error means the server is down or the build is not a debug build.

- [ ] **Step 5: Read the files off the device**

```powershell
Get-DeviceNote 'note.md'
Get-DeviceNote 'Lecture 7.md'
```

Expected: `# Fixture note` and `# Lecture seven`. This (Review Focus 1, clone half) is the DoD evidence for "clone and show notes"; the screenshot is only supporting.

- [ ] **Step 6: Record the result in this plan**

Fill the **Result** line under this task with what happened (pass/fail, any workaround such as the `input text` split). Do not commit yet; Task 5 commits all results together.

**Result:** PASS (on the third build; the first two builds exposed the bugs under Task 3). Clone through the onboarding form wrote `note.md` and `Lecture 7.md` (space in the name) with the right content, logcat clean. Workarounds, none an app issue: build with JDK 21 (`JAVA_HOME=...\jdk-21`; Gradle 8.14.3 cannot configure `buildSrc` on JDK 25); the AVD sometimes loses its system services after a Gradle build, so cold-boot it (`-no-snapshot-load`) before installing; `input text` is dropped unless the page holds real focus, so tap the first field with `adb shell input tap` (the DevTools `.focus()` alone is not enough). Facts that differ from the plan: the workspace lives in app-specific external storage (`/sdcard/Android/data/dev.nullnotes.app/files/Documents/<repo>`), readable with plain `adb shell`, not `run-as`; `Get-DeviceNote` was changed to match. `adb exec-out screencap -p > file` corrupts the PNG under Windows PowerShell; use `screencap` to `/sdcard` plus `adb pull`.

---

### Task 3: Edit on the device, sync, read it on the host

**Interfaces:**
- Consumes: Task 2's cloned workspace and helpers.
- Produces: a second commit on the fixture remote authored by the device.

- [ ] **Step 1: Open the note and type into the editor**

```powershell
. "$env:TEMP\android-attach.ps1"; Attach-Webview
Eval-Page "[...document.querySelectorAll('*')].find(e => e.textContent.trim() === 'note' && e.children.length === 0)?.click()"
Start-Sleep -Seconds 2
Eval-Page "document.querySelector('.ProseMirror').focus()"
& $adb shell input keyevent KEYCODE_MOVE_END
& $adb shell input text 'edited%son%sandroid'
Start-Sleep -Seconds 2
```

`%s` is `input text`'s space. If the first line opens the wrong thing (the file row has a different label), take a screenshot, tap the note's row from it with `& $adb shell input tap <x> <y>`, and continue from the `.ProseMirror` line. The save debounce is 600 ms (`SAVE_DEBOUNCE_MS`), hence the 2 s sleep.

- [ ] **Step 2: Confirm the edit is on disk before syncing**

```powershell
Get-DeviceNote 'note.md'
```

Expected: contains `edited on android`. If not, the keystrokes went elsewhere; screenshot and redo Step 1 — do not sync an unedited file.

- [ ] **Step 3: Sync now**

```powershell
Eval-Page "document.querySelector('.git-sync-now').click()"
Start-Sleep -Seconds 8
& $adb exec-out screencap -p > "$env:TEMP\after-sync.png"
```

Expected: no toast or an "up to date" status in `after-sync.png`. If `.git-sync-now` is null, `repoMode` was not detected for this workspace — read `Eval-Page "document.querySelector('.tab-bar')?.innerText"` and the screenshot, and record it as a failure (the button is gated on `repoMode`, `TabBar.tsx:98`).

- [ ] **Step 4: Read the push from the host with plain git**

```powershell
$url = 'http://127.0.0.1:8080/cgi-bin/git-http-backend.exe/fixture-remote.git'
$v = "$env:TEMP\android-fixture-verify"
Remove-Item -Recurse -Force $v -ErrorAction SilentlyContinue
git clone $url $v
Get-Content "$v\note.md"
git -C $v log --format='%an | %s'
```

Expected: `note.md` contains `edited on android`; the newest log line has a non-empty author name (Review Focus 3). An empty or `null` author is a finding: record it, do not fix here.

- [ ] **Step 5: Record the result**

**Result:** PASS after two production fixes (each its own commit, TDD, not folded into this record). The first run FAILED twice over:
- `2d96bf6` — `checked_clone_repo` set the remote and the fallback committer identity in memory only, so a reopened clone had no `[remote "origin"]` and no `user.name` in `.git/config`. Sync now reported "Commit failed: Author identity is not configured" and nothing could push. Review Focus 3 failed as feared; it is now fixed and the device's commits carry `null-notes <noreply@nullnotes.app>`.
- `46bfe4c` — `checked_push` never advanced `refs/remotes/origin/<branch>` after a successful push, so the next push sent a stale old value and the remote answered `ng refs/heads/main incorrect old value provided`. Sync now (commit-push then direct push) therefore showed "Push failed" even though the first push landed, and every later push before a fetch would be rejected.

With both fixes: the edit (`edited on android`) reached the host remote as `null-notes | notes: update note`, no failure chip.

**Open finding, not fixed:** on the first edit after a fresh clone the editor shows "This note changed on disk while you were editing it" (Keep mine / Reload theirs) with no external edit. It did not recur on later edits or syncs in the same session. This breaks the save-path rule that the watcher's report of our own write must not raise a conflict; likely the clone's checkout writes being reported by the watcher. Needs its own issue.

---

### Task 4: Pull a host commit, and the offline-sync failure path

**Interfaces:**
- Consumes: `$env:TEMP\android-fixture-verify` (the Task 3 host clone, used as "desktop"), the helpers, a running fixture server.

- [ ] **Step 1: Push a host-side edit (fast-forward case)**

```powershell
$v = "$env:TEMP\android-fixture-verify"
Add-Content "$v\note.md" 'and edited on desktop'
git -C $v -c user.name=desktop -c user.email=desktop@example.com commit -am 'desktop: further edit'
git -C $v push origin main
```

- [ ] **Step 2: Relaunch and reopen from Recent**

```powershell
. "$env:TEMP\android-attach.ps1"
& $adb shell am force-stop dev.nullnotes.app
& $adb shell monkey -p dev.nullnotes.app -c android.intent.category.LAUNCHER 1
Start-Sleep -Seconds 10
Attach-Webview
Eval-Page "[...document.querySelectorAll('.workspace-picker-recents button')].map(b => b.innerText)"
```

Expected: a list containing the `fixture-remote` entry (Review Focus 4). An empty list means recents did not persist across process death — record it.

```powershell
Eval-Page "document.querySelector('.workspace-picker-recents button').click()"
Start-Sleep -Seconds 8
Get-DeviceNote 'note.md'
Get-DeviceNote 'Lecture 7.md'
```

Expected: `note.md` contains both `edited on android` and `and edited on desktop`; `Lecture 7.md` unchanged (Review Focus 5). A conflict/diverged banner here is a finding: `Eval-Page "document.body.innerText.includes('diverged')"`.

- [ ] **Step 3: Sync with the server down (Review Focus 2)**

Edit the note on the device (as Task 3 Step 1, typing `offline%sedit`), then stop the server and sync:

```powershell
Stop-Process -Id (Get-Content "$env:TEMP\android-fixture.pid") -Force
Eval-Page "document.querySelector('.git-sync-now').click()"
Start-Sleep -Seconds 8
& $adb exec-out screencap -p > "$env:TEMP\offline-sync.png"
& $adb logcat -d | Select-String -Pattern "FATAL|panicked"
Get-DeviceNote 'note.md'
```

Expected: the app is still running (logcat grep empty), a visible error or "ahead" state in the screenshot, and the offline edit still in `note.md`.

- [ ] **Step 4: Bring the server back and confirm the retry pushes**

```powershell
& "$env:TEMP\android-fixture-up.ps1"
Eval-Page "document.querySelector('.git-sync-now').click()"
Start-Sleep -Seconds 8
$v2 = "$env:TEMP\android-fixture-verify2"
Remove-Item -Recurse -Force $v2 -ErrorAction SilentlyContinue
git clone 'http://127.0.0.1:8080/cgi-bin/git-http-backend.exe/fixture-remote.git' $v2
Get-Content "$v2\note.md"
```

Expected: `offline edit` present in the fresh host clone — the commit made while offline was not lost and pushed on the next sync.

- [ ] **Step 5: Record the result**

**Result:** PASS. Recents survived `force-stop` (`fixture-remote` listed, reopen worked, Review Focus 4). The host's `desktop: further edit` fast-forwarded onto the clean checkout silently on reopen: `note.md` held both edits, `Lecture 7.md` unchanged, no diverged/conflict banner (Review Focus 5). Sync with the server killed: app stayed alive, logcat had no `FATAL`/`panicked`, the offline edit stayed on disk, and the chip read "Push failed ... (An IO error occurred when talking to the server)" with the "commit is safe locally" tooltip (Review Focus 2). After restarting the server one Sync now pushed it: `offline edit` is in a fresh host clone, newest commit `null-notes | notes: update note`. Note: the first offline attempt's keystrokes missed the editor after the relaunch (page not focused), so no commit was made; it was redone after tapping into the editor, and only that second run counts.

---

### Task 5: Tear down and record

**Files:**
- Modify: `docs/plans/android-parity-live-sync.md` (the three **Result** lines)
- Modify: `docs/specs/android-parity-design.md` only if a finding changes a later step (otherwise untouched; the iOS delta section is written at the end of the pass)

- [ ] **Step 1: Stop the server and remove forwards**

```powershell
Stop-Process -Id (Get-Content "$env:TEMP\android-fixture.pid") -Force -ErrorAction SilentlyContinue
. "$env:TEMP\android-attach.ps1"
& $adb forward --remove tcp:9222
```

- [ ] **Step 2: Fill in the Result lines, listing for the iOS delta**

Record per task: pass/fail, anything that needed a workaround, and these facts for the spec's final "iOS delta" section: the clone/push/pull path proves `git_mobile` over HTTP on Android's `reqwest`/`rustls` stack only (iOS has the same crate but not the same network stack or ATS policy); the `.exe` URL quirk is a Windows-host fixture detail, not an app issue.

**For the spec's iOS delta:** this proves clone/push/pull of `git_mobile` over plain HTTP on Android's `reqwest`/`rustls` stack only; iOS shares the crate but not the network stack or ATS policy. Both fixes (`2d96bf6`, `46bfe4c`) are in shared `git_mobile.rs`, so they apply to iOS too, and the pre-fix behaviour (no origin/identity on disk, stale tracking ref) was never iOS-specific. The `.exe` URL is a Windows-host fixture detail, not an app issue.

- [ ] **Step 3: Commit**

```bash
cd /d/Coding/Apps/null-notes
git add docs/plans/android-parity-live-sync.md
git commit -m "docs(mobile): record Android live sync round-trip result

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Out of scope (this plan)

- Real stylus/ink input and the shell/feature-cut checks (plan 5), pdfium (plan 6).
- Diverged and blocked pull states (covered by `git_mobile.rs` unit tests).
- Authenticated remotes and a real GitHub round trip; no real credential is used.
- Making the fixture a maintained regression suite — one-time verification, like the iOS spikes.
- Any iOS or CI run.

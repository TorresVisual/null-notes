# Android Parity: Shell, Feature Cuts, Ink Input and Flashcards on a Real WebView Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Prove on the Android emulator, in the real WebView, that the mobile shell reflow, the three feature cuts (Run, Open in IDE, terminal), pen-versus-finger ink input, and a flashcard review session all behave as the iOS-era plans claimed — until now they have only been checked through jsdom and Playwright against a Tauri stub.

**Architecture:** Everything runs against a debug x86_64 build on the `Pixel_3a_API_34_extension_level_7_x86_64` AVD, with the notes cloned through the real onboarding form from the host fixture remote built in `android-parity-live-sync.md`. The app is observed through a forwarded DevTools socket (`Runtime.evaluate`, read-only DOM facts) and driven with real Android input (`adb shell input tap|swipe|keyevent|text`, including the `stylus` source for pen events), so the touch/pen/keyboard paths are the ones a user would hit. Pass/fail is read off the DOM or the device's files, never a screenshot alone. A small calibration step maps CSS pixels to device pixels so taps land on elements by selector. This plan changes no production source: a bug found is recorded as the result and fixed in its own commit, as in the live-sync plan.

**Tech Stack:** `adb`, Node 24 (global `WebSocket`) CDP helper already in `$env:TEMP`, PowerShell, the existing fixture remote (`git http-backend` behind `python -m http.server --cgi`).

**Spec:** docs/specs/android-parity-design.md (Approach, step 5 — "Shell and feature cuts in a real WebView"). Verifies the on-device half of `docs/plans/mobile-app-shell-reflow.md` and `docs/plans/mobile-feature-cuts.md` (both checked only in jsdom / Playwright-with-stub), plus ink touch/pen input (`src/ink/InkCanvas.tsx`, `src/ink/useInkCanvas.ts:132`) and the flashcard review flow.

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

- **Depends on `android-parity-credentials.md` Task 2 and `android-parity-live-sync.md` Tasks 1–2 having passed** (token storage works; the fixture remote and the onboarding clone path work). If the fixture is missing, run `$env:TEMP\android-fixture-up.ps1` from that plan's Task 1 first.
- **No production source changes.** A bug found here is recorded in that task's **Result** and fixed in a separate commit (TDD), or filed with `/file-issue` if it is not a small fix. Do not fold fixes into the results commit.
- **Pressure fidelity stays open** (spec, "Not in scope"): the emulator injects synthetic pressure. Record what it reports; do not claim real-stylus parity.
- **Environment per session:** `ANDROID_HOME=C:\Users\<you>\AppData\Local\Android\Sdk`; build with **JDK 21** (`JAVA_HOME=C:\Program Files\Eclipse Adoptium\jdk-21*`; Gradle 8.14.3 cannot configure `buildSrc` on JDK 25), `NDK_HOME=$env:ANDROID_HOME\ndk\29.0.14206865`. Drive the device with `adb`, not the Android Studio UI.
- **Facts learned in the live-sync run, reused here:** the cloned workspace is `/sdcard/Android/data/dev.nullnotes.app/files/Documents/fixture-remote` (plain `adb shell`, not `run-as`); `adb shell input text` is dropped unless the page holds real focus, so `adb shell input tap` the field first (DevTools `.focus()` alone is not enough); `screencap -p` must go to `/sdcard` and be `adb pull`ed (piping corrupts the PNG under Windows PowerShell); the AVD sometimes loses system services after a Gradle build — cold-boot it with `-no-snapshot-load` if install or `monkey` hangs.
- **Fixture binds `127.0.0.1` only** and is stopped at the end. No real credential: the token is `dummy-token-for-android`.
- **JS passed to `Eval-Page` uses single quotes only** (it travels as a Windows command-line argument inside a PowerShell double-quoted string).

## Review Focus

- `env(safe-area-inset-*)` is probably `0` on Android: `index.html` has `<meta name="viewport" content="width=device-width, initial-scale=1.0" />` with no `viewport-fit=cover`, and the drawer's `padding-bottom: max(12px, env(safe-area-inset-bottom))` and the bottom rail bar rely on it. Expectation: the bottom rail bar (Home … Settings) is fully tappable and not under the system navigation bar.
- Soft keyboard up in the editor: the line being typed must stay visible above the keyboard (the manifest sets no `windowSoftInputMode`).
- System Back (`KEYCODE_BACK`) with the sidebar drawer open: a user expects the drawer to close, not the app to exit; nothing in `src/` handles Back, so this likely exits — record it.
- `matchMedia('(hover: none)')` must be true in the Android WebView, or the 44px touch targets and the always-visible tree rename/delete icons (all gated on it, `src/index.css`) silently do not apply.
- A finger swipe on the ink canvas must pan the page and leave **no** stroke in the saved SVG; a stylus swipe must draw one. `isDrawingPointer` accepts only `pen` and `mouse` (`useInkCanvas.ts:132`) — if the emulator's stylus source arrives as `touch`, the pen path cannot be driven by `adb` and needs the CDP fallback in Task 4.

---

### Task 1: Build, seed the fixture remote, clone, and build the input helpers

**Files:**
- Create (outside the repo): `$env:TEMP\android-ui.ps1`

**Interfaces:**
- Consumes: `$env:TEMP\android-attach.ps1` (`$adb`, `Attach-Webview`, `Eval-Page <js>`, `$wsDir`, `Get-DeviceNote <name>`), `$env:TEMP\cdp-eval.mjs`, `$env:TEMP\android-fixture-up.ps1`, `$env:TEMP\android-fixture-verify` (a host clone of the fixture), all from the live-sync plan.
- Produces, in `android-ui.ps1` (dot-sourced by every later task): `Eval-Json <js>` → the value of the evaluated expression; `Calibrate-Webview` (sets `$script:ox`, `$script:oy`, `$script:dpr`); `Get-Box <jsExpr>` → `{x,y,w,h}` in CSS px (element centre and size) or `$null`; `Tap-El <jsExpr>`; `Swipe-El <jsExpr> <dxCss> <dyCss> [source] [ms]`; `Shot <name>` → `$env:TEMP\<name>.png`. Seeded notes on the remote and device: `Cards.md`, `Code.md`, `Draw.md`.

- [ ] **Step 1: Write the helper file**

`$env:TEMP\android-ui.ps1`:

```powershell
. "$env:TEMP\android-attach.ps1"

function Eval-Json($js) { (Eval-Page $js | ConvertFrom-Json).value }

# Maps CSS px -> device px. Taps a full-page probe at a known device point and
# reads back where the page saw it, so any status-bar / inset offset is absorbed.
function Calibrate-Webview {
  Eval-Page "(() => { window.__probe = null; const d = document.createElement('div'); d.id = '__probe'; d.style.cssText = 'position:fixed;inset:0;z-index:2147483647'; d.addEventListener('pointerdown', e => { window.__probe = { x: e.clientX, y: e.clientY } }); document.body.appendChild(d) })()" | Out-Null
  & $adb shell input tap 200 400
  Start-Sleep -Milliseconds 600
  $p = Eval-Json "JSON.stringify({ x: window.__probe.x, y: window.__probe.y, dpr: devicePixelRatio })" | ConvertFrom-Json
  Eval-Page "document.getElementById('__probe').remove()" | Out-Null
  $script:dpr = $p.dpr
  $script:ox = 200 - $p.x * $p.dpr
  $script:oy = 400 - $p.y * $p.dpr
  "dpr=$($script:dpr) origin=($($script:ox),$($script:oy))"
}

function Get-Box($jsExpr) {
  $j = Eval-Json "(() => { const el = $jsExpr; if (!el) return 'null'; const b = el.getBoundingClientRect(); return JSON.stringify({ x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height }) })()"
  if ($j -eq 'null') { return $null }
  $j | ConvertFrom-Json
}

function Tap-El($jsExpr) {
  $b = Get-Box $jsExpr
  if (-not $b) { throw "Tap-El: no element for $jsExpr" }
  & $adb shell input tap ([int]($script:ox + $b.x * $script:dpr)) ([int]($script:oy + $b.y * $script:dpr))
}

function Swipe-El($jsExpr, $dxCss, $dyCss, $source = 'touchscreen', $ms = 400) {
  $b = Get-Box $jsExpr
  if (-not $b) { throw "Swipe-El: no element for $jsExpr" }
  $x1 = [int]($script:ox + $b.x * $script:dpr); $y1 = [int]($script:oy + $b.y * $script:dpr)
  $x2 = [int]($x1 + $dxCss * $script:dpr);       $y2 = [int]($y1 + $dyCss * $script:dpr)
  & $adb shell input $source swipe $x1 $y1 $x2 $y2 $ms
}

function Shot($name) {
  & $adb shell screencap -p "/sdcard/$name.png"
  & $adb pull "/sdcard/$name.png" "$env:TEMP\$name.png" | Out-Null
  "$env:TEMP\$name.png"
}
```

- [ ] **Step 2: Seed three notes on the fixture remote**

```powershell
& "$env:TEMP\android-fixture-up.ps1"
$v = "$env:TEMP\android-fixture-verify"
Remove-Item -Recurse -Force $v -ErrorAction SilentlyContinue
git clone 'http://127.0.0.1:8080/cgi-bin/git-http-backend.exe/fixture-remote.git' $v
$u = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText("$v\Cards.md", @'
# Cards

What is Big-O of binary search? :: O(log n)

A binary search tree keeps {{all left descendants smaller}} than the node.
'@, $u)
[IO.File]::WriteAllText("$v\Code.md", @'
# Code

```python
print("hello")
```

```
// src/main.rs
fn main() {}
```

```
hello
```
'@, $u)
[IO.File]::WriteAllText("$v\Draw.md", "# Drawing`n", $u)
git -C $v add -A
git -C $v -c user.name=seed -c user.email=seed@example.com commit -m 'seed: shell verification notes'
git -C $v push origin main
```

Expected: push succeeds. `Cards.md` is two cards (one Q::A, one cloze); `Code.md` has a runnable `python` block, a source-path block (Open-in-IDE candidate) and a language-less block shaped like pinned output; `Draw.md` is empty for the ink task.

- [ ] **Step 3: Boot, build, install clean, launch**

```powershell
. "$env:TEMP\android-ui.ps1"
& $adb devices
```

If no device is listed: `Start-Process "$env:ANDROID_HOME\emulator\emulator.exe" -ArgumentList '-avd','Pixel_3a_API_34_extension_level_7_x86_64','-no-snapshot-load'`, then `& $adb wait-for-device` and poll `& $adb shell getprop sys.boot_completed` until `1`.

```powershell
$env:NDK_HOME = "$env:ANDROID_HOME\ndk\29.0.14206865"
$env:JAVA_HOME = (Get-ChildItem 'C:\Program Files\Eclipse Adoptium' -Directory -Filter 'jdk-21*' | Select-Object -First 1).FullName
npx tauri android build --debug --target x86_64
& $adb uninstall dev.nullnotes.app
$apk = (Get-ChildItem -Recurse "src-tauri\gen\android\app\build\outputs\apk" -Filter "*x86_64*debug*.apk" | Select-Object -First 1).FullName
& $adb install $apk
& $adb logcat -c
& $adb shell monkey -p dev.nullnotes.app -c android.intent.category.LAUNCHER 1
Start-Sleep -Seconds 10
Attach-Webview
Eval-Json "document.querySelector('.workspace-picker-onboarding') !== null"
```

Expected: `Success`, then `True`. If `False`, `Shot onboarding-fail` and read the PNG before going on.

- [ ] **Step 4: Clone through the onboarding form**

```powershell
Calibrate-Webview
Tap-El "document.querySelectorAll('.workspace-picker-field input')[0]"
& $adb shell input text 'http://10.0.2.2:8080/cgi-bin/git-http-backend.exe/fixture-remote.git'
Tap-El "document.querySelectorAll('.workspace-picker-field input')[1]"
& $adb shell input text 'dummy-token-for-android'
Eval-Json "JSON.stringify([...document.querySelectorAll('.workspace-picker-field input')].map(i => i.value))"
Tap-El "document.querySelector('.workspace-picker-onboarding button[type=submit]')"
Start-Sleep -Seconds 10
Get-DeviceNote 'Cards.md'
```

Expected: both field values echoed exactly, then `Cards.md` text printed (the clone landed). If `Calibrate-Webview` printed a `dpr` of `0`/empty, the probe tap missed the page — rerun it. If a field value is mangled, split the URL into two `input text` calls at `cgi-bin`.

- [ ] **Step 5: Record the environment facts every later task reasons from**

```powershell
Attach-Webview; Calibrate-Webview
Eval-Json "JSON.stringify({ hoverNone: matchMedia('(hover: none)').matches, pointerCoarse: matchMedia('(pointer: coarse)').matches, w: innerWidth, h: innerHeight, dpr: devicePixelRatio, platform: navigator.userAgent.includes('Android') })"
& $adb shell wm size
```

Expected: `hoverNone: true` (Review Focus 4 — if `false`, record it now; Task 2 Steps 4–5 will then fail for the same root cause and should be reported as one finding, not several). Note `wm size` for Task 2 Step 6.

- [ ] **Step 6: Record the result under this task**

Add a **Result:** line here (pass/fail, `hoverNone`, window size, any workaround). Do not commit yet; Task 6 commits all results together.

**Result (2026-10-21):** PASS. Fixture seeded (`cba5eb8`), debug build installed clean, onboarding clone through the real form landed `Cards.md`/`Code.md`. `hoverNone: true`, `pointerCoarse: false`, window 393×808 css px at dpr 2.75 (`wm size` 1080×2220). The WebView is edge-to-edge: its 808 css px span the whole screen, so the status bar (0–66 px) and navigation bar (2154–2220 px) overlay page content. Workarounds: the build emits `app-universal-debug.apk` (the plan's `*x86_64*` filter matches nothing); the typed-into field needs `KEYCODE_BACK` before tapping the next one (the IME covers it and the tap hits a key); the host CDP helper was fixed (exit 0 after the reply, `Eval-Json` reads `.result.value`) and `Tap-El` aims below the status bar.

---

### Task 2: Mobile shell on the device

**Interfaces:**
- Consumes: Task 1's cloned workspace and `android-ui.ps1`.
- Produces: pass/fail facts for the **Result** line; no code.

- [ ] **Step 1: Titlebar has the hamburger and no window chrome**

```powershell
. "$env:TEMP\android-ui.ps1"; Attach-Webview; Calibrate-Webview
Eval-Json "JSON.stringify({ toggle: !!document.querySelector('[aria-label=\"Toggle sidebar\"]'), min: !!document.querySelector('[aria-label=Minimize]'), max: !!document.querySelector('[aria-label=Maximize]'), close: !!document.querySelector('.titlebar-btn-close'), titlebarH: document.querySelector('.titlebar').getBoundingClientRect().height })"
```

Expected: `toggle: true`, `min/max/close: false`, `titlebarH: 44`.

- [ ] **Step 2: Drawer starts closed, opens on tap, closes on backdrop**

```powershell
$drawer = "document.querySelector('.sidebar--drawer')"
Eval-Json "JSON.stringify({ rightEdge: $drawer.getBoundingClientRect().right, open: $drawer.classList.contains('sidebar--open'), backdrop: !!document.querySelector('.sidebar-backdrop') })"
Tap-El "document.querySelector('.titlebar-menu-toggle')"
Start-Sleep -Milliseconds 600
Eval-Json "JSON.stringify({ left: $drawer.getBoundingClientRect().left, width: $drawer.getBoundingClientRect().width, vw: innerWidth, open: $drawer.classList.contains('sidebar--open'), backdrop: !!document.querySelector('.sidebar-backdrop') })"
Shot 'drawer-open' | Out-Null
```

Expected: closed → `rightEdge <= 0`, `open: false`, `backdrop: false`; open → `left >= 0`, `width <= 320` and `<= 0.85 * vw`, `open: true`, `backdrop: true`. Read `drawer-open.png`: the drawer sits below the titlebar, no horizontal overflow.

```powershell
Tap-El "document.querySelector('.sidebar-backdrop')"
Start-Sleep -Milliseconds 600
Eval-Json "document.querySelector('.sidebar--drawer').classList.contains('sidebar--open')"
```

Expected: `False`. (The backdrop is full-screen at `z-index: 90`; the tap lands at its centre, which is outside the 320px drawer on a ~393px-wide screen. If the window is narrower than ~640 css px the centre is *inside* the drawer — tap `x = innerWidth - 10` instead.)

- [ ] **Step 3: Tapping a note closes the drawer and opens the note; bottom bar has no Terminal**

```powershell
Tap-El "document.querySelector('.titlebar-menu-toggle')"
Start-Sleep -Milliseconds 600
Eval-Json "JSON.stringify([...document.querySelectorAll('.sidebar-rail--bar .rail-btn')].map(b => b.getAttribute('aria-label')))"
Tap-El "[...document.querySelectorAll('.tree-note .tree-label')].find(e => e.textContent === 'note')"
Start-Sleep -Seconds 2
Eval-Json "JSON.stringify({ drawerOpen: document.querySelector('.sidebar--drawer').classList.contains('sidebar--open'), editor: !!document.querySelector('.ProseMirror') })"
```

Expected: the bar lists `Home, Search, Tasks, Graph view, Review, Generate formula sheet, Settings` and **no** `Terminal`; then `drawerOpen: false`, `editor: true`. If the tree label differs (`note` vs `note.md`), print `[...document.querySelectorAll('.tree-label')].map(e => e.textContent)` and adjust the find.

- [ ] **Step 4: Touch-target sizes (Review Focus 4 consequences)**

```powershell
Tap-El "document.querySelector('.titlebar-menu-toggle')"; Start-Sleep -Milliseconds 600
Eval-Json "JSON.stringify({ rail: (() => { const b = document.querySelector('.sidebar-rail--bar .rail-btn').getBoundingClientRect(); return [b.width, b.height] })(), titlebarBtn: (() => { const b = document.querySelector('.titlebar-menu-toggle').getBoundingClientRect(); return [b.width, b.height] })(), treeRow: document.querySelector('.tree-row').getBoundingClientRect().height, treeActions: [...document.querySelectorAll('.tree-row .tree-rename, .tree-row .tree-delete')].map(e => getComputedStyle(e).opacity) })"
```

Expected: `rail` and `titlebarBtn` both `>= 44` in each dimension; every `treeActions` value `1`. Anything under 44 on a primary control, or an opacity `0`, is a finding.

- [ ] **Step 5: Bottom bar clears the system navigation bar (Review Focus 1)**

```powershell
Eval-Json "(() => { const p = document.createElement('div'); p.style.cssText = 'padding-bottom: env(safe-area-inset-bottom); padding-top: env(safe-area-inset-top)'; document.body.appendChild(p); const r = JSON.stringify({ insetBottom: getComputedStyle(p).paddingBottom, insetTop: getComputedStyle(p).paddingTop, barBottomCssPx: document.querySelector('.sidebar-rail--bar').getBoundingClientRect().bottom, innerHeight: innerHeight }); p.remove(); return r })()"
& $adb shell wm size
Tap-El "document.querySelector('.sidebar-rail--bar .rail-btn:last-child')"
Start-Sleep -Seconds 1
Eval-Json "!!document.querySelector('.settings-panel')"
Shot 'bar-bottom' | Out-Null
```

Expected: `insetBottom`/`insetTop` print `0px` (confirms the viewport meta gap) **and** the last bar button (Settings) is tappable — `.settings-panel` opens. Compute `oy + barBottomCssPx * dpr` against the `wm size` height: if the bar's bottom edge is below the visible screen height or the Settings tap does nothing, the bar is under the system bar → finding (fix would be `viewport-fit=cover` plus the existing `env()` padding, or Android-side inset handling; do not decide here). Read `bar-bottom.png`.

Close Settings (tap `.settings-panel-close`) before moving on.

- [ ] **Step 6: System Back with the drawer open (Review Focus 3)**

```powershell
Tap-El "document.querySelector('.titlebar-menu-toggle')"; Start-Sleep -Milliseconds 600
& $adb shell input keyevent KEYCODE_BACK
Start-Sleep -Seconds 2
(& $adb shell pidof dev.nullnotes.app)
& $adb shell dumpsys activity activities | Select-String -Pattern "mResumedActivity"
```

Expected by a user: the app still running with the drawer closed. Record what actually happens (process gone / backgrounded / drawer closed). If the app exited, relaunch with `monkey`, `Attach-Webview`, `Calibrate-Webview` before the next task; the workspace reopens from Recent.

- [ ] **Step 7: Soft keyboard does not hide the typing line (Review Focus 2)**

```powershell
& $adb shell settings put secure show_ime_with_hard_keyboard 1
Tap-El "document.querySelector('.ProseMirror')"
for ($i = 0; $i -lt 30; $i++) { & $adb shell input keyevent KEYCODE_ENTER }
& $adb shell input text 'caret%sline'
Start-Sleep -Seconds 1
& $adb shell dumpsys input_method | Select-String -Pattern "mInputShown"
Eval-Json "(() => { const r = getSelection().getRangeAt(0).getBoundingClientRect(); return JSON.stringify({ caretBottom: r.bottom, visibleBottom: visualViewport.height + visualViewport.offsetTop, innerHeight }) })()"
Shot 'keyboard' | Out-Null
```

Expected: `mInputShown=true` (if `false`, the AVD is hiding the IME; set `hw.keyboard=no` in the AVD config or enable the on-screen keyboard in Settings, then redo) and `caretBottom <= visibleBottom`. If the caret is below `visibleBottom`, or `visibleBottom == innerHeight` while the keyboard covers the lower screen in `keyboard.png`, the page is not resized for the keyboard → finding.

This leaves the note edited on the device; it is local-only and never synced, so no cleanup is needed beyond Task 6's uninstall/teardown.

- [ ] **Step 8: Record the result**

Add a **Result:** line: pass/fail per step 1–7, the exact numbers for `insetBottom`, sizes, Back behaviour and the keyboard check. Each failure is either fixed in its own commit or filed (`/file-issue`); name which.

**Result (2026-10-21):** Steps 1–3 PASS (hamburger present, no min/max/close, titlebar 44; drawer closed at `right: 0`, opens to `left: 0`, 320 px wide, backdrop closes it when tapped at the right edge since the centre is inside the drawer; tapping a note closes the drawer and mounts the editor; bar is `Home, Search, Tasks, Graph view, Review, Generate formula sheet, Settings`, no Terminal). Step 4 PARTIAL: tree rename/delete icons all `opacity: 1`, titlebar button 44×43.3, but rail buttons are 40×44 (width under 44) and tree rows are 28.8 px high. Step 5 PASS: `insetBottom`/`insetTop` both `0px`, bar bottom edge 2156 px against nav bar top 2154 px, Settings opens. Step 6 FAIL as predicted: Back with the drawer open exits the app (process gone, no resumed activity). Step 7 FAIL: `mInputShown=true`, `visualViewport.height == innerHeight == 808`, so the page is not resized; the caret (803 css px) is hidden behind a keyboard whose top is ~508 css px (`keyboard.png`). New findings, none fixed here, to file: (a) the titlebar is drawn under the status bar, so the hamburger's centre (y≈59 px < 66) is not tappable — only its lower part is; (b) `.home-section` overflows the viewport by 9 css px (right edge 402 vs 393); (c) rail button width 40 and tree-row height 28.8 under 44; (d) Back exits the app; (e) soft keyboard covers the caret. Probable shared root cause for (a) and the status-bar/nav-bar overlay: the WebView is edge-to-edge with no inset handling (`viewport-fit=cover` absent, `env()` is 0).

---

### Task 3: Feature cuts on the device

**Interfaces:**
- Consumes: Task 1's `Code.md` and helpers.

- [ ] **Step 1: Open Code.md and confirm Run / Open in IDE are absent**

```powershell
. "$env:TEMP\android-ui.ps1"; Attach-Webview; Calibrate-Webview
Tap-El "document.querySelector('.titlebar-menu-toggle')"; Start-Sleep -Milliseconds 600
Tap-El "[...document.querySelectorAll('.tree-note .tree-label')].find(e => e.textContent === 'Code')"
Start-Sleep -Seconds 3
Eval-Json "JSON.stringify({ blocks: document.querySelectorAll('.ProseMirror pre').length, run: !!document.querySelector('.code-run-run'), panel: !!document.querySelector('.code-run-panel'), ide: !!document.querySelector('.code-block-open-in-ide'), ideGroup: !!document.querySelector('.code-block-open-in-ide-group'), texts: [...document.querySelectorAll('.ProseMirror pre')].map(p => p.textContent.trim()) })"
Shot 'code-cuts' | Out-Null
```

Expected: `blocks: 3`, `run/panel/ide/ideGroup` all `false`, and `texts` shows all three blocks' content including the `hello` block (pinned-output shape stays visible, per `mobile-feature-cuts.md`). Read `code-cuts.png`: no dead button, no error state.

- [ ] **Step 2: Terminal has no entry point and a keyboard shortcut does nothing**

```powershell
Tap-El "[...document.querySelectorAll('.titlebar-menu-trigger')].find(e => e.textContent === 'View')"
Start-Sleep -Milliseconds 500
Eval-Json "JSON.stringify([...document.querySelectorAll('[role=menuitem]')].map(e => e.textContent))"
& $adb shell input keyevent KEYCODE_ESCAPE
& $adb shell input keycombination KEYCODE_CTRL_LEFT KEYCODE_GRAVE
Start-Sleep -Seconds 2
Eval-Json "JSON.stringify({ pane: !!document.querySelector('.terminal-pane'), starting: document.body.innerText.includes('Starting shell') })"
& $adb logcat -d | Select-String -Pattern "FATAL|panicked"
```

Expected: the View menu lists items but **not** `Toggle Terminal`; then `pane: false`, `starting: false`, logcat grep empty. (If `input keycombination` is rejected — it needs API 33+, and this AVD is API 34 — dispatch the keydown from the page instead: `Eval-Page "window.dispatchEvent(new KeyboardEvent('keydown', { key: String.fromCharCode(96), ctrlKey: true, bubbles: true }))"`, and record that the real-keyboard path was not exercised.)

- [ ] **Step 3: Record the result**

Add a **Result:** line: pass/fail per step, and the observed View menu item list.

**Result (2026-10-21):** PASS, both steps. `Code.md` renders 3 blocks (`print("hello")`, the two-line `// src/main.rs` block, `hello`); `.code-run-run`, `.code-run-panel`, `.code-block-open-in-ide` and its group are all absent, and `code-cuts.png` shows only Copy/Wrap on each block. View menu: `Home, Search, Quick Switcher, Toggle Source/Preview, Insert Ink Block, Connections Graph, Toggle Outline, Toggle Sidebar, Tasks, Review, Browse All Cards, Keyboard Shortcuts` — no `Toggle Terminal`. A real `Ctrl+`` via `input keycombination` opened no terminal pane and logged no new crash. Cosmetic: the menu still shows `Ctrl+…` hints on a touch device.

---

### Task 4: Ink input — finger pans, pen draws

**Interfaces:**
- Consumes: Task 1's `Draw.md` and helpers.
- Produces: a saved sketch under `<ws>/Draw.ink/` and the observed pointer types and pressure values.

- [ ] **Step 1: Learn what pointer type each adb input source produces**

```powershell
. "$env:TEMP\android-ui.ps1"; Attach-Webview; Calibrate-Webview
Eval-Page "(() => { window.__types = []; window.addEventListener('pointerdown', e => window.__types.push(e.pointerType + ':' + e.pressure), true) })()" | Out-Null
& $adb shell input touchscreen tap 200 400
& $adb shell input stylus tap 200 400
& $adb shell input mouse tap 200 400
Start-Sleep -Seconds 1
Eval-Json "JSON.stringify(window.__types)"
```

Expected: three entries, `touch:…`, `pen:…`, `mouse:…`. **If the stylus entry says `touch`, Steps 3–4 cannot be driven by `adb`: skip them and use the CDP fallback in Step 5 instead.** Record all three pressure values (Review Focus 5 and the spec's open pressure question).

- [ ] **Step 2: Open Draw.md and insert an ink canvas through the real toolbar**

```powershell
Tap-El "document.querySelector('.titlebar-menu-toggle')"; Start-Sleep -Milliseconds 600
Tap-El "[...document.querySelectorAll('.tree-note .tree-label')].find(e => e.textContent === 'Draw')"
Start-Sleep -Seconds 3
Tap-El "document.querySelector('.ProseMirror')"
Tap-El "[...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Insert ink canvas')"
Start-Sleep -Seconds 2
Eval-Json "JSON.stringify({ overlay: !!document.querySelector('.ink-editor-overlay'), canvas: !!document.querySelector('.ink-editor-body canvas.ink-canvas'), done: !!document.querySelector('.ink-editor-done') })"
Shot 'ink-open' | Out-Null
```

Expected: all three `true` (a new drawing opens straight into the editor overlay). If the toolbar button is absent on the narrow screen, type the slash command instead (`/Ink`, then `KEYCODE_ENTER`) and record that the toolbar button is missing on mobile.

- [ ] **Step 3: A finger swipe pans and leaves no stroke**

```powershell
$body = "document.querySelector('.ink-editor-body')"
$before = Eval-Json "JSON.stringify({ l: $body.scrollLeft, t: $body.scrollTop })"
Swipe-El "document.querySelector('.ink-editor-body canvas.ink-canvas')" -120 -200 'touchscreen' 500
Start-Sleep -Seconds 2
$after = Eval-Json "JSON.stringify({ l: $body.scrollLeft, t: $body.scrollTop })"
$before; $after
(& $adb shell "cat $wsDir/Draw.ink/*.svg") | Select-String -Pattern '<path data-id' -AllMatches | ForEach-Object { $_.Matches.Count }
```

Expected: `$after` differs from `$before` (the page panned), and the final command prints nothing (zero `<path data-id` in the saved SVG — a finger never draws).

- [ ] **Step 4: A stylus swipe draws one stroke, and the pressure is recorded**

```powershell
Swipe-El "document.querySelector('.ink-editor-body canvas.ink-canvas')" 80 60 'stylus' 500
Start-Sleep -Seconds 3
$svg = (& $adb shell "cat $wsDir/Draw.ink/*.svg") -join "`n"
([regex]::Matches($svg, '<path data-id')).Count
$raw = [regex]::Match($svg, 'data-points="([^"]+)"').Groups[1].Value
$pts = [uri]::UnescapeDataString($raw) | ConvertFrom-Json
"points=$($pts.Count) pressures=$((($pts | ForEach-Object { $_.pressure } | Sort-Object -Unique) -join ','))"
```

Expected: `1` path, `points` greater than 1, and a `pressures` list of finite numbers. Record the actual set (a single constant such as `1` or `0.5` is the expected emulator behaviour; it says nothing about real stylus fidelity). If the count is `0`, check Step 1: the stylus either arrived as `touch` or the stroke was dropped — that is the finding.

Tap `.ink-editor-done`, wait 2 s, then:

```powershell
Eval-Json "JSON.stringify({ overlayGone: !document.querySelector('.ink-editor-overlay'), preview: !!document.querySelector('.ink-preview') })"
Get-DeviceNote 'Draw.md'
```

Expected: `overlayGone: true`, `preview: true`, and `Draw.md` containing a relative image link to `Draw.ink/sketch-….svg`.

- [ ] **Step 5 (only if Step 1 showed stylus as `touch`): CDP pen fallback**

`$env:TEMP\cdp-pen.mjs` — drives Blink's own pen path, so it proves `useInkCanvas`, not Android's input stack:

```js
const [, , wsUrl, x1, y1, x2, y2] = process.argv
const sock = new WebSocket(wsUrl)
let id = 0
const send = (params) =>
  sock.send(JSON.stringify({ id: ++id, method: 'Input.dispatchMouseEvent', params: { pointerType: 'pen', button: 'left', buttons: 1, ...params } }))
sock.onopen = () => {
  send({ type: 'mousePressed', x: +x1, y: +y1, clickCount: 1, force: 0.5 })
  for (let i = 1; i <= 10; i++)
    send({ type: 'mouseMoved', x: +x1 + ((+x2 - +x1) * i) / 10, y: +y1 + ((+y2 - +y1) * i) / 10, force: 0.5 })
  send({ type: 'mouseReleased', x: +x2, y: +y2, clickCount: 1, force: 0.5, buttons: 0 })
  setTimeout(() => sock.close(), 500)
}
```

Run `node "$env:TEMP\cdp-pen.mjs" $script:ws 150 300 230 360` (CSS px inside the canvas), then repeat Step 4's file checks. Record plainly that the adb stylus path was **not** exercised.

- [ ] **Step 6: Record the result**

Add a **Result:** line: the three pointer types and pressures from Step 1, pan yes/no, stroke count after finger and after pen, the pressure set, and whether the fallback was used.

**Result (2026-10-21):** PASS. `adb input touchscreen|stylus|mouse` arrive as `touch:1`, `pen:1`, `mouse:1`, so the pen path is driven by real Android input and the CDP fallback (Step 5) was not needed. The Insert-ink-canvas toolbar button exists on mobile and opens the editor overlay. A finger swipe panned the ink body (scroll 0,0 → 113,191) and saved nothing (0 elements). A stylus swipe saved exactly one element, but a `<line data-kind="line">`, not a path: the default Fine pen straightens a near-straight stroke (`straighten.ts`), so the plan's `<path data-id` count would read 0 for a straight `input stylus swipe`; a curved stroke sent as `input stylus motionevent DOWN/MOVE×14/UP` saved one `<path>` with 15 points. Pressure set across all points: `{1}`, constant — the emulator's synthetic value, nothing about real stylus fidelity (the pointerdown pressure was 1 for touch, pen and mouse alike). Done closed the overlay, `.ink-preview` rendered, and `Draw.md` holds `![Drawing](Draw.ink/sketch-….svg#ink=700x900)`. The ink canvas is 700×900 css px on a 393 px-wide screen, so it is wider than the viewport (usable by panning).

---

### Task 5: Flashcards on the device

**Interfaces:**
- Consumes: Task 1's `Cards.md` (two due cards) and helpers.

- [ ] **Step 1: Open the review session from the drawer bar**

```powershell
. "$env:TEMP\android-ui.ps1"; Attach-Webview; Calibrate-Webview
Tap-El "document.querySelector('.titlebar-menu-toggle')"; Start-Sleep -Milliseconds 600
Tap-El "document.querySelector('.sidebar-rail--bar [aria-label=Review]')"
Start-Sleep -Seconds 3
Eval-Json "JSON.stringify({ session: !!document.querySelector('.review-session'), front: document.querySelector('.review-card-front')?.textContent ?? null, drawerOpen: document.querySelector('.sidebar--drawer').classList.contains('sidebar--open') })"
Shot 'review-front' | Out-Null
```

Expected: `session: true`, a non-empty `front`, `drawerOpen: false` (the bar action closed the drawer). The first card is whichever of the two sorts first; note which. Read `review-front.png`: the card fits the screen, the grade buttons are reachable without scrolling the page.

- [ ] **Step 2: Reveal and grade both cards with taps**

```powershell
foreach ($n in 1..2) {
  Tap-El "document.querySelector('.review-card-reveal')"
  Start-Sleep -Seconds 1
  Eval-Json "document.querySelector('.review-card-back')?.textContent ?? null"
  Tap-El "[...document.querySelectorAll('.review-card-grade')].find(b => b.textContent.trim() === 'Good')"
  Start-Sleep -Seconds 2
}
Eval-Json "JSON.stringify({ front: document.querySelector('.review-card-front')?.textContent ?? null, empty: document.querySelector('.review-session .empty-state')?.textContent ?? null })"
(Get-DeviceNote 'Cards.md') -join "`n"
```

Expected: each reveal prints that card's answer (`O(log n)`; the cloze's hidden text), after both grades `front` is `null` and `empty` is a nothing-due message, and `Cards.md` now contains two `<!-- sr due=…-->` lines, each directly under its card. If the cloze reveal shows no hidden text, or only one schedule line is written, record it.

- [ ] **Step 3: Grading persists across process death and raises no false conflict**

```powershell
Tap-El "document.querySelector('.review-session .settings-panel-close')"
Eval-Json "document.body.innerText.includes('changed on disk')"
& $adb shell am force-stop dev.nullnotes.app
& $adb shell monkey -p dev.nullnotes.app -c android.intent.category.LAUNCHER 1
Start-Sleep -Seconds 10
Attach-Webview; Calibrate-Webview
Tap-El "document.querySelector('.workspace-picker-recents button')"
Start-Sleep -Seconds 8
Tap-El "document.querySelector('.titlebar-menu-toggle')"; Start-Sleep -Milliseconds 600
Tap-El "document.querySelector('.sidebar-rail--bar [aria-label=Review]')"
Start-Sleep -Seconds 3
Eval-Json "JSON.stringify({ front: document.querySelector('.review-card-front')?.textContent ?? null, empty: document.querySelector('.review-session .empty-state')?.textContent ?? null })"
```

Expected: the `changed on disk` check prints `False` (the app's own write is not reported back as an external edit); after relaunch and reopen from Recent the session shows the nothing-due state again (the index was rebuilt from disk and the schedule lines survived).

- [ ] **Step 4: Record the result**

Add a **Result:** line: which card came first, both reveal texts, the schedule lines found on disk, and the nothing-due check before and after relaunch.

**Result (2026-10-21):** PASS on the flashcard flow, FAIL on the "no false conflict" expectation. The Review dialog opens from the drawer bar ("Review (2 due)", drawer closed, card and Reveal fit the screen). The Q::A card came first (`What is Big-O of binary search?` → `O(log n)`), then the cloze (`A binary search tree keeps [...] than the node.` → `…keeps all left descendants smaller than the node.`). Both graded Good with taps; `Cards.md` then carries two `<!-- sr due=2026-10-22 ease=2.50 interval=1 reps=1 grade=good streak=1 lapses=0 -->` lines, each directly under its card; the session shows `All done for today.`, and after `am force-stop`, relaunch and reopening from Recent it still does. Selector fixes against the plan: the reveal button is `.review-card-reveal` only while a card is unrevealed (the first Tap-El raced a re-render once). **Finding (f): false conflict on Android.** With `Drawing` open and edited in-app (typed `xyz`, then `abc`), `This note changed on disk while you were editing it.` (`ConflictBar`) appears within 2 s although the disk holds exactly the buffer (`# Drawing||xyzabc`), reproduced three times and again at the first Review run; with a clean note open, grading raises no bar and neither does a fresh open. Suspected cause, not yet verified: `useNote.ts` sets `lastWritten.current` only after `await api.notes.save(…)` returns, so a watcher echo that lands first compares against the old value while the buffer has already moved on (`pendingWrite`/`saveTimer` set) and takes the conflict branch. Not fixed here; to file.

---

### Task 6: Tear down and record

**Files:**
- Modify: `docs/plans/android-parity-shell-verification.md` (the five **Result** lines)
- Modify: `docs/specs/android-parity-design.md` only if a finding changes a later step (otherwise untouched; the "iOS delta" section is written once, after plan 6)

- [ ] **Step 1: Stop the fixture and remove forwards**

```powershell
Stop-Process -Id (Get-Content "$env:TEMP\android-fixture.pid") -Force -ErrorAction SilentlyContinue
. "$env:TEMP\android-attach.ps1"
& $adb forward --remove tcp:9222
& $adb shell settings put secure show_ime_with_hard_keyboard 0
```

- [ ] **Step 2: Fill in the Result lines and list what Android cannot prove for iOS**

Per task: pass/fail, workarounds, and which findings were fixed (commit) or filed (issue number). Then add this block, adjusted to what was actually observed, for the spec's final "iOS delta" section:

**For the spec's iOS delta:** this proves the shell, feature cuts, ink pointer routing and flashcard flow in Android's WebView (Chromium) only. WKWebView differs on exactly the points this plan probed: `env(safe-area-inset-*)` behaviour with and without `viewport-fit=cover`, `(hover: none)` evaluation, soft-keyboard resizing (iOS does not resize the layout viewport), the pointer type Apple Pencil reports and its pressure range, and there is no system Back — so Review Focus 3 does not transfer. Real stylus pressure and palm rejection are unverified on both platforms.

**Result (2026-10-21):** Fixture stopped (port 8080 down), `tcp:9222` forward removed, `show_ime_with_hard_keyboard` back to `0`. No production source changed in this run and nothing was fixed; the findings below are filed as #114 (6, false conflict), #115 (1), #116 (2), #117 (3), #118 (4), #119 (5). Android-observed, none yet an issue: (1) titlebar and content run under the status and navigation bars (insets are `0px`, no `viewport-fit=cover`), so the hamburger's centre is untappable (Task 2); (2) System Back with the drawer open exits the app — and on this emulator the exit ends in a native `SIGABRT` (`pthread_mutex_lock` on a destroyed mutex in `libEGL_emulation` during `eglDestroyContext`), likely emulator-specific; (3) the soft keyboard covers the caret, the page is not resized (`visualViewport.height == innerHeight`); (4) rail buttons 40 px wide and tree rows 28.8 px high, under the 44 px target; (5) `.home-section` overflows by 9 css px; (6) false `ConflictBar` after a plain in-app edit (Task 5, suspected `lastWritten` ordering in `useNote.ts`). Environment facts for next plans: the debug build outputs `app-universal-debug.apk`; labels in the drawer tree are note titles (`Drawing`, not `Draw`); a stylus straight swipe becomes a `<line>`, so draw a curve with `input stylus motionevent` for a `<path>`; `pointerCoarse` is `false` in this WebView even though `hover: none` is `true`.

- [ ] **Step 3: Commit**

```bash
cd /d/Coding/Apps/null-notes
git add docs/plans/android-parity-shell-verification.md
git commit -m "docs(mobile): record Android shell, feature-cut, ink and flashcard verification

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Out of scope (this plan)

- pdfium text extraction and rendering on Android (plan 6); the "iOS delta" section itself (written after plan 6).
- A physical device, real stylus pressure, palm rejection, and landscape/rotation behaviour.
- A Back-button handler, `viewport-fit=cover`, or keyboard-resize fix: this plan only finds and records; fixes are separate commits.
- Per-dialog content layout (Settings, Task view, Graph) beyond the dialog shell, and `TabBar` overflow with many tabs — both already deferred in `mobile-app-shell-reflow.md`.
- Making any of this a maintained regression suite: one-time verification, like the iOS spikes.
- Any iOS or CI run.

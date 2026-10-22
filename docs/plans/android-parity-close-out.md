# Android Parity: Close-Out Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Meet the one unmet finish-line bullet of the Android parity pass (token credentials verified on the device) and fix the one shared-code bug the spec says must be fixed before the iOS run (#114), then update the spec so its Status and iOS delta are true.

**Architecture:** Three tasks. Task 1 is verification only — it runs the already-written device steps from `android-parity-credentials.md` Task 2 and records the missing Result. Task 2 is a TDD fix in `useNote.ts`. Task 3 edits the spec. No new harness, no new dependency.

**Tech Stack:** `adb`, Chrome DevTools Protocol over a forwarded WebView socket (Task 1); React hook + Vitest (Task 2).

**Spec:** docs/specs/android-parity-design.md (Status; "Open from the Android pass"). Plans 1–6 are done (`mobile-android-scaffold.md`, `android-parity-shared-mobile-git.md`, `-credentials.md`, `-live-sync.md`, `-shell-verification.md`, `-pdfium.md`); this plan covers only what they left open.

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

- Finish line from the spec: "token credentials" among "full P16 parity on the Android emulator". Not in scope: a physical device, real stylus pressure, the iOS CI work.
- **No iOS build or CI run** (macOS minutes bill 10x).
- The token never enters the workspace folder (CLAUDE.md storage boundary).
- If the Keystore store turns out unusable, **stop and report**; the encrypted-file fallback needs the user's sign-off (credentials plan, Global Constraints).
- No `any`, no new comments unless the WHY is non-obvious, named exports, small diffs.
- Run `npm run typecheck` and `npm test` before committing frontend changes.
- Do not push. Stage only the files each task names; the tree may hold unrelated edits.
- PowerShell does not persist env vars between calls; set `ANDROID_HOME`, `NDK_HOME`, `JAVA_HOME` inline. Use **JDK 21**, not 25 (Gradle 8.14.3 cannot configure `buildSrc` on 25; live-sync plan Task 2 Result).
- Findings #115–#119 are deliberately **not** fixed here: they are Android shell polish, filed, and the spec only requires them filed.

## Review Focus

1. **Echo of an in-flight save read as a conflict (#114).** Typing past a save whose write has not resolved when the watcher fires must not raise the bar. Pinned by Task 2 test 1.
2. **Two overlapping saves.** Save A and B both in flight; the watcher reads A's content while the buffer holds a third version. Not a conflict. Pinned by Task 2 test 2.
3. **A real external edit must still prompt.** The fix must not widen the echo match to "anything". Already pinned by the existing `prompts instead of clobbering when the buffer is dirty`; Task 2 keeps it green.
4. **Stale bar.** After the disk again equals the buffer, the bar clears and `Reload theirs` cannot restore old text. Pinned by Task 2 test 3.
5. **Keystore token readable at rest, or lost on restart, or read-before-write erroring.** Pinned by Task 1 Steps 3, 5, 6.

---

### Task 1: Run the credentials device checks and record the Result

**Files:**
- Modify: `docs/plans/android-parity-credentials.md` (add a **Result:** line under Task 2)
- Create (outside the repo): `$env:TEMP\cdp-eval.mjs`

**Interfaces:**
- Consumes: commits `8bdaf8a` (Keystore store) and `6137bb6` (ndk-context init, so Task 2 Step 7 of the credentials plan was in fact needed). A bootable AVD `Pixel_3a_API_34_extension_level_7_x86_64`.
- Produces: a PASS/FAIL Result for the credentials plan that Task 3 cites.

- [ ] **Step 1: Build, clean-install, launch**

```powershell
$env:ANDROID_HOME = "C:\Users\Moritz\AppData\Local\Android\Sdk"
$env:NDK_HOME = "$env:ANDROID_HOME\ndk\29.0.14206865"
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-21"
npx tauri android build --debug --target x86_64
$adb = "$env:ANDROID_HOME\platform-tools\adb.exe"
& $adb devices
& $adb uninstall dev.nullnotes.app
$apk = (Get-ChildItem -Recurse "src-tauri\gen\android\app\build\outputs\apk" -Filter "*x86_64*debug*.apk" | Select-Object -First 1).FullName
& $adb install $apk
& $adb logcat -c
& $adb shell monkey -p dev.nullnotes.app -c android.intent.category.LAUNCHER 1
Start-Sleep -Seconds 10
```

Expected: `adb devices` shows one `device`; install prints `Success`. If the AVD has lost its system services after the Gradle build, cold-boot it with `-no-snapshot-load` and reinstall (known from the live-sync Result). Confirm the merged manifest has `allowBackup="false"`:

```powershell
Select-String -Path (Get-ChildItem -Recurse src-tauri\gen\android\app\build\intermediates\merged_manifests -Filter AndroidManifest.xml | Select-Object -First 1).FullName -Pattern allowBackup
```

- [ ] **Step 2: Create the eval helper and attach**

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

```powershell
$procId = (& $adb shell pidof dev.nullnotes.app).Trim()
& $adb forward tcp:9222 "localabstract:webview_devtools_remote_$procId"
$ws = (Invoke-RestMethod http://127.0.0.1:9222/json)[0].webSocketDebuggerUrl
function Invoke-Tauri($cmd, $args_ = '{}') {
  node "$env:TEMP\cdp-eval.mjs" $ws "window.__TAURI_INTERNALS__.invoke('$cmd', $args_)"
}
```

The output shape is `{"result":{"value":...}}` — read `.result.value` (a defect found in the pdfium plan).

- [ ] **Step 3: Read before write, write, overwrite**

```powershell
Invoke-Tauri get_git_token
Invoke-Tauri set_git_token '{ token: "ghp_parity_AAAA" }'
Invoke-Tauri get_git_token
Invoke-Tauri set_git_token '{ token: "ghp_parity_BBBB" }'
Invoke-Tauri get_git_token
```

Expected `result.value` in order: `""` (fresh install, not an error), `null`, `"ghp_parity_AAAA"`, `null`, `"ghp_parity_BBBB"`. Then `& $adb logcat -d | Select-String -Pattern "FATAL|panicked|keyring"` must show no `FATAL`/`panicked`.

- [ ] **Step 4: Survive process death**

```powershell
& $adb shell am force-stop dev.nullnotes.app
& $adb shell monkey -p dev.nullnotes.app -c android.intent.category.LAUNCHER 1
Start-Sleep -Seconds 10
$procId = (& $adb shell pidof dev.nullnotes.app).Trim()
& $adb forward tcp:9222 "localabstract:webview_devtools_remote_$procId"
$ws = (Invoke-RestMethod http://127.0.0.1:9222/json)[0].webSocketDebuggerUrl
Invoke-Tauri get_git_token
```

Expected: `"ghp_parity_BBBB"`.

- [ ] **Step 5: Not readable at rest**

```powershell
& $adb shell run-as dev.nullnotes.app find . -path "*shared_prefs*" -type f
& $adb shell run-as dev.nullnotes.app grep -rl "ghp_parity" .
```

Expected: the first lists at least one file under `shared_prefs/`; the second prints nothing. Any hit is a FAIL: stop and report.

- [ ] **Step 6: Real onboarding path**

On the no-workspace screen choose "Clone workspace…", enter `https://example.invalid/notes.git` and token `ghp_parity_CCCC`, submit. Capture with `screencap` to `/sdcard` plus `adb pull` (piping `exec-out screencap` corrupts the PNG under Windows PowerShell), and read the image:

```powershell
& $adb shell screencap -p /sdcard/clone-with-token.png
& $adb pull /sdcard/clone-with-token.png $env:TEMP\clone-with-token.png
& $adb logcat -d | Select-String -Pattern "FATAL|panicked"
Invoke-Tauri get_git_token
```

Expected: a network error for `example.invalid`, not a credential error, no crash; the last call returns `"ghp_parity_CCCC"` (reattach `$ws` if the page reloaded).

- [ ] **Step 7: Record the Result and commit**

Add under Task 2 of `docs/plans/android-parity-credentials.md`, before "Out of scope", a line in this form with the real values:

```markdown
**Result:** PASS|FAIL (date). Step 3 read-back: `""`, then `AAAA`, then `BBBB`. Step 5 (after force-stop): `BBBB`. At-rest: `shared_prefs/<file>` present, grep for the token matched nothing. Onboarding: <error text seen>, token read back `CCCC`. `allowBackup="false"` present in the merged manifest. Ndk-context init was required (commit `6137bb6`). Not exercised: backup/restore onto another device.
```

```bash
cd /d/Coding/Apps/null-notes
git add docs/plans/android-parity-credentials.md
git commit -m "docs(mobile): record Android Keystore credentials device result

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

If any step FAILED, record FAIL with the output and stop; do not continue to Task 3.

---

### Task 2: Fix the false conflict bar after an in-app edit (#114)

**Files:**
- Modify: `src/hooks/useNote.ts:37`, `:53`, `:93-99`, `:153`, `:181`
- Test: `src/hooks/useNote.test.ts` (after `does not prompt when the watcher reports our own earlier write`, line 218)

**Interfaces:**
- Consumes: existing `useNote(path)` return shape (`save`, `conflict`, `content`, `reloadTheirs`, …) — unchanged.
- Produces: no API change. Internally `lastWritten: Ref<string | null>` becomes `recentWrites: Ref<string[]>`, holding the contents of the last `RECENT_WRITES` saves **including ones still in flight**.

Root cause: `lastWritten` is set only after `await api.notes.save(...)` resolves, so an echo that arrives while the write is in flight (or while a second write is) matches neither the buffer nor `lastWritten`. Fix once at the recording site; the only reader is the watcher handler. A failed save needs no un-recording: the disk then does not hold that content, so an echo of it cannot occur, and if someone else wrote identical bytes there is nothing to conflict with.

- [ ] **Step 1: Write the three failing tests**

Insert after line 218 of `src/hooks/useNote.test.ts`:

```ts
  it('does not prompt when the watcher echoes a save that has not resolved yet', async () => {
    const { result } = await mountNote()
    let finishSave: () => void = () => {}
    notes.save.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finishSave = resolve)),
    )

    act(() => result.current.save('# Note\nfirst'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PAST_SAVE)
    })
    act(() => result.current.save('# Note\nfirst and more'))
    notes.open.mockResolvedValue('# Note\nfirst')
    await act(async () => {
      await emitWorkspaceChanged({ payload: ['/ws/note.md'] })
    })

    expect(result.current.conflict).toBe(false)
    await act(async () => finishSave())
  })

  it('does not prompt when two saves are in flight and the watcher reads the older one', async () => {
    const { result } = await mountNote()
    const finish: Array<() => void> = []
    notes.save.mockImplementation(
      () => new Promise<void>((resolve) => finish.push(resolve)),
    )

    act(() => result.current.save('# Note\none'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PAST_SAVE)
    })
    act(() => result.current.save('# Note\ntwo'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PAST_SAVE)
    })
    act(() => result.current.save('# Note\nthree'))
    notes.open.mockResolvedValue('# Note\none')
    await act(async () => {
      await emitWorkspaceChanged({ payload: ['/ws/note.md'] })
    })

    expect(result.current.conflict).toBe(false)
    await act(async () => finish.forEach((f) => f()))
  })

  it('clears the prompt once the disk again matches the buffer', async () => {
    const { result } = await mountNote()

    act(() => result.current.save('# Note\nmine'))
    notes.open.mockResolvedValue('# Note\ntheirs')
    await act(async () => {
      await emitWorkspaceChanged({ payload: ['/ws/note.md'] })
    })
    expect(result.current.conflict).toBe(true)

    notes.open.mockResolvedValue('# Note\nmine')
    await act(async () => {
      await emitWorkspaceChanged({ payload: ['/ws/note.md'] })
    })

    expect(result.current.conflict).toBe(false)
  })
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run src/hooks/useNote.test.ts`
Expected: the three new tests FAIL (`conflict` is `true`); all pre-existing tests pass.

- [ ] **Step 3: Implement**

In `src/hooks/useNote.ts`:

Add a module constant next to the other debounce constants:

```ts
const RECENT_WRITES = 4
```

Line 37 — replace

```ts
  const lastWritten = useRef<string | null>(null)
```

with

```ts
  const recentWrites = useRef<string[]>([])
```

Line 53 — replace `lastWritten.current = null` with `recentWrites.current = []`.

In `flushSave`, record **before** the await and delete the post-await assignment (line 99):

```ts
    pendingWrite.current = null
    setSaveState('saving')
    recentWrites.current = [...recentWrites.current.slice(1 - RECENT_WRITES), job.content]
    try {
      await api.notes.save(job.workspace, job.path, job.content)
      useWorkspaceStore.getState().addGitPendingPath(job.path)
```

In the watcher handler replace the echo check (lines 150–153) with:

```ts
      // Our own save echoes back through the watcher, possibly while the write
      // is still in flight. If the disk holds the buffer or anything we just
      // wrote, nobody else touched it — and any earlier prompt is stale.
      if (fresh === contentRef.current || recentWrites.current.includes(fresh)) {
        incoming.current = null
        setConflict(false)
        return
      }
```

In `reloadTheirs` replace `lastWritten.current = fresh` with `recentWrites.current = [fresh]`.

- [ ] **Step 4: Run tests, typecheck**

Run: `npx vitest run src/hooks/useNote.test.ts; npm run typecheck`
Expected: all `useNote` tests PASS including the existing `prompts instead of clobbering when the buffer is dirty` and `keeping mine writes the local buffer over the external change`; typecheck clean.

- [ ] **Step 5: Full suite and commit**

```bash
cd /d/Coding/Apps/null-notes
npm test
git add src/hooks/useNote.ts src/hooks/useNote.test.ts
git commit -m "fix(editor): don't read the echo of an in-flight save as an external edit

Fixes #114

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Expected: `npm test` all green. (If the commit hook rejects `Fixes #114` wording, drop it; do not close the issue before the Android re-check in Task 3 Step 1.)

---

### Task 3: Make the spec true

**Files:**
- Modify: `docs/specs/android-parity-design.md` (Status paragraph, line 9; iOS delta "Not provable" first bullet and "Open from the Android pass" paragraph)

**Interfaces:**
- Consumes: Task 1's Result, Task 2's commit hash.
- Produces: a spec whose Status matches reality.

- [ ] **Step 1: Re-check #114 on the device (optional but cheap)**

With the Task 1 build refreshed (`npx tauri android build --debug --target x86_64`, reinstall), open a note on the emulator, type for ~5 s with the default autosave delay, and confirm no "changed on disk" bar. The bug reproduced 3 of 3 times before. Record the outcome; if it still appears, reopen #114 with the logcat/DOM evidence instead of editing the spec.

- [ ] **Step 2: Edit the spec**

- **Status** (line 9): if Task 1 PASSED, replace the whole paragraph with `**Status:** met on 2026-10-22. Every finish-line bullet has a PASS Result in a plan; the Keystore Result is in \`android-parity-credentials.md\`.` (use the real date). If it FAILED, state that and stop.
- **iOS delta, first "Not provable" bullet:** replace "and the Keystore store itself has no recorded device Result (see Status), so token store/read-back is unverified on both platforms" with "Android's Keystore store round-trips a token and holds it ciphertext-only at rest (credentials plan Result); that is evidence for the keyring-core path, not for Keychain."
- **Open from the Android pass:** strike #114 (`fixed in <hash>`, and "verified on the emulator" only if Step 1 confirmed it); leave #115–#119 and #120 as written.

- [ ] **Step 3: Commit**

```bash
cd /d/Coding/Apps/null-notes
git add docs/specs/android-parity-design.md
git commit -m "docs(mobile): Android parity pass meets its finish line

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Report the three commit hashes. Then close #114 with `gh issue close 114 --comment "Fixed in <hash>"` only if Step 1 confirmed it on the device; otherwise leave it open.

---

## Out of scope (this plan)

- #115–#119 (shell polish) and the physical-device checks; both stay filed.
- The iOS CI run and the `releases/latest` → `chromium/7763` workflow pin (iOS delta lists it for that run).
- A desktop-discriminating test for the `BIND_LOCK` race (#120); the spec already records that it cannot be made to discriminate on desktop.

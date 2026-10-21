# Android Parity: pdfium Text Extraction and Page Rendering Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Prove on the Android emulator that the existing PDF pipeline works — `pdf_has_text_layer`, `import_pdf_markdown` (text extraction) and `import_pdf_pages` (page rendering) — by bundling a real `libpdfium.so`, then confirm the arm64 device ABI builds with it, and close the pass by writing the spec's "iOS delta" section.

**Architecture:** `bind_pdfium()` (`src-tauri/src/pdf/renderer.rs`) already ends in `Pdfium::bind_to_system_library()`, i.e. `dlopen("libpdfium.so")`. On Android a library shipped in `jniLibs/<abi>/` is placed on the app's linker search path, so — unlike iOS, where `bundle.resources` landed under `assets/` and needed a fallback — no `renderer.rs` change is expected. The spec predicted a path fallback; this plan tests that prediction first and adds one (Task 2, conditional, TDD) only if `dlopen` by bare name fails. `gen/android/app/.gitignore` already ignores `src/main/jniLibs/**/*.so`, so the binary is fetched by a script (like `scripts/download-pdfium.ps1` on Windows), never committed. There is no file picker to drive from `adb`, so the PDF is pushed into the app's external files dir and the Tauri commands are invoked through the forwarded DevTools socket — the same commands the import UI calls.

**Tech Stack:** `bblanchon/pdfium-binaries` (`pdfium-android-x64`, `pdfium-android-arm64`), PowerShell, `adb`, the existing `$env:TEMP\android-attach.ps1` + `cdp-eval.mjs` helpers, NDK `llvm-readelf`, `npx tauri android build`.

**Spec:** docs/specs/android-parity-design.md (Approach, step 6 — "pdfium for Android"; Deliverable for iOS — the "iOS delta" section written in Task 5).

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

- **Depends on** `android-parity-shell-verification.md` having run (its `$env:TEMP\android-attach.ps1`, `cdp-eval.mjs`, and a debug build installable on the AVD). If those helpers are gone, recreate them from that plan's Task 1.
- **No binary blobs in git.** `libpdfium.so` lives only under the already-ignored `jniLibs/**/*.so`; only the fetch script is committed. Confirm with `git status` before every commit.
- **The `pdf/` pipeline is frozen** (`src-tauri/src/pdf/CLAUDE.md`). Only `bind_pdfium()`'s library lookup may change, and only behind `#[cfg(target_os = "android")]`; desktop and iOS lookup order is untouched.
- **Environment:** `ANDROID_HOME=C:\Users\Moritz\AppData\Local\Android\Sdk`, `NDK_HOME=$env:ANDROID_HOME\ndk\29.0.14206865`, build with **JDK 21** (Gradle 8.14.3 cannot configure `buildSrc` on JDK 25). The debug build outputs `app-universal-debug.apk`. If install or `monkey` hangs, cold-boot the AVD with `-no-snapshot-load`.
- **Device paths:** the workspace lives under `/sdcard/Android/data/dev.nullnotes.app/files/Documents/` (plain `adb shell`). `screencap` goes to `/sdcard` then `adb pull` (piping corrupts PNGs under Windows PowerShell).
- **A bug found here** is recorded in the task's **Result** and fixed in its own commit (TDD) or filed with `/file-issue`; never folded into the results commit.
- **Release pin:** use the same `bblanchon/pdfium-binaries` release tag as `scripts/download-pdfium.ps1` (`chromium/7763`) so desktop and Android run the same pdfium revision.

## Review Focus

- **Second PDF in one session** (`PdfiumLibraryBindingsAlreadyInitialized` path): importing twice without restarting must succeed, not report "pdfium not found". Pinned in Task 3 Step 3.
- **Two PDF commands racing on a fresh process:** the iOS spike segfaulted when two threads bound pdfium for the first time concurrently (`mobile-pdfium-render-spike.md`). Pinned in Task 3 Step 4 — a crash here is a finding to file, not to fix inline.
- **Path with a space** (`Lecture 7.pdf`, sidecar `Lecture 7.pdf/`): Android's external-storage path plus the note-named sidecar rule must round-trip. Pinned in Task 3 Step 2.
- **A real multi-page corpus sheet, not just the 2.6 KB fixture:** time and memory on the emulator for a ~10-page document. Pinned in Task 3 Step 5.
- **A non-PDF or missing file:** `pdf_has_text_layer` must return an error string, not kill the process. Pinned in Task 2 Step 3.

---

### Task 1: Fetch script and x86_64 library into the APK

**Files:**
- Create: `scripts/download-pdfium-android.ps1`

**Interfaces:**
- Produces: `src-tauri/gen/android/app/src/main/jniLibs/<abi>/libpdfium.so` for each requested ABI (`x86_64`, `arm64-v8a`); a debug APK containing `lib/x86_64/libpdfium.so`.

- [ ] **Step 1: Write the fetch script**

```powershell
param([string[]]$Abi = @('x86_64'))
$ErrorActionPreference = "Stop"

$release = "chromium/7763"
$asset = @{ 'x86_64' = 'pdfium-android-x64'; 'arm64-v8a' = 'pdfium-android-arm64' }

foreach ($a in $Abi) {
    if (-not $asset.ContainsKey($a)) { throw "Unknown ABI '$a' (expected: $($asset.Keys -join ', '))" }
    $archive = "$($asset[$a]).tgz"
    $tmp = Join-Path $env:TEMP "pdfium-android-$a"
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force $tmp | Out-Null

    $url = "https://github.com/bblanchon/pdfium-binaries/releases/download/$release/$archive"
    Write-Host "Downloading $url ..."
    Invoke-WebRequest -Uri $url -OutFile (Join-Path $tmp $archive)
    tar -xzf (Join-Path $tmp $archive) -C $tmp

    $so = Join-Path $tmp "lib\libpdfium.so"
    $magic = [System.IO.File]::ReadAllBytes($so)[0..3] -join ','
    if ($magic -ne '127,69,76,70') { throw "$so is not an ELF file" }

    $outDir = Join-Path $PSScriptRoot "..\src-tauri\gen\android\app\src\main\jniLibs\$a"
    New-Item -ItemType Directory -Force $outDir | Out-Null
    Copy-Item $so $outDir -Force
    Write-Host "libpdfium.so -> $outDir"
    Remove-Item $tmp -Recurse -Force
}
```

The ELF-magic check is the script's own test: a wrong release layout (the archive structure has changed between releases before) or an HTML error page fails loudly instead of producing a file that Gradle packages and `dlopen` later rejects.

- [ ] **Step 2: Run it and verify**

Run: `.\scripts\download-pdfium-android.ps1`
Expected: `libpdfium.so -> ...\jniLibs\x86_64`, no exception. Then `git status --short` must **not** list the `.so` (already ignored).

If the asset name 404s, open `https://github.com/bblanchon/pdfium-binaries/releases/tag/chromium/7763`, read the real Android asset names, and fix the `$asset` table — do not guess.

- [ ] **Step 3: Inspect the library's dependencies and alignment**

```powershell
$readelf = "$env:NDK_HOME\toolchains\llvm\prebuilt\windows-x86_64\bin\llvm-readelf.exe"
$so = "src-tauri\gen\android\app\src\main\jniLibs\x86_64\libpdfium.so"
& $readelf -d $so | Select-String 'NEEDED|SONAME'
& $readelf -lW $so | Select-String 'LOAD'
```

Expected: `NEEDED` lists only system libraries (`libc.so`, `libm.so`, `libdl.so`, `liblog.so`…). If it lists `libc++_shared.so`, Gradle will not package that automatically — record it, copy `libc++_shared.so` from `$env:NDK_HOME\toolchains\llvm\prebuilt\windows-x86_64\sysroot\usr\lib\x86_64-linux-android\` into the same `jniLibs` dir, and note it for the iOS-delta/arm64 task. Record the `LOAD` `Align` value (`0x1000` vs `0x4000`) for Task 4.

- [ ] **Step 4: Build and confirm the library is in the APK**

```powershell
$env:JAVA_HOME = (Get-ChildItem 'C:\Program Files\Eclipse Adoptium' -Directory -Filter 'jdk-21*' | Select-Object -First 1).FullName
npx tauri android build --debug --target x86_64
$apk = "src-tauri\gen\android\app\build\outputs\apk\universal\debug\app-universal-debug.apk"
tar -tf $apk | Select-String 'lib/x86_64/'
```

Expected: both `lib/x86_64/libnull_notes_lib.so` and `lib/x86_64/libpdfium.so`.

- [ ] **Step 5: Install and confirm the app still launches**

```powershell
. "$env:TEMP\android-attach.ps1"
& $adb install -r $apk
& $adb shell monkey -p dev.nullnotes.app -c android.intent.category.LAUNCHER 1
Start-Sleep 5
& $adb shell pidof dev.nullnotes.app
```

Expected: a pid. Add a **Result:** line under this task (asset name used, `NEEDED` list, alignment, APK listing).

- [ ] **Step 6: Commit**

```bash
git add scripts/download-pdfium-android.ps1 docs/plans/android-parity-pdfium.md
git commit -m "build(mobile): script to fetch Android pdfium into jniLibs"
```

---

### Task 2: Text extraction on the device (and the fallback if needed)

**Files:**
- Modify (conditional, only if Step 2 finds `dlopen` by bare name fails): `src-tauri/src/pdf/renderer.rs`
- Test (conditional): `src-tauri/src/pdf/renderer.rs` (`mod tests`)

**Interfaces:**
- Consumes: Tauri commands `pdf_has_text_layer(pdfPath: string) -> boolean` and `import_pdf_markdown(pdfPath: string) -> { markdown: string, images: [...] }` (`src-tauri/src/commands/pdf.rs`), invoked as `window.__TAURI_INTERNALS__.invoke`.
- Produces: `Invoke-PdfCmd $name $argsJson` helper (PowerShell) and a PDF on the device at `$pdfDir/sample.pdf`, reused by Task 3.

- [ ] **Step 1: Push the fixture and define the invoke helper**

```powershell
. "$env:TEMP\android-attach.ps1"
$devPdf = "/sdcard/Android/data/dev.nullnotes.app/files/Documents/pdfium-check"
& $adb shell "mkdir -p '$devPdf'"
& $adb push src-tauri\tests\fixtures\sample.pdf "$devPdf/sample.pdf"
& $adb push src-tauri\tests\fixtures\sample.pdf "$devPdf/Lecture 7.pdf"
Attach-Webview

function Invoke-PdfCmd($name, $argsJson) {
  (Eval-Page "(async () => { try { return JSON.stringify(await window.__TAURI_INTERNALS__.invoke('$name', $argsJson)) } catch (e) { return 'ERR ' + e } })()" | ConvertFrom-Json).value
}
```

If the push is refused (scoped storage), push to `/sdcard/Download/` and `adb shell cp` it, or write it with `run-as dev.nullnotes.app` (the debug build is debuggable) into the app's `files/` dir and use that path instead.

- [ ] **Step 2: Run text extraction and check for the pdfium-not-found error**

```powershell
Invoke-PdfCmd 'pdf_has_text_layer' "{ pdfPath: '$devPdf/sample.pdf' }"
Invoke-PdfCmd 'import_pdf_markdown' "{ pdfPath: '$devPdf/sample.pdf' }"
```

Expected: `true`, then a JSON object whose `markdown` is non-empty and contains the fixture's headings/text (the iOS run extracted one page; the host `cargo test` fixture is the reference). A reply starting `ERR pdfium (libpdfium.so) not found` means bare-name `dlopen` failed → do the fallback below. Any other `ERR` is a real pipeline error; record it verbatim.

**Conditional fallback (only on "not found"):** first, in `mod tests` of `renderer.rs`, add the failing test for a pure helper that finds the app's native-library directory from `/proc/self/maps` text:

```rust
    #[test]
    fn native_lib_dir_is_the_parent_of_the_app_library() {
        let maps = "7f00-7f01 r-xp 00000000 fd:01 1 /data/app/~~x/dev.nullnotes.app-y/lib/x86_64/libnull_notes_lib.so\n\
                    7f02-7f03 r--p 00000000 fd:01 2 /system/lib64/libc.so\n";
        assert_eq!(
            native_lib_dir_from_maps(maps),
            Some(std::path::PathBuf::from(
                "/data/app/~~x/dev.nullnotes.app-y/lib/x86_64"
            ))
        );
        assert_eq!(native_lib_dir_from_maps("7f00-7f01 r-xp 0 fd:01 1 /system/lib64/libc.so\n"), None);
    }
```

Run `cargo test native_lib_dir -- --nocapture` from `src-tauri` → FAIL (not defined). Implement above `bind_pdfium`:

```rust
#[cfg(any(target_os = "android", test))]
fn native_lib_dir_from_maps(maps: &str) -> Option<std::path::PathBuf> {
    maps.lines()
        .filter_map(|l| l.split_whitespace().last())
        .find(|p| p.ends_with("/libnull_notes_lib.so"))
        .and_then(|p| std::path::Path::new(p).parent().map(|d| d.to_path_buf()))
}
```

and, inside `bind_pdfium()`'s `_ =>` arm next to the iOS block:

```rust
                #[cfg(target_os = "android")]
                if let Some(dir) = std::fs::read_to_string("/proc/self/maps")
                    .ok()
                    .and_then(|m| native_lib_dir_from_maps(&m))
                {
                    if let Ok(b) = Pdfium::bind_to_library(
                        Pdfium::pdfium_platform_library_name_at_path(&dir),
                    ) {
                        return Ok(b);
                    }
                }
```

Run the test → PASS; `cargo clippy -- -D warnings` and `cargo fmt --check` clean; rebuild/reinstall (Task 1 Steps 4–5) and re-run this step. Commit separately:

```bash
git add src-tauri/src/pdf/renderer.rs
git commit -m "fix(mobile): locate libpdfium in the Android native library dir"
```

- [ ] **Step 3: Error path — missing and non-PDF files**

```powershell
Invoke-PdfCmd 'pdf_has_text_layer' "{ pdfPath: '$devPdf/nope.pdf' }"
& $adb shell "echo notapdf > '$devPdf/bad.pdf'"
Invoke-PdfCmd 'pdf_has_text_layer' "{ pdfPath: '$devPdf/bad.pdf' }"
& $adb shell pidof dev.nullnotes.app
```

Expected: both return `ERR …` strings and the pid is unchanged (app alive, `logcat -d | Select-String 'FATAL|panicked'` empty).

- [ ] **Step 4: Record**

Add a **Result:** line: which path `dlopen` took (bare name or fallback), the extracted text summary, the error strings. Do not commit yet; Task 5 commits all results together.

---

### Task 3: Page rendering on the device

**Files:**
- Test: none (device verification, no production change)

**Interfaces:**
- Consumes: `Invoke-PdfCmd`, `$devPdf` from Task 2; `import_pdf_pages(pdfPath: string, notePath: string) -> [{ index, path, width, height }]`.
- Produces: rendered `page-N.png` files in `<note>.pdf/` next to the note path given.

- [ ] **Step 1: Render the fixture**

```powershell
$note = "$devPdf/sample.md"
Invoke-PdfCmd 'import_pdf_pages' "{ pdfPath: '$devPdf/sample.pdf', notePath: '$note' }"
& $adb shell "ls -l '$devPdf/sample.pdf/'"
& $adb pull "$devPdf/sample.pdf/page-0.png" "$env:TEMP\android-page-0.png"
```

Expected: JSON with `index 0`, `width`≤1700, `height`≤2200 (iOS: 1556×2200), `page-0.png` and `text.txt` on disk. Open `$env:TEMP\android-page-0.png` with the Read tool: it must show the real page (two-column layout, headings, code block, equation) — not blank or garbage. A `PASS`-looking reply with a blank image is a finding, not a pass.

- [ ] **Step 2: Space in the path**

```powershell
Invoke-PdfCmd 'import_pdf_pages' "{ pdfPath: '$devPdf/Lecture 7.pdf', notePath: '$devPdf/Lecture 7.md' }"
& $adb shell "ls '$devPdf/Lecture 7.pdf/'"
```

Expected: `page-0.png` inside `Lecture 7.pdf/`.

- [ ] **Step 3: Second import in the same process**

Run Step 1's `import_pdf_pages` again and then `import_pdf_markdown` (no `force-stop` in between). Expected: both succeed; neither returns "pdfium … not found".

- [ ] **Step 4: Concurrent first bind**

```powershell
& $adb shell am force-stop dev.nullnotes.app
& $adb shell monkey -p dev.nullnotes.app -c android.intent.category.LAUNCHER 1; Start-Sleep 6
Attach-Webview
Eval-Page "(async () => { const i = window.__TAURI_INTERNALS__.invoke; const r = await Promise.allSettled([i('pdf_has_text_layer',{pdfPath:'$devPdf/sample.pdf'}), i('import_pdf_pages',{pdfPath:'$devPdf/sample.pdf', notePath:'$devPdf/race.md'}), i('import_pdf_markdown',{pdfPath:'$devPdf/sample.pdf'})]); return JSON.stringify(r.map(x => x.status)) })()"
& $adb shell pidof dev.nullnotes.app
& $adb logcat -d | Select-String 'SIGSEGV|FATAL|Fatal signal'
```

Expected: three `fulfilled`, app alive, no signal. A crash is the iOS bug reproduced on Android: record the logcat tombstone excerpt and file with `/file-issue` (the bind race is in shared code and also reachable on desktop); do not fix here.

- [ ] **Step 5: A real multi-page sheet**

```powershell
& $adb push "notes\exercise_sheets\Analysis_2_Blatt10.pdf" "$devPdf/Blatt10.pdf"
Measure-Command { Invoke-PdfCmd 'import_pdf_pages' "{ pdfPath: '$devPdf/Blatt10.pdf', notePath: '$devPdf/Blatt10.md' }" } | Select-Object TotalSeconds
& $adb shell dumpsys meminfo dev.nullnotes.app | Select-String 'TOTAL PSS|Native Heap'
& $adb shell "ls '$devPdf/Blatt10.pdf/' | wc -l"
```

(`notes/` is gitignored and local-only; if the file is absent, use any local multi-page PDF.) Expected: one `page-N.png` per page plus `text.txt`, app alive, wall time and PSS recorded (no pass threshold — the numbers feed the iOS delta).

- [ ] **Step 6: Record**

Add a **Result:** line: page dims, image check, space-path, second-import, race outcome, sheet page count/time/PSS. Do not commit yet.

---

### Task 4: arm64 device ABI builds with pdfium

**Files:**
- Test: none (build verification)

**Interfaces:**
- Consumes: `scripts/download-pdfium-android.ps1 -Abi` from Task 1.
- Produces: an arm64 debug APK listing in the Result.

- [ ] **Step 1: Fetch the arm64 library and inspect it**

```powershell
.\scripts\download-pdfium-android.ps1 -Abi arm64-v8a
$readelf = "$env:NDK_HOME\toolchains\llvm\prebuilt\windows-x86_64\bin\llvm-readelf.exe"
$so = "src-tauri\gen\android\app\src\main\jniLibs\arm64-v8a\libpdfium.so"
& $readelf -h $so | Select-String 'Machine'
& $readelf -d $so | Select-String 'NEEDED'
& $readelf -lW $so | Select-String 'LOAD'
```

Expected: `Machine: AArch64`; same `NEEDED` shape as x86_64; note the `Align` (a `0x1000` value means the library is not 16 KB-aligned, which Google Play will require for apps targeting Android 15+ — record, do not act).

- [ ] **Step 2: Build arm64**

```powershell
npx tauri android build --debug --target aarch64
tar -tf "src-tauri\gen\android\app\build\outputs\apk\universal\debug\app-universal-debug.apk" | Select-String 'lib/arm64-v8a/'
```

Expected: the build succeeds and lists `lib/arm64-v8a/libnull_notes_lib.so` and `lib/arm64-v8a/libpdfium.so`. It cannot be executed (no device); say so in the Result. Then rebuild x86_64 (Task 1 Step 4) so the working tree's APK matches the emulator again.

- [ ] **Step 3: Record**

Add a **Result:** line: arm64 build outcome, `Machine`, alignment, `NEEDED`, "compile-only, not run".

---

### Task 5: Record results and write the iOS delta

**Files:**
- Modify: `docs/plans/android-parity-pdfium.md` (tick steps, the four **Result** lines)
- Modify: `docs/specs/android-parity-design.md` (append "iOS delta"; mark the finish line met)
- Modify: `docs/plans/mobile-android-scaffold.md` only if Tasks 2–3 there are still unticked and plans 1–5 proved them (tick them, cite this pass)

**Interfaces:**
- Consumes: the **Result** lines of all five Android plans (`android-parity-shared-mobile-git.md`, `-credentials.md`, `-live-sync.md`, `-shell-verification.md`, this one) — each already lists its own "for the iOS delta" facts.

- [ ] **Step 1: Tear down**

```powershell
Remove-Item -Recurse -Force "$env:TEMP\pdfium-android-*" -ErrorAction SilentlyContinue
& $adb shell "rm -rf '$devPdf'"
& $adb forward --remove tcp:9222
git status --short
```

Expected: `git status` shows only doc/script changes — no `.so`, no `.png`.

- [ ] **Step 2: Append the "iOS delta" section to the spec**

Append this to `docs/specs/android-parity-design.md`, filling the bracketed pdfium facts from Tasks 1–4 and keeping the other bullets as the plans' Results state them:

```markdown
## iOS delta

What Android proved is below; what it could not prove is the list the single iOS CI run must cover.

**Proved on Android (do not re-verify on iOS):** shared mobile `cfg` routing to `git_mobile`; clone, edit, sync and offline-then-push round trips against a smart-HTTP remote; token store/read-back and at-rest check; mobile shell reflow and feature cuts in a real WebView; touch-pans / pen-draws ink input; flashcard review and schedule persistence; pdfium text extraction and page rendering [via `dlopen` by bare name | via the `/proc/self/maps` fallback].

**Not provable on Android:**
- Keychain behaviour — Android Keystore proves nothing about it; `allowBackup` restore was never exercised.
- Network stack and ATS policy — git ran over Android's `reqwest`/`rustls` only; cleartext needed a debug-only allowance there, iOS has its own App Transport Security rules.
- The pdfium dylib and its resource path — already proven on the Simulator (`assets/` fallback); the signed-device arm64 dylib is still unproven. Android arm64 only compiled and packaged [alignment `0x…`], it did not run.
- Signing and AltStore sideload.
- Apple WebView quirks — safe-area/`viewport-fit`, soft-keyboard resize, and Back/gesture behaviour were findings on Android (#115–#119) and will differ on WKWebView.
- Real stylus pressure — the emulator reports a constant `1`; Apple Pencil pressure and tilt are unverified.

**Open from the Android pass (file or fix before the iOS run):** #114 false `ConflictBar` after an in-app edit (shared `useNote.ts`, will reproduce on iOS), and #115–#119 shell findings.
```

Verify the issue numbers against `gh issue view` before keeping them; edit the "Open" paragraph to match whatever is actually open.

- [ ] **Step 3: Mark the finish line**

In the spec's **Goal**, after the finish-line paragraph add: `**Status:** met on <date>; see "iOS delta" below.` — only if every bullet of the finish line has a PASS Result in some plan; otherwise name the bullet that is not met.

- [ ] **Step 4: Commit**

```bash
git add docs/plans/android-parity-pdfium.md docs/specs/android-parity-design.md docs/plans/mobile-android-scaffold.md
git commit -m "docs(mobile): record Android pdfium verification and write the iOS delta"
```

---

## Out of scope (this plan)

- A physical Android device and real stylus pressure.
- Any iOS build or CI run (the iOS delta is its input, not its execution).
- Fixing findings from plans 1–5 (filed as #114–#119); only the `bind_pdfium` Android lookup may change here, and only on evidence.
- The import UI's file picker on Android (SAF). The commands behind it are what this plan proves; the picker is a separate Tauri plugin concern.
- `armv7`/`x86` ABIs — arm64 is the only physical-device ABI that matters.

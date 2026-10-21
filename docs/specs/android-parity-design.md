# Android parity pass (P16-9)

## Goal

Android is the local, cheap place to finish and verify everything in Phase 16 that is not platform-specific, so the iOS pass (paused on GitHub Actions macOS minutes, which bill 10x) becomes one CI run against a known list instead of many exploratory runs.

**Finish line:** full P16 parity on the Android emulator — build and launch, git over `git_mobile`, token credentials, clone/edit/sync round trip with desktop, mobile shell and feature cuts verified in a real WebView, pdfium text extraction and rendering, ink pointer/touch input, flashcards.

**Status:** not fully met on 2026-10-21; see "iOS delta" below. Every finish-line bullet has a PASS Result in some plan except **token credentials**: `android-parity-credentials.md` recorded no Result (its Keystore read-back, at-rest and `allowBackup` checks were never run on the device), so the Keystore is only exercised indirectly by the live-sync round trip.

**Not in scope:** a physical Android device (none available) and therefore real stylus pressure; the iOS CI work itself.

## Starting state

- `src-tauri/gen/android/` is generated and committed (`e4f4327`); APK outputs exist. `docs/plans/mobile-android-scaffold.md` has Task 1 done, Tasks 2-3 (build, launch, touch) unchecked.
- `lib.rs` routes every non-iOS target to desktop's CLI-shelling `git`, so git fails on Android. `git.rs`, `git_mobile.rs`, `git_credentials.rs` and `pdf/renderer.rs` gate on `target_os = "ios"`.
- Toolchain is ready: `ANDROID_HOME`, `NDK_HOME`, `JAVA_HOME` set; four Android Rust targets installed; AVD `Pixel_3a_API_34_extension_level_7_x86_64` exists.

## Approach

Vertical slices in dependency order. Each plan ends with something verified on the emulator, so a wrong assumption surfaces in one plan, not at the end.

1. **Finish scaffold.** Build the x86_64 debug APK, boot the AVD, install, confirm launch and touch. Closes the open tasks of `mobile-android-scaffold.md`.
2. **Shared mobile cfg and git.** Replace `target_os = "ios"` with `any(target_os = "ios", target_os = "android")` where the gate means "mobile", so Android routes through `git_mobile` and iOS inherits every fix. Gates that mean "Apple-specific" stay iOS-only.
3. **Credentials.** Store the HTTPS token in the Android Keystore. Open question: `keyring` has no Android store usable without Java-side setup. Starts with a short spike choosing a keyring-core Android store or a small JNI/Tauri plugin. If nothing viable exists, the fallback is app-private encrypted storage, reported as a weaker guarantee than Keychain before it ships.
4. **Live sync round trip.** Run the local smart-HTTP fixture remote from `ios-sync-verify.yml` on the host; the emulator reaches it at `10.0.2.2`. Clone through onboarding, edit on the device, sync, see the edit on desktop and vice versa. Executes the unrun `mobile-editor-sync-verification.md` against Android.
5. **Shell and feature cuts in a real WebView.** Verify the reflow and `isMobile()` gating (Run, Open in IDE, terminal hidden) on-device, since they have only been checked via Playwright against a Tauri stub. Check ink pointer/touch input and flashcards. Pressure fidelity stays open.
6. **pdfium for Android.** Vendor `bblanchon/pdfium-binaries` android-x64, prove text extraction and page rendering as the iOS spikes did. Android lands `bundle.resources` differently from iOS, so expect a path fallback in `renderer.rs`. Finish with an arm64 build to confirm the device ABI compiles.

## Verification

No new harness. Drive the emulator with `adb` (input, screencap) and attach the existing Chrome DevTools tooling to the WebView over a forwarded debug socket for real DOM inspection. Rust logic keeps its existing unit tests; `git_mobile` tests already run on the host.

## Deliverable for iOS

A final "iOS delta" section appended here, listing what Android could not prove: Keychain behaviour, the pdfium dylib and its resource path, signing and AltStore sideload, Apple WebView quirks. The iOS pass is then one CI run against that list.

## Risks

- Android credential storage (plan 3) is the least-known piece; spiked before anything depends on it.
- Emulator networking to the host fixture (`10.0.2.2`, cleartext HTTP) may need a debug-only network-security-config allowance; scoped to debug builds only.
- Gradle/JDK: the installed JDK is 25; Android Gradle tooling may require 17 or 21. Surfaces in plan 1.

## iOS delta

What Android proved is below; what it could not prove is the list the single iOS CI run must cover.

**Proved on Android (do not re-verify on iOS):** shared mobile `cfg` routing to `git_mobile`; clone, edit, sync and offline-then-push round trips against a smart-HTTP remote; mobile shell reflow and feature cuts in a real WebView; touch-pans / pen-draws ink input; flashcard review and schedule persistence; pdfium text extraction and page rendering on x86_64 via `dlopen` by bare name (no path fallback needed on Android, unlike iOS's `assets/`).

**Not provable on Android:**
- Keychain behaviour. Android Keystore proves nothing about it, and the Keystore store itself has no recorded device Result (see Status), so token store/read-back is unverified on both platforms.
- Network stack and ATS policy: git ran over Android's `reqwest`/`rustls` only; cleartext needed a debug-only allowance there, iOS has its own App Transport Security rules.
- The pdfium dylib and its resource path: already proven on the Simulator (`assets/` fallback); the signed-device arm64 dylib is still unproven. Android arm64 only compiled and packaged (`libpdfium.so` AArch64, `NEEDED` libc/libm/libdl, `LOAD` align `0x4000`); it did not run.
- Signing and AltStore sideload.
- Apple WebView quirks: safe-area/`viewport-fit`, soft-keyboard resize, and Back/gesture behaviour were findings on Android (#115-#119) and will differ on WKWebView.
- Real stylus pressure: the emulator reports a constant `1`; Apple Pencil pressure and tilt are unverified.

**Shared-dependency changes the iOS run must cover.** Android forced two `Cargo.toml`/`Cargo.lock` changes that iOS builds inherit: `pdfium-render` 0.9.2 -> 0.9.4 (0.9.2 does not compile for aarch64-linux-android), and the binding set pinned to `pdfium_7763` (0.9.4's default is 7881, which needs symbols the 7763 binaries lack). The iOS workflows download `pdfium-ios-simulator-arm64.tgz` from `releases/latest`, not 7763, so confirm the iOS dylib still binds under the 7763 feature set, or pin the workflow to `chromium/7763`.

**Open from the Android pass (file or fix before the iOS run):** #114 false `ConflictBar` after an in-app edit (shared `useNote.ts`, will reproduce on iOS), #115-#119 shell findings, and #120 concurrent first `bind_pdfium()` crash (crashed on Android with `pdfium-render` 0.9.2; clean on 0.9.4, and clean 5/5 cold starts with the `BIND_LOCK` fix in `894332f`). The host regression test `test_concurrent_first_bind_does_not_crash` also passes with the lock removed, so it does not discriminate on desktop; the crash has only ever reproduced on the Android emulator on 0.9.2. The iOS spike hit the same race.

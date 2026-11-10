# Installing null-notes

## From GitHub Releases

1. Go to `https://github.com/TorresVisual/null-notes/releases/latest`
2. Download the latest release's Windows installer (`.msi` or `.exe`)
3. Run it

That's the whole process — the installer replaces any previous version in place.

## Verifying a download

Each release also carries `SHA256SUMS` (installers plus SBOMs) and CycloneDX SBOMs for the app's npm and Rust dependencies. Check an installer with `sha256sum -c --ignore-missing SHA256SUMS`.

The release workflow also attests build provenance (`actions/attest-build-provenance`), verified with `gh attestation verify <installer> --repo TorresVisual/null-notes`. GitHub only offers artifact attestations for public repos (or Enterprise Cloud), so the step is skipped while this repo is private and starts working the day it goes public.

## Updating

Installed copies check for a new release once at startup and offer to install it. The updater reads `latest.json` from this repo's latest published release; drafts are never visible to it.

Copies older than the transition release still poll the retired mirror `TorresVisual/null-notes-releases`. `publish-mirror.yml` keeps copying releases there so they can reach the first build that polls this repo. Once that build is out and has had time to spread, delete the workflow, the `RELEASES_REPO_TOKEN` secret and archive the mirror.

Versions before the first updater-enabled release (v1.0.4 and earlier) have no updater: install the first updater-enabled release by hand (repeat the steps above, no uninstall needed first).

## Other platforms

Each release also carries a Linux build (`.AppImage`, `.deb`, `.rpm`; only the AppImage self-updates), a signed arm64 Android `.apk` to sideload, and an unsigned iOS `.ipa`.

**iOS (AltStore):** in AltStore go to Browse → Sources → **+** and add `https://raw.githubusercontent.com/TorresVisual/null-notes/main/altstore.json`, then install or update Null Notes from the source. AltStore signs the `.ipa` with your Apple ID on the phone (free-tier certificates expire every 7 days; AltStore refreshes them over Wi-Fi when it can). Publishing a release adds its `.ipa` to `altstore.json` at the repo root (`altstore-source.yml`). The old mirror source keeps working until `publish-mirror.yml` is removed; re-add the new URL in AltStore.

**Android:** download the `.apk` from `https://github.com/TorresVisual/null-notes/releases` (or point Obtainium at this repo for updates) and open it.

## Cutting a release (maintainer)

`npm run release -- patch|minor|major` refuses to start unless the `CI` run for the pushed `HEAD` on `main` has finished green (needs `gh`), then bumps, tags and pushes. CI builds a **draft** release with notes taken from commit subjects; review it and publish it (`gh release edit <tag> --draft=false`), which triggers `altstore-source.yml` (and, until it is retired, `publish-mirror.yml`). To redo either for a tag, run that workflow manually with the tag.

### Choosing targets

`release.yml` runs on the tag and calls one workflow per target: `release-windows.yml`, `release-linux.yml`, `release-android.yml`, `release-ios.yml`. All four build by default. Leave some out with `npm run release -- patch --skip ios,android` or `--only windows` (also `retag`; a retag keeps the tag's previous selection unless you pass a flag). The selection is a `targets:` line in the tag annotation. To build one target for an existing tag, run its workflow from the Actions tab with the tag; it attaches to that tag's draft release.

macOS minutes bill 10x, so `--skip ios` is the cheap option for releases that don't touch the mobile build.

One-time setup for Android: create a keystore (`keytool -genkeypair -v -keystore release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias nullnotes`), keep it somewhere safe (a lost key strands every installed copy, like the updater key), and store these secrets: `ANDROID_KEYSTORE_BASE64` (`base64 -w0 release.jks`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.

### Before pressing Publish

Publishing means every installed copy updates, and there is no rollback. Nothing automated runs the installer, so do this on the draft's installer first:

1. Download the draft's `.msi`/`.exe` and install it over the previous version.
2. Launch it; the version in Settings → About matches the tag.
3. Open an existing workspace; the sidebar tree and search load.
4. Create a note, type, close and reopen it; the text is still there.
5. For an updater check, install the *previous* release, then confirm it offers this one once published (or skip if the release only touches the updater-neutral parts).

If any step fails, don't publish — fix forward and cut a new version.

If a release fails, `npm run release -- retag` moves the existing tag to `HEAD` and re-runs the pipeline at the same version (refused once that version is published). For a transient CI failure, "Re-run failed jobs" is enough.

One-time setup: run `npx tauri signer generate`, put the public key in `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`, and store the private key and password as secrets `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Back the private key up outside the repo — losing it strands every installed copy. The key and password are also kept in the maintainer's gitignored `.env`. `RELEASES_REPO_TOKEN` (a fine-grained PAT for the old mirror) is only needed until `publish-mirror.yml` is retired.

## Note: Explorer right-click integration

The identity package behind the "Open in null-notes" entry is signed with one self-signed cert (`CN=null-notes-dev`) that is **pinned**: its private key lives in the `NULL_NOTES_SIGNING_PFX_BASE64` secret and its public half is committed as `scripts/windows/null-notes-dev.cer`. Release CI refuses to run without the secret, or if its thumbprint differs from the committed `.cer`, so a release can never ship under a cert machines don't already trust.

- **Install / update:** the NSIS installer runs `trust-cert.ps1 -Action Install` (current user, no admin). **Uninstall** removes the trust again. The MSI target has no hook; run the script from the install folder by hand.
- **If registration still fails**, the app starts normally without the context-menu entry and logs the PowerShell error under `shell-integration` in the in-app error log. Some machines also need the extra stores and `AllowAllTrustedApps` described in `docs/research/windows11-top-level-context-menu.md` §6.13 / §7.

**Rotating the cert** (the current one expires 2027-09-13): delete `scripts/windows/.dev-cert/` and the old `CN=null-notes-dev` cert from `Cert:\CurrentUser\My`, run `scripts/windows/dev-cert.ps1` (new certs are valid 10 years), copy `.dev-cert/null-notes-dev.cer` over `scripts/windows/null-notes-dev.cer`, and re-set the secret:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("scripts\windows\.dev-cert\null-notes-dev.pfx")) | gh secret set NULL_NOTES_SIGNING_PFX_BASE64
```

The first time (or after rotating), run that same `gh secret set` command.

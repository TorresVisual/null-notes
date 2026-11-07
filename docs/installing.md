# Installing null-notes

## From GitHub Releases

1. Go to `https://github.com/TorresVisual/null-notes/releases`
2. Download the latest release's Windows installer (`.msi` or `.exe`)
3. Run it

That's the whole process — the installer replaces any previous version in place.

## Updating

Installed copies check for a new release once at startup and offer to install it. Updater traffic goes through the public binaries-only mirror `TorresVisual/null-notes-releases`, because the updater can't fetch assets from a private repo. Releases there are copied from this repo when a release is published; drafts are never visible to the updater.

Versions before the first updater-enabled release (v1.0.4 and earlier) have no updater: install the first updater-enabled release by hand (repeat the steps above, no uninstall needed first).

## Cutting a release (maintainer)

`npm run release -- patch|minor|major` refuses to start unless the `CI` run for the pushed `HEAD` on `main` has finished green (needs `gh`), then bumps, tags and pushes. CI builds a **draft** release with notes taken from commit subjects; review it and publish it (`gh release edit <tag> --draft=false`), which triggers `publish-mirror.yml`. To re-mirror a tag, run that workflow manually with the tag.

### Before pressing Publish

Publishing means every installed copy updates, and there is no rollback. Nothing automated runs the installer, so do this on the draft's installer first:

1. Download the draft's `.msi`/`.exe` and install it over the previous version.
2. Launch it; the version in Settings → About matches the tag.
3. Open an existing workspace; the sidebar tree and search load.
4. Create a note, type, close and reopen it; the text is still there.
5. For an updater check, install the *previous* release, then confirm it offers this one once published (or skip if the release only touches the updater-neutral parts).

If any step fails, don't publish — fix forward and cut a new version.

If a release fails, `npm run release -- retag` moves the existing tag to `HEAD` and re-runs the pipeline at the same version (refused once that version is published). For a transient CI failure, "Re-run failed jobs" is enough.

One-time setup: create the public repo `TorresVisual/null-notes-releases` with an initial commit; run `npx tauri signer generate`, put the public key in `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`, and store the private key and password as secrets `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; add a fine-grained PAT (Contents: read/write on the releases repo) as `RELEASES_REPO_TOKEN`. Back the private key up outside the repo — losing it strands every installed copy.

## Note: Explorer right-click integration

The identity package behind the "Open in null-notes" entry is signed with one self-signed cert (`CN=null-notes-dev`) that is **pinned**: its private key lives in the `NULL_NOTES_SIGNING_PFX_BASE64` secret and its public half is committed as `scripts/windows/null-notes-dev.cer`. Release CI refuses to run without the secret, or if its thumbprint differs from the committed `.cer`, so a release can never ship under a cert machines don't already trust.

- **Install / update:** the NSIS installer runs `trust-cert.ps1 -Action Install` (current user, no admin). **Uninstall** removes the trust again. The MSI target has no hook; run the script from the install folder by hand.
- **If registration still fails**, the app starts normally without the context-menu entry and logs the PowerShell error under `shell-integration` in the in-app error log. Some machines also need the extra stores and `AllowAllTrustedApps` described in `docs/research/windows11-top-level-context-menu.md` §6.13 / §7.

**Rotating the cert** (the current one expires 2027-09-13): delete `scripts/windows/.dev-cert/` and the old `CN=null-notes-dev` cert from `Cert:\CurrentUser\My`, run `scripts/windows/dev-cert.ps1` (new certs are valid 10 years), copy `.dev-cert/null-notes-dev.cer` over `scripts/windows/null-notes-dev.cer`, and re-set the secret:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("scripts\windows\.dev-cert\null-notes-dev.pfx")) | gh secret set NULL_NOTES_SIGNING_PFX_BASE64
```

The first time (or after rotating), run that same `gh secret set` command.

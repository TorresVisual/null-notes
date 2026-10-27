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

`npm run release -- patch|minor|major` bumps, tags and pushes. CI builds a **draft** release with notes taken from commit subjects; review it and publish it (`gh release edit <tag> --draft=false`), which triggers `publish-mirror.yml`. To re-mirror a tag, run that workflow manually with the tag.

If a release fails, `npm run release -- retag` moves the existing tag to `HEAD` and re-runs the pipeline at the same version (refused once that version is published). For a transient CI failure, "Re-run failed jobs" is enough.

One-time setup: create the public repo `TorresVisual/null-notes-releases` with an initial commit; run `npx tauri signer generate`, put the public key in `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`, and store the private key and password as secrets `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; add a fine-grained PAT (Contents: read/write on the releases repo) as `RELEASES_REPO_TOKEN`. Back the private key up outside the repo — losing it strands every installed copy.

## Note: Explorer right-click integration

Releases are signed with a self-signed dev certificate (there's no public code-signing pipeline yet — see `docs/research/windows11-top-level-context-menu.md` §5). That certificate isn't trusted on a fresh machine, so the "Open in null-notes" Explorer context-menu entry won't register — this fails silently and doesn't affect the rest of the app.

To get that feature working on a given machine, see the runbook in `docs/research/windows11-top-level-context-menu.md` §7.

# Release pipeline: auto-update, draft releases, retag

Extends the existing tag-triggered `release.yml` (CI gate → `tauri-action` → GitHub Release). Small change; this is the whole design.

## Intent

Users on v1.0.4 reinstall by hand to update. Releases publish the moment CI is green with no review step and no notes. A failed CI run on a tag forces a version bump to retry. Fix all three.

## Goals

- Installed apps find and install new releases themselves.
- A release is reviewed as a draft before anyone, including the updater, can see it.
- Release notes are generated from commits.
- A failed release is retried at the same version, without a bump.
- Releases stay visible and downloadable on the private `TorresVisual/null-notes`.

## Non-goals

- Code-signing the installer (still the throwaway dev cert; see `docs/installing.md`).
- A "Check for updates" button in Settings; the check runs on startup only.
- Update channels (beta/stable), delta updates, rollback.

## Constraint that shapes it

`null-notes` is private, and Tauri's updater fetches `latest.json` and the installer anonymously, which GitHub 404s for private-repo assets. So updater traffic goes through a **public, binaries-only repo** (`TorresVisual/null-notes-releases`) that mirrors each published release. Source stays private.

## Approaches considered

- **A. Public releases-only repo mirrored from the private one (picked).** Private repo remains the source of truth and download page; the public repo exists only to serve the updater. Cost: one extra repo and a PAT secret.
- B. Make `null-notes` public. Simplest, but exposes source, `docs/` and issues. Rejected.
- C. Self-hosted storage (S3/R2). Extra infrastructure to maintain. Rejected.

## Design

**Flow**

1. `npm run release -- patch|minor|major` bumps, commits, tags, pushes (unchanged).
2. Tag push → `release.yml`: CI gate → build → `tauri-action` creates a **draft** release on `null-notes` with installers, `.sig` files and `latest.json`. Release notes are the commit subjects since the previous tag, excluding `chore: release` commits (needs `fetch-depth: 0`), passed as `releaseBody`.
3. You review the draft and publish it (UI or `gh release edit --draft=false`).
4. Publishing triggers a second workflow (`on: release: published`, manual `workflow_dispatch` with a tag input to re-run it). It downloads the release's assets, rewrites the asset URLs inside `latest.json` to point at the public repo, and creates/updates the same-tag release on `null-notes-releases` using the PAT. It is idempotent so a re-run just overwrites.

Drafts are never "latest", so the updater cannot see a release until step 4 has run.

**Retag.** `npm run release -- retag`: reads the current version, refuses if that version's release is already published (then bump instead), deletes any leftover draft for the tag, moves the tag to `HEAD`, pushes `main`, then force-pushes the tag. That re-runs CI and the build. A transient CI failure with no code change needs only "Re-run failed jobs" in the Actions UI.

**App side**

- `tauri-plugin-updater` (Rust + `@tauri-apps/plugin-updater`), capability `updater:default`.
- `tauri.conf.json`: `bundle.createUpdaterArtifacts: true`, `plugins.updater.pubkey`, and the endpoint `https://github.com/TorresVisual/null-notes-releases/releases/latest/download/latest.json`.
- On startup, one silent check. Failure or offline is ignored. If an update exists, show a dialog (version + notes, "Install and restart" / "Later") using the existing `.settings-panel` dialog classes. Windows quits the app itself during install, so no process plugin.
- Checks run in release builds only, which keeps the e2e suite (a `tauri build --debug` binary) free of network calls and surprise dialogs.
- The CSP is untouched: the updater runs in Rust.

**Manual setup, yours (one-time)**

1. Create the public repo `TorresVisual/null-notes-releases`.
2. `npx tauri signer generate`. Commit the public key into `tauri.conf.json`; store the private key and its password as secrets `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. **Losing this key strands every installed copy.** Back it up outside the repo.
3. A fine-grained PAT with Contents: read/write on the releases repo, stored as secret `RELEASES_REPO_TOKEN`.

v1.0.4 installs have no updater, so they need one manual install of the first updater-enabled release.

## Left to the builder

- Whether `tauri-action` reuses/overwrites a leftover draft on retag; if not, the script's draft deletion covers it.
- The exact mechanism for "release builds only" (e.g. `cfg!(debug_assertions)` exposed via a command).
- Flat vs. grouped (feat/fix) release-note formatting; default is a flat list.
- Updating `docs/installing.md` (auto-update, public mirror).

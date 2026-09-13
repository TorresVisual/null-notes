# Installing null-notes

## From GitHub Releases

1. Go to `https://github.com/TorresVisual/null-notes/releases`
2. Download the latest release's Windows installer (`.msi` or `.exe`)
3. Run it

That's the whole process — the installer replaces any previous version in place.

## Updating

Repeat the same steps with a newer release. No uninstall needed first.

## Note: Explorer right-click integration

Releases are signed with a self-signed dev certificate (there's no public code-signing pipeline yet — see `docs/research/windows11-top-level-context-menu.md` §5). That certificate isn't trusted on a fresh machine, so the "Open in null-notes" Explorer context-menu entry won't register — this fails silently and doesn't affect the rest of the app.

To get that feature working on a given machine, see the runbook in `docs/research/windows11-top-level-context-menu.md` §7.

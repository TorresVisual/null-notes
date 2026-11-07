# Golden workspaces

One directory per released version: `workspace/` (the notes and sidecars) and `index.db` (the SQLite index that release wrote). `tests/golden_workspaces.rs` opens each with the current build, reindexes, saves every note and asserts no file changed.

`index.db` holds absolute paths from the machine that made it, so the test only checks that it opens and migrates; search, tags and links are asserted against the freshly reindexed workspace.

## Adding a release

1. `git worktree add ../null-notes-vX tag` and copy the untracked build inputs it needs (`vendor/pdfium.dll`, and empty placeholders for the other resource paths `build.rs` names).
2. Copy `mkgolden.rs.txt` to `tests/mkgolden.rs` in that worktree.
3. Copy the previous version's `workspace/` here as the new version's, adding anything new that release writes (a new file kind must be added to the workspace so it is covered).
4. From the worktree's `src-tauri`: `GOLDEN_SRC=<new workspace> GOLDEN_OUT=<new>/index.db cargo test --test mkgolden`. The generator is a test, so it only compiles against a release whose `reindex_from_disk` and `scan_workspace` signatures match.

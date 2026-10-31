# Recoverable delete (#121)

## Intent

Deleting a note or folder today calls `remove_file`/`remove_dir_all` on the `.md` and all four sidecars. A misclick on a note holding a long hand-drawn proof loses it for good, and git only helps if the content was already auto-committed. Deletion must never destroy data immediately, and getting it back must be one click.

## Goals

- Delete moves the note and every sidecar (`.ink`, `.pdf`, `.diagrams`, `.assets`) to a trash; folders move recursively.
- A single-note delete has no confirm dialog. A toast offers Undo.
- A "Trash" dialog lists trashed items and restores them to their original path after the toast is gone.
- Auto-commit still records the deletion (#111).
- Rust tests cover delete + restore for a note with sidecars and for a folder.

## Non-goals

- Version history (ROADMAP §4 rules out a second storage system).
- Recovering a deletion on a different machine. Decided: recovery on the machine where the delete happened is enough.
- OS recycle bin integration.

## Anti-goals

- Trash content reaching git or Syncthing as dead weight.
- A restore that overwrites anything.
- The watcher treating the move into trash as an external edit.

## Constraints

- **Storage boundary: machine-local column.** Trash lives in the OS app-data dir, next to `index.db`, never inside the workspace. Record the decision in `docs/ROADMAP.md` §1 (storage-boundary table). Unlike `index.db` it is *not* rebuildable, but it is a recovery aid, not note content: losing it loses only the safety net.
- Trash writes must not leave a half-state: the source is removed only after the destination is complete.
- `save_note` / reindex split is untouched. Trashing calls the existing `forget_note` / `remove_notes_under` DB cleanup, as delete does today.

## Approaches considered

| | Trade-off |
|---|---|
| **A. App-data trash + in-app restore (chosen)** | Invisible to git, Syncthing and the watcher; restorable in-app. Needs a copy-then-delete fallback when the workspace is on another volume. |
| B. Workspace `.trash/` | Atomic same-volume rename, but every existing `.gitignore` needs migrating and Syncthing syncs dead ink. Buys nothing given machine-local recovery. |
| C. OS recycle bin (`trash` crate) | New dependency; no in-app restore, so it fails the "restore later" criterion. |

## Design

**Layout.** `<app-data>/trash/<workspace-key>/<entry-id>/` where `workspace-key` is a stable hash of the workspace path and `entry-id` is a timestamp-based unique id. Each entry holds the moved items under their original file names plus `manifest.json`: original absolute path, kind (note | folder), trashed-at (ms), display name.

**Trash (`trash_note`, `trash_folder`).** Replace `delete_note` / `delete_folder`. Move `.md` + sidecars (note) or the directory (folder) into a fresh entry dir: `rename` when same volume, otherwise copy then verify then remove the source. Write the manifest last. Then run the existing DB cleanup. The commands return the entry id so the toast can offer Undo.

**Restore (`restore_trash_entry`).** Read the manifest, recreate missing parent directories, move items back. If the original `.md` path (or folder path) is occupied, restore under a collision-free name `Title (restored).md` / `Title (restored 2).md`, renaming the sidecars to match; never overwrite. Remove the entry dir, reindex the restored note(s), return the final path.

**List / purge.** `list_trash(workspace)` returns manifests for that workspace, newest first. `purge_trash_entry(workspace, id)` and `empty_trash(workspace)` permanently delete; these are the only destructive operations and are explicit, confirmed actions in the Trash dialog.

**Frontend.**
- `TreeNode.handleDelete`: drop `confirm()`, call trash, show a toast with Undo (existing `ToastStack`). Undo restores and refreshes the tree.
- `TreeNode.handleDeleteFolder`: keep a confirm (bulk action), reworded to drop "This cannot be undone"; also toasts with Undo.
- Existing git-pending-path queuing stays as is: the original paths vanish on disk exactly as before, so `git rm` is recorded.
- Undo/restore queues the same paths again so git re-adds them.
- A "Trash" dialog (reusing the `.settings-panel` chrome classes, per CLAUDE.md) lists entries with Restore and Delete-forever, plus Empty trash. Reachable from the command palette.

**Watcher.** Nothing special: from the workspace's view, a trashed note is a plain deletion, the same event as today.

## Decisions made by me (not discussed)

- Folders keep a confirm dialog; notes lose it.
- Collision naming `(restored)` / `(restored N)`.
- Restore recreates missing parent folders.
- **No automatic purge.** Trash grows until the user empties it. Ceiling: large ink sidecars accumulate. Add an age-based purge on startup if that becomes a problem.
- Undo does not reopen the closed tab.
- Trash dialog entry point is the command palette only, no sidebar button.

## Left to the builder

Workspace-key hashing, entry-id format, copy-verify mechanics for the cross-volume fallback, dialog layout and CSS, and test fixtures. Tests: delete + restore for a note with all four sidecars, for a folder, restore on a collision, restore with a missing parent folder.

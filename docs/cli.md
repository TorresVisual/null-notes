# `nullnotes` CLI

Reads and edits a Null Notes workspace from a shell or a coding agent. It talks to the running app, and starts a hidden instance if none is running, so the first call after a cold start takes 1–3 s.

`nullnotes --help` lists every command with its exact form; this page is the contract around them.

## Using it

- **Workspace**: `--workspace <dir>`, else the nearest parent of the current directory holding a `.workspace.json`, else the workspace you last opened. A folder with only a `README.md` is not a workspace.
- **Paths** are workspace-relative with forward slashes, in arguments and in output. The root folder is `""`.
- **Output** is one JSON line on stdout: `{"ok":true,"result":…}` or `{"ok":false,"error":{"code":"…","message":"…"}}`. Diagnostics go to stderr.
- **Text from stdin**: pass `--content -` and pipe the text in. Prefer it for anything multi-line; shell quoting mangles markdown.

```bash
printf '# Idea\n\nbody\n' | nullnotes note create --folder "" --title Idea --content -
nullnotes search "binary tree" --tag cs101
nullnotes note append Idea.md --content "- follow up"
```

## Commands

| Area | Commands |
| --- | --- |
| Notes | `note list · read · create · write · append · rename · move · duplicate · delete` |
| Search and links | `search · tags list/notes/rename · backlinks · backlinks-code · mentions · graph links/tags` |
| Tasks and cards | `tasks list/toggle · cards due/list/grade/suspend` |
| Structure | `folder create/rename/delete · template list/read/create · trash list/restore · bookmarks read/write · bases rows · property set` |
| Git | `git repo · history · commit` |

`note delete` and `folder delete` move to the app's trash (`trash restore` undoes it); permanent delete, emptying the trash, push/pull/clone and anything that runs code are not available.

`search` returns `{"results":[{path,title,snippet,…}],"total":n}`, 20 per page; page with `--offset`.

## Interactive TUI

`nullnotes tui` opens a full-screen terminal browser over the workspace: read notes with backlinks, search, triage open tasks, review due flashcards, browse tags, restore from the trash, and capture a line or a new note. It uses only the commands above, so it obeys the same access switch and save-path rules.

| Key | Action |
| --- | --- |
| `1`–`6` | Notes · Search · Tasks · Cards · Tags · Trash |
| `/` | search from anywhere (`tag:x folder:y block:code` filter) |
| `c` | capture: `a` append a line to the focused note, `n` new note beside it |
| `Ctrl+R` | refresh the current view |
| `?` | key help |
| `q`, `Ctrl+C` | quit |

It needs an interactive terminal (exit 2 otherwise). A clean quit exits 0; quitting from the error screen (app unreachable, access off, version mismatch) exits with that error's code below. Agents do not use it — use the JSON commands.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | ok |
| 1 | the command failed (error JSON on stdout) |
| 2 | usage error |
| 3 | no workspace found |
| 4 | the app did not start within 15 s |
| 5 | the note has unsaved edits in the app; nothing was written |
| 6 | CLI access is off (Settings → Tools → Allow CLI access) |
| 7 | protocol version mismatch or bad token; update the CLI or the app |

## Behaviour worth knowing

- **Writes follow the save path.** They use the app's atomic write and reindex the note straight away, so `search` finds new text on the next call.
- **Exit 5 is not an error to retry blindly.** The user is typing in that note; wait, or write somewhere else.
- **Appends are serialised per note**, so concurrent `note append` calls all land.
- **The first request per workspace scans it** so the index is current.
- **The window is never shown for a CLI-started instance**, which quits after 10 idle minutes. Opening Null Notes normally promotes it instead of starting a second copy; opening it with a workspace or file replaces it.
- **Workspaces opened this way never enter the recent list.**

## Setup

The installer puts `nullnotes.exe` beside `null-notes.exe` and adds that folder to the user `PATH`; open a new terminal afterwards. In a dev checkout it finds `src-tauri/target/{release,debug}/null-notes.exe`, or set `NULLNOTES_APP_EXE`.

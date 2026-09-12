# Code deep links and the editor command (P7-1 + P7-4)

## Problem

The brief's second pillar is "IDE integration instead of IDE replacement." A note about code names the code: `src-tauri/src/pdf/layout.rs:939`, `src/editor/NoteEditor.tsx#L36-L42`. Today those are inert text, so every one of them is a manual hunt through a file tree in another window.

P7-4 lands **with** P7-1 rather than after it. A hardcoded editor path would be an immediate rewrite, and the launch command is the input to the thing P7-1 has to make safe.

## The security problem, first

This is the first feature in the app that **launches an external process using text taken from note content**, and a note is a hand-editable `.md` file that may have arrived by Git pull, Syncthing, or a converted PDF. The threat is not hypothetical: a link target is attacker-influenced text, and the sink is process execution.

Three rules, each structural rather than a check that can be forgotten:

1. **Never a shell.** `std::process::Command` with `.arg()` per argument, no `sh -c`, no `cmd /c`. A path containing `; rm -rf ~` is then an argument that names no file, not a command.
2. **The template is split before substitution, never after.** The configured command is tokenized into a program and its arguments *once*, and `{file}` / `{line}` are replaced inside already-separated tokens. Substituting first and splitting after would reintroduce word-splitting — the same injection, one layer up. This is the rule that is easy to get subtly wrong, so the tokenizer never sees a resolved path at all.
3. **Refuse anything that is not a plain forward-relative path**, following `assets.rs`'s `resolve_relative`: every component must be `Component::Normal`, so `..`, a root, and a Windows drive prefix are rejected *as written* rather than normalised and compared. Normalising invites a mismatch between the string that was checked and the string that gets used; rejecting does not.

A resolved path must additionally exist and sit inside the workspace root. Existence is not a security control — it is what makes an unresolvable link render inert instead of launching anything.

## What counts as a link

Two forms, both ordinary Markdown that degrades to readable text in any other editor — never a proprietary token:

| Written | Opens |
|---|---|
| `src/main.cpp:58` | that file, line 58 |
| `src/main.cpp` | that file |
| `path/file.rs#L20-L30` | that file, line 20 |

A range opens at its first line: an editor command template takes one line number, and the first is the one the reader means.

**The path must contain a separator and a file extension.** Without both, `Analysis 2:` in prose, a `10:30` timestamp and a bare `README` all become links. This is the same class of judgement as the PDF pipeline's exercise patterns, and the same answer applies: prefer a miss to a false positive, because a wrong link is worse than no link.

## Resolution, the "not found" affordance, and drift detection (issue #52)

A link renders inert (`.code-link-missing`) unless its file actually exists, matching how an unresolved `[[wiki-link]]` already behaves — the app has an established answer for "this points at nothing" and this reuses it rather than inventing a second one.

When a link references a line number (e.g., `src/graph.rs:58`), it can also drift over time as code is added or removed above that line. To detect drift:
1. When a note is indexed, a trimmed content fingerprint of the target line is captured and stored in `note_code_links(source_path, target, line, fingerprint)`.
2. When resolving code links (`resolve_code_links`), the live file line is compared against the stored fingerprint.
3. If the file exists but the content at that line has drifted, the link renders with `.code-link-stale` (amber dashed underline) with an informative tooltip. It remains clickable on user demand.

Existence and staleness cannot be answered from the ProseMirror document, so they need the backend. The check is **batched and cached per workspace**: `resolve_code_links(workspace, note_path, targets)` answering many targets at once, its results held in a store, invalidated when the workspace changes. Per-link IPC on every render is what would make this feature feel slow, and it is avoidable at no cost in correctness.

## The editor command (P7-4)

One setting, a command template with placeholders:

```
code -g {file}:{line}
```

Defaults are detected once by probing for known editors on `PATH` (`code`, `idea`, `nvim`, `subl`), in that order, falling back to `code`. Detection runs when the setting is empty, never overriding a template the user has typed.

Templates for the editors worth naming:

| Editor | Template |
|---|---|
| VS Code | `code -g {file}:{line}` |
| JetBrains | `idea --line {line} {file}` |
| Neovim | `nvim +{line} {file}` |
| Sublime | `subl {file}:{line}` |

`{line}` is substituted with the resolved line or `1` when the link carried none — every template above requires a line, and `1` is the honest answer for "the top of this file."

## Out of scope

- **P7-2, "Open in IDE" on code blocks.** Same launcher, separate task; a code block carrying a source path is a different recognition problem from a path in prose.
- **Opening a project root that is not the workspace.** The roadmap allows resolving against a project root when the workspace is a subtree of one; that needs project-root detection, which is P5-1's repo detection. Until then the workspace root is the only root, and a link outside it is inert rather than wrong.
- **Column numbers.** `file.rs:58:12` resolves to line 58 and ignores the column; no template above needs it.

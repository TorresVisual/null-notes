## Launching external processes

`editor_launch.rs` runs the user's editor on a path **taken from note text**, and a note is a hand-editable file that may arrive by Git pull, by Syncthing, or out of a converted PDF. The target is attacker-influenced and the sink is process execution, so three properties are structural rather than checks:

- **No shell.** `std::process::Command` with one `.arg()` per argument. Never `sh -c` or `cmd /c`.
- **Tokenize the command template *before* substitution, never after.** Splitting a filled-in string back into words reintroduces exactly the injection this prevents. The tokenizer never sees a resolved path.
- **Refuse any path component that is not `Component::Normal`** — as written, never normalised and then compared. Normalising opens a gap between the string that was checked and the string that runs. `assets.rs`'s `resolve_relative` is the same rule for file reads.

Anything that resolves must also exist; an unresolvable link renders inert rather than launching. A failed existence lookup marks its targets unresolved, so this fails inert and never open.

## Running code from notes

`code_run.rs` runs a code block's contents (Python, C/C++) as a real subprocess — no shell, no sandbox, reusing `editor_launch.rs`'s `tokenize`/`is_on_path`. Since the P8 terminal already gives the user unsandboxed execution, the mitigation is **friction and visibility, not containment**: never auto-run (not on note open, sync, or PDF import — only an explicit Run click), a per-note-per-session confirmation gate (in-memory Zustand state, never persisted), and streamed output. See `docs/specs/code-execution-design.md` for the full posture and why a global on/off toggle was rejected in favor of per-note confirmation.

## Formatting code blocks

`code_format.rs` runs `clang-format` (C/C++/Java) or `black` (Python) on a block's text. The program is a fixed table keyed by language — never a frontend or note-supplied string — and the note's text goes in on **stdin only**, never argv. A new language is a new row in `format_argv`, not a configurable command. JSON is formatted in the frontend (`src/lib/codeFormat.ts`). See `docs/specs/code-formatter-design.md`.

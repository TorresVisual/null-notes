# Code formatter (#133)

A **Format** button on code blocks that reformats the block's text in place. Size: small change.

## Intent

Code pasted or typed into a note drifts: mixed indent, ragged braces. The editor already helps while typing (Tab, Enter, bracket auto-close in `CodeBlockEditor.ts`) but cannot tidy a finished block. Languages that matter to the user: C/C++, Python, Java, JSON.

## Goals

- One click reformats the block; one undo step reverts it.
- Works for `c`, `cpp`, `c++`, `java`, `python`, `json` fences.
- Indent width/char follow the existing `codeIndentWidth` / `codeIndentChar` settings where the tool allows.

## Non-goals

- Whole-note Markdown formatting (#134).
- Format on save or on type. Explicit click only.
- Other languages, user-configurable formatter commands, bundled formatter binaries.
- Format selection only.

## Approaches

1. **External tools on PATH (chosen).** `clang-format` for C/C++/Java, `black` for Python, in-process `JSON.stringify` for JSON. Trade-off: the user installs two tools; no binary bloat. Mirrors how Run finds Python/g++.
2. Bundled binaries: works out of the box but tens of MB per platform and a separate build per target. Rejected.
3. Rust/WASM formatters: nothing mature for C++ or Java. Rejected.

## Design

- **Backend:** new `src-tauri/src/commands/code_format.rs`, one thin command `format_code(language, source) -> Result<String, String>`. Registered in `lib.rs`, wrapped in `src/lib/tauri.ts` as `codeFormat.format`.
- **Program choice is a fixed table keyed by language.** Never taken from the frontend or the note (same rule as `code_run.rs` / H-4). Note text only ever reaches the tool on **stdin**, never argv, so there is no injection surface beyond what the formatter itself parses.
  - `c`/`cpp`/`c++` → `clang-format --assume-filename=main.cpp --style={BasedOnStyle: LLVM, IndentWidth: N, UseTab: Never|Always}`
  - `java` → same with `--assume-filename=Main.java`
  - `python` → `black -q -` (black has no indent option; the setting does not apply to Python)
- Runs under `spawn_blocking`, no shell, 10 s timeout then kill. Non-zero exit returns the tool's first stderr line as the error. Spawn failure (`NotFound`) returns a fixed "install clang-format / black" message.
- **JSON** is formatted in the frontend: `JSON.stringify(JSON.parse(text), null, indent)`. Parse errors surface the same way as tool errors. Known ceiling: JSON numbers beyond double precision lose digits.
- **Frontend:** a Format button in `blockActions()` in `CodeBlockToolbar.ts`, shown only for formattable languages and hidden on mobile/web (as Run is). Click → format → replace the block's text range in a single transaction, only if the block's text is unchanged since the click (edits during the async call win). No-op when output equals input.
- **Feedback:** the button flashes "Formatted", "Not installed" or "Failed" like Copy's "Copied", with the detail in `title`. Missing tools are discovered on click, not probed at render, so there is no per-render PATH lookup.
- **Docs:** one paragraph in `src-tauri/src/commands/CLAUDE.md` next to "Running code from notes".

## Tests

- Rust: argv builder per language (indent width, tabs), unknown language rejected, timeout helper.
- Vitest: button appears only for formattable languages; replaces text in one transaction; skips replacement when the block changed mid-flight; JSON path including a parse error.
- Not tested: the real `clang-format` / `black` binaries (not guaranteed on CI).

## Left to the builder

CSS for the button (reuse `.code-block-copy` styling, check `index.css` for the className), exact feedback labels, exact clang-format base style.

## Calls I made (not agreed in conversation)

- Missing-tool feedback is on click, not a pre-disabled button, to avoid probing PATH on every render.
- Hidden on mobile/web, including JSON, to keep one gating rule.
- `BasedOnStyle: LLVM`; Python ignores the indent setting.

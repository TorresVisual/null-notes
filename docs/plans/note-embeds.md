# Note Embeds Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** `![[Note]]` / `![[Note#Heading]]` on its own line renders the target's live content as a read-only block, lossless on disk.

**Architecture:** A block-atom TipTap node `noteEmbed` parsed by a markdown-it core rule. Its React node view resolves the target by title, fetches the markdown (refetching on `workspace-changed`), slices it to the heading, and renders it in a nested read-only `useEditor` built from `extensionsFor(target.path)`. A React context carries the chain of note paths already being rendered, for cycle and depth guarding.

**Tech Stack:** TipTap 3, tiptap-markdown (markdown-it), React 19, Vitest + Testing Library, Rust (tests only).

**Spec:** [docs/specs/note-embeds-design.md](../specs/note-embeds-design.md)

## Execution Options

Leave every box below unchecked. The executing skill resolves them with
your human partner before Step 1 and checks the chosen boxes itself.

**Execution Target:**
- [x] Current branch (no isolation)
- [ ] New feature branch (no worktree)
- [ ] Worktree (superpowers:using-git-worktrees)

**Execution Mode:**
- [x] Inline execution (superpowers:executing-plans)
- [ ] Subagent-driven execution (superpowers:subagent-driven-development)

## Global Constraints

- Disk text is always `![[title]]` / `![[title#heading]]` (via `formatWikiLink`); an embed never writes anything else.
- An embed is recognised only when `![[…]]` is the entire paragraph, at document level (token level 0). Inline `![[…]]` and embeds inside list items/quotes keep today's behaviour.
- The embed never edits the source and never marks the host note dirty.
- Named type/function conventions per CLAUDE.md: named exports, no `any`, no comments unless the WHY is non-obvious, `spellcheck="false"` on the node wrapper.
- Every new CSS className must have a rule in `src/index.css` (grep before calling done).
- Commit after each task; never `--no-verify`; do not push.

## Review Focus

- Embed of the note the embed lives in (A embeds A) → circular placeholder, no recursion.
- A→B→A across two notes → circular placeholder at the second level.
- Chain of embeds longer than the depth cap → "too deeply nested" placeholder.
- `#Heading` that does not exist in the target → "heading not found" placeholder, not the whole note.
- Fenced code containing a `#`-line inside the section → not treated as a heading boundary.
- Target note deleted/renamed while embedded → falls to the unresolved placeholder on next store update.
- Source note edited elsewhere → embed shows new content without remounting the host.

---

### Task 1: Pure syntax helpers

**Files:**
- Create: `src/lib/embedSyntax.ts`
- Test: `src/lib/embedSyntax.test.ts`

**Interfaces:**
- Consumes: `parseWikiLink(body: string): WikiLinkParts` from `src/lib/wikiLinkSyntax.ts`.
- Produces:
  - `parseEmbedParagraph(content: string): WikiLinkParts | null` — non-null only when `content.trim()` is exactly `![[body]]` (body has no `]` or newline).
  - `sectionOf(markdown: string, heading: string): string | null` — lines from the heading (case-insensitive text match, heading line included) up to but excluding the next heading of the same or higher level; `null` if absent. `#`-lines inside ``` fences neither match nor end a section.
  - `embedBody(markdown: string, heading: string): string | null` — `heading` empty → whole note minus a leading `# ` H1 line (the embed header already names the note); otherwise `sectionOf`.

- [ ] **Step 1: Write failing tests** in `embedSyntax.test.ts`:
  - `parseEmbedParagraph('![[A]]')` → `{title:'A',heading:'',label:''}`; `'  ![[A#H|x]] '` → `{title:'A',heading:'H',label:'x'}`; `'see ![[A]]'`, `'![[A]] more'`, `'[[A]]'`, `'![[A]] ![[B]]'` → `null`.
  - `sectionOf('# T\n## A\nx\n### A1\ny\n## B\nz', 'a')` → `'## A\nx\n### A1\ny'`; last section runs to end; `'missing'` → `null`.
  - `sectionOf('## A\n```\n# not a heading\n```\nbody\n## B', 'A')` → `'## A\n```\n# not a heading\n```\nbody'`.
  - `embedBody('# T\nbody', '')` → `'body'`; `embedBody('no h1\nbody', '')` → `'no h1\nbody'`.
- [ ] **Step 2: Run** `npx vitest run src/lib/embedSyntax.test.ts` — expect FAIL (module missing).
- [ ] **Step 3: Implement** the three functions in `src/lib/embedSyntax.ts`. `sectionOf` is a single line walk toggling an `inFence` flag on lines starting with ```; reuse no regex from `outlineHeadings.ts` (it strips fences, which would shift offsets).
- [ ] **Step 4: Run** the same command — expect PASS.
- [ ] **Step 5: Commit** `feat(embeds): embed paragraph and heading-section helpers (#153)`.

---

### Task 2: `noteEmbed` node, parse rule, serializer

**Files:**
- Create: `src/editor/extensions/NoteEmbed.tsx`
- Modify: `src/editor/extensions/index.ts` (import and add `NoteEmbed` to `coreExtensions` immediately after `WikiLink`)
- Test: `src/editor/extensions/NoteEmbed.test.tsx`

**Interfaces:**
- Consumes: `parseEmbedParagraph` (Task 1), `formatWikiLink`, `encodeAttr` from `src/lib/htmlAttr.ts`.
- Produces: `export const NoteEmbed` (TipTap `Node`, name `'noteEmbed'`, `group: 'block'`, `atom: true`, `selectable: true`, attrs `title: string`, `heading: string`, both default `''`). Initial node view: `ReactNodeViewRenderer(EmbedView)` where `EmbedView` is a placeholder rendering `<NodeViewWrapper className="note-embed" spellCheck={false}>{title}</NodeViewWrapper>`; Task 4 replaces its body.

- [ ] **Step 1: Write failing tests** (mount helper copied from `WikiLink.test.tsx`: `useEditor({ extensions: coreExtensions, content })` + `EditorContent` inside `TooltipProvider`; `markdownOf()` via `editor.storage.markdown.getMarkdown()`):
  - `'![[Big O]]'` mounts a `.note-embed` and `markdownOf()` is `'![[Big O]]'`; same for `'![[Big O#Proofs]]'`.
  - `'intro\n\n![[Big O]]\n\noutro'` round-trips unchanged.
  - `'see ![[Big O]] inline'` produces no `.note-embed` and still renders a `.wiki-link` (inline behaviour unchanged).
  - `'- ![[Big O]]'` produces no `.note-embed`.
- [ ] **Step 2: Run** `npx vitest run src/editor/extensions/NoteEmbed.test.tsx` — expect FAIL.
- [ ] **Step 3: Implement.** Node `parseHTML` tag `div[data-type="note-embed"]` reading `data-title`/`data-heading`; `renderHTML` emits the same div. Markdown `serialize`: `state.write('![[' + formatWikiLink({title, heading, label: ''}) + ']]')` then `state.closeBlock(node)`. Markdown `parse.setup(markdownit)`: `markdownit.core.ruler.after('inline', 'note_embed', fn)` — placing it right after `inline` makes it independent of extension order, so it runs before `wiki_link` (which `push`es to the end). `fn` walks `state.tokens`; for each `paragraph_open` at `level === 0` followed by an `inline` token whose `parseEmbedParagraph(token.content)` is non-null and then `paragraph_close`, splice the three tokens into one `html_block` token with content `<div data-type="note-embed" data-title="…" data-heading="…"></div>\n` (values via `encodeAttr`).
- [ ] **Step 4: Run** the test file — expect PASS; also run `npx vitest run src/editor/extensions/WikiLink.test.tsx` to confirm no regression.
- [ ] **Step 5: Commit** `feat(embeds): noteEmbed node with lossless ![[ ]] round-trip (#153)`.

---

### Task 3: `useEmbedSource` hook

**Files:**
- Create: `src/hooks/useEmbedSource.ts`
- Test: `src/hooks/useEmbedSource.test.ts`

**Interfaces:**
- Consumes: `api.notes.open(workspace: string, path: string): Promise<string>`; `listen` from `@tauri-apps/api/event`; `NoteMeta` from the notes store (the element type of `useNotesStore().notes`).
- Produces: `useEmbedSource(target: NoteMeta | undefined): string | null` — `null` until loaded or when `target` is undefined; fetches on mount and whenever a `workspace-changed` payload includes `target.path`; unsubscribes on unmount/target change.

- [ ] **Step 1: Write failing tests** reusing the mock pattern of `useNote.test.ts` (mock `../lib/tauri` with `api.notes.open`, mock `@tauri-apps/api/event` capturing the handler):
  - returns `null` for an undefined target and never calls `open`.
  - after mount, returns the opened content.
  - emitting `workspace-changed` with `['/ws/other.md']` does not refetch; with `[target.path]` refetches and returns the new content.
  - the unlisten function is called on unmount.
- [ ] **Step 2: Run** `npx vitest run src/hooks/useEmbedSource.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** with `useState` + one `useEffect` keyed on `target?.path`/`target?.workspace`; guard against setting state after cleanup with a local `cancelled` flag.
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat(embeds): useEmbedSource hook refetching on workspace-changed (#153)`.

---

### Task 4: Embed view — resolve, placeholders, cycle/depth guard, nested editor

**Files:**
- Create: `src/editor/extensions/EmbedChainContext.ts` (exports `EmbedChainContext = createContext<string[]>([])` and `MAX_EMBED_DEPTH = 3`)
- Create: `src/editor/extensions/NoteEmbedView.tsx` (exports `NoteEmbedView`, plus the inner `EmbedBody`)
- Modify: `src/editor/extensions/NoteEmbed.tsx` (use `NoteEmbedView`, delete the Task 2 stub)
- Test: extend `src/editor/extensions/NoteEmbed.test.tsx`

**Interfaces:**
- Consumes: `useEmbedSource` (Task 3), `embedBody` (Task 1), `extensionsFor(path)` from `./index` — note: `index.ts` imports `NoteEmbed`, which imports the view, which imports `extensionsFor`; import it lazily inside the view module via `import { extensionsFor } from './index'` and only call it at render time, so the cycle is never evaluated at load. `wikiLinkText`, `setPendingHighlight`, `useWorkspaceStore.openTab`, `useNotesStore`.
- Produces: `NoteEmbedView(props: ReactNodeViewProps)`. Behaviour, in order:
  1. `hostPath = editor.storage.noteContext.notePath`; `chain = [...useContext(EmbedChainContext), hostPath]`.
  2. Target lookup identical to `WikiLinkView` (case-insensitive title). None → `<div class="note-embed note-embed-missing">` text `Note "{title}" not found`.
  3. `target.path` in `chain` → `note-embed-missing` with `Circular embed: "{title}"`. `chain.length > MAX_EMBED_DEPTH` → `Embed nested too deeply`.
  4. `content = useEmbedSource(target)`; `null` → empty body (no flash of placeholder). `body = embedBody(content, heading)`; `null` → `Heading "{heading}" not found in "{title}"`.
  5. Otherwise a header `<button class="note-embed-header">` showing `wikiLinkText({title, heading, label: ''})` that does what `WikiLinkView.handleClick` does for a resolved target (open tab; if heading, `setPendingHighlight(path, heading, true)` + dispatch `search:jump`), above `<EmbedChainContext.Provider value={chain}><EmbedBody markdown={body} path={target.path} /></…>`.
  - `EmbedBody({markdown, path})`: `useEditor({ extensions: extensionsFor(path), content: markdown, editable: false })` rendered with `EditorContent`; the parent passes `key={markdown}` so a changed source remounts the editor instead of calling `setContent` (avoids the flushSync-from-effect problem documented in `NoteEditor.tsx` for #14).

- [ ] **Step 1: Write failing tests** (mock `api.notes.open` per path; seed `useNotesStore` with notes A=`/ws/a.md`, B=`/ws/b.md`; host editor mounted with `extensionsFor('/ws/host.md')`, not bare `coreExtensions`, so `noteContext.notePath` is real):
  - resolved whole-note embed: target content `'# B\nhello world'` → `.note-embed-body` contains `hello world` and not the `B` H1; header text is `B`.
  - `![[B#Part]]` with content `'# B\n## Part\ninside\n## Other\noutside'` → body contains `inside`, not `outside`; header `B › Part`.
  - missing heading → `Heading "Nope" not found in "B"`.
  - unresolved title → `.note-embed-missing` with `Note "Ghost" not found`.
  - self-embed: host path `/ws/a.md` embedding `![[A]]` → `Circular embed: "A"`, and `open` is not called.
  - cycle A→B→A: host `/ws/a.md` embeds B; B's content is `'![[A]]'` → inner shows `Circular embed: "A"`.
  - depth: notes N1→N2→N3→N4→N5 chained, host not in chain → outermost renders, level beyond `MAX_EMBED_DEPTH` shows `Embed nested too deeply`.
  - read-only: the nested `.tiptap` has `contenteditable="false"`.
  - live update: after first render, mock `open` to return new content and emit `workspace-changed` for the target path → body text updates (`waitFor`).
  - host markdown unchanged after all of the above (`markdownOf()` equals input).
- [ ] **Step 2: Run** `npx vitest run src/editor/extensions/NoteEmbed.test.tsx` — expect FAIL on the new cases.
- [ ] **Step 3: Implement** the files above. Check `InkBlockView`, `BlockMath`, `MermaidBlock` already honour `editor.isEditable`; if the nested read-only editor still lets ink draw or maths edit, fix in that view and add a test.
- [ ] **Step 4: Run** the test file plus `npx vitest run src/editor` — expect PASS.
- [ ] **Step 5: Commit** `feat(embeds): render embeds as live read-only excerpts with cycle guard (#153)`.

---

### Task 5: Styling

**Files:**
- Modify: `src/index.css` (next to the `.wiki-link` rules, ~line 2464)

**Interfaces:** classes used by Task 4: `.note-embed`, `.note-embed-header`, `.note-embed-body`, `.note-embed-missing`.

- [ ] **Step 1:** Add rules using existing tokens only (`--border`, `--bg-hover`, `--text-tertiary`, `--accent`, radius 6px "attached/embedded box" tier per `docs/ui-consistency-audit.md`): `.note-embed` bordered block with left accent edge, `.note-embed-header` small muted full-width button (accent on hover), `.note-embed-body` padded, last child margin 0, `pointer-events` left default so links inside work, `.note-embed-missing` muted like `.wiki-link-missing`.
- [ ] **Step 2:** Run `grep -n "note-embed" src/index.css src/editor/extensions/*.tsx` and confirm every className used in the TSX has a rule.
- [ ] **Step 3:** Run `npm run dev`, open a note containing `![[Some Note]]` and `![[Some Note#Heading]]`, and visually compare the block against a `.callout` for spacing (per the project's UI-spacing lesson: verify by screenshot, not by className presence). Use the `ui-preview` skill if a browser view is enough.
- [ ] **Step 4: Commit** `style(embeds): embed block, header and placeholder styles (#153)`.

---

### Task 6: Backlinks and rename pinned by tests (Rust)

**Files:**
- Modify: `src-tauri/src/commands/notes.rs` (test module, next to `test_extract_links_*` ~line 2680)

**Interfaces:** consumes `extract_links`, `rewrite_links`, `extract_backlink_snippet`; no production change expected.

- [ ] **Step 1: Add tests:**
  - `test_extract_links_counts_embeds`: `extract_links("![[Sorting]] and ![[Graphs#BFS]]")` → `["Sorting", "Graphs"]`.
  - `test_rewrite_links_keeps_embed_bang`: `rewrite_links("![[Old]] ![[old#Part]]", "Old", "New")` → `"![[New]] ![[New#Part]]"`.
  - `test_extract_backlink_snippet_finds_embed_line`: content `"intro\n![[Sorting]]\n"`, title `"Sorting"` → `Some("![[Sorting]]".to_string())`.
- [ ] **Step 2:** `cd src-tauri && cargo test test_extract_links_counts_embeds test_rewrite_links_keeps_embed_bang test_extract_backlink_snippet_finds_embed_line` — expect PASS (if any fails, fix the regex there; that would be the one production change).
- [ ] **Step 3:** `cargo fmt` then `cargo clippy -- -D warnings`.
- [ ] **Step 4: Commit** `test(embeds): backlinks and rename treat ![[ ]] as a link (#153)`.

---

### Task 7: Verification

- [ ] **Step 1:** `npm run typecheck && npm test` — all green.
- [ ] **Step 2:** `cd src-tauri && cargo test && cargo clippy -- -D warnings && cargo fmt --check`.
- [ ] **Step 3:** Run the `tiptap-extension-reviewer` agent on `NoteEmbed.tsx` and fix findings.
- [ ] **Step 4:** Manual check in the running app (`npm run tauri dev` or the `e2e-verify` skill): embed a note, edit the source in a second pane/tab and watch the embed update, confirm the `.md` on disk still reads `![[…]]`.
- [ ] **Step 5:** Tick the acceptance criteria in a closing comment draft for #153 (do not post; the GitHub MCP is down).

## Self-review

- Spec coverage: node + lossless round-trip (T2), heading slice (T1/T4), live update (T3/T4), cycles + depth + unresolved + missing heading (T4), backlinks/rename (T6), styling (T5), block-only rule (T1/T2), ADR (already committed).
- Types consistent: `WikiLinkParts` from Task 1 is what Task 2 passes to `formatWikiLink`; `useEmbedSource` signature in Task 3 matches Task 4's use; `EmbedChainContext`/`MAX_EMBED_DEPTH` defined and consumed in Task 4 only.
- My calls beyond the spec: whole-note embeds drop a leading H1; section includes its heading line; embeds only at document level; `key={markdown}` remount rather than `setContent`; `MAX_EMBED_DEPTH = 3`.

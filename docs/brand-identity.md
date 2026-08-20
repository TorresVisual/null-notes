# null-notes — Brand Identity

**Date:** 2026-08-20
**Scope:** P9.5-1. Extends `docs/specs/visual-design-system-design.md` (the "Terminal Precision" token set, shipped in P2) with the identity decisions that sit above the token layer: what the mark means, what the name means, and how the two aesthetics named in the roadmap — terminal and academic notebook — actually relate rather than just coexist.

---

## What "Terminal Precision" communicates

Near-black surfaces, one signal-green accent, monospace for anything code- or math-adjacent. The intent isn't "looks like a dev tool" for its own sake — it's a claim about the app's relationship to its subject matter: CS coursework is exact, and the interface shouldn't be softer than the material it's holding. A pastel note-taking aesthetic borrowed from a general-audience app would undersell what the tool is actually for.

## Terminal vs. academic notebook

These aren't two competing moods stitched together — the terminal vocabulary is in service of the notebook's content, not a separate skin over it:

- **Terminal** supplies the *precision* register: near-black ground, one accent color instead of a palette, monospace for anything symbolic (code, math, tags), sharp/geometric shapes over soft ones.
- **Notebook** supplies the *subject*: the app exists to hold written notes, and every terminal-derived choice above still has to serve reading and writing prose, not just code. Headings are set in a sans-serif at weight 700 rather than monospace (`visual-design-system-design.md`), specifically because a notebook full of monospace headings hurts scannability at the volume a real course produces — precision language stops where it would compromise reading, and that boundary is the design.

Where each shows up: terminal in the chrome (backgrounds, accents, iconography, code/math typography); notebook in the content-facing typography (body, headings) and in the app's own mark, below.

## The app icon

The mark is a broken ring — read as Ø, the null/empty-set symbol — pierced by a drawn pencil at 45°, where the pencil's diagonal *is* the ring's slash rather than a separate element next to it. One gesture carries both halves of the name: **null** (the ring, the gap, the void) and **notes** (the pencil, the act of writing). Earlier drafts tried to inject "notes" as a secondary cue behind an abstract null symbol (faint ruled lines, a hollow terminal-cursor block) and none of them landed — putting a literal writing instrument into the same stroke as the null symbol, rather than beside it, was the concrete decision that made the mark work.

Color: signal green (`--accent`, `#7ee787`) on the ring, kept as a materially distinct neutral gray for the pencil rather than forcing it into the accent green — the pencil reads as an object made of a different material than the ring, which is also the whole point (two things, one gesture, still legibly two things).

**Sibling-product differentiation:** null-ide's icon is a plain Ø (ring + slash, white on gray, no third element). Reusing that exact glyph recolored for null-notes would make the two indistinguishable at taskbar size — color alone isn't enough differentiation when the base silhouette is identical. The pencil is what carries the differentiation: same "null" family device (the broken-ring-and-slash), completely different resulting silhouette once the slash becomes an object with its own shape.

One accepted tradeoff: the same illustrated pencil is used at every size, including the 16–32px taskbar/favicon range, where its internal detail (ferrule bands, faceted tip) reads as a soft gray smudge rather than a crisp pencil. A flattened small-size-only variant was built and rejected — a second, visually distinct mark for small sizes felt more inconsistent than one mark that's slightly less crisp at the smallest size. Consistency of the mark won over small-size optimization.

Source files: `logos/concept-null-notes.svg` (original hand-drawn concept), `logos/app-icon.svg` (shipped — ring recolored to signal green), generated into `src-tauri/icons/` via `npx tauri icon`. Also used as the browser-tab favicon (`public/favicon.svg`, referenced from `index.html`) — one mark, not a second design for that surface.

**Rounded square, transparent corners — this is fine on Windows.** A "white border completing the square" was reported against a running dev build after an icon regeneration. Turned out to be a stale-build artifact, not a real transparency-compositing bug: `cargo`/`tauri-build` doesn't reliably notice `icon.ico` changing on disk unless the Rust source also changes, so the running exe was still the *original stock Tauri icon* (which has no background fill at all behind its rings) well after several rounds of icon work had already landed on disk — confirmed by extracting the icon resource directly from the running process and finding the literal placeholder. `cargo clean -p null-notes && cargo build` forces the relink. Verified directly afterward, both from the source `icon.ico` and from the freshly-built exe's actual embedded resource, composited onto both white and dark backgrounds at 16/32/48/256px: the rounded corners' transparency composites correctly everywhere, no white artifact at any size. **Lesson for next time an icon change looks wrong in the running app: rebuild the Rust binary first** (`cargo clean -p null-notes && cargo build` in `src-tauri/`, or fully quit and relaunch `tauri dev`) before concluding the *design* is broken — the icon is read once at compile time and embedded into the exe, so a stale binary shows a stale icon regardless of what's on disk.

`npx tauri icon` also produces Windows Store/MSIX tile assets (`Square*Logo.png`, `StoreLogo.png`) and Android/iOS variants as part of its default output — none of them are referenced anywhere in this project (it ships via NSIS/MSI, not a store), and the small Store tile sizes in particular bake in Microsoft's own safe-zone padding (a real, separate padding convention, unrelated to the stale-build issue above). These are deleted after every regeneration rather than committed.

# Null Notes — Brand Identity

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

**Rounded square, transparent corners — kept, once the actual bug was found.** A "white border completing the square" was reported against the running app. Two wrong theories were chased before the real one: first that Windows doesn't reliably composite the rounded corners' transparency (it does — full-bleed "fixed" it only because there was no transparency left to fail); then that the running exe was stale (real, and worth fixing on its own — `cargo`/`tauri-build` doesn't reliably notice `icon.ico` changing on disk unless Rust source also changes, so a rebuilt icon can sit unused in a still-running dev binary — but not the actual cause here, since the bug reappeared on a verified-fresh build too).

**The real bug:** the master PNG this whole icon set is generated from is rasterized from `logos/app-icon.svg` via headless Chrome (`chrome --headless --screenshot=...`). Chrome's screenshot mode paints its own **opaque white page background** behind anything with transparency unless told otherwise — confirmed by inspecting the actual pixel values of a nominally-transparent corner: `(255, 255, 255, 255)`, fully opaque white, not `(0, 0, 0, 0)`. Every regeneration of the rounded icon baked literal white pixels into the corners, in `icon.png`, in every frame of `icon.ico`, all the way down to the version embedded in the compiled exe — full-bleed only ever "worked" because a solid square has no transparent pixels for this to corrupt. Fixed with one Chrome flag, `--default-background-color=00000000`, which makes the screenshot preserve real transparency. Verified at the pixel level after the fix — source PNG, every `icon.ico` frame, and the icon resource extracted directly from the freshly rebuilt exe all read `(0, 0, 0, 0)` at the corners, not white.

**Lesson for next time this kind of bug shows up:** check actual pixel values before trusting a visual glance or a plausible-sounding theory — a thumbnail rendered small enough, or eyeballed quickly, can hide a fully-opaque corner that a two-line PIL/`.NET` pixel read exposes immediately. And separately: rebuild the Rust binary (`cargo clean -p null-notes && cargo build` in `src-tauri/`, or fully quit and relaunch `tauri dev`) before concluding an icon-visual bug is fixed — the icon is embedded into the exe at compile time, so a stale binary shows a stale icon regardless of what's correct on disk.

`npx tauri icon` also produces Windows Store/MSIX tile assets (`Square*Logo.png`, `StoreLogo.png`) and Android/iOS variants as part of its default output — none of them are referenced anywhere in this project (it ships via NSIS/MSI, not a store), and the small Store tile sizes in particular bake in Microsoft's own safe-zone padding (a real, separate, unrelated padding convention). These are deleted after every regeneration rather than committed.

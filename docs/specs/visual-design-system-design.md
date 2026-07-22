# null-notes — Visual Design System Design

**Date:** 2026-07-22
**Scope:** Dark-only visual refresh (design tokens + icon system). First of four planned polish passes (visual design system → ink toolbar → editor feel → navigation), sequenced because the other three inherit from this one.

---

## Goals

- Replace today's ad hoc dark palette, spacing, and plain-text/emoji buttons with a coherent, intentional visual identity ("Terminal Precision": near-black, high-contrast, monospace accents).
- Establish reusable design tokens (CSS custom properties) so future polish passes build on a shared system instead of copy-pasted hex values.
- Swap text/Unicode-glyph buttons for a consistent icon set (Lucide) across the app shell.

## Non-Goals

- No light mode — dark-only for this pass; a light variant is a separate future project.
- No new features, no layout/sizing restructuring (sidebar width, pane arrangement, panel positions unchanged).
- No changes to editor extension logic, TipTap node behavior, or the Rust backend.
- No changes to the ink toolbar's *functionality* (tool set, undo/redo behavior) — only its visual chrome. Ink toolbar UX/layout polish is its own later project.

---

## Design Tokens

New CSS custom properties in `src/index.css`, replacing scattered hex literals:

```css
:root {
  /* Backgrounds */
  --bg-base: #0d0f12;      /* page / editor background */
  --bg-raised: #111318;    /* sidebar, tab bar, toolbars, modals */
  --bg-sunken: #0a0b0d;    /* nested rail elements */
  --bg-hover: #161b22;

  /* Borders */
  --border: #1f242c;
  --border-strong: #2a2f38;

  /* Text */
  --text-primary: #e6edf3;
  --text-secondary: #9da7b3;
  --text-tertiary: #565f6b;
  --text-disabled: #3a4048;

  /* Accent (signal green) */
  --accent: #7ee787;
  --accent-bg: rgba(126, 231, 135, 0.12);
  --accent-bg-hover: rgba(126, 231, 135, 0.22);
  --accent-contrast: #0d0f12; /* text/icon color on solid-accent fills */

  /* Semantic */
  --danger: #e05050;

  /* Spacing scale */
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 12px;
  --space-lg: 16px;
  --space-xl: 24px;
  --space-2xl: 32px;
}
```

### Typography

- Headings: system-ui sans, weight 700, tight letter-spacing (~-0.01em on h1/h2). Chosen over monospace headings — a note app surfaces hundreds of headings a day, and monospace headings hurt scannability at that volume.
- Body: unchanged system-ui sans stack, unchanged base size (15px)/line-height (1.6).
- Code, inline math variables, tags/pills, and UI chrome that wants the "terminal" identity: existing monospace stack (`'Cascadia Code', 'Fira Code', monospace`), unchanged.

### Callout Colors

Keep the existing 5-color semantic system (readers rely on color coding to scan callout type at a glance) — retune each against the new `--bg-base`/`--bg-raised` values, with one hue change:

| Type | Before | After | Note |
|---|---|---|---|
| note/info | `#4a9eff` / `#0d1f33` | unchanged | already reads fine on near-black |
| tip | `#3dbc6a` / `#0d2018` | `#2dd4bf` / teal bg | shifted off green — collides with the new UI accent otherwise |
| warning | `#f0a030` / `#271c0a` | unchanged | |
| danger | `#e05050` / `#270d0d` | unchanged | |
| important | `#9b59b6` / `#1a0d27` | unchanged | |

---

## Icon System

Adds `lucide-react` as a frontend dependency. Replaces text-label and bare-Unicode-glyph buttons with consistent line icons (2px stroke) across:

| File | Change |
|---|---|
| `src/ink/InkCanvas.tsx` | Tool labels ("Pen", "Eraser", "Line", "Circle", "Rect", "Arrow") and "↩"/"↪" → `PenLine`, `Eraser`, `Minus`, `Circle`, `Square`, `MoveUpRight`, `Undo2`, `Redo2` icons |
| `src/editor/NoteEditor.tsx` | "✏ Ink" → `PenLine` icon + existing label |
| `src/components/TreeNode.tsx` | "▸"/"▾" text toggles, "×" delete → `ChevronRight`/`ChevronDown`, `Trash2` |
| `src/components/FolderContextMenu.tsx` | Text-only menu items → icon (`Pencil`, `Trash2`) + label |
| `src/components/TabBar.tsx` | "×" close → `X` |
| `src/components/BacklinksPanel.tsx` | Text chevron toggle → `ChevronDown`/`ChevronRight` |
| `src/components/Sidebar.tsx` | "New note"/"New folder" text buttons → `FilePlus`/`FolderPlus` icon + label |
| `src/components/SearchModal.tsx` | Add `Search` icon in the input |
| `src/components/ImportButton.tsx` | Text button → `FileUp` icon + label |
| `src/editor/extensions/Callout.tsx` | Currently text-label only ("NOTE", "TIP", ...), no icon. Add a Lucide icon per type next to the label: `Info` (note/info), `Lightbulb` (tip), `TriangleAlert` (warning), `CircleX` (danger), `Star` (important) — plus the tip color/hue change above |

All buttons retain their existing `aria-label`/text content for accessibility — icons are additive. No existing test asserts on the old text/emoji content (verified via search across `*.test.{ts,tsx}`), so this is safe to change freely.

---

## Testing / Verification

- `npm run typecheck` and `npm run lint` after the icon swap, since it changes TSX imports/props.
- No unit test changes expected (presentational-only change, no test currently asserts on button text/icons).
- Manual pass in `npm run tauri dev` (or `npm run dev` in-browser) walking: sidebar (folder tree, new note/folder, search-open), tab bar, editor insert-toolbar, ink canvas toolbar (all tools + undo/redo), search modal, and each of the 5 callout types — confirming no visual regression and that the new palette/icons render correctly.

---

## Sequencing Note

This is project 1 of 4 in a broader "make the app awesome" polish effort:

1. **Visual design system** (this doc) — tokens + icons, foundational.
2. Ink toolbar & canvas polish (icon-based toolbar layout, tool affordances) — builds on this doc's icon set.
3. Editor feel (slash menu, block interactions).
4. Navigation & organization (sidebar/tree/tags/search refinement).

Projects 2-4 each get their own brainstorming → spec → plan cycle once this one ships.

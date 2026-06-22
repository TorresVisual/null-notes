> **A Markdown-first note-taking application designed specifically for computer science students. It provides the best environment for writing mathematical and programming notes while integrating naturally with existing development workflows rather than replacing the IDE.**

---

## What the app should do

### Best-in-class Markdown editing

This is the heart of the application.

Instead of a generic editor, make it feel purpose-built for STEM.

* live preview while typing
* no proprietary format (.md only)
* full GitHub Markdown
* KaTeX
* Mermaid
* syntax highlighted code blocks
* callouts
* tables
* task lists
* collapsible sections
* backlinks/wiki links
* templates

Think **Obsidian-quality editing** but focused on university work.

---

### Digital ink

This is one of the biggest differentiators.

Each note should optionally contain handwritten sections.

For example

```
Lecture 7

Text explaining the theorem...

[Ink Block]

(handwritten proof)

More markdown...
```

Instead of handwriting being an external attachment.

Even better if ink remains vector based instead of becoming a bitmap.

---

### PDF-first workflow

Most CS students constantly work from exercise sheets.

I think this should be a flagship feature.

```
Import PDF

↓

OCR

↓

Recover equations

↓

Generate Markdown

↓

Split into exercises

↓

Create solution template
```

Result:

```md
# Exercise Sheet 4

## Task 1

...

### Solution

---

## Task 2

...

### Solution

```

This should have add next task so users dont have to worry about how much space each task requires

That alone would save students hours every semester.

---

### AI-friendly notes

We want to integrate a terminal in which i can do 'claude' and work with the opened .md file

---

## IDE integration instead of IDE replacement

This is where your existing IDE comes in.

Ideas:

### Open project documentation

Suppose

```
project/

README.md

docs/

notes/

design.md
```

The note app can open these directly.

No importing.

---

### "Open in IDE"

Every code block could have

```
Open in IDE
```

which launches your IDE at the corresponding file.

---


### Deep links

Imagine clicking

```
src/main.cpp:58
```

inside your notes.

Your IDE opens exactly there.

---

### Project Notes

Every project automatically gets

```
notes/

Architecture.md

Meeting.md

Research.md

Todo.md

```

without polluting source folders.

---

## Features I'd add

### Equation snippets

Type

```
/gradient
```

↓

```
\nabla f(x)
```

---

### Proof blocks

```
Theorem

Proof

Corollary

Lemma

Example
```

---

### Algorithm blocks

```
Complexity

Pseudo code

Implementation

References
```

---

### Code execution

Not a full IDE.

Just enough to execute

Python

C++

Java // less needed

Rust // less needed

snippets for quick experimentation.

---

### Diagram support

Mermaid

Graphviz

TikZ export

---

### Better search

Search should include

* equations
* code
* handwritten notes
* PDFs

---

## Tech stack

Since your IDE already exists, I'd optimize for desktop performance rather than web compatibility:

* **Tauri + Rust** for the desktop shell and backend.
* **React + TypeScript** for the UI.
* **CodeMirror 6** as the Markdown editor.
* **Excalidraw's drawing engine or a custom vector-ink canvas** for pen support.
* **SQLite** for metadata (tags, backlinks, search index), while keeping the notes themselves as plain Markdown files.
* **Git or Syncthing** for free synchronization instead of maintaining your own cloud service.

---

## One feature I would add that almost no note apps have

A **workspace**.

Instead of just folders:

```
Analysis II

├── Lecture Notes
├── Exercise Sheets
├── Formula Sheet
├── Past Exams
├── PDFs
├── AI Chats
└── Handwritten Notes
```

The workspace remembers:

* open PDFs
* opened notes
* split panes
* handwriting canvases
* AI conversations
* recent searches

So when you open "Analysis II" next week, you're immediately back where you left off.

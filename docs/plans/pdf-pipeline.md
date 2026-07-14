# null-notes PDF Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the PDF import pipeline — drag a university exercise sheet into the app, get a structured Markdown solution template with LaTeX equations preserved, split per exercise, with a frontend progress UI.

**Architecture:** The Rust backend orchestrates the pipeline in stages: pdfium-render renders each page to a PNG image; leptess (Tesseract) extracts text with bounding boxes; pix2tex (Python subprocess with a bundled venv) converts equation regions to LaTeX; a pure-Rust parser merges results and detects exercise boundaries; the result is JSON-serialized TipTap content sent to the frontend. Progress is streamed via Tauri events. The Python model (~500MB) is bundled at build time.

**Tech Stack:** Tauri 2, pdfium-render 0.8, leptess 0.14, Python 3 venv (pix2tex), tokio, serde_json, Tauri event system, React, TypeScript, ExerciseBlock TipTap node

**Prerequisite:** Foundation plan complete. Ink plan complete.

## Global Constraints

- Tauri 2 only — `@tauri-apps/api/core` for `invoke`, `@tauri-apps/api/event` for `listen`
- TypeScript strict mode — no `any`
- No `.unwrap()` / `.expect()` outside `#[cfg(test)]` in Rust
- `cargo clippy -- -D warnings` must pass clean
- All Tauri commands return `Result<T, String>`
- pix2tex runs as a Python subprocess — never in-process
- The pipeline is async end-to-end; the frontend polls progress via Tauri events
- Performance target: 20-page sheet under 10 seconds on a modern laptop
- pix2tex output is best-effort — users edit the result

---

## File Map

### src-tauri/

| File | Responsibility |
|---|---|
| `src/pdf/mod.rs` | `PdfPipeline` orchestrator + public `run()` function |
| `src/pdf/renderer.rs` | pdfium-render wrapper — PDF → page images |
| `src/pdf/ocr.rs` | Tesseract wrapper — image → text + bounding boxes |
| `src/pdf/equations.rs` | pix2tex subprocess wrapper — region image → LaTeX |
| `src/pdf/parser.rs` | Merges OCR + equations, detects exercise boundaries |
| `src/pdf/models.rs` | `PdfPage`, `TextBox`, `Exercise`, `PipelineProgress` |
| `src/commands/pdf.rs` | `import_pdf` Tauri command |
| `src/commands/mod.rs` | Add `pub mod pdf` |
| `src/main.rs` | Register `import_pdf` command |

### src/ (frontend)

| File | Responsibility |
|---|---|
| `pdf/types.ts` | `Exercise`, `PipelineProgress`, `ImportResult` types |
| `pdf/usePdfImport.ts` | Hook — triggers import, listens to progress events |
| `editor/extensions/ExerciseBlock.ts` | TipTap block node for a single exercise + solution |
| `editor/extensions/index.ts` | Register `ExerciseBlock` |
| `components/ImportButton.tsx` | Drag-and-drop / click-to-open PDF import UI |

---

## Task 1: Bundle pix2tex Python Venv

**Files:**
- Create: `scripts/setup-pix2tex.sh`
- Create: `src-tauri/build.rs`

**Interfaces:**
- Produces: `pix2tex-venv/` directory alongside the binary at runtime, readable as `std::env::current_exe()?.parent()?.join("pix2tex-venv")`

- [ ] **Step 1: Write `scripts/setup-pix2tex.sh`**

```bash
#!/usr/bin/env bash
set -e
VENV="src-tauri/pix2tex-venv"
python3 -m venv "$VENV"
"$VENV/bin/pip" install --upgrade pip
"$VENV/bin/pip" install pix2tex[gui]
echo "pix2tex venv ready at $VENV"
```

- [ ] **Step 2: Run the script once during dev setup**

```bash
bash scripts/setup-pix2tex.sh
```

Expected: `src-tauri/pix2tex-venv/` created, `pix2tex` command available.

- [ ] **Step 3: Add venv to `.gitignore`**

Add to `.gitignore`:

```
src-tauri/pix2tex-venv/
```

- [ ] **Step 4: Create `src-tauri/build.rs`** to copy the venv into the Tauri bundle

```rust
fn main() {
    let venv_src = std::path::Path::new("pix2tex-venv");
    if venv_src.exists() {
        println!("cargo:rerun-if-changed=pix2tex-venv");
    }
    tauri_build::build();
}
```

- [ ] **Step 5: Add `tauri-build` to `[build-dependencies]` in `Cargo.toml`**

```toml
[build-dependencies]
tauri-build = { version = "2", features = [] }
```

- [ ] **Step 6: Add resource path to `src-tauri/tauri.conf.json`**

Under `"bundle"`, add:

```json
"resources": {
  "pix2tex-venv/**": "pix2tex-venv/"
}
```

- [ ] **Step 7: Commit**

```bash
git add scripts/setup-pix2tex.sh src-tauri/build.rs src-tauri/Cargo.toml src-tauri/tauri.conf.json .gitignore
git commit -m "chore: pix2tex venv setup script and bundle config"
```

---

## Task 2: Rust PDF Pipeline Models

**Files:**
- Create: `src-tauri/src/pdf/models.rs`
- Create: `src-tauri/src/pdf/mod.rs`

**Interfaces:**
- Produces: `PdfPage`, `TextBox`, `Exercise`, `PipelineProgress` structs

- [ ] **Step 1: Write `src-tauri/src/pdf/models.rs`**

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone)]
pub struct PdfPage {
    pub index: usize,
    pub image_path: String,   // temp PNG path
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextBox {
    pub text: String,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub is_equation: bool,
    pub latex: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Exercise {
    pub index: usize,
    pub title: String,
    pub content_blocks: Vec<TextBox>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineProgress {
    pub stage: String,
    pub page: usize,
    pub total_pages: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub title: String,
    pub exercises: Vec<Exercise>,
}
```

- [ ] **Step 2: Write `src-tauri/src/pdf/mod.rs`**

```rust
pub mod equations;
pub mod models;
pub mod ocr;
pub mod parser;
pub mod renderer;
```

- [ ] **Step 3: Add `mod pdf` to `src-tauri/src/main.rs`**

```rust
mod pdf;
```

- [ ] **Step 4: Add Cargo dependencies**

In `[dependencies]` of `Cargo.toml`:

```toml
pdfium-render = { version = "0.8", features = ["image"] }
leptess = "0.14"
image = "0.24"
tempfile = "3"
```

- [ ] **Step 5: Verify Rust compiles**

```bash
cargo build --manifest-path src-tauri/Cargo.toml
```

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/pdf/ src-tauri/src/main.rs src-tauri/Cargo.toml
git commit -m "feat: PDF pipeline models and module skeleton"
```

---

## Task 3: pdfium PDF Page Renderer

**Files:**
- Create: `src-tauri/src/pdf/renderer.rs`

**Interfaces:**
- Produces: `render_pages(pdf_path: &Path) -> anyhow::Result<Vec<PdfPage>>`

- [ ] **Step 1: Write failing test in `src-tauri/src/pdf/renderer.rs`**

```rust
use super::models::PdfPage;
use anyhow::Result;
use std::path::Path;

pub async fn render_pages(pdf_path: &Path) -> Result<Vec<PdfPage>> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[tokio::test]
    #[ignore = "requires test PDF fixture"]
    async fn test_render_returns_pages() {
        let pdf = PathBuf::from("tests/fixtures/sample.pdf");
        if !pdf.exists() {
            eprintln!("skipping — no fixture");
            return;
        }
        let pages = render_pages(&pdf).await.unwrap();
        assert!(!pages.is_empty());
        for page in &pages {
            assert!(Path::new(&page.image_path).exists());
        }
    }
}
```

- [ ] **Step 2: Run test to confirm it compiles (is ignored)**

```bash
cargo test --manifest-path src-tauri/Cargo.toml pdf::renderer
```

Expected: 0 tests run (test is ignored).

- [ ] **Step 3: Implement `render_pages`**

```rust
use pdfium_render::prelude::*;
use std::path::Path;
use super::models::PdfPage;
use anyhow::Result;

pub async fn render_pages(pdf_path: &Path) -> Result<Vec<PdfPage>> {
    let pdfium = Pdfium::new(
        Pdfium::bind_to_library(Pdfium::pdfium_platform_library_name_at_path("./"))
            .or_else(|_| Pdfium::bind_to_system_library())?,
    );

    let doc = pdfium.load_pdf_from_file(pdf_path, None)?;
    let tmp_dir = tempfile::tempdir()?;
    let mut pages = Vec::new();

    for (index, page) in doc.pages().iter().enumerate() {
        let bitmap = page.render_with_config(
            &PdfRenderConfig::new()
                .set_target_width(1700)
                .set_maximum_height(2200),
        )?;

        let img_path = tmp_dir.path().join(format!("page-{}.png", index));
        bitmap.as_image().save(&img_path)?;

        let (width, height) = (bitmap.width() as u32, bitmap.height() as u32);
        pages.push(PdfPage {
            index,
            image_path: img_path.to_string_lossy().into_owned(),
            width,
            height,
        });
    }

    std::mem::forget(tmp_dir); // keep alive; caller responsible for cleanup
    Ok(pages)
}
```

- [ ] **Step 4: Verify Rust compiles**

```bash
cargo build --manifest-path src-tauri/Cargo.toml
```

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/pdf/renderer.rs
git commit -m "feat: pdfium PDF page renderer"
```

---

## Task 4: Tesseract OCR

**Files:**
- Create: `src-tauri/src/pdf/ocr.rs`

**Interfaces:**
- Consumes: `PdfPage` (Task 2)
- Produces: `ocr_page(page: &PdfPage) -> anyhow::Result<Vec<TextBox>>`

- [ ] **Step 1: Write failing tests in `src-tauri/src/pdf/ocr.rs`**

```rust
use super::models::{PdfPage, TextBox};
use anyhow::Result;

pub async fn ocr_page(page: &PdfPage) -> Result<Vec<TextBox>> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore = "requires Tesseract installed"]
    async fn test_ocr_returns_text() {
        // Create a minimal white PNG with text rendered by the system
        // This test is a smoke test — we only check it doesn't panic
        let page = PdfPage {
            index: 0,
            image_path: "tests/fixtures/page-0.png".into(),
            width: 1700,
            height: 2200,
        };
        if !std::path::Path::new(&page.image_path).exists() {
            return;
        }
        let boxes = ocr_page(&page).await.unwrap();
        assert!(!boxes.is_empty());
    }
}
```

- [ ] **Step 2: Implement `ocr_page`**

```rust
use leptess::LepTess;
use std::path::Path;

pub async fn ocr_page(page: &PdfPage) -> Result<Vec<TextBox>> {
    let image_path = page.image_path.clone();
    let page_width = page.width as f32;
    let page_height = page.height as f32;

    tokio::task::spawn_blocking(move || {
        let mut lt = LepTess::new(None, "eng")?;
        lt.set_image(Path::new(&image_path))?;
        lt.set_variable(leptess::Variable::TesseditPagesegMode, "1")?;

        let words = lt.get_component_images(leptess::capi::TessPageIteratorLevel_RIL_WORD, true)?;
        let mut boxes = Vec::new();

        for (_, bbox, _, _) in words {
            let text = lt.get_utf8_text().unwrap_or_default().trim().to_string();
            if text.is_empty() {
                continue;
            }
            boxes.push(TextBox {
                text,
                x: bbox.x as f32 / page_width,
                y: bbox.y as f32 / page_height,
                w: bbox.w as f32 / page_width,
                h: bbox.h as f32 / page_height,
                is_equation: false,
                latex: None,
            });
        }
        Ok(boxes)
    })
    .await?
}
```

- [ ] **Step 3: Verify Rust compiles**

```bash
cargo build --manifest-path src-tauri/Cargo.toml
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/pdf/ocr.rs
git commit -m "feat: Tesseract OCR wrapper"
```

---

## Task 5: pix2tex Equation Extraction

**Files:**
- Create: `src-tauri/src/pdf/equations.rs`

**Interfaces:**
- Consumes: `PdfPage`, bounding box of equation region
- Produces: `extract_latex(image_path: &str, x: u32, y: u32, w: u32, h: u32, venv_path: &Path) -> anyhow::Result<String>`

- [ ] **Step 1: Write failing tests in `src-tauri/src/pdf/equations.rs`**

```rust
use anyhow::Result;
use std::path::Path;

pub async fn extract_latex(
    image_path: &str,
    x: u32,
    y: u32,
    w: u32,
    h: u32,
    venv_path: &Path,
) -> Result<String> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore = "requires pix2tex venv"]
    async fn test_extract_returns_latex() {
        let venv = std::path::PathBuf::from("pix2tex-venv");
        if !venv.exists() {
            return;
        }
        let result = extract_latex("tests/fixtures/equation.png", 0, 0, 200, 50, &venv).await;
        assert!(result.is_ok());
    }
}
```

- [ ] **Step 2: Implement `extract_latex`**

```rust
use anyhow::{Context, Result};
use image::GenericImageView;
use std::path::Path;

pub async fn extract_latex(
    image_path: &str,
    x: u32,
    y: u32,
    w: u32,
    h: u32,
    venv_path: &Path,
) -> Result<String> {
    let crop_path = {
        let img = image::open(image_path)?;
        let (img_w, img_h) = img.dimensions();
        let bx = x.min(img_w.saturating_sub(1));
        let by = y.min(img_h.saturating_sub(1));
        let bw = w.min(img_w - bx);
        let bh = h.min(img_h - by);
        let cropped = img.crop_imm(bx, by, bw, bh);
        let tmp = tempfile::NamedTempFile::new()?.into_temp_path();
        let crop_str = tmp.to_string_lossy().into_owned() + ".png";
        cropped.save(&crop_str)?;
        crop_str
    };

    #[cfg(unix)]
    let python = venv_path.join("bin/python");
    #[cfg(windows)]
    let python = venv_path.join("Scripts/python.exe");

    let output = tokio::process::Command::new(python)
        .args(["-m", "pix2tex.cli", "--", &crop_path])
        .output()
        .await
        .context("failed to run pix2tex")?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("pix2tex failed: {}", err);
    }

    let latex = String::from_utf8(output.stdout)?.trim().to_string();
    Ok(latex)
}
```

- [ ] **Step 3: Verify Rust compiles**

```bash
cargo build --manifest-path src-tauri/Cargo.toml
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/pdf/equations.rs
git commit -m "feat: pix2tex subprocess equation extractor"
```

---

## Task 6: Exercise Parser

**Files:**
- Create: `src-tauri/src/pdf/parser.rs`

**Interfaces:**
- Consumes: `Vec<TextBox>` (all pages merged)
- Produces: `parse_exercises(boxes: Vec<TextBox>) -> Vec<Exercise>`

- [ ] **Step 1: Write failing tests in `src-tauri/src/pdf/parser.rs`**

```rust
use super::models::{Exercise, TextBox};

pub fn parse_exercises(boxes: Vec<TextBox>) -> Vec<Exercise> {
    todo!()
}

fn is_exercise_header(text: &str) -> bool {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tbox(text: &str) -> TextBox {
        TextBox { text: text.into(), x: 0.0, y: 0.0, w: 1.0, h: 0.05, is_equation: false, latex: None }
    }

    #[test]
    fn test_is_exercise_header_matches_common_patterns() {
        assert!(is_exercise_header("Exercise 1"));
        assert!(is_exercise_header("Task 2"));
        assert!(is_exercise_header("1."));
        assert!(is_exercise_header("Problem 3:"));
        assert!(!is_exercise_header("The quick brown fox"));
        assert!(!is_exercise_header("f(x) = x^2"));
    }

    #[test]
    fn test_parse_exercises_splits_on_headers() {
        let boxes = vec![
            tbox("Exercise 1"),
            tbox("Compute the integral"),
            tbox("Exercise 2"),
            tbox("Show that the series converges"),
        ];
        let exercises = parse_exercises(boxes);
        assert_eq!(exercises.len(), 2);
        assert_eq!(exercises[0].title, "Exercise 1");
        assert_eq!(exercises[1].title, "Exercise 2");
    }

    #[test]
    fn test_parse_exercises_empty_input() {
        let exercises = parse_exercises(vec![]);
        assert!(exercises.is_empty());
    }

    #[test]
    fn test_parse_exercises_no_headers_returns_one_block() {
        let boxes = vec![tbox("Some text"), tbox("More text")];
        let exercises = parse_exercises(boxes);
        assert_eq!(exercises.len(), 1);
        assert_eq!(exercises[0].title, "Content");
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cargo test --manifest-path src-tauri/Cargo.toml pdf::parser
```

Expected: FAIL with `not yet implemented`.

- [ ] **Step 3: Implement the functions**

```rust
use super::models::{Exercise, TextBox};
use regex::Regex;

fn is_exercise_header(text: &str) -> bool {
    let text = text.trim();
    let patterns = [
        r"^(?i)(exercise|task|problem|aufgabe)\s+\d+",
        r"^\d+\.",
        r"^(?i)(exercise|task|problem)\s+\d+\s*:",
    ];
    for pat in &patterns {
        if Regex::new(pat).map(|r| r.is_match(text)).unwrap_or(false) {
            return true;
        }
    }
    false
}

pub fn parse_exercises(boxes: Vec<TextBox>) -> Vec<Exercise> {
    if boxes.is_empty() {
        return Vec::new();
    }

    let mut exercises: Vec<Exercise> = Vec::new();
    let mut current_title = String::new();
    let mut current_blocks: Vec<TextBox> = Vec::new();
    let mut found_header = false;
    let mut index = 0;

    for b in boxes {
        if is_exercise_header(&b.text) {
            if found_header || !current_blocks.is_empty() {
                exercises.push(Exercise {
                    index,
                    title: if current_title.is_empty() { "Content".into() } else { current_title.clone() },
                    content_blocks: std::mem::take(&mut current_blocks),
                });
                index += 1;
            }
            current_title = b.text.clone();
            found_header = true;
        } else {
            current_blocks.push(b);
        }
    }

    if !current_blocks.is_empty() || found_header {
        exercises.push(Exercise {
            index,
            title: if current_title.is_empty() { "Content".into() } else { current_title },
            content_blocks: current_blocks,
        });
    }

    exercises
}
```

- [ ] **Step 4: Add `regex` to `Cargo.toml` dependencies**

```toml
regex = "1"
```

- [ ] **Step 5: Run tests**

```bash
cargo test --manifest-path src-tauri/Cargo.toml pdf::parser
```

Expected: all 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/pdf/parser.rs src-tauri/Cargo.toml
git commit -m "feat: exercise boundary parser with regex patterns"
```

---

## Task 7: Pipeline Orchestrator

**Files:**
- Modify: `src-tauri/src/pdf/mod.rs`

**Interfaces:**
- Consumes: all pdf sub-modules (Tasks 3-6)
- Produces: `pub async fn run(pdf_path: &Path, venv_path: &Path, emit: impl Fn(PipelineProgress)) -> anyhow::Result<ImportResult>`

- [ ] **Step 1: Write `run` function in `src-tauri/src/pdf/mod.rs`**

```rust
pub mod equations;
pub mod models;
pub mod ocr;
pub mod parser;
pub mod renderer;

use anyhow::Result;
use std::path::Path;
use models::{ImportResult, PipelineProgress};

pub async fn run(
    pdf_path: &Path,
    venv_path: &Path,
    emit: impl Fn(PipelineProgress),
) -> Result<ImportResult> {
    let pages = renderer::render_pages(pdf_path).await?;
    let total_pages = pages.len();
    let title = pdf_path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Document".into());

    let mut all_boxes = Vec::new();

    for page in &pages {
        emit(PipelineProgress {
            stage: "OCR".into(),
            page: page.index + 1,
            total_pages,
        });
        let mut boxes = ocr::ocr_page(page).await?;

        for b in &mut boxes {
            let text = b.text.trim();
            let looks_like_equation = text.contains('=')
                && text.chars().any(|c| c.is_ascii_uppercase())
                && text.len() < 80;
            if looks_like_equation {
                emit(PipelineProgress {
                    stage: "Equations".into(),
                    page: page.index + 1,
                    total_pages,
                });
                if let Ok(latex) = equations::extract_latex(
                    &page.image_path,
                    (b.x * page.width as f32) as u32,
                    (b.y * page.height as f32) as u32,
                    (b.w * page.width as f32) as u32,
                    (b.h * page.height as f32) as u32,
                    venv_path,
                )
                .await
                {
                    b.is_equation = true;
                    b.latex = Some(latex);
                }
            }
        }
        all_boxes.extend(boxes);
    }

    emit(PipelineProgress {
        stage: "Parsing".into(),
        page: total_pages,
        total_pages,
    });
    let exercises = parser::parse_exercises(all_boxes);

    Ok(ImportResult { title, exercises })
}
```

- [ ] **Step 2: Verify Rust compiles**

```bash
cargo build --manifest-path src-tauri/Cargo.toml
```

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/pdf/mod.rs
git commit -m "feat: PDF pipeline orchestrator"
```

---

## Task 8: `import_pdf` Tauri Command

**Files:**
- Create: `src-tauri/src/commands/pdf.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/main.rs`

**Interfaces:**
- Produces Tauri command: `import_pdf(pdf_path: String) -> Result<ImportResult, String>`
- Emits Tauri events: `pdf://progress` with `PipelineProgress` payload

- [ ] **Step 1: Write `src-tauri/src/commands/pdf.rs`**

```rust
use tauri::{AppHandle, Emitter};
use crate::pdf::{self, models::ImportResult};

fn venv_path() -> std::path::PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.join("pix2tex-venv")))
        .unwrap_or_else(|| std::path::PathBuf::from("pix2tex-venv"))
}

#[tauri::command]
pub async fn import_pdf(
    pdf_path: String,
    app: AppHandle,
) -> Result<ImportResult, String> {
    let path = std::path::Path::new(&pdf_path);
    let venv = venv_path();

    pdf::run(path, &venv, |progress| {
        let _ = app.emit("pdf://progress", &progress);
    })
    .await
    .map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Add `pub mod pdf` to `src-tauri/src/commands/mod.rs`**

```rust
pub mod ink;
pub mod notes;
pub mod pdf;
pub mod workspace;
```

- [ ] **Step 3: Register `import_pdf` in `src-tauri/src/main.rs`**

Add to `invoke_handler`:

```rust
commands::pdf::import_pdf,
```

- [ ] **Step 4: Clippy and compile**

```bash
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/pdf.rs src-tauri/src/commands/mod.rs src-tauri/src/main.rs
git commit -m "feat: import_pdf Tauri command with progress events"
```

---

## Task 9: ExerciseBlock TipTap Node

**Files:**
- Create: `src/editor/extensions/ExerciseBlock.ts`
- Modify: `src/editor/extensions/index.ts`

**Interfaces:**
- Consumes: `Exercise` type from `pdf/types.ts`
- Produces: `ExerciseBlock` TipTap node — renders exercise content + empty Solution section
- Markdown output: standard `## Task N` / `### Solution` headings

- [ ] **Step 1: Write `src/pdf/types.ts`**

```ts
export interface TextBox {
  text: string
  x: number
  y: number
  w: number
  h: number
  isEquation: boolean
  latex: string | null
}

export interface Exercise {
  index: number
  title: string
  contentBlocks: TextBox[]
}

export interface PipelineProgress {
  stage: string
  page: number
  totalPages: number
}

export interface ImportResult {
  title: string
  exercises: Exercise[]
}
```

- [ ] **Step 2: Write `src/editor/extensions/ExerciseBlock.ts`**

```ts
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import type { Exercise } from '../../pdf/types'

function renderExercise(ex: Exercise): string {
  const blocks = ex.contentBlocks
    .map((b) => (b.isEquation && b.latex ? `$$${b.latex}$$` : b.text))
    .join('\n\n')
  return `## ${ex.title}\n\n${blocks}\n\n### Solution\n\n`
}

export const ExerciseBlock = Node.create({
  name: 'exerciseBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      exercise: { default: null },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="exercise-block"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'exercise-block' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(({ node }) => {
      const ex = node.attrs['exercise'] as Exercise | null
      if (!ex) return null
      return (
        <div className="exercise-block">
          <h2>{ex.title}</h2>
          {ex.contentBlocks.map((b, i) => (
            <p key={i}>{b.isEquation && b.latex ? `$$${b.latex}$$` : b.text}</p>
          ))}
          <h3>Solution</h3>
        </div>
      )
    })
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: { write: (s: string) => void }, node: { attrs: { exercise: Exercise } }) {
          state.write(renderExercise(node.attrs.exercise))
        },
      },
    }
  },
})
```

- [ ] **Step 3: Register in `src/editor/extensions/index.ts`**

```ts
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import Placeholder from '@tiptap/extension-placeholder'
import { InkBlock } from './InkBlock'
import { ExerciseBlock } from './ExerciseBlock'

export const coreExtensions = [
  StarterKit,
  Markdown.configure({
    html: false,
    transformPastedText: true,
    transformCopiedText: true,
  }),
  Placeholder.configure({
    placeholder: 'Start writing…',
  }),
  InkBlock,
  ExerciseBlock,
]
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/pdf/types.ts src/editor/extensions/ExerciseBlock.ts src/editor/extensions/index.ts
git commit -m "feat: ExerciseBlock TipTap node"
```

---

## Task 10: Frontend Import UI

**Files:**
- Create: `src/pdf/usePdfImport.ts`
- Create: `src/components/ImportButton.tsx`
- Modify: `src/components/Sidebar.tsx`

**Interfaces:**
- Consumes: `import_pdf` command, `pdf://progress` Tauri event, `ExerciseBlock` node
- Produces: `<ImportButton />` that inserts exercises into the active note after import

- [ ] **Step 1: Write `src/pdf/usePdfImport.ts`**

```ts
import { useState, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'
import type { ImportResult, PipelineProgress } from './types'

export function usePdfImport() {
  const [progress, setProgress] = useState<PipelineProgress | null>(null)
  const [isImporting, setIsImporting] = useState(false)

  const importPdf = useCallback(async (): Promise<ImportResult | null> => {
    const selected = await open({
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      multiple: false,
    })
    if (!selected || Array.isArray(selected)) return null

    setIsImporting(true)
    const unlisten = await listen<PipelineProgress>('pdf://progress', (e) => {
      setProgress(e.payload)
    })

    try {
      const result = await invoke<ImportResult>('import_pdf', { pdfPath: selected })
      return result
    } finally {
      unlisten()
      setIsImporting(false)
      setProgress(null)
    }
  }, [])

  return { importPdf, isImporting, progress }
}
```

- [ ] **Step 2: Write `src/components/ImportButton.tsx`**

```tsx
import { usePdfImport } from '../pdf/usePdfImport'
import { useWorkspaceStore } from '../store/workspace'
import { api } from '../lib/tauri'
import type { Editor } from '@tiptap/react'

interface ImportButtonProps {
  editor: Editor | null
}

export function ImportButton({ editor }: ImportButtonProps) {
  const { importPdf, isImporting, progress } = usePdfImport()
  const workspacePath = useWorkspaceStore((s) => s.path)

  async function handleImport() {
    if (!editor || !workspacePath) return
    const result = await importPdf()
    if (!result) return

    const noteTitle = result.title
    const note = await api.notes.create(workspacePath, noteTitle)

    for (const exercise of result.exercises) {
      editor.chain().insertContent({
        type: 'exerciseBlock',
        attrs: { exercise },
      }).run()
    }

    await api.notes.save(note.path, editor.storage.markdown.getMarkdown())
  }

  return (
    <div className="import-button">
      <button onClick={handleImport} disabled={isImporting || !workspacePath}>
        {isImporting ? 'Importing…' : 'Import PDF'}
      </button>
      {isImporting && progress && (
        <p className="import-progress">
          {progress.stage} — page {progress.page}/{progress.totalPages}
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Typecheck and smoke test**

```bash
npm run typecheck
npm run tauri dev
```

Expected: TypeScript passes. Import a PDF and confirm progress events stream and exercises appear.

- [ ] **Step 4: Commit**

```bash
git add src/pdf/usePdfImport.ts src/components/ImportButton.tsx
git commit -m "feat: PDF import UI with progress streaming"
```

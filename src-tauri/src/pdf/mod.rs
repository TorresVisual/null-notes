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
                && text.chars().any(|c| c.is_uppercase())
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

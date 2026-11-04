use super::compose::SIDECAR_SUFFIXES;
use super::notes::require_within_workspace;
use std::fs::File;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

/// Every file to bundle for `source`, paired with its zip entry name.
/// A note keeps its sidecars beside it at the archive root, so the relative
/// links inside the `.md` stay valid. A folder is bundled whole under its own
/// name, minus dot-entries (`.git`, `.workspace.json`, the trash).
fn collect(source: &Path) -> anyhow::Result<Vec<(PathBuf, String)>> {
    let mut files = Vec::new();
    if source.is_dir() {
        let base = source.parent().unwrap_or(Path::new(""));
        walk(source, base, &mut files)?;
    } else {
        let base = source.parent().unwrap_or(Path::new(""));
        files.push((source.to_path_buf(), entry_name(source, base)));
        for suffix in SIDECAR_SUFFIXES {
            let dir = PathBuf::from(super::sidecar_dir_for(&source.to_string_lossy(), suffix));
            if dir.is_dir() {
                walk(&dir, base, &mut files)?;
            }
        }
    }
    Ok(files)
}

fn walk(dir: &Path, base: &Path, files: &mut Vec<(PathBuf, String)>) -> anyhow::Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        if entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        let path = entry.path();
        if entry.file_type()?.is_dir() {
            walk(&path, base, files)?;
        } else if entry.file_type()?.is_file() {
            let name = entry_name(&path, base);
            files.push((path, name));
        }
    }
    Ok(())
}

fn entry_name(path: &Path, base: &Path) -> String {
    path.strip_prefix(base)
        .unwrap_or(path)
        .components()
        .map(|c| c.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

fn write_zip(source: &Path, dest: &Path) -> anyhow::Result<()> {
    let files = collect(source)?;
    let mut zip = ZipWriter::new(File::create(dest)?);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    for (path, name) in files {
        zip.start_file(name, options)?;
        io::copy(&mut File::open(path)?, &mut zip)?;
    }
    zip.finish()?.flush()?;
    Ok(())
}

#[tauri::command]
pub async fn export_zip(workspace: String, source: String, dest: String) -> Result<(), String> {
    require_within_workspace(&workspace, &source)?;
    tokio::task::spawn_blocking(move || write_zip(Path::new(&source), Path::new(&dest)))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    fn names(zip_path: &Path) -> BTreeSet<String> {
        let mut archive = zip::ZipArchive::new(File::open(zip_path).unwrap()).unwrap();
        (0..archive.len())
            .map(|i| archive.by_index(i).unwrap().name().to_string())
            .collect()
    }

    fn touch(path: &Path) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, "x").unwrap();
    }

    #[test]
    fn note_export_bundles_its_sidecars_and_nothing_else() {
        let ws = tempfile::tempdir().unwrap();
        let root = ws.path();
        touch(&root.join("Lecture 7.md"));
        touch(&root.join("Lecture 7.assets/fig 1.png"));
        touch(&root.join("Lecture 7.ink/a.svg"));
        touch(&root.join("Other.md"));
        touch(&root.join("Other.assets/b.png"));
        let dest = root.join("out.zip");

        write_zip(&root.join("Lecture 7.md"), &dest).unwrap();

        assert_eq!(
            names(&dest),
            BTreeSet::from([
                "Lecture 7.md".to_string(),
                "Lecture 7.assets/fig 1.png".to_string(),
                "Lecture 7.ink/a.svg".to_string(),
            ])
        );
    }

    #[test]
    fn folder_export_nests_under_the_folder_and_skips_dot_entries() {
        let ws = tempfile::tempdir().unwrap();
        let root = ws.path();
        touch(&root.join("Course/Week 1.md"));
        touch(&root.join("Course/Week 1.assets/x.png"));
        touch(&root.join("Course/sub/Deep.md"));
        touch(&root.join("Course/.workspace.json"));
        let dest = root.join("out.zip");

        write_zip(&root.join("Course"), &dest).unwrap();

        assert_eq!(
            names(&dest),
            BTreeSet::from([
                "Course/Week 1.md".to_string(),
                "Course/Week 1.assets/x.png".to_string(),
                "Course/sub/Deep.md".to_string(),
            ])
        );
    }
}

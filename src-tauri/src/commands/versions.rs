use super::notes::{now_ms, write_atomic};
use std::path::{Path, PathBuf};

const KEEP: usize = 10;

// FNV-1a rather than `DefaultHasher`, whose output may change between Rust
// releases and would silently orphan every existing history.
fn note_key(note_path: &str) -> String {
    let hash = note_path.bytes().fold(0xcbf2_9ce4_8422_2325_u64, |h, b| {
        (h ^ u64::from(b)).wrapping_mul(0x0100_0000_01b3)
    });
    format!("{hash:016x}")
}

async fn sorted_versions(dir: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    if let Ok(mut entries) = tokio::fs::read_dir(dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if path.extension().is_some_and(|ext| ext == "md") {
                found.push(path);
            }
        }
    }
    found.sort();
    found
}

/// Keeps the last [`KEEP`] distinct contents of a note under
/// `<app-data>/versions/<note-key>/`, oldest pruned first. Machine-local on
/// purpose (storage boundary): a safety net for workspaces without Git, not
/// note content.
pub(super) async fn snapshot(app_data_dir: &Path, note_path: &str, content: &str) {
    if let Err(e) = try_snapshot(app_data_dir, note_path, content).await {
        super::error_log::append_entry_sync(
            app_data_dir,
            "versions",
            &e.to_string(),
            Some(note_path),
        );
    }
}

async fn try_snapshot(app_data_dir: &Path, note_path: &str, content: &str) -> anyhow::Result<()> {
    let dir = app_data_dir.join("versions").join(note_key(note_path));
    let mut versions = sorted_versions(&dir).await;
    if let Some(latest) = versions.last() {
        if tokio::fs::read_to_string(latest).await.ok().as_deref() == Some(content) {
            return Ok(());
        }
    }
    tokio::fs::create_dir_all(&dir).await?;
    let new = dir.join(format!("{:013}.md", now_ms()));
    write_atomic(&new, content).await?;
    versions.push(new);
    let excess = versions.len().saturating_sub(KEEP);
    for old in &versions[..excess] {
        tokio::fs::remove_file(old).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn stored(dir: &Path, note: &str) -> Vec<String> {
        let mut out = Vec::new();
        for p in sorted_versions(&dir.join("versions").join(note_key(note))).await {
            out.push(tokio::fs::read_to_string(p).await.unwrap());
        }
        out
    }

    #[tokio::test]
    async fn test_unchanged_content_is_not_snapshotted_twice() {
        let tmp = tempfile::tempdir().unwrap();
        snapshot(tmp.path(), "/ws/a.md", "one").await;
        snapshot(tmp.path(), "/ws/a.md", "one").await;
        assert_eq!(stored(tmp.path(), "/ws/a.md").await, ["one"]);
    }

    #[tokio::test]
    async fn test_ring_keeps_only_the_newest_ten() {
        let tmp = tempfile::tempdir().unwrap();
        for i in 0..12 {
            snapshot(tmp.path(), "/ws/a.md", &format!("v{i}")).await;
            tokio::time::sleep(std::time::Duration::from_millis(2)).await;
        }
        let kept = stored(tmp.path(), "/ws/a.md").await;
        assert_eq!(kept.len(), KEEP);
        assert_eq!(kept.first().map(String::as_str), Some("v2"));
        assert_eq!(kept.last().map(String::as_str), Some("v11"));
    }

    #[tokio::test]
    async fn test_notes_keep_separate_histories() {
        let tmp = tempfile::tempdir().unwrap();
        snapshot(tmp.path(), "/ws/a.md", "a").await;
        snapshot(tmp.path(), "/ws/b.md", "b").await;
        assert_eq!(stored(tmp.path(), "/ws/a.md").await, ["a"]);
        assert_eq!(stored(tmp.path(), "/ws/b.md").await, ["b"]);
    }
}

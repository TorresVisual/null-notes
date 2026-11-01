use std::path::{Path, PathBuf};

const MARKER: &str = ".workspace.json";

#[derive(Debug, PartialEq, Eq)]
pub enum ResolveError {
    NotFound,
}

pub fn resolve(
    flag: Option<&Path>,
    cwd: &Path,
    recents_file: &Path,
) -> Result<PathBuf, ResolveError> {
    pick(flag, cwd, recents_file).map(native)
}

// The app keys its index by the exact workspace string, and its own strings
// use backslashes; `--workspace C:/notes` must not become a second workspace.
fn native(path: PathBuf) -> PathBuf {
    PathBuf::from(path.to_string_lossy().replace('/', "\\"))
}

fn pick(flag: Option<&Path>, cwd: &Path, recents_file: &Path) -> Result<PathBuf, ResolveError> {
    if let Some(flag) = flag {
        return Ok(cwd.join(flag));
    }
    if let Some(root) = cwd.ancestors().find(|dir| dir.join(MARKER).is_file()) {
        return Ok(root.to_path_buf());
    }
    let recents = read_recents(recents_file);
    if let Some(containing) = recents.iter().find(|entry| contains(entry, cwd)) {
        return Ok(containing.clone());
    }
    recents
        .into_iter()
        .find(|entry| entry.is_dir())
        .ok_or(ResolveError::NotFound)
}

fn read_recents(file: &Path) -> Vec<PathBuf> {
    std::fs::read_to_string(file)
        .ok()
        .and_then(|text| serde_json::from_str::<Vec<String>>(&text).ok())
        .unwrap_or_default()
        .into_iter()
        .map(PathBuf::from)
        .collect()
}

// Windows paths differ in case and slash direction between whoever wrote the
// recents file and `current_dir`, so compare component-wise, lowercased.
fn contains(workspace: &Path, dir: &Path) -> bool {
    let parts = |p: &Path| -> Vec<String> {
        p.components()
            .map(|c| c.as_os_str().to_string_lossy().to_lowercase())
            .collect()
    };
    parts(dir).starts_with(&parts(workspace))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn recents(dir: &Path, entries: &[&Path]) -> PathBuf {
        let file = dir.join("recent-workspaces.json");
        let list: Vec<String> = entries
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect();
        fs::write(&file, serde_json::to_string(&list).unwrap()).unwrap();
        file
    }

    #[test]
    fn the_flag_wins_over_everything() {
        let tmp = tempfile::tempdir().unwrap();
        let ws = tmp.path().join("ws");
        fs::create_dir_all(&ws).unwrap();
        fs::write(ws.join(MARKER), "{}").unwrap();
        let flagged = tmp.path().join("flagged");
        let found = resolve(Some(&flagged), &ws, &tmp.path().join("none.json")).unwrap();
        assert_eq!(found, flagged);
    }

    #[test]
    fn a_relative_flag_is_taken_from_the_cwd() {
        let tmp = tempfile::tempdir().unwrap();
        let found = resolve(
            Some(Path::new("notes")),
            tmp.path(),
            &tmp.path().join("none.json"),
        );
        assert_eq!(found, Ok(tmp.path().join("notes")));
    }

    #[test]
    fn a_forward_slash_flag_is_spelled_the_way_the_app_spells_it() {
        let tmp = tempfile::tempdir().unwrap();
        let flag = tmp.path().to_string_lossy().replace('\\', "/");
        let found = resolve(
            Some(Path::new(&flag)),
            tmp.path(),
            &tmp.path().join("none.json"),
        );
        assert_eq!(found, Ok(tmp.path().to_path_buf()));
    }

    #[test]
    fn walks_up_to_the_nearest_workspace_marker() {
        let tmp = tempfile::tempdir().unwrap();
        let ws = tmp.path().join("ws");
        let deep = ws.join("a").join("b");
        fs::create_dir_all(&deep).unwrap();
        fs::write(ws.join(MARKER), "{}").unwrap();
        let found = resolve(None, &deep, &tmp.path().join("none.json")).unwrap();
        assert_eq!(found, ws);
    }

    #[test]
    fn a_repo_with_only_a_readme_is_not_a_workspace() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = tmp.path().join("repo");
        fs::create_dir_all(&repo).unwrap();
        fs::write(repo.join("README.md"), "# hi").unwrap();
        let found = resolve(None, &repo, &tmp.path().join("none.json"));
        assert_eq!(found, Err(ResolveError::NotFound));
    }

    #[test]
    fn a_cwd_inside_a_recent_workspace_resolves_to_it() {
        let tmp = tempfile::tempdir().unwrap();
        let first = tmp.path().join("first");
        let second = tmp.path().join("second");
        let inside = second.join("sub");
        fs::create_dir_all(&first).unwrap();
        fs::create_dir_all(&inside).unwrap();
        let file = recents(tmp.path(), &[&first, &second]);
        assert_eq!(resolve(None, &inside, &file), Ok(second));
    }

    #[test]
    fn otherwise_the_most_recent_workspace_that_still_exists() {
        let tmp = tempfile::tempdir().unwrap();
        let gone = tmp.path().join("gone");
        let alive = tmp.path().join("alive");
        let elsewhere = tmp.path().join("elsewhere");
        fs::create_dir_all(&alive).unwrap();
        fs::create_dir_all(&elsewhere).unwrap();
        let file = recents(tmp.path(), &[&gone, &alive]);
        assert_eq!(resolve(None, &elsewhere, &file), Ok(alive));
    }

    #[test]
    fn no_marker_and_no_recents_is_not_found() {
        let tmp = tempfile::tempdir().unwrap();
        let found = resolve(None, tmp.path(), &tmp.path().join("none.json"));
        assert_eq!(found, Err(ResolveError::NotFound));
    }
}

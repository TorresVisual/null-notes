use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;
use tokio::sync::OwnedMutexGuard;
use tokio::time::Instant;

// Dirty paths, lock keys and scan markers compare after this, so `C:\ws\A.md`
// from the frontend and `c:/ws/a.md` from a request are the same file.
fn key(path: &str) -> String {
    path.replace('\\', "/").to_lowercase()
}

#[derive(Debug)]
pub struct CliState {
    dirty: Mutex<HashMap<String, HashSet<String>>>,
    // ponytail: one entry per path ever written, never evicted; a CLI-started
    // instance idles out and the app's own session is bounded by notes touched.
    locks: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    scanned: Mutex<HashSet<String>>,
    last_request: Mutex<Instant>,
}

impl Default for CliState {
    fn default() -> Self {
        Self {
            dirty: Mutex::default(),
            locks: Mutex::default(),
            scanned: Mutex::default(),
            last_request: Mutex::new(Instant::now()),
        }
    }
}

impl CliState {
    pub fn set_dirty(&self, workspace: &str, paths: Vec<String>) {
        let paths = paths.iter().map(|p| key(p)).collect();
        self.dirty
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(key(workspace), paths);
    }

    pub fn is_dirty(&self, abs_path: &str) -> bool {
        let wanted = key(abs_path);
        self.dirty
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .values()
            .any(|paths| paths.contains(&wanted))
    }

    pub async fn lock_path(&self, abs_path: &str) -> OwnedMutexGuard<()> {
        let lock = self
            .locks
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .entry(key(abs_path))
            .or_default()
            .clone();
        lock.lock_owned().await
    }

    pub fn take_first_scan(&self, workspace: &str) -> bool {
        self.scanned
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(key(workspace))
    }

    pub fn touch(&self) {
        *self
            .last_request
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = Instant::now();
    }

    pub fn idle_for(&self) -> Duration {
        self.last_request
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .elapsed()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_dirty_ignores_slash_direction_and_case() {
        let state = CliState::default();
        state.set_dirty("C:\\ws", vec![r"C:\ws\Notes\A.md".to_string()]);
        assert!(state.is_dirty("c:/ws/notes/a.md"));
        assert!(!state.is_dirty("c:/ws/notes/b.md"));
    }

    #[test]
    fn set_dirty_replaces_a_workspaces_previous_report() {
        let state = CliState::default();
        state.set_dirty("C:\\ws", vec![r"C:\ws\a.md".to_string()]);
        state.set_dirty("C:\\ws", vec![]);
        assert!(!state.is_dirty(r"C:\ws\a.md"));
    }

    #[test]
    fn one_workspaces_report_does_not_clear_anothers() {
        let state = CliState::default();
        state.set_dirty("C:\\one", vec![r"C:\one\a.md".to_string()]);
        state.set_dirty("C:\\two", vec![]);
        assert!(state.is_dirty(r"C:\one\a.md"));
    }

    #[test]
    fn take_first_scan_is_true_once_per_workspace() {
        let state = CliState::default();
        assert!(state.take_first_scan("ws"));
        assert!(!state.take_first_scan("ws"));
        assert!(state.take_first_scan("ws2"));
    }

    #[tokio::test]
    async fn lock_path_serialises_the_same_path_across_spellings() {
        let state = Arc::new(CliState::default());
        let guard = state.lock_path(r"C:\ws\A.md").await;
        let waiter = {
            let state = state.clone();
            tokio::spawn(async move {
                state.lock_path("c:/ws/a.md").await;
            })
        };
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(!waiter.is_finished());
        drop(guard);
        waiter.await.unwrap();
    }

    #[tokio::test(start_paused = true)]
    async fn idle_for_grows_and_touch_resets_it() {
        let state = CliState::default();
        tokio::time::advance(Duration::from_secs(90)).await;
        assert!(state.idle_for() >= Duration::from_secs(90));
        state.touch();
        assert!(state.idle_for() < Duration::from_secs(1));
    }
}

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::notes::write_atomic;
use crate::fsrs::DEFAULT_RETENTION;

pub const SCHEDULER_FILE: &str = ".scheduler.json";

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(tag = "scheduler", rename_all = "lowercase")]
pub enum Scheduler {
    Sm2,
    Fsrs { retention: f64 },
}

pub async fn read_scheduler_at(workspace: &str) -> Scheduler {
    let text = match tokio::fs::read_to_string(Path::new(workspace).join(SCHEDULER_FILE)).await {
        Ok(text) => text,
        Err(_) => return Scheduler::Sm2,
    };
    match serde_json::from_str(&text) {
        Ok(Scheduler::Fsrs { retention }) => Scheduler::Fsrs {
            retention: retention.clamp(0.7, 0.97),
        },
        Ok(Scheduler::Sm2) | Err(_) => Scheduler::Sm2,
    }
}

#[tauri::command]
pub async fn get_scheduler(workspace: String) -> Result<Scheduler, String> {
    Ok(read_scheduler_at(&workspace).await)
}

#[tauri::command]
pub async fn set_scheduler(
    workspace: String,
    fsrs: bool,
    retention: Option<f64>,
) -> Result<(), String> {
    let value = if fsrs {
        Scheduler::Fsrs {
            retention: retention.unwrap_or(DEFAULT_RETENTION),
        }
    } else {
        Scheduler::Sm2
    };
    let text = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())? + "\n";
    write_atomic(&Path::new(&workspace).join(SCHEDULER_FILE), &text)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_missing_or_garbled_file_means_sm2() {
        let dir = tempfile::tempdir().unwrap();
        let ws = dir.path().to_str().unwrap();
        assert_eq!(read_scheduler_at(ws).await, Scheduler::Sm2);
        std::fs::write(dir.path().join(SCHEDULER_FILE), "nope").unwrap();
        assert_eq!(read_scheduler_at(ws).await, Scheduler::Sm2);
    }

    #[tokio::test]
    async fn test_fsrs_choice_round_trips_with_retention_clamped() {
        let dir = tempfile::tempdir().unwrap();
        let ws = dir.path().to_str().unwrap().to_string();
        set_scheduler(ws.clone(), true, Some(0.85)).await.unwrap();
        assert_eq!(
            read_scheduler_at(&ws).await,
            Scheduler::Fsrs { retention: 0.85 }
        );
        set_scheduler(ws.clone(), true, Some(0.99)).await.unwrap();
        assert_eq!(
            read_scheduler_at(&ws).await,
            Scheduler::Fsrs { retention: 0.97 }
        );
        set_scheduler(ws.clone(), false, None).await.unwrap();
        assert_eq!(read_scheduler_at(&ws).await, Scheduler::Sm2);
    }
}

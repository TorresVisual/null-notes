//! P6-7: resolving a `Theorem 3.2`-style prose reference to the numbered
//! callout block it names, anywhere in the workspace — the same "prefer a
//! miss" posture P7-1's `resolve_code_links` and P1-1's unresolved
//! wiki-links already take.

use crate::db::{self, DbPool};
use serde::Deserialize;
use tauri::State;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrossRefTarget {
    pub callout_type: String,
    pub number: String,
}

/// Which note (if any) defines each numbered block named in `targets`, in
/// the order given. Batched deliberately, mirroring `resolve_code_links` —
/// a reference renders inert until it is answered for, and asking per
/// reference per render is what would make typing feel slow.
#[tauri::command]
pub async fn resolve_cross_refs(
    workspace: String,
    targets: Vec<CrossRefTarget>,
    db: State<'_, DbPool>,
) -> Result<Vec<Option<String>>, String> {
    let mut out = Vec::with_capacity(targets.len());
    for target in &targets {
        let pattern = db::notes::marker_like_pattern(&target.callout_type, &target.number);
        let path = db::notes::note_containing_marker(&db, &workspace, &pattern)
            .await
            .map_err(|e| e.to_string())?;
        out.push(path);
    }
    Ok(out)
}

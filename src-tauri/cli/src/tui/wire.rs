use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteMeta {
    pub title: String,
    pub path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub path: String,
    pub title: String,
    pub snippet: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchPage {
    pub results: Vec<SearchHit>,
    pub total: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Backlink {
    pub note: NoteMeta,
    pub snippet: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenTask {
    pub note_path: String,
    pub note_title: String,
    pub text: String,
    pub position: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DueCard {
    pub note_path: String,
    pub note_title: String,
    pub front: String,
    pub back: String,
    pub position: i64,
    pub options: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashEntry {
    pub id: String,
    pub original_path: String,
    pub is_folder: bool,
    pub name: String,
    pub trashed_at: i64,
}

pub fn decode<T: DeserializeOwned>(value: Value) -> Result<T, String> {
    serde_json::from_value(value)
        .map_err(|e| format!("unexpected {}: {e}", std::any::type_name::<T>()))
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn decodes_note_meta() {
        let v = json!({"id":"1","title":"T","path":"a/b.md","workspace":"W","updatedAt":5,"extra":true});
        let n: NoteMeta = decode(v).unwrap();
        assert_eq!((n.title.as_str(), n.path.as_str()), ("T", "a/b.md"));
    }

    #[test]
    fn decodes_search_page() {
        let v = json!({"results":[{"path":"p.md","title":"T","workspace":"W","updatedAt":1,"snippet":"s","rank":0.1}],"total":7});
        let page: SearchPage = decode(v).unwrap();
        assert_eq!(page.total, 7);
        assert_eq!(page.results[0].snippet, "s");
    }

    #[test]
    fn decodes_backlink() {
        let v = json!({"note":{"id":"1","title":"T","path":"p.md","workspace":"W","updatedAt":1},"snippet":null});
        let b: Backlink = decode(v).unwrap();
        assert_eq!(b.note.path, "p.md");
        assert!(b.snippet.is_none());
    }

    #[test]
    fn decodes_open_task() {
        let v = json!({"notePath":"p.md","noteTitle":"T","text":"do it","position":3,"done":false});
        let t: OpenTask = decode(v).unwrap();
        assert_eq!(
            (t.note_path.as_str(), t.text.as_str(), t.position),
            ("p.md", "do it", 3)
        );
    }

    #[test]
    fn decodes_due_card() {
        let v = json!({"notePath":"p.md","noteTitle":"T","kind":"mc","front":"f","back":"b","position":2,"options":["a","b"],"streak":4,"due":"x"});
        let c: DueCard = decode(v).unwrap();
        assert_eq!((c.front.as_str(), c.options.len()), ("f", 2));
    }

    #[test]
    fn decodes_trash_entry() {
        let v = json!({"id":"i","workspace":"W","originalPath":"a.md","isFolder":false,"name":"a","trashedAt":9});
        let t: TrashEntry = decode(v).unwrap();
        assert_eq!(
            (t.original_path.as_str(), t.is_folder, t.trashed_at),
            ("a.md", false, 9)
        );
    }

    #[test]
    fn decode_names_the_type_on_failure() {
        let error = decode::<NoteMeta>(json!({"id": 1})).unwrap_err();
        assert!(error.contains("NoteMeta"), "{error}");
    }
}

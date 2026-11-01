use serde_json::{json, Map, Value};

#[derive(Debug, Default, PartialEq)]
pub struct SearchQuery {
    pub text: String,
    pub tag: Option<String>,
    pub folder: Option<String>,
    pub block_type: Option<String>,
}

pub fn parse(input: &str) -> SearchQuery {
    let mut query = SearchQuery::default();
    let mut words = Vec::new();
    for word in input.split_whitespace() {
        let filter = [
            ("tag:", &mut query.tag),
            ("folder:", &mut query.folder),
            ("block:", &mut query.block_type),
        ]
        .into_iter()
        .find_map(|(prefix, slot)| {
            word.strip_prefix(prefix)
                .filter(|value| !value.is_empty())
                .map(|value| (slot, value))
        });
        match filter {
            Some((slot, value)) => *slot = Some(value.to_string()),
            None => words.push(word),
        }
    }
    query.text = words.join(" ");
    query
}

impl SearchQuery {
    pub fn args(&self, offset: i64) -> Value {
        let mut args = Map::new();
        args.insert("query".into(), json!(self.text));
        for (key, value) in [
            ("tag", &self.tag),
            ("folder", &self.folder),
            ("block_type", &self.block_type),
        ] {
            if let Some(value) = value {
                args.insert(key.into(), json!(value));
            }
        }
        if offset > 0 {
            args.insert("offset".into(), json!(offset));
        }
        Value::Object(args)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn plain_text_has_no_filters() {
        let q = parse("binary tree");
        assert_eq!(q.text, "binary tree");
        assert_eq!((q.tag, q.folder, q.block_type), (None, None, None));
    }

    #[test]
    fn tag_folder_and_block_prefixes_are_extracted() {
        let q = parse("tag:cs101 folder:notes/os block:code binary tree");
        assert_eq!(q.tag.as_deref(), Some("cs101"));
        assert_eq!(q.folder.as_deref(), Some("notes/os"));
        assert_eq!(q.block_type.as_deref(), Some("code"));
        assert_eq!(q.text, "binary tree");
    }

    #[test]
    fn unknown_prefixes_stay_in_the_text() {
        assert_eq!(parse("http://x foo:bar").text, "http://x foo:bar");
    }

    #[test]
    fn empty_filter_value_stays_in_the_text() {
        let q = parse("tag: x");
        assert_eq!(q.tag, None);
        assert_eq!(q.text, "tag: x");
    }

    #[test]
    fn last_duplicate_filter_wins() {
        assert_eq!(parse("tag:a tag:b").tag.as_deref(), Some("b"));
    }

    #[test]
    fn args_omit_absent_options_and_zero_offset() {
        assert_eq!(parse("x").args(0), json!({ "query": "x" }));
    }

    #[test]
    fn args_include_offset_when_positive() {
        let args = parse("x tag:t folder:f block:code").args(20);
        assert_eq!(
            args,
            json!({ "query": "x", "tag": "t", "folder": "f", "block_type": "code", "offset": 20 })
        );
    }

    #[test]
    fn unicode_text_survives() {
        let q = parse("tag:日本 ünïcode");
        assert_eq!(q.tag.as_deref(), Some("日本"));
        assert_eq!(q.text, "ünïcode");
    }
}

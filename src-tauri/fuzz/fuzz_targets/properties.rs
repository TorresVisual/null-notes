#![no_main]

use arbitrary::Arbitrary;
use libfuzzer_sys::fuzz_target;
use null_notes_fuzz::note_text::split_frontmatter;
use null_notes_fuzz::properties::{
    parse_properties, remove_property, rename_property, set_property,
};
use serde_json::Value;

#[derive(Arbitrary, Debug)]
struct Input {
    content: String,
    key: String,
    other_key: String,
    value: String,
    list: bool,
}

fuzz_target!(|input: Input| {
    let value = if input.list {
        Value::Array(
            input
                .value
                .lines()
                .map(|l| Value::String(l.into()))
                .collect(),
        )
    } else {
        Value::String(input.value)
    };

    let before = parse_properties(split_frontmatter(&input.content).0).ok();

    if let Ok(out) = set_property(&input.content, &input.key, &value) {
        let mut expected = before
            .clone()
            .expect("set succeeded on unparseable frontmatter");
        expected.insert(input.key.clone(), value);
        assert_eq!(
            parse_properties(split_frontmatter(&out).0).ok(),
            Some(expected)
        );
    }
    if let Ok(out) = remove_property(&input.content, &input.key) {
        let mut expected = before
            .clone()
            .expect("remove succeeded on unparseable frontmatter");
        expected.remove(&input.key);
        assert_eq!(
            parse_properties(split_frontmatter(&out).0).ok(),
            Some(expected)
        );
    }
    let _ = rename_property(&input.content, &input.key, &input.other_key);
});

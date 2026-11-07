//! The fuzzed modules are compiled straight from the app's sources: the app crate is also a
//! cdylib/staticlib, and libFuzzer's linker flags break those on Windows.

#[path = "../../src/db/fts_query.rs"]
pub mod fts_query;

#[path = "../../src/note_text.rs"]
pub mod note_text;

#[path = "../../src/properties.rs"]
pub mod properties;

pub mod commands {
    pub mod notes {
        pub use crate::note_text::{extract_links, is_valid_tag, split_frontmatter};
    }
}

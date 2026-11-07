#![no_main]

use libfuzzer_sys::fuzz_target;
use null_notes_fuzz::fts_query::build_fts_query;

fuzz_target!(|input: &str| {
    build_fts_query(input);
});

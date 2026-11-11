//! Large-workspace timings, run by hand before releases:
//! `cargo test --release perf_bench -- --ignored --nocapture` (set
//! `NULL_NOTES_BENCH_NOTES` to change the 2,000-note default). Nothing asserts
//! on the numbers — CI runners are too noisy for thresholds — so read the
//! output against ROADMAP's "search and tree refresh sub-100 ms" budget.

use super::notes::{index_note_at, scan_dir_recursive};
use crate::db::{self, fts_query::build_fts_query};
use crate::models::{SearchPaging, SearchSort};
use std::time::{Duration, Instant};

const WORDS: &[&str] = &[
    "graph",
    "theorem",
    "lemma",
    "proof",
    "recursion",
    "pointer",
    "mutex",
    "cache",
    "heap",
    "compiler",
    "parser",
    "monad",
    "tensor",
    "matrix",
    "kernel",
    "socket",
    "thread",
    "queue",
    "hash",
    "tree",
    "sorting",
    "dijkstra",
    "automaton",
    "entropy",
    "lambda",
    "vector",
    "stack",
    "bandwidth",
    "scheduler",
    "paging",
];
const FOLDERS: usize = 20;

fn note_body(i: usize) -> String {
    let word = |k: usize| WORDS[(i.wrapping_mul(7919) + k.wrapping_mul(104_729)) % WORDS.len()];
    let mut body = format!("# Note {i} on {} and {}\n\n", word(1), word(2));
    for p in 0..8 {
        let line: Vec<&str> = (0..40).map(|k| word(p * 41 + k)).collect();
        body.push_str(&line.join(" "));
        body.push_str("\n\n");
    }
    body.push_str(&format!(
        "#tag{} #topic{}\n\nSee [[Note {}]].\n\n- [ ] revise note {i}\n\nWhat is {}? :: {}\n",
        i % 15,
        i % 4,
        (i + 1) % 2000,
        word(3),
        word(4),
    ));
    body
}

fn median(runs: &mut [Duration]) -> Duration {
    runs.sort();
    runs[runs.len() / 2]
}

#[tokio::test]
#[ignore]
async fn large_workspace_timings() {
    let count: usize = std::env::var("NULL_NOTES_BENCH_NOTES")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(2000);
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("workspace");
    for f in 0..FOLDERS {
        std::fs::create_dir_all(root.join(format!("folder{f}"))).unwrap();
    }
    let mut contents = Vec::with_capacity(count);
    for i in 0..count {
        let content = note_body(i);
        std::fs::write(
            root.join(format!("folder{}", i % FOLDERS))
                .join(format!("note{i}.md")),
            &content,
        )
        .unwrap();
        contents.push(content);
    }
    let workspace = root.to_string_lossy().into_owned();
    let pool = db::init_db(&dir.path().join("app-data")).await.unwrap();

    let start = Instant::now();
    let (notes, _, _) = scan_dir_recursive(&root, &workspace, &[]).await.unwrap();
    let scan = start.elapsed();
    let start = Instant::now();
    for meta in &notes {
        db::notes::index_note(&pool, meta).await.unwrap();
    }
    let index_rows = start.elapsed();
    let start = Instant::now();
    let tree = db::notes::list_by_workspace(&pool, &workspace)
        .await
        .unwrap();
    let list = start.elapsed();
    assert_eq!(tree.len(), count);

    let start = Instant::now();
    for meta in &notes {
        let content = tokio::fs::read_to_string(&meta.path).await.unwrap();
        index_note_at(&meta.path, &workspace, &content, &pool)
            .await
            .unwrap();
    }
    let reindex = start.elapsed();

    println!("\n=== {count} notes in {FOLDERS} folders ===");
    println!("open: scan dirs                {scan:?}");
    println!("open: index_note per note      {index_rows:?}");
    println!("open: list_by_workspace        {list:?}");
    println!(
        "full reindex (index_note_at)   {reindex:?}  ({:?}/note)",
        reindex / count as u32
    );

    let paging = SearchPaging {
        sort: SearchSort::Relevance,
        limit: 20,
        offset: 0,
    };
    let folder = format!("{workspace}/folder3");
    let cases: [(&str, &str, Option<&str>, Option<&str>); 4] = [
        ("common word", "theorem", None, None),
        ("prefix", "recur", None, None),
        ("two terms", "dijkstra automaton", None, None),
        ("tag + folder scope", "kernel", Some("tag3"), Some(&folder)),
    ];
    for (label, query, tag, folder) in cases {
        let fts = build_fts_query(query);
        let mut runs = Vec::new();
        for _ in 0..20 {
            let start = Instant::now();
            db::notes::search_notes(
                &pool,
                Some(&workspace),
                fts.as_deref(),
                folder,
                tag,
                None,
                None,
                paging,
            )
            .await
            .unwrap();
            runs.push(start.elapsed());
        }
        println!("search {label:<20} median {:?}", median(&mut runs));
    }
}

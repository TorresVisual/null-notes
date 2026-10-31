use crate::models::{
    CardKind, CardSummary, CodeLinkEntry, DueCard, ExtractedCard, ExtractedTask, NoteMetadata,
    OpenTask, SearchPaging, SearchResult, SearchSort,
};
use crate::sm2;
use anyhow::Result;
use sqlx::SqlitePool;

pub async fn index_note(pool: &SqlitePool, note: &NoteMetadata) -> Result<()> {
    sqlx::query(
        "INSERT INTO notes (id, title, path, workspace, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET
           title      = excluded.title,
           workspace  = excluded.workspace,
           updated_at = excluded.updated_at",
    )
    .bind(&note.id)
    .bind(&note.title)
    .bind(&note.path)
    .bind(&note.workspace)
    .bind(note.updated_at)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn remove_note(pool: &SqlitePool, path: &str) -> Result<()> {
    sqlx::query("DELETE FROM notes WHERE path = ?")
        .bind(path)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn index_note_content(
    pool: &SqlitePool,
    path: &str,
    title: &str,
    body: &str,
) -> Result<()> {
    sqlx::query("DELETE FROM notes_fts WHERE path = ?")
        .bind(path)
        .execute(pool)
        .await?;
    sqlx::query("INSERT INTO notes_fts (path, title, body) VALUES (?, ?, ?)")
        .bind(path)
        .bind(title)
        .bind(body)
        .execute(pool)
        .await?;
    Ok(())
}

// Windows paths already contain literal backslashes, which collide with the
// '\' ESCAPE character used below. Escape existing backslashes first so they
// match literally, then escape SQL's own wildcard characters.
fn escape_like(input: &str) -> String {
    input
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

pub async fn rename_path_prefix(
    pool: &SqlitePool,
    old_prefix: &str,
    new_prefix: &str,
) -> Result<()> {
    let like_pattern = format!("{}%", escape_like(old_prefix));
    let rows: Vec<(String,)> =
        sqlx::query_as("SELECT path FROM notes WHERE path LIKE ? ESCAPE '\\'")
            .bind(&like_pattern)
            .fetch_all(pool)
            .await?;

    for (old_path,) in rows {
        let new_path = format!("{}{}", new_prefix, &old_path[old_prefix.len()..]);
        update_path(pool, &old_path, &new_path).await?;
    }
    Ok(())
}

pub async fn remove_notes_under(pool: &SqlitePool, prefix: &str) -> Result<()> {
    let like_pattern = format!("{}%", escape_like(prefix));
    sqlx::query("DELETE FROM notes WHERE path LIKE ? ESCAPE '\\'")
        .bind(&like_pattern)
        .execute(pool)
        .await?;
    sqlx::query("DELETE FROM notes_fts WHERE path LIKE ? ESCAPE '\\'")
        .bind(&like_pattern)
        .execute(pool)
        .await?;
    sqlx::query("DELETE FROM note_tags WHERE note_path LIKE ? ESCAPE '\\'")
        .bind(&like_pattern)
        .execute(pool)
        .await?;
    sqlx::query("DELETE FROM note_links WHERE source_path LIKE ? ESCAPE '\\'")
        .bind(&like_pattern)
        .execute(pool)
        .await?;
    sqlx::query("DELETE FROM note_code_links WHERE source_path LIKE ? ESCAPE '\\'")
        .bind(&like_pattern)
        .execute(pool)
        .await?;
    sqlx::query("DELETE FROM note_tasks WHERE note_path LIKE ? ESCAPE '\\'")
        .bind(&like_pattern)
        .execute(pool)
        .await?;
    sqlx::query("DELETE FROM review_cards WHERE note_path LIKE ? ESCAPE '\\'")
        .bind(&like_pattern)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn update_path(pool: &SqlitePool, old_path: &str, new_path: &str) -> Result<()> {
    sqlx::query("UPDATE notes SET path = ? WHERE path = ?")
        .bind(new_path)
        .bind(old_path)
        .execute(pool)
        .await?;
    sqlx::query("UPDATE notes_fts SET path = ? WHERE path = ?")
        .bind(new_path)
        .bind(old_path)
        .execute(pool)
        .await?;
    sqlx::query("UPDATE note_tags SET note_path = ? WHERE note_path = ?")
        .bind(new_path)
        .bind(old_path)
        .execute(pool)
        .await?;
    sqlx::query("UPDATE note_links SET source_path = ? WHERE source_path = ?")
        .bind(new_path)
        .bind(old_path)
        .execute(pool)
        .await?;
    sqlx::query("UPDATE note_code_links SET source_path = ? WHERE source_path = ?")
        .bind(new_path)
        .bind(old_path)
        .execute(pool)
        .await?;
    sqlx::query("UPDATE note_tasks SET note_path = ? WHERE note_path = ?")
        .bind(new_path)
        .bind(old_path)
        .execute(pool)
        .await?;
    sqlx::query("UPDATE review_cards SET note_path = ? WHERE note_path = ?")
        .bind(new_path)
        .bind(old_path)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn remove_from_fts(pool: &SqlitePool, path: &str) -> Result<()> {
    sqlx::query("DELETE FROM notes_fts WHERE path = ?")
        .bind(path)
        .execute(pool)
        .await?;
    Ok(())
}

/// P6-5's scoping: `folder:`/`tag:`/`type:` narrow a search without leaving
/// the keyboard, on top of (or instead of) an ordinary free-text query.
/// Scoped to `workspace` by default — search previously reached across every
/// workspace this app's shared `index.db` has ever indexed, which a folder
/// or tag filter would otherwise silently inherit. `workspace: None` is an
/// explicit opt-in (issue #53) to search every indexed workspace at once,
/// for the sibling-course-folders shape `NotesMonorepo` supports.
///
/// Built as one dynamic SQL string rather than `? IS NULL OR …` placeholders
/// throughout: `rank` is only a meaningful ORDER BY when a `MATCH` clause is
/// actually present, and a fixed query can't conditionally drop a JOIN.
pub async fn search_notes(
    pool: &SqlitePool,
    workspace: Option<&str>,
    fts_query: Option<&str>,
    folder: Option<&str>,
    tag: Option<&str>,
    block_type: Option<&str>,
    paging: SearchPaging,
) -> Result<Vec<SearchResult>> {
    let (from_where, binds) = search_scope(workspace, fts_query, folder, tag, block_type);
    let order = match (paging.sort, fts_query.is_some()) {
        (SearchSort::Relevance, true) => "rank, n.path",
        (SearchSort::Name, _) => "notes_fts.title COLLATE NOCASE, n.path",
        _ => "n.updated_at DESC, n.path",
    };
    let sql = format!(
        "SELECT notes_fts.path, notes_fts.title, n.workspace, n.updated_at, \
         snippet(notes_fts, 2, '[[', ']]', '\u{2026}', 20) as snippet \
         {from_where} ORDER BY {order} LIMIT ? OFFSET ?"
    );
    let mut q = sqlx::query_as::<_, SearchResult>(&sql);
    for bind in binds {
        q = q.bind(bind);
    }
    Ok(q.bind(paging.limit)
        .bind(paging.offset)
        .fetch_all(pool)
        .await?)
}

/// Total matches for the same scope `search_notes` pages through.
pub async fn count_search_notes(
    pool: &SqlitePool,
    workspace: Option<&str>,
    fts_query: Option<&str>,
    folder: Option<&str>,
    tag: Option<&str>,
    block_type: Option<&str>,
) -> Result<i64> {
    let (from_where, binds) = search_scope(workspace, fts_query, folder, tag, block_type);
    let sql = format!("SELECT COUNT(*) {from_where}");
    let mut q = sqlx::query_scalar::<_, i64>(&sql);
    for bind in binds {
        q = q.bind(bind);
    }
    Ok(q.fetch_one(pool).await?)
}

/// The FROM/WHERE shared by the page and count queries, with its binds in
/// placeholder order (every bind is text).
fn search_scope(
    workspace: Option<&str>,
    fts_query: Option<&str>,
    folder: Option<&str>,
    tag: Option<&str>,
    block_type: Option<&str>,
) -> (String, Vec<String>) {
    let mut sql = String::from("FROM notes_fts JOIN notes n ON n.path = notes_fts.path");
    let mut binds = Vec::new();
    if let Some(tag) = tag {
        sql.push_str(
            " JOIN note_tags nt ON nt.note_path = notes_fts.path AND nt.tag = ? COLLATE NOCASE",
        );
        binds.push(tag.to_string());
    }
    let mut conditions = Vec::new();
    if let Some(workspace) = workspace {
        conditions.push("n.workspace = ?");
        binds.push(workspace.to_string());
    }
    if let Some(fts_query) = fts_query {
        conditions.push("notes_fts MATCH ?");
        binds.push(fts_query.to_string());
    }
    if let Some(folder) = folder {
        conditions.push("n.path LIKE ? ESCAPE '\\'");
        binds.push(format!("%{}%", escape_like(folder)));
    }
    if let Some(block_type) = block_type {
        conditions.push("notes_fts.body LIKE ? ESCAPE '\\'");
        binds.push(format!("%[!{}%", escape_like(&block_type.to_uppercase())));
    }
    if !conditions.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&conditions.join(" AND "));
    }
    (sql, binds)
}

/// The note set a P9-2 formula sheet is generated from: the same folder/tag
/// scoping as `search_notes`, minus the FTS match and the result paging
/// (a sheet has to include *every* formula in scope, not a search page of
/// them) and ordered by path rather than recency, so a regenerated sheet
/// lists formulas in the same source order every time.
pub async fn notes_in_scope(
    pool: &SqlitePool,
    workspace: &str,
    folder: Option<&str>,
    tag: Option<&str>,
) -> Result<Vec<NoteMetadata>> {
    let mut sql =
        String::from("SELECT n.id, n.title, n.path, n.workspace, n.updated_at FROM notes n");
    if tag.is_some() {
        sql.push_str(" JOIN note_tags nt ON nt.note_path = n.path AND nt.tag = ? COLLATE NOCASE");
    }
    sql.push_str(" WHERE n.workspace = ?");
    if folder.is_some() {
        sql.push_str(" AND n.path LIKE ? ESCAPE '\\'");
    }
    sql.push_str(" ORDER BY n.path");

    let mut q = sqlx::query_as::<_, NoteMetadata>(&sql);
    if let Some(tag) = tag {
        q = q.bind(tag.to_string());
    }
    q = q.bind(workspace.to_string());
    if let Some(folder) = folder {
        q = q.bind(format!("%{}%", escape_like(folder)));
    }
    let rows = q.fetch_all(pool).await?;
    Ok(rows)
}

pub async fn set_tags(pool: &SqlitePool, note_path: &str, tags: &[String]) -> Result<()> {
    sqlx::query("DELETE FROM note_tags WHERE note_path = ?")
        .bind(note_path)
        .execute(pool)
        .await?;
    for tag in tags {
        sqlx::query("INSERT INTO note_tags (note_path, tag) VALUES (?, ?)")
            .bind(note_path)
            .bind(tag)
            .execute(pool)
            .await?;
    }
    Ok(())
}

pub async fn set_links(pool: &SqlitePool, source_path: &str, targets: &[String]) -> Result<()> {
    sqlx::query("DELETE FROM note_links WHERE source_path = ?")
        .bind(source_path)
        .execute(pool)
        .await?;
    for target in targets {
        sqlx::query("INSERT INTO note_links (source_path, target_title) VALUES (?, ?)")
            .bind(source_path)
            .bind(target)
            .execute(pool)
            .await?;
    }
    Ok(())
}

pub async fn set_code_links(
    pool: &SqlitePool,
    source_path: &str,
    links: &[CodeLinkEntry],
) -> Result<()> {
    sqlx::query("DELETE FROM note_code_links WHERE source_path = ?")
        .bind(source_path)
        .execute(pool)
        .await?;
    for link in links {
        sqlx::query(
            "INSERT INTO note_code_links (source_path, target, line, fingerprint) VALUES (?, ?, ?, ?)",
        )
        .bind(source_path)
        .bind(&link.target)
        .bind(link.line.map(|l| l as i64))
        .bind(&link.fingerprint)
        .execute(pool)
        .await?;
    }
    Ok(())
}

pub async fn get_code_link_fingerprint(
    pool: &SqlitePool,
    source_path: &str,
    target: &str,
    line: u32,
) -> Result<Option<String>> {
    let row: Option<(Option<String>,)> = sqlx::query_as(
        "SELECT fingerprint FROM note_code_links WHERE source_path = ? AND target = ? AND line = ? LIMIT 1",
    )
    .bind(source_path)
    .bind(target)
    .bind(line as i64)
    .fetch_optional(pool)
    .await?;

    Ok(row.and_then(|(fp,)| fp))
}

pub async fn set_tasks(pool: &SqlitePool, note_path: &str, tasks: &[ExtractedTask]) -> Result<()> {
    sqlx::query("DELETE FROM note_tasks WHERE note_path = ?")
        .bind(note_path)
        .execute(pool)
        .await?;
    for task in tasks {
        sqlx::query("INSERT INTO note_tasks (note_path, text, done, position) VALUES (?, ?, ?, ?)")
            .bind(note_path)
            .bind(&task.text)
            .bind(task.done)
            .bind(task.position)
            .execute(pool)
            .await?;
    }
    Ok(())
}

pub async fn open_tasks(pool: &SqlitePool, workspace: &str) -> Result<Vec<OpenTask>> {
    let rows = sqlx::query_as::<_, OpenTask>(
        "SELECT nt.note_path, n.title as note_title, nt.text, nt.position
         FROM note_tasks nt
         JOIN notes n ON n.path = nt.note_path
         WHERE n.workspace = ? AND nt.done = 0
         ORDER BY n.title COLLATE NOCASE, nt.position",
    )
    .bind(workspace)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn set_cards(pool: &SqlitePool, note_path: &str, cards: &[ExtractedCard]) -> Result<()> {
    sqlx::query("DELETE FROM review_cards WHERE note_path = ?")
        .bind(note_path)
        .execute(pool)
        .await?;
    for card in cards {
        let kind = match card.kind {
            CardKind::Qa => "qa",
            CardKind::Cloze => "cloze",
            CardKind::Mc => "mc",
        };
        let due = card.due.clone().unwrap_or_else(sm2::today);
        let ease = card.ease.unwrap_or(2.5);
        let interval = card.interval.unwrap_or(0);
        let reps = card.reps.unwrap_or(0);
        let grade = card.grade.map(sm2::Grade::as_str);
        let streak = card.streak.unwrap_or(0);
        let lapses = card.lapses.unwrap_or(0);
        let suspended = if card.suspended { 1 } else { 0 };
        let options = if card.options.is_empty() {
            None
        } else {
            Some(serde_json::to_string(&card.options)?)
        };
        sqlx::query(
            "INSERT INTO review_cards (note_path, kind, front, back, position, due, ease, interval, reps, options, grade, streak, lapses, suspended)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(note_path)
        .bind(kind)
        .bind(&card.front)
        .bind(&card.back)
        .bind(card.position)
        .bind(due)
        .bind(ease)
        .bind(interval)
        .bind(reps)
        .bind(options)
        .bind(grade)
        .bind(streak)
        .bind(lapses)
        .bind(suspended)
        .execute(pool)
        .await?;
    }
    Ok(())
}

#[derive(sqlx::FromRow)]
struct DueCardRow {
    note_path: String,
    note_title: String,
    kind: String,
    front: String,
    back: String,
    position: i64,
    options: Option<String>,
    streak: i64,
}

pub async fn due_cards(pool: &SqlitePool, workspace: &str, today: &str) -> Result<Vec<DueCard>> {
    let rows = sqlx::query_as::<_, DueCardRow>(
        "SELECT rc.note_path, n.title as note_title, rc.kind, rc.front, rc.back, rc.position, rc.options, rc.streak
         FROM review_cards rc
         JOIN notes n ON n.path = rc.note_path
         WHERE n.workspace = ? AND rc.due <= ? AND COALESCE(rc.suspended, 0) = 0
         ORDER BY rc.due, n.title COLLATE NOCASE, rc.position",
    )
    .bind(workspace)
    .bind(today)
    .fetch_all(pool)
    .await?;

    let mut cards = Vec::with_capacity(rows.len());
    for r in rows {
        let options = match r.options {
            Some(json) => serde_json::from_str(&json)?,
            None => Vec::new(),
        };
        cards.push(DueCard {
            note_path: r.note_path,
            note_title: r.note_title,
            kind: r.kind,
            front: r.front,
            back: r.back,
            position: r.position,
            options,
            streak: r.streak,
        });
    }
    Ok(cards)
}

// `struggling` only distinguishes anything at `streak = 0`, where "New"
// (never lapsed) and "Struggling" (lapsed before, see sm2::next_lapses)
// would otherwise be the same category — at any other streak the
// `rc.streak != 0` short-circuit makes it a no-op, so callers outside that
// bucket always pass `false`.
pub async fn list_cards_by_category(
    pool: &SqlitePool,
    workspace: &str,
    streak: i64,
    struggling: bool,
) -> Result<Vec<DueCard>> {
    let rows = sqlx::query_as::<_, DueCardRow>(
        "SELECT rc.note_path, n.title as note_title, rc.kind, rc.front, rc.back, rc.position, rc.options, rc.streak
         FROM review_cards rc
         JOIN notes n ON n.path = rc.note_path
         WHERE n.workspace = ? AND rc.streak = ? AND COALESCE(rc.suspended, 0) = 0
           AND (rc.streak != 0 OR (COALESCE(rc.lapses, 0) > 0) = ?)
         ORDER BY n.title COLLATE NOCASE, rc.position",
    )
    .bind(workspace)
    .bind(streak)
    .bind(struggling)
    .fetch_all(pool)
    .await?;

    let mut cards = Vec::with_capacity(rows.len());
    for r in rows {
        let options = match r.options {
            Some(json) => serde_json::from_str(&json)?,
            None => Vec::new(),
        };
        cards.push(DueCard {
            note_path: r.note_path,
            note_title: r.note_title,
            kind: r.kind,
            front: r.front,
            back: r.back,
            position: r.position,
            options,
            streak: r.streak,
        });
    }
    Ok(cards)
}

#[derive(sqlx::FromRow)]
struct CardSummaryRow {
    note_path: String,
    note_title: String,
    kind: String,
    front: String,
    back: String,
    position: i64,
    due: String,
    interval: i64,
    streak: i64,
    lapses: i64,
    suspended: Option<i64>,
    tags: Option<String>,
}

pub async fn list_all_cards(pool: &SqlitePool, workspace: &str) -> Result<Vec<CardSummary>> {
    let rows = sqlx::query_as::<_, CardSummaryRow>(
        "SELECT rc.note_path, n.title as note_title, rc.kind, rc.front, rc.back,
                rc.position, rc.due, rc.interval, rc.streak, rc.lapses,
                COALESCE(rc.suspended, 0) as suspended,
                GROUP_CONCAT(DISTINCT nt.tag) as tags
         FROM review_cards rc
         JOIN notes n ON n.path = rc.note_path
         LEFT JOIN note_tags nt ON nt.note_path = rc.note_path
         WHERE n.workspace = ?
         GROUP BY rc.note_path, rc.position
         ORDER BY n.title COLLATE NOCASE, rc.position",
    )
    .bind(workspace)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| CardSummary {
            note_path: r.note_path,
            note_title: r.note_title,
            kind: r.kind,
            front: r.front,
            back: r.back,
            position: r.position,
            due: r.due,
            interval: r.interval,
            streak: r.streak,
            lapses: r.lapses,
            suspended: r.suspended == Some(1),
            tags: r
                .tags
                .map(|t| t.split(',').map(String::from).collect())
                .unwrap_or_default(),
        })
        .collect())
}

pub async fn list_tags(pool: &SqlitePool, workspace: &str) -> Result<Vec<String>> {
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT DISTINCT nt.tag FROM note_tags nt
         JOIN notes n ON n.path = nt.note_path
         WHERE n.workspace = ?
         ORDER BY nt.tag COLLATE NOCASE",
    )
    .bind(workspace)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|(t,)| t).collect())
}

pub async fn notes_with_tag(
    pool: &SqlitePool,
    workspace: &str,
    tag: &str,
) -> Result<Vec<NoteMetadata>> {
    let rows = sqlx::query_as::<_, NoteMetadata>(
        "SELECT n.id, n.title, n.path, n.workspace, n.updated_at
         FROM notes n
         JOIN note_tags nt ON nt.note_path = n.path
         WHERE n.workspace = ? AND nt.tag = ? COLLATE NOCASE
         ORDER BY n.updated_at DESC",
    )
    .bind(workspace)
    .bind(tag)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// The LIKE pattern for a numbered callout's own serialized marker line (see
/// `Callout.tsx`: `> [!TYPE NUMBER]`). Used by P6-7's cross-references to
/// find which note defines a given `Theorem 3.2`-style reference — a plain
/// substring match against `notes_fts`'s own stored body is simpler and more
/// robust here than an FTS5 `MATCH` query, whose tokenizer would mangle a
/// marker built from brackets and punctuation.
pub fn marker_like_pattern(callout_type: &str, number: &str) -> String {
    format!(
        "%[!{} {}]%",
        escape_like(&callout_type.to_uppercase()),
        escape_like(number)
    )
}

/// The LIKE pattern for a numbered equation's own serialized opening fence
/// line (see `BlockMath.tsx`: a bare `$` immediately followed by its number,
/// with nothing between them). Used by P12-2's `Equation (3)` cross-references
/// — reusing `note_containing_marker` below exactly like `marker_like_pattern`
/// does, just with a different marker shape, since an equation has no
/// bracketed marker to match against. The trailing newline is what
/// disambiguates equation 3 from equation 34, the same role `marker_like_pattern`'s
/// closing `]` plays — a longer number always has another digit between the
/// target digits and the line break, so it can never match instead.
pub fn equation_marker_like_pattern(number: &str) -> String {
    format!("%${}\n%", escape_like(number))
}

/// The LIKE pattern for an exercise task's own serialized heading line (see
/// `exercises.rs`: `## Task N`). Used by cross-references to find which note
/// defines a given `Task 9.2` — mirrors `equation_marker_like_pattern`'s
/// shape. The trailing newline disambiguates task 3 from task 34.
pub fn task_marker_like_pattern(number: &str) -> String {
    format!("%## Task {}\n%", escape_like(number))
}

/// The path of a note in `workspace` whose raw content matches
/// `like_pattern` (built by [`marker_like_pattern`]), or `None` if no note
/// defines it.
pub async fn note_containing_marker(
    pool: &SqlitePool,
    workspace: &str,
    like_pattern: &str,
) -> Result<Option<String>> {
    let row: Option<(String,)> = sqlx::query_as(
        "SELECT n.path
         FROM notes n
         JOIN notes_fts f ON f.path = n.path
         WHERE n.workspace = ? AND f.body LIKE ? ESCAPE '\\'
         LIMIT 1",
    )
    .bind(workspace)
    .bind(like_pattern)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|(p,)| p))
}

pub async fn backlinks_for(
    pool: &SqlitePool,
    workspace: &str,
    title: &str,
) -> Result<Vec<NoteMetadata>> {
    let rows = sqlx::query_as::<_, NoteMetadata>(
        "SELECT n.id, n.title, n.path, n.workspace, n.updated_at
         FROM notes n
         JOIN note_links nl ON nl.source_path = n.path
         WHERE n.workspace = ? AND nl.target_title = ? COLLATE NOCASE
         ORDER BY n.updated_at DESC",
    )
    .bind(workspace)
    .bind(title)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

// ponytail: plain substring match, not word-boundary — a short title like
// "DB" also matches inside "DBMS". Same shape the issue asked for
// (note_containing_marker's LIKE pattern); tighten to a word-boundary regex
// post-filter if false positives turn out to matter in practice.
/// Notes in `workspace` (other than `exclude_path`, the note whose own title
/// this is) whose body contains `title` as plain text but that have no
/// `note_links` row pointing at it — Obsidian calls these "unlinked
/// mentions" (issue #48). A note that already links via `[[Title]]` is
/// excluded by the `NOT EXISTS`, even if it also happens to mention the
/// title elsewhere in prose.
pub async fn unlinked_mentions_for(
    pool: &SqlitePool,
    workspace: &str,
    title: &str,
    exclude_path: &str,
) -> Result<Vec<NoteMetadata>> {
    let like_pattern = format!("%{}%", escape_like(title));
    let rows = sqlx::query_as::<_, NoteMetadata>(
        "SELECT n.id, n.title, n.path, n.workspace, n.updated_at
         FROM notes n
         JOIN notes_fts f ON f.path = n.path
         WHERE n.workspace = ?
           AND n.path != ?
           AND f.body LIKE ? ESCAPE '\\'
           AND NOT EXISTS (
             SELECT 1 FROM note_links nl
             WHERE nl.source_path = n.path AND nl.target_title = ? COLLATE NOCASE
           )
         ORDER BY n.updated_at DESC",
    )
    .bind(workspace)
    .bind(exclude_path)
    .bind(&like_pattern)
    .bind(title)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Mirrors `backlinks_for`, but for code-file references (`target` is a
/// workspace-relative path, matched exactly — unlike a wiki-link title, a
/// pasted path isn't retyped with different casing).
pub async fn code_backlinks_for(
    pool: &SqlitePool,
    workspace: &str,
    target: &str,
) -> Result<Vec<NoteMetadata>> {
    let rows = sqlx::query_as::<_, NoteMetadata>(
        "SELECT DISTINCT n.id, n.title, n.path, n.workspace, n.updated_at
         FROM notes n
         JOIN note_code_links ncl ON ncl.source_path = n.path
         WHERE n.workspace = ? AND ncl.target = ?
         ORDER BY n.updated_at DESC",
    )
    .bind(workspace)
    .bind(target)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

// Every link/tag in the workspace at once, for the connections graph — link
// resolution (title -> path, which may be ambiguous or unresolved) and tag
// grouping happen on the frontend, which already holds the full notes list.
pub async fn all_links(pool: &SqlitePool, workspace: &str) -> Result<Vec<(String, String)>> {
    sqlx::query_as(
        "SELECT nl.source_path, nl.target_title
         FROM note_links nl
         JOIN notes n ON n.path = nl.source_path
         WHERE n.workspace = ?",
    )
    .bind(workspace)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

pub async fn all_note_tags(pool: &SqlitePool, workspace: &str) -> Result<Vec<(String, String)>> {
    sqlx::query_as(
        "SELECT nt.note_path, nt.tag
         FROM note_tags nt
         JOIN notes n ON n.path = nt.note_path
         WHERE n.workspace = ?",
    )
    .bind(workspace)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

pub async fn list_by_workspace(pool: &SqlitePool, workspace: &str) -> Result<Vec<NoteMetadata>> {
    let rows = sqlx::query_as::<_, NoteMetadata>(
        "SELECT id, title, path, workspace, updated_at
         FROM notes WHERE workspace = ?
         ORDER BY updated_at DESC",
    )
    .bind(workspace)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::run_migrations;

    // `:memory:` gives every pooled connection its own separate database —
    // with the pool's default of several connections, a query can land on a
    // connection that never saw run_migrations and see an empty (or
    // "no such table") database. Capping the pool at one connection forces
    // every query through the same in-memory database migrations just ran
    // against. Without this, these tests are flaky under concurrent load,
    // not deterministically broken — the usual symptom is "passes alone,
    // fails in the full suite."
    async fn make_pool() -> SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        run_migrations(&pool).await.unwrap();
        pool
    }

    fn note(id: &str, title: &str, path: &str, workspace: &str) -> NoteMetadata {
        NoteMetadata {
            id: id.into(),
            title: title.into(),
            path: path.into(),
            workspace: workspace.into(),
            updated_at: 1000,
        }
    }

    #[tokio::test]
    async fn test_index_and_list() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "Note A", "/ws/a.md", "/ws"))
            .await
            .unwrap();
        let notes = list_by_workspace(&pool, "/ws").await.unwrap();
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].title, "Note A");
    }

    // The bug this guards against: the same physical folder opened as two
    // different workspace roots (a subfolder used both standalone and as
    // part of its parent) indexes the same path twice with two different
    // `workspace` values. The second scan's own `list_by_workspace` call
    // must see it, or the note is invisible from whichever workspace didn't
    // index it first — forever, since nothing else ever corrects the column.
    #[tokio::test]
    async fn test_upsert_updates_workspace() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "A", "/outer/Sub/a.md", "/outer/Sub"))
            .await
            .unwrap();
        index_note(&pool, &note("a", "A", "/outer/Sub/a.md", "/outer"))
            .await
            .unwrap();

        assert_eq!(list_by_workspace(&pool, "/outer").await.unwrap().len(), 1);
        assert_eq!(
            list_by_workspace(&pool, "/outer/Sub").await.unwrap().len(),
            0
        );
    }

    #[tokio::test]
    async fn test_upsert_updates_title() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "Old Title", "/ws/a.md", "/ws"))
            .await
            .unwrap();
        let updated = NoteMetadata {
            id: "a".into(),
            title: "New Title".into(),
            path: "/ws/a.md".into(),
            workspace: "/ws".into(),
            updated_at: 2000,
        };
        index_note(&pool, &updated).await.unwrap();
        let notes = list_by_workspace(&pool, "/ws").await.unwrap();
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].title, "New Title");
    }

    #[tokio::test]
    async fn test_remove_note() {
        let pool = make_pool().await;
        index_note(&pool, &note("b", "B", "/ws/b.md", "/ws"))
            .await
            .unwrap();
        remove_note(&pool, "/ws/b.md").await.unwrap();
        let notes = list_by_workspace(&pool, "/ws").await.unwrap();
        assert_eq!(notes.len(), 0);
    }

    async fn seed_search_fixture(pool: &SqlitePool) {
        index_note(pool, &note("a", "Analysis", "/ws/CS101/a.md", "/ws"))
            .await
            .unwrap();
        index_note_content(
            pool,
            "/ws/CS101/a.md",
            "Analysis",
            "shortest paths\n\n> [!THEOREM 3.2] Squeeze Theorem\n> body\n",
        )
        .await
        .unwrap();
        set_tags(pool, "/ws/CS101/a.md", &["graphs".to_string()])
            .await
            .unwrap();

        index_note(pool, &note("b", "Networks", "/ws/CS102/b.md", "/ws"))
            .await
            .unwrap();
        index_note_content(pool, "/ws/CS102/b.md", "Networks", "routing tables")
            .await
            .unwrap();

        // A note with the same title/body shape, indexed under a different
        // workspace — the property every filter below has to respect, since
        // this app's index.db is shared across every workspace ever opened.
        index_note(pool, &note("c", "Analysis", "/other/c.md", "/other"))
            .await
            .unwrap();
        index_note_content(pool, "/other/c.md", "Analysis", "shortest paths")
            .await
            .unwrap();
    }

    async fn seed_operator_fixture(pool: &SqlitePool) {
        let notes = [
            ("1", "Master", "the master theorem solves recurrences", 3000),
            ("2", "Theorem", "a theorem about the master of none", 2000),
            ("3", "Heaps", "binary tree and max heap", 1000),
            ("4", "Trees", "binary tree traversal and recurrence", 4000),
        ];
        for (id, title, body, updated_at) in notes {
            let path = format!("/ws/{id}.md");
            let meta = NoteMetadata {
                updated_at,
                ..note(id, title, &path, "/ws")
            };
            index_note(pool, &meta).await.unwrap();
            index_note_content(pool, &path, title, body).await.unwrap();
        }
    }

    async fn match_titles(pool: &SqlitePool, input: &str) -> Vec<String> {
        let fts = crate::db::fts_query::build_fts_query(input);
        let paging = SearchPaging {
            sort: SearchSort::Name,
            limit: 20,
            offset: 0,
        };
        let hits = search_notes(pool, Some("/ws"), fts.as_deref(), None, None, None, paging)
            .await
            .unwrap();
        hits.into_iter().map(|h| h.title).collect()
    }

    #[tokio::test]
    async fn test_search_operators_phrase_or_exclusion_and_grouping() {
        let pool = make_pool().await;
        seed_operator_fixture(&pool).await;

        assert_eq!(
            match_titles(&pool, "\"master theorem\"").await,
            ["Master"],
            "a phrase needs its words adjacent and in order"
        );
        assert_eq!(match_titles(&pool, "master theorem").await.len(), 2);
        assert_eq!(
            match_titles(&pool, "heap OR traversal").await,
            ["Heaps", "Trees"]
        );
        assert_eq!(match_titles(&pool, "binary tree -heap").await, ["Trees"]);
        assert_eq!(match_titles(&pool, "binary -\"max heap\"").await, ["Trees"]);
        assert_eq!(
            match_titles(&pool, "binary (heap OR traversal) -max").await,
            ["Trees"]
        );
        assert_eq!(match_titles(&pool, "\"binary tree").await.len(), 2);
    }

    #[tokio::test]
    async fn test_search_notes_pages_counts_and_sorts() {
        let pool = make_pool().await;
        seed_operator_fixture(&pool).await;
        let page = |sort, limit, offset| SearchPaging {
            sort,
            limit,
            offset,
        };
        let titles = |hits: Vec<SearchResult>| -> Vec<String> {
            hits.into_iter().map(|h| h.title).collect()
        };

        let count = count_search_notes(&pool, Some("/ws"), Some("\"the\"*"), None, None, None)
            .await
            .unwrap();
        assert_eq!(count, 2);
        assert_eq!(
            count_search_notes(&pool, Some("/ws"), None, None, None, None)
                .await
                .unwrap(),
            4
        );

        let by_modified = search_notes(
            &pool,
            Some("/ws"),
            None,
            None,
            None,
            None,
            page(SearchSort::Modified, 20, 0),
        )
        .await
        .unwrap();
        assert_eq!(titles(by_modified), ["Trees", "Master", "Theorem", "Heaps"]);

        let by_name_page_two = search_notes(
            &pool,
            Some("/ws"),
            None,
            None,
            None,
            None,
            page(SearchSort::Name, 2, 2),
        )
        .await
        .unwrap();
        assert_eq!(titles(by_name_page_two), ["Theorem", "Trees"]);
    }

    #[tokio::test]
    async fn test_search_notes_is_scoped_to_the_given_workspace() {
        let pool = make_pool().await;
        seed_search_fixture(&pool).await;

        let hits = search_notes(
            &pool,
            Some("/ws"),
            Some("\"shortest\"*"),
            None,
            None,
            None,
            SearchPaging {
                sort: SearchSort::Relevance,
                limit: 20,
                offset: 0,
            },
        )
        .await
        .unwrap();

        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].path, "/ws/CS101/a.md");
    }

    #[tokio::test]
    async fn test_search_notes_filters_by_folder() {
        let pool = make_pool().await;
        seed_search_fixture(&pool).await;

        let hits = search_notes(
            &pool,
            Some("/ws"),
            None,
            Some("CS102"),
            None,
            None,
            SearchPaging {
                sort: SearchSort::Relevance,
                limit: 20,
                offset: 0,
            },
        )
        .await
        .unwrap();

        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].path, "/ws/CS102/b.md");
    }

    #[tokio::test]
    async fn test_search_notes_filters_by_tag() {
        let pool = make_pool().await;
        seed_search_fixture(&pool).await;

        let hits = search_notes(
            &pool,
            Some("/ws"),
            None,
            None,
            Some("graphs"),
            None,
            SearchPaging {
                sort: SearchSort::Relevance,
                limit: 20,
                offset: 0,
            },
        )
        .await
        .unwrap();

        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].path, "/ws/CS101/a.md");
    }

    #[tokio::test]
    async fn test_search_notes_filters_by_block_type() {
        let pool = make_pool().await;
        seed_search_fixture(&pool).await;

        let hits = search_notes(
            &pool,
            Some("/ws"),
            None,
            None,
            None,
            Some("theorem"),
            SearchPaging {
                sort: SearchSort::Relevance,
                limit: 20,
                offset: 0,
            },
        )
        .await
        .unwrap();

        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].path, "/ws/CS101/a.md");
    }

    #[tokio::test]
    async fn test_search_notes_combines_text_and_filters() {
        let pool = make_pool().await;
        seed_search_fixture(&pool).await;

        let hits = search_notes(
            &pool,
            Some("/ws"),
            Some("\"routing\"*"),
            Some("CS101"),
            None,
            None,
            SearchPaging {
                sort: SearchSort::Relevance,
                limit: 20,
                offset: 0,
            },
        )
        .await
        .unwrap();

        assert!(hits.is_empty(), "routing text only appears outside CS101");
    }

    #[tokio::test]
    async fn test_search_notes_with_no_workspace_searches_every_workspace() {
        let pool = make_pool().await;
        seed_search_fixture(&pool).await;

        let mut hits = search_notes(
            &pool,
            None,
            Some("\"shortest\"*"),
            None,
            None,
            None,
            SearchPaging {
                sort: SearchSort::Relevance,
                limit: 20,
                offset: 0,
            },
        )
        .await
        .unwrap();
        hits.sort_by(|a, b| a.path.cmp(&b.path));

        let paths: Vec<&str> = hits.iter().map(|h| h.path.as_str()).collect();
        assert_eq!(paths, vec!["/other/c.md", "/ws/CS101/a.md"]);
        assert_eq!(hits[0].workspace, "/other");
        assert_eq!(hits[1].workspace, "/ws");
    }

    #[tokio::test]
    async fn test_notes_in_scope_whole_workspace_returns_all_notes_in_path_order() {
        let pool = make_pool().await;
        seed_search_fixture(&pool).await;

        let notes = notes_in_scope(&pool, "/ws", None, None).await.unwrap();

        let paths: Vec<&str> = notes.iter().map(|n| n.path.as_str()).collect();
        assert_eq!(paths, vec!["/ws/CS101/a.md", "/ws/CS102/b.md"]);
    }

    #[tokio::test]
    async fn test_notes_in_scope_filters_by_folder() {
        let pool = make_pool().await;
        seed_search_fixture(&pool).await;

        let notes = notes_in_scope(&pool, "/ws", Some("CS102"), None)
            .await
            .unwrap();

        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].path, "/ws/CS102/b.md");
    }

    #[tokio::test]
    async fn test_notes_in_scope_filters_by_tag() {
        let pool = make_pool().await;
        seed_search_fixture(&pool).await;

        let notes = notes_in_scope(&pool, "/ws", None, Some("graphs"))
            .await
            .unwrap();

        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].path, "/ws/CS101/a.md");
    }

    #[tokio::test]
    async fn test_notes_in_scope_is_scoped_to_the_given_workspace() {
        let pool = make_pool().await;
        seed_search_fixture(&pool).await;

        let notes = notes_in_scope(&pool, "/ws", None, None).await.unwrap();

        assert!(notes.iter().all(|n| n.workspace == "/ws"));
    }

    #[tokio::test]
    async fn test_rename_path_prefix_updates_matching_notes_and_fts() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "A", "/ws/Course1/a.md", "/ws"))
            .await
            .unwrap();
        index_note_content(&pool, "/ws/Course1/a.md", "A", "body text")
            .await
            .unwrap();
        index_note(&pool, &note("b", "B", "/ws/Course10/b.md", "/ws"))
            .await
            .unwrap();

        rename_path_prefix(&pool, "/ws/Course1/", "/ws/Renamed/")
            .await
            .unwrap();

        let notes = list_by_workspace(&pool, "/ws").await.unwrap();
        let a = notes.iter().find(|n| n.id == "a").unwrap();
        let b = notes.iter().find(|n| n.id == "b").unwrap();
        assert_eq!(a.path, "/ws/Renamed/a.md");
        assert_eq!(b.path, "/ws/Course10/b.md");

        let fts_path: (String,) = sqlx::query_as("SELECT path FROM notes_fts WHERE title = 'A'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(fts_path.0, "/ws/Renamed/a.md");
    }

    #[tokio::test]
    async fn test_remove_notes_under_deletes_matching_notes_and_fts_only() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "A", "/ws/Course1/a.md", "/ws"))
            .await
            .unwrap();
        index_note_content(&pool, "/ws/Course1/a.md", "A", "body")
            .await
            .unwrap();
        index_note(&pool, &note("b", "B", "/ws/Course10/b.md", "/ws"))
            .await
            .unwrap();

        remove_notes_under(&pool, "/ws/Course1/").await.unwrap();

        let notes = list_by_workspace(&pool, "/ws").await.unwrap();
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].id, "b");

        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM notes_fts")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count.0, 0);
    }

    #[tokio::test]
    async fn test_update_path_changes_a_single_note() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "A", "/ws/old.md", "/ws"))
            .await
            .unwrap();
        update_path(&pool, "/ws/old.md", "/ws/Folder/old.md")
            .await
            .unwrap();
        let notes = list_by_workspace(&pool, "/ws").await.unwrap();
        assert_eq!(notes[0].path, "/ws/Folder/old.md");
    }

    #[tokio::test]
    async fn test_set_tags_replaces_existing_tags_for_a_note() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "A", "/ws/a.md", "/ws"))
            .await
            .unwrap();
        set_tags(
            &pool,
            "/ws/a.md",
            &["cs101".to_string(), "midterm".to_string()],
        )
        .await
        .unwrap();
        set_tags(&pool, "/ws/a.md", &["final".to_string()])
            .await
            .unwrap();

        let tags = list_tags(&pool, "/ws").await.unwrap();
        assert_eq!(tags, vec!["final".to_string()]);
    }

    #[tokio::test]
    async fn test_notes_with_tag_returns_matching_notes_only() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "A", "/ws/a.md", "/ws"))
            .await
            .unwrap();
        index_note(&pool, &note("b", "B", "/ws/b.md", "/ws"))
            .await
            .unwrap();
        set_tags(&pool, "/ws/a.md", &["cs101".to_string()])
            .await
            .unwrap();
        set_tags(&pool, "/ws/b.md", &["cs102".to_string()])
            .await
            .unwrap();

        let notes = notes_with_tag(&pool, "/ws", "cs101").await.unwrap();
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].id, "a");
    }

    #[tokio::test]
    async fn test_notes_with_tag_matches_case_insensitively() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "A", "/ws/a.md", "/ws"))
            .await
            .unwrap();
        set_tags(&pool, "/ws/a.md", &["CS101".to_string()])
            .await
            .unwrap();

        let notes = notes_with_tag(&pool, "/ws", "cs101").await.unwrap();
        assert_eq!(notes.len(), 1);
    }

    #[tokio::test]
    async fn test_set_links_and_backlinks_for() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "A", "/ws/a.md", "/ws"))
            .await
            .unwrap();
        index_note(&pool, &note("b", "B", "/ws/b.md", "/ws"))
            .await
            .unwrap();
        set_links(&pool, "/ws/a.md", &["B".to_string()])
            .await
            .unwrap();

        let backlinks = backlinks_for(&pool, "/ws", "B").await.unwrap();
        assert_eq!(backlinks.len(), 1);
        assert_eq!(backlinks[0].id, "a");
    }

    #[tokio::test]
    async fn test_backlinks_for_matches_case_insensitively() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "A", "/ws/a.md", "/ws"))
            .await
            .unwrap();
        set_links(&pool, "/ws/a.md", &["big o notation".to_string()])
            .await
            .unwrap();

        let backlinks = backlinks_for(&pool, "/ws", "Big O Notation").await.unwrap();
        assert_eq!(backlinks.len(), 1);
    }

    #[tokio::test]
    async fn test_unlinked_mentions_for_finds_plain_text_mention() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "A", "/ws/a.md", "/ws"))
            .await
            .unwrap();
        index_note_content(&pool, "/ws/a.md", "A", "See Big O Notation for details.")
            .await
            .unwrap();

        let mentions = unlinked_mentions_for(&pool, "/ws", "Big O Notation", "/ws/other.md")
            .await
            .unwrap();
        assert_eq!(mentions.len(), 1);
        assert_eq!(mentions[0].id, "a");
    }

    #[tokio::test]
    async fn test_unlinked_mentions_for_excludes_notes_that_already_link() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "A", "/ws/a.md", "/ws"))
            .await
            .unwrap();
        index_note_content(
            &pool,
            "/ws/a.md",
            "A",
            "See [[Big O Notation]] for details.",
        )
        .await
        .unwrap();
        set_links(&pool, "/ws/a.md", &["Big O Notation".to_string()])
            .await
            .unwrap();

        let mentions = unlinked_mentions_for(&pool, "/ws", "Big O Notation", "/ws/other.md")
            .await
            .unwrap();
        assert!(mentions.is_empty());
    }

    #[tokio::test]
    async fn test_unlinked_mentions_for_excludes_the_note_itself() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "Big O Notation", "/ws/a.md", "/ws"))
            .await
            .unwrap();
        index_note_content(
            &pool,
            "/ws/a.md",
            "Big O Notation",
            "Big O Notation describes growth rate.",
        )
        .await
        .unwrap();

        let mentions = unlinked_mentions_for(&pool, "/ws", "Big O Notation", "/ws/a.md")
            .await
            .unwrap();
        assert!(mentions.is_empty());
    }

    #[tokio::test]
    async fn test_set_code_links_and_code_backlinks_for() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "A", "/ws/a.md", "/ws"))
            .await
            .unwrap();
        set_code_links(
            &pool,
            "/ws/a.md",
            &[CodeLinkEntry {
                target: "src/main.rs".to_string(),
                line: Some(58),
                fingerprint: Some("fn main() {}".to_string()),
            }],
        )
        .await
        .unwrap();

        let backlinks = code_backlinks_for(&pool, "/ws", "src/main.rs")
            .await
            .unwrap();
        assert_eq!(backlinks.len(), 1);
        assert_eq!(backlinks[0].id, "a");

        let fp = get_code_link_fingerprint(&pool, "/ws/a.md", "src/main.rs", 58)
            .await
            .unwrap();
        assert_eq!(fp.as_deref(), Some("fn main() {}"));

        let none_fp = get_code_link_fingerprint(&pool, "/ws/a.md", "src/main.rs", 99)
            .await
            .unwrap();
        assert!(none_fp.is_none());

        // Unlike a wiki-link title, a path is matched exactly — a different
        // case is a different file on a case-sensitive filesystem.
        let none = code_backlinks_for(&pool, "/ws", "SRC/MAIN.RS")
            .await
            .unwrap();
        assert!(none.is_empty());
    }

    #[tokio::test]
    async fn test_note_containing_marker_finds_the_defining_note() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "Analysis", "/ws/a.md", "/ws"))
            .await
            .unwrap();
        index_note_content(
            &pool,
            "/ws/a.md",
            "Analysis",
            "prose\n\n> [!THEOREM 3.2] Squeeze Theorem\n> body\n",
        )
        .await
        .unwrap();

        let pattern = marker_like_pattern("theorem", "3.2");
        let found = note_containing_marker(&pool, "/ws", &pattern)
            .await
            .unwrap();

        assert_eq!(found, Some("/ws/a.md".to_string()));
    }

    #[tokio::test]
    async fn test_note_containing_marker_is_none_when_no_note_defines_it() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "Analysis", "/ws/a.md", "/ws"))
            .await
            .unwrap();
        index_note_content(&pool, "/ws/a.md", "Analysis", "> [!THEOREM 3.2]\n> body\n")
            .await
            .unwrap();

        let pattern = marker_like_pattern("theorem", "9.9");
        let found = note_containing_marker(&pool, "/ws", &pattern)
            .await
            .unwrap();

        assert_eq!(found, None);
    }

    // The marker's own number can contain characters LIKE treats as
    // wildcards (`_` in particular, common in a numbering scheme); those must
    // match literally, not as a wildcard that would resolve to the wrong
    // block or silently match too broadly.
    #[tokio::test]
    async fn test_note_containing_marker_escapes_like_wildcards_in_the_number() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "A", "/ws/a.md", "/ws"))
            .await
            .unwrap();
        index_note_content(&pool, "/ws/a.md", "A", "> [!LEMMA 3x2]\n> body\n")
            .await
            .unwrap();
        index_note(&pool, &note("b", "B", "/ws/b.md", "/ws"))
            .await
            .unwrap();
        index_note_content(&pool, "/ws/b.md", "B", "> [!LEMMA 3_2]\n> body\n")
            .await
            .unwrap();

        let pattern = marker_like_pattern("lemma", "3_2");
        let found = note_containing_marker(&pool, "/ws", &pattern)
            .await
            .unwrap();

        assert_eq!(found, Some("/ws/b.md".to_string()));
    }

    // P12-2: `Equation (3)` resolves against `BlockMath.tsx`'s own
    // serialized marker (a bare `$` immediately followed by the number, on
    // its own line) — not the callout `[!TYPE NUM]` bracket form above.
    #[tokio::test]
    async fn test_equation_marker_finds_the_defining_note() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "Analysis", "/ws/a.md", "/ws"))
            .await
            .unwrap();
        index_note_content(&pool, "/ws/a.md", "Analysis", "prose\n\n$3\ne = mc^2\n$\n")
            .await
            .unwrap();

        let pattern = equation_marker_like_pattern("3");
        let found = note_containing_marker(&pool, "/ws", &pattern)
            .await
            .unwrap();

        assert_eq!(found, Some("/ws/a.md".to_string()));
    }

    // The disambiguating role `marker_like_pattern`'s closing `]` plays —
    // equation 3's pattern must never also match equation 34.
    #[tokio::test]
    async fn test_equation_marker_does_not_match_a_longer_number() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "A", "/ws/a.md", "/ws"))
            .await
            .unwrap();
        index_note_content(&pool, "/ws/a.md", "A", "$34\nx\n$\n")
            .await
            .unwrap();

        let pattern = equation_marker_like_pattern("3");
        let found = note_containing_marker(&pool, "/ws", &pattern)
            .await
            .unwrap();

        assert_eq!(found, None);
    }

    #[tokio::test]
    async fn test_equation_marker_is_none_when_no_note_defines_it() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "A", "/ws/a.md", "/ws"))
            .await
            .unwrap();
        index_note_content(&pool, "/ws/a.md", "A", "$3\nx\n$\n")
            .await
            .unwrap();

        let pattern = equation_marker_like_pattern("9.9");
        let found = note_containing_marker(&pool, "/ws", &pattern)
            .await
            .unwrap();

        assert_eq!(found, None);
    }

    // Exercise sheets produced by exercises.rs serialize tasks as `## Task N`
    // headings; cross-references resolve against that heading line.
    #[tokio::test]
    async fn test_task_marker_finds_the_defining_note() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "Sheet 9", "/ws/a.md", "/ws"))
            .await
            .unwrap();
        index_note_content(
            &pool,
            "/ws/a.md",
            "Sheet 9",
            "## Task 9.2\n\nLet G be a graph.\n\n### Solution\n\n",
        )
        .await
        .unwrap();

        let pattern = task_marker_like_pattern("9.2");
        let found = note_containing_marker(&pool, "/ws", &pattern)
            .await
            .unwrap();

        assert_eq!(found, Some("/ws/a.md".to_string()));
    }

    #[tokio::test]
    async fn test_task_marker_does_not_match_a_longer_number() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "A", "/ws/a.md", "/ws"))
            .await
            .unwrap();
        index_note_content(&pool, "/ws/a.md", "A", "## Task 34\n\nbody\n")
            .await
            .unwrap();

        let pattern = task_marker_like_pattern("3");
        let found = note_containing_marker(&pool, "/ws", &pattern)
            .await
            .unwrap();

        assert_eq!(found, None);
    }

    #[tokio::test]
    async fn test_task_marker_is_none_when_no_note_defines_it() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "A", "/ws/a.md", "/ws"))
            .await
            .unwrap();
        index_note_content(&pool, "/ws/a.md", "A", "## Task 3\n\nbody\n")
            .await
            .unwrap();

        let pattern = task_marker_like_pattern("9.9");
        let found = note_containing_marker(&pool, "/ws", &pattern)
            .await
            .unwrap();

        assert_eq!(found, None);
    }

    #[tokio::test]
    async fn test_update_path_also_rewrites_tags_and_links() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "A", "/ws/old.md", "/ws"))
            .await
            .unwrap();
        set_tags(&pool, "/ws/old.md", &["cs101".to_string()])
            .await
            .unwrap();
        set_links(&pool, "/ws/old.md", &["Target".to_string()])
            .await
            .unwrap();
        set_code_links(
            &pool,
            "/ws/old.md",
            &[CodeLinkEntry {
                target: "src/main.rs".to_string(),
                line: None,
                fingerprint: None,
            }],
        )
        .await
        .unwrap();

        update_path(&pool, "/ws/old.md", "/ws/Folder/old.md")
            .await
            .unwrap();

        let notes = notes_with_tag(&pool, "/ws", "cs101").await.unwrap();
        assert_eq!(notes[0].path, "/ws/Folder/old.md");

        let backlinks = backlinks_for(&pool, "/ws", "Target").await.unwrap();
        assert_eq!(backlinks[0].path, "/ws/Folder/old.md");

        let code_backlinks = code_backlinks_for(&pool, "/ws", "src/main.rs")
            .await
            .unwrap();
        assert_eq!(code_backlinks[0].path, "/ws/Folder/old.md");
    }

    #[tokio::test]
    async fn test_remove_notes_under_also_deletes_tags_and_links() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "A", "/ws/Course1/a.md", "/ws"))
            .await
            .unwrap();
        set_tags(&pool, "/ws/Course1/a.md", &["cs101".to_string()])
            .await
            .unwrap();
        set_links(&pool, "/ws/Course1/a.md", &["Target".to_string()])
            .await
            .unwrap();
        index_note(&pool, &note("b", "B", "/ws/Course10/b.md", "/ws"))
            .await
            .unwrap();
        set_tags(&pool, "/ws/Course10/b.md", &["cs102".to_string()])
            .await
            .unwrap();

        remove_notes_under(&pool, "/ws/Course1/").await.unwrap();

        let all_tags = list_tags(&pool, "/ws").await.unwrap();
        assert_eq!(all_tags, vec!["cs102".to_string()]);
        let backlinks = backlinks_for(&pool, "/ws", "Target").await.unwrap();
        assert!(backlinks.is_empty());
    }

    #[tokio::test]
    async fn test_all_links_returns_every_link_in_the_workspace() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "A", "/ws/a.md", "/ws"))
            .await
            .unwrap();
        index_note(&pool, &note("b", "B", "/ws/b.md", "/ws"))
            .await
            .unwrap();
        set_links(&pool, "/ws/a.md", &["B".to_string(), "Missing".to_string()])
            .await
            .unwrap();
        set_links(&pool, "/ws/b.md", &["A".to_string()])
            .await
            .unwrap();

        let mut links = all_links(&pool, "/ws").await.unwrap();
        links.sort();

        assert_eq!(
            links,
            vec![
                ("/ws/a.md".to_string(), "B".to_string()),
                ("/ws/a.md".to_string(), "Missing".to_string()),
                ("/ws/b.md".to_string(), "A".to_string()),
            ]
        );
    }

    #[tokio::test]
    async fn test_all_links_excludes_other_workspaces() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "A", "/ws/a.md", "/ws"))
            .await
            .unwrap();
        index_note(&pool, &note("c", "C", "/other/c.md", "/other"))
            .await
            .unwrap();
        set_links(&pool, "/ws/a.md", &["X".to_string()])
            .await
            .unwrap();
        set_links(&pool, "/other/c.md", &["Y".to_string()])
            .await
            .unwrap();

        let links = all_links(&pool, "/ws").await.unwrap();

        assert_eq!(links, vec![("/ws/a.md".to_string(), "X".to_string())]);
    }

    fn task(text: &str, done: bool, position: i64) -> ExtractedTask {
        ExtractedTask {
            text: text.to_string(),
            done,
            position,
        }
    }

    #[tokio::test]
    async fn test_set_tasks_replaces_existing_tasks_for_a_note() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "A", "/ws/a.md", "/ws"))
            .await
            .unwrap();
        set_tasks(
            &pool,
            "/ws/a.md",
            &[task("first", false, 0), task("second", true, 2)],
        )
        .await
        .unwrap();
        set_tasks(&pool, "/ws/a.md", &[task("only", false, 0)])
            .await
            .unwrap();

        let open = open_tasks(&pool, "/ws").await.unwrap();
        assert_eq!(open.len(), 1);
        assert_eq!(open[0].text, "only");
    }

    #[tokio::test]
    async fn test_open_tasks_excludes_done_tasks_and_other_workspaces() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "A", "/ws/a.md", "/ws"))
            .await
            .unwrap();
        index_note(&pool, &note("c", "C", "/other/c.md", "/other"))
            .await
            .unwrap();
        set_tasks(
            &pool,
            "/ws/a.md",
            &[task("open one", false, 0), task("done one", true, 1)],
        )
        .await
        .unwrap();
        set_tasks(&pool, "/other/c.md", &[task("other workspace", false, 0)])
            .await
            .unwrap();

        let open = open_tasks(&pool, "/ws").await.unwrap();
        assert_eq!(open.len(), 1);
        assert_eq!(open[0].text, "open one");
        assert_eq!(open[0].note_path, "/ws/a.md");
        assert_eq!(open[0].note_title, "A");
    }

    #[tokio::test]
    async fn test_open_tasks_orders_by_note_title_then_position() {
        let pool = make_pool().await;
        index_note(&pool, &note("b", "Beta", "/ws/b.md", "/ws"))
            .await
            .unwrap();
        index_note(&pool, &note("a", "Alpha", "/ws/a.md", "/ws"))
            .await
            .unwrap();
        set_tasks(&pool, "/ws/b.md", &[task("beta task", false, 0)])
            .await
            .unwrap();
        set_tasks(
            &pool,
            "/ws/a.md",
            &[
                task("alpha second", false, 1),
                task("alpha first", false, 0),
            ],
        )
        .await
        .unwrap();

        let open = open_tasks(&pool, "/ws").await.unwrap();
        let texts: Vec<&str> = open.iter().map(|t| t.text.as_str()).collect();
        assert_eq!(texts, vec!["alpha first", "alpha second", "beta task"]);
    }

    #[tokio::test]
    async fn test_update_path_also_rewrites_tasks() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "A", "/ws/old.md", "/ws"))
            .await
            .unwrap();
        set_tasks(&pool, "/ws/old.md", &[task("todo", false, 0)])
            .await
            .unwrap();

        update_path(&pool, "/ws/old.md", "/ws/Folder/old.md")
            .await
            .unwrap();

        let open = open_tasks(&pool, "/ws").await.unwrap();
        assert_eq!(open[0].note_path, "/ws/Folder/old.md");
    }

    #[tokio::test]
    async fn test_remove_notes_under_also_deletes_tasks() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "A", "/ws/Course1/a.md", "/ws"))
            .await
            .unwrap();
        set_tasks(&pool, "/ws/Course1/a.md", &[task("todo", false, 0)])
            .await
            .unwrap();

        remove_notes_under(&pool, "/ws/Course1/").await.unwrap();

        let open = open_tasks(&pool, "/ws").await.unwrap();
        assert!(open.is_empty());
    }

    fn card(kind: CardKind, front: &str, back: &str, position: i64) -> ExtractedCard {
        ExtractedCard {
            kind,
            front: front.into(),
            back: back.into(),
            position,
            due: None,
            ease: None,
            interval: None,
            reps: None,
            grade: None,
            streak: None,
            lapses: None,
            suspended: false,
            options: Vec::new(),
            correct: Vec::new(),
        }
    }

    #[tokio::test]
    async fn test_set_cards_replaces_existing_cards_for_a_note() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "A", "/ws/a.md", "/ws"))
            .await
            .unwrap();
        set_cards(
            &pool,
            "/ws/a.md",
            &[
                card(CardKind::Qa, "Q1", "A1", 0),
                card(CardKind::Qa, "Q2", "A2", 2),
            ],
        )
        .await
        .unwrap();
        set_cards(&pool, "/ws/a.md", &[card(CardKind::Qa, "only", "one", 0)])
            .await
            .unwrap();

        let due = due_cards(&pool, "/ws", "9999-12-31").await.unwrap();
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].front, "only");
    }

    #[tokio::test]
    async fn test_new_card_with_no_schedule_defaults_to_due_today() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "A", "/ws/a.md", "/ws"))
            .await
            .unwrap();
        set_cards(
            &pool,
            "/ws/a.md",
            &[card(CardKind::Cloze, "front", "back", 0)],
        )
        .await
        .unwrap();

        let due = due_cards(&pool, "/ws", &sm2::today()).await.unwrap();
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].kind, "cloze");
    }

    #[tokio::test]
    async fn test_due_cards_excludes_not_yet_due_and_other_workspaces() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "A", "/ws/a.md", "/ws"))
            .await
            .unwrap();
        index_note(&pool, &note("c", "C", "/other/c.md", "/other"))
            .await
            .unwrap();
        let mut future = card(CardKind::Qa, "not due yet", "back", 0);
        future.due = Some("2099-01-01".to_string());
        future.ease = Some(2.5);
        future.interval = Some(400);
        future.reps = Some(5);
        set_cards(&pool, "/ws/a.md", &[future]).await.unwrap();
        set_cards(
            &pool,
            "/other/c.md",
            &[card(CardKind::Qa, "other workspace", "back", 0)],
        )
        .await
        .unwrap();

        let due = due_cards(&pool, "/ws", "2026-08-20").await.unwrap();
        assert!(due.is_empty());
    }

    #[tokio::test]
    async fn test_update_path_also_rewrites_cards() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "A", "/ws/old.md", "/ws"))
            .await
            .unwrap();
        set_cards(&pool, "/ws/old.md", &[card(CardKind::Qa, "Q", "A", 0)])
            .await
            .unwrap();

        update_path(&pool, "/ws/old.md", "/ws/Folder/old.md")
            .await
            .unwrap();

        let due = due_cards(&pool, "/ws", "9999-12-31").await.unwrap();
        assert_eq!(due[0].note_path, "/ws/Folder/old.md");
    }

    #[tokio::test]
    async fn test_remove_notes_under_also_deletes_cards() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "A", "/ws/Folder/a.md", "/ws"))
            .await
            .unwrap();
        set_cards(&pool, "/ws/Folder/a.md", &[card(CardKind::Qa, "Q", "A", 0)])
            .await
            .unwrap();

        remove_notes_under(&pool, "/ws/Folder/").await.unwrap();

        let due = due_cards(&pool, "/ws", "9999-12-31").await.unwrap();
        assert!(due.is_empty());
    }

    #[tokio::test]
    async fn test_all_note_tags_returns_every_tag_in_the_workspace() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "A", "/ws/a.md", "/ws"))
            .await
            .unwrap();
        index_note(&pool, &note("b", "B", "/ws/b.md", "/ws"))
            .await
            .unwrap();
        set_tags(
            &pool,
            "/ws/a.md",
            &["cs101".to_string(), "exam".to_string()],
        )
        .await
        .unwrap();
        set_tags(&pool, "/ws/b.md", &["cs101".to_string()])
            .await
            .unwrap();

        let mut tags = all_note_tags(&pool, "/ws").await.unwrap();
        tags.sort();

        assert_eq!(
            tags,
            vec![
                ("/ws/a.md".to_string(), "cs101".to_string()),
                ("/ws/a.md".to_string(), "exam".to_string()),
                ("/ws/b.md".to_string(), "cs101".to_string()),
            ]
        );
    }

    #[tokio::test]
    async fn test_set_cards_persists_mc_options_and_serves_them_via_due_cards() {
        let pool = make_pool().await;
        index_note(
            &pool,
            &NoteMetadata {
                id: "1".into(),
                title: "N".into(),
                path: "/ws/a.md".into(),
                workspace: "/ws".into(),
                updated_at: 0,
            },
        )
        .await
        .unwrap();
        let cards = vec![ExtractedCard {
            kind: CardKind::Mc,
            front: "Q".into(),
            back: String::new(),
            position: 0,
            due: None,
            ease: None,
            interval: None,
            reps: None,
            grade: None,
            streak: None,
            lapses: None,
            suspended: false,
            options: vec!["a".into(), "b".into()],
            correct: vec![1],
        }];
        set_cards(&pool, "/ws/a.md", &cards).await.unwrap();

        let due = due_cards(&pool, "/ws", "9999-12-31").await.unwrap();
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].kind, "mc");
        assert_eq!(due[0].options, vec!["a", "b"]);
    }

    #[tokio::test]
    async fn test_due_cards_qa_card_has_empty_options() {
        let pool = make_pool().await;
        index_note(
            &pool,
            &NoteMetadata {
                id: "1".into(),
                title: "N".into(),
                path: "/ws/a.md".into(),
                workspace: "/ws".into(),
                updated_at: 0,
            },
        )
        .await
        .unwrap();
        let cards = vec![ExtractedCard {
            kind: CardKind::Qa,
            front: "Q".into(),
            back: "A".into(),
            position: 0,
            due: None,
            ease: None,
            interval: None,
            reps: None,
            grade: None,
            streak: None,
            lapses: None,
            suspended: false,
            options: Vec::new(),
            correct: Vec::new(),
        }];
        set_cards(&pool, "/ws/a.md", &cards).await.unwrap();

        let due = due_cards(&pool, "/ws", "9999-12-31").await.unwrap();
        assert!(due[0].options.is_empty());
    }

    #[tokio::test]
    async fn test_set_cards_defaults_streak_to_zero_when_absent_and_persists_a_given_value() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "A", "/ws/a.md", "/ws"))
            .await
            .unwrap();
        let mut with_streak = card(CardKind::Qa, "Q1", "A1", 0);
        with_streak.streak = Some(3);
        let mut without_streak = card(CardKind::Qa, "Q2", "A2", 1);
        without_streak.streak = None;
        set_cards(&pool, "/ws/a.md", &[with_streak, without_streak])
            .await
            .unwrap();

        let all = list_all_cards(&pool, "/ws").await.unwrap();
        let q1 = all.iter().find(|c| c.front == "Q1").unwrap();
        let q2 = all.iter().find(|c| c.front == "Q2").unwrap();
        assert_eq!(q1.streak, 3);
        assert_eq!(q2.streak, 0);
    }

    #[tokio::test]
    async fn test_due_cards_includes_streak() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "A", "/ws/a.md", "/ws"))
            .await
            .unwrap();
        let mut c = card(CardKind::Qa, "Q1", "A1", 0);
        c.streak = Some(2);
        set_cards(&pool, "/ws/a.md", &[c]).await.unwrap();

        let due = due_cards(&pool, "/ws", &sm2::today()).await.unwrap();
        assert_eq!(due[0].streak, 2);
    }

    #[tokio::test]
    async fn test_list_cards_by_category_filters_by_streak_and_excludes_others() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "A", "/ws/a.md", "/ws"))
            .await
            .unwrap();

        let mut streak_two = card(CardKind::Qa, "in category", "back", 0);
        streak_two.streak = Some(2);
        streak_two.due = Some("2099-01-01".to_string()); // far future — proves due-date is ignored
        let mut streak_zero = card(CardKind::Qa, "not in category", "back", 1);
        streak_zero.streak = Some(0);
        set_cards(&pool, "/ws/a.md", &[streak_two, streak_zero])
            .await
            .unwrap();

        let category = list_cards_by_category(&pool, "/ws", 2, false)
            .await
            .unwrap();
        assert_eq!(category.len(), 1);
        assert_eq!(category[0].front, "in category");
    }

    #[tokio::test]
    async fn test_list_cards_by_category_splits_streak_zero_by_struggling() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "A", "/ws/a.md", "/ws"))
            .await
            .unwrap();

        let mut brand_new = card(CardKind::Qa, "new", "back", 0);
        brand_new.streak = Some(0);
        brand_new.lapses = Some(0);
        let mut struggling = card(CardKind::Qa, "struggling", "back", 1);
        struggling.streak = Some(0);
        struggling.lapses = Some(3);
        set_cards(&pool, "/ws/a.md", &[brand_new, struggling])
            .await
            .unwrap();

        let new_only = list_cards_by_category(&pool, "/ws", 0, false)
            .await
            .unwrap();
        assert_eq!(new_only.len(), 1);
        assert_eq!(new_only[0].front, "new");

        let struggling_only = list_cards_by_category(&pool, "/ws", 0, true).await.unwrap();
        assert_eq!(struggling_only.len(), 1);
        assert_eq!(struggling_only[0].front, "struggling");
    }

    #[tokio::test]
    async fn test_list_cards_by_category_struggling_flag_is_a_no_op_off_streak_zero() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "A", "/ws/a.md", "/ws"))
            .await
            .unwrap();

        let mut streak_two = card(CardKind::Qa, "in category", "back", 0);
        streak_two.streak = Some(2);
        streak_two.lapses = Some(1);
        set_cards(&pool, "/ws/a.md", &[streak_two]).await.unwrap();

        let category = list_cards_by_category(&pool, "/ws", 2, false)
            .await
            .unwrap();
        assert_eq!(category.len(), 1, "streak != 0 ignores the struggling flag");
    }

    #[tokio::test]
    async fn test_list_all_cards_includes_cards_regardless_of_due_date_with_tags() {
        let pool = make_pool().await;
        index_note(
            &pool,
            &NoteMetadata {
                id: "1".into(),
                title: "N".into(),
                path: "/ws/a.md".into(),
                workspace: "/ws".into(),
                updated_at: 0,
            },
        )
        .await
        .unwrap();
        set_tags(&pool, "/ws/a.md", &["cs".into(), "algo".into()])
            .await
            .unwrap();
        let cards = vec![ExtractedCard {
            kind: CardKind::Qa,
            front: "Q".into(),
            back: "A".into(),
            position: 0,
            due: Some("2099-01-01".into()), // far future — would never show in due_cards
            ease: Some(2.5),
            interval: Some(30),
            reps: Some(2),
            grade: Some(sm2::Grade::Good),
            streak: None,
            lapses: None,
            suspended: false,
            options: Vec::new(),
            correct: Vec::new(),
        }];
        set_cards(&pool, "/ws/a.md", &cards).await.unwrap();

        let all = list_all_cards(&pool, "/ws").await.unwrap();

        assert_eq!(all.len(), 1);
        assert_eq!(all[0].due, "2099-01-01");
        assert_eq!(all[0].interval, 30);
        let mut tags = all[0].tags.clone();
        tags.sort();
        assert_eq!(tags, vec!["algo", "cs"]);
    }

    #[tokio::test]
    async fn test_due_cards_and_cram_cards_exclude_suspended_cards() {
        let pool = make_pool().await;
        index_note(&pool, &note("a", "A", "/ws/a.md", "/ws"))
            .await
            .unwrap();

        let mut normal = card(CardKind::Qa, "active", "ans", 0);
        normal.due = Some("2020-01-01".into());

        let mut suspended = card(CardKind::Qa, "suspended", "ans", 1);
        suspended.due = Some("2020-01-01".into());
        suspended.suspended = true;

        set_cards(&pool, "/ws/a.md", &[normal, suspended])
            .await
            .unwrap();

        let due = due_cards(&pool, "/ws", "9999-12-31").await.unwrap();
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].front, "active");

        let cram = list_cards_by_category(&pool, "/ws", 0, false)
            .await
            .unwrap();
        assert_eq!(cram.len(), 1);
        assert_eq!(cram[0].front, "active");

        let all = list_all_cards(&pool, "/ws").await.unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].suspended, false);
        assert_eq!(all[1].suspended, true);
    }
}

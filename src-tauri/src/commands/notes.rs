use crate::db::{self, DbPool};
use crate::models::{
    BacklinkEntry, CardKind, CardSummary, CodeLinkEntry, DueCard, ExtractedCallout, ExtractedCard,
    ExtractedFormula, ExtractedTask, GraphLink, GraphTag, McGradeResult, NoteMetadata, OpenTask,
    SearchResult, WorkspaceTree,
};
use crate::sm2;
use regex::Regex;
use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

pub(super) fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

// open_note/save_note/delete_note/read_template each receive a note's own
// full path (produced by scan_workspace, already absolute) rather than a
// workspace-relative target, so they can't reuse editor_launch's
// resolve_in_workspace (which joins a relative path onto a base dir). Same
// posture as that function and assets.rs's resolve_relative though: reject a
// `..`/prefix-escaping component as written, before ever comparing against
// the workspace, so a literal escape can't be normalised away first (M-1).
pub(super) fn require_within_workspace(workspace: &str, path: &str) -> Result<(), String> {
    let candidate = Path::new(path);
    if !candidate.is_absolute() {
        return Err(format!("not an absolute path: {path}"));
    }
    for component in candidate.components() {
        if matches!(component, Component::ParentDir | Component::CurDir) {
            return Err(format!("path escapes the workspace: {path}"));
        }
    }
    if !candidate.starts_with(Path::new(workspace)) {
        return Err(format!("path is outside the workspace: {path}"));
    }
    Ok(())
}

const MAX_TITLE_CHARS: usize = 60;

fn truncate_title(s: &str) -> String {
    if s.chars().count() <= MAX_TITLE_CHARS {
        s.to_string()
    } else {
        let truncated: String = s.chars().take(MAX_TITLE_CHARS).collect();
        format!("{}…", truncated.trim_end())
    }
}

// Notes often open with a blockquote tagline or a horizontal rule before
// their actual heading, so the title can't just be "the first line" — it
// has to be the first ATX heading found anywhere in the document, falling
// back to the first non-heading line only when no heading exists at all.
pub fn title_from_content(content: &str) -> String {
    let mut fallback: Option<&str> = None;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.starts_with('#') {
            let heading = trimmed.trim_start_matches('#').trim();
            if !heading.is_empty() {
                return truncate_title(heading);
            }
            continue;
        }
        if fallback.is_none() {
            fallback = Some(trimmed);
        }
    }
    match fallback {
        Some(line) => truncate_title(line),
        None => "Untitled".to_string(),
    }
}

fn strip_code(content: &str) -> String {
    let without_fences = Regex::new(r"(?s)```.*?```")
        .map(|re| re.replace_all(content, "").into_owned())
        .unwrap_or_else(|_| content.to_string());
    Regex::new(r"`[^`\n]*`")
        .map(|re| re.replace_all(&without_fences, "").into_owned())
        .unwrap_or(without_fences)
}

pub fn extract_tags(content: &str) -> Vec<String> {
    let stripped = strip_code(content);
    let re = match Regex::new(r"(?:^|\s)#([A-Za-z][\w-]*)") {
        Ok(re) => re,
        Err(_) => return Vec::new(),
    };
    let mut seen = HashSet::new();
    let mut tags = Vec::new();
    for cap in re.captures_iter(&stripped) {
        if let Some(m) = cap.get(1) {
            let tag = m.as_str().to_string();
            if seen.insert(tag.to_lowercase()) {
                tags.push(tag);
            }
        }
    }
    tags
}

pub fn extract_links(content: &str) -> Vec<String> {
    let re = match Regex::new(r"\[\[([^\]\n]+)\]\]") {
        Ok(re) => re,
        Err(_) => return Vec::new(),
    };
    let mut seen = HashSet::new();
    let mut links = Vec::new();
    for cap in re.captures_iter(content) {
        if let Some(m) = cap.get(1) {
            let title = m.as_str().trim().to_string();
            if !title.is_empty() && seen.insert(title.to_lowercase()) {
                links.push(title);
            }
        }
    }
    links
}

// Rust port of `src/lib/codeLinks.ts`'s `PATTERN` — kept in sync by hand, not
// shared, since the two sides have no code-sharing mechanism. Captures the line
// number in group 1 (from `:58`) or group 2 (from `#L58`), and allows
// `strip_code_link_suffix` to obtain the bare target path.
const CODE_LINK_PATTERN: &str =
    r"(?:[\w.@+-]+/)+[\w.@+-]+\.[A-Za-z0-9]{1,8}(?::(\d+)(?::\d+)?|#L(\d+)(?:-L?\d+)?)?";

fn strip_code_link_suffix(m: &str) -> &str {
    match m.find(['#', ':']) {
        Some(i) => &m[..i],
        None => m,
    }
}

/// The workspace-relative paths and optional line numbers a note's prose
/// references as `src/main.cpp`- or `src/main.cpp:58`-style code links.
pub fn extract_code_links(content: &str) -> Vec<(String, Option<u32>)> {
    let re = match Regex::new(CODE_LINK_PATTERN) {
        Ok(re) => re,
        Err(_) => return Vec::new(),
    };
    let mut seen = HashSet::new();
    let mut links = Vec::new();
    for cap in re.captures_iter(content) {
        let whole = cap.get(0).map(|m| m.as_str()).unwrap_or("");
        let target = strip_code_link_suffix(whole).to_string();
        let line = cap
            .get(1)
            .or_else(|| cap.get(2))
            .and_then(|m| m.as_str().parse::<u32>().ok());
        if seen.insert((target.clone(), line)) {
            links.push((target, line));
        }
    }
    links
}

/// The workspace-relative paths a note's prose references as `src/main.cpp`-
/// or `src/main.cpp:58`-style code links (issue #37) — the reverse of what a
/// note forward-links to, mirroring `extract_links`' shape for `note_links`.
pub fn extract_code_link_targets(content: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut targets = Vec::new();
    for (target, _) in extract_code_links(content) {
        if seen.insert(target.clone()) {
            targets.push(target);
        }
    }
    targets
}

/// Reads the trimmed text of line `line` (1-indexed) in `path`, or `None` if
/// the file cannot be read or `line` is out of bounds (0 or beyond EOF).
pub async fn get_line_fingerprint(path: &Path, line: u32) -> Option<String> {
    if line == 0 {
        return None;
    }
    let content = tokio::fs::read_to_string(path).await.ok()?;
    content
        .lines()
        .nth((line - 1) as usize)
        .map(|l| l.trim().to_string())
}

/// Extracts all code links from `content`, capturing live line fingerprints
/// for targets that specify a line and exist in `workspace` (issue #52).
pub async fn extract_code_links_with_fingerprints(
    content: &str,
    workspace: &str,
) -> Vec<CodeLinkEntry> {
    let raw_links = extract_code_links(content);
    let mut entries = Vec::with_capacity(raw_links.len());
    for (target, line) in raw_links {
        let fingerprint = if let Some(line_num) = line {
            if let Ok(resolved) =
                crate::commands::editor_launch::resolve_in_workspace(workspace, &target)
            {
                get_line_fingerprint(&resolved, line_num).await
            } else {
                None
            }
        } else {
            None
        };
        entries.push(CodeLinkEntry {
            target,
            line,
            fingerprint,
        });
    }
    entries
}

/// Longest a backlink snippet is shown at before truncating with `…` — long
/// enough to read as a sentence fragment, short enough that one backlink
/// entry never dominates the panel.
const BACKLINK_SNIPPET_MAX_CHARS: usize = 160;

/// Trims `line` and truncates it to `BACKLINK_SNIPPET_MAX_CHARS`, appending
/// `…` when it was cut — shared by every backlink-style snippet extractor
/// below so the display shape (and limit) stays in one place.
fn finalize_snippet_line(line: &str) -> String {
    let trimmed = line.trim();
    if trimmed.chars().count() > BACKLINK_SNIPPET_MAX_CHARS {
        let truncated: String = trimmed.chars().take(BACKLINK_SNIPPET_MAX_CHARS).collect();
        format!("{truncated}…")
    } else {
        trimmed.to_string()
    }
}

/// The first line in `content` that links to `title` (case-insensitive,
/// matching how `backlinks_for`'s own SQL comparison works), trimmed and
/// truncated — or `None` if no such line exists. A line-based, not
/// character-offset-based, snippet: the whole surrounding sentence reads
/// more usefully than a fixed window of characters centered on the link.
pub fn extract_backlink_snippet(content: &str, title: &str) -> Option<String> {
    let pattern = format!(r"(?i)\[\[\s*{}\s*\]\]", regex::escape(title));
    let re = Regex::new(&pattern).ok()?;
    let line = content.lines().find(|line| re.is_match(line))?;
    Some(finalize_snippet_line(line))
}

/// Mirrors `extract_backlink_snippet`, but for a code link: the first line
/// whose own extracted targets contain `target` exactly, rather than a
/// `[[...]]`-bracketed regex match — a code link carries no bracket syntax to
/// anchor on.
pub fn extract_code_backlink_snippet(content: &str, target: &str) -> Option<String> {
    let line = content
        .lines()
        .find(|line| extract_code_link_targets(line).iter().any(|t| t == target))?;
    Some(finalize_snippet_line(line))
}

/// Mirrors `extract_backlink_snippet`, but for an unlinked mention: the first
/// line containing `title` as plain text (case-insensitive), with no
/// `[[...]]` bracket requirement — any note where the brackets *are* present
/// already has a `note_links` row and is filtered out before this runs (see
/// `unlinked_mentions_for`), so a plain substring match is enough here.
pub fn extract_unlinked_mention_snippet(content: &str, title: &str) -> Option<String> {
    let pattern = format!(r"(?i){}", regex::escape(title));
    let re = Regex::new(&pattern).ok()?;
    let line = content.lines().find(|line| re.is_match(line))?;
    Some(finalize_snippet_line(line))
}

// Line-based rather than `strip_code`-then-regex like `extract_tags`: removing
// fenced blocks from the string would shift line numbers, and `position` (the
// line index) is the key `toggle_task` uses to find the line back later. A
// running "inside a fence" flag gets the same "don't extract from an example
// block" behavior without ever renumbering a line.
pub fn extract_tasks(content: &str) -> Vec<ExtractedTask> {
    let re = match Regex::new(r"^\s*-\s\[([ xX])\]\s+(.+)$") {
        Ok(re) => re,
        Err(_) => return Vec::new(),
    };
    let mc_positions = mc_option_line_positions(content);
    let mut in_fence = false;
    let mut tasks = Vec::new();
    for (i, line) in content.lines().enumerate() {
        if line.trim_start().starts_with("```") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        if mc_positions.contains(&i) {
            continue;
        }
        if let Some(caps) = re.captures(line) {
            tasks.push(ExtractedTask {
                text: caps[2].trim().to_string(),
                done: caps[1].eq_ignore_ascii_case("x"),
                position: i as i64,
            });
        }
    }
    tasks
}

// Recognises the same two shapes `BlockMath.tsx`'s markdown-it rule reads: a
// one-liner `$$latex$$`, or a `$`/`$$` fence closed by the same marker across
// multiple lines. Line-based like `extract_tasks`, for the same reason —
// fenced code demonstrating math syntax must be skipped, not harvested — plus
// a running "nearest heading above" so each formula can be captioned with the
// section it came from (`None` before the note's first heading).
pub fn extract_formulas(content: &str) -> Vec<ExtractedFormula> {
    // `#{2,6}`, not `{1,6}`: a level-1 heading is conventionally the note's
    // own title, which the formula sheet already renders as the `##` group
    // for the whole note — tracking it as a formula's `heading` would just
    // repeat the note title as a redundant sub-caption for anything that
    // appears before the first real section heading.
    let heading_re = match Regex::new(r"^#{2,6}\s+(.+?)\s*$") {
        Ok(re) => re,
        Err(_) => return Vec::new(),
    };

    let lines: Vec<&str> = content.lines().collect();
    let mut in_fence = false;
    let mut current_heading: Option<String> = None;
    let mut formulas = Vec::new();
    let mut i = 0;

    while i < lines.len() {
        let trimmed = lines[i].trim();

        if trimmed.starts_with("```") {
            in_fence = !in_fence;
            i += 1;
            continue;
        }
        if in_fence {
            i += 1;
            continue;
        }

        if let Some(caps) = heading_re.captures(trimmed) {
            current_heading = Some(caps[1].to_string());
            i += 1;
            continue;
        }

        // One-liner: opened and closed by `$$` on the same line, with real
        // content between — `$$` alone falls through to the fence case below.
        if let Some(inner) = trimmed
            .strip_prefix("$$")
            .and_then(|rest| rest.strip_suffix("$$"))
        {
            let latex = inner.trim();
            if trimmed.len() > 4 && !latex.is_empty() {
                formulas.push(ExtractedFormula {
                    latex: latex.to_string(),
                    heading: current_heading.clone(),
                });
                i += 1;
                continue;
            }
        }

        // A fence closes on the marker it opened with: guessing which half of
        // a mismatched pair was meant would swallow the rest of the note.
        if trimmed == "$" || trimmed == "$$" {
            let marker = trimmed;
            let mut j = i + 1;
            while j < lines.len() && lines[j].trim() != marker {
                j += 1;
            }
            if j < lines.len() {
                let latex = lines[i + 1..j].join("\n").trim().to_string();
                if !latex.is_empty() {
                    formulas.push(ExtractedFormula {
                        latex,
                        heading: current_heading.clone(),
                    });
                }
                i = j + 1;
                continue;
            }
        }

        i += 1;
    }

    formulas
}

// Same heading-tracking, fence-skipping shape as `extract_formulas` — the
// two are meant to run side by side over the same content for #35 — but
// looks for a Callout's `> [!TYPE NUM] Title` marker line (the on-disk form
// `Callout.tsx`'s `addStorage().markdown.serialize` writes) instead of a
// `$...$` fence. Only the five numbered exam-content kinds P6-1/P6-2 added
// match; `note`/`tip`/`warning`/… are commentary and never extracted.
pub fn extract_callouts(content: &str) -> Vec<ExtractedCallout> {
    let heading_re = match Regex::new(r"^#{2,6}\s+(.+?)\s*$") {
        Ok(re) => re,
        Err(_) => return Vec::new(),
    };
    let marker_re = match Regex::new(
        r"(?i)^>\s?\[!(THEOREM|LEMMA|COROLLARY|DEFINITION|ALGORITHM)(?:\s+([\w.]+))?\]\s*(.*)$",
    ) {
        Ok(re) => re,
        Err(_) => return Vec::new(),
    };

    let lines: Vec<&str> = content.lines().collect();
    let mut in_fence = false;
    let mut current_heading: Option<String> = None;
    let mut callouts = Vec::new();
    let mut i = 0;

    while i < lines.len() {
        let trimmed = lines[i].trim();

        if trimmed.starts_with("```") {
            in_fence = !in_fence;
            i += 1;
            continue;
        }
        if in_fence {
            i += 1;
            continue;
        }

        if let Some(caps) = heading_re.captures(trimmed) {
            current_heading = Some(caps[1].to_string());
            i += 1;
            continue;
        }

        if let Some(caps) = marker_re.captures(trimmed) {
            let kind = caps[1].to_uppercase();
            let number = caps.get(2).map(|m| m.as_str().to_string());
            let title = match caps[3].trim() {
                "" => None,
                t => Some(t.to_string()),
            };

            // A blockquote continues for as long as lines keep starting with
            // `>` — the same rule `Callout.tsx`'s `wrapBlock` writes it with,
            // including a bare `>` for a blank paragraph-separator line.
            let mut j = i + 1;
            let mut body_lines = Vec::new();
            while j < lines.len() && lines[j].trim_start().starts_with('>') {
                let after_marker = &lines[j].trim_start()[1..];
                let rest = after_marker.strip_prefix(' ').unwrap_or(after_marker);
                body_lines.push(rest.to_string());
                j += 1;
            }

            callouts.push(ExtractedCallout {
                kind,
                number,
                title,
                body: body_lines.join("\n").trim().to_string(),
                heading: current_heading.clone(),
            });
            i = j;
            continue;
        }

        i += 1;
    }

    callouts
}

// due, ease, interval, reps, grade, streak, lapses, suspended
type SrComment = (
    String,
    f64,
    i64,
    i64,
    Option<sm2::Grade>,
    Option<i64>,
    Option<i64>,
    bool,
);

// A schedule comment is never itself a card, even though it starts a fresh
// line right after one — checked first so the loop below never has to
// special-case it.
fn parse_sr_comment(line: &str) -> Option<SrComment> {
    let re = match Regex::new(
        r"^<!--\s+sr\s+due=(\S+)\s+ease=(\S+)\s+interval=(\S+)\s+reps=(\S+)(?:\s+grade=(\S+))?(?:\s+streak=(\S+))?(?:\s+lapses=(\S+))?(?:\s+suspended=(\S+))?\s+-->$",
    ) {
        Ok(re) => re,
        Err(_) => return None,
    };
    let caps = re.captures(line.trim())?;
    let due = caps[1].to_string();
    let ease = caps[2].parse::<f64>().ok()?;
    let interval = caps[3].parse::<i64>().ok()?;
    let reps = caps[4].parse::<i64>().ok()?;
    let grade = caps.get(5).and_then(|m| match m.as_str() {
        "again" => Some(sm2::Grade::Again),
        "hard" => Some(sm2::Grade::Hard),
        "good" => Some(sm2::Grade::Good),
        "easy" => Some(sm2::Grade::Easy),
        _ => None,
    });
    let streak = caps.get(6).and_then(|m| m.as_str().parse::<i64>().ok());
    let lapses = caps.get(7).and_then(|m| m.as_str().parse::<i64>().ok());
    let suspended = caps
        .get(8)
        .map(|m| m.as_str().eq_ignore_ascii_case("true"))
        .unwrap_or(false);
    Some((due, ease, interval, reps, grade, streak, lapses, suspended))
}

// The schedule comment sits either directly after a card's content (a note
// never round-tripped through the editor, or one just graded by
// `grade_card_line` itself) or one blank line below it (round-tripped through
// the editor at least once — prosemirror-markdown puts a blank line between
// a taskList/paragraph and the differently-typed comment block that follows
// it, the same rule `mc_options_start` already documents for the
// question→options boundary). Preferring whichever position actually holds a
// parseable comment — rather than blindly skipping one line the way
// `mc_options_start` does — is what keeps a re-grade from inserting a
// duplicate instead of replacing the comment that is already there.
fn sr_comment_idx(lines: &[&str], after: usize) -> usize {
    if lines.get(after).and_then(|l| parse_sr_comment(l)).is_some() {
        return after;
    }
    if lines.get(after).is_some_and(|l| l.trim().is_empty())
        && lines
            .get(after + 1)
            .and_then(|l| parse_sr_comment(l))
            .is_some()
    {
        return after + 1;
    }
    after
}

fn checkbox_re() -> Regex {
    Regex::new(r"^\s*-\s\[([ xX])\]\s+(.+)$").expect("static checkbox regex")
}

// A bare "Question ::" with nothing after the "::" is the MC marker. Q::A
// always has content after it (`qa_re` in classify_card_line requires
// `\s(.+)$`), so this can never misfire on a real Q::A line.
fn is_mc_question_line(trimmed: &str) -> bool {
    Regex::new(r"^.+\s::$")
        .expect("static MC question regex")
        .is_match(trimmed)
}

// The line right after a typed `Question ::` is blank whenever the note was
// saved by this app's own editor: prosemirror-markdown always puts a blank
// line between a paragraph and a differently-typed block that follows it —
// a fixed boundary rule, not the "loose list" setting `TaskListTight`
// (editor/extensions/index.ts) already closes, which only covers spacing
// *between* a list's own items. Skip at most one such line before looking
// for the first option, so a block typed through the real editor still
// parses; a genuinely unrelated line right after the question (no options
// at all) is unaffected since the scan below still finds nothing there.
fn mc_options_start(lines: &[&str], start: usize) -> usize {
    if lines.get(start + 1).is_some_and(|l| l.trim().is_empty()) {
        start + 2
    } else {
        start + 1
    }
}

// How many lines separate a bare-`::` question line at `start` from the end
// of its option block — used to skip past the block regardless of whether
// it turns out to have a marked correct answer.
fn mc_block_option_count(lines: &[&str], start: usize) -> usize {
    let re = checkbox_re();
    let first = mc_options_start(lines, start);
    let mut j = first;
    while j < lines.len() && re.is_match(lines[j]) {
        j += 1;
    }
    if j == first {
        0
    } else {
        j - start - 1
    }
}

// Returns (front, options, correct-indices) only if at least one option is
// marked `[x]` — an MC block with no correct answer marked isn't gradeable,
// so it isn't a card (mirrors `classify_card_line` returning `None` for text
// that merely looks card-shaped).
fn parse_mc_block(lines: &[&str], start: usize) -> Option<(String, Vec<String>, Vec<usize>)> {
    let re = checkbox_re();
    let front = lines[start]
        .trim()
        .trim_end_matches("::")
        .trim()
        .to_string();
    let mut options = Vec::new();
    let mut correct = Vec::new();
    let mut j = mc_options_start(lines, start);
    while j < lines.len() {
        let caps = match re.captures(lines[j]) {
            Some(c) => c,
            None => break,
        };
        if caps[1].eq_ignore_ascii_case("x") {
            correct.push(options.len());
        }
        options.push(caps[2].trim().to_string());
        j += 1;
    }
    if correct.is_empty() {
        None
    } else {
        Some((front, options, correct))
    }
}

// Shared by extract_cards and extract_tasks so the two can never disagree
// about which lines are MC syntax: extract_tasks skips every line in this
// set (they'd otherwise leak into the Tasks view as fake to-dos, since
// `- [ ]`/`- [x]` is also extract_tasks's own pattern); extract_cards is the
// only consumer that treats them as content.
fn mc_option_line_positions(content: &str) -> HashSet<usize> {
    let lines: Vec<&str> = content.lines().collect();
    let mut in_fence = false;
    let mut positions = HashSet::new();
    let mut i = 0;
    while i < lines.len() {
        let trimmed = lines[i].trim();
        if trimmed.starts_with("```") {
            in_fence = !in_fence;
            i += 1;
            continue;
        }
        if in_fence {
            i += 1;
            continue;
        }
        if is_mc_question_line(trimmed) {
            let count = mc_block_option_count(&lines, i);
            positions.extend((i + 1)..=(i + count));
            i += 1 + count;
            continue;
        }
        i += 1;
    }
    positions
}

// Q::A checked first; a line matching both forms (rare — a "::" pair inside
// a {{cloze}} span) reads as Q::A, which is the more explicit authoring
// intent. One card per line, matching every other extractor in this file:
// all {{}} spans on a cloze line reveal together as a single card, not
// Anki-style per-span sub-cards.
fn classify_card_line(trimmed: &str) -> Option<(CardKind, String, String)> {
    if trimmed.is_empty() || trimmed.starts_with("<!--") {
        return None;
    }
    let qa_re = Regex::new(r"^(.+?)\s::\s(.+)$").ok()?;
    if let Some(caps) = qa_re.captures(trimmed) {
        return Some((
            CardKind::Qa,
            caps[1].trim().to_string(),
            caps[2].trim().to_string(),
        ));
    }
    let cloze_re = Regex::new(r"\{\{([^{}]+)\}\}").ok()?;
    if cloze_re.is_match(trimmed) {
        let front = cloze_re.replace_all(trimmed, "[...]").to_string();
        let back = cloze_re.replace_all(trimmed, "$1").to_string();
        return Some((CardKind::Cloze, front, back));
    }
    None
}

// Line-based like `extract_tasks`/`extract_formulas`, for the same reason:
// `position` (the line index) is the identity `grade_card` uses to find a
// card's schedule-comment line back, so fenced code must be skipped without
// ever renumbering a line.
pub fn extract_cards(content: &str) -> Vec<ExtractedCard> {
    let lines: Vec<&str> = content.lines().collect();
    let mut in_fence = false;
    let mut cards = Vec::new();
    let mut i = 0;

    while i < lines.len() {
        let trimmed = lines[i].trim();
        if trimmed.starts_with("```") {
            in_fence = !in_fence;
            i += 1;
            continue;
        }
        if in_fence {
            i += 1;
            continue;
        }

        if is_mc_question_line(trimmed) {
            let option_count = mc_block_option_count(&lines, i);
            if let Some((front, options, correct)) = parse_mc_block(&lines, i) {
                let comment_idx = sr_comment_idx(&lines, i + 1 + option_count);
                let (due, ease, interval, reps, grade, streak, lapses, suspended) = lines
                    .get(comment_idx)
                    .and_then(|l| parse_sr_comment(l))
                    .map(|(d, e, iv, r, g, s, l, sub)| {
                        (Some(d), Some(e), Some(iv), Some(r), g, s, l, sub)
                    })
                    .unwrap_or((None, None, None, None, None, None, None, false));
                cards.push(ExtractedCard {
                    kind: CardKind::Mc,
                    front,
                    back: String::new(),
                    position: i as i64,
                    due,
                    ease,
                    interval,
                    reps,
                    grade,
                    streak,
                    lapses,
                    suspended,
                    options,
                    correct,
                });
            }
            i += 1 + option_count;
            continue;
        }

        let (kind, front, back) = match classify_card_line(trimmed) {
            Some(c) => c,
            None => {
                i += 1;
                continue;
            }
        };

        let comment_idx = sr_comment_idx(&lines, i + 1);
        let (due, ease, interval, reps, grade, streak, lapses, suspended) = lines
            .get(comment_idx)
            .and_then(|l| parse_sr_comment(l))
            .map(|(d, e, iv, r, g, s, l, sub)| (Some(d), Some(e), Some(iv), Some(r), g, s, l, sub))
            .unwrap_or((None, None, None, None, None, None, None, false));

        cards.push(ExtractedCard {
            kind,
            front,
            back,
            position: i as i64,
            due,
            ease,
            interval,
            reps,
            grade,
            streak,
            lapses,
            suspended,
            options: Vec::new(),
            correct: Vec::new(),
        });
        i += 1;
    }

    cards
}

#[tauri::command]
pub async fn list_notes(
    workspace: String,
    db: State<'_, DbPool>,
) -> Result<Vec<NoteMetadata>, String> {
    db::notes::list_by_workspace(&db, &workspace)
        .await
        .map_err(|e| e.to_string())
}

/// Build and dependency directories, skipped so a code repository can be
/// opened as a workspace directly.
///
/// A workspace is just a folder scanned for `.md`, so pointing the app at a
/// project already works — except the scan walks `node_modules/` and
/// `target/` and drowns long before it reaches `docs/`. This list is what
/// makes P7-3's "no importing" true rather than merely technically true.
/// `.git` needs no entry; the dot rule already covers it.
const EXCLUDED_DIRS: [&str; 4] = ["node_modules", "target", "dist", "build"];

/// Sidecar directories, which hold a note's ink, rendered PDF pages and
/// pasted images. They travel with the notes (see the storage boundary) but
/// they are not folders the user made, and listing them in the tree offers a
/// place to file a note that nothing should ever file a note in.
const SIDECAR_SUFFIXES: [&str; 4] = [".ink", ".pdf", ".assets", ".diagrams"];

/// The workspace folder templates live in (P6-3). Excluded from the ordinary
/// scan for the same reason as the sidecar suffixes above: a template is
/// authored to be filled in, not a note in its own right, so it has no
/// business showing up in the tree or the search index.
const TEMPLATES_DIR: &str = "templates";

/// Dropped into every folder `create_folder` makes. It lives in the folder, not
/// in `.workspace.json`, so it survives rename/move and travels with the notes
/// while staying a plain dotfile the scan already ignores. Without it an empty
/// folder is indistinguishable from one some other tool made.
const FOLDER_MARKER: &str = ".nullnotes";

pub(crate) fn is_excluded_dir(name: &str) -> bool {
    name.starts_with('.')
        || SIDECAR_SUFFIXES.iter().any(|suffix| name.ends_with(suffix))
        || EXCLUDED_DIRS.contains(&name)
        || name == TEMPLATES_DIR
}

pub(super) async fn scan_dir_recursive(
    root: &std::path::Path,
    workspace: &str,
) -> anyhow::Result<(Vec<NoteMetadata>, Vec<String>)> {
    let mut notes = Vec::new();
    let mut folders = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    let mut shown = std::collections::HashSet::new();

    while let Some(dir) = stack.pop() {
        let mut entries = tokio::fs::read_dir(&dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            let file_type = entry.file_type().await?;

            if entry.file_name() == FOLDER_MARKER {
                shown.insert(dir.clone());
                continue;
            }

            if file_type.is_dir() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if is_excluded_dir(&name) {
                    continue;
                }
                folders.push(path.to_string_lossy().into_owned());
                stack.push(path);
                continue;
            }

            if path.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }
            shown.insert(dir.clone());
            let path_str = path.to_string_lossy().into_owned();
            let title = match tokio::fs::read_to_string(&path).await {
                Ok(content) => title_from_content(&content),
                Err(_) => path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("Untitled")
                    .to_string(),
            };
            let updated_at = entry
                .metadata()
                .await
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or_else(now_ms);
            notes.push(NoteMetadata {
                id: Uuid::new_v4().to_string(),
                title,
                path: path_str,
                workspace: workspace.to_string(),
                updated_at,
            });
        }
    }

    // Ancestors of a kept folder need no entry: the tree builder recreates
    // every intermediate segment from the deeper path.
    folders.retain(|f| shown.contains(std::path::Path::new(f)));

    Ok((notes, folders))
}

#[tauri::command]
pub async fn scan_workspace(
    workspace: String,
    db: State<'_, DbPool>,
) -> Result<WorkspaceTree, String> {
    let (notes, folders) = scan_dir_recursive(std::path::Path::new(&workspace), &workspace)
        .await
        .map_err(|e| e.to_string())?;

    for meta in &notes {
        db::notes::index_note(&db, meta)
            .await
            .map_err(|e| e.to_string())?;
    }

    let indexed = db::notes::list_by_workspace(&db, &workspace)
        .await
        .map_err(|e| e.to_string())?;

    Ok(WorkspaceTree {
        notes: indexed,
        folders,
    })
}

#[tauri::command]
pub async fn open_note(workspace: String, path: String) -> Result<String, String> {
    require_within_workspace(&workspace, &path)?;
    tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| e.to_string())
}

// A note is only ever replaced wholesale, so a partially written file is
// always corruption. Write a sibling temp file, fsync it, then rename over
// the target — the reader sees either the whole old note or the whole new one.
async fn write_atomic(path: &Path, content: &str) -> anyhow::Result<()> {
    let dir = path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("note path has no parent directory: {}", path.display()))?;
    let file_name = path
        .file_name()
        .ok_or_else(|| anyhow::anyhow!("note path has no file name: {}", path.display()))?;
    let tmp = dir.join(format!(
        ".{}.{}.tmp",
        file_name.to_string_lossy(),
        Uuid::new_v4()
    ));

    let write = async {
        let mut file = tokio::fs::File::create(&tmp).await?;
        file.write_all(content.as_bytes()).await?;
        file.sync_all().await?;
        anyhow::Ok(())
    };

    let result = match write.await {
        Ok(()) => tokio::fs::rename(&tmp, path)
            .await
            .map_err(anyhow::Error::from),
        Err(e) => Err(e),
    };
    if result.is_err() {
        let _ = tokio::fs::remove_file(&tmp).await;
    }
    result
}

// Pages-mode notes hold only `pdf-page` blocks referencing rendered page
// images — none of a PDF's own text ever lands in the note's Markdown, so
// without this the note is unsearchable by content (issue #33). The text
// itself lives in the `.pdf` sidecar `import_pdf_pages` wrote it into, not
// the note file, so it can't just be part of `content` here.
async fn pdf_search_text_for(note_path: &str) -> String {
    let sidecar = super::sidecar_dir_for(note_path, "pdf");
    let text_path = Path::new(&sidecar).join(super::pdf::PDF_SEARCH_TEXT_FILE);
    tokio::fs::read_to_string(text_path)
        .await
        .unwrap_or_default()
}

// A ```diagram block's `jsonSrc` (DiagramBlock.tsx's markdown serializer)
// points at the `.excalidraw` sidecar holding the actual scene — the only
// place a diagram's typed text elements (state/node labels) exist as
// machine-readable text (issue #41). Pulls just those `text`-type elements'
// strings out, skipping anything that doesn't parse rather than failing the
// whole reindex over one malformed or missing diagram.
async fn diagram_search_text_for(content: &str) -> String {
    let re = match Regex::new(r"(?s)```diagram\n(.*?)\n```") {
        Ok(re) => re,
        Err(_) => return String::new(),
    };
    let mut texts = Vec::new();
    for caps in re.captures_iter(content) {
        let Some(json_src) = caps
            .get(1)
            .and_then(|g| serde_json::from_str::<serde_json::Value>(g.as_str()).ok())
            .and_then(|block| block.get("jsonSrc")?.as_str().map(str::to_string))
        else {
            continue;
        };
        let Ok(raw) = tokio::fs::read_to_string(&json_src).await else {
            continue;
        };
        let Ok(scene) = serde_json::from_str::<serde_json::Value>(&raw) else {
            continue;
        };
        let Some(elements) = scene.get("elements").and_then(|e| e.as_array()) else {
            continue;
        };
        for element in elements {
            if element.get("type").and_then(|t| t.as_str()) != Some("text") {
                continue;
            }
            if let Some(text) = element.get("text").and_then(|t| t.as_str()) {
                texts.push(text.to_string());
            }
        }
    }
    texts.join("\n")
}

pub(super) async fn index_note_at(
    path: &str,
    workspace: &str,
    content: &str,
    db: &DbPool,
) -> anyhow::Result<()> {
    let title = title_from_content(content);
    let meta = NoteMetadata {
        id: Uuid::new_v4().to_string(),
        title: title.clone(),
        path: path.to_string(),
        workspace: workspace.to_string(),
        updated_at: now_ms(),
    };
    db::notes::index_note(db, &meta).await?;
    let pdf_text = pdf_search_text_for(path).await;
    let diagram_text = diagram_search_text_for(content).await;
    let mut fts_body = content.to_string();
    for extra in [&pdf_text, &diagram_text] {
        if !extra.is_empty() {
            fts_body.push_str("\n\n");
            fts_body.push_str(extra);
        }
    }
    db::notes::index_note_content(db, path, &title, &fts_body).await?;
    db::notes::set_tags(db, path, &extract_tags(content)).await?;
    db::notes::set_links(db, path, &extract_links(content)).await?;
    let code_links = extract_code_links_with_fingerprints(content, workspace).await;
    db::notes::set_code_links(db, path, &code_links).await?;
    db::notes::set_tasks(db, path, &extract_tasks(content)).await?;
    db::notes::set_cards(db, path, &extract_cards(content)).await?;
    Ok(())
}

// Deliberately does no database work: typing latency must not depend on
// FTS/tag/link reindexing. The caller drives `reindex_note` separately.
#[tauri::command]
pub async fn save_note(workspace: String, path: String, content: String) -> Result<(), String> {
    require_within_workspace(&workspace, &path)?;
    write_atomic(Path::new(&path), &content)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn reindex_note(
    path: String,
    workspace: String,
    content: String,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    index_note_at(&path, &workspace, &content, &db)
        .await
        .map_err(|e| e.to_string())
}

// Used when a file changes underneath us: the index follows the disk, and a
// note deleted externally drops out of search, tags and links.
#[tauri::command]
pub async fn reindex_from_disk(
    path: String,
    workspace: String,
    db: State<'_, DbPool>,
) -> Result<bool, String> {
    match tokio::fs::read_to_string(&path).await {
        Ok(content) => index_note_at(&path, &workspace, &content, &db)
            .await
            .map(|()| true)
            .map_err(|e| e.to_string()),
        Err(_) => {
            forget_note(&path, &db).await.map_err(|e| e.to_string())?;
            Ok(false)
        }
    }
}

// Replaces the same heading `title_from_content` would have read the title
// from, preserving its `#` depth. A note with no heading at all (the
// fallback-first-line case) gets one prepended, matching `create_note`'s shape.
fn rewrite_title(content: &str, new_title: &str) -> String {
    let mut replaced = false;
    let mut lines: Vec<String> = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if !replaced && !trimmed.is_empty() && trimmed.starts_with('#') {
            let heading = trimmed.trim_start_matches('#').trim();
            if !heading.is_empty() {
                let hashes: String = trimmed.chars().take_while(|c| *c == '#').collect();
                lines.push(format!("{hashes} {new_title}"));
                replaced = true;
                continue;
            }
        }
        lines.push(line.to_string());
    }
    let mut rewritten = lines.join("\n");
    if content.ends_with('\n') {
        rewritten.push('\n');
    }
    if !replaced {
        rewritten = format!("# {new_title}\n\n{rewritten}");
    }
    rewritten
}

// Flips the checkbox on the line at `position` (the same 0-indexed line
// number `extract_tasks` assigned it), matching `rewrite_title`'s
// split-rejoin-preserve-trailing-newline shape. `None` means the line no
// longer looks like a task — the note changed on disk since the view last
// listed it — and the caller surfaces that as a normal error rather than
// silently mangling an unrelated line.
fn toggle_task_line(content: &str, position: i64) -> Option<String> {
    let re = Regex::new(r"^(\s*-\s\[)([ xX])(\]\s.*)$").ok()?;
    let mut lines: Vec<String> = content.lines().map(str::to_string).collect();
    let idx = usize::try_from(position).ok()?;
    let line = lines.get(idx)?;
    let caps = re.captures(line)?;
    let flipped = if caps[2].eq_ignore_ascii_case("x") {
        " "
    } else {
        "x"
    };
    lines[idx] = format!("{}{}{}", &caps[1], flipped, &caps[3]);

    let mut rewritten = lines.join("\n");
    if content.ends_with('\n') {
        rewritten.push('\n');
    }
    Some(rewritten)
}

async fn toggle_task_at(
    path: &str,
    position: i64,
    workspace: &str,
    db: &DbPool,
) -> anyhow::Result<()> {
    let content = tokio::fs::read_to_string(path).await?;
    let new_content = toggle_task_line(&content, position)
        .ok_or_else(|| anyhow::anyhow!("no task at line {position} in {path}"))?;
    write_atomic(Path::new(path), &new_content).await?;
    index_note_at(path, workspace, &new_content, db).await?;
    Ok(())
}

// Mirrors `toggle_task_line`'s shape exactly: pure, no I/O, `None` when the
// line no longer looks like a card (the note changed on disk since the
// review queue was built) — surfaced as an error by the caller, never
// silently mangling an unrelated line.
pub fn grade_card_line(
    content: &str,
    position: i64,
    grade: sm2::Grade,
    today: chrono::NaiveDate,
) -> Option<String> {
    let mut lines: Vec<String> = content.lines().map(str::to_string).collect();
    let idx = usize::try_from(position).ok()?;
    let trimmed = lines.get(idx)?.trim().to_string();

    let borrowed: Vec<&str> = lines.iter().map(String::as_str).collect();
    let comment_idx = if is_mc_question_line(&trimmed) {
        let option_count = mc_block_option_count(&borrowed, idx);
        if option_count == 0 {
            return None;
        }
        sr_comment_idx(&borrowed, idx + 1 + option_count)
    } else {
        classify_card_line(&trimmed)?;
        sr_comment_idx(&borrowed, idx + 1)
    };

    let (current, current_streak, current_lapses, current_suspended) = lines
        .get(comment_idx)
        .and_then(|l| parse_sr_comment(l))
        .map(|(_, ease, interval, reps, _, streak, lapses, suspended)| {
            (
                sm2::CardState {
                    ease,
                    interval,
                    reps,
                },
                streak.unwrap_or(0),
                lapses.unwrap_or(0),
                suspended,
            )
        })
        .unwrap_or((sm2::CardState::default(), 0, 0, false));

    let next = sm2::next_state(current, grade, today);
    let next_streak = sm2::next_streak(current_streak, grade);
    let next_lapses = sm2::next_lapses(current_lapses, current.reps, grade);
    let suspended_part = if current_suspended {
        " suspended=true"
    } else {
        ""
    };
    let comment = format!(
        "<!-- sr due={} ease={:.2} interval={} reps={} grade={} streak={} lapses={}{} -->",
        next.due,
        next.ease,
        next.interval,
        next.reps,
        grade.as_str(),
        next_streak,
        next_lapses,
        suspended_part
    );

    let has_comment_line = lines
        .get(comment_idx)
        .map(|l| parse_sr_comment(l).is_some())
        .unwrap_or(false);
    if has_comment_line {
        lines[comment_idx] = comment;
    } else {
        lines.insert(comment_idx, comment);
    }

    let mut rewritten = lines.join("\n");
    if content.ends_with('\n') {
        rewritten.push('\n');
    }
    Some(rewritten)
}

pub fn set_card_suspended_line(content: &str, position: i64, suspended: bool) -> Option<String> {
    let mut lines: Vec<String> = content.lines().map(str::to_string).collect();
    let idx = usize::try_from(position).ok()?;
    let trimmed = lines.get(idx)?.trim().to_string();

    let borrowed: Vec<&str> = lines.iter().map(String::as_str).collect();
    let comment_idx = if is_mc_question_line(&trimmed) {
        let option_count = mc_block_option_count(&borrowed, idx);
        if option_count == 0 {
            return None;
        }
        sr_comment_idx(&borrowed, idx + 1 + option_count)
    } else {
        classify_card_line(&trimmed)?;
        sr_comment_idx(&borrowed, idx + 1)
    };

    let (due, ease, interval, reps, grade, streak, lapses, _old_suspended) = lines
        .get(comment_idx)
        .and_then(|l| parse_sr_comment(l))
        .unwrap_or_else(|| (sm2::today(), 2.5, 0, 0, None, None, None, false));

    let grade_part = grade
        .map(|g| format!(" grade={}", g.as_str()))
        .unwrap_or_default();
    let streak_part = streak.map(|s| format!(" streak={s}")).unwrap_or_default();
    let lapses_part = lapses.map(|l| format!(" lapses={l}")).unwrap_or_default();
    let suspended_part = if suspended { " suspended=true" } else { "" };
    let comment = format!(
        "<!-- sr due={due} ease={ease:.2} interval={interval} reps={reps}{grade_part}{streak_part}{lapses_part}{suspended_part} -->"
    );

    let has_comment_line = lines
        .get(comment_idx)
        .map(|l| parse_sr_comment(l).is_some())
        .unwrap_or(false);
    if has_comment_line {
        lines[comment_idx] = comment;
    } else {
        lines.insert(comment_idx, comment);
    }

    let mut rewritten = lines.join("\n");
    if content.ends_with('\n') {
        rewritten.push('\n');
    }
    Some(rewritten)
}

async fn set_card_suspended_at(
    path: &str,
    position: i64,
    suspended: bool,
    workspace: &str,
    db: &DbPool,
) -> anyhow::Result<()> {
    let content = read_note_or_forget(path, db).await?;
    let new_content = set_card_suspended_line(&content, position, suspended)
        .ok_or_else(|| anyhow::anyhow!("no card at line {position} in {path}"))?;
    write_atomic(Path::new(path), &new_content).await?;
    index_note_at(path, workspace, &new_content, db).await?;
    Ok(())
}

// A card can outlive its note in the index: nothing purges a workspace
// scan's stale rows (see scan_workspace), so a note deleted outside the
// app (Explorer, a git pull) leaves its review_cards row queued forever.
// Reads are the one place that naturally discovers this, so clean up right
// here rather than guessing from a directory snapshot elsewhere. Shared by
// every grading path (grade_card_at, grade_mc_card_at) so this cleanup is
// written once, not duplicated per caller.
async fn read_note_or_forget(path: &str, db: &DbPool) -> anyhow::Result<String> {
    match tokio::fs::read_to_string(path).await {
        Ok(content) => Ok(content),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            forget_note(path, db).await?;
            anyhow::bail!("note no longer exists on disk; removed from review queue");
        }
        Err(e) => Err(e.into()),
    }
}

async fn grade_card_at(
    path: &str,
    position: i64,
    grade: sm2::Grade,
    workspace: &str,
    db: &DbPool,
) -> anyhow::Result<()> {
    let content = read_note_or_forget(path, db).await?;
    let today = chrono::Utc::now().date_naive();
    let new_content = grade_card_line(&content, position, grade, today)
        .ok_or_else(|| anyhow::anyhow!("no card at line {position} in {path}"))?;
    write_atomic(Path::new(path), &new_content).await?;
    index_note_at(path, workspace, &new_content, db).await?;
    Ok(())
}

async fn grade_mc_card_at(
    path: &str,
    position: i64,
    picked: &[usize],
    workspace: &str,
    db: &DbPool,
) -> anyhow::Result<McGradeResult> {
    let content = read_note_or_forget(path, db).await?;
    let lines: Vec<&str> = content.lines().collect();
    let idx = usize::try_from(position)?;
    let trimmed = lines
        .get(idx)
        .ok_or_else(|| anyhow::anyhow!("no card at line {position} in {path}"))?
        .trim();
    if !is_mc_question_line(trimmed) {
        anyhow::bail!("line {position} in {path} is not a multiple-choice card");
    }
    let (_, _, correct) = parse_mc_block(&lines, idx)
        .ok_or_else(|| anyhow::anyhow!("no multiple-choice card at line {position} in {path}"))?;

    let mut picked_sorted = picked.to_vec();
    picked_sorted.sort_unstable();
    let mut correct_sorted = correct.clone();
    correct_sorted.sort_unstable();
    let is_correct = picked_sorted == correct_sorted;

    let option_count = mc_block_option_count(&lines, idx);
    let last_grade = lines
        .get(idx + 1 + option_count)
        .and_then(|l| parse_sr_comment(l))
        .and_then(|(_, _, _, _, grade, _, _, _)| grade);
    let resolved = sm2::mc_auto_grade(last_grade, is_correct);

    grade_card_at(path, position, resolved, workspace, db).await?;

    Ok(McGradeResult { correct })
}

// Wiki-links resolve by title case-insensitively (`backlinks_for`), and
// `extract_links` trims whitespace inside the brackets, so the rewrite must
// tolerate both rather than only matching an exact `[[Old]]`.
fn rewrite_links(content: &str, old_title: &str, new_title: &str) -> anyhow::Result<String> {
    let pattern = format!(r"(?i)\[\[\s*{}\s*\]\]", regex::escape(old_title));
    let re = Regex::new(&pattern)?;
    Ok(re
        .replace_all(content, |_: &regex::Captures| format!("[[{new_title}]]"))
        .into_owned())
}

// Image/ink/pdf/diagram embeds hold a sidecar-relative link ("Old Note.assets/
// foo.png"); NoteImage's Markdown syntax stores it `encodeURI`-escaped, the
// fenced ink/pdf/diagram blocks store it raw. Rewriting the directory prefix
// in both forms keeps embeds resolvable after the sidecar dirs are renamed.
fn rewrite_sidecar_links(content: &str, old_stem: &str, new_stem: &str) -> String {
    let mut out = content.to_string();
    for suffix in [".ink", ".pdf", ".assets", ".diagrams"] {
        out = out.replace(
            &format!("{old_stem}{suffix}/"),
            &format!("{new_stem}{suffix}/"),
        );
        out = out.replace(
            &format!("{}{suffix}/", encode_uri_stem(old_stem)),
            &format!("{}{suffix}/", encode_uri_stem(new_stem)),
        );
    }
    out
}

// Mirrors the frontend's `encodeURI` boundary encoding (NoteImage.tsx) for
// exactly the characters `note_filename` can produce: alphanumerics, spaces
// and dashes. Spaces become `%20`; non-ASCII letters are percent-encoded by
// UTF-8 byte, same as JS's encodeURI.
fn encode_uri_stem(stem: &str) -> String {
    let mut out = String::new();
    for c in stem.chars() {
        if c.is_ascii_alphanumeric() || c == '-' {
            out.push(c);
        } else if c == ' ' {
            out.push_str("%20");
        } else {
            let mut buf = [0u8; 4];
            for byte in c.encode_utf8(&mut buf).as_bytes() {
                out.push_str(&format!("%{byte:02X}"));
            }
        }
    }
    out
}

// Titles are how `create_note` derives a filename in the first place, so a
// rename that leaves the filename behind is only half done — everything that
// keys off the path (Explorer, `.workspace.json`, git) would keep showing the
// pre-rename name forever. Move the file (and its sidecars) to match, the
// same way `move_note_at` does for a drag-and-drop move, and hand the new
// path back so the caller can update open tabs.
async fn rename_note_at(
    path: &str,
    new_title: &str,
    workspace: &str,
    db: &DbPool,
) -> anyhow::Result<NoteMetadata> {
    let old_content = tokio::fs::read_to_string(path).await?;
    let old_title = title_from_content(&old_content);

    let mut new_content = rewrite_title(&old_content, new_title);
    if old_title != new_title {
        new_content = rewrite_links(&new_content, &old_title, new_title)?;
    }

    let parent = Path::new(path)
        .parent()
        .ok_or_else(|| anyhow::anyhow!("note path has no parent folder: {path}"))?;
    let desired_path = parent.join(note_filename(new_title));
    let desired_path_str = desired_path.to_string_lossy().into_owned();

    let new_path = if desired_path_str != path {
        // Same silent-overwrite hazard as `move_note_at`: a same-named note
        // already at the destination must block the rename, not lose its content.
        if tokio::fs::metadata(&desired_path).await.is_ok() {
            anyhow::bail!("a note already exists at {desired_path_str}");
        }
        tokio::fs::rename(path, &desired_path).await?;
        for suffix in ["ink", "pdf", "diagrams", "assets"] {
            let old_dir = super::sidecar_dir_for(path, suffix);
            if tokio::fs::metadata(&old_dir).await.is_ok() {
                let new_dir = super::sidecar_dir_for(&desired_path_str, suffix);
                tokio::fs::rename(&old_dir, &new_dir).await?;
            }
        }
        db::notes::update_path(db, path, &desired_path_str).await?;
        desired_path_str
    } else {
        path.to_string()
    };

    // Sidecar dirs were just renamed above; the note's own Markdown still
    // points image/ink/pdf/diagram embeds at the pre-rename directory name
    // unless those links are rewritten the same way title/wiki-links are.
    if new_path != path {
        let old_stem = Path::new(path)
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy();
        let new_stem = Path::new(&new_path)
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy();
        new_content = rewrite_sidecar_links(&new_content, &old_stem, &new_stem);
    }

    write_atomic(Path::new(&new_path), &new_content).await?;
    index_note_at(&new_path, workspace, &new_content, db).await?;

    if old_title != new_title {
        for backlinker in db::notes::backlinks_for(db, workspace, &old_title).await? {
            if backlinker.path == new_path {
                continue;
            }
            let content = tokio::fs::read_to_string(&backlinker.path).await?;
            let rewritten = rewrite_links(&content, &old_title, new_title)?;
            if rewritten != content {
                write_atomic(Path::new(&backlinker.path), &rewritten).await?;
                index_note_at(&backlinker.path, workspace, &rewritten, db).await?;
            }
        }
    }

    Ok(NoteMetadata {
        id: Uuid::new_v4().to_string(),
        title: new_title.to_string(),
        path: new_path,
        workspace: workspace.to_string(),
        updated_at: now_ms(),
    })
}

#[tauri::command]
pub async fn rename_note(
    path: String,
    new_title: String,
    workspace: String,
    db: State<'_, DbPool>,
) -> Result<NoteMetadata, String> {
    rename_note_at(&path, &new_title, &workspace, &db)
        .await
        .map_err(|e| e.to_string())
}

// Same-length stand-in for `strip_code`: fenced and inline code spans are
// blanked out (newlines kept) rather than removed, so match byte offsets
// found in the masked copy line up exactly with `content`.
fn mask_code(content: &str) -> String {
    let mask = |s: &str| -> String {
        s.chars()
            .map(|c| if c == '\n' { '\n' } else { 'x' })
            .collect()
    };
    let fenced = Regex::new(r"(?s)```.*?```")
        .map(|re| {
            re.replace_all(content, |caps: &regex::Captures| mask(&caps[0]))
                .into_owned()
        })
        .unwrap_or_else(|_| content.to_string());
    Regex::new(r"`[^`\n]*`")
        .map(|re| {
            re.replace_all(&fenced, |caps: &regex::Captures| mask(&caps[0]))
                .into_owned()
        })
        .unwrap_or(fenced)
}

// Rewrites only the tag word itself (the capture group), not the leading `#`
// or whitespace `extract_tags`'s own pattern anchors on — same match, smaller
// replacement. Matched against `mask_code(content)` so a tag name that also
// appears inside a fenced or inline code span (`#include`, `#define`) is left
// alone, consistent with `extract_tags` never counting those as tags either.
fn rewrite_tag(content: &str, old_tag: &str, new_tag: &str) -> anyhow::Result<String> {
    let masked = mask_code(content);
    let re = Regex::new(r"(?:^|\s)#([A-Za-z][\w-]*)")?;
    let old_lower = old_tag.to_lowercase();
    let mut result = String::with_capacity(content.len());
    let mut last_end = 0;
    for caps in re.captures_iter(&masked) {
        let m = caps
            .get(1)
            .expect("group 1 always matches with the outer alternation");
        if m.as_str().to_lowercase() != old_lower {
            continue;
        }
        result.push_str(&content[last_end..m.start()]);
        result.push_str(new_tag);
        last_end = m.end();
    }
    result.push_str(&content[last_end..]);
    Ok(result)
}

async fn rename_tag_at(
    old_tag: &str,
    new_tag: &str,
    workspace: &str,
    db: &DbPool,
) -> anyhow::Result<usize> {
    let mut renamed = 0;
    for note in db::notes::notes_with_tag(db, workspace, old_tag).await? {
        let content = tokio::fs::read_to_string(&note.path).await?;
        let rewritten = rewrite_tag(&content, old_tag, new_tag)?;
        if rewritten != content {
            write_atomic(Path::new(&note.path), &rewritten).await?;
            index_note_at(&note.path, workspace, &rewritten, db).await?;
            renamed += 1;
        }
    }
    Ok(renamed)
}

// `new_tag` has to match the shape `extract_tags` recognizes, or the rewrite
// silently drops the tag from the index instead of renaming it.
fn is_valid_tag(tag: &str) -> bool {
    Regex::new(r"^[A-Za-z][\w-]*$")
        .map(|re| re.is_match(tag))
        .unwrap_or(false)
}

/// Finds every note tagged `#old_tag` and rewrites it to `#new_tag`, the same
/// "find every note, rewrite text, reindex" shape `rename_note_at` uses for
/// title/link renames, keyed on tag text instead of a note title. Returns the
/// number of notes touched.
#[tauri::command]
pub async fn rename_tag(
    old_tag: String,
    new_tag: String,
    workspace: String,
    db: State<'_, DbPool>,
) -> Result<usize, String> {
    if !is_valid_tag(&new_tag) {
        return Err(format!("\"{new_tag}\" isn't a valid tag name"));
    }
    rename_tag_at(&old_tag, &new_tag, &workspace, &db)
        .await
        .map_err(|e| e.to_string())
}

pub(super) async fn forget_note(path: &str, db: &DbPool) -> anyhow::Result<()> {
    db::notes::remove_note(db, path).await?;
    db::notes::remove_from_fts(db, path).await?;
    db::notes::set_tags(db, path, &[]).await?;
    db::notes::set_links(db, path, &[]).await?;
    db::notes::set_code_links(db, path, &[]).await?;
    db::notes::set_tasks(db, path, &[]).await?;
    db::notes::set_cards(db, path, &[]).await?;
    Ok(())
}

#[tauri::command]
pub async fn create_note(
    workspace: String,
    folder: String,
    title: String,
    db: State<'_, DbPool>,
) -> Result<NoteMetadata, String> {
    let path = create_note_file(&folder, &title)
        .await
        .map_err(|e| e.to_string())?;
    let body = format!("# {}\n", title);

    let meta = NoteMetadata {
        id: Uuid::new_v4().to_string(),
        title: title.clone(),
        path: path.to_string_lossy().into_owned(),
        workspace,
        updated_at: now_ms(),
    };
    index_note_at(&meta.path, &meta.workspace, &body, &db)
        .await
        .map_err(|e| e.to_string())?;

    Ok(meta)
}

#[tauri::command]
pub async fn search_notes(
    workspace: String,
    query: String,
    folder: Option<String>,
    tag: Option<String>,
    block_type: Option<String>,
    all_workspaces: bool,
    db: State<'_, DbPool>,
) -> Result<Vec<SearchResult>, String> {
    let trimmed = query.trim();
    let fts_query = if trimmed.is_empty() {
        None
    } else {
        Some(
            trimmed
                .split_whitespace()
                .map(|w| format!("\"{}\"*", w.replace('"', "")))
                .collect::<Vec<_>>()
                .join(" "),
        )
    };

    // A bare `folder:` or `tag:` with no free text is a real, useful search
    // ("everything in this folder") — only truly empty input short-circuits.
    if fts_query.is_none() && folder.is_none() && tag.is_none() && block_type.is_none() {
        return Ok(vec![]);
    }

    db::notes::search_notes(
        &db,
        if all_workspaces {
            None
        } else {
            Some(&workspace)
        },
        fts_query.as_deref(),
        folder.as_deref(),
        tag.as_deref(),
        block_type.as_deref(),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_tags(workspace: String, db: State<'_, DbPool>) -> Result<Vec<String>, String> {
    db::notes::list_tags(&db, &workspace)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn notes_with_tag(
    workspace: String,
    tag: String,
    db: State<'_, DbPool>,
) -> Result<Vec<NoteMetadata>, String> {
    db::notes::notes_with_tag(&db, &workspace, &tag)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_open_tasks(
    workspace: String,
    db: State<'_, DbPool>,
) -> Result<Vec<OpenTask>, String> {
    db::notes::open_tasks(&db, &workspace)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn toggle_task(
    path: String,
    position: i64,
    workspace: String,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    toggle_task_at(&path, position, &workspace, &db)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn grade_card(
    path: String,
    position: i64,
    grade: sm2::Grade,
    workspace: String,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    grade_card_at(&path, position, grade, &workspace, &db)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn grade_mc_card(
    path: String,
    position: i64,
    picked: Vec<usize>,
    workspace: String,
    db: State<'_, DbPool>,
) -> Result<McGradeResult, String> {
    grade_mc_card_at(&path, position, &picked, &workspace, &db)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_card_suspended(
    path: String,
    position: i64,
    suspended: bool,
    workspace: String,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    set_card_suspended_at(&path, position, suspended, &workspace, &db)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_due_cards(
    workspace: String,
    db: State<'_, DbPool>,
) -> Result<Vec<DueCard>, String> {
    db::notes::due_cards(&db, &workspace, &sm2::today())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_all_cards(
    workspace: String,
    db: State<'_, DbPool>,
) -> Result<Vec<CardSummary>, String> {
    db::notes::list_all_cards(&db, &workspace)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_cram_cards(
    workspace: String,
    streak: i64,
    struggling: bool,
    db: State<'_, DbPool>,
) -> Result<Vec<DueCard>, String> {
    db::notes::list_cards_by_category(&db, &workspace, streak, struggling)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn backlinks_for(
    workspace: String,
    title: String,
    db: State<'_, DbPool>,
) -> Result<Vec<NoteMetadata>, String> {
    db::notes::backlinks_for(&db, &workspace, &title)
        .await
        .map_err(|e| e.to_string())
}

/// `db::notes::backlinks_for` alone only has each linking note's metadata,
/// not where in it the link sits, so this reads each note's own file to
/// find that line. A file that fails to read (deleted since the last scan)
/// still contributes its note with `snippet: None`, rather than dropping
/// the whole entry or failing the request — the same "prefer a miss" call
/// as everywhere else that resolves note-derived content against disk.
async fn backlinks_with_context(
    pool: &DbPool,
    workspace: &str,
    title: &str,
) -> anyhow::Result<Vec<BacklinkEntry>> {
    let notes = db::notes::backlinks_for(pool, workspace, title).await?;
    let mut entries = Vec::with_capacity(notes.len());
    for note in notes {
        let snippet = tokio::fs::read_to_string(&note.path)
            .await
            .ok()
            .and_then(|content| extract_backlink_snippet(&content, title));
        entries.push(BacklinkEntry { note, snippet });
    }
    Ok(entries)
}

#[tauri::command]
pub async fn backlinks_for_with_context(
    workspace: String,
    title: String,
    db: State<'_, DbPool>,
) -> Result<Vec<BacklinkEntry>, String> {
    backlinks_with_context(&db, &workspace, &title)
        .await
        .map_err(|e| e.to_string())
}

/// Mirrors `backlinks_with_context`, for code links: which notes reference
/// `target`, and the line each references it on (issue #37).
async fn code_backlinks_with_context(
    pool: &DbPool,
    workspace: &str,
    target: &str,
) -> anyhow::Result<Vec<BacklinkEntry>> {
    let notes = db::notes::code_backlinks_for(pool, workspace, target).await?;
    let mut entries = Vec::with_capacity(notes.len());
    for note in notes {
        let snippet = tokio::fs::read_to_string(&note.path)
            .await
            .ok()
            .and_then(|content| extract_code_backlink_snippet(&content, target));
        entries.push(BacklinkEntry { note, snippet });
    }
    Ok(entries)
}

#[tauri::command]
pub async fn code_backlinks_for_with_context(
    workspace: String,
    target: String,
    db: State<'_, DbPool>,
) -> Result<Vec<BacklinkEntry>, String> {
    code_backlinks_with_context(&db, &workspace, &target)
        .await
        .map_err(|e| e.to_string())
}

/// Mirrors `backlinks_with_context`, for plain-text mentions of `title` that
/// carry no `[[...]]` link (issue #48) — same read-each-file-for-a-snippet
/// shape, `note_path` excludes the note asking about its own title.
async fn unlinked_mentions_with_context(
    pool: &DbPool,
    workspace: &str,
    title: &str,
    note_path: &str,
) -> anyhow::Result<Vec<BacklinkEntry>> {
    let notes = db::notes::unlinked_mentions_for(pool, workspace, title, note_path).await?;
    let mut entries = Vec::with_capacity(notes.len());
    for note in notes {
        let snippet = tokio::fs::read_to_string(&note.path)
            .await
            .ok()
            .and_then(|content| extract_unlinked_mention_snippet(&content, title));
        entries.push(BacklinkEntry { note, snippet });
    }
    Ok(entries)
}

#[tauri::command]
pub async fn unlinked_mentions_for_with_context(
    workspace: String,
    title: String,
    note_path: String,
    db: State<'_, DbPool>,
) -> Result<Vec<BacklinkEntry>, String> {
    unlinked_mentions_with_context(&db, &workspace, &title, &note_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn graph_links(
    workspace: String,
    db: State<'_, DbPool>,
) -> Result<Vec<GraphLink>, String> {
    let rows = db::notes::all_links(&db, &workspace)
        .await
        .map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|(source_path, target_title)| GraphLink {
            source_path,
            target_title,
        })
        .collect())
}

#[tauri::command]
pub async fn graph_tags(workspace: String, db: State<'_, DbPool>) -> Result<Vec<GraphTag>, String> {
    let rows = db::notes::all_note_tags(&db, &workspace)
        .await
        .map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|(note_path, tag)| GraphTag { note_path, tag })
        .collect())
}

fn note_filename(title: &str) -> String {
    let safe_name: String = title
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == ' ' {
                c
            } else {
                '-'
            }
        })
        .collect();
    format!("{}.md", safe_name.trim())
}

// Filenames are derived from titles, so two different notes can want the same
// one. Creating over an existing file would silently destroy it, so refuse and
// let the caller report the collision.
async fn create_note_file(folder: &str, title: &str) -> anyhow::Result<PathBuf> {
    create_note_file_with_content(folder, title, &format!("# {title}\n")).await
}

/// Rewrites a note into `## Task N` / `### Solution` pairs, on request.
///
/// Deliberately takes and returns Markdown rather than a note path: the caller
/// is the open editor, whose buffer may hold edits that have not reached disk
/// yet, and rewriting the file underneath it would fight the save path.
#[tauri::command]
pub fn split_into_tasks(markdown: String) -> String {
    crate::exercises::split_into_tasks(&markdown)
}

/// P6-3's required first template: P4-3's own Task/Solution layout, so the
/// feature ships with something usable in `templates/` rather than an empty
/// folder and a promise. `{{course}}`/`{{sheet}}` are literal find-and-replace
/// placeholders — no substitution engine beyond that, per the DoD.
const EXERCISE_SHEET_TEMPLATE: &str = "# {{course}} — {{sheet}}\n\n## Task 1\n\n### Solution\n\n\n## Task 2\n\n### Solution\n\n\n## Task 3\n\n### Solution\n";

const DEFAULT_TEMPLATES: [(&str, &str); 1] = [("Exercise Sheet", EXERCISE_SHEET_TEMPLATE)];

fn template_metadata(name: &str, path: &Path) -> crate::models::TemplateMetadata {
    crate::models::TemplateMetadata {
        name: name.to_string(),
        path: path.to_string_lossy().into_owned(),
    }
}

/// Lists the `.md` files directly under `templates/`, flat — no recursion,
/// no logic. A missing folder is an empty list, not an error: nothing has
/// asked for the folder to exist yet.
async fn list_templates_at(
    workspace: &str,
) -> anyhow::Result<Vec<crate::models::TemplateMetadata>> {
    let dir = Path::new(workspace).join(TEMPLATES_DIR);
    let mut entries = match tokio::fs::read_dir(&dir).await {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.into()),
    };

    let mut templates = Vec::new();
    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        let name = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Untitled")
            .to_string();
        templates.push(template_metadata(&name, &path));
    }
    templates.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(templates)
}

/// Seeds `templates/` with whichever starter templates aren't already there.
/// Never overwrites — same "top up, don't replace" rule as
/// `scaffold_project_notes_at` — and runs only when the empty-state button
/// asks for it, never on workspace open.
async fn seed_default_templates_at(
    workspace: &str,
) -> anyhow::Result<Vec<crate::models::TemplateMetadata>> {
    let dir = Path::new(workspace).join(TEMPLATES_DIR);
    tokio::fs::create_dir_all(&dir).await?;

    let mut created = Vec::new();
    for (name, content) in DEFAULT_TEMPLATES {
        let path = dir.join(note_filename(name));
        if tokio::fs::try_exists(&path).await? {
            continue;
        }
        write_atomic(&path, content).await?;
        created.push(template_metadata(name, &path));
    }
    Ok(created)
}

// Same collision rule as `create_note_file`: refuse rather than silently
// destroy an existing note. The only difference is the body comes from the
// caller (a filled-in template) instead of a synthesized `# {title}` heading.
async fn create_note_file_with_content(
    folder: &str,
    title: &str,
    content: &str,
) -> anyhow::Result<PathBuf> {
    let filename = note_filename(title);
    let path = Path::new(folder).join(&filename);
    if tokio::fs::try_exists(&path).await? {
        anyhow::bail!("a note named \"{filename}\" already exists here");
    }
    write_atomic(&path, content).await?;
    Ok(path)
}

#[tauri::command]
pub async fn list_templates(
    workspace: String,
) -> Result<Vec<crate::models::TemplateMetadata>, String> {
    list_templates_at(&workspace)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn read_template(workspace: String, path: String) -> Result<String, String> {
    require_within_workspace(&workspace, &path)?;
    tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn seed_default_templates(
    workspace: String,
) -> Result<Vec<crate::models::TemplateMetadata>, String> {
    seed_default_templates_at(&workspace)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_note_from_template(
    workspace: String,
    folder: String,
    title: String,
    content: String,
    db: State<'_, DbPool>,
) -> Result<NoteMetadata, String> {
    let path = create_note_file_with_content(&folder, &title, &content)
        .await
        .map_err(|e| e.to_string())?;

    let meta = NoteMetadata {
        id: Uuid::new_v4().to_string(),
        title: title.clone(),
        path: path.to_string_lossy().into_owned(),
        workspace,
        updated_at: now_ms(),
    };
    index_note_at(&meta.path, &meta.workspace, &content, &db)
        .await
        .map_err(|e| e.to_string())?;

    Ok(meta)
}

fn formula_sheet_title(folder: Option<&str>, tag: Option<&str>) -> String {
    match (folder, tag) {
        (None, None) => "Formula Sheet".to_string(),
        (Some(f), None) => format!("Formula Sheet - {f}"),
        (None, Some(t)) => format!("Formula Sheet - {t}"),
        (Some(f), Some(t)) => format!("Formula Sheet - {f} - {t}"),
    }
}

/// Groups consecutively by (note, heading) — the input is already in scope
/// order, so a run of entries sharing a note or heading is always contiguous
/// — and emits a `{note_level} Note Title` / `{heading_level} Heading` pair
/// only when either changes, rather than once per entry. Shared by both the
/// formula list and the #35 callout list, one level of heading deeper for
/// the latter since it nests under its own "Definitions & Theorems" section.
fn render_grouped_entries(
    out: &mut String,
    entries: &[(String, Option<String>, String)],
    note_level: &str,
    heading_level: &str,
) {
    let mut last_note: Option<String> = None;
    let mut last_heading: Option<Option<String>> = None;

    for (note_title, heading, body) in entries {
        if last_note.as_deref() != Some(note_title.as_str()) {
            out.push_str(&format!("\n{note_level} {note_title}\n"));
            last_note = Some(note_title.clone());
            last_heading = None;
        }
        if last_heading.as_ref() != Some(heading) {
            if let Some(h) = heading {
                out.push_str(&format!("\n{heading_level} {h}\n"));
            }
            last_heading = Some(heading.clone());
        }
        out.push_str(&format!("\n{body}\n"));
    }
}

/// Reconstructs a callout's `> [!TYPE NUM] Title` / `> body` markdown —
/// the same shape `Callout.tsx`'s serializer writes — from an
/// `ExtractedCallout`, so #35's formula-sheet entries can drop straight in
/// as a formatted block, the same way a formula entry is `$\n{latex}\n$`.
fn render_callout_block(callout: &ExtractedCallout) -> String {
    let marker = match &callout.number {
        Some(n) if !n.is_empty() => format!("{} {}", callout.kind, n),
        _ => callout.kind.clone(),
    };
    let mut out = match &callout.title {
        Some(t) => format!("> [!{marker}] {t}\n"),
        None => format!("> [!{marker}]\n"),
    };
    for line in callout.body.lines() {
        if line.is_empty() {
            out.push('>');
        } else {
            out.push_str("> ");
            out.push_str(line);
        }
        out.push('\n');
    }
    out.trim_end().to_string()
}

fn render_formula_sheet(
    title: &str,
    formulas: &[(String, Option<String>, String)],
    callouts: &[(String, Option<String>, String)],
) -> String {
    let mut out = format!("# {title}\n");
    let formula_bodies: Vec<_> = formulas
        .iter()
        .map(|(note, heading, latex)| (note.clone(), heading.clone(), format!("$\n{latex}\n$")))
        .collect();
    render_grouped_entries(&mut out, &formula_bodies, "##", "###");

    if !callouts.is_empty() {
        out.push_str("\n## Definitions & Theorems\n");
        render_grouped_entries(&mut out, callouts, "###", "####");
    }
    out
}

/// P9-2: every block-math formula across a scope, deduplicated and written
/// to a new plain note. Scope resolution and per-note extraction are already
/// tested in isolation (`db::notes::notes_in_scope`, `extract_formulas`) —
/// this is the part that's new: reading each scoped note's *current* file
/// content (not whatever's indexed, which can lag a still-open buffer),
/// deduping scope-wide by trimmed latex (first occurrence wins, so the sheet
/// stays stable across regenerations as long as the source notes don't
/// change), and handing the result to the same collision-refusing write path
/// every other generated note goes through.
async fn generate_formula_sheet_at(
    workspace: &str,
    folder: Option<&str>,
    tag: Option<&str>,
    db: &DbPool,
) -> anyhow::Result<NoteMetadata> {
    let scoped = db::notes::notes_in_scope(db, workspace, folder, tag).await?;

    let mut seen = HashSet::new();
    let mut entries = Vec::new();
    let mut seen_callouts = HashSet::new();
    let mut callout_entries = Vec::new();
    for note in &scoped {
        // Same posture as `reindex_from_disk`: an indexed path whose file is
        // gone (deleted outside the app, or an index that's drifted) is a
        // note with nothing left to contribute, not a reason to fail the
        // whole sheet.
        let Ok(content) = tokio::fs::read_to_string(&note.path).await else {
            continue;
        };
        for formula in extract_formulas(&content) {
            if seen.insert(formula.latex.clone()) {
                entries.push((note.title.clone(), formula.heading, formula.latex));
            }
        }
        for callout in extract_callouts(&content) {
            let block = render_callout_block(&callout);
            if seen_callouts.insert(block.clone()) {
                callout_entries.push((note.title.clone(), callout.heading, block));
            }
        }
    }

    let title = formula_sheet_title(folder, tag);
    let body = render_formula_sheet(&title, &entries, &callout_entries);
    let path = create_note_file_with_content(workspace, &title, &body).await?;

    let meta = NoteMetadata {
        id: Uuid::new_v4().to_string(),
        title,
        path: path.to_string_lossy().into_owned(),
        workspace: workspace.to_string(),
        updated_at: now_ms(),
    };
    index_note_at(&meta.path, &meta.workspace, &body, db).await?;
    Ok(meta)
}

#[tauri::command]
pub async fn generate_formula_sheet(
    workspace: String,
    folder: Option<String>,
    tag: Option<String>,
    db: State<'_, DbPool>,
) -> Result<NoteMetadata, String> {
    generate_formula_sheet_at(&workspace, folder.as_deref(), tag.as_deref(), &db)
        .await
        .map_err(|e| e.to_string())
}

async fn create_folder_at(parent: &str, name: &str) -> anyhow::Result<String> {
    use std::path::Component;
    let mut components = std::path::Path::new(name).components();
    if !matches!(
        (components.next(), components.next()),
        (Some(Component::Normal(_)), None)
    ) {
        anyhow::bail!("invalid folder name: {name}");
    }
    let path = std::path::Path::new(parent).join(name);
    tokio::fs::create_dir(&path).await?;
    tokio::fs::write(path.join(FOLDER_MARKER), "").await?;
    Ok(path.to_string_lossy().into_owned())
}

async fn rename_folder_at(old_path: &str, new_path: &str, db: &DbPool) -> anyhow::Result<()> {
    // `fs::rename` overwrites an existing destination silently (on Windows,
    // Rust's implementation passes MOVEFILE_REPLACE_EXISTING) — checked
    // up front so a name collision fails loudly instead of destroying
    // whatever already lived at `new_path`.
    if tokio::fs::metadata(new_path).await.is_ok() {
        anyhow::bail!("a file or folder already exists at {new_path}");
    }
    tokio::fs::rename(old_path, new_path).await?;
    let old_prefix = format!("{}{}", old_path, std::path::MAIN_SEPARATOR);
    let new_prefix = format!("{}{}", new_path, std::path::MAIN_SEPARATOR);
    db::notes::rename_path_prefix(db, &old_prefix, &new_prefix).await?;
    Ok(())
}

async fn move_note_at(path: &str, dest_folder: &str, db: &DbPool) -> anyhow::Result<String> {
    let file_name = std::path::Path::new(path)
        .file_name()
        .ok_or_else(|| anyhow::anyhow!("note path has no file name: {path}"))?
        .to_os_string();
    let new_path = std::path::Path::new(dest_folder).join(&file_name);
    // Same silent-overwrite hazard as `rename_folder_at`: a same-named note
    // already at the destination must block the move, not lose its content.
    if tokio::fs::metadata(&new_path).await.is_ok() {
        anyhow::bail!("a note already exists at {}", new_path.display());
    }
    tokio::fs::rename(path, &new_path).await?;

    let new_path_str = new_path.to_string_lossy().into_owned();
    // A note dragged into another folder must carry every sidecar with it —
    // a note whose ink, PDF pages, images or diagrams didn't travel with it
    // is a broken note (see the storage boundary contract in CLAUDE.md).
    for suffix in ["ink", "pdf", "diagrams", "assets"] {
        let old_dir = super::sidecar_dir_for(path, suffix);
        if tokio::fs::metadata(&old_dir).await.is_ok() {
            let new_dir = super::sidecar_dir_for(&new_path_str, suffix);
            tokio::fs::rename(&old_dir, &new_dir).await?;
        }
    }

    db::notes::update_path(db, path, &new_path_str).await?;
    Ok(new_path_str)
}

#[tauri::command]
pub async fn create_folder(parent: String, name: String) -> Result<String, String> {
    create_folder_at(&parent, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rename_folder(
    old_path: String,
    new_path: String,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    rename_folder_at(&old_path, &new_path, &db)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn move_note(
    path: String,
    dest_folder: String,
    db: State<'_, DbPool>,
) -> Result<String, String> {
    move_note_at(&path, &dest_folder, &db)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn require_within_workspace_accepts_a_path_inside_the_workspace() {
        let tmp = tempdir().unwrap();
        let ws = tmp.path().to_string_lossy().into_owned();
        let note = tmp.path().join("Note.md").to_string_lossy().into_owned();
        let nested = tmp
            .path()
            .join("Folder")
            .join("Note.md")
            .to_string_lossy()
            .into_owned();

        assert!(require_within_workspace(&ws, &note).is_ok());
        assert!(require_within_workspace(&ws, &nested).is_ok());
    }

    // The classic string-prefix bug: a sibling directory whose name extends
    // the workspace's own name (".../ws-evil") starts with the string ".../ws"
    // but is not inside it.
    #[test]
    fn require_within_workspace_refuses_a_sibling_directory_with_a_shared_prefix() {
        let tmp = tempdir().unwrap();
        let ws = tmp.path().join("ws").to_string_lossy().into_owned();
        let sibling = tmp
            .path()
            .join("ws-evil")
            .join("secret.md")
            .to_string_lossy()
            .into_owned();

        assert!(require_within_workspace(&ws, &sibling).is_err());
    }

    #[test]
    fn require_within_workspace_refuses_a_path_that_escapes_via_parent_dir() {
        let tmp = tempdir().unwrap();
        let ws = tmp.path().to_string_lossy().into_owned();
        let escaped = tmp
            .path()
            .join("..")
            .join("secret.md")
            .to_string_lossy()
            .into_owned();
        let escaped_nested = tmp
            .path()
            .join("Folder")
            .join("..")
            .join("..")
            .join("secret.md")
            .to_string_lossy()
            .into_owned();

        assert!(require_within_workspace(&ws, &escaped).is_err());
        assert!(require_within_workspace(&ws, &escaped_nested).is_err());
    }

    #[test]
    fn require_within_workspace_refuses_a_relative_path() {
        let tmp = tempdir().unwrap();
        let ws = tmp.path().to_string_lossy().into_owned();
        assert!(require_within_workspace(&ws, "Note.md").is_err());
    }

    #[test]
    fn require_within_workspace_refuses_an_unrelated_absolute_path() {
        let ws = tempdir().unwrap();
        let other = tempdir().unwrap();
        let unrelated = other
            .path()
            .join("secret.md")
            .to_string_lossy()
            .into_owned();

        assert!(require_within_workspace(&ws.path().to_string_lossy(), &unrelated).is_err());
    }

    // P7-3a. Opening a code repo as a workspace already worked; the scan just
    // drowned in node_modules and target before reaching docs/.
    #[test]
    fn test_build_and_dependency_dirs_are_not_scanned() {
        for name in ["node_modules", "target", "dist", "build"] {
            assert!(is_excluded_dir(name), "{name} should be skipped");
        }
    }

    // Sidecars hold a note's own ink, PDF pages, images and diagrams.
    // Listing them in the tree offers a folder to file notes into that
    // nothing should.
    #[test]
    fn test_sidecar_dirs_are_not_scanned() {
        for name in [
            "Lecture 7.ink",
            "Lecture 7.pdf",
            "Lecture 7.assets",
            "Lecture 7.diagrams",
        ] {
            assert!(is_excluded_dir(name), "{name} should be skipped");
        }
    }

    #[test]
    fn test_dotfiles_are_still_skipped_and_ordinary_folders_are_not() {
        assert!(is_excluded_dir(".git"));
        assert!(!is_excluded_dir("Analysis 2"));
        // Only an exact match: a course folder named after a build directory
        // is a stretch, but "Distributed Systems" abbreviated is not.
        assert!(!is_excluded_dir("distributed"));
        assert!(!is_excluded_dir("building-compilers"));
    }

    #[test]
    fn test_title_from_content_heading() {
        assert_eq!(
            title_from_content("# Hello World\nsome text"),
            "Hello World"
        );
    }

    #[test]
    fn test_title_from_content_no_heading() {
        assert_eq!(title_from_content("just text"), "just text");
    }

    #[test]
    fn test_title_from_content_empty() {
        assert_eq!(title_from_content(""), "Untitled");
    }

    #[test]
    fn test_title_from_content_bare_hash_heading_falls_back_to_next_line() {
        assert_eq!(title_from_content("#\nbody text"), "body text");
    }

    #[test]
    fn test_title_from_content_only_bare_hash() {
        assert_eq!(title_from_content("#\n\n"), "Untitled");
    }

    #[test]
    fn test_title_from_content_leading_blank_lines() {
        assert_eq!(title_from_content("\n\n# Deep\n"), "Deep");
    }

    #[test]
    fn test_title_from_content_skips_blockquote_intro_for_later_heading() {
        let content = "> **A Markdown-first note-taking application designed specifically for computer science students. It provides the best environment for writing mathematical and programming notes while integrating naturally with existing development workflows rather than replacing the IDE.**\n\n---\n\n## What the app should do\n\n### Best-in-class Markdown editing\n";
        assert_eq!(title_from_content(content), "What the app should do");
    }

    #[test]
    fn test_title_from_content_truncates_long_non_heading_line() {
        let long_line = "a".repeat(120);
        let expected: String = "a".repeat(60);
        assert_eq!(title_from_content(&long_line), format!("{expected}…"));
    }

    #[test]
    fn test_extract_tags_finds_inline_hashtags() {
        let tags = extract_tags("Notes on #recursion and #dynamic-programming today.");
        assert_eq!(tags, vec!["recursion", "dynamic-programming"]);
    }

    #[test]
    fn test_extract_tags_ignores_atx_headings() {
        let tags = extract_tags("# Heading One\n## Heading Two\nSome #realtag here.");
        assert_eq!(tags, vec!["realtag"]);
    }

    #[test]
    fn test_extract_tags_ignores_fenced_code() {
        let content = "See #important below.\n```c\n#include <stdio.h>\n#define MAX 10\n```\nDone.";
        let tags = extract_tags(content);
        assert_eq!(tags, vec!["important"]);
    }

    #[test]
    fn test_extract_tags_ignores_inline_code() {
        let tags = extract_tags("Use `#define` for macros, but #cpreprocessor is a real tag.");
        assert_eq!(tags, vec!["cpreprocessor"]);
    }

    #[test]
    fn test_extract_tags_deduplicates_case_insensitively() {
        let tags = extract_tags("#CS101 material. Revisit #cs101 before the exam. #cs101");
        assert_eq!(tags, vec!["CS101"]);
    }

    #[test]
    fn test_extract_tags_ignores_hash_mid_word() {
        let tags = extract_tags("issue#42 is not a tag, but #issue42 is.");
        assert_eq!(tags, vec!["issue42"]);
    }

    #[test]
    fn test_extract_tags_empty_content() {
        assert!(extract_tags("").is_empty());
    }

    #[test]
    fn test_extract_links_finds_wiki_links() {
        let links = extract_links("See [[Big O Notation]] and [[Sorting Algorithms]].");
        assert_eq!(links, vec!["Big O Notation", "Sorting Algorithms"]);
    }

    #[test]
    fn test_extract_links_deduplicates_case_insensitively() {
        let links = extract_links("[[Big O Notation]] again: [[big o notation]]");
        assert_eq!(links, vec!["Big O Notation"]);
    }

    #[test]
    fn test_extract_links_empty_content() {
        assert!(extract_links("").is_empty());
    }

    #[test]
    fn test_extract_code_link_targets_finds_a_path_with_a_line() {
        let targets = extract_code_link_targets("See src/main.cpp:58 for the fix.");
        assert_eq!(targets, vec!["src/main.cpp"]);
    }

    #[test]
    fn test_extract_code_link_targets_deduplicates_exact_matches() {
        let targets = extract_code_link_targets("src/main.rs:1 again: src/main.rs:99");
        assert_eq!(targets, vec!["src/main.rs"]);
    }

    #[test]
    fn test_extract_code_link_targets_ignores_bare_prose() {
        assert!(extract_code_link_targets("Analysis 2: a 10:30 timestamp, README.").is_empty());
    }

    #[test]
    fn test_extract_code_link_targets_empty_content() {
        assert!(extract_code_link_targets("").is_empty());
    }

    #[test]
    fn test_extract_code_links_parses_lines_and_ranges() {
        let links = extract_code_links(
            "See src/main.cpp:58 and path/to/file.rs#L20-L30 and bare/path.ts here.",
        );
        assert_eq!(
            links,
            vec![
                ("src/main.cpp".to_string(), Some(58)),
                ("path/to/file.rs".to_string(), Some(20)),
                ("bare/path.ts".to_string(), None),
            ]
        );
    }

    #[tokio::test]
    async fn test_get_line_fingerprint_reads_and_trims_target_line() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("main.rs");
        tokio::fs::write(&file, "line 1\n  fn main() {}  \nline 3\n")
            .await
            .unwrap();

        assert_eq!(get_line_fingerprint(&file, 0).await, None);
        assert_eq!(
            get_line_fingerprint(&file, 1).await,
            Some("line 1".to_string())
        );
        assert_eq!(
            get_line_fingerprint(&file, 2).await,
            Some("fn main() {}".to_string())
        );
        assert_eq!(
            get_line_fingerprint(&file, 3).await,
            Some("line 3".to_string())
        );
        assert_eq!(get_line_fingerprint(&file, 4).await, None);
    }

    #[tokio::test]
    async fn test_extract_code_links_with_fingerprints_captures_existing_target_lines() {
        let tmp = tempfile::tempdir().unwrap();
        let ws = tmp.path().to_string_lossy().to_string();
        let src_dir = tmp.path().join("src");
        tokio::fs::create_dir_all(&src_dir).await.unwrap();
        tokio::fs::write(src_dir.join("main.rs"), "line 1\n  fn bfs() {}  \n")
            .await
            .unwrap();

        let entries = extract_code_links_with_fingerprints(
            "Look at src/main.rs:2 and src/missing.rs:10 and src/main.rs (no line)",
            &ws,
        )
        .await;

        assert_eq!(entries.len(), 3);
        assert_eq!(
            entries[0],
            CodeLinkEntry {
                target: "src/main.rs".to_string(),
                line: Some(2),
                fingerprint: Some("fn bfs() {}".to_string()),
            }
        );
        assert_eq!(
            entries[1],
            CodeLinkEntry {
                target: "src/missing.rs".to_string(),
                line: Some(10),
                fingerprint: None,
            }
        );
        assert_eq!(
            entries[2],
            CodeLinkEntry {
                target: "src/main.rs".to_string(),
                line: None,
                fingerprint: None,
            }
        );
    }

    #[test]
    fn test_extract_tasks_finds_open_and_done_items_with_line_positions() {
        let tasks = extract_tasks("# Notes\n\n- [ ] finish exercise 3\n- [x] read chapter 2\n");
        assert_eq!(tasks.len(), 2);
        assert_eq!(tasks[0].text, "finish exercise 3");
        assert!(!tasks[0].done);
        assert_eq!(tasks[0].position, 2);
        assert_eq!(tasks[1].text, "read chapter 2");
        assert!(tasks[1].done);
        assert_eq!(tasks[1].position, 3);
    }

    #[test]
    fn test_extract_tasks_ignores_fenced_code_without_shifting_positions() {
        let content = "- [ ] real task\n```\n- [ ] example in docs\n```\n- [ ] another real task";
        let tasks = extract_tasks(content);
        assert_eq!(tasks.len(), 2);
        assert_eq!(tasks[0].text, "real task");
        assert_eq!(tasks[0].position, 0);
        assert_eq!(tasks[1].text, "another real task");
        assert_eq!(tasks[1].position, 4);
    }

    #[test]
    fn test_extract_tasks_ignores_plain_bullets() {
        assert!(extract_tasks("- just a bullet\n- [not a checkbox] either").is_empty());
    }

    #[test]
    fn test_extract_tasks_empty_content() {
        assert!(extract_tasks("").is_empty());
    }

    #[test]
    fn test_extract_cards_finds_a_qa_card() {
        let cards = extract_cards("# Notes\n\nWhat is Big-O of binary search? :: O(log n)\n");
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].kind, CardKind::Qa);
        assert_eq!(cards[0].front, "What is Big-O of binary search?");
        assert_eq!(cards[0].back, "O(log n)");
        assert_eq!(cards[0].position, 2);
        assert_eq!(cards[0].due, None);
    }

    #[test]
    fn test_extract_cards_finds_a_cloze_card() {
        let cards = extract_cards(
            "A binary search tree keeps {{all left descendants smaller}} than the node.\n",
        );
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].kind, CardKind::Cloze);
        assert_eq!(
            cards[0].front,
            "A binary search tree keeps [...] than the node."
        );
        assert_eq!(
            cards[0].back,
            "A binary search tree keeps all left descendants smaller than the node."
        );
    }

    #[test]
    fn test_extract_cards_reads_an_adjacent_schedule_comment() {
        let content = "Q :: A\n<!-- sr due=2026-08-21 ease=2.30 interval=6 reps=2 -->\n";
        let cards = extract_cards(content);
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].due, Some("2026-08-21".to_string()));
        assert_eq!(cards[0].ease, Some(2.30));
        assert_eq!(cards[0].interval, Some(6));
        assert_eq!(cards[0].reps, Some(2));
    }

    #[test]
    fn test_extract_cards_new_card_has_no_schedule() {
        let cards = extract_cards("Q :: A\nSome unrelated next line.\n");
        assert_eq!(cards[0].due, None);
        assert_eq!(cards[0].ease, None);
    }

    #[test]
    fn test_extract_cards_ignores_fenced_code() {
        let content = "```\nWhat :: is this\n```\n";
        assert!(extract_cards(content).is_empty());
    }

    #[test]
    fn test_extract_cards_ignores_the_schedule_comment_line_itself() {
        // A schedule comment can never be mistaken for a new card even
        // though it starts a fresh line right after one.
        let content = "Q :: A\n<!-- sr due=2026-08-21 ease=2.50 interval=1 reps=1 -->\n";
        let cards = extract_cards(content);
        assert_eq!(cards.len(), 1);
    }

    #[test]
    fn test_extract_cards_handles_multiple_cards_in_one_note() {
        let content = "Q1 :: A1\nQ2 :: A2\n";
        let cards = extract_cards(content);
        assert_eq!(cards.len(), 2);
        assert_eq!(cards[0].position, 0);
        assert_eq!(cards[1].position, 1);
    }

    #[test]
    fn test_extract_cards_empty_content() {
        assert!(extract_cards("").is_empty());
    }

    #[test]
    fn test_extract_cards_parses_a_single_select_mc_block() {
        let content = "What is 2+2? ::\n- [ ] 3\n- [x] 4\n- [ ] 5\n";
        let cards = extract_cards(content);
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].kind, CardKind::Mc);
        assert_eq!(cards[0].front, "What is 2+2?");
        assert_eq!(cards[0].options, vec!["3", "4", "5"]);
        assert_eq!(cards[0].correct, vec![1]);
        assert_eq!(cards[0].position, 0);
    }

    #[test]
    fn test_extract_cards_parses_a_multi_select_mc_block() {
        let content = "Which are primes? ::\n- [x] 2\n- [ ] 4\n- [x] 3\n";
        let cards = extract_cards(content);
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].correct, vec![0, 2]);
    }

    #[test]
    fn test_extract_cards_skips_an_mc_block_with_no_correct_option() {
        let content = "Bad question ::\n- [ ] a\n- [ ] b\n";
        assert!(extract_cards(content).is_empty());
    }

    #[test]
    fn test_extract_cards_mc_block_reads_its_sr_comment() {
        let content =
            "Q ::\n- [x] a\n<!-- sr due=2026-08-21 ease=2.50 interval=1 reps=1 grade=good -->\n";
        let cards = extract_cards(content);
        assert_eq!(cards[0].due.as_deref(), Some("2026-08-21"));
        assert_eq!(cards[0].grade, Some(sm2::Grade::Good));
    }

    #[test]
    fn test_extract_cards_qa_and_cloze_still_work_alongside_mc() {
        let content = "Q :: A\nText with {{gap}}.\nMC ::\n- [x] only\n";
        let cards = extract_cards(content);
        assert_eq!(cards.len(), 3);
        assert_eq!(cards[0].kind, CardKind::Qa);
        assert_eq!(cards[1].kind, CardKind::Cloze);
        assert_eq!(cards[2].kind, CardKind::Mc);
    }

    #[test]
    fn test_extract_tasks_excludes_mc_option_lines() {
        let content = "Q ::\n- [ ] a\n- [x] b\n\n- [ ] a real task\n";
        let tasks = extract_tasks(content);
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].text, "a real task");
    }

    #[test]
    fn test_extract_tasks_still_finds_tasks_when_no_mc_block_present() {
        let content = "- [ ] plain task\n- [x] done task\n";
        assert_eq!(extract_tasks(content).len(), 2);
    }

    // prosemirror-markdown always puts a blank line between a paragraph and
    // the differently-typed block that follows it, so a card typed through
    // the real editor saves as "Question ::\n\n- [ ] wrong\n- [x] right" —
    // one blank line after the question, options themselves tight (see
    // TaskListTight, editor/extensions/index.ts). extract_cards has to read
    // that shape, not just the hand-written tight fixtures above.
    #[test]
    fn test_extract_cards_parses_an_mc_block_with_a_blank_line_after_the_question() {
        let content = "Question ::\n\n- [ ] wrong\n- [x] right\n";
        let cards = extract_cards(content);
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].kind, CardKind::Mc);
        assert_eq!(cards[0].front, "Question");
        assert_eq!(cards[0].options, vec!["wrong", "right"]);
        assert_eq!(cards[0].correct, vec![1]);
    }

    #[test]
    fn test_extract_cards_mc_block_with_a_blank_line_still_reads_its_sr_comment() {
        let content = "Question ::\n\n- [ ] wrong\n- [x] right\n<!-- sr due=2026-08-21 ease=2.50 interval=1 reps=1 grade=good -->\n";
        let cards = extract_cards(content);
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].due.as_deref(), Some("2026-08-21"));
    }

    #[test]
    fn test_extract_cards_reads_a_qa_schedule_comment_separated_by_a_blank_line() {
        let content =
            "Q :: A\n\n<!-- sr due=2026-08-21 ease=2.50 interval=1 reps=1 grade=good -->\n";
        let cards = extract_cards(content);
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].due.as_deref(), Some("2026-08-21"));
    }

    #[test]
    fn test_extract_cards_mc_block_reads_its_sr_comment_separated_by_a_blank_line() {
        let content = "Q ::\n- [ ] a\n- [x] b\n\n<!-- sr due=2026-08-21 ease=2.50 interval=1 reps=1 grade=good -->\n";
        let cards = extract_cards(content);
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].due.as_deref(), Some("2026-08-21"));
    }

    #[test]
    fn test_extract_cards_a_blank_line_with_no_options_after_is_not_an_mc_block() {
        let content = "Question ::\n\nJust a paragraph, not an option list.\n";
        assert!(extract_cards(content).is_empty());
    }

    #[test]
    fn test_extract_formulas_reads_a_one_liner() {
        let formulas = extract_formulas("intro\n\n$$e^{i\\pi} + 1 = 0$$\n\nmore text");
        assert_eq!(formulas.len(), 1);
        assert_eq!(formulas[0].latex, "e^{i\\pi} + 1 = 0");
        assert_eq!(formulas[0].heading, None);
    }

    #[test]
    fn test_extract_formulas_reads_a_multiline_dollar_fence() {
        let formulas = extract_formulas("$\nE = mc^2\n$\n");
        assert_eq!(formulas.len(), 1);
        assert_eq!(formulas[0].latex, "E = mc^2");
    }

    #[test]
    fn test_extract_formulas_reads_a_multiline_double_dollar_fence() {
        let formulas = extract_formulas("$$\n\\det(A - \\lambda I) = 0\n$$\n");
        assert_eq!(formulas.len(), 1);
        assert_eq!(formulas[0].latex, "\\det(A - \\lambda I) = 0");
    }

    #[test]
    fn test_extract_formulas_captures_the_nearest_heading_above() {
        let content =
            "# Lecture 3\n## Eigenvalues\n$$Av = \\lambda v$$\n## Determinants\n$$\\det(A)$$";
        let formulas = extract_formulas(content);
        assert_eq!(formulas.len(), 2);
        assert_eq!(formulas[0].heading.as_deref(), Some("Eigenvalues"));
        assert_eq!(formulas[1].heading.as_deref(), Some("Determinants"));
    }

    #[test]
    fn test_extract_formulas_before_any_heading_has_no_heading() {
        let formulas = extract_formulas("$$E = mc^2$$\n# Later Heading\n");
        assert_eq!(formulas.len(), 1);
        assert_eq!(formulas[0].heading, None);
    }

    #[test]
    fn test_extract_formulas_does_not_treat_the_note_title_as_a_heading() {
        let formulas = extract_formulas("# Networks\n$$E = mc^2$$\n");
        assert_eq!(formulas.len(), 1);
        assert_eq!(formulas[0].heading, None);
    }

    #[test]
    fn test_extract_formulas_skips_fenced_code_blocks() {
        let content = "$$real formula$$\n```\n$$not a formula$$\n```\n$$another real one$$";
        let formulas = extract_formulas(content);
        assert_eq!(formulas.len(), 2);
        assert_eq!(formulas[0].latex, "real formula");
        assert_eq!(formulas[1].latex, "another real one");
    }

    #[test]
    fn test_extract_formulas_preserves_source_order() {
        let content = "$$first$$\n$$second$$\n$$third$$";
        let formulas = extract_formulas(content);
        let latexes: Vec<&str> = formulas.iter().map(|f| f.latex.as_str()).collect();
        assert_eq!(latexes, vec!["first", "second", "third"]);
    }

    #[test]
    fn test_extract_formulas_empty_content() {
        assert!(extract_formulas("").is_empty());
    }

    #[test]
    fn test_extract_callouts_reads_a_numbered_theorem() {
        let content =
            "> [!THEOREM 3.2] Fixed point\n> Every contraction has one.\n> Second line.\n";
        let callouts = extract_callouts(content);
        assert_eq!(callouts.len(), 1);
        assert_eq!(callouts[0].kind, "THEOREM");
        assert_eq!(callouts[0].number.as_deref(), Some("3.2"));
        assert_eq!(callouts[0].title.as_deref(), Some("Fixed point"));
        assert_eq!(callouts[0].body, "Every contraction has one.\nSecond line.");
    }

    #[test]
    fn test_extract_callouts_ignores_non_numbered_kinds() {
        let content = "> [!NOTE] Just a note\n> body\n";
        assert!(extract_callouts(content).is_empty());
    }

    #[test]
    fn test_extract_callouts_captures_the_nearest_heading_above() {
        let content = "## Induction\n\n> [!DEFINITION] Base case\n> The starting point.\n";
        let callouts = extract_callouts(content);
        assert_eq!(callouts[0].heading.as_deref(), Some("Induction"));
    }

    #[test]
    fn test_extract_callouts_skips_fenced_code_blocks() {
        let content = "```\n> [!THEOREM] not real\n```\n";
        assert!(extract_callouts(content).is_empty());
    }

    #[test]
    fn test_extract_callouts_empty_content() {
        assert!(extract_callouts("").is_empty());
    }

    #[test]
    fn test_toggle_task_line_checks_an_open_task() {
        let result = toggle_task_line("- [ ] buy milk\n- [ ] other", 0).unwrap();
        assert_eq!(result, "- [x] buy milk\n- [ ] other");
    }

    #[test]
    fn test_toggle_task_line_unchecks_a_done_task() {
        let result = toggle_task_line("- [x] buy milk", 0).unwrap();
        assert_eq!(result, "- [ ] buy milk");
    }

    #[test]
    fn test_toggle_task_line_preserves_trailing_newline() {
        let result = toggle_task_line("- [ ] buy milk\n", 0).unwrap();
        assert_eq!(result, "- [x] buy milk\n");
    }

    #[test]
    fn test_toggle_task_line_none_when_position_is_out_of_range() {
        assert!(toggle_task_line("- [ ] buy milk", 5).is_none());
    }

    #[test]
    fn test_toggle_task_line_none_when_line_is_no_longer_a_task() {
        assert!(toggle_task_line("just prose now", 0).is_none());
    }

    fn grade_today() -> chrono::NaiveDate {
        chrono::NaiveDate::from_ymd_opt(2026, 8, 20).unwrap()
    }

    #[test]
    fn test_grade_card_line_inserts_a_new_schedule_comment() {
        let result = grade_card_line("Q :: A\n", 0, sm2::Grade::Good, grade_today()).unwrap();
        assert_eq!(
            result,
            "Q :: A\n<!-- sr due=2026-08-21 ease=2.50 interval=1 reps=1 grade=good streak=1 lapses=0 -->\n"
        );
    }

    #[test]
    fn test_grade_card_line_replaces_an_existing_schedule_comment() {
        let content = "Q :: A\n<!-- sr due=2026-08-20 ease=2.50 interval=6 reps=2 -->\n";
        let result = grade_card_line(content, 0, sm2::Grade::Good, grade_today()).unwrap();
        assert_eq!(
            result,
            "Q :: A\n<!-- sr due=2026-09-04 ease=2.50 interval=15 reps=3 grade=good streak=1 lapses=0 -->\n"
        );
    }

    #[test]
    fn test_grade_card_line_again_resets_progress() {
        let content = "Q :: A\n<!-- sr due=2026-08-20 ease=2.50 interval=6 reps=2 -->\n";
        let result = grade_card_line(content, 0, sm2::Grade::Again, grade_today()).unwrap();
        assert!(result.contains("interval=1 reps=0"));
    }

    #[test]
    fn test_grade_card_line_streak_increments_on_consecutive_good_grades() {
        let content =
            "Q :: A\n<!-- sr due=2026-08-20 ease=2.50 interval=6 reps=2 grade=good streak=2 -->\n";
        let result = grade_card_line(content, 0, sm2::Grade::Good, grade_today()).unwrap();
        assert!(result.contains("streak=3"));
    }

    #[test]
    fn test_grade_card_line_streak_resets_to_zero_on_again() {
        let content =
            "Q :: A\n<!-- sr due=2026-08-20 ease=2.50 interval=6 reps=2 grade=good streak=3 -->\n";
        let result = grade_card_line(content, 0, sm2::Grade::Again, grade_today()).unwrap();
        assert!(result.contains("streak=0"));
    }

    #[test]
    fn test_grade_card_line_streak_unchanged_on_hard() {
        let content =
            "Q :: A\n<!-- sr due=2026-08-20 ease=2.50 interval=6 reps=2 grade=good streak=2 -->\n";
        let result = grade_card_line(content, 0, sm2::Grade::Hard, grade_today()).unwrap();
        assert!(result.contains("streak=2"));
    }

    #[test]
    fn test_grade_card_line_old_format_comment_with_no_streak_field_defaults_to_zero() {
        // Graded before this field existed — no `streak=` at all, not even
        // `streak=0`. Must default the same way a never-graded card does.
        let content = "Q :: A\n<!-- sr due=2026-08-20 ease=2.50 interval=1 reps=1 grade=good -->\n";
        let result = grade_card_line(content, 0, sm2::Grade::Good, grade_today()).unwrap();
        assert!(result.contains("streak=1"));
    }

    #[test]
    fn test_grade_card_line_again_on_a_reviewed_card_increments_lapses() {
        let content =
            "Q :: A\n<!-- sr due=2026-08-20 ease=2.50 interval=6 reps=2 grade=good streak=3 lapses=1 -->\n";
        let result = grade_card_line(content, 0, sm2::Grade::Again, grade_today()).unwrap();
        assert!(result.contains("lapses=2"));
    }

    #[test]
    fn test_grade_card_line_again_on_a_never_reviewed_card_leaves_lapses_at_zero() {
        let result = grade_card_line("Q :: A\n", 0, sm2::Grade::Again, grade_today()).unwrap();
        assert!(result.contains("lapses=0"));
    }

    #[test]
    fn test_grade_card_line_good_leaves_lapses_unchanged() {
        let content =
            "Q :: A\n<!-- sr due=2026-08-20 ease=2.50 interval=6 reps=2 grade=good streak=2 lapses=1 -->\n";
        let result = grade_card_line(content, 0, sm2::Grade::Good, grade_today()).unwrap();
        assert!(result.contains("lapses=1"));
    }

    #[test]
    fn test_grade_card_line_none_when_position_is_no_longer_a_card() {
        assert!(grade_card_line("just prose now\n", 0, sm2::Grade::Good, grade_today()).is_none());
    }

    #[test]
    fn test_grade_card_line_preserves_a_second_card_below() {
        let content = "Q1 :: A1\nQ2 :: A2\n";
        let result = grade_card_line(content, 0, sm2::Grade::Good, grade_today()).unwrap();
        assert!(result.contains("Q2 :: A2"));
        assert!(result.contains("Q1 :: A1\n<!-- sr"));
    }

    #[test]
    fn test_grade_card_line_places_the_comment_after_an_mc_blocks_options() {
        let content = "Q ::\n- [ ] a\n- [x] b\n";
        let out = grade_card_line(
            content,
            0,
            sm2::Grade::Good,
            chrono::NaiveDate::from_ymd_opt(2026, 8, 20).unwrap(),
        )
        .unwrap();
        let lines: Vec<&str> = out.lines().collect();
        assert_eq!(lines.len(), 4);
        assert!(lines[3].starts_with("<!-- sr "));
        assert!(lines[3].contains("grade=good"));
    }

    #[test]
    fn test_grade_card_line_updates_an_existing_mc_comment_in_place() {
        let content = "Q ::\n- [ ] a\n- [x] b\n<!-- sr due=2026-08-20 ease=2.50 interval=1 reps=1 grade=good -->\n";
        let out = grade_card_line(
            content,
            0,
            sm2::Grade::Easy,
            chrono::NaiveDate::from_ymd_opt(2026, 8, 21).unwrap(),
        )
        .unwrap();
        assert_eq!(out.lines().count(), 4);
        assert!(out.contains("grade=easy"));
    }

    #[test]
    fn test_grade_card_line_writes_grade_field_for_plain_qa_too() {
        let content = "Q :: A\n";
        let out = grade_card_line(
            content,
            0,
            sm2::Grade::Hard,
            chrono::NaiveDate::from_ymd_opt(2026, 8, 20).unwrap(),
        )
        .unwrap();
        assert!(out.contains("grade=hard"));
    }

    #[test]
    fn test_grade_card_line_updates_an_mc_comment_separated_by_a_blank_line_in_place() {
        // prosemirror-markdown inserts a blank line between the option list
        // and the differently-typed srState comment block on every editor
        // round-trip (I3) — a re-grade must find and replace that comment,
        // not treat the blank line as "no comment" and insert a duplicate.
        let content = "Q ::\n- [ ] a\n- [x] b\n\n<!-- sr due=2026-08-20 ease=2.50 interval=1 reps=1 grade=good -->\n";
        let out = grade_card_line(
            content,
            0,
            sm2::Grade::Easy,
            chrono::NaiveDate::from_ymd_opt(2026, 8, 21).unwrap(),
        )
        .unwrap();
        assert_eq!(out.matches("<!-- sr ").count(), 1);
        assert!(out.contains("grade=easy"));
    }

    #[test]
    fn test_grade_card_line_updates_a_qa_comment_separated_by_a_blank_line_in_place() {
        let content =
            "Q :: A\n\n<!-- sr due=2026-08-20 ease=2.50 interval=1 reps=1 grade=good -->\n";
        let out = grade_card_line(
            content,
            0,
            sm2::Grade::Easy,
            chrono::NaiveDate::from_ymd_opt(2026, 8, 21).unwrap(),
        )
        .unwrap();
        assert_eq!(out.matches("<!-- sr ").count(), 1);
        assert!(out.contains("grade=easy"));
    }

    #[test]
    fn test_grade_card_line_rejects_an_mc_question_with_no_option_lines() {
        let content = "Q ::\nsome unrelated paragraph\n";
        assert!(grade_card_line(
            content,
            0,
            sm2::Grade::Good,
            chrono::NaiveDate::from_ymd_opt(2026, 8, 20).unwrap()
        )
        .is_none());
    }

    #[tokio::test]
    async fn test_scan_dir_recursive_finds_nested_notes() {
        let tmp = tempdir().unwrap();
        let root = tmp.path();
        std::fs::create_dir_all(root.join("Course101")).unwrap();
        std::fs::write(root.join("Course101/lecture1.md"), "# Lecture 1").unwrap();
        std::fs::write(root.join("root-note.md"), "# Root").unwrap();

        let ws = root.to_string_lossy().into_owned();
        let (notes, folders) = scan_dir_recursive(root, &ws).await.unwrap();

        assert_eq!(notes.len(), 2);
        assert_eq!(folders.len(), 1);
        assert!(folders[0].ends_with("Course101"));
    }

    #[tokio::test]
    async fn test_scan_dir_recursive_uses_content_title_not_filename() {
        let tmp = tempdir().unwrap();
        let root = tmp.path();
        std::fs::write(root.join("lecture-1-notes.md"), "# Lecture 1 Notes\nbody").unwrap();

        let ws = root.to_string_lossy().into_owned();
        let (notes, _) = scan_dir_recursive(root, &ws).await.unwrap();

        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].title, "Lecture 1 Notes");
    }

    #[tokio::test]
    async fn test_scan_dir_recursive_excludes_ink_and_dot_dirs() {
        let tmp = tempdir().unwrap();
        let root = tmp.path();
        std::fs::create_dir_all(root.join("Note.ink")).unwrap();
        std::fs::write(root.join("Note.ink/sketch-1.svg"), "<svg></svg>").unwrap();
        std::fs::create_dir_all(root.join(".git")).unwrap();
        std::fs::write(root.join("Note.md"), "# Note").unwrap();

        let ws = root.to_string_lossy().into_owned();
        let (notes, folders) = scan_dir_recursive(root, &ws).await.unwrap();

        assert_eq!(notes.len(), 1);
        assert!(folders.is_empty());
    }

    #[tokio::test]
    async fn test_scan_dir_recursive_lists_empty_folders_created_by_the_app() {
        let tmp = tempdir().unwrap();
        let root = tmp.path();
        let ws = root.to_string_lossy().into_owned();
        create_folder_at(&ws, "Empty").await.unwrap();

        let (notes, folders) = scan_dir_recursive(root, &ws).await.unwrap();

        assert!(notes.is_empty());
        assert_eq!(folders.len(), 1);
    }

    #[tokio::test]
    async fn test_scan_dir_recursive_hides_external_folders_without_notes() {
        let tmp = tempdir().unwrap();
        let root = tmp.path();
        std::fs::create_dir_all(root.join("Foreign/deep")).unwrap();
        std::fs::write(root.join("Foreign/deep/data.txt"), "x").unwrap();
        std::fs::create_dir_all(root.join("Mine/sub")).unwrap();
        std::fs::write(root.join("Mine/sub/n.md"), "# n").unwrap();

        let ws = root.to_string_lossy().into_owned();
        let (_, folders) = scan_dir_recursive(root, &ws).await.unwrap();

        assert_eq!(folders.len(), 1);
        assert!(folders[0].ends_with("sub"));
        assert!(root.join("Foreign/deep/data.txt").exists());
    }
}

#[cfg(test)]
mod save_tests {
    use super::*;
    use crate::db::schema::run_migrations;
    use tempfile::tempdir;

    fn temp_files_in(dir: &Path) -> Vec<String> {
        std::fs::read_dir(dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|name| name.ends_with(".tmp"))
            .collect()
    }

    #[tokio::test]
    async fn test_write_atomic_replaces_existing_content() {
        let tmp = tempdir().unwrap();
        let target = tmp.path().join("note.md");
        std::fs::write(&target, "# Old\nold body").unwrap();

        write_atomic(&target, "# New\nnew body").await.unwrap();

        assert_eq!(std::fs::read_to_string(&target).unwrap(), "# New\nnew body");
        assert!(temp_files_in(tmp.path()).is_empty());
    }

    #[tokio::test]
    async fn test_write_atomic_creates_missing_file() {
        let tmp = tempdir().unwrap();
        let target = tmp.path().join("fresh.md");

        write_atomic(&target, "# Fresh").await.unwrap();

        assert_eq!(std::fs::read_to_string(&target).unwrap(), "# Fresh");
        assert!(temp_files_in(tmp.path()).is_empty());
    }

    // The whole point of the temp-then-rename dance: a failed write must never
    // leave the target truncated, and must not litter the folder with temps.
    #[tokio::test]
    async fn test_write_atomic_failure_leaves_target_and_folder_clean() {
        let tmp = tempdir().unwrap();
        let target = tmp.path().join("blocked.md");
        std::fs::create_dir(&target).unwrap();

        let result = write_atomic(&target, "# Should not land").await;

        assert!(result.is_err());
        assert!(target.is_dir());
        assert!(temp_files_in(tmp.path()).is_empty());
    }

    #[tokio::test]
    async fn test_create_note_file_seeds_a_heading() {
        let tmp = tempdir().unwrap();

        let path = create_note_file(&tmp.path().to_string_lossy(), "Missing")
            .await
            .unwrap();

        assert_eq!(path, tmp.path().join("Missing.md"));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "# Missing\n");
    }

    #[tokio::test]
    async fn test_create_note_file_replaces_path_characters_in_the_filename() {
        let tmp = tempdir().unwrap();

        let path = create_note_file(&tmp.path().to_string_lossy(), "CS/101: Week 1")
            .await
            .unwrap();

        assert_eq!(path, tmp.path().join("CS-101- Week 1.md"));
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "# CS/101: Week 1\n"
        );
    }

    // Clicking an unresolved [[link]] creates a note from a title alone, so a
    // collision must fail loudly rather than overwrite whatever holds the name.
    #[tokio::test]
    async fn test_create_note_file_refuses_to_overwrite_an_existing_note() {
        let tmp = tempdir().unwrap();
        let existing = tmp.path().join("Missing.md");
        std::fs::write(&existing, "# Something else\nreal content").unwrap();

        let result = create_note_file(&tmp.path().to_string_lossy(), "Missing").await;

        assert!(result.is_err());
        assert_eq!(
            std::fs::read_to_string(&existing).unwrap(),
            "# Something else\nreal content"
        );
    }

    #[tokio::test]
    async fn test_index_note_at_makes_content_searchable() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        run_migrations(&pool).await.unwrap();

        index_note_at(
            "/ws/dijkstra.md",
            "/ws",
            "# Dijkstra\nShortest paths with #graphs and [[Big O Notation]].",
            &pool,
        )
        .await
        .unwrap();

        let hits =
            db::notes::search_notes(&pool, Some("/ws"), Some("\"shortest\"*"), None, None, None)
                .await
                .unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].title, "Dijkstra");

        let tagged = db::notes::notes_with_tag(&pool, "/ws", "graphs")
            .await
            .unwrap();
        assert_eq!(tagged.len(), 1);

        let backlinks = db::notes::backlinks_for(&pool, "/ws", "Big O Notation")
            .await
            .unwrap();
        assert_eq!(backlinks.len(), 1);
    }

    #[test]
    fn test_extract_backlink_snippet_finds_the_linking_line() {
        let content = "# Dijkstra\nShortest paths with [[Big O Notation]] bounds.\nMore text.";
        assert_eq!(
            extract_backlink_snippet(content, "Big O Notation"),
            Some("Shortest paths with [[Big O Notation]] bounds.".to_string())
        );
    }

    #[test]
    fn test_extract_backlink_snippet_matches_case_insensitively() {
        let content = "See [[big o notation]] here.";
        assert_eq!(
            extract_backlink_snippet(content, "Big O Notation"),
            Some("See [[big o notation]] here.".to_string())
        );
    }

    #[test]
    fn test_extract_backlink_snippet_is_none_when_the_link_is_absent() {
        let content = "No link here at all.";
        assert_eq!(extract_backlink_snippet(content, "Big O Notation"), None);
    }

    #[test]
    fn test_extract_backlink_snippet_truncates_a_long_line() {
        let padding = "x".repeat(200);
        let content = format!("{padding} [[Big O Notation]] {padding}");
        let snippet = extract_backlink_snippet(&content, "Big O Notation").unwrap();
        assert!(
            snippet.chars().count() <= 161,
            "got {} chars",
            snippet.chars().count()
        );
        assert!(snippet.ends_with('…'));
    }

    #[test]
    fn test_extract_code_backlink_snippet_finds_the_linking_line() {
        let content = "# Dijkstra\nSee src/graph.rs:58 for the relaxation step.\nMore text.";
        assert_eq!(
            extract_code_backlink_snippet(content, "src/graph.rs"),
            Some("See src/graph.rs:58 for the relaxation step.".to_string())
        );
    }

    #[test]
    fn test_extract_code_backlink_snippet_is_none_when_the_target_is_absent() {
        let content = "No code reference here at all.";
        assert_eq!(extract_code_backlink_snippet(content, "src/graph.rs"), None);
    }

    #[test]
    fn test_extract_code_backlink_snippet_requires_an_exact_target_match() {
        // src/graph.rs is a substring of src/graph.rs.bak's match, but the
        // extracted target differs — must not count as a reference.
        let content = "See src/graph.rs.bak for the backup.";
        assert_eq!(extract_code_backlink_snippet(content, "src/graph.rs"), None);
    }

    #[tokio::test]
    async fn test_code_backlinks_with_context_reads_the_snippet_from_disk() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        run_migrations(&pool).await.unwrap();
        let tmp = tempdir().unwrap();
        let ws = tmp.path().to_string_lossy().into_owned();
        let note_path = tmp.path().join("dijkstra.md");
        let content = "# Dijkstra\nSee src/graph.rs:58 for the relaxation step.";
        std::fs::write(&note_path, content).unwrap();

        index_note_at(&note_path.to_string_lossy(), &ws, content, &pool)
            .await
            .unwrap();

        let entries = code_backlinks_with_context(&pool, &ws, "src/graph.rs")
            .await
            .unwrap();

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].note.title, "Dijkstra");
        assert_eq!(
            entries[0].snippet.as_deref(),
            Some("See src/graph.rs:58 for the relaxation step.")
        );
    }

    #[tokio::test]
    async fn test_backlinks_with_context_reads_the_snippet_from_disk() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        run_migrations(&pool).await.unwrap();
        let tmp = tempdir().unwrap();
        let ws = tmp.path().to_string_lossy().into_owned();
        let note_path = tmp.path().join("dijkstra.md");
        let content = "# Dijkstra\nShortest paths with [[Big O Notation]] bounds.";
        std::fs::write(&note_path, content).unwrap();

        index_note_at(&note_path.to_string_lossy(), &ws, content, &pool)
            .await
            .unwrap();

        let entries = backlinks_with_context(&pool, &ws, "Big O Notation")
            .await
            .unwrap();

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].note.title, "Dijkstra");
        assert_eq!(
            entries[0].snippet.as_deref(),
            Some("Shortest paths with [[Big O Notation]] bounds.")
        );
    }

    #[tokio::test]
    async fn test_backlinks_with_context_snippet_is_none_when_the_file_is_gone() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        run_migrations(&pool).await.unwrap();
        let tmp = tempdir().unwrap();
        let ws = tmp.path().to_string_lossy().into_owned();
        let missing_path = tmp.path().join("gone.md");
        std::fs::write(&missing_path, "Links to [[Big O Notation]].").unwrap();

        index_note_at(
            &missing_path.to_string_lossy(),
            &ws,
            "Links to [[Big O Notation]].",
            &pool,
        )
        .await
        .unwrap();
        std::fs::remove_file(&missing_path).unwrap();

        let entries = backlinks_with_context(&pool, &ws, "Big O Notation")
            .await
            .unwrap();

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].snippet, None);
    }

    #[tokio::test]
    async fn test_index_note_at_populates_review_cards() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        run_migrations(&pool).await.unwrap();
        index_note_at("/ws/a.md", "/ws", "Q :: A\n", &pool)
            .await
            .unwrap();

        let due = db::notes::due_cards(&pool, "/ws", "9999-12-31")
            .await
            .unwrap();
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].front, "Q");
    }

    #[tokio::test]
    async fn test_forget_note_clears_its_cards() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        run_migrations(&pool).await.unwrap();
        index_note_at("/ws/a.md", "/ws", "Q :: A\n", &pool)
            .await
            .unwrap();
        forget_note("/ws/a.md", &pool).await.unwrap();

        let due = db::notes::due_cards(&pool, "/ws", "9999-12-31")
            .await
            .unwrap();
        assert!(due.is_empty());
    }

    // A note deleted outside the app (Explorer, a git pull) leaves its
    // review_cards row indexed forever — nothing purges a stale scan row —
    // so grading it hits a missing file. Regression for the "grade button
    // does nothing" report: the read failure must clean up the ghost card
    // rather than leaving it stuck un-gradeable.
    #[tokio::test]
    async fn test_grade_card_at_missing_note_purges_its_stale_card() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        run_migrations(&pool).await.unwrap();
        index_note_at("/ws/gone.md", "/ws", "Q :: A\n", &pool)
            .await
            .unwrap();

        let result = grade_card_at("/ws/gone.md", 0, sm2::Grade::Good, "/ws", &pool).await;

        assert!(result.is_err());
        let due = db::notes::due_cards(&pool, "/ws", "9999-12-31")
            .await
            .unwrap();
        assert!(due.is_empty());
    }

    #[tokio::test]
    async fn test_grade_mc_card_at_correct_pick_reports_the_answer_and_advances_grade() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        run_migrations(&pool).await.unwrap();
        let tmp = tempdir().unwrap();
        let path = tmp.path().join("a.md");
        std::fs::write(&path, "Q ::\n- [ ] a\n- [x] b\n").unwrap();
        let path_str = path.to_string_lossy().into_owned();
        let ws = tmp.path().to_string_lossy().into_owned();
        index_note_at(
            &path_str,
            &ws,
            &std::fs::read_to_string(&path).unwrap(),
            &pool,
        )
        .await
        .unwrap();

        let result = grade_mc_card_at(&path_str, 0, &[1], &ws, &pool)
            .await
            .unwrap();

        assert_eq!(result.correct, vec![1]);
        let rewritten = std::fs::read_to_string(&path).unwrap();
        assert!(rewritten.contains("grade=good")); // no prior grade -> Hard baseline -> correct -> Good
    }

    #[tokio::test]
    async fn test_grade_mc_card_at_grades_a_note_saved_with_the_editors_blank_line() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        run_migrations(&pool).await.unwrap();
        let tmp = tempdir().unwrap();
        let path = tmp.path().join("a.md");
        std::fs::write(&path, "Question ::\n\n- [ ] wrong\n- [x] right\n").unwrap();
        let path_str = path.to_string_lossy().into_owned();
        let ws = tmp.path().to_string_lossy().into_owned();
        index_note_at(
            &path_str,
            &ws,
            &std::fs::read_to_string(&path).unwrap(),
            &pool,
        )
        .await
        .unwrap();

        let result = grade_mc_card_at(&path_str, 0, &[0], &ws, &pool)
            .await
            .unwrap();

        assert_eq!(result.correct, vec![1]);
        let rewritten = std::fs::read_to_string(&path).unwrap();
        // The comment lands right after the last option line — no dangling
        // blank line carried over from the editor's paragraph/list boundary.
        assert!(rewritten.contains("- [x] right\n<!-- sr due="));
        assert!(rewritten.contains("grade=again")); // picked wrong -> Hard baseline -> Again
    }

    #[tokio::test]
    async fn test_grade_mc_card_at_partial_multi_select_pick_is_still_wrong() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        run_migrations(&pool).await.unwrap();
        let tmp = tempdir().unwrap();
        let path = tmp.path().join("a.md");
        std::fs::write(&path, "Q ::\n- [x] a\n- [x] b\n- [ ] c\n").unwrap();
        let path_str = path.to_string_lossy().into_owned();
        let ws = tmp.path().to_string_lossy().into_owned();
        index_note_at(
            &path_str,
            &ws,
            &std::fs::read_to_string(&path).unwrap(),
            &pool,
        )
        .await
        .unwrap();

        let result = grade_mc_card_at(&path_str, 0, &[0], &ws, &pool)
            .await
            .unwrap();

        assert_eq!(result.correct, vec![0, 1]);
        let rewritten = std::fs::read_to_string(&path).unwrap();
        assert!(rewritten.contains("grade=again")); // no prior grade -> Hard baseline -> incorrect -> Again
    }

    #[tokio::test]
    async fn test_grade_mc_card_at_reordered_picks_still_match() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        run_migrations(&pool).await.unwrap();
        let tmp = tempdir().unwrap();
        let path = tmp.path().join("a.md");
        std::fs::write(&path, "Q ::\n- [x] a\n- [x] b\n- [ ] c\n").unwrap();
        let path_str = path.to_string_lossy().into_owned();
        let ws = tmp.path().to_string_lossy().into_owned();
        index_note_at(
            &path_str,
            &ws,
            &std::fs::read_to_string(&path).unwrap(),
            &pool,
        )
        .await
        .unwrap();

        let result = grade_mc_card_at(&path_str, 0, &[1, 0], &ws, &pool)
            .await
            .unwrap();

        assert!(std::fs::read_to_string(&path)
            .unwrap()
            .contains("grade=good"));
        assert_eq!(result.correct, vec![0, 1]);
    }

    #[tokio::test]
    async fn test_grade_mc_card_at_missing_note_purges_its_stale_card() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        run_migrations(&pool).await.unwrap();
        index_note_at("/ws/gone.md", "/ws", "Q ::\n- [x] a\n", &pool)
            .await
            .unwrap();

        let result = grade_mc_card_at("/ws/gone.md", 0, &[0], "/ws", &pool).await;

        assert!(result.is_err());
        let due = db::notes::due_cards(&pool, "/ws", "9999-12-31")
            .await
            .unwrap();
        assert!(due.is_empty());
    }

    #[test]
    fn test_rewrite_title_replaces_the_first_heading_and_keeps_its_depth() {
        let content = "intro line\n## Old Title\nbody text\n## Old Title again\n";
        assert_eq!(
            rewrite_title(content, "New Title"),
            "intro line\n## New Title\nbody text\n## Old Title again\n"
        );
    }

    #[test]
    fn test_rewrite_title_prepends_a_heading_when_none_exists() {
        assert_eq!(
            rewrite_title("just a line of text", "New Title"),
            "# New Title\n\njust a line of text"
        );
    }

    #[test]
    fn test_rewrite_links_matches_case_insensitively_and_tolerates_inner_whitespace() {
        let content = "See [[big o notation]] and [[ Big O Notation ]] again.";
        assert_eq!(
            rewrite_links(content, "Big O Notation", "Asymptotic Notation").unwrap(),
            "See [[Asymptotic Notation]] and [[Asymptotic Notation]] again."
        );
    }

    #[test]
    fn test_rewrite_links_leaves_a_different_title_untouched() {
        let content = "See [[Dijkstra]].";
        assert_eq!(
            rewrite_links(content, "Big O Notation", "Asymptotic Notation").unwrap(),
            content
        );
    }

    #[test]
    fn test_rewrite_tag_renames_matching_hashtags_case_insensitively() {
        let content = "Notes on #CS101 today. Revisit #cs101 before the exam.";
        assert_eq!(
            rewrite_tag(content, "cs101", "cs201").unwrap(),
            "Notes on #cs201 today. Revisit #cs201 before the exam."
        );
    }

    #[test]
    fn test_rewrite_tag_leaves_a_different_tag_untouched() {
        let content = "See #dynamic-programming for context.";
        assert_eq!(
            rewrite_tag(content, "recursion", "iteration").unwrap(),
            content
        );
    }

    #[test]
    fn test_rewrite_tag_does_not_match_a_longer_tag_sharing_a_prefix() {
        let content = "#cs is not the same tag as #cs101.";
        assert_eq!(
            rewrite_tag(content, "cs", "cs201").unwrap(),
            "#cs201 is not the same tag as #cs101."
        );
    }

    #[test]
    fn test_rewrite_tag_ignores_fenced_code() {
        let content = "```c\n#include <stdio.h>\n```\nSee #include for context.";
        assert_eq!(
            rewrite_tag(content, "include", "import").unwrap(),
            "```c\n#include <stdio.h>\n```\nSee #import for context."
        );
    }

    #[test]
    fn test_rewrite_tag_ignores_inline_code() {
        let content = "Use `#define` for macros, but #define is also a real tag here.";
        assert_eq!(
            rewrite_tag(content, "define", "macro").unwrap(),
            "Use `#define` for macros, but #macro is also a real tag here."
        );
    }

    #[tokio::test]
    async fn test_reindex_note_picks_up_pdf_sidecar_search_text() {
        // Pages-mode notes hold only `pdf-page` blocks — the PDF's own text
        // lives solely in the `.pdf` sidecar `import_pdf_pages` writes
        // (issue #33). This confirms `index_note_at` finds it there.
        let tmp = tempdir().unwrap();
        let ws = tmp.path().to_string_lossy().into_owned();
        let note = tmp.path().join("Lecture 7.md");
        let content = "# Lecture 7\n\n```pdf-page\n{\"src\":\"page-0.png\"}\n```\n";
        std::fs::write(&note, content).unwrap();

        let sidecar = tmp.path().join("Lecture 7.pdf");
        std::fs::create_dir_all(&sidecar).unwrap();
        std::fs::write(sidecar.join("text.txt"), "quicksort partitioning").unwrap();

        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        run_migrations(&pool).await.unwrap();
        index_note_at(&note.to_string_lossy(), &ws, content, &pool)
            .await
            .unwrap();

        let results =
            db::notes::search_notes(&pool, Some(&ws), Some("quicksort"), None, None, None)
                .await
                .unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].path, note.to_string_lossy());
    }

    #[tokio::test]
    async fn test_reindex_note_picks_up_diagram_text_elements() {
        // A diagram's typed labels live in the `.excalidraw` JSON the
        // ```diagram block's jsonSrc points at, not in the note's own
        // Markdown (issue #41). This confirms `index_note_at` finds them.
        let tmp = tempdir().unwrap();
        let ws = tmp.path().to_string_lossy().into_owned();
        let note = tmp.path().join("Lecture 7.md");
        let sidecar = tmp.path().join("Lecture 7.diagrams");
        std::fs::create_dir_all(&sidecar).unwrap();
        let json_path = sidecar.join("diagram-1.excalidraw");
        std::fs::write(
            &json_path,
            r#"{"elements":[{"type":"text","text":"deterministic finite automaton"},{"type":"rectangle"}]}"#,
        )
        .unwrap();

        let json_src = json_path.to_string_lossy().replace('\\', "\\\\");
        let content = format!(
            "# Lecture 7\n\n```diagram\n{{\"jsonSrc\":\"{json_src}\",\"svgSrc\":\"x\",\"width\":700,\"height\":500}}\n```\n"
        );
        std::fs::write(&note, &content).unwrap();

        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        run_migrations(&pool).await.unwrap();
        index_note_at(&note.to_string_lossy(), &ws, &content, &pool)
            .await
            .unwrap();

        let results =
            db::notes::search_notes(&pool, Some(&ws), Some("automaton"), None, None, None)
                .await
                .unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].path, note.to_string_lossy());
    }

    #[tokio::test]
    async fn test_rename_note_at_rewrites_inbound_links_and_reindexes_both_notes() {
        let tmp = tempdir().unwrap();
        let ws = tmp.path().to_string_lossy().into_owned();
        let target = tmp.path().join("target.md");
        let source = tmp.path().join("source.md");
        std::fs::write(&target, "# Big O Notation\nWhat it means.\n").unwrap();
        std::fs::write(&source, "# Source\nSee [[Big O Notation]] for details.\n").unwrap();

        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        run_migrations(&pool).await.unwrap();
        index_note_at(
            &target.to_string_lossy(),
            &ws,
            "# Big O Notation\nWhat it means.\n",
            &pool,
        )
        .await
        .unwrap();
        index_note_at(
            &source.to_string_lossy(),
            &ws,
            "# Source\nSee [[Big O Notation]] for details.\n",
            &pool,
        )
        .await
        .unwrap();

        let meta = rename_note_at(&target.to_string_lossy(), "Asymptotic Notation", &ws, &pool)
            .await
            .unwrap();

        assert_eq!(meta.title, "Asymptotic Notation");
        // The rename moves the file to match the new title — same as a
        // drag-and-drop move — so the old filename shouldn't survive it.
        assert_eq!(
            meta.path,
            tmp.path().join("Asymptotic Notation.md").to_string_lossy()
        );
        assert!(!target.exists());
        assert_eq!(
            std::fs::read_to_string(&meta.path).unwrap(),
            "# Asymptotic Notation\nWhat it means.\n"
        );
        assert_eq!(
            std::fs::read_to_string(&source).unwrap(),
            "# Source\nSee [[Asymptotic Notation]] for details.\n"
        );

        let old_backlinks = db::notes::backlinks_for(&pool, &ws, "Big O Notation")
            .await
            .unwrap();
        assert!(old_backlinks.is_empty());
        let new_backlinks = db::notes::backlinks_for(&pool, &ws, "Asymptotic Notation")
            .await
            .unwrap();
        assert_eq!(new_backlinks.len(), 1);
        assert_eq!(new_backlinks[0].path, source.to_string_lossy());
    }

    #[tokio::test]
    async fn test_rename_note_at_leaves_an_unrelated_note_untouched() {
        let tmp = tempdir().unwrap();
        let ws = tmp.path().to_string_lossy().into_owned();
        let target = tmp.path().join("target.md");
        let other = tmp.path().join("other.md");
        std::fs::write(&target, "# Old Title\nbody\n").unwrap();
        std::fs::write(&other, "# Other\nSee [[Something Else]].\n").unwrap();

        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        run_migrations(&pool).await.unwrap();
        index_note_at(&target.to_string_lossy(), &ws, "# Old Title\nbody\n", &pool)
            .await
            .unwrap();
        index_note_at(
            &other.to_string_lossy(),
            &ws,
            "# Other\nSee [[Something Else]].\n",
            &pool,
        )
        .await
        .unwrap();

        rename_note_at(&target.to_string_lossy(), "New Title", &ws, &pool)
            .await
            .unwrap();

        assert_eq!(
            std::fs::read_to_string(&other).unwrap(),
            "# Other\nSee [[Something Else]].\n"
        );
    }

    #[tokio::test]
    async fn test_rename_tag_at_rewrites_every_tagged_note_and_reindexes_it() {
        let tmp = tempdir().unwrap();
        let ws = tmp.path().to_string_lossy().into_owned();
        let tagged = tmp.path().join("tagged.md");
        let other = tmp.path().join("other.md");
        let tagged_content = "# Tagged\nStudy #agorithms tonight.\n";
        let other_content = "# Other\nNo relevant tags here.\n";
        std::fs::write(&tagged, tagged_content).unwrap();
        std::fs::write(&other, other_content).unwrap();

        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        run_migrations(&pool).await.unwrap();
        index_note_at(&tagged.to_string_lossy(), &ws, tagged_content, &pool)
            .await
            .unwrap();
        index_note_at(&other.to_string_lossy(), &ws, other_content, &pool)
            .await
            .unwrap();

        let renamed = rename_tag_at("agorithms", "algorithms", &ws, &pool)
            .await
            .unwrap();

        assert_eq!(renamed, 1);
        assert_eq!(
            std::fs::read_to_string(&tagged).unwrap(),
            "# Tagged\nStudy #algorithms tonight.\n"
        );
        assert_eq!(std::fs::read_to_string(&other).unwrap(), other_content);

        let tags = db::notes::list_tags(&pool, &ws).await.unwrap();
        assert!(!tags.iter().any(|t| t.eq_ignore_ascii_case("agorithms")));
        assert!(tags.iter().any(|t| t.eq_ignore_ascii_case("algorithms")));
    }

    #[tokio::test]
    async fn test_rename_note_at_moves_every_sidecar_with_the_file() {
        let tmp = tempdir().unwrap();
        let root = tmp.path();
        let ws = root.to_string_lossy().into_owned();
        std::fs::write(root.join("note.md"), "# Note").unwrap();
        for suffix in ["ink", "pdf", "diagrams", "assets"] {
            let dir = root.join(format!("note.{suffix}"));
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join("child"), "content").unwrap();
        }

        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        run_migrations(&pool).await.unwrap();
        let old_path = root.join("note.md").to_string_lossy().into_owned();
        index_note_at(&old_path, &ws, "# Note", &pool)
            .await
            .unwrap();

        let meta = rename_note_at(&old_path, "Renamed", &ws, &pool)
            .await
            .unwrap();

        assert!(std::path::Path::new(&meta.path).exists());
        assert!(!root.join("note.md").exists());
        for suffix in ["ink", "pdf", "diagrams", "assets"] {
            assert!(
                root.join(format!("Renamed.{suffix}"))
                    .join("child")
                    .exists(),
                "Renamed.{suffix} must travel with the note"
            );
            assert!(
                !root.join(format!("note.{suffix}")).exists(),
                "note.{suffix} must not be left behind"
            );
        }
        let notes = db::notes::list_by_workspace(&pool, &ws).await.unwrap();
        assert_eq!(notes[0].path, meta.path);
    }

    #[tokio::test]
    async fn test_rename_note_at_rewrites_sidecar_links_in_its_own_content() {
        let tmp = tempdir().unwrap();
        let root = tmp.path();
        let ws = root.to_string_lossy().into_owned();
        std::fs::create_dir_all(root.join("Old Note.assets")).unwrap();
        let content = concat!(
            "# Old Note\n",
            "![fig](Old%20Note.assets/image-1.png)\n",
            "```ink\n{\"src\":\"Old Note.ink/a.svg\",\"width\":700,\"height\":400}\n```\n",
        );
        std::fs::write(root.join("Old Note.md"), content).unwrap();

        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        run_migrations(&pool).await.unwrap();
        let old_path = root.join("Old Note.md").to_string_lossy().into_owned();
        index_note_at(&old_path, &ws, content, &pool).await.unwrap();

        let meta = rename_note_at(&old_path, "New Note", &ws, &pool)
            .await
            .unwrap();

        let new_content = std::fs::read_to_string(&meta.path).unwrap();
        assert!(
            new_content.contains("New%20Note.assets/image-1.png"),
            "image link must follow the rename: {new_content}"
        );
        assert!(
            new_content.contains("\"src\":\"New Note.ink/a.svg\""),
            "ink embed link must follow the rename: {new_content}"
        );
    }

    #[tokio::test]
    async fn test_rename_note_at_rejects_a_name_already_taken() {
        let tmp = tempdir().unwrap();
        let root = tmp.path();
        let ws = root.to_string_lossy().into_owned();
        std::fs::write(root.join("note.md"), "# Old Title").unwrap();
        std::fs::write(root.join("Taken.md"), "# Survivor").unwrap();

        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        run_migrations(&pool).await.unwrap();
        let old_path = root.join("note.md").to_string_lossy().into_owned();
        index_note_at(&old_path, &ws, "# Old Title", &pool)
            .await
            .unwrap();

        let result = rename_note_at(&old_path, "Taken", &ws, &pool).await;

        assert!(result.is_err());
        assert!(root.join("note.md").exists(), "source note must stay put");
        assert_eq!(
            std::fs::read_to_string(root.join("Taken.md")).unwrap(),
            "# Survivor",
            "existing note at the destination must not be overwritten"
        );
    }

    async fn seed_formula_fixture(tmp: &std::path::Path, ws: &str, pool: &DbPool) {
        let a = tmp.join("CS101").join("a.md");
        let b = tmp.join("CS102").join("b.md");
        std::fs::create_dir_all(a.parent().unwrap()).unwrap();
        std::fs::create_dir_all(b.parent().unwrap()).unwrap();

        let a_content = "# Analysis\n## Eigenvalues\n$$Av = \\lambda v$$\n\n$$Av = \\lambda v$$\n";
        let b_content = "# Networks\n$$Av = \\lambda v$$\n$$E=mc^2$$\n";
        std::fs::write(&a, a_content).unwrap();
        std::fs::write(&b, b_content).unwrap();

        index_note_at(&a.to_string_lossy(), ws, a_content, pool)
            .await
            .unwrap();
        index_note_at(&b.to_string_lossy(), ws, b_content, pool)
            .await
            .unwrap();
        db::notes::set_tags(pool, &a.to_string_lossy(), &["calc2".to_string()])
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn test_generate_formula_sheet_at_dedupes_and_groups_by_note_and_heading() {
        let tmp = tempdir().unwrap();
        let ws = tmp.path().to_string_lossy().into_owned();
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        run_migrations(&pool).await.unwrap();
        seed_formula_fixture(tmp.path(), &ws, &pool).await;

        let meta = generate_formula_sheet_at(&ws, None, None, &pool)
            .await
            .unwrap();

        assert_eq!(meta.title, "Formula Sheet");
        let body = std::fs::read_to_string(&meta.path).unwrap();
        assert_eq!(
            body,
            "# Formula Sheet\n\n## Analysis\n\n### Eigenvalues\n\n$\nAv = \\lambda v\n$\n\n## Networks\n\n$\nE=mc^2\n$\n"
        );
    }

    #[tokio::test]
    async fn test_generate_formula_sheet_at_includes_numbered_callouts() {
        let tmp = tempdir().unwrap();
        let ws = tmp.path().to_string_lossy().into_owned();
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        run_migrations(&pool).await.unwrap();

        let note = tmp.path().join("c.md");
        let content = "# Analysis\n## Fixed Points\n> [!THEOREM 3.2] Banach\n> Every contraction has one.\n\n$$E=mc^2$$\n";
        std::fs::write(&note, content).unwrap();
        index_note_at(&note.to_string_lossy(), &ws, content, &pool)
            .await
            .unwrap();

        let meta = generate_formula_sheet_at(&ws, None, None, &pool)
            .await
            .unwrap();

        let body = std::fs::read_to_string(&meta.path).unwrap();
        assert_eq!(
            body,
            "# Formula Sheet\n\n## Analysis\n\n### Fixed Points\n\n$\nE=mc^2\n$\n\n## Definitions & Theorems\n\n### Analysis\n\n#### Fixed Points\n\n> [!THEOREM 3.2] Banach\n> Every contraction has one.\n"
        );
    }

    #[tokio::test]
    async fn test_generate_formula_sheet_at_filters_by_folder() {
        let tmp = tempdir().unwrap();
        let ws = tmp.path().to_string_lossy().into_owned();
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        run_migrations(&pool).await.unwrap();
        seed_formula_fixture(tmp.path(), &ws, &pool).await;

        let meta = generate_formula_sheet_at(&ws, Some("CS102"), None, &pool)
            .await
            .unwrap();

        assert_eq!(meta.title, "Formula Sheet - CS102");
        let body = std::fs::read_to_string(&meta.path).unwrap();
        assert_eq!(
            body,
            "# Formula Sheet - CS102\n\n## Networks\n\n$\nAv = \\lambda v\n$\n\n$\nE=mc^2\n$\n"
        );
    }

    #[tokio::test]
    async fn test_generate_formula_sheet_at_filters_by_tag() {
        let tmp = tempdir().unwrap();
        let ws = tmp.path().to_string_lossy().into_owned();
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        run_migrations(&pool).await.unwrap();
        seed_formula_fixture(tmp.path(), &ws, &pool).await;

        let meta = generate_formula_sheet_at(&ws, None, Some("calc2"), &pool)
            .await
            .unwrap();

        assert_eq!(meta.title, "Formula Sheet - calc2");
        let body = std::fs::read_to_string(&meta.path).unwrap();
        assert_eq!(
            body,
            "# Formula Sheet - calc2\n\n## Analysis\n\n### Eigenvalues\n\n$\nAv = \\lambda v\n$\n"
        );
    }

    #[tokio::test]
    async fn test_generate_formula_sheet_at_refuses_to_overwrite_an_existing_file() {
        let tmp = tempdir().unwrap();
        let ws = tmp.path().to_string_lossy().into_owned();
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        run_migrations(&pool).await.unwrap();
        seed_formula_fixture(tmp.path(), &ws, &pool).await;
        let existing = tmp.path().join("Formula Sheet.md");
        std::fs::write(&existing, "pre-existing content").unwrap();

        let result = generate_formula_sheet_at(&ws, None, None, &pool).await;

        assert!(result.is_err());
        assert_eq!(
            std::fs::read_to_string(&existing).unwrap(),
            "pre-existing content"
        );
    }

    #[tokio::test]
    async fn test_generate_formula_sheet_at_skips_a_note_whose_file_no_longer_exists_on_disk() {
        let tmp = tempdir().unwrap();
        let ws = tmp.path().to_string_lossy().into_owned();
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        run_migrations(&pool).await.unwrap();
        seed_formula_fixture(tmp.path(), &ws, &pool).await;

        // A stale index row: indexed, but the file is since gone — the shape
        // index.db can end up in when a note is deleted outside the app
        // (matches `reindex_from_disk`'s own read-failure handling, which
        // also treats a missing file as "gone," not an error).
        let gone = tmp.path().join("CS103").join("gone.md");
        std::fs::create_dir_all(gone.parent().unwrap()).unwrap();
        std::fs::write(&gone, "# Gone\n$$stale$$\n").unwrap();
        index_note_at(&gone.to_string_lossy(), &ws, "# Gone\n$$stale$$\n", &pool)
            .await
            .unwrap();
        std::fs::remove_file(&gone).unwrap();

        let meta = generate_formula_sheet_at(&ws, None, None, &pool)
            .await
            .unwrap();

        let body = std::fs::read_to_string(&meta.path).unwrap();
        assert!(!body.contains("stale"));
        assert!(body.contains("Av = \\lambda v"));
    }
}

#[cfg(test)]
mod folder_tests {
    use super::*;
    use crate::db::notes::index_note as db_index_note;
    use crate::db::schema::run_migrations;
    use tempfile::tempdir;

    // max_connections(1): an unbounded pool against `:memory:` hands out a
    // fresh, empty database per connection, so a query can silently miss the
    // migrations run_migrations just applied on a different one — see the
    // matching comment on db::notes::tests::make_pool for the full story.
    async fn make_pool() -> DbPool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        run_migrations(&pool).await.unwrap();
        pool
    }

    #[tokio::test]
    async fn test_list_templates_at_missing_folder_is_an_empty_list_not_an_error() {
        let tmp = tempdir().unwrap();
        let templates = list_templates_at(&tmp.path().to_string_lossy())
            .await
            .unwrap();
        assert!(templates.is_empty());
    }

    #[tokio::test]
    async fn test_list_templates_at_lists_only_markdown_files() {
        let tmp = tempdir().unwrap();
        let dir = tmp.path().join("templates");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("Exercise Sheet.md"), "# {{course}}").unwrap();
        std::fs::write(dir.join("notes.txt"), "not a template").unwrap();

        let templates = list_templates_at(&tmp.path().to_string_lossy())
            .await
            .unwrap();

        assert_eq!(templates.len(), 1);
        assert_eq!(templates[0].name, "Exercise Sheet");
    }

    #[tokio::test]
    async fn test_seed_default_templates_at_writes_the_exercise_sheet_template() {
        let tmp = tempdir().unwrap();
        let workspace = tmp.path().to_string_lossy().into_owned();

        let created = seed_default_templates_at(&workspace).await.unwrap();

        assert_eq!(created.len(), 1);
        assert_eq!(created[0].name, "Exercise Sheet");
        let content =
            std::fs::read_to_string(tmp.path().join("templates/Exercise Sheet.md")).unwrap();
        assert!(content.contains("{{course}}"));
        assert!(content.contains("## Task 1"));
    }

    // Mirrors the scaffold-notes "top up, don't replace" guarantee: a template
    // the user has since edited must survive re-running the seed command.
    #[tokio::test]
    async fn test_seed_default_templates_at_never_overwrites_an_edited_template() {
        let tmp = tempdir().unwrap();
        let workspace = tmp.path().to_string_lossy().into_owned();
        seed_default_templates_at(&workspace).await.unwrap();
        let path = tmp.path().join("templates/Exercise Sheet.md");
        std::fs::write(&path, "# my own edits").unwrap();

        let created = seed_default_templates_at(&workspace).await.unwrap();

        assert!(created.is_empty());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "# my own edits");
    }

    #[tokio::test]
    async fn test_create_note_file_with_content_writes_the_given_content_verbatim() {
        let tmp = tempdir().unwrap();

        let path = create_note_file_with_content(
            &tmp.path().to_string_lossy(),
            "Blatt 4",
            "# Analysis — Blatt 4\n\n## Task 1\n",
        )
        .await
        .unwrap();

        assert_eq!(path, tmp.path().join("Blatt 4.md"));
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "# Analysis — Blatt 4\n\n## Task 1\n"
        );
    }

    #[tokio::test]
    async fn test_create_note_file_with_content_refuses_to_overwrite_an_existing_note() {
        let tmp = tempdir().unwrap();
        std::fs::write(tmp.path().join("Blatt 4.md"), "# real work").unwrap();

        let result =
            create_note_file_with_content(&tmp.path().to_string_lossy(), "Blatt 4", "# new").await;

        assert!(result.is_err());
        assert_eq!(
            std::fs::read_to_string(tmp.path().join("Blatt 4.md")).unwrap(),
            "# real work"
        );
    }

    #[test]
    fn test_templates_dir_is_not_scanned_as_notes() {
        assert!(is_excluded_dir("templates"));
    }

    #[tokio::test]
    async fn test_create_folder_at_creates_directory() {
        let tmp = tempdir().unwrap();
        let parent = tmp.path().to_string_lossy().into_owned();
        let path = create_folder_at(&parent, "Course101").await.unwrap();
        assert!(std::path::Path::new(&path).is_dir());
    }

    #[tokio::test]
    async fn test_create_folder_at_rejects_names_that_leave_the_parent() {
        let tmp = tempdir().unwrap();
        let parent = tmp.path().to_string_lossy().into_owned();
        for name in ["", "..", "a/b", "../escape", "a\\b"] {
            assert!(create_folder_at(&parent, name).await.is_err(), "{name:?}");
        }
    }

    #[tokio::test]
    async fn test_rename_folder_at_moves_dir_and_updates_notes() {
        let tmp = tempdir().unwrap();
        let root = tmp.path();
        let old_dir = root.join("Old");
        std::fs::create_dir_all(&old_dir).unwrap();
        std::fs::write(old_dir.join("note.md"), "# Note").unwrap();

        let pool = make_pool().await;
        let old_note_path = old_dir.join("note.md").to_string_lossy().into_owned();
        db_index_note(
            &pool,
            &NoteMetadata {
                id: "a".into(),
                title: "Note".into(),
                path: old_note_path,
                workspace: root.to_string_lossy().into_owned(),
                updated_at: 1000,
            },
        )
        .await
        .unwrap();

        let new_dir = root.join("New").to_string_lossy().into_owned();
        rename_folder_at(&old_dir.to_string_lossy(), &new_dir, &pool)
            .await
            .unwrap();

        assert!(std::path::Path::new(&new_dir).join("note.md").exists());
        let notes = db::notes::list_by_workspace(&pool, &root.to_string_lossy())
            .await
            .unwrap();
        let expected = std::path::Path::new(&new_dir)
            .join("note.md")
            .to_string_lossy()
            .into_owned();
        assert_eq!(notes[0].path, expected);
    }

    #[tokio::test]
    async fn test_rename_folder_at_rejects_existing_destination() {
        let tmp = tempdir().unwrap();
        let root = tmp.path();
        let old_dir = root.join("Old");
        let new_dir = root.join("New");
        std::fs::create_dir_all(&old_dir).unwrap();
        std::fs::write(old_dir.join("note.md"), "# Old").unwrap();
        std::fs::create_dir_all(&new_dir).unwrap();
        std::fs::write(new_dir.join("note.md"), "# Survivor").unwrap();

        let pool = make_pool().await;
        let result = rename_folder_at(
            &old_dir.to_string_lossy(),
            &new_dir.to_string_lossy(),
            &pool,
        )
        .await;

        assert!(result.is_err());
        assert_eq!(
            std::fs::read_to_string(new_dir.join("note.md")).unwrap(),
            "# Survivor",
            "existing note at the destination must not be overwritten"
        );
    }

    #[tokio::test]
    async fn test_move_note_at_moves_file_and_every_sidecar() {
        let tmp = tempdir().unwrap();
        let root = tmp.path();
        let src_dir = root.join("Src");
        let dest_dir = root.join("Dest");
        std::fs::create_dir_all(&src_dir).unwrap();
        std::fs::create_dir_all(&dest_dir).unwrap();
        std::fs::write(src_dir.join("note.md"), "# Note").unwrap();
        for suffix in ["ink", "pdf", "diagrams", "assets"] {
            let dir = src_dir.join(format!("note.{suffix}"));
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join("child"), "content").unwrap();
        }

        let pool = make_pool().await;
        let old_path = src_dir.join("note.md").to_string_lossy().into_owned();
        db_index_note(
            &pool,
            &NoteMetadata {
                id: "a".into(),
                title: "Note".into(),
                path: old_path.clone(),
                workspace: root.to_string_lossy().into_owned(),
                updated_at: 1000,
            },
        )
        .await
        .unwrap();

        let new_path = move_note_at(&old_path, &dest_dir.to_string_lossy(), &pool)
            .await
            .unwrap();

        assert!(std::path::Path::new(&new_path).exists());
        assert!(!src_dir.join("note.md").exists());
        for suffix in ["ink", "pdf", "diagrams", "assets"] {
            assert!(
                dest_dir
                    .join(format!("note.{suffix}"))
                    .join("child")
                    .exists(),
                "note.{suffix} must travel with the note"
            );
            assert!(
                !src_dir.join(format!("note.{suffix}")).exists(),
                "note.{suffix} must not be left behind"
            );
        }
        let notes = db::notes::list_by_workspace(&pool, &root.to_string_lossy())
            .await
            .unwrap();
        assert_eq!(notes[0].path, new_path);
    }

    #[tokio::test]
    async fn test_move_note_at_rejects_existing_destination() {
        let tmp = tempdir().unwrap();
        let root = tmp.path();
        let src_dir = root.join("Src");
        let dest_dir = root.join("Dest");
        std::fs::create_dir_all(&src_dir).unwrap();
        std::fs::create_dir_all(&dest_dir).unwrap();
        std::fs::write(src_dir.join("note.md"), "# Moving").unwrap();
        std::fs::write(dest_dir.join("note.md"), "# Survivor").unwrap();

        let pool = make_pool().await;
        let old_path = src_dir.join("note.md").to_string_lossy().into_owned();
        let result = move_note_at(&old_path, &dest_dir.to_string_lossy(), &pool).await;

        assert!(result.is_err());
        assert!(
            src_dir.join("note.md").exists(),
            "source note must stay put"
        );
        assert_eq!(
            std::fs::read_to_string(dest_dir.join("note.md")).unwrap(),
            "# Survivor",
            "existing note at the destination must not be overwritten"
        );
    }

    #[test]
    fn test_set_card_suspended_line_toggles_suspended_flag() {
        let note = "What is 2+2? :: 4\n<!-- sr due=2026-01-01 ease=2.50 interval=0 reps=0 -->\n";
        let suspended = set_card_suspended_line(note, 0, true).unwrap();
        assert!(suspended.contains("suspended=true"));

        let unsuspended = set_card_suspended_line(&suspended, 0, false).unwrap();
        assert!(!unsuspended.contains("suspended=true"));
        assert!(unsuspended.contains("<!-- sr due=2026-01-01 ease=2.50 interval=0 reps=0 -->"));
    }

    #[test]
    fn test_grade_card_line_preserves_suspended_status() {
        let note = "What is 2+2? :: 4\n<!-- sr due=2026-01-01 ease=2.50 interval=0 reps=0 suspended=true -->\n";
        let today = chrono::NaiveDate::from_ymd_opt(2026, 1, 1).unwrap();
        let graded = grade_card_line(note, 0, sm2::Grade::Good, today).unwrap();
        assert!(graded.contains("suspended=true"));
    }
}

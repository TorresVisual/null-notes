//! Splitting a note into `## Task N` / `### Solution` pairs.
//!
//! **Never automatic.** Turning a document into an exercise sheet is a claim
//! about what it is, and a lecture script or a paper is not one — so this runs
//! only when the user asks for it, on the note in front of them. It lives
//! outside `pdf/` for that reason: the PDF pipeline does not call it, and a
//! hand-written note is as valid an input as a converted sheet.
//!
//! Works on assembled Markdown rather than on `pdf::layout::Block`s, which is
//! also what lets it run on any note at all — blocks only ever exist one page,
//! one region, at a time.
//!
//! Design: `docs/specs/pdf-exercise-splitting-design.md`.

use regex::Regex;

/// A `Beispiel 9.1.` / `Aufgabe 3.` style exercise opener.
///
/// Leading whitespace is allowed, unlike the ordered-item pattern: the keyword
/// says outright that this is an exercise, so indentation carries no
/// information here, whereas an indented `1.` genuinely is a sub-part. Ue6's
/// `Beispiel 6.3.` arrives indented eight spaces and is an exercise like every
/// other one on the sheet.
fn keyword_pattern() -> Regex {
    Regex::new(r"^(\s*)(?:Aufgabe|Beispiel|Exercise|Task|Problem)\s+(\d+(?:\.\d+)*)\.?(?:\s|$)")
        .expect("static pattern")
}

/// A top-level ordered list marker: `1. `, at column zero. An indented marker
/// is a sub-part, and `layout.rs` has already decided which is which.
fn ordered_pattern() -> Regex {
    Regex::new(r"^(\d+)\.\s+\S").expect("static pattern")
}

/// Where one exercise starts: the line it begins on, and the number to label
/// it with — taken from the source, never from a counter, so a sheet whose
/// exercises start at 3 still reads against the paper on the desk.
#[derive(Debug, PartialEq)]
struct Start {
    line: usize,
    label: String,
    /// The opener's own indentation, stripped from the whole exercise when it
    /// is emitted. Under a `## Task` heading there is no enclosing list left
    /// to justify it, and four spaces of it would make the exercise an
    /// indented code block.
    indent: usize,
}

/// Splits a converted sheet into `## Task N` + `### Solution` pairs.
///
/// Returns the document unchanged when no exercise structure is found: a miss
/// costs the scaffold, never a line of content. Exercise bodies are copied
/// verbatim, list markers and indentation included — a sub-part sits four
/// spaces under its parent marker, so stripping the marker would leave the
/// children as an indented code block.
pub fn split_into_tasks(markdown: &str) -> String {
    let lines: Vec<&str> = markdown.lines().collect();
    let starts = find_starts(&lines);
    if starts.len() < 2 {
        return markdown.to_string();
    }

    let mut out = String::new();
    let preamble = lines[..starts[0].line].join("\n");
    if !preamble.trim().is_empty() {
        out.push_str(preamble.trim_end());
        out.push_str("\n\n");
    }

    for (i, start) in starts.iter().enumerate() {
        let end = starts.get(i + 1).map(|s| s.line).unwrap_or(lines.len());
        let body = lines[start.line..end]
            .iter()
            .map(|line| dedent(line, start.indent))
            .collect::<Vec<&str>>()
            .join("\n");

        out.push_str("## Task ");
        out.push_str(&start.label);
        out.push_str("\n\n- [ ] Task ");
        out.push_str(&start.label);
        out.push_str("\n\n");
        out.push_str(body.trim_end());
        out.push_str("\n\n### Solution\n\n");
    }

    out
}

/// The exercise openers, by whichever of the two patterns owns this document.
///
/// One decision for the whole document, never per block: Ue9's exercises are
/// `Beispiel 9.1.` paragraphs whose *sub-parts* are the top-level ordered
/// items, so a document split by both patterns would be cut inside every
/// exercise it has.
fn find_starts(lines: &[&str]) -> Vec<Start> {
    let keyword = keyword_starts(lines);
    // One match is a mention inside prose, not a structure.
    if keyword.len() >= 2 {
        return keyword;
    }
    ordered_starts(lines)
}

/// Removes up to `by` leading spaces, keeping any deeper indentation so a
/// sub-part stays nested relative to the exercise it belongs to.
fn dedent(line: &str, by: usize) -> &str {
    let strippable = line.len() - line.trim_start_matches(' ').len();
    &line[strippable.min(by)..]
}

fn keyword_starts(lines: &[&str]) -> Vec<Start> {
    let pattern = keyword_pattern();
    lines
        .iter()
        .enumerate()
        .filter_map(|(i, line)| {
            pattern.captures(line).map(|caps| Start {
                line: i,
                label: caps[2].to_string(),
                indent: caps[1].len(),
            })
        })
        .collect()
}

/// Every top-level ordered item, minus a leading label-like one.
///
/// **The numbers carry no information and must not be used.** `12. Übungsblatt`
/// and the `1.` beneath it are one CommonMark list — a list item's written
/// number is ignored after the first — so the editor's own Markdown round trip
/// renumbers the first exercise to `13.` and the rest in turn, and saving the
/// note writes that back to the file. On the real Blatt12 the sequence that
/// arrives here is `12, 13, 2, 3, 4, 5, 6, 1, 2`: the `2` onwards restart only
/// because a display equation broke the list, and the trailing `1, 2` are the
/// sheet's bonus questions.
///
/// An earlier version took the longest run of consecutive integers beginning
/// at one. On the sequence above that run is the pair of *bonus* items, so it
/// split the sheet into those two and nothing else — worse than not splitting
/// at all. A rule that reads meaning out of numbers this unreliable will keep
/// finding meaning that is not there.
///
/// Being a top-level ordered item is the one property that survives, so it is
/// the whole rule. The sheet-number line is dropped only when it leads and
/// reads as a label: an exercise is an instruction and runs to a sentence,
/// while `12. Übungsblatt` is a title. A bonus question is a real exercise and
/// is deliberately kept.
fn ordered_starts(lines: &[&str]) -> Vec<Start> {
    let pattern = ordered_pattern();
    let candidates: Vec<(usize, u32)> = lines
        .iter()
        .enumerate()
        .filter_map(|(i, line)| {
            pattern
                .captures(line)
                .and_then(|caps| caps[1].parse::<u32>().ok().map(|n| (i, n)))
        })
        .collect();

    let skip = usize::from(candidates.len() > 2 && leads_with_a_title(lines, &candidates));
    candidates
        .iter()
        .skip(skip)
        .enumerate()
        // Counted, not copied. The keyword path takes its labels from the
        // source because `Beispiel 9.2` is what the paper on the desk says,
        // but an ordered item's number has usually been rewritten by the
        // editor into something that matches nothing — Blatt12 arrives as
        // 13, 2, 3, 4, 5, 6, 1, 2. Counting at least numbers the tasks in the
        // order they are read.
        .map(|(i, &(line, _))| Start {
            line,
            label: (i + 1).to_string(),
            indent: 0,
        })
        .collect()
}

/// How many words an ordered item may carry and still read as a label rather
/// than an instruction. `12. Übungsblatt` is one; `5. Übungsblatt (19.5.2026)`
/// is two; the shortest real exercise opener in the corpus is four
/// (`Berechnen Sie das Kurvenintegral`).
const TITLE_MAX_WORDS: usize = 2;

fn leads_with_a_title(lines: &[&str], candidates: &[(usize, u32)]) -> bool {
    let Some((line, _)) = candidates.first() else {
        return false;
    };
    let Some(text) = lines.get(*line) else {
        return false;
    };
    let after_marker = text
        .trim_start()
        .split_once(". ")
        .map(|(_, rest)| rest)
        .unwrap_or("");
    !after_marker.is_empty() && after_marker.split_whitespace().count() <= TITLE_MAX_WORDS
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sheet(lines: &[&str]) -> String {
        lines.join("\n")
    }

    /// Splits a real note and prints the result.
    ///
    /// The bug this exists for was invisible to every unit test and to the
    /// corpus sweep alike: the sweep ran the *pipeline's* output through the
    /// splitter, but the app runs the *editor's* re-serialization of it, and
    /// the editor renumbers ordered lists. Point this at a note saved out of
    /// the app — not at `dump_markdown` output — to see what the command
    /// actually gets.
    ///
    /// `NULL_NOTES_MD=../some/note.md cargo test --features pdf-native \
    ///   dump_split -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn dump_split() {
        let path = std::env::var("NULL_NOTES_MD").expect("set NULL_NOTES_MD");
        let markdown = std::fs::read_to_string(&path).expect("could not read the note");

        let lines: Vec<&str> = markdown.lines().collect();
        println!("=== openers found ===");
        for start in find_starts(&lines) {
            println!("  Task {:>4}  <- {}", start.label, lines[start.line]);
        }

        let out = split_into_tasks(&markdown);
        println!("=== {} task(s) ===", out.matches("## Task ").count());
        println!("{out}");
    }

    // Analysis_2_Blatt11's shape: the sheet's own number as the first
    // top-level item, then the exercises restarting at 1.
    #[test]
    fn the_sheet_number_is_not_an_exercise() {
        let md = sheet(&[
            "# Analysis 2 für Informatikstudien",
            "",
            "11. Übungsblatt",
            "",
            "1. Berechnen Sie das Kurvenintegral",
            "",
            "2. Gegeben ist die komplexe Funktion",
        ]);

        let out = split_into_tasks(&md);

        assert!(out.contains("## Task 1"), "got: {out}");
        assert!(out.contains("## Task 2"), "got: {out}");
        assert!(!out.contains("## Task 11"), "the sheet number: {out}");
        assert!(
            out.contains("11. Übungsblatt"),
            "kept above the first task: {out}"
        );
    }

    #[test]
    fn every_exercise_gets_a_checkbox_the_task_extractor_sees() {
        let md = sheet(&["1. First exercise", "", "2. Second exercise"]);

        let out = split_into_tasks(&md);

        let tasks = crate::commands::notes::extract_tasks(&out);
        let texts: Vec<&str> = tasks.iter().map(|t| t.text.as_str()).collect();
        assert_eq!(texts, ["Task 1", "Task 2"], "got: {out}");
        assert!(tasks.iter().all(|t| !t.done));
    }

    #[test]
    fn every_exercise_gets_an_empty_solution_section() {
        let md = sheet(&["1. First exercise", "", "2. Second exercise"]);

        let out = split_into_tasks(&md);

        assert_eq!(out.matches("### Solution").count(), 2, "got: {out}");
        assert!(
            out.trim_end().ends_with("### Solution"),
            "empty, not seeded: {out}"
        );
    }

    // A sub-part sits four spaces under its parent's marker. Stripping the
    // parent marker would leave the children as an indented code block, so the
    // body is copied exactly as it arrived.
    #[test]
    fn a_nested_sub_part_keeps_its_indentation_and_its_parent_marker() {
        let md = sheet(&[
            "1. Gegeben ist das nichtlineare System:",
            "",
            "    1. Bestimmen Sie alle Fixpunkte.",
            "",
            "    2. Linearisieren Sie das System.",
            "",
            "2. Nächste Aufgabe",
        ]);

        let out = split_into_tasks(&md);

        assert_eq!(
            out.matches("## Task").count(),
            2,
            "sub-parts are not tasks: {out}"
        );
        assert!(
            out.contains("    1. Bestimmen Sie alle Fixpunkte."),
            "got: {out}"
        );
        assert!(
            out.contains("1. Gegeben ist das nichtlineare System:"),
            "got: {out}"
        );
    }

    // Ue9 inverts the shape: its exercises are `Beispiel N.M.` paragraphs and
    // its sub-parts are the top-level ordered items, numbered continuously
    // across exercises and restarting partway. Splitting on `N.` here would
    // cut inside every exercise the sheet has.
    #[test]
    fn a_keyword_sheet_splits_on_the_keyword_not_on_its_ordered_sub_parts() {
        let md = sheet(&[
            "Beispiel 9.1. Bringen Sie die folgenden Formeln in pränexe Normalform.",
            "",
            "1. $\\neg\\forall y$",
            "",
            "2. $\\forall x$",
            "",
            "Beispiel 9.2. Gegeben sind $a, b, c$.",
            "",
            "3. Vor den Hörsälen A, B und C",
        ]);

        let out = split_into_tasks(&md);

        assert_eq!(out.matches("## Task").count(), 2, "got: {out}");
        assert!(
            out.contains("## Task 9.1"),
            "labelled from the source: {out}"
        );
        assert!(out.contains("## Task 9.2"), "got: {out}");
    }

    // Ue6's `Beispiel 6.3.` arrives indented eight spaces, and was silently
    // missed while its four siblings split — the sheet lost an exercise. The
    // indentation has to go with it: under a `## Task` heading there is no
    // enclosing list left, and eight spaces would make the whole exercise an
    // indented code block.
    #[test]
    fn an_indented_keyword_opener_is_still_an_exercise_and_is_dedented() {
        let md = sheet(&[
            "Beispiel 6.2. Alice und Bob führen einen Schlüsselaustausch durch.",
            "",
            "        Beispiel 6.3. Welche der folgenden Zahlenpaare?",
            "",
            "            1. Ein Unterpunkt",
            "",
            "Beispiel 6.4. Die Zahlenfolge wurde verschlüsselt.",
        ]);

        let out = split_into_tasks(&md);

        assert_eq!(out.matches("## Task").count(), 3, "got: {out}");
        assert!(out.contains("## Task 6.3"), "got: {out}");
        assert!(
            out.contains("\nBeispiel 6.3. Welche der folgenden Zahlenpaare?"),
            "dedented to column zero: {out}"
        );
        assert!(
            out.contains("\n    1. Ein Unterpunkt"),
            "sub-part stays nested relative to its exercise: {out}"
        );
    }

    // One "Aufgabe" inside a sentence is a mention, not a structure.
    #[test]
    fn a_single_keyword_mention_does_not_claim_the_document() {
        let md = sheet(&[
            "Beispiel 1. Ein einzelner Hinweis.",
            "",
            "1. Erste Aufgabe",
            "",
            "2. Zweite Aufgabe",
        ]);

        let out = split_into_tasks(&md);

        assert_eq!(out.matches("## Task").count(), 2, "got: {out}");
        assert!(out.contains("## Task 1"), "got: {out}");
        assert!(out.contains("## Task 2"), "got: {out}");
    }

    #[test]
    fn a_sheet_with_no_exercise_structure_is_returned_unchanged() {
        let md = sheet(&["# Skriptum", "", "Ordinary prose with no exercises at all."]);

        assert_eq!(split_into_tasks(&md), md);
    }

    // A miss degrades to plain conversion. One exercise is not a structure
    // worth splitting, and inventing a single "Task 1" over a whole document
    // would be a worse note than the one that arrived.
    #[test]
    fn a_lone_ordered_item_is_not_enough_to_split_on() {
        let md = sheet(&[
            "1. The only numbered thing here",
            "",
            "Some following prose.",
        ]);

        assert_eq!(split_into_tasks(&md), md);
    }

    // The load-bearing safety property: the transform only ever inserts. Every
    // non-blank source line has to survive somewhere in the output.
    #[test]
    fn no_source_line_is_dropped() {
        let md = sheet(&[
            "# Analysis 2",
            "",
            "12. Übungsblatt",
            "",
            "1. Lösen Sie das Anfangswertproblem:",
            "",
            "$",
            "y'(t) + 2y(t) = 4 \\cos(2t)",
            "$",
            "",
            "    1. Teilaufgabe eins",
            "",
            "2. Zweite Aufgabe",
        ]);

        let out = split_into_tasks(&md);

        for line in md.lines().filter(|l| !l.trim().is_empty()) {
            assert!(out.contains(line), "lost {line:?} from: {out}");
        }
    }

    // The real sequence `Analysis_2_Blatt12.pdf` produces once it has been
    // through the editor, captured by round-tripping the actual converted
    // note: `12, 13, 2, 3, 4, 5, 6, 1, 2`. The first exercise is renumbered to
    // 13 because it continues the sheet-number list; the 2..6 restart only
    // because a display equation broke that list; the trailing 1, 2 are the
    // sheet's own bonus questions.
    //
    // Two earlier rules failed here. Requiring a run starting at 1 found none
    // at all in the first shape seen, so nothing split. Allowing the longest
    // such run found the two *bonus* items and split the sheet into those.
    #[test]
    fn the_real_renumbered_blatt12_splits_into_all_of_its_exercises() {
        let md = sheet(&[
            "# Analysis 2 für Informatikstudien",
            "",
            "12. Übungsblatt",
            "",
            "13. Lösen Sie das folgende Anfangswertproblem mithilfe der Laplace-Transformation:",
            "",
            "2. Lösen Sie das folgende Anfangswertproblem mithilfe der Laplace-Transformation:",
            "",
            "3. Ein gedämpftes Schwingungssystem wird zum Zeitpunkt getroffen:",
            "",
            "4. Bestimmen Sie die Lösung des folgenden Differentialgleichungssystems:",
            "",
            "5. Bestimmen Sie die Lösung des folgenden inhomogenen Systems:",
            "",
            "6. Gegeben ist das nichtlineare System:",
            "",
            "Bonusaufgaben für schlaue Füchse:",
            "",
            "1. Finden Sie die Lösung von Beispiel 3 mit klassischen Methoden.",
            "",
            "2. Klassifizieren Sie in Beispiel 6 auch den Typ jenes Fixpunkts.",
        ]);

        let out = split_into_tasks(&md);

        // Six exercises plus the two bonus questions, which are exercises too.
        assert_eq!(out.matches("## Task").count(), 8, "got: {out}");
        assert_eq!(out.matches("### Solution").count(), 8);
        assert!(!out.contains("## Task 12"), "the sheet number: {out}");
        assert!(
            out.contains("12. Übungsblatt"),
            "kept above the first task: {out}"
        );
        // Numbered in reading order, so the first six match the paper even
        // though the markers the editor left behind do not.
        for n in 1..=8 {
            assert!(
                out.contains(&format!(
                    "## Task {n}
"
                )),
                "missing Task {n}: {out}"
            );
        }
    }

    // Nested sub-parts come back from the editor indented three spaces, not
    // four. Column-zero matching is what keeps them out either way.
    #[test]
    fn a_sub_part_indented_by_the_editor_is_still_not_a_task() {
        let md = sheet(&[
            "6. Gegeben ist das nichtlineare System:",
            "",
            "   1. Bestimmen Sie alle Fixpunkte.",
            "",
            "   2. Linearisieren Sie das System.",
            "",
            "7. Nächste Aufgabe hier",
        ]);

        let out = split_into_tasks(&md);

        assert_eq!(
            out.matches("## Task").count(),
            2,
            "sub-parts became tasks: {out}"
        );
    }

    // The fallback only drops a *leading, label-like* item. An exercise is an
    // instruction and runs to a sentence, so length is what separates them —
    // no list of title words, which would be a guess about the next document.
    #[test]
    fn the_fallback_keeps_every_item_when_the_first_is_a_real_exercise() {
        let md = sheet(&[
            "7. Berechnen Sie das Kurvenintegral über C:",
            "",
            "9. Bestimmen Sie die Lösung des Systems:",
            "",
            "11. Zeigen Sie die Konvergenz der Reihe:",
        ]);

        let out = split_into_tasks(&md);

        assert_eq!(out.matches("## Task").count(), 3, "got: {out}");
    }

    // Intact numbering still takes the precise path — a fresh import must not
    // regress to the fallback's looser judgement.
    #[test]
    fn intact_numbering_still_excludes_the_sheet_number_exactly() {
        let md = sheet(&[
            "12. Übungsblatt",
            "",
            "1. Erste Aufgabe hier",
            "",
            "2. Zweite Aufgabe hier",
            "",
            "3. Dritte Aufgabe hier",
        ]);

        let out = split_into_tasks(&md);

        assert_eq!(out.matches("## Task").count(), 3, "got: {out}");
        assert!(!out.contains("## Task 12"), "got: {out}");
    }

    // A leading item that is a real instruction is kept, however it is
    // numbered — only a short label is dropped, and only when it leads.
    #[test]
    fn a_leading_item_that_is_a_real_exercise_is_kept() {
        let md = sheet(&[
            "7. Berechnen Sie das Kurvenintegral über C:",
            "",
            "9. Bestimmen Sie die Lösung des Systems:",
            "",
            "11. Zeigen Sie die Konvergenz der Reihe:",
        ]);

        let out = split_into_tasks(&md);

        assert_eq!(out.matches("## Task").count(), 3, "got: {out}");
        assert!(out.contains("## Task 1"), "counted, not copied: {out}");
        assert!(
            !out.contains("## Task 7"),
            "the source number means nothing here: {out}"
        );
    }
}

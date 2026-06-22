use super::models::{Exercise, TextBox};
use regex::Regex;

fn is_exercise_header(text: &str) -> bool {
    let text = text.trim();
    let patterns = [
        r"(?i)^(exercise|task|problem|aufgabe)\s+\d+",
        r"^\d+\.",
        r"(?i)^(exercise|task|problem)\s+\d+\s*:",
    ];
    patterns
        .iter()
        .any(|pat| Regex::new(pat).map(|r| r.is_match(text)).unwrap_or(false))
}

pub fn parse_exercises(boxes: Vec<TextBox>) -> Vec<Exercise> {
    if boxes.is_empty() {
        return Vec::new();
    }

    let mut exercises: Vec<Exercise> = Vec::new();
    let mut current_title = String::new();
    let mut current_blocks: Vec<TextBox> = Vec::new();
    let mut found_header = false;
    let mut index = 0usize;

    for b in boxes {
        if is_exercise_header(&b.text) {
            if found_header || !current_blocks.is_empty() {
                exercises.push(Exercise {
                    index,
                    title: if current_title.is_empty() {
                        "Content".into()
                    } else {
                        current_title.clone()
                    },
                    content_blocks: std::mem::take(&mut current_blocks),
                });
                index += 1;
            }
            current_title = b.text.clone();
            found_header = true;
        } else {
            current_blocks.push(b);
        }
    }

    if found_header || !current_blocks.is_empty() {
        exercises.push(Exercise {
            index,
            title: if current_title.is_empty() {
                "Content".into()
            } else {
                current_title
            },
            content_blocks: current_blocks,
        });
    }

    exercises
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tbox(text: &str) -> TextBox {
        TextBox {
            text: text.into(),
            x: 0.0,
            y: 0.0,
            w: 1.0,
            h: 0.05,
            is_equation: false,
            latex: None,
        }
    }

    #[test]
    fn test_is_exercise_header_matches_common_patterns() {
        assert!(is_exercise_header("Exercise 1"));
        assert!(is_exercise_header("Task 2"));
        assert!(is_exercise_header("1."));
        assert!(is_exercise_header("Problem 3:"));
        assert!(!is_exercise_header("The quick brown fox"));
        assert!(!is_exercise_header("f(x) = x^2"));
    }

    #[test]
    fn test_parse_exercises_splits_on_headers() {
        let boxes = vec![
            tbox("Exercise 1"),
            tbox("Compute the integral"),
            tbox("Exercise 2"),
            tbox("Show that the series converges"),
        ];
        let exercises = parse_exercises(boxes);
        assert_eq!(exercises.len(), 2);
        assert_eq!(exercises[0].title, "Exercise 1");
        assert_eq!(exercises[1].title, "Exercise 2");
    }

    #[test]
    fn test_parse_exercises_empty_input() {
        assert!(parse_exercises(vec![]).is_empty());
    }

    #[test]
    fn test_parse_exercises_no_headers_returns_one_block() {
        let boxes = vec![tbox("Some text"), tbox("More text")];
        let exercises = parse_exercises(boxes);
        assert_eq!(exercises.len(), 1);
        assert_eq!(exercises[0].title, "Content");
    }
}

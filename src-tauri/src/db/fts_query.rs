//! Turns the search box's text into an FTS5 `MATCH` expression.
//!
//! Supports `"exact phrase"`, `a OR b`, `-term` / `-"phrase"` and `( )`
//! grouping, with implicit AND between neighbours (emitted as an explicit
//! `AND`: FTS5 rejects an implicit one in front of a parenthesised group). Every term is emitted
//! quoted, so raw user text never reaches FTS5's own syntax. Unbalanced
//! quotes or parentheses degrade to a plain prefix-AND search instead of
//! erroring.

enum Node {
    Word(String),
    Phrase(String),
    Group(Expr),
}

struct Item {
    negated: bool,
    node: Node,
}

/// OR of ANDs.
type Expr = Vec<Vec<Item>>;

#[derive(PartialEq)]
enum Kind {
    Open,
    Close,
    Or,
    Word(String),
    Phrase(String),
}

struct Tok {
    negated: bool,
    kind: Kind,
}

pub fn build_fts_query(input: &str) -> Option<String> {
    match tokenize(input).and_then(|toks| parse(&toks)) {
        Some(expr) => emit_expr(&expr),
        None => plain_query(input),
    }
}

fn plain_query(input: &str) -> Option<String> {
    let terms: Vec<String> = input
        .split_whitespace()
        .map(|w| w.replace(['"', '(', ')'], ""))
        .filter(|w| is_searchable(w))
        .map(|w| format!("\"{w}\"*"))
        .collect();
    (!terms.is_empty()).then(|| terms.join(" "))
}

fn is_searchable(text: &str) -> bool {
    text.chars().any(char::is_alphanumeric)
}

fn tokenize(input: &str) -> Option<Vec<Tok>> {
    let mut toks = Vec::new();
    let mut chars = input.chars().peekable();
    while let Some(&c) = chars.peek() {
        if c.is_whitespace() {
            chars.next();
            continue;
        }
        let mut negated = false;
        if c == '-' {
            chars.next();
            match chars.peek() {
                Some(n) if !n.is_whitespace() => negated = true,
                _ => continue,
            }
        }
        let kind = match chars.peek() {
            Some('(') => {
                chars.next();
                Kind::Open
            }
            Some(')') => {
                chars.next();
                Kind::Close
            }
            Some('"') => {
                chars.next();
                let mut phrase = String::new();
                loop {
                    match chars.next()? {
                        '"' => break,
                        ch => phrase.push(ch),
                    }
                }
                Kind::Phrase(phrase)
            }
            _ => {
                let mut word = String::new();
                while let Some(&ch) = chars.peek() {
                    if ch.is_whitespace() || matches!(ch, '(' | ')' | '"') {
                        break;
                    }
                    word.push(ch);
                    chars.next();
                }
                if word == "OR" && !negated {
                    Kind::Or
                } else {
                    Kind::Word(word)
                }
            }
        };
        toks.push(Tok { negated, kind });
    }
    Some(toks)
}

fn parse(toks: &[Tok]) -> Option<Expr> {
    let mut i = 0;
    let expr = parse_or(toks, &mut i, 0)?;
    (i == toks.len()).then_some(expr)
}

fn parse_or(toks: &[Tok], i: &mut usize, depth: usize) -> Option<Expr> {
    let mut alternatives = Vec::new();
    loop {
        let and = parse_and(toks, i, depth)?;
        if !and.is_empty() {
            alternatives.push(and);
        }
        if toks.get(*i).is_some_and(|t| t.kind == Kind::Or) {
            *i += 1;
        } else {
            return Some(alternatives);
        }
    }
}

fn parse_and(toks: &[Tok], i: &mut usize, depth: usize) -> Option<Vec<Item>> {
    let mut items = Vec::new();
    while let Some(tok) = toks.get(*i) {
        let node = match &tok.kind {
            Kind::Or => break,
            Kind::Close if depth > 0 => break,
            Kind::Close => return None,
            Kind::Open => {
                *i += 1;
                let inner = parse_or(toks, i, depth + 1)?;
                if !toks.get(*i).is_some_and(|t| t.kind == Kind::Close) {
                    return None;
                }
                Node::Group(inner)
            }
            Kind::Word(w) => Node::Word(w.clone()),
            Kind::Phrase(p) => Node::Phrase(p.clone()),
        };
        *i += 1;
        items.push(Item {
            negated: tok.negated,
            node,
        });
    }
    Some(items)
}

fn emit_expr(expr: &Expr) -> Option<String> {
    let mut alternatives: Vec<String> = expr.iter().filter_map(|and| emit_and(and)).collect();
    match alternatives.len() {
        0 => None,
        1 => alternatives.pop(),
        _ => Some(
            alternatives
                .iter()
                .map(|a| format!("({a})"))
                .collect::<Vec<_>>()
                .join(" OR "),
        ),
    }
}

/// FTS5's `NOT` is binary (`a NOT b`), so exclusions hang off the positive
/// terms. An AND with no positive term has nothing to exclude from and is
/// dropped.
fn emit_and(items: &[Item]) -> Option<String> {
    let positives: Vec<String> = items
        .iter()
        .filter(|it| !it.negated)
        .filter_map(|it| emit_node(&it.node, true))
        .collect();
    if positives.is_empty() {
        return None;
    }
    let negatives: Vec<String> = items
        .iter()
        .filter(|it| it.negated)
        .filter_map(|it| emit_node(&it.node, false))
        .collect();
    let positive = positives.join(" AND ");
    if negatives.is_empty() {
        Some(positive)
    } else {
        Some(format!("({positive}) NOT {}", negatives.join(" NOT ")))
    }
}

/// Bare words match as a prefix when they are wanted (so a half-typed word
/// still finds notes) but exactly when excluded (so a half-typed `-he` does
/// not exclude everything starting with "he").
fn emit_node(node: &Node, wanted: bool) -> Option<String> {
    match node {
        Node::Word(w) if is_searchable(w) => {
            Some(format!("\"{w}\"{}", if wanted { "*" } else { "" }))
        }
        Node::Phrase(p) if is_searchable(p) => Some(format!("\"{p}\"")),
        Node::Group(expr) => emit_expr(expr).map(|e| format!("({e})")),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::build_fts_query as build;

    #[test]
    fn test_bare_words_are_anded_prefix_terms() {
        assert_eq!(build("binary tree").unwrap(), "\"binary\"* AND \"tree\"*");
    }

    #[test]
    fn test_quoted_phrase_is_exact() {
        assert_eq!(build("\"master theorem\"").unwrap(), "\"master theorem\"");
    }

    #[test]
    fn test_or_between_terms_and_phrases() {
        assert_eq!(
            build("\"master theorem\" OR recurrence").unwrap(),
            "(\"master theorem\") OR (\"recurrence\"*)"
        );
    }

    #[test]
    fn test_lowercase_or_is_a_plain_word() {
        assert_eq!(build("a or b").unwrap(), "\"a\"* AND \"or\"* AND \"b\"*");
    }

    #[test]
    fn test_minus_excludes_word_and_phrase() {
        assert_eq!(
            build("binary tree -heap").unwrap(),
            "(\"binary\"* AND \"tree\"*) NOT \"heap\""
        );
        assert_eq!(
            build("tree -\"max heap\"").unwrap(),
            "(\"tree\"*) NOT \"max heap\""
        );
        assert_eq!(build("-heap tree").unwrap(), "(\"tree\"*) NOT \"heap\"");
    }

    #[test]
    fn test_parentheses_group() {
        assert_eq!(
            build("meeting (work OR meetup) personal").unwrap(),
            "\"meeting\"* AND ((\"work\"*) OR (\"meetup\"*)) AND \"personal\"*"
        );
    }

    #[test]
    fn test_negated_group() {
        assert_eq!(
            build("tree -(heap OR trie)").unwrap(),
            "(\"tree\"*) NOT ((\"heap\"*) OR (\"trie\"*))"
        );
    }

    #[test]
    fn test_unbalanced_input_degrades_to_plain_search() {
        assert_eq!(build("\"open phrase").unwrap(), "\"open\"* \"phrase\"*");
        assert_eq!(build("(a OR b").unwrap(), "\"a\"* \"OR\"* \"b\"*");
        assert_eq!(build("a) b").unwrap(), "\"a\"* \"b\"*");
    }

    #[test]
    fn test_dangling_operators_are_ignored() {
        assert_eq!(build("OR a OR").unwrap(), "\"a\"*");
        assert_eq!(build("a - b").unwrap(), "\"a\"* AND \"b\"*");
    }

    #[test]
    fn test_nothing_searchable_yields_none() {
        assert_eq!(build(""), None);
        assert_eq!(build("-heap"), None);
        assert_eq!(build("\"\" ()"), None);
        assert_eq!(build("?!"), None);
    }
}

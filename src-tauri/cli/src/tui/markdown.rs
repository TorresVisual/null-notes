use pulldown_cmark::{CodeBlockKind, Event, Options, Parser, Tag, TagEnd};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};

const RULE_WIDTH: usize = 40;

pub fn render(markdown: &str, selected_link: Option<usize>) -> Vec<Line<'static>> {
    run(markdown, selected_link).0
}

pub fn wiki_links(markdown: &str) -> Vec<String> {
    run(markdown, None).1
}

fn dim() -> Style {
    Style::new().add_modifier(Modifier::DIM)
}

fn run(markdown: &str, selected: Option<usize>) -> (Vec<Line<'static>>, Vec<String>) {
    let source = markdown.replace("\r\n", "\n").replace('\r', "\n");
    let mut renderer = Renderer::new(selected);
    let body = renderer.frontmatter(&source);
    let options = Options::ENABLE_TASKLISTS
        | Options::ENABLE_TABLES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_MATH;
    let mut in_table = false;
    for (event, range) in Parser::new_ext(body, options).into_offset_iter() {
        if in_table {
            in_table = !matches!(event, Event::End(TagEnd::Table));
        } else if matches!(event, Event::Start(Tag::Table(_))) {
            renderer.flush_text();
            renderer.raw_dim(&body[range]);
            renderer.end_block();
            in_table = true;
        } else {
            renderer.event(event);
        }
    }
    renderer.finish()
}

#[derive(Debug)]
struct CodeBuf {
    dim: bool,
    text: String,
}

#[derive(Debug)]
struct Renderer {
    lines: Vec<Line<'static>>,
    current: Vec<Span<'static>>,
    styles: Vec<Style>,
    text: String,
    quote_depth: usize,
    lists: Vec<Option<u64>>,
    bullet: Option<Span<'static>>,
    code: Option<CodeBuf>,
    image: Option<(String, String)>,
    link_dests: Vec<String>,
    selected: Option<usize>,
    titles: Vec<String>,
}

impl Renderer {
    fn new(selected: Option<usize>) -> Self {
        Renderer {
            lines: Vec::new(),
            current: Vec::new(),
            styles: Vec::new(),
            text: String::new(),
            quote_depth: 0,
            lists: Vec::new(),
            bullet: None,
            code: None,
            image: None,
            link_dests: Vec::new(),
            selected,
            titles: Vec::new(),
        }
    }

    fn finish(mut self) -> (Vec<Line<'static>>, Vec<String>) {
        self.flush_text();
        self.finish_line();
        while self.lines.last().is_some_and(|line| line.spans.is_empty()) {
            self.lines.pop();
        }
        (self.lines, self.titles)
    }

    fn frontmatter<'a>(&mut self, source: &'a str) -> &'a str {
        if !source.starts_with("---\n") {
            return source;
        }
        let mut end = 4;
        for line in source[4..].split_inclusive('\n') {
            end += line.len();
            if matches!(line.trim_end(), "---" | "...") {
                self.raw_dim(&source[..end]);
                self.lines.push(Line::default());
                return &source[end..];
            }
        }
        source
    }

    fn style(&self) -> Style {
        self.styles.last().copied().unwrap_or_default()
    }

    fn push_style(&mut self, style: Style) {
        self.styles.push(self.style().patch(style));
    }

    fn pop_style(&mut self) {
        self.styles.pop();
    }

    fn prefix(&mut self) -> Vec<Span<'static>> {
        let mut spans = Vec::new();
        if self.quote_depth > 0 {
            spans.push(Span::styled("│ ".repeat(self.quote_depth), dim()));
        }
        match self.bullet.take() {
            Some(bullet) => {
                let indent = "  ".repeat(self.lists.len().saturating_sub(1));
                if !indent.is_empty() {
                    spans.push(Span::raw(indent));
                }
                spans.push(bullet);
            }
            None if !self.lists.is_empty() => spans.push(Span::raw("  ".repeat(self.lists.len()))),
            None => {}
        }
        spans
    }

    fn add_span(&mut self, span: Span<'static>) {
        if self.current.is_empty() {
            let prefix = self.prefix();
            self.current.extend(prefix);
        }
        self.current.push(span);
    }

    fn finish_line(&mut self) {
        if !self.current.is_empty() {
            self.lines
                .push(Line::from(std::mem::take(&mut self.current)));
        }
    }

    fn emit_line(&mut self, span: Span<'static>) {
        self.finish_line();
        self.add_span(span);
        self.finish_line();
    }

    fn raw_dim(&mut self, text: &str) {
        self.finish_line();
        for line in text.trim_end_matches('\n').split('\n') {
            self.emit_line(Span::styled(line.to_string(), dim()));
        }
    }

    fn end_block(&mut self) {
        self.finish_line();
        if self.lists.is_empty() && self.quote_depth == 0 {
            self.lines.push(Line::default());
        }
    }

    fn flush_text(&mut self) {
        if !self.text.is_empty() {
            let text = std::mem::take(&mut self.text);
            self.inline(&text);
        }
    }

    fn event(&mut self, event: Event) {
        if let Event::Text(text) = &event {
            if let Some(code) = &mut self.code {
                code.text.push_str(text);
            } else if let Some((_, alt)) = &mut self.image {
                alt.push_str(text);
            } else {
                self.text.push_str(text);
            }
            return;
        }
        self.flush_text();
        match event {
            Event::Start(tag) => self.start(tag),
            Event::End(tag) => self.end(tag),
            Event::Code(code) => {
                let style = self.style().fg(Color::Yellow);
                self.add_span(Span::styled(code.into_string(), style));
            }
            Event::InlineMath(math) => self.add_span(Span::styled(format!("${math}$"), dim())),
            Event::DisplayMath(math) => {
                self.raw_dim(&format!("$${math}$$"));
                self.end_block();
            }
            Event::Html(html) => self.raw_dim(&html),
            Event::InlineHtml(html) => self.add_span(Span::styled(html.into_string(), dim())),
            Event::FootnoteReference(label) => {
                self.add_span(Span::styled(format!("[^{label}]"), dim()))
            }
            Event::SoftBreak => self.add_span(Span::styled(" ", self.style())),
            Event::HardBreak => self.finish_line(),
            Event::Rule => {
                self.raw_dim(&"─".repeat(RULE_WIDTH));
                self.end_block();
            }
            Event::TaskListMarker(done) => {
                self.bullet = Some(if done {
                    Span::styled("[x] ", Style::new().fg(Color::Green))
                } else {
                    Span::raw("[ ] ")
                });
            }
            Event::Text(_) => {}
        }
    }

    fn start(&mut self, tag: Tag) {
        match tag {
            Tag::Heading { .. } => {
                self.finish_line();
                self.push_style(Style::new().fg(Color::Cyan).add_modifier(Modifier::BOLD));
            }
            Tag::BlockQuote(_) => {
                self.finish_line();
                self.quote_depth += 1;
            }
            Tag::List(first) => {
                self.finish_line();
                self.lists.push(first);
            }
            Tag::Item => {
                self.finish_line();
                let marker = match self.lists.last_mut() {
                    Some(Some(n)) => {
                        let marker = format!("{n}. ");
                        *n += 1;
                        marker
                    }
                    _ => "• ".to_string(),
                };
                self.bullet = Some(Span::raw(marker));
            }
            Tag::CodeBlock(kind) => {
                self.finish_line();
                let dim = matches!(&kind, CodeBlockKind::Fenced(lang) if lang.trim() == "mermaid");
                self.code = Some(CodeBuf {
                    dim,
                    text: String::new(),
                });
            }
            Tag::Emphasis => self.push_style(Style::new().add_modifier(Modifier::ITALIC)),
            Tag::Strong => self.push_style(Style::new().add_modifier(Modifier::BOLD)),
            Tag::Strikethrough => self.push_style(Style::new().add_modifier(Modifier::CROSSED_OUT)),
            Tag::Link { dest_url, .. } => {
                self.link_dests.push(dest_url.into_string());
                self.push_style(
                    Style::new()
                        .fg(Color::Blue)
                        .add_modifier(Modifier::UNDERLINED),
                );
            }
            Tag::Image { dest_url, .. } => {
                self.image = Some((dest_url.into_string(), String::new()));
            }
            _ => {}
        }
    }

    fn end(&mut self, tag: TagEnd) {
        match tag {
            TagEnd::Paragraph => self.end_block(),
            TagEnd::Heading(_) => {
                self.pop_style();
                self.end_block();
            }
            TagEnd::BlockQuote(_) => {
                self.finish_line();
                self.quote_depth = self.quote_depth.saturating_sub(1);
                if self.quote_depth == 0 && self.lists.is_empty() {
                    self.lines.push(Line::default());
                }
            }
            TagEnd::List(_) => {
                self.lists.pop();
                self.end_block();
            }
            TagEnd::Item => self.finish_line(),
            TagEnd::CodeBlock => {
                if let Some(code) = self.code.take() {
                    let style = if code.dim {
                        dim()
                    } else {
                        Style::new().fg(Color::Green)
                    };
                    for line in code.text.trim_end_matches('\n').split('\n') {
                        self.emit_line(Span::styled(line.to_string(), style));
                    }
                }
                self.end_block();
            }
            TagEnd::Emphasis | TagEnd::Strong | TagEnd::Strikethrough => self.pop_style(),
            TagEnd::Link => {
                self.pop_style();
                if let Some(dest) = self.link_dests.pop() {
                    self.add_span(Span::styled(format!(" ({dest})"), dim()));
                }
            }
            TagEnd::Image => {
                if let Some((dest, alt)) = self.image.take() {
                    self.add_span(Span::styled(format!("![{alt}]({dest})"), dim()));
                }
            }
            _ => {}
        }
    }

    fn inline(&mut self, text: &str) {
        let base = self.style();
        let mut plain = String::new();
        let mut i = 0;
        while i < text.len() {
            let tail = &text[i..];
            if let Some((len, embed)) = bracket_span(tail) {
                let raw = &tail[..len];
                let open = if embed { 3 } else { 2 };
                let title = wiki_title(&raw[open..len - 2]);
                if embed || !title.is_empty() {
                    self.flush_plain(&mut plain, base);
                    if embed {
                        self.add_span(Span::styled(raw.to_string(), dim()));
                    } else {
                        let mut style = base.fg(Color::Cyan);
                        if self.selected == Some(self.titles.len()) {
                            style = style.add_modifier(Modifier::REVERSED);
                        }
                        self.titles.push(title.to_string());
                        self.add_span(Span::styled(raw.to_string(), style));
                    }
                    i += len;
                    continue;
                }
            }
            if let Some(len) = tag_len(text, i) {
                self.flush_plain(&mut plain, base);
                self.add_span(Span::styled(
                    tail[..len].to_string(),
                    base.fg(Color::Magenta),
                ));
                i += len;
                continue;
            }
            let Some(ch) = tail.chars().next() else { break };
            plain.push(ch);
            i += ch.len_utf8();
        }
        self.flush_plain(&mut plain, base);
    }

    fn flush_plain(&mut self, plain: &mut String, style: Style) {
        if !plain.is_empty() {
            self.add_span(Span::styled(std::mem::take(plain), style));
        }
    }
}

fn bracket_span(tail: &str) -> Option<(usize, bool)> {
    let (open, embed) = if tail.starts_with("![[") {
        (3, true)
    } else if tail.starts_with("[[") {
        (2, false)
    } else {
        return None;
    };
    let inner = tail[open..].find("]]")?;
    (inner > 0 && !tail[open..open + inner].contains('\n')).then_some((open + inner + 2, embed))
}

fn wiki_title(inner: &str) -> &str {
    let target = inner.split('|').next().unwrap_or_default();
    target.split('#').next().unwrap_or_default().trim()
}

fn tag_len(text: &str, at: usize) -> Option<usize> {
    let rest = text[at..].strip_prefix('#')?;
    let starts_word = text[..at]
        .chars()
        .next_back()
        .is_none_or(char::is_whitespace);
    let body: usize = rest
        .chars()
        .take_while(|c| c.is_alphanumeric() || matches!(c, '_' | '-' | '/'))
        .map(char::len_utf8)
        .sum();
    (starts_word && body > 0).then_some(1 + body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ratatui::style::{Color, Modifier};

    fn text(line: &Line) -> String {
        line.spans.iter().map(|s| s.content.as_ref()).collect()
    }

    fn all(lines: &[Line]) -> Vec<String> {
        lines.iter().map(text).collect()
    }

    fn span<'a>(lines: &'a [Line<'static>], content: &str) -> &'a Span<'static> {
        lines
            .iter()
            .flat_map(|l| l.spans.iter())
            .find(|s| s.content == content)
            .unwrap_or_else(|| panic!("no span {content:?} in {:?}", all(lines)))
    }

    fn has(span: &Span, modifier: Modifier) -> bool {
        span.style.add_modifier.contains(modifier)
    }

    #[test]
    fn heading_is_bold() {
        let lines = render("# Title\n\nbody", None);
        assert!(has(span(&lines, "Title"), Modifier::BOLD));
        assert!(!has(span(&lines, "body"), Modifier::BOLD));
    }

    #[test]
    fn wiki_link_is_highlighted_and_selected_one_is_reversed() {
        let lines = render("see [[Foo]] and [[Bar]]", Some(1));
        let foo = span(&lines, "[[Foo]]");
        assert_eq!(foo.style.fg, Some(Color::Cyan));
        assert!(!has(foo, Modifier::REVERSED));
        assert!(has(span(&lines, "[[Bar]]"), Modifier::REVERSED));
    }

    #[test]
    fn wiki_links_lists_titles_stripping_alias_and_heading() {
        let md = "[[A|alias]] then [[B#Heading]] and [[ C ]] but not `[[D]]`";
        assert_eq!(wiki_links(md), ["A", "B", "C"]);
    }

    #[test]
    fn tags_are_highlighted() {
        let lines = render("a #cs101/os b", None);
        assert_eq!(span(&lines, "#cs101/os").style.fg, Some(Color::Magenta));
    }

    #[test]
    fn task_items_keep_their_checkbox() {
        let lines = render("- [ ] open\n- [x] done", None);
        assert_eq!(all(&lines), ["[ ] open", "[x] done"]);
    }

    #[test]
    fn lists_quotes_and_rules_render_markers() {
        let lines = render("- a\n  - b\n\n1. one\n\n> quoted\n\n---", None);
        let rows = all(&lines);
        assert!(rows.contains(&"• a".to_string()), "{rows:?}");
        assert!(rows.contains(&"  • b".to_string()), "{rows:?}");
        assert!(rows.contains(&"1. one".to_string()), "{rows:?}");
        assert!(rows.contains(&"│ quoted".to_string()), "{rows:?}");
        assert!(rows.iter().any(|r| r.starts_with('─')), "{rows:?}");
    }

    #[test]
    fn emphasis_and_code_are_styled() {
        let lines = render("*it* **b** `c`\n\n```rust\nlet x = 1;\n```", None);
        assert!(has(span(&lines, "it"), Modifier::ITALIC));
        assert!(has(span(&lines, "b"), Modifier::BOLD));
        assert_eq!(span(&lines, "c").style.fg, Some(Color::Yellow));
        assert!(all(&lines).contains(&"let x = 1;".to_string()));
    }

    #[test]
    fn frontmatter_renders_dim_and_first() {
        let lines = render("---\ntitle: x\n---\n# H", None);
        assert_eq!(text(&lines[0]), "---");
        assert!(has(span(&lines, "title: x"), Modifier::DIM));
        assert!(all(&lines).contains(&"H".to_string()));
        assert!(wiki_links("---\ntitle: [[X]]\n---\n").is_empty());
    }

    #[test]
    fn maths_mermaid_and_embeds_fall_back_to_dim_raw() {
        let md = "$$\nx^2\n$$\n\n```mermaid\ngraph TD\n```\n\n![[img.png]]\n\n| a | b |\n|---|---|\n| 1 | 2 |";
        let lines = render(md, None);
        let rows = all(&lines);
        for raw in ["x^2", "graph TD", "![[img.png]]", "| a | b |", "|---|---|"] {
            assert!(
                rows.iter().any(|r| r.contains(raw)),
                "{raw} missing in {rows:?}"
            );
            assert!(
                has(span_containing(&lines, raw), Modifier::DIM),
                "{raw} not dim"
            );
        }
    }

    fn span_containing<'a>(lines: &'a [Line<'static>], needle: &str) -> &'a Span<'static> {
        lines
            .iter()
            .flat_map(|l| l.spans.iter())
            .find(|s| s.content.contains(needle))
            .unwrap_or_else(|| panic!("no span with {needle:?}"))
    }

    #[test]
    fn crlf_input_has_no_stray_carriage_returns() {
        let lines = render("a\r\nb\r\n\r\nc\r\n", None);
        assert!(lines.iter().all(|l| !text(l).contains('\r')));
        assert_eq!(all(&lines), ["a b", "", "c"]);
    }

    #[test]
    fn cjk_emoji_and_combining_marks_pass_through_whole() {
        let sample = "日本語 🙂 e\u{301} 😀 ñ";
        let lines = render(sample, None);
        assert_eq!(all(&lines), [sample]);
    }

    #[test]
    fn a_5000_char_line_does_not_panic() {
        let long = "é".repeat(5000);
        let lines = render(&format!("{long} [[X]] #t {long}"), Some(0));
        assert_eq!(lines.len(), 1);
    }

    #[test]
    fn empty_input_gives_no_lines() {
        assert!(render("", None).is_empty());
        assert!(render("\n\n", None).is_empty());
    }
}

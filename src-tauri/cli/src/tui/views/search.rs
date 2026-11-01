use crate::tui::effects::{Job, Reply, Slot};
use crate::tui::model::{Action, SEARCH_DEBOUNCE};
use crate::tui::query;
use crate::tui::wire::{decode, SearchHit, SearchPage};
use ratatui::crossterm::event::{KeyCode, KeyEvent};
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span, Text};
use ratatui::widgets::{List, ListItem, ListState, Paragraph};
use ratatui::Frame;
use std::time::Instant;

const PAGE: i64 = 20;

#[derive(Debug, Default)]
pub struct SearchState {
    query: String,
    edited_at: Option<Instant>,
    results: Vec<SearchHit>,
    total: i64,
    offset: i64,
    selected: usize,
    searched: bool,
}

impl SearchState {
    pub fn query(&self) -> &str {
        &self.query
    }

    pub fn set_query(&mut self, text: &str, now: Instant) {
        if text == self.query {
            return;
        }
        self.query = text.to_string();
        self.offset = 0;
        if query::parse(text) == query::SearchQuery::default() {
            self.edited_at = None;
            self.results.clear();
            self.total = 0;
            self.searched = false;
        } else {
            self.edited_at = Some(now);
        }
    }

    pub fn tick(&mut self, now: Instant) -> Vec<Action> {
        match self.edited_at {
            Some(edited) if now.saturating_duration_since(edited) >= SEARCH_DEBOUNCE => {
                self.edited_at = None;
                self.request()
            }
            _ => Vec::new(),
        }
    }

    pub fn enter(&mut self) -> Vec<Action> {
        self.edited_at = None;
        if self.query.trim().is_empty() {
            return Vec::new();
        }
        self.request()
    }

    fn request(&self) -> Vec<Action> {
        vec![Action::Send(Job {
            slot: Slot::Search,
            command: "search",
            args: query::parse(&self.query).args(self.offset),
        })]
    }

    pub fn key(&mut self, key: KeyEvent) -> Vec<Action> {
        match key.code {
            KeyCode::Down | KeyCode::Char('j') => {
                self.selected = (self.selected + 1).min(self.results.len().saturating_sub(1));
                Vec::new()
            }
            KeyCode::Up | KeyCode::Char('k') => {
                self.selected = self.selected.saturating_sub(1);
                Vec::new()
            }
            KeyCode::Char('n') if self.offset + PAGE < self.total => {
                self.offset += PAGE;
                self.request()
            }
            KeyCode::Char('p') if self.offset > 0 => {
                self.offset = (self.offset - PAGE).max(0);
                self.request()
            }
            KeyCode::Enter => match self.results.get(self.selected) {
                Some(hit) => vec![Action::OpenNote(hit.path.clone())],
                None => Vec::new(),
            },
            _ => Vec::new(),
        }
    }

    pub fn reply(&mut self, reply: Reply) -> Vec<Action> {
        if reply.slot != Slot::Search {
            return Vec::new();
        }
        let Ok(value) = reply.result else {
            return Vec::new();
        };
        match decode::<SearchPage>(value) {
            Ok(page) => {
                self.results = page.results;
                self.total = page.total;
                self.selected = 0;
                self.searched = true;
                Vec::new()
            }
            Err(message) => vec![Action::Status(message)],
        }
    }

    pub fn focused_note(&self) -> Option<String> {
        self.results.get(self.selected).map(|hit| hit.path.clone())
    }

    pub fn render(&self, frame: &mut Frame, area: Rect) {
        let [head, body, foot] = Layout::vertical([
            Constraint::Length(1),
            Constraint::Min(0),
            Constraint::Length(1),
        ])
        .areas(area);

        let shown = if self.query.is_empty() {
            Span::styled("press / to search", dim())
        } else {
            Span::raw(self.query.as_str())
        };
        frame.render_widget(Line::from(vec![Span::raw("/ "), shown]), head);

        if self.results.is_empty() {
            let message = match (self.query.trim().is_empty(), self.searched) {
                (true, _) => "Filters: tag:name  folder:path  block:code — then free text",
                (false, true) => "No results",
                (false, false) => "Searching…",
            };
            frame.render_widget(Paragraph::new(message), body);
            return;
        }

        let items: Vec<ListItem> = self
            .results
            .iter()
            .map(|hit| {
                let snippet = hit.snippet.split_whitespace().collect::<Vec<_>>().join(" ");
                ListItem::new(Text::from(vec![
                    Line::from(vec![
                        Span::styled(hit.title.clone(), Style::new().add_modifier(Modifier::BOLD)),
                        Span::styled(format!("  {}", hit.path), dim()),
                    ]),
                    Line::styled(snippet, dim()),
                ]))
            })
            .collect();
        let list = List::new(items).highlight_style(Style::new().add_modifier(Modifier::REVERSED));
        let mut state = ListState::default().with_selected(Some(self.selected));
        frame.render_stateful_widget(list, body, &mut state);

        let last = (self.offset + self.results.len() as i64).min(self.total);
        let paging = format!("{}–{} of {}  n/p page", self.offset + 1, last, self.total);
        frame.render_widget(Line::styled(paging, dim()), foot);
    }
}

fn dim() -> Style {
    Style::new().add_modifier(Modifier::DIM)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::ClientError;
    use crate::tui::effects::Worker;
    use ratatui::backend::TestBackend;
    use ratatui::crossterm::event::{KeyCode, KeyModifiers};
    use ratatui::Terminal;
    use serde_json::json;
    use std::sync::mpsc;
    use std::time::Duration;

    fn hit(path: &str, title: &str, snippet: &str) -> serde_json::Value {
        json!({"path": path, "title": title, "workspace": "W", "updatedAt": 1, "snippet": snippet})
    }

    fn page(hits: Vec<serde_json::Value>, total: i64) -> Reply {
        Reply {
            slot: Slot::Search,
            id: 1,
            command: "search",
            args: serde_json::Value::Null,
            result: Ok(json!({ "results": hits, "total": total })),
        }
    }

    fn sends(actions: &[Action]) -> Vec<serde_json::Value> {
        actions
            .iter()
            .filter_map(|a| match a {
                Action::Send(job) if job.slot == Slot::Search && job.command == "search" => {
                    Some(job.args.clone())
                }
                _ => None,
            })
            .collect()
    }

    fn press(state: &mut SearchState, code: KeyCode) -> Vec<Action> {
        state.key(KeyEvent::new(code, KeyModifiers::NONE))
    }

    fn draw(state: &SearchState, width: u16, height: u16) -> String {
        let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
        terminal
            .draw(|frame| state.render(frame, frame.area()))
            .unwrap();
        let buffer = terminal.backend().buffer();
        (0..height)
            .map(|y| {
                (0..width)
                    .map(|x| buffer[(x, y)].symbol())
                    .collect::<String>()
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    const MS: fn(u64) -> Duration = Duration::from_millis;

    #[test]
    fn no_job_before_the_debounce_and_one_job_after() {
        let t0 = Instant::now();
        let mut state = SearchState::default();
        state.set_query("foo", t0);
        assert!(state.tick(t0 + SEARCH_DEBOUNCE - MS(1)).is_empty());
        assert_eq!(
            sends(&state.tick(t0 + SEARCH_DEBOUNCE)),
            [json!({"query": "foo"})]
        );
        assert!(state.tick(t0 + SEARCH_DEBOUNCE * 2).is_empty());
    }

    #[test]
    fn an_edit_restarts_the_debounce() {
        let t0 = Instant::now();
        let mut state = SearchState::default();
        state.set_query("a", t0);
        state.set_query("ab", t0 + MS(100));
        assert!(state.tick(t0 + MS(200)).is_empty());
        assert_eq!(sends(&state.tick(t0 + MS(250))), [json!({"query": "ab"})]);
    }

    #[test]
    fn setting_the_same_text_does_not_restart_the_debounce() {
        let t0 = Instant::now();
        let mut state = SearchState::default();
        state.set_query("a", t0);
        state.set_query("a", t0 + MS(100));
        assert_eq!(sends(&state.tick(t0 + MS(150))).len(), 1);
    }

    #[test]
    fn filters_are_sent_as_args() {
        let t0 = Instant::now();
        let mut state = SearchState::default();
        state.set_query("tag:x foo", t0);
        let args = sends(&state.tick(t0 + SEARCH_DEBOUNCE));
        assert_eq!(args, [json!({"query": "foo", "tag": "x"})]);
    }

    #[test]
    fn a_stale_reply_is_not_applied() {
        let call: crate::tui::effects::Call = Box::new(|_, args| {
            let query = args["query"].as_str().unwrap_or_default().to_string();
            Ok(json!({"results": [hit("p.md", &query, "")], "total": 1}))
        });
        let (tx, rx) = mpsc::channel();
        let mut worker = Worker::spawn(call, tx);
        let t0 = Instant::now();
        let mut state = SearchState::default();
        for (n, text) in ["first", "second"].into_iter().enumerate() {
            state.set_query(text, t0 + MS(n as u64 * 1000));
            for action in state.tick(t0 + MS(n as u64 * 1000) + SEARCH_DEBOUNCE) {
                if let Action::Send(job) = action {
                    worker.submit(job);
                }
            }
        }
        for _ in 0..2 {
            let reply = rx.recv_timeout(Duration::from_secs(5)).unwrap();
            if worker.is_current(&reply) {
                state.reply(reply);
            }
        }
        assert_eq!(state.results.len(), 1);
        assert_eq!(state.results[0].title, "second");
    }

    #[test]
    fn paging_uses_offset_in_steps_of_20_and_clamps() {
        let mut state = SearchState::default();
        state.set_query("x", Instant::now());
        state.reply(page(vec![hit("a.md", "A", "")], 45));
        assert_eq!(
            sends(&press(&mut state, KeyCode::Char('n'))),
            [json!({"query": "x", "offset": 20})]
        );
        state.reply(page(vec![hit("a.md", "A", "")], 45));
        assert_eq!(
            sends(&press(&mut state, KeyCode::Char('n'))),
            [json!({"query": "x", "offset": 40})]
        );
        state.reply(page(vec![hit("a.md", "A", "")], 45));
        assert!(press(&mut state, KeyCode::Char('n')).is_empty());
        assert_eq!(
            sends(&press(&mut state, KeyCode::Char('p'))),
            [json!({"query": "x", "offset": 20})]
        );
        assert_eq!(
            sends(&press(&mut state, KeyCode::Char('p'))),
            [json!({"query": "x"})]
        );
        assert!(press(&mut state, KeyCode::Char('p')).is_empty());
    }

    #[test]
    fn enter_opens_the_hit() {
        let mut state = SearchState::default();
        state.set_query("x", Instant::now());
        state.reply(page(vec![hit("a.md", "A", ""), hit("b/c.md", "C", "")], 2));
        press(&mut state, KeyCode::Char('j'));
        press(&mut state, KeyCode::Char('j'));
        let actions = press(&mut state, KeyCode::Enter);
        assert!(matches!(&actions[..], [Action::OpenNote(p)] if p == "b/c.md"));
        assert_eq!(state.focused_note().as_deref(), Some("b/c.md"));
    }

    #[test]
    fn empty_query_clears_results_without_a_job() {
        let t0 = Instant::now();
        let mut state = SearchState::default();
        state.set_query("x", t0);
        state.reply(page(vec![hit("a.md", "A", "")], 1));
        state.set_query("  ", t0 + MS(10));
        assert!(state.results.is_empty());
        assert!(state.tick(t0 + MS(500)).is_empty());
    }

    #[test]
    fn enter_reruns_a_non_empty_query_immediately() {
        let mut state = SearchState::default();
        assert!(state.enter().is_empty());
        state.set_query("x", Instant::now());
        assert_eq!(sends(&state.enter()), [json!({"query": "x"})]);
    }

    #[test]
    fn zero_results_render_a_message() {
        let mut state = SearchState::default();
        state.set_query("nothing", Instant::now());
        state.reply(page(vec![], 0));
        assert!(draw(&state, 80, 10).contains("No results"));
    }

    #[test]
    fn an_idle_search_explains_the_filters() {
        assert!(draw(&SearchState::default(), 80, 10).contains("tag:"));
    }

    #[test]
    fn a_failed_search_keeps_the_previous_results() {
        let mut state = SearchState::default();
        state.set_query("x", Instant::now());
        state.reply(page(vec![hit("a.md", "Alpha", "")], 1));
        let mut failed = page(vec![], 0);
        failed.result = Err(ClientError::Unreachable("boom".into()));
        state.reply(failed);
        assert_eq!(state.results.len(), 1);
    }

    #[test]
    fn unicode_snippets_render_without_panic() {
        let mut state = SearchState::default();
        let snippet = "…日本語 [[🙂]] e\u{301}\nnewline ".repeat(30);
        state.set_query("日本", Instant::now());
        state.reply(page(vec![hit("a.md", &"笔记".repeat(50), &snippet)], 1));
        for (w, h) in [(80, 24), (20, 5), (1, 1)] {
            draw(&state, w, h);
        }
    }
}

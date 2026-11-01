use crate::exit::message_for;
use crate::tui::effects::{Job, Reply, Slot};
use crate::tui::markdown;
use crate::tui::model::Action;
use crate::tui::tree::{self, Row};
use crate::tui::view::NARROW_COLS;
use crate::tui::wire::{decode, Backlink, NoteMeta};
use ratatui::crossterm::event::{KeyCode, KeyEvent};
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, List, ListItem, ListState, Paragraph, Wrap};
use ratatui::Frame;
use serde_json::{json, Value};
use std::collections::HashSet;

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
enum Focus {
    #[default]
    List,
    Preview,
    Backlinks,
}

#[derive(Debug, Default)]
pub struct NotesState {
    notes: Vec<NoteMeta>,
    expanded: HashSet<String>,
    rows: Vec<Row>,
    selected: usize,
    loaded: bool,
    focus: Focus,
    preview_path: Option<String>,
    content: Option<String>,
    error: Option<String>,
    scroll: u16,
    link: Option<usize>,
    backlinks: Vec<Backlink>,
    backlink_selected: usize,
    pending_open: Option<String>,
}

fn send(slot: Slot, command: &'static str, args: Value) -> Action {
    Action::Send(Job {
        slot,
        command,
        args,
    })
}

impl NotesState {
    pub fn enter(&mut self) -> Vec<Action> {
        vec![send(Slot::Notes, "note.list", Value::Null)]
    }

    pub fn open(&mut self, path: String) -> Vec<Action> {
        if self.reveal(&path) {
            self.focus = Focus::Preview;
            return self.load_selected();
        }
        self.pending_open = Some(path);
        self.enter()
    }

    pub fn refresh(&mut self, path: &str) -> Vec<Action> {
        if self.preview_path.as_deref() != Some(path) {
            return Vec::new();
        }
        vec![send(Slot::Preview, "note.read", json!({ "path": path }))]
    }

    pub fn focused_note(&self) -> Option<String> {
        match self.rows.get(self.selected) {
            Some(Row::Note { path, .. }) => Some(path.clone()),
            _ => None,
        }
    }

    pub fn reply(&mut self, reply: Reply) -> Vec<Action> {
        let value = match reply.result {
            Ok(value) => value,
            Err(error) => {
                if reply.slot == Slot::Preview {
                    self.content = None;
                    self.error = Some(message_for(&error));
                }
                return Vec::new();
            }
        };
        match reply.slot {
            Slot::Notes => match decode::<Vec<NoteMeta>>(value) {
                Ok(notes) => self.on_list(notes),
                Err(message) => vec![Action::Status(message)],
            },
            Slot::Preview => match decode::<String>(value) {
                Ok(text) => {
                    self.content = Some(text);
                    self.error = None;
                    Vec::new()
                }
                Err(message) => vec![Action::Status(message)],
            },
            Slot::Backlinks => match decode::<Vec<Backlink>>(value) {
                Ok(backlinks) => {
                    self.backlinks = backlinks;
                    self.backlink_selected = 0;
                    Vec::new()
                }
                Err(message) => vec![Action::Status(message)],
            },
            _ => Vec::new(),
        }
    }

    fn on_list(&mut self, notes: Vec<NoteMeta>) -> Vec<Action> {
        let kept = self.selected_path();
        self.notes = notes;
        self.loaded = true;
        self.rebuild();
        self.selected = kept
            .and_then(|path| self.row_index(&path))
            .unwrap_or_else(|| self.selected.min(self.rows.len().saturating_sub(1)));
        if let Some(path) = self.pending_open.take() {
            if self.reveal(&path) {
                self.focus = Focus::Preview;
                return self.load_selected();
            }
            return vec![Action::Status(format!("no such note: {path}"))];
        }
        if self.focused_note() != self.preview_path {
            return self.load_selected();
        }
        Vec::new()
    }

    fn rebuild(&mut self) {
        self.rows = tree::build(&self.notes, &self.expanded);
    }

    fn selected_path(&self) -> Option<String> {
        self.rows.get(self.selected).map(|row| match row {
            Row::Folder { path, .. } | Row::Note { path, .. } => path.clone(),
        })
    }

    fn row_index(&self, wanted: &str) -> Option<usize> {
        self.rows.iter().position(|row| match row {
            Row::Folder { path, .. } | Row::Note { path, .. } => path == wanted,
        })
    }

    fn reveal(&mut self, path: &str) -> bool {
        if !self.notes.iter().any(|note| note.path == path) {
            return false;
        }
        let mut prefix = String::new();
        let mut parts = path.split('/').peekable();
        while let Some(part) = parts.next() {
            if parts.peek().is_none() {
                break;
            }
            if !prefix.is_empty() {
                prefix.push('/');
            }
            prefix.push_str(part);
            self.expanded.insert(prefix.clone());
        }
        self.rebuild();
        match self.row_index(path) {
            Some(index) => {
                self.selected = index;
                true
            }
            None => false,
        }
    }

    fn load_selected(&mut self) -> Vec<Action> {
        let Some(path) = self.focused_note() else {
            return Vec::new();
        };
        let title = self
            .notes
            .iter()
            .find(|note| note.path == path)
            .map(|note| note.title.clone())
            .unwrap_or_default();
        self.preview_path = Some(path.clone());
        self.content = None;
        self.error = None;
        self.scroll = 0;
        self.link = None;
        self.backlinks.clear();
        self.backlink_selected = 0;
        vec![
            send(Slot::Preview, "note.read", json!({ "path": path })),
            send(Slot::Backlinks, "backlinks", json!({ "title": title })),
        ]
    }

    pub fn key(&mut self, key: KeyEvent) -> Vec<Action> {
        match key.code {
            KeyCode::Tab => {
                self.focus = match self.focus {
                    Focus::List => Focus::Preview,
                    Focus::Preview => Focus::Backlinks,
                    Focus::Backlinks => Focus::List,
                };
                Vec::new()
            }
            KeyCode::Esc => {
                self.focus = Focus::List;
                Vec::new()
            }
            _ => match self.focus {
                Focus::List => self.list_key(key.code),
                Focus::Preview => self.preview_key(key.code),
                Focus::Backlinks => self.backlinks_key(key.code),
            },
        }
    }

    fn list_key(&mut self, code: KeyCode) -> Vec<Action> {
        match code {
            KeyCode::Down | KeyCode::Char('j') => self.move_selection(1),
            KeyCode::Up | KeyCode::Char('k') => self.move_selection(-1),
            KeyCode::Enter | KeyCode::Right | KeyCode::Char('l') => {
                match self.rows.get(self.selected) {
                    Some(Row::Folder { path, open, .. }) => {
                        let (path, open) = (path.clone(), *open);
                        self.set_folder(&path, !open);
                        Vec::new()
                    }
                    Some(Row::Note { .. }) if code == KeyCode::Enter => {
                        self.focus = Focus::Preview;
                        Vec::new()
                    }
                    _ => Vec::new(),
                }
            }
            KeyCode::Left | KeyCode::Char('h') => {
                if let Some(Row::Folder {
                    path, open: true, ..
                }) = self.rows.get(self.selected)
                {
                    let path = path.clone();
                    self.set_folder(&path, false);
                }
                Vec::new()
            }
            _ => Vec::new(),
        }
    }

    fn set_folder(&mut self, path: &str, open: bool) {
        if open {
            self.expanded.insert(path.to_string());
        } else {
            self.expanded.remove(path);
        }
        self.rebuild();
        self.selected = self.row_index(path).unwrap_or(0);
    }

    fn move_selection(&mut self, delta: isize) -> Vec<Action> {
        let last = self.rows.len().saturating_sub(1);
        let next = self.selected.saturating_add_signed(delta).min(last);
        if next == self.selected {
            return Vec::new();
        }
        self.selected = next;
        self.load_selected()
    }

    fn preview_key(&mut self, code: KeyCode) -> Vec<Action> {
        let Some(content) = &self.content else {
            return Vec::new();
        };
        match code {
            KeyCode::Down | KeyCode::Char('j') => {
                let last = markdown::render(content, None).len().saturating_sub(1);
                self.scroll = (self.scroll as usize + 1).min(last).min(u16::MAX as usize) as u16;
                Vec::new()
            }
            KeyCode::Up | KeyCode::Char('k') => {
                self.scroll = self.scroll.saturating_sub(1);
                Vec::new()
            }
            KeyCode::Char('n') => {
                let count = markdown::wiki_links(content).len();
                self.link = match self.link {
                    _ if count == 0 => None,
                    None => Some(0),
                    Some(i) => Some((i + 1).min(count - 1)),
                };
                Vec::new()
            }
            KeyCode::Char('p') => {
                let count = markdown::wiki_links(content).len();
                self.link = match self.link {
                    _ if count == 0 => None,
                    None => Some(count - 1),
                    Some(i) => Some(i.saturating_sub(1)),
                };
                Vec::new()
            }
            KeyCode::Enter => self.follow_link(),
            _ => Vec::new(),
        }
    }

    fn follow_link(&mut self) -> Vec<Action> {
        let Some(title) = self
            .content
            .as_deref()
            .zip(self.link)
            .and_then(|(content, index)| markdown::wiki_links(content).into_iter().nth(index))
        else {
            return Vec::new();
        };
        let found = self
            .notes
            .iter()
            .find(|note| note.title.to_lowercase() == title.to_lowercase())
            .map(|note| note.path.clone());
        match found {
            Some(path) => self.open(path),
            None => vec![Action::Status(format!("no such note: {title}"))],
        }
    }

    fn backlinks_key(&mut self, code: KeyCode) -> Vec<Action> {
        match code {
            KeyCode::Down | KeyCode::Char('j') => {
                let last = self.backlinks.len().saturating_sub(1);
                self.backlink_selected = (self.backlink_selected + 1).min(last);
                Vec::new()
            }
            KeyCode::Up | KeyCode::Char('k') => {
                self.backlink_selected = self.backlink_selected.saturating_sub(1);
                Vec::new()
            }
            KeyCode::Enter => match self.backlinks.get(self.backlink_selected) {
                Some(backlink) => {
                    let path = backlink.note.path.clone();
                    self.open(path)
                }
                None => Vec::new(),
            },
            _ => Vec::new(),
        }
    }

    pub fn render(&self, frame: &mut Frame, area: Rect) {
        let narrow = area.width < NARROW_COLS;
        if narrow {
            if self.focus == Focus::List {
                self.render_list(frame, area);
            } else {
                self.render_reader(frame, area);
            }
            return;
        }
        let [list, reader] =
            Layout::horizontal([Constraint::Percentage(35), Constraint::Percentage(65)])
                .areas(area);
        self.render_list(frame, list);
        self.render_reader(frame, reader);
    }

    fn pane(&self, title: String, focus: Focus) -> Block<'static> {
        let style = if self.focus == focus {
            Style::new().fg(Color::Cyan)
        } else {
            Style::new().add_modifier(Modifier::DIM)
        };
        Block::bordered().title(title).border_style(style)
    }

    fn render_list(&self, frame: &mut Frame, area: Rect) {
        let block = self.pane("Notes".to_string(), Focus::List);
        if self.rows.is_empty() {
            let message = if self.loaded {
                "No notes yet — press c to create one"
            } else {
                "Loading notes…"
            };
            frame.render_widget(Paragraph::new(message).block(block), area);
            return;
        }
        let items: Vec<ListItem> = self
            .rows
            .iter()
            .map(|row| match row {
                Row::Folder {
                    name, depth, open, ..
                } => {
                    let arrow = if *open { "▾" } else { "▸" };
                    ListItem::new(format!("{}{arrow} {name}/", "  ".repeat(*depth)))
                }
                Row::Note { title, depth, .. } => {
                    ListItem::new(format!("{}  {title}", "  ".repeat(*depth)))
                }
            })
            .collect();
        let highlight = if self.focus == Focus::List {
            Modifier::REVERSED
        } else {
            Modifier::BOLD
        };
        let list = List::new(items)
            .block(block)
            .highlight_style(Style::new().add_modifier(highlight));
        let mut state = ListState::default().with_selected(Some(self.selected));
        frame.render_stateful_widget(list, area, &mut state);
    }

    fn render_reader(&self, frame: &mut Frame, area: Rect) {
        let backlink_rows = (self.backlinks.len().max(1) as u16)
            .saturating_add(2)
            .min(8);
        let [preview, backlinks] =
            Layout::vertical([Constraint::Min(0), Constraint::Length(backlink_rows)]).areas(area);
        self.render_preview(frame, preview);
        self.render_backlinks(frame, backlinks);
    }

    fn render_preview(&self, frame: &mut Frame, area: Rect) {
        let title = self
            .preview_path
            .clone()
            .unwrap_or_else(|| "Preview".to_string());
        let block = self.pane(title, Focus::Preview);
        let body: Vec<Line> = match (&self.content, &self.error) {
            (Some(content), _) => markdown::render(content, self.link),
            (None, Some(error)) => vec![Line::styled(error.clone(), Style::new().fg(Color::Red))],
            (None, None) if self.preview_path.is_some() => vec![Line::from("Loading…")],
            (None, None) => vec![Line::from("Select a note to preview it")],
        };
        let paragraph = Paragraph::new(body)
            .block(block)
            .wrap(Wrap { trim: false })
            .scroll((self.scroll, 0));
        frame.render_widget(paragraph, area);
    }

    fn render_backlinks(&self, frame: &mut Frame, area: Rect) {
        let block = self.pane(
            format!("Backlinks ({})", self.backlinks.len()),
            Focus::Backlinks,
        );
        if self.backlinks.is_empty() {
            frame.render_widget(Paragraph::new("No backlinks").block(block), area);
            return;
        }
        let items: Vec<ListItem> = self
            .backlinks
            .iter()
            .map(|backlink| {
                let mut spans = vec![Span::raw(backlink.note.title.clone())];
                if let Some(snippet) = &backlink.snippet {
                    spans.push(Span::styled(
                        format!(" — {}", snippet.trim()),
                        Style::new().add_modifier(Modifier::DIM),
                    ));
                }
                ListItem::new(Line::from(spans))
            })
            .collect();
        let highlight = if self.focus == Focus::Backlinks {
            Modifier::REVERSED
        } else {
            Modifier::empty()
        };
        let list = List::new(items)
            .block(block)
            .highlight_style(Style::new().add_modifier(highlight));
        let mut state = ListState::default().with_selected(Some(self.backlink_selected));
        frame.render_stateful_widget(list, area, &mut state);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::ClientError;
    use crate::protocol::{ErrorBody, ErrorCode};
    use ratatui::backend::TestBackend;
    use ratatui::crossterm::event::{KeyCode, KeyModifiers};
    use ratatui::Terminal;
    use serde_json::json;

    fn meta(path: &str, title: &str) -> serde_json::Value {
        json!({"id": path, "title": title, "path": path, "workspace": "W", "updatedAt": 1})
    }

    fn reply(slot: Slot, result: Result<serde_json::Value, ClientError>) -> Reply {
        Reply {
            slot,
            id: 1,
            command: "x",
            args: serde_json::Value::Null,
            result,
        }
    }

    fn loaded(notes: &[(&str, &str)]) -> (NotesState, Vec<Action>) {
        let mut state = NotesState::default();
        let list: Vec<_> = notes.iter().map(|(p, t)| meta(p, t)).collect();
        let actions = state.reply(reply(Slot::Notes, Ok(json!(list))));
        (state, actions)
    }

    fn press(state: &mut NotesState, code: KeyCode) -> Vec<Action> {
        state.key(KeyEvent::new(code, KeyModifiers::NONE))
    }

    fn sends(actions: &[Action]) -> Vec<(Slot, &'static str, serde_json::Value)> {
        actions
            .iter()
            .filter_map(|a| match a {
                Action::Send(job) => Some((job.slot, job.command, job.args.clone())),
                _ => None,
            })
            .collect()
    }

    fn draw(state: &NotesState, width: u16, height: u16) -> String {
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

    fn with_content(state: &mut NotesState, text: &str) {
        state.reply(reply(Slot::Preview, Ok(json!(text))));
    }

    #[test]
    fn enter_requests_the_note_list() {
        let actions = NotesState::default().enter();
        assert_eq!(sends(&actions), [(Slot::Notes, "note.list", json!(null))]);
    }

    #[test]
    fn selecting_a_note_requests_read_and_backlinks_with_its_title() {
        let (mut state, first) = loaded(&[("a.md", "Alpha"), ("b.md", "Beta")]);
        assert_eq!(
            sends(&first),
            [
                (Slot::Preview, "note.read", json!({"path": "a.md"})),
                (Slot::Backlinks, "backlinks", json!({"title": "Alpha"})),
            ]
        );
        let moved = press(&mut state, KeyCode::Char('j'));
        assert_eq!(
            sends(&moved),
            [
                (Slot::Preview, "note.read", json!({"path": "b.md"})),
                (Slot::Backlinks, "backlinks", json!({"title": "Beta"})),
            ]
        );
    }

    #[test]
    fn moving_the_selection_twice_makes_the_first_preview_stale() {
        let (mut state, _) = loaded(&[("a.md", "A"), ("b.md", "B"), ("c.md", "C")]);
        let first = press(&mut state, KeyCode::Char('j'));
        let second = press(&mut state, KeyCode::Char('j'));
        let previews: Vec<_> = sends(&first)
            .into_iter()
            .chain(sends(&second))
            .filter(|(slot, ..)| *slot == Slot::Preview)
            .collect();
        assert_eq!(previews.len(), 2);
        assert_ne!(previews[0].2, previews[1].2);
    }

    #[test]
    fn open_expands_ancestors_and_selects() {
        let (mut state, _) = loaded(&[("top.md", "Top"), ("x/y/z.md", "Zed")]);
        let actions = state.open("x/y/z.md".into());
        assert_eq!(state.focused_note().as_deref(), Some("x/y/z.md"));
        assert!(state.expanded.contains("x") && state.expanded.contains("x/y"));
        assert_eq!(sends(&actions)[0].2, json!({"path": "x/y/z.md"}));
    }

    #[test]
    fn open_before_the_list_is_loaded_refetches_and_then_selects() {
        let mut state = NotesState::default();
        let actions = state.open("a.md".into());
        assert_eq!(sends(&actions)[0].1, "note.list");
        let after = state.reply(reply(Slot::Notes, Ok(json!([meta("a.md", "A")]))));
        assert_eq!(state.focused_note().as_deref(), Some("a.md"));
        assert_eq!(sends(&after)[0].1, "note.read");
    }

    #[test]
    fn following_a_link_matches_titles_case_insensitively() {
        let (mut state, _) = loaded(&[("a.md", "Alpha"), ("b.md", "Beta")]);
        with_content(&mut state, "see [[beta]] now");
        press(&mut state, KeyCode::Tab);
        press(&mut state, KeyCode::Char('n'));
        let actions = press(&mut state, KeyCode::Enter);
        assert_eq!(state.focused_note().as_deref(), Some("b.md"));
        assert_eq!(sends(&actions)[0].2, json!({"path": "b.md"}));
    }

    #[test]
    fn following_a_missing_link_sets_status_and_sends_no_job() {
        let (mut state, _) = loaded(&[("a.md", "Alpha")]);
        with_content(&mut state, "see [[Nope]]");
        press(&mut state, KeyCode::Tab);
        press(&mut state, KeyCode::Char('n'));
        let actions = press(&mut state, KeyCode::Enter);
        assert!(sends(&actions).is_empty());
        assert!(matches!(&actions[..], [Action::Status(s)] if s == "no such note: Nope"));
    }

    #[test]
    fn link_selection_stops_at_the_ends() {
        let (mut state, _) = loaded(&[("a.md", "A")]);
        with_content(&mut state, "[[x]] [[y]]");
        press(&mut state, KeyCode::Tab);
        for _ in 0..5 {
            press(&mut state, KeyCode::Char('n'));
        }
        assert_eq!(state.link, Some(1));
        for _ in 0..5 {
            press(&mut state, KeyCode::Char('p'));
        }
        assert_eq!(state.link, Some(0));
    }

    #[test]
    fn backlink_enter_opens_that_note() {
        let (mut state, _) = loaded(&[("a.md", "Alpha"), ("b.md", "Beta")]);
        let backlink = json!([{"note": meta("b.md", "Beta"), "snippet": "mentions [[Alpha]]"}]);
        state.reply(reply(Slot::Backlinks, Ok(backlink)));
        press(&mut state, KeyCode::Tab);
        press(&mut state, KeyCode::Tab);
        let actions = press(&mut state, KeyCode::Enter);
        assert_eq!(state.focused_note().as_deref(), Some("b.md"));
        assert_eq!(sends(&actions)[0].2, json!({"path": "b.md"}));
    }

    #[test]
    fn folder_expand_collapse_keys() {
        let (mut state, first) = loaded(&[("dir/a.md", "A")]);
        assert!(sends(&first).is_empty());
        assert_eq!(state.rows.len(), 1);
        press(&mut state, KeyCode::Char('l'));
        assert_eq!(state.rows.len(), 2);
        press(&mut state, KeyCode::Char('h'));
        assert_eq!(state.rows.len(), 1);
        press(&mut state, KeyCode::Enter);
        assert_eq!(state.rows.len(), 2);
    }

    #[test]
    fn a_failed_read_shows_the_error_and_keeps_the_list() {
        let (mut state, _) = loaded(&[("a.md", "Alpha")]);
        let error = ClientError::Rejected(ErrorBody {
            code: ErrorCode::Failed,
            message: "file vanished".into(),
        });
        state.reply(reply(Slot::Preview, Err(error)));
        assert_eq!(state.rows.len(), 1);
        let screen = draw(&state, 100, 12);
        assert!(screen.contains("file vanished"), "{screen}");
        assert!(screen.contains("Alpha"), "{screen}");
    }

    #[test]
    fn empty_workspace_renders_a_message() {
        let (state, actions) = loaded(&[]);
        assert!(actions.is_empty());
        assert!(draw(&state, 100, 12).contains("No notes"));
    }

    #[test]
    fn narrow_layout_shows_list_then_preview_full_width() {
        let (mut state, _) = loaded(&[("a.md", "Zebra note")]);
        with_content(&mut state, "plain words");
        let list = draw(&state, 60, 12);
        assert!(
            list.contains("Zebra note") && !list.contains("plain words"),
            "{list}"
        );
        press(&mut state, KeyCode::Enter);
        let preview = draw(&state, 60, 12);
        assert!(
            preview.contains("plain words") && preview.contains("Backlinks"),
            "{preview}"
        );
        assert!(!preview.contains("Zebra note"), "{preview}");
        press(&mut state, KeyCode::Esc);
        assert!(draw(&state, 60, 12).contains("Zebra note"));
    }

    #[test]
    fn wide_layout_shows_list_and_preview_together() {
        let (mut state, _) = loaded(&[("a.md", "Zebra note")]);
        with_content(&mut state, "plain words");
        let screen = draw(&state, 120, 12);
        assert!(
            screen.contains("Zebra note") && screen.contains("plain words"),
            "{screen}"
        );
    }

    #[test]
    fn long_unicode_titles_render_without_panic() {
        let title = "笔记🙂é".repeat(40);
        let (mut state, _) = loaded(&[("a.md", &title), ("b/c.md", &title)]);
        with_content(&mut state, &format!("# {title}\n\n[[{title}]] #{title}"));
        for (w, h) in [(120, 24), (80, 24), (60, 12), (20, 5), (1, 1)] {
            draw(&state, w, h);
        }
        press(&mut state, KeyCode::Tab);
        for _ in 0..4 {
            press(&mut state, KeyCode::Char('j'));
        }
        draw(&state, 20, 5);
    }

    #[test]
    fn preview_scroll_clamps_to_the_content() {
        let (mut state, _) = loaded(&[("a.md", "A")]);
        with_content(&mut state, "one\n\ntwo");
        press(&mut state, KeyCode::Tab);
        for _ in 0..20 {
            press(&mut state, KeyCode::Char('j'));
        }
        assert_eq!(state.scroll, 2);
        for _ in 0..20 {
            press(&mut state, KeyCode::Char('k'));
        }
        assert_eq!(state.scroll, 0);
    }

    #[test]
    fn focused_note_is_the_selected_note_or_none_for_folders() {
        let (mut state, _) = loaded(&[("dir/a.md", "A"), ("top.md", "Top")]);
        assert_eq!(state.focused_note(), None);
        press(&mut state, KeyCode::Char('j'));
        assert_eq!(state.focused_note().as_deref(), Some("top.md"));
    }
}

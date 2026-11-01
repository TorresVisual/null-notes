use crate::tui::effects::{Job, Reply, Slot};
use crate::tui::model::Action;
use crate::tui::wire::{decode, NoteMeta};
use ratatui::crossterm::event::{KeyCode, KeyEvent};
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{List, ListItem, ListState, Paragraph};
use ratatui::Frame;
use serde_json::{json, Value};

#[derive(Debug, Default)]
struct Drilled {
    tag: String,
    notes: Vec<NoteMeta>,
    loaded: bool,
    selected: usize,
}

#[derive(Debug, Default)]
pub struct TagsState {
    tags: Vec<String>,
    selected: usize,
    loaded: bool,
    drilled: Option<Drilled>,
}

fn dim() -> Style {
    Style::new().add_modifier(Modifier::DIM)
}

fn step(selected: usize, len: usize, code: KeyCode) -> usize {
    match code {
        KeyCode::Down | KeyCode::Char('j') => (selected + 1).min(len.saturating_sub(1)),
        KeyCode::Up | KeyCode::Char('k') => selected.saturating_sub(1),
        _ => selected,
    }
}

impl TagsState {
    pub fn enter(&mut self) -> Vec<Action> {
        self.drilled = None;
        vec![Action::Send(Job {
            slot: Slot::Tags,
            command: "tags.list",
            args: Value::Null,
        })]
    }

    pub fn focused_note(&self) -> Option<String> {
        let drilled = self.drilled.as_ref()?;
        drilled
            .notes
            .get(drilled.selected)
            .map(|note| note.path.clone())
    }

    pub fn key(&mut self, key: KeyEvent) -> Vec<Action> {
        if let Some(drilled) = &mut self.drilled {
            return match key.code {
                KeyCode::Esc => {
                    self.drilled = None;
                    Vec::new()
                }
                KeyCode::Enter => match self.focused_note() {
                    Some(path) => vec![Action::OpenNote(path)],
                    None => Vec::new(),
                },
                code => {
                    drilled.selected = step(drilled.selected, drilled.notes.len(), code);
                    Vec::new()
                }
            };
        }
        match key.code {
            KeyCode::Enter => match self.tags.get(self.selected) {
                Some(tag) => {
                    self.drilled = Some(Drilled {
                        tag: tag.clone(),
                        ..Drilled::default()
                    });
                    vec![Action::Send(Job {
                        slot: Slot::TagNotes,
                        command: "tags.notes",
                        args: json!({ "tag": tag }),
                    })]
                }
                None => Vec::new(),
            },
            code => {
                self.selected = step(self.selected, self.tags.len(), code);
                Vec::new()
            }
        }
    }

    pub fn reply(&mut self, reply: Reply) -> Vec<Action> {
        let Ok(value) = reply.result else {
            return Vec::new();
        };
        match reply.slot {
            Slot::Tags => match decode::<Vec<String>>(value) {
                Ok(tags) => {
                    self.tags = tags;
                    self.loaded = true;
                    self.selected = self.selected.min(self.tags.len().saturating_sub(1));
                    Vec::new()
                }
                Err(message) => vec![Action::Status(message)],
            },
            Slot::TagNotes => {
                let Some(drilled) = &mut self.drilled else {
                    return Vec::new();
                };
                if reply.args["tag"]
                    .as_str()
                    .is_some_and(|tag| tag != drilled.tag)
                {
                    return Vec::new();
                }
                match decode::<Vec<NoteMeta>>(value) {
                    Ok(notes) => {
                        drilled.notes = notes;
                        drilled.loaded = true;
                        Vec::new()
                    }
                    Err(message) => vec![Action::Status(message)],
                }
            }
            _ => Vec::new(),
        }
    }

    pub fn render(&self, frame: &mut Frame, area: Rect) {
        match &self.drilled {
            Some(drilled) => self.render_drilled(frame, area, drilled),
            None => self.render_tags(frame, area),
        }
    }

    fn render_tags(&self, frame: &mut Frame, area: Rect) {
        if self.tags.is_empty() {
            let message = if self.loaded {
                "No tags yet"
            } else {
                "Loading tags…"
            };
            frame.render_widget(Paragraph::new(message), area);
            return;
        }
        let items: Vec<ListItem> = self
            .tags
            .iter()
            .map(|tag| ListItem::new(format!("#{tag}")))
            .collect();
        let list = List::new(items).highlight_style(Style::new().add_modifier(Modifier::REVERSED));
        let mut state = ListState::default().with_selected(Some(self.selected));
        frame.render_stateful_widget(list, area, &mut state);
    }

    fn render_drilled(&self, frame: &mut Frame, area: Rect, drilled: &Drilled) {
        let [head, body] =
            Layout::vertical([Constraint::Length(1), Constraint::Min(0)]).areas(area);
        frame.render_widget(
            Line::from(vec![
                Span::styled(
                    format!("#{}", drilled.tag),
                    Style::new().add_modifier(Modifier::BOLD),
                ),
                Span::styled(
                    format!(" — {} notes · Esc back", drilled.notes.len()),
                    dim(),
                ),
            ]),
            head,
        );
        if drilled.notes.is_empty() {
            let message = if drilled.loaded {
                "No notes with this tag"
            } else {
                "Loading…"
            };
            frame.render_widget(Paragraph::new(message), body);
            return;
        }
        let items: Vec<ListItem> = drilled
            .notes
            .iter()
            .map(|note| {
                ListItem::new(Line::from(vec![
                    Span::raw(note.title.clone()),
                    Span::styled(format!("  {}", note.path), dim()),
                ]))
            })
            .collect();
        let list = List::new(items).highlight_style(Style::new().add_modifier(Modifier::REVERSED));
        let mut state = ListState::default().with_selected(Some(drilled.selected));
        frame.render_stateful_widget(list, body, &mut state);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ratatui::backend::TestBackend;
    use ratatui::crossterm::event::KeyModifiers;
    use ratatui::Terminal;
    use serde_json::json;

    fn reply(slot: Slot, value: serde_json::Value) -> Reply {
        Reply {
            slot,
            id: 1,
            command: "x",
            args: serde_json::Value::Null,
            result: Ok(value),
        }
    }

    fn meta(path: &str, title: &str) -> serde_json::Value {
        json!({"id": path, "title": title, "path": path, "workspace": "W", "updatedAt": 1})
    }

    fn loaded(tags: &[&str]) -> TagsState {
        let mut state = TagsState::default();
        state.reply(reply(Slot::Tags, json!(tags)));
        state
    }

    fn press(state: &mut TagsState, code: KeyCode) -> Vec<Action> {
        state.key(KeyEvent::new(code, KeyModifiers::NONE))
    }

    fn draw(state: &TagsState, width: u16, height: u16) -> String {
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

    #[test]
    fn enter_requests_the_tag_list() {
        let actions = TagsState::default().enter();
        assert!(matches!(&actions[..], [Action::Send(job)]
            if job.slot == Slot::Tags && job.command == "tags.list"));
    }

    #[test]
    fn enter_drills_into_the_tags_notes() {
        let mut state = loaded(&["algo", "cs101"]);
        press(&mut state, KeyCode::Char('j'));
        let actions = press(&mut state, KeyCode::Enter);
        assert!(matches!(&actions[..], [Action::Send(job)]
            if job.slot == Slot::TagNotes && job.command == "tags.notes"
                && job.args == json!({"tag": "cs101"})));
        state.reply(reply(Slot::TagNotes, json!([meta("a.md", "Alpha")])));
        let screen = draw(&state, 60, 8);
        assert!(
            screen.contains("cs101") && screen.contains("Alpha"),
            "{screen}"
        );
    }

    #[test]
    fn esc_returns_to_the_tag_list() {
        let mut state = loaded(&["algo"]);
        press(&mut state, KeyCode::Enter);
        state.reply(reply(Slot::TagNotes, json!([meta("a.md", "Alpha")])));
        press(&mut state, KeyCode::Esc);
        let screen = draw(&state, 60, 8);
        assert!(
            screen.contains("#algo") && !screen.contains("Alpha"),
            "{screen}"
        );
        assert_eq!(state.focused_note(), None);
    }

    #[test]
    fn drilled_enter_opens_the_note() {
        let mut state = loaded(&["algo"]);
        press(&mut state, KeyCode::Enter);
        state.reply(reply(
            Slot::TagNotes,
            json!([meta("a.md", "Alpha"), meta("d/b.md", "Beta")]),
        ));
        press(&mut state, KeyCode::Char('j'));
        assert_eq!(state.focused_note().as_deref(), Some("d/b.md"));
        let actions = press(&mut state, KeyCode::Enter);
        assert!(matches!(&actions[..], [Action::OpenNote(p)] if p == "d/b.md"));
    }

    #[test]
    fn a_late_reply_for_another_tag_is_ignored() {
        let mut state = loaded(&["algo", "cs101"]);
        press(&mut state, KeyCode::Enter);
        let mut late = reply(Slot::TagNotes, json!([meta("x.md", "Late")]));
        late.args = json!({"tag": "cs101"});
        state.reply(late);
        assert!(!draw(&state, 60, 8).contains("Late"));
    }

    #[test]
    fn empty_tag_list_renders_a_message() {
        let state = loaded(&[]);
        assert!(draw(&state, 60, 8).contains("No tags"));
    }

    #[test]
    fn long_unicode_tags_render_without_panic() {
        let tag = "日本語🙂".repeat(30);
        let mut state = loaded(&[&tag]);
        for (w, h) in [(60, 8), (20, 5), (1, 1)] {
            draw(&state, w, h);
        }
        press(&mut state, KeyCode::Enter);
        state.reply(reply(Slot::TagNotes, json!([meta("a.md", &tag)])));
        for (w, h) in [(60, 8), (20, 5), (1, 1)] {
            draw(&state, w, h);
        }
    }
}

use crate::tui::effects::{Job, Reply, Slot};
use crate::tui::model::Action;
use crate::tui::wire::{decode, TrashEntry};
use ratatui::crossterm::event::{KeyCode, KeyEvent};
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{List, ListItem, ListState, Paragraph};
use ratatui::Frame;
use serde_json::{json, Value};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Default)]
pub struct TrashState {
    entries: Vec<TrashEntry>,
    selected: usize,
    loaded: bool,
}

pub fn age(trashed_at_ms: i64, now_ms: i64) -> String {
    let minutes = (now_ms - trashed_at_ms) / 60_000;
    match minutes {
        ..=0 => "just now".to_string(),
        1..=59 => format!("{minutes}m ago"),
        60..=1439 => format!("{}h ago", minutes / 60),
        _ => format!("{}d ago", minutes / 1440),
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis() as i64)
}

impl TrashState {
    pub fn enter(&mut self) -> Vec<Action> {
        vec![Action::Send(Job {
            slot: Slot::Trash,
            command: "trash.list",
            args: Value::Null,
        })]
    }

    pub fn focused_note(&self) -> Option<String> {
        None
    }

    pub fn key(&mut self, key: KeyEvent) -> Vec<Action> {
        match key.code {
            KeyCode::Down | KeyCode::Char('j') => {
                self.selected = (self.selected + 1).min(self.entries.len().saturating_sub(1));
                Vec::new()
            }
            KeyCode::Up | KeyCode::Char('k') => {
                self.selected = self.selected.saturating_sub(1);
                Vec::new()
            }
            KeyCode::Char('r') => match self.entries.get(self.selected) {
                Some(entry) => vec![Action::Send(Job {
                    slot: Slot::TrashRestore,
                    command: "trash.restore",
                    args: json!({ "id": entry.id }),
                })],
                None => Vec::new(),
            },
            _ => Vec::new(),
        }
    }

    pub fn reply(&mut self, reply: Reply) -> Vec<Action> {
        let Ok(value) = reply.result else {
            return Vec::new();
        };
        match reply.slot {
            Slot::Trash => match decode::<Vec<TrashEntry>>(value) {
                Ok(entries) => {
                    self.entries = entries;
                    self.loaded = true;
                    self.selected = self.selected.min(self.entries.len().saturating_sub(1));
                    Vec::new()
                }
                Err(message) => vec![Action::Status(message)],
            },
            Slot::TrashRestore => {
                let name = self
                    .entries
                    .iter()
                    .find(|entry| Some(entry.id.as_str()) == reply.args["id"].as_str())
                    .map(|entry| entry.name.clone())
                    .unwrap_or_default();
                let mut actions = self.enter();
                actions.push(Action::Status(format!("Restored {name}")));
                actions
            }
            _ => Vec::new(),
        }
    }

    pub fn render(&self, frame: &mut Frame, area: Rect) {
        if self.entries.is_empty() {
            let message = if self.loaded {
                "Trash is empty"
            } else {
                "Loading trash…"
            };
            frame.render_widget(Paragraph::new(message), area);
            return;
        }
        let now = now_ms();
        let dim = Style::new().add_modifier(Modifier::DIM);
        let items: Vec<ListItem> = self
            .entries
            .iter()
            .map(|entry| {
                let suffix = if entry.is_folder { "/" } else { "" };
                ListItem::new(Line::from(vec![
                    Span::raw(format!("{}{suffix}", entry.name)),
                    Span::styled(
                        format!("  {}  {}", entry.original_path, age(entry.trashed_at, now)),
                        dim,
                    ),
                ]))
            })
            .collect();
        let list = List::new(items).highlight_style(Style::new().add_modifier(Modifier::REVERSED));
        let mut state = ListState::default().with_selected(Some(self.selected));
        frame.render_stateful_widget(list, area, &mut state);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::ClientError;
    use crate::protocol::{ErrorBody, ErrorCode};
    use ratatui::backend::TestBackend;
    use ratatui::crossterm::event::KeyModifiers;
    use ratatui::Terminal;
    use serde_json::json;

    fn entry(id: &str, name: &str, original: &str) -> serde_json::Value {
        json!({"id": id, "workspace": "W", "originalPath": original, "isFolder": false,
               "name": name, "trashedAt": 0})
    }

    fn loaded(entries: Vec<serde_json::Value>) -> TrashState {
        let mut state = TrashState::default();
        state.reply(Reply {
            slot: Slot::Trash,
            id: 1,
            command: "trash.list",
            args: serde_json::Value::Null,
            result: Ok(json!(entries)),
        });
        state
    }

    fn press(state: &mut TrashState, code: KeyCode) -> Vec<Action> {
        state.key(KeyEvent::new(code, KeyModifiers::NONE))
    }

    fn restore_reply(id: &str, result: Result<serde_json::Value, ClientError>) -> Reply {
        Reply {
            slot: Slot::TrashRestore,
            id: 2,
            command: "trash.restore",
            args: json!({ "id": id }),
            result,
        }
    }

    fn draw(state: &TrashState, width: u16, height: u16) -> String {
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
    fn enter_requests_the_trash_list() {
        let actions = TrashState::default().enter();
        assert!(matches!(&actions[..], [Action::Send(job)]
            if job.slot == Slot::Trash && job.command == "trash.list"));
    }

    #[test]
    fn r_restores_then_refetches_and_reports() {
        let mut state = loaded(vec![
            entry("i1", "old note", "a/old.md"),
            entry("i2", "b", "b.md"),
        ]);
        let actions = press(&mut state, KeyCode::Char('r'));
        assert!(matches!(&actions[..], [Action::Send(job)]
            if job.slot == Slot::TrashRestore && job.command == "trash.restore"
                && job.args == json!({"id": "i1"})));
        let after = state.reply(restore_reply("i1", Ok(json!("a/old.md"))));
        assert!(matches!(&after[..], [Action::Send(job), Action::Status(s)]
            if job.command == "trash.list" && s == "Restored old note"));
    }

    #[test]
    fn a_failed_restore_shows_the_error() {
        let mut state = loaded(vec![entry("i1", "old note", "a/old.md")]);
        let error = ClientError::Rejected(ErrorBody {
            code: ErrorCode::Failed,
            message: "target exists".into(),
        });
        let after = state.reply(restore_reply("i1", Err(error)));
        assert!(after.is_empty());
        assert!(draw(&state, 60, 8).contains("old note"));
    }

    #[test]
    fn r_on_an_empty_trash_sends_nothing() {
        assert!(press(&mut loaded(vec![]), KeyCode::Char('r')).is_empty());
    }

    #[test]
    fn age_formats_minutes_hours_and_days() {
        const MIN: i64 = 60_000;
        assert_eq!(age(0, 30_000), "just now");
        assert_eq!(age(0, -5), "just now");
        assert_eq!(age(0, 5 * MIN), "5m ago");
        assert_eq!(age(0, 3 * 60 * MIN), "3h ago");
        assert_eq!(age(0, 2 * 24 * 60 * MIN), "2d ago");
    }

    #[test]
    fn empty_trash_renders_a_message() {
        assert!(draw(&loaded(vec![]), 60, 8).contains("Trash is empty"));
    }

    #[test]
    fn rows_show_name_and_original_path() {
        let state = loaded(vec![entry("i1", "old note", "a/old.md")]);
        let screen = draw(&state, 80, 8);
        assert!(
            screen.contains("old note") && screen.contains("a/old.md"),
            "{screen}"
        );
    }

    #[test]
    fn unicode_names_render_without_panic() {
        let name = "日本語🙂é".repeat(30);
        let state = loaded(vec![entry("i1", &name, &format!("{name}/{name}.md"))]);
        for (w, h) in [(80, 8), (20, 5), (1, 1)] {
            draw(&state, w, h);
        }
    }
}

use crate::tui::effects::{Job, Reply, Slot};
use crate::tui::model::Action;
use crate::tui::wire::{decode, OpenTask};
use ratatui::crossterm::event::{KeyCode, KeyEvent};
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{List, ListItem, ListState, Paragraph};
use ratatui::Frame;
use serde_json::{json, Value};

#[derive(Debug)]
struct TaskRow {
    task: OpenTask,
    done: bool,
}

#[derive(Debug, Default)]
pub struct TasksState {
    rows: Vec<TaskRow>,
    selected: usize,
    loaded: bool,
}

impl TasksState {
    pub fn enter(&mut self) -> Vec<Action> {
        vec![Action::Send(Job {
            slot: Slot::Tasks,
            command: "tasks.list",
            args: Value::Null,
        })]
    }

    pub fn focused_note(&self) -> Option<String> {
        self.rows
            .get(self.selected)
            .map(|row| row.task.note_path.clone())
    }

    pub fn key(&mut self, key: KeyEvent) -> Vec<Action> {
        match key.code {
            KeyCode::Down | KeyCode::Char('j') => {
                self.selected = (self.selected + 1).min(self.rows.len().saturating_sub(1));
                Vec::new()
            }
            KeyCode::Up | KeyCode::Char('k') => {
                self.selected = self.selected.saturating_sub(1);
                Vec::new()
            }
            KeyCode::Char(' ') => match self.rows.get_mut(self.selected) {
                Some(row) => {
                    row.done = !row.done;
                    vec![Action::Send(Job {
                        slot: Slot::TaskToggle,
                        command: "tasks.toggle",
                        args: json!({ "path": row.task.note_path, "position": row.task.position }),
                    })]
                }
                None => Vec::new(),
            },
            KeyCode::Enter => match self.focused_note() {
                Some(path) => vec![Action::OpenNote(path)],
                None => Vec::new(),
            },
            _ => Vec::new(),
        }
    }

    pub fn reply(&mut self, reply: Reply) -> Vec<Action> {
        match (reply.slot, reply.result) {
            (Slot::Tasks, Ok(value)) => match decode::<Vec<OpenTask>>(value) {
                Ok(tasks) => {
                    self.replace(tasks);
                    Vec::new()
                }
                Err(message) => vec![Action::Status(message)],
            },
            (Slot::TaskToggle, Err(_)) => {
                let path = reply.args["path"].as_str();
                let position = reply.args["position"].as_i64();
                if let Some(row) = self.rows.iter_mut().find(|row| {
                    Some(row.task.note_path.as_str()) == path && Some(row.task.position) == position
                }) {
                    row.done = !row.done;
                }
                Vec::new()
            }
            _ => Vec::new(),
        }
    }

    fn replace(&mut self, tasks: Vec<OpenTask>) {
        let kept = self
            .rows
            .get(self.selected)
            .map(|row| (row.task.note_path.clone(), row.task.position));
        self.rows = tasks
            .into_iter()
            .map(|task| TaskRow { task, done: false })
            .collect();
        self.loaded = true;
        self.selected = kept
            .and_then(|(path, position)| {
                self.rows
                    .iter()
                    .position(|row| row.task.note_path == path && row.task.position == position)
            })
            .unwrap_or_else(|| self.selected.min(self.rows.len().saturating_sub(1)));
    }

    pub fn render(&self, frame: &mut Frame, area: Rect) {
        if self.rows.is_empty() {
            let message = if self.loaded {
                "No open tasks"
            } else {
                "Loading tasks…"
            };
            frame.render_widget(Paragraph::new(message), area);
            return;
        }
        let mut items = Vec::new();
        let mut selected_item = 0;
        let mut previous: Option<&str> = None;
        for (index, row) in self.rows.iter().enumerate() {
            if previous != Some(row.task.note_path.as_str()) {
                items.push(ListItem::new(Line::styled(
                    row.task.note_title.clone(),
                    Style::new().add_modifier(Modifier::BOLD),
                )));
                previous = Some(row.task.note_path.as_str());
            }
            if index == self.selected {
                selected_item = items.len();
            }
            let (mark, style) = if row.done {
                (
                    "[x] ",
                    Style::new().add_modifier(Modifier::CROSSED_OUT | Modifier::DIM),
                )
            } else {
                ("[ ] ", Style::new())
            };
            items.push(ListItem::new(Line::from(vec![
                Span::raw("  "),
                Span::styled(format!("{mark}{}", row.task.text), style),
            ])));
        }
        let list = List::new(items).highlight_style(Style::new().add_modifier(Modifier::REVERSED));
        let mut state = ListState::default().with_selected(Some(selected_item));
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

    fn task(path: &str, title: &str, text: &str, position: i64) -> serde_json::Value {
        json!({"notePath": path, "noteTitle": title, "text": text, "position": position})
    }

    fn list_reply(tasks: Vec<serde_json::Value>) -> Reply {
        Reply {
            slot: Slot::Tasks,
            id: 1,
            command: "tasks.list",
            args: serde_json::Value::Null,
            result: Ok(json!(tasks)),
        }
    }

    fn loaded(tasks: Vec<serde_json::Value>) -> TasksState {
        let mut state = TasksState::default();
        state.reply(list_reply(tasks));
        state
    }

    fn press(state: &mut TasksState, code: KeyCode) -> Vec<Action> {
        state.key(KeyEvent::new(code, KeyModifiers::NONE))
    }

    fn toggle_jobs(actions: &[Action]) -> Vec<serde_json::Value> {
        actions
            .iter()
            .filter_map(|a| match a {
                Action::Send(job)
                    if job.slot == Slot::TaskToggle && job.command == "tasks.toggle" =>
                {
                    Some(job.args.clone())
                }
                _ => None,
            })
            .collect()
    }

    fn toggle_failure(args: serde_json::Value, code: ErrorCode) -> Reply {
        Reply {
            slot: Slot::TaskToggle,
            id: 2,
            command: "tasks.toggle",
            args,
            result: Err(ClientError::Rejected(ErrorBody {
                code,
                message: "no".into(),
            })),
        }
    }

    fn draw(state: &TasksState, width: u16, height: u16) -> (String, bool) {
        let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
        terminal
            .draw(|frame| state.render(frame, frame.area()))
            .unwrap();
        let buffer = terminal.backend().buffer();
        let text = (0..height)
            .map(|y| {
                (0..width)
                    .map(|x| buffer[(x, y)].symbol())
                    .collect::<String>()
            })
            .collect::<Vec<_>>()
            .join("\n");
        let struck = buffer.content().iter().any(|cell| {
            cell.modifier
                .contains(ratatui::style::Modifier::CROSSED_OUT)
        });
        (text, struck)
    }

    #[test]
    fn enter_requests_open_tasks() {
        let actions = TasksState::default().enter();
        assert!(matches!(&actions[..], [Action::Send(job)]
            if job.slot == Slot::Tasks && job.command == "tasks.list"));
    }

    #[test]
    fn space_marks_done_strikes_through_and_sends_a_toggle() {
        let mut state = loaded(vec![task("a.md", "A", "write tests", 3)]);
        assert!(!draw(&state, 60, 8).1);
        let actions = press(&mut state, KeyCode::Char(' '));
        assert_eq!(
            toggle_jobs(&actions),
            [json!({"path": "a.md", "position": 3})]
        );
        let (text, struck) = draw(&state, 60, 8);
        assert!(struck && text.contains("[x] write tests"), "{text}");
    }

    #[test]
    fn second_space_reopens_and_sends_another_toggle() {
        let mut state = loaded(vec![task("a.md", "A", "x", 3)]);
        press(&mut state, KeyCode::Char(' '));
        let actions = press(&mut state, KeyCode::Char(' '));
        assert_eq!(toggle_jobs(&actions).len(), 1);
        let (text, struck) = draw(&state, 60, 8);
        assert!(!struck && text.contains("[ ] x"), "{text}");
    }

    #[test]
    fn a_dirty_buffer_reply_reverts_the_row_and_leaves_the_status() {
        let mut state = loaded(vec![task("a.md", "A", "x", 3), task("a.md", "A", "y", 5)]);
        press(&mut state, KeyCode::Char(' '));
        let actions = state.reply(toggle_failure(
            json!({"path": "a.md", "position": 3}),
            ErrorCode::DirtyBuffer,
        ));
        assert!(actions.is_empty());
        assert!(!draw(&state, 60, 8).1);
    }

    #[test]
    fn a_failed_toggle_for_a_different_row_leaves_the_others() {
        let mut state = loaded(vec![task("a.md", "A", "x", 3), task("a.md", "A", "y", 5)]);
        press(&mut state, KeyCode::Char(' '));
        state.reply(toggle_failure(
            json!({"path": "a.md", "position": 5}),
            ErrorCode::Failed,
        ));
        assert!(draw(&state, 60, 8).1);
    }

    #[test]
    fn refetch_drops_completed_rows() {
        let mut state = loaded(vec![task("a.md", "A", "x", 3), task("a.md", "A", "y", 5)]);
        press(&mut state, KeyCode::Char(' '));
        state.reply(list_reply(vec![task("a.md", "A", "y", 5)]));
        let (text, struck) = draw(&state, 60, 8);
        assert!(
            !struck && !text.contains("[x]") && text.contains("y"),
            "{text}"
        );
    }

    #[test]
    fn rows_group_under_note_titles() {
        let state = loaded(vec![
            task("a.md", "Alpha", "one", 1),
            task("a.md", "Alpha", "two", 2),
            task("b.md", "Beta", "three", 1),
        ]);
        let (text, _) = draw(&state, 60, 10);
        assert_eq!(text.matches("Alpha").count(), 1, "{text}");
        assert!(text.contains("Beta") && text.contains("three"));
    }

    #[test]
    fn enter_opens_the_note() {
        let mut state = loaded(vec![task("a.md", "A", "x", 1), task("b/c.md", "C", "y", 2)]);
        press(&mut state, KeyCode::Char('j'));
        let actions = press(&mut state, KeyCode::Enter);
        assert!(matches!(&actions[..], [Action::OpenNote(p)] if p == "b/c.md"));
    }

    #[test]
    fn no_tasks_renders_a_message() {
        let state = loaded(vec![]);
        assert!(draw(&state, 60, 8).0.contains("No open tasks"));
    }

    #[test]
    fn focused_note_is_the_selected_rows_note() {
        let mut state = loaded(vec![task("a.md", "A", "x", 1), task("b.md", "B", "y", 2)]);
        assert_eq!(state.focused_note().as_deref(), Some("a.md"));
        press(&mut state, KeyCode::Down);
        assert_eq!(state.focused_note().as_deref(), Some("b.md"));
        assert_eq!(TasksState::default().focused_note(), None);
    }

    #[test]
    fn long_unicode_tasks_render_without_panic() {
        let state = loaded(vec![task("a.md", &"笔记".repeat(40), &"🙂é".repeat(80), 1)]);
        for (w, h) in [(60, 8), (20, 5), (1, 1)] {
            draw(&state, w, h);
        }
    }
}

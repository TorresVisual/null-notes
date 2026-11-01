use crate::tui::effects::{Job, Reply, Slot};
use crate::tui::model::Action;
use ratatui::crossterm::event::KeyEvent;
use ratatui::layout::Rect;
use ratatui::widgets::Paragraph;
use ratatui::Frame;
use serde_json::Value;

#[derive(Debug, Default)]
pub struct TagsState {
    pub replies: Vec<Slot>,
}

impl TagsState {
    pub fn enter(&mut self) -> Vec<Action> {
        vec![Action::Send(Job {
            slot: Slot::Tags,
            command: "tags.list",
            args: Value::Null,
        })]
    }

    pub fn key(&mut self, _key: KeyEvent) -> Vec<Action> {
        Vec::new()
    }

    pub fn reply(&mut self, reply: Reply) -> Vec<Action> {
        self.replies.push(reply.slot);
        Vec::new()
    }

    pub fn render(&self, frame: &mut Frame, area: Rect) {
        frame.render_widget(Paragraph::new("Tags"), area);
    }

    pub fn focused_note(&self) -> Option<String> {
        None
    }
}

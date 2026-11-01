pub mod cards;
pub mod notes;
pub mod search;
pub mod tags;
pub mod tasks;
pub mod trash;

use super::effects::Reply;
use super::model::{Action, View};
use ratatui::crossterm::event::KeyEvent;
use ratatui::layout::Rect;
use ratatui::Frame;

#[derive(Debug, Default)]
pub struct Views {
    pub notes: notes::NotesState,
    pub search: search::SearchState,
    pub tasks: tasks::TasksState,
    pub cards: cards::CardsState,
    pub tags: tags::TagsState,
    pub trash: trash::TrashState,
}

impl Views {
    pub fn enter(&mut self, view: View) -> Vec<Action> {
        match view {
            View::Notes => self.notes.enter(),
            View::Search => self.search.enter(),
            View::Tasks => self.tasks.enter(),
            View::Cards => self.cards.enter(),
            View::Tags => self.tags.enter(),
            View::Trash => self.trash.enter(),
        }
    }

    pub fn key(&mut self, view: View, key: KeyEvent) -> Vec<Action> {
        match view {
            View::Notes => self.notes.key(key),
            View::Search => self.search.key(key),
            View::Tasks => self.tasks.key(key),
            View::Cards => self.cards.key(key),
            View::Tags => self.tags.key(key),
            View::Trash => self.trash.key(key),
        }
    }

    pub fn reply(&mut self, view: View, reply: Reply) -> Vec<Action> {
        match view {
            View::Notes => self.notes.reply(reply),
            View::Search => self.search.reply(reply),
            View::Tasks => self.tasks.reply(reply),
            View::Cards => self.cards.reply(reply),
            View::Tags => self.tags.reply(reply),
            View::Trash => self.trash.reply(reply),
        }
    }

    pub fn render(&self, view: View, frame: &mut Frame, area: Rect) {
        match view {
            View::Notes => self.notes.render(frame, area),
            View::Search => self.search.render(frame, area),
            View::Tasks => self.tasks.render(frame, area),
            View::Cards => self.cards.render(frame, area),
            View::Tags => self.tags.render(frame, area),
            View::Trash => self.trash.render(frame, area),
        }
    }

    pub fn captures_digits(&self, view: View) -> bool {
        view == View::Cards && self.cards.captures_digits()
    }

    pub fn focused_note(&self, view: View) -> Option<String> {
        match view {
            View::Notes => self.notes.focused_note(),
            View::Search => self.search.focused_note(),
            View::Tasks => self.tasks.focused_note(),
            View::Cards => self.cards.focused_note(),
            View::Tags => self.tags.focused_note(),
            View::Trash => self.trash.focused_note(),
        }
    }
}

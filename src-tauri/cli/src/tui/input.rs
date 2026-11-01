use ratatui::crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InputPurpose {
    Search,
    Append { path: String },
    NewTitle { folder: String },
}

#[derive(Debug, PartialEq, Eq)]
pub enum InputOutcome {
    Editing,
    Submit(String),
    Cancel,
}

#[derive(Debug, Clone)]
pub struct TextInput {
    pub purpose: InputPurpose,
    pub value: String,
    cursor: usize,
}

impl TextInput {
    pub fn new(purpose: InputPurpose, value: String) -> Self {
        let cursor = value.chars().count();
        TextInput {
            purpose,
            value,
            cursor,
        }
    }

    pub fn cursor(&self) -> usize {
        self.cursor
    }

    fn byte_at(&self, chars: usize) -> usize {
        self.value
            .char_indices()
            .nth(chars)
            .map_or(self.value.len(), |(index, _)| index)
    }

    pub fn handle(&mut self, key: KeyEvent) -> InputOutcome {
        let len = self.value.chars().count();
        match key.code {
            KeyCode::Enter => return InputOutcome::Submit(self.value.clone()),
            KeyCode::Esc => return InputOutcome::Cancel,
            KeyCode::Char(c)
                if !key
                    .modifiers
                    .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT) =>
            {
                let at = self.byte_at(self.cursor);
                self.value.insert(at, c);
                self.cursor += 1;
            }
            KeyCode::Backspace if self.cursor > 0 => {
                self.cursor -= 1;
                let at = self.byte_at(self.cursor);
                self.value.remove(at);
            }
            KeyCode::Delete if self.cursor < len => {
                let at = self.byte_at(self.cursor);
                self.value.remove(at);
            }
            KeyCode::Left => self.cursor = self.cursor.saturating_sub(1),
            KeyCode::Right => self.cursor = (self.cursor + 1).min(len),
            KeyCode::Home => self.cursor = 0,
            KeyCode::End => self.cursor = len,
            _ => {}
        }
        InputOutcome::Editing
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ratatui::crossterm::event::KeyModifiers;

    fn key(code: KeyCode) -> KeyEvent {
        KeyEvent::new(code, KeyModifiers::NONE)
    }

    fn type_text(input: &mut TextInput, text: &str) {
        for c in text.chars() {
            input.handle(key(KeyCode::Char(c)));
        }
    }

    fn input() -> TextInput {
        TextInput::new(InputPurpose::Search, String::new())
    }

    #[test]
    fn typing_inserts_at_the_cursor() {
        let mut input = input();
        type_text(&mut input, "ac");
        input.handle(key(KeyCode::Left));
        input.handle(key(KeyCode::Char('b')));
        assert_eq!(input.value, "abc");
        assert_eq!(input.cursor(), 2);
    }

    #[test]
    fn backspace_and_delete_are_char_aware() {
        let mut input = TextInput::new(InputPurpose::Search, "é🙂".into());
        input.handle(key(KeyCode::Backspace));
        assert_eq!(input.value, "é");
        input.handle(key(KeyCode::Home));
        input.handle(key(KeyCode::Delete));
        assert_eq!(input.value, "");
        input.handle(key(KeyCode::Backspace));
        input.handle(key(KeyCode::Delete));
        assert_eq!(input.value, "");
    }

    #[test]
    fn cursor_keys_clamp() {
        let mut input = TextInput::new(InputPurpose::Search, "日本".into());
        assert_eq!(input.cursor(), 2);
        input.handle(key(KeyCode::Right));
        assert_eq!(input.cursor(), 2);
        for _ in 0..5 {
            input.handle(key(KeyCode::Left));
        }
        assert_eq!(input.cursor(), 0);
        input.handle(key(KeyCode::End));
        assert_eq!(input.cursor(), 2);
        input.handle(key(KeyCode::Home));
        assert_eq!(input.cursor(), 0);
    }

    #[test]
    fn enter_submits_and_esc_cancels() {
        let mut input = input();
        type_text(&mut input, "hi");
        assert_eq!(input.handle(key(KeyCode::Char('!'))), InputOutcome::Editing);
        assert_eq!(
            input.handle(key(KeyCode::Enter)),
            InputOutcome::Submit("hi!".into())
        );
        assert_eq!(input.handle(key(KeyCode::Esc)), InputOutcome::Cancel);
    }

    #[test]
    fn control_chords_are_not_text() {
        let mut input = input();
        input.handle(KeyEvent::new(KeyCode::Char('a'), KeyModifiers::CONTROL));
        assert_eq!(input.value, "");
    }
}

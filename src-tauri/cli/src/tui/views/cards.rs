use crate::tui::effects::{Job, Reply, Slot};
use crate::tui::model::Action;
use crate::tui::wire::{decode, DueCard};
use ratatui::crossterm::event::{KeyCode, KeyEvent};
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::Line;
use ratatui::widgets::{Block, Paragraph, Wrap};
use ratatui::Frame;
use serde_json::{json, Value};

#[derive(Debug, Default)]
pub struct CardsState {
    deck: Vec<DueCard>,
    index: usize,
    revealed: bool,
    loaded: bool,
    reviewed: u32,
    skipped: u32,
}

fn write(command: &'static str, args: Value) -> Action {
    Action::Send(Job {
        slot: Slot::CardWrite,
        command,
        args,
    })
}

impl CardsState {
    pub fn enter(&mut self) -> Vec<Action> {
        vec![Action::Send(Job {
            slot: Slot::Cards,
            command: "cards.due",
            args: Value::Null,
        })]
    }

    pub fn captures_digits(&self) -> bool {
        self.revealed && self.current().is_some()
    }

    fn current(&self) -> Option<&DueCard> {
        self.deck.get(self.index)
    }

    pub fn focused_note(&self) -> Option<String> {
        self.current().map(|card| card.note_path.clone())
    }

    pub fn key(&mut self, key: KeyEvent) -> Vec<Action> {
        let Some(card) = self.current() else {
            return Vec::new();
        };
        let target = json!({ "path": card.note_path, "position": card.position });
        match key.code {
            KeyCode::Char(' ') => {
                self.revealed = true;
                Vec::new()
            }
            KeyCode::Char(c @ '1'..='4') if self.revealed => {
                let grade = ["again", "hard", "good", "easy"][c as usize - '1' as usize];
                let mut args = target;
                args["grade"] = json!(grade);
                self.reviewed += 1;
                self.advance();
                vec![write("cards.grade", args)]
            }
            KeyCode::Char('s') => {
                let mut args = target;
                args["suspended"] = json!(true);
                self.advance();
                vec![write("cards.suspend", args)]
            }
            _ => Vec::new(),
        }
    }

    fn advance(&mut self) {
        self.index += 1;
        self.revealed = false;
    }

    pub fn reply(&mut self, reply: Reply) -> Vec<Action> {
        match (reply.slot, reply.result) {
            (Slot::Cards, Ok(value)) => match decode::<Vec<DueCard>>(value) {
                Ok(deck) => {
                    *self = CardsState {
                        deck,
                        loaded: true,
                        ..CardsState::default()
                    };
                    Vec::new()
                }
                Err(message) => vec![Action::Status(message)],
            },
            (Slot::CardWrite, Err(_)) => {
                if reply.command == "cards.grade" {
                    self.reviewed = self.reviewed.saturating_sub(1);
                }
                self.skipped += 1;
                Vec::new()
            }
            _ => Vec::new(),
        }
    }

    pub fn render(&self, frame: &mut Frame, area: Rect) {
        let Some(card) = self.current() else {
            let message = match (self.loaded, self.deck.is_empty()) {
                (false, _) => "Loading cards…".to_string(),
                (true, true) => "No cards due".to_string(),
                (true, false) => format!(
                    "Session complete\n\n{} reviewed, {} skipped",
                    self.reviewed, self.skipped
                ),
            };
            frame.render_widget(Paragraph::new(message), area);
            return;
        };

        let [body, hint] =
            Layout::vertical([Constraint::Min(0), Constraint::Length(1)]).areas(area);
        let title = format!(
            "Card {}/{} — {}",
            self.index + 1,
            self.deck.len(),
            card.note_title
        );
        let mut lines = vec![Line::from(card.front.clone())];
        for (n, option) in card.options.iter().enumerate() {
            let letter = char::from(b'a'.wrapping_add(n.min(25) as u8));
            lines.push(Line::from(format!("  {letter}) {option}")));
        }
        if self.revealed {
            lines.push(Line::default());
            lines.push(Line::styled(
                "─────",
                Style::new().add_modifier(Modifier::DIM),
            ));
            lines.push(Line::from(card.back.clone()));
        }
        frame.render_widget(
            Paragraph::new(lines)
                .block(Block::bordered().title(title))
                .wrap(Wrap { trim: false }),
            body,
        );
        let keys = if self.revealed {
            "1 again · 2 hard · 3 good · 4 easy · s suspend"
        } else {
            "Space reveal · s suspend"
        };
        frame.render_widget(
            Line::styled(keys, Style::new().add_modifier(Modifier::DIM)),
            hint,
        );
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

    fn card(path: &str, front: &str, back: &str, position: i64) -> serde_json::Value {
        json!({"notePath": path, "noteTitle": "T", "kind": "qa", "front": front, "back": back,
               "position": position, "options": [], "streak": 0})
    }

    fn deck_reply(cards: Vec<serde_json::Value>) -> Reply {
        Reply {
            slot: Slot::Cards,
            id: 1,
            command: "cards.due",
            args: serde_json::Value::Null,
            result: Ok(json!(cards)),
        }
    }

    fn loaded(cards: Vec<serde_json::Value>) -> CardsState {
        let mut state = CardsState::default();
        state.reply(deck_reply(cards));
        state
    }

    fn press(state: &mut CardsState, code: KeyCode) -> Vec<Action> {
        state.key(KeyEvent::new(code, KeyModifiers::NONE))
    }

    fn write_jobs(actions: &[Action]) -> Vec<(&'static str, serde_json::Value)> {
        actions
            .iter()
            .filter_map(|a| match a {
                Action::Send(job) if job.slot == Slot::CardWrite => {
                    Some((job.command, job.args.clone()))
                }
                _ => None,
            })
            .collect()
    }

    fn write_failure(command: &'static str) -> Reply {
        Reply {
            slot: Slot::CardWrite,
            id: 2,
            command,
            args: json!({}),
            result: Err(ClientError::Rejected(ErrorBody {
                code: ErrorCode::DirtyBuffer,
                message: "dirty".into(),
            })),
        }
    }

    fn draw(state: &CardsState, width: u16, height: u16) -> String {
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
    fn enter_requests_due_cards() {
        let actions = CardsState::default().enter();
        assert!(matches!(&actions[..], [Action::Send(job)]
            if job.slot == Slot::Cards && job.command == "cards.due"));
    }

    #[test]
    fn space_reveals_then_digits_grade_with_the_right_wire_names() {
        let cards = (0..4).map(|n| card("a.md", "q", "a", n)).collect();
        let mut state = loaded(cards);
        for (n, (key, grade)) in [('1', "again"), ('2', "hard"), ('3', "good"), ('4', "easy")]
            .into_iter()
            .enumerate()
        {
            press(&mut state, KeyCode::Char(' '));
            let actions = press(&mut state, KeyCode::Char(key));
            assert_eq!(
                write_jobs(&actions),
                [(
                    "cards.grade",
                    json!({"path": "a.md", "position": n, "grade": grade})
                )]
            );
        }
    }

    #[test]
    fn digits_before_reveal_do_nothing() {
        let mut state = loaded(vec![card("a.md", "q", "a", 0)]);
        assert!(press(&mut state, KeyCode::Char('3')).is_empty());
        assert!(!state.captures_digits());
        press(&mut state, KeyCode::Char(' '));
        assert!(state.captures_digits());
    }

    #[test]
    fn grading_advances_at_once() {
        let mut state = loaded(vec![card("a.md", "q1", "a", 0), card("b.md", "q2", "a", 0)]);
        assert_eq!(state.focused_note().as_deref(), Some("a.md"));
        press(&mut state, KeyCode::Char(' '));
        press(&mut state, KeyCode::Char('3'));
        assert_eq!(state.focused_note().as_deref(), Some("b.md"));
        assert!(!state.captures_digits());
        assert!(draw(&state, 60, 10).contains("q2"));
    }

    #[test]
    fn s_suspends_and_advances_with_suspended_true() {
        let mut state = loaded(vec![card("a.md", "q1", "a", 7), card("b.md", "q2", "a", 0)]);
        let actions = press(&mut state, KeyCode::Char('s'));
        assert_eq!(
            write_jobs(&actions),
            [(
                "cards.suspend",
                json!({"path": "a.md", "position": 7, "suspended": true})
            )]
        );
        assert_eq!(state.focused_note().as_deref(), Some("b.md"));
    }

    #[test]
    fn a_failed_write_counts_as_skipped_and_the_session_continues() {
        let mut state = loaded(vec![card("a.md", "q1", "a", 0), card("b.md", "q2", "a", 0)]);
        press(&mut state, KeyCode::Char(' '));
        press(&mut state, KeyCode::Char('3'));
        let actions = state.reply(write_failure("cards.grade"));
        assert!(actions.is_empty());
        assert_eq!((state.reviewed, state.skipped), (0, 1));
        assert_eq!(state.focused_note().as_deref(), Some("b.md"));
    }

    #[test]
    fn end_screen_counts_reviewed_and_skipped() {
        let mut state = loaded(vec![card("a.md", "q1", "a", 0), card("b.md", "q2", "a", 0)]);
        for _ in 0..2 {
            press(&mut state, KeyCode::Char(' '));
            press(&mut state, KeyCode::Char('2'));
        }
        state.reply(write_failure("cards.grade"));
        assert!(draw(&state, 60, 10).contains("1 reviewed, 1 skipped"));
        assert_eq!(state.focused_note(), None);
    }

    #[test]
    fn refetch_starts_a_fresh_session() {
        let mut state = loaded(vec![card("a.md", "q1", "a", 0)]);
        press(&mut state, KeyCode::Char('s'));
        state.reply(write_failure("cards.suspend"));
        state.reply(deck_reply(vec![card("c.md", "q3", "a", 0)]));
        assert_eq!((state.reviewed, state.skipped), (0, 0));
        assert_eq!(state.focused_note().as_deref(), Some("c.md"));
    }

    #[test]
    fn empty_deck_renders_no_cards_due() {
        let state = loaded(vec![]);
        assert!(draw(&state, 60, 10).contains("No cards due"));
    }

    #[test]
    fn mc_options_are_listed_and_self_graded() {
        let mut mc = card("a.md", "Pick one", "the second", 0);
        mc["kind"] = json!("mc");
        mc["options"] = json!(["first", "second"]);
        let mut state = loaded(vec![mc]);
        let front = draw(&state, 60, 12);
        assert!(
            front.contains("a) first") && front.contains("b) second"),
            "{front}"
        );
        assert!(!front.contains("the second") || front.matches("second").count() == 1);
        press(&mut state, KeyCode::Char(' '));
        assert!(draw(&state, 60, 12).contains("the second"));
        let actions = press(&mut state, KeyCode::Char('3'));
        assert_eq!(write_jobs(&actions).len(), 1);
    }

    #[test]
    fn cloze_front_renders_as_is() {
        let state = loaded(vec![card("a.md", "The [...] is blue", "sky", 0)]);
        assert!(draw(&state, 60, 10).contains("The [...] is blue"));
    }

    #[test]
    fn long_unicode_card_text_renders_without_panic() {
        let mut state = loaded(vec![card(
            "a.md",
            &"日本語🙂".repeat(100),
            &"é".repeat(300),
            0,
        )]);
        for (w, h) in [(60, 10), (20, 5), (1, 1)] {
            draw(&state, w, h);
        }
        press(&mut state, KeyCode::Char(' '));
        for (w, h) in [(60, 10), (20, 5), (1, 1)] {
            draw(&state, w, h);
        }
    }

    #[test]
    fn focused_note_is_the_current_cards_note() {
        assert_eq!(CardsState::default().focused_note(), None);
        let state = loaded(vec![card("x/y.md", "q", "a", 0)]);
        assert_eq!(state.focused_note().as_deref(), Some("x/y.md"));
    }
}

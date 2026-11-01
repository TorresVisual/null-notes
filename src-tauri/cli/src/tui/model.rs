use super::effects::{Job, Reply, Slot};
use super::input::{InputOutcome, InputPurpose, TextInput};
use super::views::Views;
use crate::client::ClientError;
use crate::exit;
use crate::protocol::ErrorCode;
use ratatui::crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use serde_json::Value;
use std::time::{Duration, Instant};

pub const SEARCH_DEBOUNCE: Duration = Duration::from_millis(150);
pub const KEEPALIVE: Duration = Duration::from_secs(5 * 60);
pub const DIRTY_BUFFER_STATUS: &str = "Unsaved edits in the app — nothing written";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum View {
    Notes,
    Search,
    Tasks,
    Cards,
    Tags,
    Trash,
}

impl View {
    pub const ALL: [View; 6] = [
        View::Notes,
        View::Search,
        View::Tasks,
        View::Cards,
        View::Tags,
        View::Trash,
    ];

    pub fn label(self) -> &'static str {
        match self {
            View::Notes => "Notes",
            View::Search => "Search",
            View::Tasks => "Tasks",
            View::Cards => "Cards",
            View::Tags => "Tags",
            View::Trash => "Trash",
        }
    }

    fn from_digit(c: char) -> Option<View> {
        let index = c.to_digit(10)?.checked_sub(1)?;
        View::ALL.get(index as usize).copied()
    }

    fn owning(slot: Slot) -> Option<View> {
        match slot {
            Slot::Notes | Slot::Preview | Slot::Backlinks => Some(View::Notes),
            Slot::Search => Some(View::Search),
            Slot::Tasks | Slot::TaskToggle => Some(View::Tasks),
            Slot::Cards | Slot::CardWrite => Some(View::Cards),
            Slot::Tags | Slot::TagNotes => Some(View::Tags),
            Slot::Trash | Slot::TrashRestore => Some(View::Trash),
            Slot::Capture | Slot::Keepalive => None,
        }
    }
}

#[derive(Debug)]
pub enum Msg {
    Key(KeyEvent),
    Reply(Reply),
    Tick(Instant),
}

#[derive(Debug)]
pub enum Action {
    Send(Job),
    OpenNote(String),
    Status(String),
}

#[derive(Debug)]
pub struct State {
    pub view: View,
    pub workspace: String,
    pub status: Option<String>,
    pub fatal: Option<String>,
    pub starting: bool,
    pub help: bool,
    pub quit: bool,
    pub input: Option<TextInput>,
    pub views: Views,
    clock: Instant,
    last_sent: Instant,
}

impl State {
    pub fn new(workspace: String, now: Instant) -> State {
        State {
            view: View::Notes,
            workspace,
            status: None,
            fatal: None,
            starting: true,
            help: false,
            quit: false,
            input: None,
            views: Views::default(),
            clock: now,
            last_sent: now,
        }
    }

    pub fn begin(&mut self) -> Vec<Job> {
        self.enter_current()
    }

    fn enter_current(&mut self) -> Vec<Job> {
        let actions = self.views.enter(self.view);
        self.apply(actions)
    }

    fn apply(&mut self, actions: Vec<Action>) -> Vec<Job> {
        let mut jobs = Vec::new();
        let mut queue = std::collections::VecDeque::from(actions);
        while let Some(action) = queue.pop_front() {
            match action {
                Action::Send(job) => jobs.push(job),
                Action::Status(text) => self.status = Some(text),
                Action::OpenNote(path) => {
                    self.view = View::Notes;
                    queue.extend(self.views.notes.open(path));
                }
            }
        }
        jobs
    }
}

pub fn update(state: &mut State, msg: Msg) -> Vec<Job> {
    let jobs = match msg {
        Msg::Key(key) => on_key(state, key),
        Msg::Reply(reply) => on_reply(state, reply),
        Msg::Tick(now) => {
            state.clock = now;
            let actions = state.views.search.tick(now);
            let mut jobs = state.apply(actions);
            if now.saturating_duration_since(state.last_sent) >= KEEPALIVE {
                jobs.push(Job {
                    slot: Slot::Keepalive,
                    command: "tags.list",
                    args: Value::Null,
                });
            }
            jobs
        }
    };
    if !jobs.is_empty() {
        state.last_sent = state.clock;
    }
    jobs
}

fn is_quit(key: &KeyEvent, input_open: bool) -> bool {
    match key.code {
        KeyCode::Char('q') => key.modifiers.is_empty() && !input_open,
        KeyCode::Char('c') => key.modifiers.contains(KeyModifiers::CONTROL),
        _ => false,
    }
}

fn on_key(state: &mut State, key: KeyEvent) -> Vec<Job> {
    if key.kind == KeyEventKind::Release {
        return Vec::new();
    }
    if is_quit(&key, state.input.is_some()) {
        state.quit = true;
        return Vec::new();
    }
    if state.starting {
        return Vec::new();
    }
    if state.fatal.is_some() {
        if key.code == KeyCode::Char('r') {
            state.fatal = None;
            return state.enter_current();
        }
        return Vec::new();
    }
    if state.help {
        if matches!(key.code, KeyCode::Esc | KeyCode::Char('?')) {
            state.help = false;
        }
        return Vec::new();
    }
    if state.input.is_some() {
        return on_input_key(state, key);
    }
    let ctrl = key.modifiers.contains(KeyModifiers::CONTROL);
    match key.code {
        KeyCode::Char('?') => {
            state.help = true;
            Vec::new()
        }
        KeyCode::Char('r') if ctrl => state.enter_current(),
        KeyCode::Char('/') => {
            state.view = View::Search;
            state.status = None;
            let query = state.views.search.query().to_string();
            state.input = Some(TextInput::new(InputPurpose::Search, query));
            Vec::new()
        }
        KeyCode::Char(c) => match View::from_digit(c)
            .filter(|_| !ctrl && !state.views.captures_digits(state.view))
        {
            Some(view) => {
                state.view = view;
                state.status = None;
                state.enter_current()
            }
            None => forward(state, key),
        },
        _ => forward(state, key),
    }
}

fn on_input_key(state: &mut State, key: KeyEvent) -> Vec<Job> {
    let Some(input) = state.input.as_mut() else {
        return Vec::new();
    };
    let outcome = input.handle(key);
    let (purpose, value) = (input.purpose.clone(), input.value.clone());
    match (outcome, purpose) {
        (InputOutcome::Editing, InputPurpose::Search) => {
            state.views.search.set_query(&value, state.clock);
            Vec::new()
        }
        (InputOutcome::Submit(text), InputPurpose::Search) => {
            state.input = None;
            state.views.search.set_query(&text, state.clock);
            let actions = state.views.search.tick(state.clock + SEARCH_DEBOUNCE);
            state.apply(actions)
        }
        (InputOutcome::Cancel, _) => {
            state.input = None;
            Vec::new()
        }
    }
}

fn forward(state: &mut State, key: KeyEvent) -> Vec<Job> {
    let actions = state.views.key(state.view, key);
    state.apply(actions)
}

fn on_reply(state: &mut State, reply: Reply) -> Vec<Job> {
    state.starting = false;
    if let Err(error) = &reply.result {
        match error {
            ClientError::Disabled | ClientError::Unreachable(_) => {
                state.fatal = Some(exit::message_for(error));
                state.input = None;
                return Vec::new();
            }
            ClientError::Rejected(body) => match body.code {
                ErrorCode::VersionMismatch | ErrorCode::Unauthorized => {
                    state.fatal = Some(exit::message_for(error));
                    state.input = None;
                    return Vec::new();
                }
                ErrorCode::DirtyBuffer => state.status = Some(DIRTY_BUFFER_STATUS.to_string()),
                ErrorCode::Failed | ErrorCode::Usage => state.status = Some(body.message.clone()),
            },
        }
    }
    match View::owning(reply.slot) {
        Some(view) => {
            let actions = state.views.reply(view, reply);
            state.apply(actions)
        }
        None => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{ErrorBody, ErrorCode};
    use ratatui::crossterm::event::{KeyCode, KeyModifiers};

    fn ready() -> (State, Instant) {
        let t0 = Instant::now();
        let mut state = State::new("W".into(), t0);
        state.starting = false;
        (state, t0)
    }

    fn press(state: &mut State, code: KeyCode) -> Vec<Job> {
        update(state, Msg::Key(KeyEvent::new(code, KeyModifiers::NONE)))
    }

    fn ctrl(state: &mut State, c: char) -> Vec<Job> {
        update(
            state,
            Msg::Key(KeyEvent::new(KeyCode::Char(c), KeyModifiers::CONTROL)),
        )
    }

    fn reply(slot: Slot, result: Result<serde_json::Value, ClientError>) -> Msg {
        Msg::Reply(Reply {
            slot,
            id: 1,
            command: "x",
            args: serde_json::Value::Null,
            result,
        })
    }

    fn rejected(code: ErrorCode, message: &str) -> Result<serde_json::Value, ClientError> {
        Err(ClientError::Rejected(ErrorBody {
            code,
            message: message.into(),
        }))
    }

    #[test]
    fn number_keys_switch_views_and_call_enter() {
        let (mut state, _) = ready();
        let jobs = press(&mut state, KeyCode::Char('3'));
        assert_eq!(state.view, View::Tasks);
        assert_eq!(jobs[0].slot, Slot::Tasks);
        press(&mut state, KeyCode::Char('6'));
        assert_eq!(state.view, View::Trash);
    }

    #[test]
    fn ctrl_r_reenters_the_current_view() {
        let (mut state, _) = ready();
        press(&mut state, KeyCode::Char('3'));
        let jobs = ctrl(&mut state, 'r');
        assert_eq!(state.view, View::Tasks);
        assert_eq!(jobs[0].slot, Slot::Tasks);
    }

    #[test]
    fn q_and_ctrl_c_set_quit() {
        let (mut state, _) = ready();
        press(&mut state, KeyCode::Char('q'));
        assert!(state.quit);
        let (mut state, _) = ready();
        ctrl(&mut state, 'c');
        assert!(state.quit);
    }

    #[test]
    fn help_overlay_toggles_and_esc_closes_it() {
        let (mut state, _) = ready();
        press(&mut state, KeyCode::Char('?'));
        assert!(state.help);
        press(&mut state, KeyCode::Char('?'));
        assert!(!state.help);
        press(&mut state, KeyCode::Char('?'));
        press(&mut state, KeyCode::Esc);
        assert!(!state.help);
    }

    #[test]
    fn keys_are_ignored_while_starting_except_quit() {
        let mut state = State::new("W".into(), Instant::now());
        assert!(press(&mut state, KeyCode::Char('3')).is_empty());
        assert_eq!(state.view, View::Notes);
        press(&mut state, KeyCode::Char('q'));
        assert!(state.quit);
    }

    #[test]
    fn first_reply_clears_starting() {
        let mut state = State::new("W".into(), Instant::now());
        assert!(state.starting);
        update(&mut state, reply(Slot::Notes, Ok(serde_json::Value::Null)));
        assert!(!state.starting);
    }

    #[test]
    fn unreachable_reply_sets_fatal_and_r_clears_it() {
        let (mut state, _) = ready();
        update(
            &mut state,
            reply(Slot::Notes, Err(ClientError::Unreachable("no app".into()))),
        );
        assert_eq!(state.fatal.as_deref(), Some("no app"));
        assert!(press(&mut state, KeyCode::Char('3')).is_empty());
        let jobs = press(&mut state, KeyCode::Char('r'));
        assert!(state.fatal.is_none());
        assert_eq!(jobs[0].slot, Slot::Notes);
    }

    #[test]
    fn disabled_and_version_mismatch_are_fatal_with_their_messages() {
        let (mut state, _) = ready();
        update(&mut state, reply(Slot::Notes, Err(ClientError::Disabled)));
        assert_eq!(
            state.fatal.as_deref(),
            Some("CLI access is turned off in Null Notes (Settings → Tools)")
        );
        let (mut state, _) = ready();
        update(
            &mut state,
            reply(Slot::Notes, rejected(ErrorCode::VersionMismatch, "too old")),
        );
        assert_eq!(state.fatal.as_deref(), Some("too old"));
        let (mut state, _) = ready();
        update(
            &mut state,
            reply(Slot::Notes, rejected(ErrorCode::Unauthorized, "bad token")),
        );
        assert_eq!(state.fatal.as_deref(), Some("bad token"));
    }

    #[test]
    fn dirty_buffer_sets_the_exact_status_without_going_fatal() {
        let (mut state, _) = ready();
        update(
            &mut state,
            reply(Slot::TaskToggle, rejected(ErrorCode::DirtyBuffer, "dirty")),
        );
        assert_eq!(
            state.status.as_deref(),
            Some("Unsaved edits in the app — nothing written")
        );
        assert!(state.fatal.is_none());
    }

    #[test]
    fn other_rejected_sets_status_to_the_message_without_going_fatal() {
        let (mut state, _) = ready();
        update(
            &mut state,
            reply(Slot::Cards, rejected(ErrorCode::Failed, "note vanished")),
        );
        assert_eq!(state.status.as_deref(), Some("note vanished"));
        assert!(state.fatal.is_none());
    }

    #[test]
    fn slots_belong_to_the_view_that_issued_them() {
        assert_eq!(View::owning(Slot::Backlinks), Some(View::Notes));
        assert_eq!(View::owning(Slot::Preview), Some(View::Notes));
        assert_eq!(View::owning(Slot::TagNotes), Some(View::Tags));
        assert_eq!(View::owning(Slot::TrashRestore), Some(View::Trash));
        assert_eq!(View::owning(Slot::CardWrite), Some(View::Cards));
        assert_eq!(View::owning(Slot::Keepalive), None);
        assert_eq!(View::owning(Slot::Capture), None);
    }

    #[test]
    fn keepalive_emits_tags_list_after_five_minutes_idle_and_not_before() {
        let (mut state, t0) = ready();
        assert!(update(
            &mut state,
            Msg::Tick(t0 + KEEPALIVE - Duration::from_secs(1))
        )
        .is_empty());
        let jobs = update(&mut state, Msg::Tick(t0 + KEEPALIVE));
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].slot, Slot::Keepalive);
        assert_eq!(jobs[0].command, "tags.list");
        assert!(update(
            &mut state,
            Msg::Tick(t0 + KEEPALIVE + Duration::from_secs(1))
        )
        .is_empty());
    }

    #[test]
    fn any_sent_job_resets_the_keepalive_clock() {
        let (mut state, t0) = ready();
        update(&mut state, Msg::Tick(t0 + Duration::from_secs(200)));
        press(&mut state, KeyCode::Char('3'));
        let almost = t0 + Duration::from_secs(200) + KEEPALIVE - Duration::from_secs(1);
        assert!(update(&mut state, Msg::Tick(almost)).is_empty());
    }

    #[test]
    fn release_events_are_ignored() {
        let (mut state, _) = ready();
        let mut key = KeyEvent::new(KeyCode::Char('q'), KeyModifiers::NONE);
        key.kind = ratatui::crossterm::event::KeyEventKind::Release;
        update(&mut state, Msg::Key(key));
        assert!(!state.quit);
    }

    fn type_text(state: &mut State, text: &str) {
        for c in text.chars() {
            press(state, KeyCode::Char(c));
        }
    }

    #[test]
    fn slash_opens_search_with_the_input_focused() {
        let (mut state, _) = ready();
        press(&mut state, KeyCode::Char('3'));
        let jobs = press(&mut state, KeyCode::Char('/'));
        assert_eq!(state.view, View::Search);
        assert!(jobs.is_empty());
        assert_eq!(
            state.input.as_ref().map(|i| i.purpose.clone()),
            Some(InputPurpose::Search)
        );
    }

    #[test]
    fn typing_q_and_digits_in_the_input_does_not_quit_or_switch_view() {
        let (mut state, _) = ready();
        press(&mut state, KeyCode::Char('/'));
        type_text(&mut state, "q3c/?");
        assert!(!state.quit);
        assert!(!state.help);
        assert_eq!(state.view, View::Search);
        assert_eq!(
            state.input.as_ref().map(|i| i.value.as_str()),
            Some("q3c/?")
        );
    }

    #[test]
    fn ctrl_c_quits_even_with_the_input_open() {
        let (mut state, _) = ready();
        press(&mut state, KeyCode::Char('/'));
        ctrl(&mut state, 'c');
        assert!(state.quit);
    }

    #[test]
    fn editing_the_input_feeds_the_search_debounce() {
        let (mut state, t0) = ready();
        press(&mut state, KeyCode::Char('/'));
        type_text(&mut state, "ab");
        assert!(update(
            &mut state,
            Msg::Tick(t0 + SEARCH_DEBOUNCE - Duration::from_millis(1))
        )
        .is_empty());
        let jobs = update(&mut state, Msg::Tick(t0 + SEARCH_DEBOUNCE));
        assert_eq!(jobs[0].slot, Slot::Search);
        assert_eq!(jobs[0].args, serde_json::json!({"query": "ab"}));
    }

    #[test]
    fn enter_submits_closes_the_input_and_searches_at_once() {
        let (mut state, _) = ready();
        press(&mut state, KeyCode::Char('/'));
        type_text(&mut state, "ab");
        let jobs = press(&mut state, KeyCode::Enter);
        assert!(state.input.is_none());
        assert_eq!(jobs[0].args, serde_json::json!({"query": "ab"}));
    }

    #[test]
    fn esc_closes_the_input_and_keeps_the_text() {
        let (mut state, _) = ready();
        press(&mut state, KeyCode::Char('/'));
        type_text(&mut state, "ab");
        press(&mut state, KeyCode::Esc);
        assert!(state.input.is_none());
        assert_eq!(state.views.search.query(), "ab");
        press(&mut state, KeyCode::Char('/'));
        assert_eq!(state.input.as_ref().map(|i| i.value.as_str()), Some("ab"));
    }

    #[test]
    fn a_fatal_error_closes_the_input() {
        let (mut state, _) = ready();
        press(&mut state, KeyCode::Char('/'));
        update(&mut state, reply(Slot::Search, Err(ClientError::Disabled)));
        assert!(state.input.is_none());
        press(&mut state, KeyCode::Char('q'));
        assert!(state.quit);
    }

    #[test]
    fn digits_grade_instead_of_switching_when_a_card_is_revealed() {
        let (mut state, _) = ready();
        press(&mut state, KeyCode::Char('4'));
        let deck = serde_json::json!([{"notePath": "a.md", "noteTitle": "T", "kind": "qa",
            "front": "q", "back": "a", "position": 0, "options": [], "streak": 0}]);
        update(&mut state, reply(Slot::Cards, Ok(deck)));
        assert_eq!(press(&mut state, KeyCode::Char('3')).len(), 1);
        assert_eq!(state.view, View::Tasks);
        press(&mut state, KeyCode::Char('4'));
        press(&mut state, KeyCode::Char(' '));
        let jobs = press(&mut state, KeyCode::Char('3'));
        assert_eq!(state.view, View::Cards);
        assert_eq!(jobs[0].slot, Slot::CardWrite);
        assert_eq!(jobs[0].args["grade"], "good");
    }
}

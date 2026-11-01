use super::input::{InputPurpose, TextInput};
use super::model::{State, View};
use ratatui::buffer::Buffer;
use ratatui::layout::{Alignment, Constraint, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Clear, Paragraph};
use ratatui::Frame;

pub const NARROW_COLS: u16 = 80;

const HINTS: &str = "1-6 views · / search · c capture · ^R refresh · ? help · q quit";
const HELP: &[&str] = &[
    "1-6        switch view",
    "/          search",
    "c          capture a line or a new note",
    "Ctrl+R     refresh the current view",
    "Tab        next pane (Notes)",
    "j/k, ↑/↓   move",
    "Enter      open / follow",
    "Esc        back / close",
    "?          toggle this help",
    "q, Ctrl+C  quit",
];

fn dim() -> Style {
    Style::new().add_modifier(Modifier::DIM)
}

pub fn draw(frame: &mut Frame, state: &State) {
    let [header, tabs, body, status] = Layout::vertical([
        Constraint::Length(1),
        Constraint::Length(1),
        Constraint::Min(0),
        Constraint::Length(1),
    ])
    .areas(frame.area());

    frame.render_widget(
        Line::from(vec![
            Span::styled("Null Notes", Style::new().add_modifier(Modifier::BOLD)),
            Span::raw(" · "),
            Span::raw(state.workspace.as_str()),
        ]),
        header,
    );
    frame.render_widget(tab_row(state.view), tabs);
    match &state.input {
        Some(input) => draw_input(frame, input, status),
        None => frame.render_widget(status_line(state), status),
    }

    if let Some(message) = &state.fatal {
        let text = format!("{message}\n\nr retry · q quit");
        frame.render_widget(centered(text), body);
    } else if state.starting {
        frame.render_widget(centered("Starting Null Notes…".to_string()), body);
    } else {
        state.views.render(state.view, frame, body);
    }

    if state.help {
        draw_help(frame, frame.area());
    }
}

fn tab_row(active: View) -> Line<'static> {
    let mut spans = Vec::new();
    for (index, view) in View::ALL.into_iter().enumerate() {
        let style = if view == active {
            Style::new().add_modifier(Modifier::REVERSED | Modifier::BOLD)
        } else {
            Style::new()
        };
        spans.push(Span::styled(
            format!(" {} {} ", index + 1, view.label()),
            style,
        ));
    }
    Line::from(spans)
}

fn status_line(state: &State) -> Line<'static> {
    let mut spans = Vec::new();
    if let Some(status) = &state.status {
        spans.push(Span::styled(status.clone(), Style::new().fg(Color::Yellow)));
        spans.push(Span::raw("  "));
    }
    spans.push(Span::styled(HINTS, dim()));
    Line::from(spans)
}

fn draw_input(frame: &mut Frame, input: &TextInput, area: Rect) {
    let prompt = match input.purpose {
        InputPurpose::Search => "/ ",
    };
    frame.render_widget(
        Line::from(vec![Span::raw(prompt), Span::raw(input.value.as_str())]),
        area,
    );
    let before: String = input.value.chars().take(input.cursor()).collect();
    let offset = Span::raw(prompt).width() + Span::raw(before).width();
    let x = area.x.saturating_add(offset.min(u16::MAX as usize) as u16);
    if x < area.right() && area.height > 0 {
        frame.set_cursor_position((x, area.y));
    }
}

fn centered(text: String) -> Paragraph<'static> {
    Paragraph::new(text)
        .alignment(Alignment::Center)
        .wrap(ratatui::widgets::Wrap { trim: true })
}

fn draw_help(frame: &mut Frame, area: Rect) {
    let width = area.width.min(52);
    let height = area.height.min(HELP.len() as u16 + 2);
    let rect = Rect::new(
        area.x + (area.width - width) / 2,
        area.y + (area.height - height) / 2,
        width,
        height,
    );
    frame.render_widget(Clear, rect);
    let lines: Vec<Line> = HELP.iter().map(|row| Line::from(*row)).collect();
    frame.render_widget(
        Paragraph::new(lines).block(Block::bordered().title("Help")),
        rect,
    );
}

pub fn strip_color(buffer: &mut Buffer) {
    for cell in buffer.content.iter_mut() {
        cell.fg = Color::Reset;
        cell.bg = Color::Reset;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ratatui::backend::TestBackend;
    use ratatui::style::Color;
    use ratatui::Terminal;
    use std::time::Instant;

    fn render(state: &State, width: u16, height: u16) -> Vec<String> {
        let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
        terminal.draw(|frame| draw(frame, state)).unwrap();
        let buffer = terminal.backend().buffer();
        (0..height)
            .map(|y| (0..width).map(|x| buffer[(x, y)].symbol()).collect())
            .collect()
    }

    fn ready(workspace: &str) -> State {
        let mut state = State::new(workspace.into(), Instant::now());
        state.starting = false;
        state
    }

    fn contains(rows: &[String], needle: &str) -> bool {
        rows.iter().any(|row| row.contains(needle))
    }

    #[test]
    fn draw_shows_workspace_tabs_and_status() {
        let mut state = ready("D:\\notes");
        state.status = Some("hello there".into());
        let rows = render(&state, 100, 12);
        assert!(rows[0].contains("Null Notes · D:\\notes"), "{rows:?}");
        for tab in [
            "1 Notes", "2 Search", "3 Tasks", "4 Cards", "5 Tags", "6 Trash",
        ] {
            assert!(contains(&rows, tab), "{tab} missing: {rows:?}");
        }
        assert!(contains(&rows, "hello there"));
    }

    #[test]
    fn draw_shows_key_hints_when_there_is_no_status() {
        let rows = render(&ready("W"), 100, 12);
        assert!(contains(&rows, "? help"), "{rows:?}");
    }

    #[test]
    fn draw_shows_the_starting_splash() {
        let state = State::new("W".into(), Instant::now());
        assert!(contains(&render(&state, 60, 10), "Starting Null Notes…"));
    }

    #[test]
    fn draw_shows_the_fatal_screen_with_retry_hint() {
        let mut state = ready("W");
        state.fatal = Some("Null Notes did not start".into());
        let rows = render(&state, 60, 10);
        assert!(contains(&rows, "Null Notes did not start"));
        assert!(contains(&rows, "r retry"));
    }

    #[test]
    fn draw_shows_the_help_overlay() {
        let mut state = ready("W");
        state.help = true;
        assert!(contains(&render(&state, 80, 24), "Help"));
    }

    #[test]
    fn draw_survives_tiny_terminals() {
        let mut state = ready("W");
        state.help = true;
        state.status = Some("s".into());
        for (w, h) in [(1, 1), (10, 3), (20, 5), (79, 24)] {
            render(&state, w, h);
            state.help = false;
            render(&state, w, h);
            state.help = true;
            let mut fatal = ready("W");
            fatal.fatal = Some("boom".into());
            render(&fatal, w, h);
            render(&State::new("W".into(), Instant::now()), w, h);
        }
    }

    #[test]
    fn draw_clips_long_unicode_workspace_names() {
        let state = ready(&"D:\\笔记🙂\\".repeat(40));
        let rows = render(&state, 30, 6);
        assert!(rows[0].starts_with("Null Notes · D:"), "{rows:?}");
    }

    #[test]
    fn strip_color_resets_every_cell_colour_but_keeps_modifiers() {
        let mut state = ready("W");
        state.view = View::Notes;
        let mut terminal = Terminal::new(TestBackend::new(40, 5)).unwrap();
        terminal
            .draw(|frame| {
                draw(frame, &state);
                strip_color(frame.buffer_mut());
            })
            .unwrap();
        let buffer = terminal.backend().buffer();
        assert!(buffer
            .content()
            .iter()
            .all(|cell| cell.fg == Color::Reset && cell.bg == Color::Reset));
        assert!(buffer
            .content()
            .iter()
            .any(|cell| cell.modifier.contains(ratatui::style::Modifier::REVERSED)));
    }

    #[test]
    fn draw_shows_the_input_line_and_places_the_cursor() {
        let mut state = ready("W");
        state.input = Some(crate::tui::input::TextInput::new(
            crate::tui::input::InputPurpose::Search,
            "日本x".into(),
        ));
        let mut terminal = Terminal::new(TestBackend::new(40, 6)).unwrap();
        terminal.draw(|frame| draw(frame, &state)).unwrap();
        let buffer = terminal.backend().buffer();
        let last: String = (0..40).map(|x| buffer[(x, 5)].symbol()).collect();
        assert!(last.replace(' ', "").starts_with("/日本x"), "{last}");
        terminal.backend_mut().assert_cursor_position((7, 5));
    }
}

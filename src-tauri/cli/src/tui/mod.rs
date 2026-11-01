#![allow(dead_code)]

mod effects;
mod query;
mod tree;
mod wire;

use crate::client::Env;
use crate::workspace;
use ratatui::crossterm::event::{self, Event, KeyCode, KeyEventKind, KeyModifiers};
use ratatui::widgets::{Block, Paragraph};
use ratatui::DefaultTerminal;
use std::io::IsTerminal;
use std::path::Path;
use std::time::Duration;

#[derive(Debug)]
struct TerminalGuard;

impl Drop for TerminalGuard {
    fn drop(&mut self) {
        ratatui::restore();
    }
}

pub fn run(workspace_flag: Option<&Path>) -> i32 {
    if !(std::io::stdin().is_terminal() && std::io::stdout().is_terminal()) {
        eprintln!("nullnotes tui needs an interactive terminal");
        return 2;
    }

    let env = Env::from_system();
    let Ok(workspace) = workspace::resolve_here(workspace_flag, &env.recents_file()) else {
        eprintln!("{}", workspace::NOT_FOUND_MESSAGE);
        return 3;
    };

    // try_init installs a panic hook that restores the terminal, then chains to the previous one.
    let mut terminal = match ratatui::try_init() {
        Ok(terminal) => terminal,
        Err(error) => {
            eprintln!("cannot start the terminal UI: {error}");
            return 1;
        }
    };
    let guard = TerminalGuard;
    match event_loop(&mut terminal, &workspace.to_string_lossy()) {
        Ok(()) => 0,
        Err(error) => {
            drop(guard);
            eprintln!("terminal error: {error}");
            1
        }
    }
}

fn event_loop(terminal: &mut DefaultTerminal, workspace: &str) -> std::io::Result<()> {
    loop {
        terminal.draw(|frame| {
            let block = Block::bordered().title("Null Notes");
            frame.render_widget(
                Paragraph::new(workspace.to_string()).block(block),
                frame.area(),
            );
        })?;
        if event::poll(Duration::from_millis(50))? {
            if let Event::Key(key) = event::read()? {
                let ctrl_c =
                    key.code == KeyCode::Char('c') && key.modifiers.contains(KeyModifiers::CONTROL);
                if key.kind == KeyEventKind::Press && (ctrl_c || key.code == KeyCode::Char('q')) {
                    return Ok(());
                }
            }
        }
    }
}

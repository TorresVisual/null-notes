#![allow(dead_code)]

mod effects;
mod input;
mod markdown;
mod model;
mod query;
mod tree;
mod view;
mod views;
mod wire;

use crate::client::Env;
use crate::workspace;
use effects::{Job, Worker};
use model::{update, Msg, State};
use ratatui::crossterm::event::{self, Event};
use ratatui::DefaultTerminal;
use std::io::IsTerminal;
use std::path::Path;
use std::sync::mpsc;
use std::time::{Duration, Instant};

const POLL: Duration = Duration::from_millis(50);

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
    let (replies, inbox) = mpsc::channel();
    let worker = Worker::spawn(effects::pipe_call(env, workspace.clone()), replies);
    let state = State::new(workspace.to_string_lossy().into_owned(), Instant::now());
    match event_loop(&mut terminal, state, worker, inbox) {
        Ok(()) => 0,
        Err(error) => {
            drop(guard);
            eprintln!("terminal error: {error}");
            1
        }
    }
}

fn no_color() -> bool {
    std::env::var_os("NO_COLOR").is_some_and(|value| !value.is_empty())
}

fn submit(worker: &mut Worker, jobs: Vec<Job>) {
    for job in jobs {
        worker.submit(job);
    }
}

fn event_loop(
    terminal: &mut DefaultTerminal,
    mut state: State,
    mut worker: Worker,
    inbox: mpsc::Receiver<effects::Reply>,
) -> std::io::Result<()> {
    let strip = no_color();
    submit(&mut worker, state.begin());
    loop {
        terminal.draw(|frame| {
            view::draw(frame, &state);
            if strip {
                view::strip_color(frame.buffer_mut());
            }
        })?;
        if state.quit {
            return Ok(());
        }
        if event::poll(POLL)? {
            if let Event::Key(key) = event::read()? {
                submit(&mut worker, update(&mut state, Msg::Key(key)));
            }
        }
        while let Ok(reply) = inbox.try_recv() {
            if worker.is_current(&reply) {
                submit(&mut worker, update(&mut state, Msg::Reply(reply)));
            }
        }
        submit(&mut worker, update(&mut state, Msg::Tick(Instant::now())));
    }
}

mod client;
mod commands;
mod exit;
mod protocol;
mod tui;
mod workspace;

use clap::Parser;
use client::{ClientError, Env};
use commands::Cli;
use serde_json::json;

fn main() {
    std::process::exit(run());
}

fn run() -> i32 {
    let cli = Cli::parse();

    if matches!(cli.command, commands::Command::Tui) {
        return tui::run(cli.workspace.as_deref());
    }

    let (command, args) = match commands::build_request(&cli, &mut std::io::stdin()) {
        Ok(request) => request,
        Err(commands::UsageError(message)) => {
            eprintln!("{message}");
            return 2;
        }
    };

    let env = Env::from_system();
    let Ok(workspace) = workspace::resolve_here(cli.workspace.as_deref(), &env.recents_file())
    else {
        eprintln!("{}", workspace::NOT_FOUND_MESSAGE);
        return 3;
    };

    match client::request_with(&env, &command, Some(&workspace), args) {
        Ok(result) => {
            println!("{}", json!({ "ok": true, "result": result }));
            0
        }
        Err(error) => {
            match &error {
                ClientError::Rejected(body) => {
                    println!("{}", json!({ "ok": false, "error": body }))
                }
                ClientError::Disabled | ClientError::Unreachable(_) => {
                    eprintln!("{}", exit::message_for(&error))
                }
            }
            exit::code_for(&error)
        }
    }
}

mod client;
mod commands;
mod exit;
mod protocol;
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

    let (command, args) = match commands::build_request(&cli, &mut std::io::stdin()) {
        Ok(request) => request,
        Err(commands::UsageError(message)) => {
            eprintln!("{message}");
            return 2;
        }
    };

    let env = Env::from_system();
    let resolved = std::env::current_dir()
        .map_err(|_| workspace::ResolveError::NotFound)
        .and_then(|cwd| workspace::resolve(cli.workspace.as_deref(), &cwd, &env.recents_file()));
    let Ok(workspace) = resolved else {
        eprintln!(
            "no workspace found: run inside one, pass --workspace, or open one in Null Notes first"
        );
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
                ClientError::Disabled => {
                    eprintln!("CLI access is turned off in Null Notes (Settings → Tools)")
                }
                ClientError::Unreachable(reason) => eprintln!("{reason}"),
            }
            exit::code_for(&error)
        }
    }
}

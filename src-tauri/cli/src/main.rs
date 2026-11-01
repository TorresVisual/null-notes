mod client;
mod exit;
mod protocol;
mod workspace;

use client::{ClientError, Env};
use serde_json::{json, Value};

fn main() {
    std::process::exit(run());
}

fn run() -> i32 {
    let mut args = std::env::args().skip(1);
    let Some(command) = args.next() else {
        eprintln!("usage: nullnotes <command> [json-args]");
        return 2;
    };
    let command_args = match args.next() {
        Some(text) => match serde_json::from_str::<Value>(&text) {
            Ok(value) => value,
            Err(e) => {
                eprintln!("arguments are not valid JSON: {e}");
                return 2;
            }
        },
        None => Value::Null,
    };

    let env = Env::from_system();
    let workspace = std::env::current_dir()
        .ok()
        .and_then(|cwd| workspace::resolve(None, &cwd, &env.recents_file()).ok());
    let Some(workspace) = workspace else {
        eprintln!("no workspace found; run inside one or pass --workspace");
        return 3;
    };

    match client::request_with(&env, &command, Some(&workspace), command_args) {
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

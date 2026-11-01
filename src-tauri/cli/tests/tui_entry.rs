use std::process::{Command, Output, Stdio};

fn nullnotes(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_nullnotes"))
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .expect("nullnotes runs")
}

#[test]
fn tui_refuses_without_a_terminal() {
    let out = nullnotes(&["tui"]);
    assert_eq!(out.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&out.stderr).contains("interactive terminal"));
}

#[test]
fn tui_checks_the_terminal_before_the_workspace() {
    let out = nullnotes(&["tui", "--workspace", "C:/definitely/missing"]);
    assert_eq!(out.status.code(), Some(2));
}

#[test]
fn bare_nullnotes_is_still_a_usage_error() {
    assert_eq!(nullnotes(&[]).status.code(), Some(2));
}

#![cfg(windows)]

use super::error_log::append_entry_sync;
use super::git::no_window_command;
use std::path::Path;
use std::process::Output;

const PACKAGE_FAMILY_PREFIX: &str = "NullNotes.ShellIntegration";

/// Checked via `Get-AppxPackage`/zip inspection rather than a real
/// package-identity API call from inside the process (e.g.
/// `Package::Current()`), which throws instead of returning a clean bool
/// when the *calling* process itself has no identity yet — exactly the
/// state this function runs in on every launch before registration. Shelling
/// out sidesteps that chicken-and-egg problem entirely.
///
/// Compares the *version* registered against the version bundled in
/// `msix_path`, not just presence — a stale version registered from a
/// previous build must still trigger `register_and_relaunch` so it can be
/// replaced (see its doc comment for why re-registering over it directly
/// would fail).
pub fn has_current_package_identity(msix_path: &Path) -> bool {
    let output = powershell(&format!(
        "Add-Type -AssemblyName System.IO.Compression.FileSystem; \
         $m = [System.IO.Compression.ZipFile]::OpenRead('{msix}'); \
         $r = New-Object System.IO.StreamReader($m.GetEntry('AppxManifest.xml').Open()); \
         $bundled = ([xml]$r.ReadToEnd()).Package.Identity.Version; \
         $r.Close(); $m.Dispose(); \
         $installed = (Get-AppxPackage -Name '{PACKAGE_FAMILY_PREFIX}*' | Select-Object -First 1).Version; \
         $bundled -eq $installed",
        msix = msix_path.display(),
    ));
    match output {
        Ok(o) => o.status.success() && String::from_utf8_lossy(&o.stdout).trim() == "True",
        Err(_) => false,
    }
}

/// Output is captured rather than inherited: the window is hidden, so a
/// failure's stderr is the only place its reason survives.
fn powershell(script: &str) -> std::io::Result<Output> {
    no_window_command("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output()
}

fn failure_reason(result: &std::io::Result<Output>) -> Option<String> {
    match result {
        Ok(o) if o.status.success() => None,
        Ok(o) => Some(String::from_utf8_lossy(&o.stderr).trim().to_string()),
        Err(e) => Some(e.to_string()),
    }
}

/// Registers the identity package pointed at `exe_dir`'s `shell-integration`
/// subdirectory (which holds only the context-menu handler DLL — see Task
/// 5's manifest, whose `com:Class/@Path` is relative to this directory) and
/// relaunches the app with the original arguments.
///
/// `null-notes.exe` lives one level up from that subdirectory as a matter of
/// tidy layout, not identity: a plain exe does not pick up package identity
/// by living inside (or being spawned from inside) a sparse package's
/// external-location directory — identity is granted per-process based on
/// the launched image's *own* embedded manifest (build.rs deliberately
/// carries no `<msix>` fusion element for this exe; see its comment for why
/// one there breaks the taskbar icon). Only the COM surrogate hosting the
/// context-menu DLL needs identity; the app itself must not have it.
///
/// Unregisters any existing `NullNotes.ShellIntegration*` package first —
/// re-registering over an already-registered *same* version is a no-op per
/// docs/research/windows11-top-level-context-menu.md §6.6, but installing
/// over a *different* registered version fails with 0x80073CF9, and this is
/// always called after `has_current_package_identity` found a version
/// mismatch (or nothing registered at all, where the removal is a no-op).
///
/// Only returns when registration or the relaunch failed: the reason goes to
/// the in-app error log under `shell-integration` and the caller carries on
/// running without identity (the app itself never needs it). Exiting here
/// instead leaves a machine that doesn't trust the package's signing cert
/// with an app that silently refuses to open.
pub fn register_and_relaunch(
    msix_path: &Path,
    exe_dir: &Path,
    original_args: &[String],
    log_dir: &Path,
) {
    let _ = powershell(&format!(
        "Get-AppxPackage -Name '{PACKAGE_FAMILY_PREFIX}*' | Remove-AppxPackage"
    ));

    let external_location = exe_dir.join("shell-integration");
    let registered = powershell(&format!(
        "Add-AppxPackage -Path '{}' -ExternalLocation '{}'",
        msix_path.display(),
        external_location.display()
    ));

    if let Some(reason) = failure_reason(&registered) {
        append_entry_sync(
            log_dir,
            "shell-integration",
            &format!(
                "Explorer context-menu registration failed; running without it. Trust the \
                 signing certificate with `trust-cert.ps1 -Action Install` from the install \
                 folder (see docs/installing.md). {reason}"
            ),
            Some(&msix_path.display().to_string()),
        );
        return;
    }

    let exe = std::env::current_exe().unwrap_or_else(|_| exe_dir.join("null-notes.exe"));
    match std::process::Command::new(exe).args(original_args).spawn() {
        Ok(_) => std::process::exit(0),
        Err(e) => append_entry_sync(
            log_dir,
            "shell-integration",
            &format!("Relaunch after registering shell integration failed: {e}"),
            None,
        ),
    }
}

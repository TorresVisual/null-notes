#![cfg(windows)]

use std::path::Path;
use std::process::Command;

const PACKAGE_FAMILY_PREFIX: &str = "NullNotes.ShellIntegration";

/// ponytail: checked via `Get-AppxPackage`'s exit/output rather than a real
/// package-identity API call from inside the process (e.g.
/// `Package::Current()`), which throws instead of returning a clean bool
/// when the *calling* process itself has no identity yet — exactly the
/// state this function runs in on every launch before registration. Shelling
/// out sidesteps that chicken-and-egg problem entirely.
pub fn has_package_identity() -> bool {
    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            &format!(
                "(Get-AppxPackage -Name '{PACKAGE_FAMILY_PREFIX}*' | Select-Object -First 1).PackageFullName"
            ),
        ])
        .output();
    match output {
        Ok(o) => o.status.success() && !o.stdout.is_empty(),
        Err(_) => false,
    }
}

/// Registers the identity package pointed at `exe_dir` (the directory
/// containing both `null-notes.exe` and the context-menu handler DLL — see
/// Task 5's manifest, whose `com:Class/@Path` is relative to this same
/// directory) and relaunches the app with the original arguments.
///
/// ponytail: no unregister-old-version-first step. Re-running this against
/// an already-registered *same* version is a no-op per
/// docs/research/windows11-top-level-context-menu.md §6.6; bumping
/// `Identity/@Version` in AppxManifest.xml on a future update without also
/// unregistering the old one fails with 0x80073CF9 — add that handling
/// when this app ships its first update that touches the manifest.
pub fn register_and_relaunch(msix_path: &Path, exe_dir: &Path, original_args: &[String]) -> ! {
    let status = Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            &format!(
                "Add-AppxPackage -Path '{}' -ExternalLocation '{}'",
                msix_path.display(),
                exe_dir.display()
            ),
        ])
        .status();

    if !matches!(status, Ok(s) if s.success()) {
        // Registration failed (e.g. cert not trusted on this machine, see
        // Task 4) — fall through and run without identity rather than
        // getting stuck relaunching forever.
        std::process::exit(0);
    }

    let exe = std::env::current_exe().unwrap_or_else(|_| exe_dir.join("null-notes.exe"));
    let _ = Command::new(exe).args(original_args).spawn();
    std::process::exit(0);
}

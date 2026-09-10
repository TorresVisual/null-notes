#![cfg(windows)]

use std::path::Path;
use std::process::Command;

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
    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            &format!(
                "$m = [System.IO.Compression.ZipFile]::OpenRead('{msix}'); \
                 $r = New-Object System.IO.StreamReader($m.GetEntry('AppxManifest.xml').Open()); \
                 $bundled = ([xml]$r.ReadToEnd()).Package.Identity.Version; \
                 $r.Close(); $m.Dispose(); \
                 $installed = (Get-AppxPackage -Name '{PACKAGE_FAMILY_PREFIX}*' | Select-Object -First 1).Version; \
                 $bundled -eq $installed",
                msix = msix_path.display(),
            ),
        ])
        .output();
    match output {
        Ok(o) => o.status.success() && String::from_utf8_lossy(&o.stdout).trim() == "True",
        Err(_) => false,
    }
}

/// Registers the identity package pointed at `exe_dir` (the directory
/// containing both `null-notes.exe` and the context-menu handler DLL — see
/// Task 5's manifest, whose `com:Class/@Path` is relative to this same
/// directory) and relaunches the app with the original arguments.
///
/// Unregisters any existing `NullNotes.ShellIntegration*` package first —
/// re-registering over an already-registered *same* version is a no-op per
/// docs/research/windows11-top-level-context-menu.md §6.6, but installing
/// over a *different* registered version fails with 0x80073CF9, and this is
/// always called after `has_current_package_identity` found a version
/// mismatch (or nothing registered at all, where the removal is a no-op).
pub fn register_and_relaunch(msix_path: &Path, exe_dir: &Path, original_args: &[String]) -> ! {
    let _ = Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            &format!("Get-AppxPackage -Name '{PACKAGE_FAMILY_PREFIX}*' | Remove-AppxPackage"),
        ])
        .status();

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

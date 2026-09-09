$ErrorActionPreference = "Stop"

$Repo = "TorresVisual/null-notes"
$Doc = "docs/security-audit-2026-09-07.md"
$Labels = @{
    "security" = @{
        Color = "B60205"
        Description = "Security-related issue"
    }
    "high" = @{
        Color = "D93F0B"
        Description = "High severity"
    }
    "medium" = @{
        Color = "FBCA04"
        Description = "Medium severity"
    }
    "low" = @{
        Color = "0E8A16"
        Description = "Low severity"
    }
}

foreach ($LabelName in $Labels.Keys) {
    $Label = $Labels[$LabelName]

    gh label create $LabelName `
        --repo $Repo `
        --color $Label.Color `
        --description $Label.Description `
        --force | Out-Null
}

function New-SecurityIssue {
    param(
        [string]$Severity,
        [string]$Title,
        [string]$Body
    )

    $FullBody = @"
$Body

Full analysis, repro and suggested fix: ``$Doc``
"@

    $Output = gh issue create `
        --repo $Repo `
        --title $Title `
        --label "security" `
        --label $Severity `
        --body $FullBody 2>&1

    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to create issue '$Title': $Output"
        exit 1
    }

    Write-Host "Created: $Title"
}

New-SecurityIssue `
    "high" `
    "H-1: webview runs with no Content Security Policy" `
    'src-tauri/tauri.conf.json:23 sets "csp": null, so no CSP is injected. Nothing constrains injected script or frame/object loads in a webview holding an authenticated __TAURI__.invoke handle.'

New-SecurityIssue `
    "high" `
    "H-2: stored XSS — raw note HTML rendered with dangerouslySetInnerHTML" `
    'HTMLBlock.tsx:41 and HTMLInline.tsx:21 render captured outerHTML verbatim; index.ts:178 enables markdown html:true; BLOCK_TAGS includes iframe/svg/object/embed/script. No sanitizer exists in the repo. A note arriving by Git pull or Syncthing can execute script on open.'

New-SecurityIssue `
    "high" `
    "H-3: stored XSS — Mermaid fallback interpolates note text unescaped" `
    'MermaidBlock.tsx:24 (.catch) and :29 (pre-render fallback) interpolate raw block content into an HTML string fed to dangerouslySetInnerHTML, bypassing Mermaid''s own strict-mode sanitizer. Any invalid mermaid block is an injection point.'

New-SecurityIssue `
    "high" `
    "H-4: terminal_open / run_code / open_in_editor take the program name from frontend args" `
    'terminal.rs:57, code_run.rs:176, editor_launch.rs:117 each spawn a process whose executable comes from a frontend-supplied string (shell / python_command / cpp_compiler_command / template). The only gate is the renderer-side Set in src/store/codeRunConfirm.ts, which injected JS bypasses by calling invoke directly. Fix: read these from settings.json inside the Rust command.'

New-SecurityIssue `
    "high" `
    "H-5: save_settings persists unvalidated exec commands" `
    'settings.rs:48 writes a frontend-supplied AppSettings verbatim, including terminal_shell / python_command / cpp_compiler_command / editor_command — the four program names H-4 spawns. This lets an injected payload persist across restarts.'

New-SecurityIssue `
    "medium" `
    "M-1: note commands accept unbounded absolute paths" `
    'open_note (notes.rs:649), save_note (:716), delete_note (:1110), read_template (:1449) and export_pdf (printing.rs:208) use the caller''s path with no workspace containment. delete_note additionally uses remove_dir_all on four derived sidecar dirs. assets.rs::resolve_relative and editor_launch.rs::resolve_in_workspace already implement the needed check.'

New-SecurityIssue `
    "medium" `
    "M-2: @tiptap/* pinned below the fix for GHSA-cp6q-959q-f8rh" `
    'Installed @tiptap/core is 3.27.4; the advisory (mergeAttributes __proto__ -> inherited executable DOM attributes) covers versions below 3.30.4. The exact pins AND the overrides block in package.json must be bumped together — npm audit fix cannot move a pinned override.'

New-SecurityIssue `
    "medium" `
    "M-3: sqlx 0.7.4 — RUSTSEC-2024-0363" `
    'Binary-protocol misinterpretation via truncating/overflowing casts; patched in >= 0.8.1. Declared as sqlx = { version = "0.7" } in src-tauri/Cargo.toml.'

New-SecurityIssue `
    "medium" `
    "M-4: rustls-webpki 0.101.7 — RUSTSEC-2026-0098/0099/0104" `
    'Name-constraint bypasses (URI names, wildcard-asserting certs) and a reachable panic in CRL parsing. Reached via sqlx''s runtime-tokio-rustls; fixed by the M-3 bump.'

New-SecurityIssue `
    "medium" `
    "M-5: DivBlock serializer writes attributes without escaping quotes" `
    'DivBlock.ts:10-17 concatenates align/class/style into the saved markdown unescaped. A value containing a double quote injects arbitrary markup into the user''s .md, which fires wherever that file is rendered as HTML. Use encodeAttr from src/lib/htmlAttr.ts.'

New-SecurityIssue `
    "medium" `
    "M-6: git show builds its revision argument by interpolation" `
    'git.rs:541 does .arg(format!("{sha}:{relative_git}")) with an unvalidated frontend sha — the one interpolated argument in an otherwise strictly argv-style module. Validate against ^[0-9a-fA-F]{7,40}$.'

New-SecurityIssue `
    "low" `
    "L-1: no JS/TS linter in the repo or in CI" `
    'No eslint/biome/oxlint config or devDependency. CI runs tsc, vitest and clippy but nothing that inspects JS DOM sinks; react/no-danger + eslint-plugin-no-unsanitized would have flagged H-2 and H-3.'

New-SecurityIssue `
    "low" `
    "L-2: 15 high npm advisories in the @wdio e2e dev tree" `
    'extract-zip symlink traversal (8.1), serialize-javascript RCE (8.1), lodash-es _.template code injection (8.1), nanoid overflow (7.4) — all dev-only, all pinned by @wdio/tauri-service. npm audit''s fix is a semver-major downgrade, so this needs a deliberate look.'

New-SecurityIssue `
    "low" `
    "L-3: assorted Rust advisories + add cargo-audit to CI" `
    'Patchable: anyhow 1.0.102 (RUSTSEC-2026-0190), event-listener 5.4.1 (-0221), crossbeam-epoch 0.9.18 (-0204), quick-xml 0.39.4 (-0194/-0195). Unmaintained: gtk-rs 0.18 bindings, ring, paste, proc-macro-error, dirs, unic-*. Adding cargo audit next to the clippy step would catch this class unaided.'

New-SecurityIssue `
    "low" `
    "L-4: format.yml holds contents: write and pushes" `
    'workflow_dispatch-only today, which bounds it well. Noted only because it is the one write-capable workflow; revisit if it ever gains a pull_request trigger.'

Write-Host "Done."

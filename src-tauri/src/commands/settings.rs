use crate::models::AppSettings;
use std::path::Path;
use tauri::{AppHandle, Manager};

const SETTINGS_FILE: &str = "settings.json";

pub(crate) async fn load_settings_from_dir(dir: &Path) -> anyhow::Result<AppSettings> {
    let file = dir.join(SETTINGS_FILE);
    let mut settings = if file.exists() {
        serde_json::from_str(&tokio::fs::read_to_string(&file).await?)?
    } else {
        AppSettings::default()
    };
    // Detected on load rather than baked into the default, so a machine that
    // gains an editor picks it up without the user editing a template. A
    // template the user has typed is never overwritten.
    if settings.editor_command.trim().is_empty() {
        settings.editor_command = super::editor_launch::detect_editor_command();
    }
    if settings.terminal_shell.trim().is_empty() {
        settings.terminal_shell = super::terminal::detect_terminal_shell();
    }
    if settings.python_command.trim().is_empty() {
        settings.python_command = super::code_run::detect_python_command();
    }
    if settings.cpp_compiler_command.trim().is_empty() {
        settings.cpp_compiler_command = super::code_run::detect_cpp_compiler_command();
    }
    Ok(settings)
}

async fn save_settings_to_dir(dir: &Path, settings: &AppSettings) -> anyhow::Result<()> {
    tokio::fs::create_dir_all(dir).await?;
    let json = serde_json::to_string_pretty(settings)?;
    tokio::fs::write(dir.join(SETTINGS_FILE), json).await?;
    Ok(())
}

#[tauri::command]
pub async fn load_settings(app: AppHandle) -> Result<AppSettings, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    load_settings_from_dir(&dir)
        .await
        .map_err(|e| e.to_string())
}

/// Reads settings straight from disk for a command that needs one of the
/// exec-related fields (terminal shell, run-code interpreter/compiler, editor
/// template) — the values themselves never travel through the IPC call that
/// spawns a process (H-4), so a note's own injected script cannot choose what
/// runs by passing a different string as an argument.
pub(crate) async fn resolve_settings(app: &AppHandle) -> Result<AppSettings, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    load_settings_from_dir(&dir)
        .await
        .map_err(|e| e.to_string())
}

/// Rejects an exec-related field whose program does not resolve on `PATH`
/// (H-5) — otherwise a value written once by an injected script would keep
/// spawning that program on every future terminal/run/editor launch, long
/// after the script that wrote it is gone. Empty is allowed: it means
/// "undetected yet," and `load_settings_from_dir` fills it in on next load.
fn validate_exec_field(label: &str, value: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Ok(());
    }
    let program = super::editor_launch::tokenize(value);
    let program = program.first().ok_or_else(|| format!("{label} is empty"))?;
    if !super::editor_launch::is_on_path(program) {
        return Err(format!("{label} does not resolve on PATH: {program}"));
    }
    Ok(())
}

#[tauri::command]
pub async fn save_settings(app: AppHandle, settings: AppSettings) -> Result<(), String> {
    validate_exec_field("editorCommand", &settings.editor_command)?;
    validate_exec_field("terminalShell", &settings.terminal_shell)?;
    validate_exec_field("pythonCommand", &settings.python_command)?;
    validate_exec_field("cppCompilerCommand", &settings.cpp_compiler_command)?;

    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    save_settings_to_dir(&dir, &settings)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_load_missing_returns_defaults() {
        let dir = tempdir().unwrap();
        let settings = load_settings_from_dir(dir.path()).await.unwrap();
        assert_eq!(settings.autosave_debounce_ms, 600);
        assert_eq!(settings.editor_max_width_px, 800);
    }

    #[tokio::test]
    async fn test_roundtrip() {
        let dir = tempdir().unwrap();
        let original = AppSettings {
            autosave_debounce_ms: 1200,
            editor_max_width_px: 960,
            spellcheck: true,
            spellcheck_language: "en".to_string(),
            pdf_import_mode: crate::models::PdfImportMode::Markdown,
            editor_command: "nvim +{line} {file}".to_string(),
            terminal_shell: "wsl -d Ubuntu".to_string(),
            code_indent_width: 4,
            code_indent_char: crate::models::CodeIndentChar::Tab,
            code_theme: crate::models::CodeTheme::OneDark,
            code_font_size_px: 16,
            python_command: "python3.11".to_string(),
            cpp_compiler_command: "clang++".to_string(),
            code_run_timeout_secs: 30,
        };
        save_settings_to_dir(dir.path(), &original).await.unwrap();
        let loaded = load_settings_from_dir(dir.path()).await.unwrap();
        assert_eq!(loaded.autosave_debounce_ms, 1200);
        assert_eq!(loaded.editor_max_width_px, 960);
        assert!(loaded.spellcheck);
        assert_eq!(loaded.spellcheck_language, "en");
        assert_eq!(loaded.editor_command, "nvim +{line} {file}");
        assert_eq!(
            loaded.pdf_import_mode,
            crate::models::PdfImportMode::Markdown
        );
        assert_eq!(loaded.terminal_shell, "wsl -d Ubuntu");
        assert_eq!(loaded.code_indent_width, 4);
        assert_eq!(loaded.code_indent_char, crate::models::CodeIndentChar::Tab);
        assert_eq!(loaded.code_theme, crate::models::CodeTheme::OneDark);
        assert_eq!(loaded.code_font_size_px, 16);
        assert_eq!(loaded.python_command, "python3.11");
        assert_eq!(loaded.cpp_compiler_command, "clang++");
        assert_eq!(loaded.code_run_timeout_secs, 30);
    }

    // Detection fills the editor command only when there is nothing to keep.
    // Silently replacing a template the user typed would make the setting feel
    // broken on any machine that also has VS Code installed.
    #[tokio::test]
    async fn test_a_configured_editor_command_survives_detection() {
        let dir = tempdir().unwrap();
        let mut settings = AppSettings::default();
        settings.editor_command = "subl {file}:{line}".to_string();
        save_settings_to_dir(dir.path(), &settings).await.unwrap();

        let loaded = load_settings_from_dir(dir.path()).await.unwrap();

        assert_eq!(loaded.editor_command, "subl {file}:{line}");
    }

    #[tokio::test]
    async fn test_an_empty_editor_command_is_filled_in_on_load() {
        let dir = tempdir().unwrap();
        tokio::fs::write(
            dir.path().join(SETTINGS_FILE),
            r#"{"autosaveDebounceMs":600,"editorMaxWidthPx":800}"#,
        )
        .await
        .unwrap();

        let loaded = load_settings_from_dir(dir.path()).await.unwrap();

        assert!(
            loaded.editor_command.contains("{file}"),
            "got {:?}",
            loaded.editor_command
        );
    }

    #[tokio::test]
    async fn test_an_empty_terminal_shell_is_filled_in_on_load() {
        let dir = tempdir().unwrap();
        tokio::fs::write(
            dir.path().join(SETTINGS_FILE),
            r#"{"autosaveDebounceMs":600,"editorMaxWidthPx":800}"#,
        )
        .await
        .unwrap();

        let loaded = load_settings_from_dir(dir.path()).await.unwrap();

        assert!(
            !loaded.terminal_shell.trim().is_empty(),
            "got {:?}",
            loaded.terminal_shell
        );
    }

    // A shell the user typed is never replaced by detection, same guarantee
    // P7-4 gives editor_command.
    #[tokio::test]
    async fn test_a_configured_terminal_shell_survives_detection() {
        let dir = tempdir().unwrap();
        let mut settings = AppSettings::default();
        settings.terminal_shell = "wsl -d Ubuntu".to_string();
        save_settings_to_dir(dir.path(), &settings).await.unwrap();

        let loaded = load_settings_from_dir(dir.path()).await.unwrap();

        assert_eq!(loaded.terminal_shell, "wsl -d Ubuntu");
    }

    #[tokio::test]
    async fn test_an_empty_python_command_is_filled_in_on_load() {
        let dir = tempdir().unwrap();
        tokio::fs::write(
            dir.path().join(SETTINGS_FILE),
            r#"{"autosaveDebounceMs":600,"editorMaxWidthPx":800}"#,
        )
        .await
        .unwrap();

        let loaded = load_settings_from_dir(dir.path()).await.unwrap();

        assert!(
            !loaded.python_command.trim().is_empty(),
            "got {:?}",
            loaded.python_command
        );
    }

    // A command the user typed is never replaced by detection, same
    // guarantee P7-4 gives editor_command.
    #[tokio::test]
    async fn test_a_configured_python_command_survives_detection() {
        let dir = tempdir().unwrap();
        let mut settings = AppSettings::default();
        settings.python_command = "python3.11".to_string();
        save_settings_to_dir(dir.path(), &settings).await.unwrap();

        let loaded = load_settings_from_dir(dir.path()).await.unwrap();

        assert_eq!(loaded.python_command, "python3.11");
    }

    #[tokio::test]
    async fn test_an_empty_cpp_compiler_command_is_filled_in_on_load() {
        let dir = tempdir().unwrap();
        tokio::fs::write(
            dir.path().join(SETTINGS_FILE),
            r#"{"autosaveDebounceMs":600,"editorMaxWidthPx":800}"#,
        )
        .await
        .unwrap();

        let loaded = load_settings_from_dir(dir.path()).await.unwrap();

        assert!(
            !loaded.cpp_compiler_command.trim().is_empty(),
            "got {:?}",
            loaded.cpp_compiler_command
        );
    }

    // A settings.json written before spellcheck existed must still load, or
    // the app comes up with an error instead of the user's preferences.
    #[tokio::test]
    async fn test_load_tolerates_a_file_missing_newer_fields() {
        let dir = tempdir().unwrap();
        tokio::fs::write(
            dir.path().join(SETTINGS_FILE),
            r#"{"autosaveDebounceMs":900,"editorMaxWidthPx":1000}"#,
        )
        .await
        .unwrap();

        let loaded = load_settings_from_dir(dir.path()).await.unwrap();

        assert_eq!(loaded.autosave_debounce_ms, 900);
        assert!(!loaded.spellcheck);
        assert_eq!(loaded.pdf_import_mode, crate::models::PdfImportMode::Pages);
        // Not the empty string String::default() would give: an absent tag has
        // to mean the same as a fresh install, or an older settings.json comes
        // back with no dictionary chosen at all.
        assert_eq!(loaded.spellcheck_language, "de");
        // Same guarantee for P11-3: a settings.json from before this setting
        // existed must load as the 2-space behavior every code block already
        // had, not some other implicit width.
        assert_eq!(loaded.code_indent_width, 2);
        assert_eq!(
            loaded.code_indent_char,
            crate::models::CodeIndentChar::Space
        );
        // Same guarantee for P11-4: an older settings.json loads into the one
        // palette/size every code block already had, not some other implicit
        // theme or a font size that doesn't match what was already on screen.
        assert_eq!(loaded.code_theme, crate::models::CodeTheme::MaterialOcean);
        assert_eq!(loaded.code_font_size_px, 13);
        // Same guarantee for P10-2: an older settings.json loads with the
        // one timeout every run has always implicitly had, not 0.
        assert_eq!(loaded.code_run_timeout_secs, 10);
    }

    #[test]
    fn validate_exec_field_allows_empty() {
        assert!(validate_exec_field("editorCommand", "").is_ok());
        assert!(validate_exec_field("editorCommand", "   ").is_ok());
    }

    #[test]
    fn validate_exec_field_allows_a_program_on_path() {
        // cargo is on PATH by definition wherever `cargo test` runs.
        assert!(validate_exec_field("editorCommand", "cargo --version").is_ok());
    }

    #[test]
    fn validate_exec_field_rejects_a_program_not_on_path() {
        assert!(validate_exec_field("editorCommand", "definitely-not-a-real-binary-zzz").is_err());
    }

    #[tokio::test]
    async fn test_save_creates_the_app_data_dir_if_missing() {
        let parent = tempdir().unwrap();
        let dir = parent.path().join("nested").join("app-data");
        save_settings_to_dir(&dir, &AppSettings::default())
            .await
            .unwrap();
        assert!(dir.join(SETTINGS_FILE).exists());
    }
}

use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrinterInfo {
    pub name: String,
    pub is_default: bool,
}

/// Pairs enumerated printer names with which one Windows currently reports
/// as default. Pure and platform-independent on purpose — the actual
/// spooler calls below have no live printer in CI (same shape as
/// `pdf/dump.rs`'s `#[ignore]`d diagnostics), so this is the one piece of
/// this file that gets a real, always-running test.
#[cfg_attr(not(windows), allow(dead_code))]
fn mark_default(names: Vec<String>, default: Option<&str>) -> Vec<PrinterInfo> {
    names
        .into_iter()
        .map(|name| {
            let is_default = default == Some(name.as_str());
            PrinterInfo { name, is_default }
        })
        .collect()
}

#[cfg(windows)]
fn enum_printer_names() -> windows::core::Result<Vec<String>> {
    use windows::core::PCWSTR;
    use windows::Win32::Graphics::Printing::{EnumPrintersW, PRINTER_ENUM_LOCAL, PRINTER_INFO_4W};

    let mut needed = 0u32;
    let mut returned = 0u32;
    unsafe {
        // Sizing call: this is expected to fail (ERROR_INSUFFICIENT_BUFFER)
        // but Windows fills `needed` with the required byte count anyway —
        // that's the documented way to size the real call's buffer.
        let _ = EnumPrintersW(
            PRINTER_ENUM_LOCAL,
            PCWSTR::null(),
            4,
            None,
            &mut needed,
            &mut returned,
        );
        if needed == 0 {
            return Ok(Vec::new());
        }
        let mut buf = vec![0u8; needed as usize];
        EnumPrintersW(
            PRINTER_ENUM_LOCAL,
            PCWSTR::null(),
            4,
            Some(&mut buf),
            &mut needed,
            &mut returned,
        )?;
        // `buf` holds `returned` fixed-size PRINTER_INFO_4W structs; each
        // name pointer points back into this same buffer, so the strings
        // must be copied out before `buf` drops.
        let infos =
            std::slice::from_raw_parts(buf.as_ptr().cast::<PRINTER_INFO_4W>(), returned as usize);
        Ok(infos
            .iter()
            .filter_map(|info| PCWSTR(info.pPrinterName.0 as *const u16).to_string().ok())
            .collect())
    }
}

#[cfg(windows)]
fn default_printer_name() -> Option<String> {
    use windows::core::PCWSTR;
    use windows::core::PWSTR;
    use windows::Win32::Graphics::Printing::GetDefaultPrinterW;

    let mut len = 0u32;
    unsafe {
        // Same sizing dance as EnumPrintersW: the first call fails but
        // reports the needed length (in wide chars, including the NUL).
        let _ = GetDefaultPrinterW(None, &mut len);
        if len == 0 {
            return None;
        }
        let mut buf = vec![0u16; len as usize];
        if !GetDefaultPrinterW(Some(PWSTR(buf.as_mut_ptr())), &mut len).as_bool() {
            return None;
        }
        PCWSTR(buf.as_ptr()).to_string().ok()
    }
}

#[tauri::command]
pub fn list_printers() -> Result<Vec<PrinterInfo>, String> {
    #[cfg(windows)]
    {
        let names = enum_printer_names().map_err(|e| e.to_string())?;
        Ok(mark_default(names, default_printer_name().as_deref()))
    }
    #[cfg(not(windows))]
    {
        Err("Printing is only supported on Windows.".to_string())
    }
}

#[cfg_attr(not(windows), allow(dead_code))]
const A4_WIDTH_IN: f64 = 210.0 / 25.4;
#[cfg_attr(not(windows), allow(dead_code))]
const A4_HEIGHT_IN: f64 = 297.0 / 25.4;

#[cfg(windows)]
fn build_print_settings(
    core_webview: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2,
    printer_name: Option<&str>,
) -> windows::core::Result<webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2PrintSettings>
{
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Environment6, ICoreWebView2PrintSettings2, ICoreWebView2_2,
    };
    use windows::core::{Interface, HSTRING};

    unsafe {
        let environment = core_webview.cast::<ICoreWebView2_2>()?.Environment()?;
        let settings = environment
            .cast::<ICoreWebView2Environment6>()?
            .CreatePrintSettings()?;
        // Paged.js renders its own running headers/footers now (see
        // docs/specs/better-printing-design.md) — WebView2's native,
        // all-or-nothing bundle stays off unconditionally.
        settings.SetShouldPrintHeaderAndFooter(false)?;
        // Fixed A4 size with zero WebView2-side margin so a Paged.js
        // page (which sets its own `@page { size: A4; margin: 20mm }`)
        // maps to exactly one physical page — Paged.js's margin is the
        // only margin in effect.
        settings.SetPageWidth(A4_WIDTH_IN)?;
        settings.SetPageHeight(A4_HEIGHT_IN)?;
        settings.SetMarginTop(0.0)?;
        settings.SetMarginBottom(0.0)?;
        settings.SetMarginLeft(0.0)?;
        settings.SetMarginRight(0.0)?;
        if let Some(name) = printer_name {
            settings
                .cast::<ICoreWebView2PrintSettings2>()?
                .SetPrinterName(&HSTRING::from(name))?;
        }
        Ok(settings)
    }
}

/// Runs `f` on the webview's own COM apartment and blocks the calling
/// thread until it's done. `WebviewWindow::with_webview` only runs its
/// closure inline when called *from* the main thread — from anywhere else
/// (this is always called from inside `spawn_blocking`, i.e. a worker
/// thread) it just posts the closure to the event loop and returns
/// immediately. Without this channel, the command would report success
/// before the print/export had even started.
#[cfg(windows)]
fn run_on_main_webview<T: Send + 'static>(
    webview: &tauri::WebviewWindow,
    f: impl FnOnce(webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2) -> Result<T, String>
        + Send
        + 'static,
) -> Result<T, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    webview
        .with_webview(move |platform_webview| {
            let outcome = unsafe { platform_webview.controller().CoreWebView2() }
                .map_err(|e| e.to_string())
                .and_then(f);
            let _ = tx.send(outcome);
        })
        .map_err(|e| e.to_string())?;
    rx.recv()
        .map_err(|_| "the print operation never completed".to_string())?
}

#[cfg(windows)]
fn export_pdf_sync(app: &tauri::AppHandle, path: String) -> Result<(), String> {
    use tauri::Manager;
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_7;
    use webview2_com::PrintToPdfCompletedHandler;
    use windows::core::{Interface, HSTRING};

    let webview = app
        .get_webview_window("main")
        .ok_or("main window not found")?;
    run_on_main_webview(&webview, move |core_webview| unsafe {
        let settings = build_print_settings(&core_webview, None).map_err(|e| e.to_string())?;
        let core_webview_7 = core_webview
            .cast::<ICoreWebView2_7>()
            .map_err(|e| e.to_string())?;
        let path_hstring = HSTRING::from(path.as_str());
        PrintToPdfCompletedHandler::wait_for_async_operation(
            Box::new(move |handler| {
                core_webview_7
                    .PrintToPdf(&path_hstring, &settings, &handler)
                    .map_err(webview2_com::Error::from)
            }),
            Box::new(|hresult: windows::core::Result<()>, succeeded: bool| {
                hresult?;
                if succeeded {
                    Ok(())
                } else {
                    Err(windows::core::Error::new(
                        windows::core::HRESULT(0x8000_4005_u32 as i32),
                        "PrintToPdf reported failure",
                    ))
                }
            }),
        )
        .map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub async fn export_pdf(app: tauri::AppHandle, path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        tokio::task::spawn_blocking(move || export_pdf_sync(&app, path))
            .await
            .map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (app, path);
        Err("Printing is only supported on Windows.".to_string())
    }
}

#[cfg(windows)]
fn print_document_sync(app: &tauri::AppHandle, printer_name: String) -> Result<(), String> {
    use tauri::Manager;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_16, COREWEBVIEW2_PRINT_STATUS, COREWEBVIEW2_PRINT_STATUS_SUCCEEDED,
    };
    use webview2_com::PrintCompletedHandler;
    use windows::core::Interface;

    let webview = app
        .get_webview_window("main")
        .ok_or("main window not found")?;
    run_on_main_webview(&webview, move |core_webview| unsafe {
        let settings =
            build_print_settings(&core_webview, Some(&printer_name)).map_err(|e| e.to_string())?;
        let core_webview_16 = core_webview
            .cast::<ICoreWebView2_16>()
            .map_err(|e| e.to_string())?;
        PrintCompletedHandler::wait_for_async_operation(
            Box::new(move |handler| {
                core_webview_16
                    .Print(&settings, &handler)
                    .map_err(webview2_com::Error::from)
            }),
            Box::new(
                |hresult: windows::core::Result<()>, status: COREWEBVIEW2_PRINT_STATUS| {
                    hresult?;
                    if status == COREWEBVIEW2_PRINT_STATUS_SUCCEEDED {
                        Ok(())
                    } else {
                        Err(windows::core::Error::new(
                            windows::core::HRESULT(0x8000_4005_u32 as i32),
                            "Print reported failure",
                        ))
                    }
                },
            ),
        )
        .map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub async fn print_document(app: tauri::AppHandle, printer_name: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        tokio::task::spawn_blocking(move || print_document_sync(&app, printer_name))
            .await
            .map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (app, printer_name);
        Err("Printing is only supported on Windows.".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_size_is_a4_in_inches() {
        assert!((A4_WIDTH_IN - 8.2677).abs() < 1e-4);
        assert!((A4_HEIGHT_IN - 11.6929).abs() < 1e-4);
    }

    #[test]
    fn marks_the_matching_name_as_default() {
        let printers = mark_default(vec!["A".to_string(), "B".to_string()], Some("B"));
        assert_eq!(
            printers,
            vec![
                PrinterInfo {
                    name: "A".to_string(),
                    is_default: false
                },
                PrinterInfo {
                    name: "B".to_string(),
                    is_default: true
                },
            ]
        );
    }

    #[test]
    fn no_default_when_none_matches() {
        let printers = mark_default(vec!["A".to_string()], Some("Z"));
        assert!(!printers[0].is_default);
    }

    #[test]
    fn no_default_when_none_reported() {
        let printers = mark_default(vec!["A".to_string()], None);
        assert!(!printers[0].is_default);
    }
}

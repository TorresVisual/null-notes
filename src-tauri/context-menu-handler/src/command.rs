use std::ffi::c_void;
use windows::core::{implement, Ref, Result, BOOL, GUID, PWSTR};
use windows::Win32::Foundation::{E_FAIL, HMODULE};
use windows::Win32::System::Com::{CoTaskMemAlloc, CoTaskMemFree, IBindCtx};
use windows::Win32::System::LibraryLoader::{
    GetModuleFileNameW, GetModuleHandleExW, GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS,
};
use windows::Win32::UI::Shell::{
    IEnumExplorerCommand, IExplorerCommand, IExplorerCommand_Impl, IShellItemArray,
    SIGDN_FILESYSPATH,
};

/// Matches the `Clsid` on the `desktop4:Verb` / `com:Class` elements in
/// `identity-package/AppxManifest.xml` (Task 4) — the two must stay in sync
/// by hand; there is no build-time link between them.
pub const COMMAND_CLSID: GUID = GUID::from_u128(0x013EFF9A_2F31_47CE_87BC_B0D2A19189C5u128);

#[implement(IExplorerCommand)]
pub struct OpenInNullNotesCommand;

fn cotaskmem_wide(s: &str) -> Result<PWSTR> {
    let wide: Vec<u16> = s.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        let buf = CoTaskMemAlloc(wide.len() * size_of::<u16>()) as *mut u16;
        if buf.is_null() {
            return Err(windows::core::Error::from(E_FAIL));
        }
        std::ptr::copy_nonoverlapping(wide.as_ptr(), buf, wide.len());
        Ok(PWSTR(buf))
    }
}

impl IExplorerCommand_Impl for OpenInNullNotesCommand_Impl {
    fn GetTitle(&self, _psiitemarray: Ref<'_, IShellItemArray>) -> Result<PWSTR> {
        cotaskmem_wide("Open in null-notes")
    }

    fn GetIcon(&self, _psiitemarray: Ref<'_, IShellItemArray>) -> Result<PWSTR> {
        // No icon: an empty PWSTR is the documented "no icon" signal.
        Ok(PWSTR::null())
    }

    fn GetToolTip(&self, _psiitemarray: Ref<'_, IShellItemArray>) -> Result<PWSTR> {
        Ok(PWSTR::null())
    }

    fn GetCanonicalName(&self) -> Result<GUID> {
        Ok(COMMAND_CLSID)
    }

    fn GetState(
        &self,
        _psiitemarray: Ref<'_, IShellItemArray>,
        _ok_to_be_slow: BOOL,
    ) -> Result<u32> {
        Ok(0) // ECS_ENABLED
    }

    fn GetFlags(&self) -> Result<u32> {
        Ok(0) // ECF_DEFAULT — a single flat verb, no submenu/separator/etc.
    }

    fn Invoke(
        &self,
        psiitemarray: Ref<'_, IShellItemArray>,
        _pbc: Ref<'_, IBindCtx>,
    ) -> Result<()> {
        let Some(items) = psiitemarray.as_ref() else {
            return Ok(());
        };
        let count = unsafe { items.GetCount()? };
        for i in 0..count {
            let item = unsafe { items.GetItemAt(i)? };
            let path_ptr = unsafe { item.GetDisplayName(SIGDN_FILESYSPATH)? };
            let path = unsafe {
                path_ptr
                    .to_string()
                    .map_err(|_| windows::core::Error::from(E_FAIL))?
            };
            unsafe { CoTaskMemFree(Some(path_ptr.0 as *const c_void)) };
            launch_null_notes(&path);
        }
        Ok(())
    }

    fn EnumSubCommands(&self) -> Result<IEnumExplorerCommand> {
        Err(windows::core::Error::from(
            windows::Win32::Foundation::E_NOTIMPL,
        ))
    }
}

/// A loaded DLL must ask Windows for its own module handle to find its own
/// path — `current_exe()` inside a DLL returns the *host* process's exe
/// (the COM surrogate), not this DLL.
fn this_dll_directory() -> Option<std::path::PathBuf> {
    unsafe {
        let mut module = HMODULE::default();
        GetModuleHandleExW(
            GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS,
            windows::core::PCWSTR(this_dll_directory as *const () as *const u16),
            &mut module,
        )
        .ok()?;
        let mut buf = [0u16; 260];
        let len = GetModuleFileNameW(Some(module), &mut buf);
        if len == 0 {
            return None;
        }
        let path = String::from_utf16_lossy(&buf[..len as usize]);
        std::path::Path::new(&path)
            .parent()
            .map(|p| p.to_path_buf())
    }
}

/// Launches the main app pointed at `path` — a folder becomes the workspace
/// directly; a file goes through `--open-file=`, matching the flags
/// `commands::workspace::initial_workspace_from_args`/`open_file_from_args`
/// already parse in `src-tauri` (Task 1, Task 6).
///
/// ponytail: locates the app exe next to this DLL (both live in the same
/// install/ExternalLocation directory per Task 4's manifest) rather than
/// reading it from the registry — one less moving part, since the
/// manifest's ExternalLocation already guarantees this DLL only ever loads
/// from that directory.
fn launch_null_notes(path: &str) {
    let Some(dir) = this_dll_directory() else {
        return;
    };
    let flag = if std::path::Path::new(path).is_dir() {
        format!("--workspace={path}")
    } else {
        format!("--open-file={path}")
    };
    let _ = std::process::Command::new(dir.join("null-notes.exe"))
        .arg(flag)
        .spawn();
}

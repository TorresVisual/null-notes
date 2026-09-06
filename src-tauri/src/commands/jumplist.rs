#![cfg(windows)]

use windows::core::{Interface, Result, HSTRING, PWSTR};
use windows::Win32::Foundation::E_FAIL;
use windows::Win32::Storage::EnhancedStorage::PKEY_Title;
use windows::Win32::System::Com::StructuredStorage::{
    PropVariantClear, PROPVARIANT, PROPVARIANT_0, PROPVARIANT_0_0, PROPVARIANT_0_0_0,
};
use windows::Win32::System::Com::{CoCreateInstance, CoTaskMemAlloc, CLSCTX_INPROC_SERVER};
use windows::Win32::System::Variant::VT_LPWSTR;
use windows::Win32::UI::Shell::Common::{IObjectArray, IObjectCollection};
use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;
use windows::Win32::UI::Shell::{
    DestinationList, EnumerableObjectCollection, ICustomDestinationList, IShellLinkW, ShellLink,
};

pub fn folder_name(path: &str) -> String {
    std::path::Path::new(path)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string())
}

// windows-rs only binds actual propsys.dll exports, and InitPropVariantFromString
// is a header-only inline in the Windows SDK (not a real export), so it isn't
// available here — build the VT_LPWSTR PROPVARIANT by hand instead. The caller
// must PropVariantClear it after SetValue returns (SetValue copies the string).
unsafe fn make_title_propvariant(title: &str) -> Result<PROPVARIANT> {
    let wide: Vec<u16> = title.encode_utf16().chain(std::iter::once(0)).collect();
    let buf = CoTaskMemAlloc(wide.len() * size_of::<u16>()) as *mut u16;
    if buf.is_null() {
        return Err(windows::core::Error::from(E_FAIL));
    }
    std::ptr::copy_nonoverlapping(wide.as_ptr(), buf, wide.len());
    Ok(PROPVARIANT {
        Anonymous: PROPVARIANT_0 {
            Anonymous: core::mem::ManuallyDrop::new(PROPVARIANT_0_0 {
                vt: VT_LPWSTR,
                wReserved1: 0,
                wReserved2: 0,
                wReserved3: 0,
                Anonymous: PROPVARIANT_0_0_0 {
                    pwszVal: PWSTR(buf),
                },
            }),
        },
    })
}

/// Rebuilds the taskbar icon's "Recent Workspaces" jump-list category from
/// `recents` (already most-recent-first, already capped by the caller).
/// Every step past `BeginList` is fallible; on any `Err` this returns early
/// without calling `CommitList`, so a partial failure leaves the previous
/// jump list in place rather than a half-built one.
pub fn rebuild(recents: &[String]) -> Result<()> {
    let exe = std::env::current_exe().map_err(|_| windows::core::Error::from(E_FAIL))?;
    let exe = HSTRING::from(exe.as_os_str());

    unsafe {
        let list: ICustomDestinationList =
            CoCreateInstance(&DestinationList, None, CLSCTX_INPROC_SERVER)?;
        let mut max_slots: u32 = 0;
        let _removed: IObjectArray = list.BeginList(&mut max_slots)?;

        let collection: IObjectCollection =
            CoCreateInstance(&EnumerableObjectCollection, None, CLSCTX_INPROC_SERVER)?;

        for path in recents {
            let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
            link.SetPath(&exe)?;
            link.SetArguments(&HSTRING::from(format!("--workspace=\"{path}\"")))?;
            link.SetIconLocation(&exe, 0)?;

            let store: IPropertyStore = link.cast()?;
            let mut title = make_title_propvariant(&folder_name(path))?;
            store.SetValue(&PKEY_Title, &title)?;
            store.Commit()?;
            PropVariantClear(&mut title)?;

            collection.AddObject(&link)?;
        }

        let object_array: IObjectArray = collection.cast()?;
        list.AppendCategory(&HSTRING::from("Recent Workspaces"), &object_array)?;
        list.CommitList()?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_folder_name_takes_the_last_component() {
        assert_eq!(folder_name(r"C:\notes\Lecture 7"), "Lecture 7");
    }

    #[test]
    fn test_folder_name_falls_back_to_the_whole_path_for_a_drive_root() {
        assert_eq!(folder_name(r"C:\"), r"C:\");
    }
}

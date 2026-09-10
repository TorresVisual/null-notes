use windows::core::GUID;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
    COINIT_APARTMENTTHREADED,
};
use windows::Win32::System::Registry::{
    RegCloseKey, RegCreateKeyExW, RegDeleteTreeW, RegSetValueExW, HKEY, HKEY_CURRENT_USER,
    KEY_WRITE, REG_OPTION_NON_VOLATILE, REG_SZ,
};
use windows::core::HSTRING;

use null_notes_context_menu::SPIKE_CLSID;

fn clsid_key_path(clsid: &GUID) -> String {
    format!(r"Software\Classes\CLSID\{{{clsid:?}}}\InprocServer32")
}

fn wide_null(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn register_test_dll(clsid: &GUID) {
    let dll_path = std::env::current_exe()
        .unwrap()
        .parent()
        .unwrap()
        .join("null_notes_context_menu.dll");
    let mut hkey = HKEY::default();
    unsafe {
        RegCreateKeyExW(
            HKEY_CURRENT_USER,
            &HSTRING::from(clsid_key_path(clsid)),
            None,
            windows::core::PCWSTR::null(),
            REG_OPTION_NON_VOLATILE,
            KEY_WRITE,
            None,
            &mut hkey,
            None,
        )
        .ok()
        .unwrap();
        let data = wide_null(&dll_path.to_string_lossy());
        let bytes = std::slice::from_raw_parts(data.as_ptr().cast::<u8>(), data.len() * 2);
        RegSetValueExW(hkey, windows::core::PCWSTR::null(), None, REG_SZ, Some(bytes))
            .ok()
            .unwrap();
        RegCloseKey(hkey).ok().unwrap();
    }
}

fn unregister_test_dll(clsid: &GUID) {
    unsafe {
        let _ = RegDeleteTreeW(
            HKEY_CURRENT_USER,
            &HSTRING::from(format!(r"Software\Classes\CLSID\{{{clsid:?}}}")),
        );
    }
}

#[test]
fn test_dllgetclassobject_chain_activates_through_real_com() {
    register_test_dll(&SPIKE_CLSID);

    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok().unwrap();
        let result: windows::core::Result<windows::core::IUnknown> =
            CoCreateInstance(&SPIKE_CLSID, None, CLSCTX_INPROC_SERVER);
        // The COM object must be released before CoUninitialize() tears down
        // the apartment — dropping it after would call Release() into a
        // torn-down apartment and access-violate.
        let obj = result.expect("CoCreateInstance must succeed against the just-registered spike DLL");
        drop(obj);
        CoUninitialize();
        unregister_test_dll(&SPIKE_CLSID);
    }
}

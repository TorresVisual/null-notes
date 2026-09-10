mod command;
mod factory;

pub use command::{OpenInNullNotesCommand, COMMAND_CLSID};
pub use factory::{class_object, SPIKE_CLSID};

use std::ffi::c_void;
use windows::core::{GUID, HRESULT};
use windows::Win32::Foundation::S_FALSE;

/// # Safety
/// Called by COM with a valid `rclsid`/`riid`/`ppv` per the `DllGetClassObject`
/// contract; this function trusts that contract, as every COM server does.
#[no_mangle]
unsafe extern "system" fn DllGetClassObject(
    rclsid: *const GUID,
    riid: *const GUID,
    ppv: *mut *mut c_void,
) -> HRESULT {
    if rclsid.is_null() || riid.is_null() {
        return windows::Win32::Foundation::E_POINTER;
    }
    factory::class_object(&*rclsid, &*riid, ppv)
}

#[no_mangle]
extern "system" fn DllCanUnloadNow() -> HRESULT {
    // ponytail: always "still in use". The surrogate host (Task 4) is a
    // short-lived per-invocation process, so never unloading early is
    // harmless — it exits with the process. Revisit only if this DLL is
    // ever hosted in a long-lived process instead.
    S_FALSE
}

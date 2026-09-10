use std::ffi::c_void;
use windows::core::{implement, GUID, HRESULT, Interface, IUnknown};
use windows::Win32::Foundation::{CLASS_E_CLASSNOTAVAILABLE, E_POINTER, S_OK};
use windows::Win32::System::Com::{IClassFactory, IClassFactory_Impl};

/// Test-only CLSID for this spike — never registered outside `tests/`.
/// Generated once with `[guid]::NewGuid()`, not meaningful beyond uniqueness.
pub const SPIKE_CLSID: GUID = GUID::from_u128(0x7C1E2B4A_5D3F_4A6E_9C21_0B1F2E3D4A5Bu128);

// No interfaces named: `#[implement]` always gives every type a working
// IUnknown, so a "trivial COM object with only identity" needs nothing else.
#[implement()]
pub struct SpikeObject;

#[implement(IClassFactory)]
pub struct ClassFactory {
    clsid: GUID,
}

impl ClassFactory {
    pub fn new(clsid: GUID) -> Self {
        Self { clsid }
    }
}

impl IClassFactory_Impl for ClassFactory_Impl {
    fn CreateInstance(
        &self,
        outer: windows::core::Ref<'_, IUnknown>,
        riid: *const GUID,
        ppv: *mut *mut c_void,
    ) -> windows::core::Result<()> {
        if outer.is_some() {
            // Aggregation isn't supported — no caller of this class needs it.
            return Err(windows::core::Error::from(
                windows::Win32::Foundation::CLASS_E_NOAGGREGATION,
            ));
        }
        let unknown: IUnknown = SpikeObject.into();
        unsafe { unknown.query(&*riid, ppv).ok() }
    }

    fn LockServer(&self, _lock: windows::core::BOOL) -> windows::core::Result<()> {
        Ok(())
    }
}

/// The actual `DllGetClassObject` dispatch logic, factored out so the real
/// export (in `lib.rs`) stays a thin `extern "system"` wrapper and this part
/// stays unit/integration-testable without loading a compiled DLL.
pub fn class_object(clsid: &GUID, riid: &GUID, ppv: *mut *mut c_void) -> HRESULT {
    if ppv.is_null() {
        return E_POINTER;
    }
    unsafe { *ppv = std::ptr::null_mut() };
    if *clsid != SPIKE_CLSID {
        return CLASS_E_CLASSNOTAVAILABLE;
    }
    let factory: IClassFactory = ClassFactory::new(*clsid).into();
    match unsafe { factory.query(riid, ppv).ok() } {
        Ok(()) => S_OK,
        Err(e) => e.code(),
    }
}

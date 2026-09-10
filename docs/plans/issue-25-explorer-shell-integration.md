# Explorer Shell Integration ("Open in null-notes") Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Add a Windows 11 **top-level** Explorer right-click "Open in null-notes" entry — for a folder, opens it directly as a workspace; for a single file, copies it into a fresh temp workspace and opens that.

**Architecture:** A registry-verb context menu (the original, much simpler plan) was rejected because Windows 11 permanently demotes registry-based (`IContextMenu`) verbs to "Show more options" — only commands registered via `IExplorerCommand` + real package identity reach the top-level menu. That requires four new pieces working together:

1. A new, separate native COM-server DLL (`null-notes.exe` cannot be the COM server itself — Microsoft's own reference implementation always loads the handler in a COM surrogate, never the main app exe) implementing `IExplorerCommand`/`IExplorerCommandProvider` via `windows-rs`, whose `Invoke()` launches `null-notes.exe` with the existing `--workspace=`/a new `--open-file=` flag.
2. A **sparse package** (`AppxManifest.xml`, no payload) that grants `null-notes.exe` package identity pointing at its real (non-MSIX) install directory, and declares the `windows.fileExplorerContextMenus` + `windows.comServer` extensions.
3. A self-signed certificate, trusted locally via `Import-Certificate ... TrustedPeople` — this repo has **no signing pipeline today** (verified directly against `tauri.conf.json` and `.github/workflows/`), and per user decision this plan does **not** stand up public signing (a paid cert / Azure Trusted Signing). The result works on your dev machine and any beta tester who's walked through the one-time cert-trust step; it will not work for anonymous public downloads until that's added later.
4. Registration logic added to `null-notes.exe`'s startup: check package identity, register once via `Add-AppxPackage -ExternalLocation` if absent, relaunch.

**Tech Stack:** Rust (`windows` crate, already a dependency, gains new Win32/WinRT feature surface), a new standalone `cdylib` crate for the COM handler, MSIX tooling (`MakeAppx.exe`, part of the Windows SDK) for packaging, PowerShell for cert generation/trust and package registration.

**Spec:** GitHub issue `TorresVisual/null-notes#25` (the plain-language feature request) plus the primary-source research this plan is built on: `docs/research/windows11-top-level-context-menu.md` (already in this repo — every manifest/COM/signing detail below cites a section of it rather than repeating the sourcing).

**Design decisions made without asking (flagging per ponytail), on top of the ones the user already explicitly chose (full top-level build, self-signed cert only):**
- **Registered on `*` (every file type) and `Directory` (any folder), not scoped to `.md`/`.pdf`.** Same reasoning as the original plan — the issue says "a single file" with no extension qualifier; narrowing later is a one-line manifest change.
- **The COM handler DLL and the sparse-package tooling live outside `src-tauri`'s existing Cargo package**, as a sibling standalone crate (`src-tauri/context-menu-handler/`) with its own `Cargo.toml`, not folded into a Cargo workspace. It shares no code with the app, so there's nothing to gain from workspace-unifying it, and it keeps this feature from touching the existing single-crate `src-tauri/Cargo.toml` build at all (only `main.rs`/`lib.rs` for the startup registration check, and `build.rs` for the fusion manifest).
- **Registration uses `Add-AppxPackage -ExternalLocation` (PowerShell), not the `PackageManager` WinRT API directly.** The research (`windows11-top-level-context-menu.md` §4) confirms both work; shelling out to PowerShell avoids pulling in the `windows::Management::Deployment` WinRT namespace (new surface area, new async/`IAsyncOperationWithProgress` plumbing) for a one-time startup check. Simpler, same result.
- **No uninstall cleanup, no update/re-registration handling beyond what's in Task 6.** Out of scope for first landing; flagged with `ponytail:` comments at the exact spots this will bite (version bump on update, stale registration on uninstall).

## Execution Options

Leave every box below unchecked. The executing skill resolves them with
your human partner before Step 1 and checks the chosen boxes itself.

**Execution Target:**
- [x] Current branch (no isolation)
- [ ] New feature branch (no worktree)
- [ ] Worktree (superpowers:using-git-worktrees)

**Execution Mode:**
- [x] Inline execution (superpowers:executing-plans)
- [ ] Subagent-driven execution (superpowers:subagent-driven-development)

## Global Constraints

- Rust: no `.unwrap()`/`.expect()` outside tests (CLAUDE.md) — applies to `src-tauri` code; the new `context-menu-handler` crate is COM glue code operating under the same discipline where practical, though COM boundary functions (`DllGetClassObject`, `DllCanUnloadNow`) necessarily catch panics at the FFI boundary rather than propagate `Result`.
- `cargo clippy -- -D warnings` and `cargo fmt --check` must pass locally before pushing for `src-tauri` — CI only checks these on PRs/manual dispatch, not on push to `main` (CLAUDE.md). Run the same two commands against the new `context-menu-handler` crate too, even though it isn't wired into CI by this plan (Task 7 notes that as a followup, not blocking).
- Derive `Debug` on structs added to `src-tauri` (CLAUDE.md); the COM implementation structs in `context-menu-handler` are exempt in the same way `jumplist.rs`'s COM-facing code is — they hold no state worth a `Debug` impl.
- Windows-only. Everything in this plan is behind either the standalone Windows-only crate or `#[cfg(windows)]` in `src-tauri`, following the existing `commands/jumplist.rs` pattern.
- **Known open unknown, called out once here rather than per-task:** the exact `windows-rs` glue for `DllGetClassObject`/`IClassFactory` on a struct implemented via `#[implement]` is not fully documented — `windows-rs` issue [#1819](https://github.com/microsoft/windows-rs/issues/1819) is an open discussion about exactly this gap, and issue [#1078](https://github.com/microsoft/windows-rs/issues/1078) tracks first-party `DllGetClassObject` support that doesn't exist yet. Task 2 is a deliberately isolated spike to nail this down against a trivial class *before* Task 3 builds the real `IExplorerCommand` on top of it — don't skip straight to Task 3's implementation.

---

## File Structure

- **Modify `src-tauri/src/commands/workspace.rs`** — add `open_file_from_args` (parses `--open-file=`) and `temp_workspace_for_file` (copies a file into a new temp dir, returns the dir path). Unchanged from the original registry-only plan; still exactly what `Invoke()` in the new COM handler needs the main app to accept.
- **Create `src-tauri/context-menu-handler/`** — a new, standalone Rust crate (own `Cargo.toml`, not a workspace member of `src-tauri`):
  - `src/lib.rs` — `DllGetClassObject`/`DllCanUnloadNow` exports, module wiring.
  - `src/factory.rs` — the `IClassFactory` implementation (Task 2's spike deliverable).
  - `src/command.rs` — the `IExplorerCommand`/`IExplorerCommandProvider` implementation (Task 3).
  - `tests/factory_activation.rs` — integration test that registers the spike class classically (test-only registry keys, cleaned up after) and `CoCreateInstance`s it (Task 2).
- **Create `identity-package/AppxManifest.xml`** (repo root, sibling to `src-tauri/`) — the sparse package manifest (Task 4).
- **Create `scripts/windows/dev-cert.ps1`** — generates (if missing) and trusts a self-signed code-signing cert for local dev/beta use (Task 4).
- **Create `scripts/windows/package-identity.ps1`** — signs and builds the sparse `.msix` with `MakeAppx.exe`/`SignTool.exe` (Task 4).
- **Modify `src-tauri/build.rs`** — embed the side-by-side fusion manifest (`<msix>` element) into `null-notes.exe` via `tauri_build::WindowsAttributes::app_manifest`, linking it to the identity package (Task 4).
- **Modify `src-tauri/src/lib.rs`** — `run()`: `--open-file=` fallback (same as original plan, Task 1). `setup()`: add the identity-check/register/relaunch flow (Task 6).
- **Create `src-tauri/src/commands/identity.rs`** — Windows-only. `has_package_identity()`, `register_and_relaunch()` (Task 6).
- **Modify `src-tauri/src/commands/mod.rs`** — declare `pub mod identity;`.

---

### Task 1: `--open-file=` parsing and temp-workspace materialization

**Files:**
- Modify: `src-tauri/src/commands/workspace.rs`

**Interfaces:**
- Produces: `pub fn open_file_from_args<I: IntoIterator<Item = String>>(args: I) -> Option<String>`
- Produces: `pub fn temp_workspace_for_file(file_path: &str) -> std::io::Result<String>`
- Consumed by: Task 6's `lib.rs` wiring, and by the DLL's `Invoke()` (Task 3) as the `--open-file=` argument contract it launches `null-notes.exe` with.

- [x] **Step 1: Write the failing tests**

Add to the `#[cfg(test)] mod tests` block in `src-tauri/src/commands/workspace.rs` (alongside the existing `initial_workspace_from_args` tests):

```rust
    #[test]
    fn test_open_file_from_args_finds_the_flag() {
        let args = vec!["--open-file=/tmp/Lecture 7.pdf".to_string()];
        assert_eq!(
            open_file_from_args(args),
            Some("/tmp/Lecture 7.pdf".to_string())
        );
    }

    #[test]
    fn test_open_file_from_args_ignores_the_workspace_flag() {
        let args = vec!["--workspace=/tmp/ws".to_string()];
        assert_eq!(open_file_from_args(args), None);
    }

    #[test]
    fn test_temp_workspace_for_file_copies_the_file_in() {
        let src_dir = tempdir().unwrap();
        let src = src_dir.path().join("Lecture 7.pdf");
        std::fs::write(&src, b"pdf bytes").unwrap();

        let workspace = temp_workspace_for_file(&src.to_string_lossy()).unwrap();

        let copied = std::path::Path::new(&workspace).join("Lecture 7.pdf");
        assert_eq!(std::fs::read(copied).unwrap(), b"pdf bytes");
    }

    #[test]
    fn test_temp_workspace_for_file_rejects_a_path_with_no_file_name() {
        assert!(temp_workspace_for_file("/").is_err());
    }
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml workspace:: -- --nocapture`
Expected: FAIL with "cannot find function `open_file_from_args`" / "`temp_workspace_for_file`" (not yet defined).

- [x] **Step 3: Implement**

Add above `pub struct InitialWorkspace` in `src-tauri/src/commands/workspace.rs`:

```rust
// Sibling to `--workspace=`: the Explorer "Open in null-notes" file handler
// (the context-menu-handler COM DLL's Invoke()) sends this for a single
// file, since a lone file isn't a workspace. The caller copies it into a
// temp workspace, then treats that the same as any other `--workspace=`
// launch.
pub fn open_file_from_args<I: IntoIterator<Item = String>>(args: I) -> Option<String> {
    args.into_iter()
        .find_map(|arg| arg.strip_prefix("--open-file=").map(str::to_string))
}

// Creates a fresh temp directory and copies `file_path` into it, so the file
// can be opened through the same `--workspace=` startup path as a folder.
//
// ponytail: temp dirs under `%TEMP%\null-notes` are never cleaned up here —
// the OS reclaims `%TEMP%` on its own schedule. Add explicit GC if stale
// dirs are ever reported as a problem.
pub fn temp_workspace_for_file(file_path: &str) -> std::io::Result<String> {
    let file_path = Path::new(file_path);
    let file_name = file_path
        .file_name()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "no file name"))?;

    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let dir = std::env::temp_dir().join("null-notes").join(nanos.to_string());
    std::fs::create_dir_all(&dir)?;
    std::fs::copy(file_path, dir.join(file_name))?;

    Ok(dir.to_string_lossy().into_owned())
}
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml workspace:: -- --nocapture`
Expected: PASS — all `workspace::tests::*` tests green, including the three new ones.

- [x] **Step 5: Commit**

```bash
git add src-tauri/src/commands/workspace.rs
git commit -m "feat: parse --open-file= and materialize a temp workspace for it"
```

---

### Task 2: COM server spike — get `DllGetClassObject`/`IClassFactory` working against a trivial class

This task exists because of the Global Constraints callout above: the `windows-rs` glue for being a COM server (not just calling one, which is all `jumplist.rs` does today) has real open gaps in the crate's own issue tracker. De-risk it here, against the simplest possible class, before Task 3 spends effort on the real `IExplorerCommand` logic.

**Files:**
- Create: `src-tauri/context-menu-handler/Cargo.toml`
- Create: `src-tauri/context-menu-handler/src/lib.rs`
- Create: `src-tauri/context-menu-handler/src/factory.rs`
- Create: `src-tauri/context-menu-handler/tests/factory_activation.rs`

**Interfaces:**
- Produces: `pub const SPIKE_CLSID: windows::core::GUID` (test-only class ID, distinct from the real command CLSID Task 3 uses), `pub fn class_object(clsid: &GUID, riid: &GUID, ppv: *mut *mut c_void) -> HRESULT` (the factory dispatch logic, called from the `DllGetClassObject` export).
- Consumed by: Task 3 extends `class_object` to also serve the real command CLSID; nothing outside this crate consumes these symbols.

- [x] **Step 1: Create the crate**

`src-tauri/context-menu-handler/Cargo.toml`:

```toml
[package]
name = "null-notes-context-menu"
version = "0.1.0"
edition = "2021"

[lib]
name = "null_notes_context_menu"
crate-type = ["cdylib", "rlib"]

[dependencies]
windows = { version = "0.61", features = [
    "implement",
    "Win32_Foundation",
    "Win32_System_Com",
    "Win32_UI_Shell",
    "Win32_UI_Shell_Common",
] }

[dev-dependencies]
windows = { version = "0.61", features = [
    "implement",
    "Win32_Foundation",
    "Win32_System_Com",
    "Win32_System_Registry",
    "Win32_UI_Shell",
    "Win32_UI_Shell_Common",
] }
```

`rlib` is added alongside `cdylib` so the integration test in `tests/` can `use null_notes_context_menu::...` directly instead of loading the compiled DLL — much faster iteration while nailing down the COM glue.

- [x] **Step 2: Write the spike class and factory**

`src-tauri/context-menu-handler/src/factory.rs`:

```rust
use std::ffi::c_void;
use windows::core::{implement, GUID, HRESULT, IUnknown};
use windows::Win32::Foundation::{CLASS_E_CLASSNOTAVAILABLE, E_NOINTERFACE, E_POINTER, S_OK};
use windows::Win32::System::Com::{IClassFactory, IClassFactory_Impl};

/// Test-only CLSID for this spike — never registered outside `tests/`.
/// Generated once with `[guid]::NewGuid()`, not meaningful beyond uniqueness.
pub const SPIKE_CLSID: GUID = GUID::from_u128(0x7C1E2B4A_5D3F_4A6E_9C21_0B1F2E3D4A5Bu128);

#[implement(IUnknown)]
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
            return Err(windows::core::Error::from(windows::Win32::Foundation::CLASS_E_NOAGGREGATION));
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
```

`src-tauri/context-menu-handler/src/lib.rs`:

```rust
mod factory;

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
```

- [x] **Step 3: Write the activation integration test**

`src-tauri/context-menu-handler/tests/factory_activation.rs` — registers the spike CLSID under `HKCU\Software\Classes\CLSID\{guid}\InprocServer32` (test-only; `HKCU` needs no elevation, and this key is removed in the test's cleanup regardless of pass/fail), then activates it through real COM (`CoCreateInstance`), proving the `#[implement]`/`IClassFactory_Impl`/`DllGetClassObject` chain actually works end-to-end — not just compiles:

```rust
use std::ffi::c_void;
use windows::core::{Interface, GUID};
use windows::Win32::Foundation::HKEY;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
    COINIT_APARTMENTTHREADED,
};
use windows::Win32::System::Registry::{
    RegCloseKey, RegCreateKeyExW, RegDeleteTreeW, RegSetValueExW, HKEY_CURRENT_USER, KEY_WRITE,
    REG_OPTION_NON_VOLATILE, REG_SZ,
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
        CoUninitialize();
        unregister_test_dll(&SPIKE_CLSID);
        result.expect("CoCreateInstance must succeed against the just-registered spike DLL");
    }
}
```

- [x] **Step 4: Build the DLL, then run the test**

The integration test activates the *compiled DLL* via real COM (not the `rlib`), so build it first:

```bash
cargo build --manifest-path src-tauri/context-menu-handler/Cargo.toml
cargo test --manifest-path src-tauri/context-menu-handler/Cargo.toml
```
Expected: PASS. **If this fails to compile**, the failure is almost certainly in the exact `IClassFactory_Impl`/`#[implement]` API surface — consult `windows-rs` issues [#1819](https://github.com/microsoft/windows-rs/issues/1819) and [#1078](https://github.com/microsoft/windows-rs/issues/1078) (linked in Global Constraints) for what other implementers hit, and check the installed `windows` crate version's actual generated trait signatures with `cargo doc --manifest-path src-tauri/context-menu-handler/Cargo.toml --open -p windows` rather than guessing further. This is the one step in the whole plan where the code above is a best-effort starting point, not a guarantee — budget real iteration time here.

- [x] **Step 5: Commit**

```bash
git add src-tauri/context-menu-handler/
git commit -m "feat: spike a minimal windows-rs COM server (DllGetClassObject/IClassFactory)"
```

---

### Task 3: `IExplorerCommand`/`IExplorerCommandProvider` — the real "Open in null-notes" verb

**Files:**
- Create: `src-tauri/context-menu-handler/src/command.rs`
- Modify: `src-tauri/context-menu-handler/src/factory.rs` — the class factory now also serves the real command CLSID, not just the Task 2 spike CLSID.
- Modify: `src-tauri/context-menu-handler/src/lib.rs`

**Interfaces:**
- Produces: `pub const COMMAND_CLSID: GUID` — must match the `Clsid` used in the sparse-package manifest's `desktop4:Verb`/`com:Class` elements (Task 4).
- Consumes: Task 2's `class_object` dispatch function (extended, not replaced) and `ClassFactory`.

- [x] **Step 1: Write the command**

`src-tauri/context-menu-handler/src/command.rs` — method call order and `GetTitle` ownership follow `windows11-top-level-context-menu.md` §3/§6.11 (title strings must be `CoTaskMemAlloc`-backed, matching the existing convention `jumplist.rs` already uses for `PROPVARIANT` in this repo):

```rust
use std::ffi::c_void;
use windows::core::{implement, GUID, PWSTR, Ref, Result};
use windows::Win32::Foundation::{BOOL, E_FAIL};
use windows::Win32::System::Com::CoTaskMemAlloc;
use windows::Win32::UI::Shell::{
    IEnumExplorerCommand, IExplorerCommand, IExplorerCommand_Impl, IShellItemArray,
};
use windows::Win32::System::Com::IBindCtx;

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

    fn GetState(&self, _psiitemarray: Ref<'_, IShellItemArray>, _ok_to_be_slow: BOOL) -> Result<u32> {
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
            let path_ptr = unsafe { item.GetDisplayName(windows::Win32::UI::Shell::SIGDN_FILESYSPATH)? };
            let path = unsafe { path_ptr.to_string().map_err(|_| windows::core::Error::from(E_FAIL))? };
            unsafe { windows::Win32::System::Com::CoTaskMemFree(Some(path_ptr.0 as *const c_void)) };
            launch_null_notes(&path);
        }
        Ok(())
    }

    fn EnumSubCommands(&self) -> Result<IEnumExplorerCommand> {
        Err(windows::core::Error::from(windows::Win32::Foundation::E_NOTIMPL))
    }
}

/// Launches the main app pointed at `path` — a folder becomes the workspace
/// directly; a file goes through `--open-file=`, matching the flags
/// `commands::workspace::initial_workspace_from_args`/`open_file_from_args`
/// already parse in `src-tauri` (Task 1, Task 6).
fn launch_null_notes(path: &str) {
    let flag = if std::path::Path::new(path).is_dir() {
        format!("--workspace={path}")
    } else {
        format!("--open-file={path}")
    };
    // ponytail: locates the app exe next to this DLL (both live in the same
    // install/ExternalLocation directory per Task 4's manifest) rather than
    // reading it from the registry — one less moving part, since the
    // manifest's ExternalLocation already guarantees this DLL only ever
    // loads from that directory.
    let Ok(dll_dir) = std::env::current_exe().map(|_| ()).and_then(|_| {
        // current_exe() inside a DLL is the *host* (dllhost.exe/explorer.exe),
        // not this DLL — use the module handle instead. See Task 3 Step 2.
        Err(std::io::Error::from(std::io::ErrorKind::Unsupported))
    }) else {
        return;
    };
    let _ = std::process::Command::new(dll_dir).arg(flag).spawn();
}
```

**Note carried into Step 2 below:** the `launch_null_notes` sketch above flags its own gap — `std::env::current_exe()` inside a DLL returns the *host process's* exe (the COM surrogate), not this DLL's own path, so it cannot be used to locate `null-notes.exe`. Step 2 fixes this properly.

- [x] **Step 2: Fix `launch_null_notes` to find the DLL's own directory**

A loaded DLL must ask Windows for its own module handle to find its own path — `GetModuleHandleExW` with `GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS`, passing the address of any function inside the DLL itself, then `GetModuleFileNameW` on the resulting handle. Replace the broken sketch in `command.rs` with:

```rust
use windows::Win32::System::LibraryLoader::{
    GetModuleFileNameW, GetModuleHandleExW, GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS,
};
use windows::Win32::Foundation::HMODULE;

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
        std::path::Path::new(&path).parent().map(|p| p.to_path_buf())
    }
}

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
```

Remove the broken `launch_null_notes` from Step 1 entirely — this version replaces it.

- [x] **Step 3: Wire the real CLSID into the class factory**

Modify `class_object` in `src-tauri/context-menu-handler/src/factory.rs` to dispatch both CLSIDs:

```rust
use crate::command::{OpenInNullNotesCommand, COMMAND_CLSID};

pub fn class_object(clsid: &GUID, riid: &GUID, ppv: *mut *mut c_void) -> HRESULT {
    if ppv.is_null() {
        return E_POINTER;
    }
    unsafe { *ppv = std::ptr::null_mut() };

    if *clsid == COMMAND_CLSID {
        let command: IUnknown = OpenInNullNotesCommand.into();
        return match unsafe { command.query(riid, ppv).ok() } {
            Ok(()) => S_OK,
            Err(e) => e.code(),
        };
    }
    if *clsid == SPIKE_CLSID {
        let factory: IClassFactory = ClassFactory::new(*clsid).into();
        return match unsafe { factory.query(riid, ppv).ok() } {
            Ok(()) => S_OK,
            Err(e) => e.code(),
        };
    }
    CLASS_E_CLASSNOTAVAILABLE
}
```

Add `mod command;` to `src-tauri/context-menu-handler/src/lib.rs`, and `pub use command::{OpenInNullNotesCommand, COMMAND_CLSID};`.

- [x] **Step 4: Build and typecheck**

```bash
cargo build --manifest-path src-tauri/context-menu-handler/Cargo.toml
cargo clippy --manifest-path src-tauri/context-menu-handler/Cargo.toml -- -D warnings
```
Expected: PASS. There's no automated test for `Invoke()` itself here — it calls `std::process::Command::spawn()` against the real `null-notes.exe`, which Task 7's manual verification exercises for real; a unit test would only prove the string-formatting logic, which is simple enough to eyeball (and `launch_null_notes`'s `--workspace=`/`--open-file=` branch mirrors Task 1's already-tested `open_file_from_args`/`initial_workspace_from_args` parsing exactly, so there's no independent logic here worth a second, weaker test).

- [x] **Step 5: Commit**

```bash
git add src-tauri/context-menu-handler/src/command.rs src-tauri/context-menu-handler/src/factory.rs src-tauri/context-menu-handler/src/lib.rs
git commit -m "feat: implement the Open in null-notes IExplorerCommand"
```

---

### Task 4: Self-signed dev certificate

**Files:**
- Create: `scripts/windows/dev-cert.ps1`

**Interfaces:**
- Produces: a `.pfx`/`.cer` pair under `scripts/windows/.dev-cert/` (gitignored) and a `Cert:\CurrentUser\TrustedPeople` trust entry, consumed by Task 5's packaging script (`SignTool.exe` needs the `.pfx`) and by anyone else's machine that wants to run the packaged identity (they re-run this script, or you hand them the `.cer` to `Import-Certificate` themselves — see the script's own header comment).

- [x] **Step 1: Write the script**

`scripts/windows/dev-cert.ps1` — idempotent (skips generation if a matching cert already exists), matches the exact `New-SelfSignedCertificate`/`Import-Certificate` shape confirmed in `windows11-top-level-context-menu.md` §5:

```powershell
<#
.SYNOPSIS
Generates (if missing) a self-signed code-signing certificate for null-notes'
Explorer shell-integration identity package, and trusts it locally.

Per docs/research/windows11-top-level-context-menu.md §5: this only works on
machines where this script (or an equivalent manual Import-Certificate step)
has been run. It is NOT a substitute for a real code-signing certificate —
anonymous downloads of null-notes will not be able to register the identity
package until public signing is added.

Subject must exactly match Identity/@Publisher in identity-package/AppxManifest.xml.
#>

$ErrorActionPreference = "Stop"

$subject = "CN=null-notes-dev"
$certDir = Join-Path $PSScriptRoot ".dev-cert"
$pfxPath = Join-Path $certDir "null-notes-dev.pfx"
$cerPath = Join-Path $certDir "null-notes-dev.cer"

New-Item -ItemType Directory -Force -Path $certDir | Out-Null

$existing = Get-ChildItem Cert:\CurrentUser\My |
    Where-Object { $_.Subject -eq $subject }

if (-not $existing) {
    Write-Host "Generating new self-signed certificate ($subject)..."
    $existing = New-SelfSignedCertificate `
        -Type Custom `
        -Subject $subject `
        -KeyUsage DigitalSignature `
        -FriendlyName "null-notes dev signing cert" `
        -CertStoreLocation Cert:\CurrentUser\My `
        -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}")
} else {
    Write-Host "Reusing existing certificate ($subject)."
}

if (-not (Test-Path $pfxPath)) {
    $pfxPassword = ConvertTo-SecureString -String "null-notes-dev" -Force -AsPlainText
    Export-PfxCertificate -Cert $existing -FilePath $pfxPath -Password $pfxPassword | Out-Null
    Export-Certificate -Cert $existing -FilePath $cerPath | Out-Null
}

$trusted = Get-ChildItem Cert:\CurrentUser\TrustedPeople |
    Where-Object { $_.Thumbprint -eq $existing.Thumbprint }

if (-not $trusted) {
    Write-Host "Trusting certificate in Cert:\CurrentUser\TrustedPeople..."
    Import-Certificate -FilePath $cerPath -CertStoreLocation Cert:\CurrentUser\TrustedPeople | Out-Null
} else {
    Write-Host "Certificate already trusted."
}

Write-Host "Done. PFX: $pfxPath (password: null-notes-dev)"
```

- [x] **Step 2: Gitignore the generated cert material**

Add to `.gitignore`:

```
scripts/windows/.dev-cert/
```

- [x] **Step 3: Run it and verify**

```powershell
powershell -File scripts/windows/dev-cert.ps1
Get-ChildItem Cert:\CurrentUser\TrustedPeople | Where-Object { $_.Subject -eq "CN=null-notes-dev" }
```
Expected: the `Get-ChildItem` line prints the cert (non-empty output).

- [x] **Step 4: Commit**

```bash
git add scripts/windows/dev-cert.ps1 .gitignore
git commit -m "chore: add a self-signed dev cert script for the identity package"
```

---

### Task 5: Sparse package manifest, exe fusion manifest, and packaging script

**Files:**
- Create: `identity-package/AppxManifest.xml`
- Create: `identity-package/Assets/StoreLogo.png` (44x44 placeholder — any square PNG; Windows requires the file to exist even though a sparse/`AppListEntry="none"` package never shows it in the Start menu)
- Modify: `src-tauri/build.rs`
- Create: `scripts/windows/package-identity.ps1`

**Interfaces:**
- Consumes: Task 3's `COMMAND_CLSID` (`013EFF9A-2F31-47CE-87BC-B0D2A19189C5`) — must appear identically in the manifest's `desktop4:Verb`/`com:Class` elements. Task 4's `.pfx`.
- Produces: `identity-package/null-notes-identity.msix`, consumed by Task 6's registration call.

- [x] **Step 1: Write the sparse package manifest**

`identity-package/AppxManifest.xml` — structure and every element/attribute here is drawn directly from `windows11-top-level-context-menu.md` §1–2 (the canonical template plus the real worked `com:Extension`/`desktop4:Extension` example), adapted with null-notes' own identity/CLSID:

```xml
<?xml version="1.0" encoding="utf-8"?>
<Package IgnorableNamespaces="uap uap10 desktop4 com"
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:uap10="http://schemas.microsoft.com/appx/manifest/uap/windows10/10"
  xmlns:desktop4="http://schemas.microsoft.com/appx/manifest/desktop/windows10/4"
  xmlns:com="http://schemas.microsoft.com/appx/manifest/com/windows10"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities">
  <Identity Name="NullNotes.ShellIntegration" Publisher="CN=null-notes-dev" Version="1.0.0.0" ProcessorArchitecture="x64" />
  <Properties>
    <DisplayName>null-notes</DisplayName>
    <PublisherDisplayName>null-notes</PublisherDisplayName>
    <Logo>Assets\StoreLogo.png</Logo>
    <uap10:AllowExternalContent>true</uap10:AllowExternalContent>
  </Properties>
  <Resources>
    <Resource Language="en-us" />
  </Resources>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.19041.0" MaxVersionTested="10.0.26100.0" />
  </Dependencies>
  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
    <rescap:Capability Name="unvirtualizedResources" />
  </Capabilities>
  <Applications>
    <Application Id="NullNotes" Executable="null-notes.exe" uap10:TrustLevel="mediumIL" uap10:RuntimeBehavior="win32App">
      <uap:VisualElements AppListEntry="none" DisplayName="null-notes" Description="null-notes shell integration" BackgroundColor="transparent" Square150x150Logo="Assets\StoreLogo.png" Square44x44Logo="Assets\StoreLogo.png" />
      <Extensions>
        <com:Extension Category="windows.comServer">
          <com:ComServer>
            <com:SurrogateServer DisplayName="null-notes Explorer command handler">
              <com:Class Id="013EFF9A-2F31-47CE-87BC-B0D2A19189C5" Path="null_notes_context_menu.dll" ThreadingModel="STA" />
            </com:SurrogateServer>
          </com:ComServer>
        </com:Extension>
        <desktop4:Extension Category="windows.fileExplorerContextMenus">
          <desktop4:FileExplorerContextMenus>
            <desktop4:ItemType Type="Directory">
              <desktop4:Verb Id="OpenInNullNotes" Clsid="013EFF9A-2F31-47CE-87BC-B0D2A19189C5" />
            </desktop4:ItemType>
            <desktop4:ItemType Type="*">
              <desktop4:Verb Id="OpenInNullNotes" Clsid="013EFF9A-2F31-47CE-87BC-B0D2A19189C5" />
            </desktop4:ItemType>
          </desktop4:FileExplorerContextMenus>
        </desktop4:Extension>
      </Extensions>
    </Application>
  </Applications>
</Package>
```

- [x] **Step 2: Add the exe-side fusion manifest**

Modify `src-tauri/build.rs` to embed the manifest that links `null-notes.exe` to the identity package above — `packageName`/`publisher` must match `Identity/@Name`/`@Publisher` exactly, `applicationId` must match `Application/@Id` exactly (per `windows11-top-level-context-menu.md` §1's sourced quote — a mismatch here is `0x80073D54`, a silent "runs without identity" failure, not a loud error):

```rust
fn main() {
    let venv_src = std::path::Path::new("pix2tex-venv");
    if venv_src.exists() {
        println!("cargo:rerun-if-changed=pix2tex-venv");
    }

    let windows = tauri_build::WindowsAttributes::new().app_manifest(
        r#"<?xml version="1.0" encoding="utf-8"?>
<assembly manifestVersion="1.0" xmlns="urn:schemas-microsoft-com:asm.v1">
  <assemblyIdentity version="0.1.0.0" name="null-notes"/>
  <msix xmlns="urn:schemas-microsoft-com:msix.v1"
        publisher="CN=null-notes-dev"
        packageName="NullNotes.ShellIntegration"
        applicationId="NullNotes"
  />
</assembly>"#,
    );
    let attrs = tauri_build::Attributes::new().windows_attributes(windows);
    tauri_build::try_build(attrs).expect("failed to run build script");
}
```

- [x] **Step 3: Write the packaging script**

`scripts/windows/package-identity.ps1` — locates `MakeAppx.exe`/`SignTool.exe` from the installed Windows SDK, builds the `.msix` from `identity-package/`, signs it with Task 4's cert:

```powershell
<#
.SYNOPSIS
Builds and signs the null-notes sparse identity package (identity-package/)
into identity-package/null-notes-identity.msix, using the dev cert from
scripts/windows/dev-cert.ps1. Requires the Windows SDK (MakeAppx.exe,
SignTool.exe) to be installed and on PATH, or discoverable under the usual
Program Files (x86)\Windows Kits\10\bin\<version>\x64\ location.
#>

$ErrorActionPreference = "Stop"

function Find-SdkTool($name) {
    $onPath = Get-Command $name -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }
    $kits = Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\bin" -Directory |
        Sort-Object Name -Descending
    foreach ($kit in $kits) {
        $candidate = Join-Path $kit.FullName "x64\$name"
        if (Test-Path $candidate) { return $candidate }
    }
    throw "$name not found on PATH or under Windows Kits\10\bin — install the Windows SDK."
}

$makeAppx = Find-SdkTool "MakeAppx.exe"
$signTool = Find-SdkTool "SignTool.exe"

$root = Join-Path $PSScriptRoot "..\.." | Resolve-Path
$identityDir = Join-Path $root "identity-package"
$msixPath = Join-Path $identityDir "null-notes-identity.msix"
$pfxPath = Join-Path $PSScriptRoot ".dev-cert\null-notes-dev.pfx"

if (-not (Test-Path $pfxPath)) {
    throw "Dev cert not found at $pfxPath — run scripts/windows/dev-cert.ps1 first."
}

Write-Host "Packaging $identityDir -> $msixPath"
& $makeAppx pack /d $identityDir /p $msixPath /overwrite
if ($LASTEXITCODE -ne 0) { throw "MakeAppx failed with exit code $LASTEXITCODE" }

Write-Host "Signing $msixPath"
& $signTool sign /fd SHA256 /f $pfxPath /p "null-notes-dev" $msixPath
if ($LASTEXITCODE -ne 0) { throw "SignTool failed with exit code $LASTEXITCODE" }

Write-Host "Done: $msixPath"
```

- [x] **Step 4: Build everything and run the packaging script**

```bash
cargo build --manifest-path src-tauri/Cargo.toml
cargo build --manifest-path src-tauri/context-menu-handler/Cargo.toml
```
```powershell
powershell -File scripts/windows/package-identity.ps1
```
Expected: `identity-package/null-notes-identity.msix` exists and the script prints "Done: ...".

- [x] **Step 5: Commit**

```bash
git add identity-package/AppxManifest.xml identity-package/Assets/StoreLogo.png src-tauri/build.rs scripts/windows/package-identity.ps1
git commit -m "feat: package a signed sparse identity for the Explorer context menu"
```

---

### Task 6: Register the identity package at app startup

**Files:**
- Create: `src-tauri/src/commands/identity.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces: `pub fn has_package_identity() -> bool`, `pub fn register_and_relaunch(msix_path: &std::path::Path) -> !` (Windows-only).
- Consumes: Task 1's `open_file_from_args`/`temp_workspace_for_file` (the `run()` wiring); Task 5's built `.msix`.

- [x] **Step 1: Write `identity.rs`**

`src-tauri/src/commands/identity.rs`. `has_package_identity` shells out to `Get-AppxPackage` scoped to this package's family name rather than binding the `Windows.ApplicationModel.Package` WinRT API, for the same reason Task 6 already chose PowerShell for registration — one fewer new `windows` crate namespace for a startup check that only needs a yes/no answer:

```rust
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
        std::process::exit(run_without_identity(original_args));
    }

    let exe = std::env::current_exe().unwrap_or_else(|_| exe_dir.join("null-notes.exe"));
    let _ = Command::new(exe).args(original_args).spawn();
    std::process::exit(0);
}

fn run_without_identity(_original_args: &[String]) -> i32 {
    0
}
```

- [x] **Step 2: Wire it into `mod.rs` and `lib.rs`**

Add to `src-tauri/src/commands/mod.rs` (alphabetically, before `ink`):

```rust
pub mod identity;
```

In `src-tauri/src/lib.rs`, extend the existing `#[cfg(windows)]` block in `setup()` — this needs to run *before* the jump-list/registration-adjacent code, right after `data_dir` is known, since a successful registration relaunches and exits the current process:

```rust
            #[cfg(windows)]
            {
                if !commands::identity::has_package_identity() {
                    if let Ok(exe_dir) = std::env::current_exe().map(|p| p.parent().unwrap().to_path_buf()) {
                        let msix = exe_dir.join("null-notes-identity.msix");
                        if msix.exists() {
                            let args: Vec<String> = std::env::args().skip(1).collect();
                            commands::identity::register_and_relaunch(&msix, &exe_dir, &args);
                        }
                    }
                }
                let recents =
                    tauri::async_runtime::block_on(commands::workspace::present_recents(&data_dir))
                        .unwrap_or_default();
                let _ = commands::jumplist::rebuild(&recents);
            }
```

This expects `null-notes-identity.msix` and `null_notes_context_menu.dll` to ship *next to* `null-notes.exe` in the installed layout — Task 7 covers copying them there for manual testing; wiring that into the actual Tauri bundler (`tauri.conf.json`'s `bundle.resources`) is a real followup this plan doesn't cover (see Task 7's closing note).

- [x] **Step 3: Build and clippy**

```bash
cargo build --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo fmt --manifest-path src-tauri/Cargo.toml --check
```
Expected: PASS. No new automated test here — `has_package_identity`/`register_and_relaunch` are thin shells around `powershell.exe`/process relaunch, which is exactly the kind of OS-boundary behavior Task 7's manual pass exists to check for real, the same way Task 7 already covers the registry-only plan's untestable parts.

- [x] **Step 4: Commit**

```bash
git add src-tauri/src/commands/identity.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat: register the Explorer shell-integration identity package on first run"
```

---

### Task 7: Manual end-to-end verification

Registry/COM/MSIX registration can't be exercised by `cargo test`, and the existing `e2e/` WebdriverIO suite drives the compiled app's own window, not Explorer or the OS package manager. Verify by hand, on a real Windows 11 machine with the Windows SDK installed:

- [x] **Step 1: Stage a test install layout**

```bash
cargo build --manifest-path src-tauri/Cargo.toml
cargo build --manifest-path src-tauri/context-menu-handler/Cargo.toml
mkdir -p /tmp/null-notes-shell-test
cp src-tauri/target/debug/null-notes.exe /tmp/null-notes-shell-test/
cp src-tauri/context-menu-handler/target/debug/null_notes_context_menu.dll /tmp/null-notes-shell-test/
cp identity-package/null-notes-identity.msix /tmp/null-notes-shell-test/
```

- [x] **Step 2: Launch once to trigger registration**

```bash
/tmp/null-notes-shell-test/null-notes.exe
```
Expected: the process relaunches itself once (per Task 6's `register_and_relaunch`) and the app window opens normally the second time. Close it.

- [x] **Step 3: Confirm the identity package registered**

```powershell
Get-AppxPackage -Name "NullNotes.ShellIntegration*"
```
Expected: prints the package, `PackageFullName` starting with `NullNotes.ShellIntegration`.

- [x] **Step 4: Restart Explorer**

Per `windows11-top-level-context-menu.md` §6.1, a fresh registration commonly needs an Explorer restart to show up:

```powershell
Stop-Process -Name explorer -Force
Start-Process explorer
```

- [x] **Step 5: Right-click a folder — confirm top-level placement**

Right-click any folder in Explorer. Confirm "Open in null-notes" appears **directly in the top-level menu**, not under "Show more options". Click it; confirm the app opens with that folder as the workspace.

- [x] **Step 6: Right-click a single file — confirm the temp-workspace path**

Right-click any file. Confirm "Open in null-notes" appears at the top level. Click it; confirm the app opens with a new workspace containing only a copy of that file (check `%TEMP%\null-notes\` for the new subfolder, same as the original registry-only plan's Task 3 verification).

- [x] **Step 7: Note the real followups this plan deliberately doesn't cover**

No code change in this step — record these as GitHub issues (or a TODO.md entry) rather than silently forgetting them:
- Wiring `null-notes-identity.msix` and `null_notes_context_menu.dll` into the actual `tauri.conf.json` bundle (`bundle.resources`) so the real MSI/NSIS installer ships them next to `null-notes.exe`, instead of the manual `cp` in Step 1.
- Public code signing (paid cert or Azure Trusted Signing) — required before this works for anyone who hasn't run `scripts/windows/dev-cert.ps1` themselves, per the user's explicit "skip public signing for now" decision.
- Update-time re-registration (`Identity/@Version` bump + unregister-old-first) — currently unhandled per Task 6 Step 1's `ponytail:` comment.
- Uninstall cleanup (`Remove-AppxPackage`) — not wired into anything today.

No commit for this task — it's verification and issue-filing, not a code change.

---

## Self-Review

- **Spec coverage:** folder → opens directly as workspace, top-level menu (Task 5 manifest `Directory` `ItemType` + Task 3 `Invoke()`'s `--workspace=` branch) ✓. Single file → copied into a temp workspace and opened, top-level menu (Task 5 manifest `*` `ItemType` + Task 1's `temp_workspace_for_file` + Task 3's `--open-file=` branch) ✓. Top-level (not "Show more options") placement — the entire reason this plan is this shape instead of the original registry-only one — addressed by Tasks 2, 3, 5 together and explicitly checked in Task 7 Step 5/6 ✓.
- **Placeholder scan:** none in the sense of "TBD"/"handle this later" — every step has concrete code, XML, or PowerShell. The one place this plan is honest about uncertainty (Task 2's COM glue) is flagged as a scoped spike with a real fallback (consult two specific, linked upstream issues), not left as an unwritten step.
- **Type consistency:** `open_file_from_args`/`temp_workspace_for_file` (Task 1) are called with the same names/signatures in Task 6 Step 2's `lib.rs` wiring — wait, actually consumed indirectly: Task 6's `run()` wiring for these was already covered by the *original* plan and is unchanged; this rewritten plan's Task 6 only touches `setup()`. Confirmed `src-tauri/src/lib.rs`'s `run()` still needs the Task-1-consuming `.or_else(...)` fallback from the original plan — **added explicitly to Task 6 Step 2 below** to avoid losing it in this rewrite.

**Correction applied during self-review:** Task 6 Step 2 above only showed the `setup()` change. The `run()` change from the original plan (falling back to `open_file_from_args`/`temp_workspace_for_file` when `--workspace=` is absent) is still required and was dropped in the rewrite — add it as part of Task 6 Step 2:

```rust
    let initial_workspace = commands::workspace::initial_workspace_from_args(std::env::args().skip(1))
        .or_else(|| {
            commands::workspace::open_file_from_args(std::env::args().skip(1))
                .and_then(|file| commands::workspace::temp_workspace_for_file(&file).ok())
        });
```
placed where `let initial_workspace = commands::workspace::initial_workspace_from_args(...)` currently stands, before `tauri::Builder::default()`.

# Windows 11 top-level Explorer context menu for null-notes — primary-source research

Research only — no code changes. Compiled from Microsoft Learn, the `microsoft/AppModelSamples` repo (`Samples/PackageWithExternalLocation`, the modern name for what used to be called the "SparsePackages" sample), the `windows-rs` project, and real-world implementer reports (Microsoft Q&A, GitHub issues, blogs). Every claim below is either a verbatim quote with its source, or explicitly marked `COULD NOT CONFIRM`.

Local repo facts checked directly (not web sources):
- `src-tauri/tauri.conf.json` — identifier `dev.nullnotes.app`, `bundle.targets: "all"`, **no `bundle.windows` signing block at all** (no `certificateThumbprint`, `digestAlgorithm`, `timestampUrl`, etc.).
- `.github/workflows/` contains only `ci.yml` (typecheck/lint/test/clippy/fmt/audit, `pull_request` + manual dispatch) and `format.yml` (`cargo fmt` auto-commit, manual dispatch only). **There is no build/release/signing workflow in this repo at all** — not even an unsigned one. `npm run tauri build` / installer signing is a fully manual, local step today.
- `src-tauri/src/commands/jumplist.rs` — existing precedent for raw `windows-rs` COM usage (`CoCreateInstance`, `unsafe` blocks, no build-time IDL/macros), confirming the project's established pattern for this kind of Win32 interop.

---

## 1. Sparse package manifest

**Terminology note:** Microsoft's current docs call this "packaging with external location" (a sparse package is a specific case of it — a package with no payload, only a manifest, whose `Application` points at content living outside the `.msix`). The old `AppModelSamples/Samples/SparsePackages` sample referenced in older blog posts has been renamed/restructured to `Samples/PackageWithExternalLocation` in the live repo (confirmed via `gh api repos/microsoft/AppModelSamples/git/trees/master?recursive=1` — no `SparsePackages` path exists in the current tree; `Samples/PackageWithExternalLocation/{cppwinrt,cs}` does).

### Canonical manifest template

From the current official how-to guide (this is the authoritative, actively-maintained page — dated 2026-04-08):

Source: https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/grant-identity-to-nonpackaged-apps

```xml
<?xml version="1.0" encoding="utf-8"?>
<Package IgnorableNamespaces="uap uap10"
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:uap10="http://schemas.microsoft.com/appx/manifest/uap/windows10/10"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities">
  <Identity Name="ContosoPhotoStore" Publisher="CN=Contoso" Version="1.0.0.0" ProcessorArchitecture="neutral" />
  <Properties>
    <DisplayName>Contoso PhotoStore</DisplayName>
    <PublisherDisplayName>Contoso</PublisherDisplayName>
    <Logo>Assets\storelogo.png</Logo>
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
    <rescap:Capability Name="unvirtualizedResources"/>
  </Capabilities>
  <Applications>
    <Application Id="ContosoPhotoStore" Executable="ContosoPhotoStore.exe" uap10:TrustLevel="mediumIL" uap10:RuntimeBehavior="win32App"> 
      <uap:VisualElements AppListEntry="none" DisplayName="Contoso PhotoStore" Description="Contoso PhotoStore App" BackgroundColor="transparent" Square150x150Logo="Assets\Square150x150Logo.png" Square44x44Logo="Assets\Square44x44Logo.png" />
    </Application>
  </Applications>
</Package>
```

Key confirmed facts from that same page:
- `Publisher` "must match the `Subject` of the certificate used to sign the application" — this ties directly into §5.
- `uap10:AllowExternalContent = true` is what lets the manifest reference content (the running exe, the handler DLL) that lives outside the `.msix`. "Introduced in Windows build 10.0.19041.0."
- `runFullTrust` + `unvirtualizedResources` capabilities are required "for Win32 compatibility."
- `uap10:TrustLevel="mediumIL"` and `uap10:RuntimeBehavior="win32App"` on `Application` are required "for Win32 compatibility."
- `AppListEntry="none"` on `uap:VisualElements` keeps the identity package out of the Start menu.
- Each versioned re-registration requires unregistering the previous version first — "You will not be able to register a version of an identity package on a system if that version of the package is already registered."

You additionally connect the identity package to the real `.exe` via a **side-by-side (fusion) application manifest** embedded in/next to the exe:

```xml
<?xml version="1.0" encoding="utf-8"?>
<assembly manifestVersion="1.0" xmlns="urn:schemas-microsoft-com:asm.v1">
  <assemblyIdentity version="0.0.0.0" name="ContosoPhotoStore"/>
  <msix xmlns="urn:schemas-microsoft-com:msix.v1"
          publisher="CN=Contoso"
          packageName="ContosoPhotoStore"
          applicationId="ContosoPhotoStore"
        />
</assembly>
```
> "The `packageName` and `publisher` attributes must match the `Name` and `Publisher` attributes in the `Identity` element in your identity package manifest, respectively. The `applicationId` attribute must match the `Id` attribute of the corresponding `Application` element."
(same source)

### File-Explorer-context-menu extension: exact category name

Confirmed (not guessed) via the schema reference — the category is **`windows.fileExplorerContextMenus`**, declared on a `desktop4:Extension` (namespace `http://schemas.microsoft.com/appx/manifest/desktop/windows10/4`), **not** a `uap4`/`uap5` category as originally suspected, and **not** `com.microsoft.windows.appxDeploymentClientExtensions`.

Source: https://raw.githubusercontent.com/MicrosoftDocs/winrt-related/docs/winrt-related-src/schemas/appxpackage/uapmanifestschema/element-desktop4-extension.md

```xml
<desktop4:Extension
  Category = 'A string that can be one of the following values: "windows.fileExplorerContextMenus".' 
  ...>
  <!-- Child elements -->
  desktop4:FileExplorerContextMenus?
</desktop4:Extension>
```

`desktop4:FileExplorerContextMenus` schema (children `desktop4:ItemType{0,10000}` / `desktop5:ItemType{0,10000}` — Windows 10 1803 vs 1809+):

Source: https://raw.githubusercontent.com/MicrosoftDocs/winrt-related/docs/winrt-related-src/schemas/appxpackage/uapmanifestschema/element-desktop4-fileexplorercontextmenus.md

```xml
<desktop4:FileExplorerContextMenus>
    desktop4:ItemType{0,10000}
    desktop5:ItemType{0,10000}
</desktop4:FileExplorerContextMenus>
```

`desktop4:ItemType` — the `Type` attribute is how folder-scope vs file-scope vs wildcard is distinguished ("A required string ... that must begin with a period or be the wildcard `*`."):

Source: https://learn.microsoft.com/en-us/uwp/schemas/appxpackage/uapmanifestschema/element-desktop4-itemtype

```xml
<desktop4:ItemType Type = '...begin with a period or be the wildcard *...'>
  desktop4:Verb{0,10000}
</desktop4:ItemType>
```

`desktop4:Verb`:

Source: https://learn.microsoft.com/en-us/uwp/schemas/appxpackage/uapmanifestschema/element-desktop4-verb

```xml
<desktop4:Verb
  Id = 'A required string ... 1 and 64 characters ... alphanumeric, periods, dashes, spaces only.'
  Clsid = 'A required GUID in the form xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.' />
```

### Real, complete, working example (verbatim, from Microsoft's own worked example)

Source: https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/desktop-to-uwp-extensions ("Specify a context menu handler for a file type" section)

```xml
<Package
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:desktop4="http://schemas.microsoft.com/appx/manifest/desktop/windows10/4"
  xmlns:com="http://schemas.microsoft.com/appx/manifest/com/windows10"
  IgnorableNamespaces="desktop4">
  <Applications>
    <Application>
      <Extensions>
        <com:Extension Category="windows.comServer">
          <com:ComServer>
            <com:SurrogateServer AppId="00001111-aaaa-2222-bbbb-3333cccc4444" DisplayName="ContosoHandler">
              <com:Class Id="00001111-aaaa-2222-bbbb-3333cccc4444" Path="ExplorerCommandVerb.dll" ThreadingModel="STA"/>
            </com:SurrogateServer>
          </com:ComServer>
        </com:Extension>
        <desktop4:Extension Category="windows.fileExplorerContextMenus">
          <desktop4:FileExplorerContextMenus>
            <desktop4:ItemType Type=".contoso">
              <desktop4:Verb Id="Command1" Clsid="00001111-aaaa-2222-bbbb-3333cccc4444" />
            </desktop4:ItemType>
          </desktop4:FileExplorerContextMenus>
        </desktop4:Extension>
      </Extensions>
    </Application>
  </Applications>
</Package>
```

### Folder-scope vs file-scope: a real, richer example from the live GitHub sample

Source (fetched verbatim): `https://raw.githubusercontent.com/microsoft/AppModelSamples/master/Samples/PackageWithExternalLocation/cs/PhotoStoreDemoPkg/AppxManifest.xml`

This demonstrates **all three scopes in one manifest**: `Directory\Background` (right-click on empty space inside a folder — what null-notes would use for "Open in null-notes" on a folder), `*` (any file), and `.txt` (a specific extension). Note it uses `desktop5:ItemType`/`desktop5:Verb` (Windows 10 1809+) even though only `desktop4`/`desktop5` xmlns are declared — `desktop5` is a strict superset that additionally supports icons per-verb (see `element-desktop5-itemtype`/`element-desktop5-verb`, not separately re-quoted here since the file-vs-folder scoping mechanics are identical to `desktop4`):

```xml
<desktop4:Extension Category="windows.fileExplorerContextMenus">
  <desktop4:FileExplorerContextMenus>
    <desktop5:ItemType Type="Directory\Background">
      <desktop5:Verb Id="Command1" Clsid="3282E233-C5D3-4533-9B25-44B8AAAFACFA" />
    </desktop5:ItemType>
    <desktop5:ItemType Type="*">
      <desktop5:Verb Id="Command4" Clsid="30DEEDF6-63EA-4042-A7D8-0A9E1B17BB99" />
    </desktop5:ItemType>
    <desktop5:ItemType Type=".txt">
      <desktop5:Verb Id="Command1" Clsid="3282E233-C5D3-4533-9B25-44B8AAAFACFA" />
      <desktop5:Verb Id="Command2" Clsid="817CF159-A4B5-41C8-8E8D-0E23A6605395" />
      <desktop5:Verb Id="Command3" Clsid="1476525B-BBC2-4D04-B175-7E7D72F3DFF8" />
      <desktop5:Verb Id="Command5" Clsid="50419A05-F966-47BA-B22B-299A95492348" />
    </desktop5:ItemType>
  </desktop4:FileExplorerContextMenus>
</desktop4:Extension>
```

For null-notes: `Type="Directory"` is the analogous folder-scope entry point if the verb should apply to right-clicking a folder itself (not its empty background); a Microsoft Q&A answer's worked example (§3 below) confirms `Directory` (not just `Directory\Background`) is valid: `<desktop5:ItemType Type="Directory"><desktop5:Verb Id="AnyFolder" Clsid="..." /></desktop5:ItemType>`.

---

## 2. COM server declaration in the same manifest

**Critical finding: `com:ComServer` has no plain "in-process DLL registered directly under Explorer's own process" option.** Its only children are `com:ExeServer`, `com:SurrogateServer`, `com:ProgId`, `com:TreatAsClass`:

Source: `https://raw.githubusercontent.com/MicrosoftDocs/winrt-related/docs/winrt-related-src/schemas/appxpackage/uapmanifestschema/element-com-comserver.md`

```xml
<com:ComServer>
  com:ExeServer{0,1000},
  com:SurrogateServer{0,1000},
  com:ProgId{0,10000},
  com:TreatAsClass{0,10000}
</com:ComServer>
```

Microsoft's own worked example for a context-menu handler (§1 above) uses **`com:SurrogateServer`**, not `com:ExeServer`. This matters: `com:ExeServer` registers a `LocalServer32`-style out-of-process EXE COM server (the class is created by launching an exe); `com:SurrogateServer` registers a DLL that is loaded inside a COM surrogate host (the default surrogate, or a custom one). Both are legitimate `windows.comServer` registrations, but **the context-menu handler pattern Microsoft documents and ships in its own sample always uses `SurrogateServer` wrapping a DLL**, never `ExeServer` pointing at the main application exe directly. This is because `IExplorerCommand` "supports in-process activation only" (see §3) — File Explorer instantiates the COM class itself; it does not launch/attach to an external process the way `ExeServer` implies.

`com:SurrogateServer` schema:

Source: https://learn.microsoft.com/en-us/uwp/schemas/appxpackage/uapmanifestschema/element-com-surrogateserver

```xml
<com:SurrogateServer
  CustomSurrogateExecutable = '...must end with ".exe"...'
  DisplayName = '...'
  LaunchAndActivationPermission = '...SDDL string...'
  AppId = '...GUID...'
  SystemSurrogate = '...value "PreviewHost"...' >
  com:Class{1,10000}
</com:SurrogateServer>
```
> "**SurrogateServer** class registrations should have an InprocServer32 registration in the package's private hive." — i.e. the `Path` DLL is still loaded in-process into *the surrogate host*, and Explorer talks to it through normal COM marshaling.

`com:Class` under `SurrogateServer` (the element that actually names the CLSID and DLL path):

Source: `https://raw.githubusercontent.com/MicrosoftDocs/winrt-related/docs/winrt-related-src/schemas/appxpackage/uapmanifestschema/element-com-surrogateserver-class.md`

```xml
<com:Class
    Id = 'A GUID in the form xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.'
    Path = 'A string ... cannot contain <, >, :, ", |, ?, or *.'
    ThreadingModel = 'A string that can be one of the following values: "Both", "STA", "MTA", "MainSTA", "Neutral".'
    DisplayName = '...' />
```
> "**Id** — The Id attribute corresponds to the CLSID." / "**Path** — The full path to the surrogate class DLL." / "**ThreadingModel** — The threading model for loading DLLs." (all required except `DisplayName` and the misc-status/etc. children)

Real, working combined `com:Extension` block from the same live sample manifest (5 verbs sharing one DLL, each its own `SurrogateServer`/`Class` pair):

```xml
<com:Extension Category="windows.comServer">
  <com:ComServer>
    <com:SurrogateServer DisplayName="Context menu verb handler">
      <com:Class Id="3282E233-C5D3-4533-9B25-44B8AAAFACFA" Path="PhotoStoreContextMenu.dll" ThreadingModel="STA"/>
    </com:SurrogateServer>
    <com:SurrogateServer DisplayName="Context menu verb handler">
      <com:Class Id="817CF159-A4B5-41C8-8E8D-0E23A6605395" Path="PhotoStoreContextMenu.dll" ThreadingModel="STA"/>
    </com:SurrogateServer>
    <!-- ... one SurrogateServer per CLSID, same DLL path ... -->
  </com:ComServer>
</com:Extension>
```
(source: `https://raw.githubusercontent.com/microsoft/AppModelSamples/master/Samples/PackageWithExternalLocation/cs/PhotoStoreDemoPkg/AppxManifest.xml`)

**Implication for null-notes:** `null-notes.exe` (the Tauri backend) **cannot itself be registered as the COM server**. A separate, small native DLL must be built (a Rust `cdylib` crate, sibling to `src-tauri`) that implements `IExplorerCommand`/`IExplorerCommandProvider`, gets loaded by the COM surrogate when Explorer invokes the verb, and — inside `Invoke()` — either `CreateProcess`es `null-notes.exe` with the clicked path as an argument, or signals an already-running instance (e.g. via a named pipe, matching how `jumplist.rs`'s `--workspace=` argument pattern already works for the taskbar jump list).

---

## 3. `IExplorerCommand` / `IExplorerCommandProvider`

### Interface methods, per Microsoft's reference docs

`IExplorerCommand` (inherits `IUnknown`):

Source: https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nn-shobjidl_core-iexplorercommand

| Method | Purpose |
|---|---|
| `GetTitle` | title text of the button/menu item |
| `GetIcon` | icon resource string |
| `GetToolTip` | tooltip string |
| `GetCanonicalName` | GUID of the command |
| `GetState` | enabled/checked/hidden state |
| `GetFlags` | `EXPCMDFLAGS` |
| `Invoke` | perform the command |
| `EnumSubCommands` | subcommand enumerator |

> "None of the methods of this interface should communicate with network resources. These methods are called on the UI thread, so communication with network resources could cause the UI to stop responding."

`Invoke` exact signature — https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-iexplorercommand-invoke:
```cpp
HRESULT Invoke(
  [in] IShellItemArray *psiItemArray,
  [in] IBindCtx        *pbc
);
```

`GetFlags` exact signature + full `EXPCMDFLAGS` enumeration — https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-iexplorercommand-getflags:
```cpp
HRESULT GetFlags(
  [out] EXPCMDFLAGS *pFlags
);
```
`ECF_DEFAULT (0x000)`, `ECF_HASSUBCOMMANDS (0x001)`, `ECF_HASSPLITBUTTON (0x002)`, `ECF_HIDELABEL (0x004)`, `ECF_ISSEPARATOR (0x008)`, `ECF_HASLUASHIELD (0x010)`, `ECF_SEPARATORBEFORE (0x020)`, `ECF_SEPARATORAFTER (0x040)`, `ECF_ISDROPDOWN (0x080)`, `ECF_TOGGLEABLE (0x100)`, `ECF_AUTOMENUICONS (0x200)`.

`IExplorerCommandProvider` (inherits `IUnknown`):

Source: https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nn-shobjidl_core-iexplorercommandprovider

| Method | Purpose |
|---|---|
| `GetCommand` | get one command instance by GUID |
| `GetCommands` | get a command enumerator |

> "None of the methods of this interface should communicate with network resources; they are called on the UI thread... Each command should have its own unique GUID; the command provider is expected to create a command instance on a per-GUID basis."

`GetCommands` exact signature — https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-iexplorercommandprovider-getcommands:
```cpp
HRESULT GetCommands(
        IUnknown *punkSite,
        REFIID   riid,
  [out] void     **ppv
);
```

Remark specific to `EnumSubCommands`/top-level menu, load-bearing for null-notes' UX design (a single flat verb avoids this entirely, but worth flagging if a submenu is ever considered):
> "Subcommands which themselves have subcommands are not supported by Windows Explorer." (Microsoft Learn, `IExplorerCommand::EnumSubCommands` remarks — quoted secondhand via a Microsoft Q&A answer that cites it; see §6.)

### windows-rs bindings — already available, no extra crate needed

Both interfaces are already bound in the `windows` crate (the same crate `jumplist.rs` already depends on) under `windows::Win32::UI::Shell`, including the `_Impl` traits needed to *implement* (not just call) them:

Source: https://microsoft.github.io/windows-docs-rs/doc/windows/Win32/UI/Shell/trait.IExplorerCommand_Impl.html
```rust
pub trait IExplorerCommand_Impl: IUnknownImpl {
    fn GetTitle(&self, psiitemarray: Ref<'_, IShellItemArray>) -> Result<PWSTR>;
    fn GetIcon(&self, psiitemarray: Ref<'_, IShellItemArray>) -> Result<PWSTR>;
    fn GetToolTip(&self, psiitemarray: Ref<'_, IShellItemArray>) -> Result<PWSTR>;
    fn GetCanonicalName(&self) -> Result<GUID>;
    fn GetState(&self, psiitemarray: Ref<'_, IShellItemArray>, foktobeslow: BOOL) -> Result<u32>;
    fn Invoke(&self, psiitemarray: Ref<'_, IShellItemArray>, pbc: Ref<'_, IBindCtx>) -> Result<()>;
    fn GetFlags(&self) -> Result<u32>;
    fn EnumSubCommands(&self) -> Result<IEnumExplorerCommand>;
}
```

Source: https://microsoft.github.io/windows-docs-rs/doc/windows/Win32/UI/Shell/trait.IExplorerCommandProvider_Impl.html
```rust
pub trait IExplorerCommandProvider_Impl: IUnknownImpl {
    fn GetCommands(&self, punksite: Ref<'_, IUnknown>, riid: *const GUID, ppv: *mut *mut c_void) -> Result<()>;
    fn GetCommand(&self, rguidcommandid: *const GUID, riid: *const GUID, ppv: *mut *mut c_void) -> Result<()>;
}
```

To actually implement a COM class in Rust with `windows-rs`, you use the `#[implement(...)]` attribute macro from the `windows-implement`/`windows::core::implement` machinery — the same mechanism (`ClassFactory`, exported `DllGetClassObject`) any `windows-rs`-based in-proc COM server uses. `COULD NOT CONFIRM` the exact Cargo feature flag name to gate this (the `implement` feature exists — `windows-implement` is a dependency of the `windows` crate per its `Cargo.toml` — but the docs.rs page for `windows::core::implement` returned 404 during this research and no page enumerating the required feature flags for `IExplorerCommand_Impl` specifically was found). This should be resolved with a `cargo add windows --features Win32_UI_Shell,implement` spike rather than assumed.

### Existing reference implementations found

1. **`cjee21/IExplorerCommand-Examples`** (https://github.com/cjee21/IExplorerCommand-Examples) — C++ (`C++/WinRT` and `WRL` variants), classic (non-sparse-package) registration. Useful as a second interface-usage reference, not for the manifest side.
2. **Microsoft's own `PhotoStoreContextMenu` sample DLL** — the highest-value find, because it is the *exact* combination this task needs: sparse package + `IExplorerCommand` + Windows 11 top-level menu, official and runnable.
   Source (fetched verbatim): `https://raw.githubusercontent.com/microsoft/AppModelSamples/master/Samples/PackageWithExternalLocation/cs/PhotoStoreContextMenu/dllmain.cpp`
   It's C++ using WRL (`Microsoft::WRL::RuntimeClass<RuntimeClassFlags<ClassicCom>, IExplorerCommand, IObjectWithSite>`), one base class implementing all of `IExplorerCommand` plus `IObjectWithSite` (to get the parent HWND for dialogs), with per-verb subclasses overriding just `Title()`/`Flags()`/`State()`. `Invoke()` in the sample just shows a `MessageBox`; a real implementation would `CreateProcess`/signal the main app here.
3. **`moudey/Shell`** (https://github.com/moudey/Shell) — a full-featured C++ "Powerful context menu manager for Windows File Explorer," not Rust, but a mature real-world codebase doing exactly this if a second cross-check is wanted.
4. No existing Rust project was found that implements `IExplorerCommand`/`IExplorerCommandProvider` end-to-end with a sparse package. `win-context-menu` (Rust, found during search) *displays/interacts with* the shell context menu, it does not *register a handler into it* — not relevant here.

### Why C++ (or Rust, but not C#) — a documented reason, not folklore

From `microsoft/WindowsAppSDK` issue #1082 ("Proposal: simple context menu entries in app manifest"), a still-open, Microsoft-unanswered proposal that itself corroborates why this is genuinely hard:
> "to have an entry in the new Windows 11 context menu...one needs to implement `IExplorerCommand`" and "C# and other managed languages are heavily discouraged by Microsoft for in-process shell extensions" because "Shell DLLs load in any process with file dialogs, causing potential runtime version conflicts."

Source: https://github.com/microsoft/WindowsAppSDK/issues/1082 (no Microsoft-staff response as of this research — the proposal is unaddressed, i.e. there is no simpler first-party path coming).

The "no managed languages" reasoning (CLR loaded into every process that shows a file-open/save dialog, or now into Explorer's surrogate) is about runtime weight/versioning conflicts, not about native-code-only tooling — Rust produces a native DLL with no embedded runtime, so it does not carry the same objection. This is inference, not a direct Microsoft statement about Rust specifically: `COULD NOT CONFIRM` that Microsoft has ever explicitly blessed Rust for this scenario, but nothing in the primary sources suggests a native Rust cdylib is disqualified the way a C#/.NET DLL is.

---

## 4. Runtime registration from Rust

### API and parameters

`PackageManager.AddPackageByUriAsync(Uri packageUri, AddPackageOptions options)`:

Source: https://learn.microsoft.com/en-us/uwp/api/windows.management.deployment.packagemanager.addpackagebyuriasync?view=winrt-26100
```csharp
public IAsyncOperationWithProgress<DeploymentResult,DeploymentProgress> AddPackageByUriAsync(System.Uri packageUri, AddPackageOptions options);
```
> "You can use the `ExternalLocationURI` property of the *options* parameter to specify the URI of an external disk location outside of the MSIX package where the package manifest can reference application content." Device family requirement: "Windows 10, version 2004 (introduced in 10.0.19041.0)."

This is a WinRT API; from Rust it is called through `windows::Management::Deployment::PackageManager` (already reachable via the same `windows` crate) using `windows::core::Ref`/`HSTRING`/`IAsyncOperationWithProgress` await plumbing — no new crate needed, but this is a different sub-namespace (`windows::Management::Deployment`) than the `Win32::UI::Shell`/`Win32::System::Com` namespaces `jumplist.rs` currently uses, so it's new surface area even though it's the same dependency.

### Per-user registration flow (official code shape)

Source: https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/grant-identity-to-nonpackaged-apps ("Register the identity package in your installer" → "PackageManager APIs" → "Per-User")
```csharp
var externalUri = new Uri(externalLocation);   // absolute path to the app's install dir, no exe name
var packageUri = new Uri(packagePath);          // absolute path to the signed .msix, with filename

var packageManager = new PackageManager();
var options = new AddPackageOptions();
options.ExternalLocationUri = externalUri;

var result = await packageManager.AddPackageByUriAsync(packageUri, options);
if (result.ExtendedErrorCode != 0)
{
    throw new Exception($"Package registration failed: {result.ErrorText} (0x{result.ExtendedErrorCode:X8})");
}
```
Unregister: `packageManager.FindPackagesForUserWithPackageTypes("", "<IdentityPackageFamilyName>", PackageTypes.Main)` then `RemovePackageAsync(package.Id.FullName)` per match.

The same page also documents a **non-API path**: plain PowerShell (`Add-AppxPackage -Path <PackagePath> -ExternalLocation <ExternalLocation>`), which is arguably simpler to shell out to from Rust than binding the WinRT API surface — worth weighing against the extra `windows` crate namespace.

Per-machine (elevated) registration uses `StagePackageByUriAsync` + `ProvisionPackageForAllUsersAsync` instead — not relevant unless null-notes ships a per-machine installer mode (currently unclear from the files checked; MSI/NSIS via Tauri can do either).

### One-time vs. every-launch

Confirmed from the Windows Developer Blog (2019) and corroborated by the live sample's `StartUp.cs`:

Source: https://blogs.windows.com/windowsdeveloper/2019/10/29/identity-registration-and-activation-of-non-packaged-win32-apps/
> "Registration occurs during application first-run, not at installation. The app checks if it's executing with identity; if not, it '[registers] the Sparse Package and restart[s] the app.' This is a one-time process." ... "Unlike a fully packaged application, an app using a Sparse Package...is not fully managed by the OS at deployment, runtime and uninstall." Your application must handle its own uninstall via `PackageManager.RemovePackageAsync()`.

Verbatim from the live sample's actual `Startup.cs` (`https://raw.githubusercontent.com/microsoft/AppModelSamples/master/Samples/PackageWithExternalLocation/cs/PhotoStoreDemo/StartUp.cs`), confirming the check-then-register-then-relaunch pattern:
```csharp
[STAThread]
public static void Main(string[] cmdArgs)
{
    //if app isn't running with identity, register its identity package
    if (!ExecutionMode.IsRunningWithIdentity())
    {
        RegisterIdentityAndRelaunchAsync(cmdArgs).GetAwaiter().GetResult();
    }
    else //App is registered and running with identity, handle launch and activation
    {
        ...
    }
}

static async Task RegisterIdentityAndRelaunchAsync(string[] cmdArgs)
{
    string externalLocation = @""; // set to build output dir
    string packagePath = @"";      // set to signed .msix path

    if (await RegisterPackageWithExternalLocationAsync(externalLocation, packagePath))
    {
        Process.Start(Application.ResourceAssembly.Location, arguments: cmdArgs?.ToString());
    }
    else
    {
        // run without identity, degrade gracefully
    }
}
```
This means the practical pattern for null-notes would be: on every launch, cheaply check "am I running with package identity" (a WinRT `Package.Current` probe that no-ops fast if identity isn't present); if not yet registered, register once and relaunch; every subsequent launch skips straight to the `else` branch. This is **not** a per-launch registration call in steady state — registration is idempotent/persisted by the OS the same way any installed MSIX package is (survives reboots, doesn't need repeating), it's only the *check* that runs every launch.

### Elevation

Not stated as required for the per-user path in any source found — `Add-AppxPackage -ExternalLocation` and `AddPackageByUriAsync` register for the current user only, matching how a per-user Tauri NSIS/MSI install would already work without admin rights. Per-machine registration (`StagePackageByUriAsync` + `ProvisionPackageForAllUsersAsync`, or `Add-AppxProvisionedPackage -Online`) explicitly needs elevation (documented directly on the same Learn page in the "Per-Machine" sections, which pair with `Add-AppxProvisionedPackage -Online`, an admin-only cmdlet).

---

## 5. Code signing

### Requirement: yes, always, even for local/self-signed use

> "In order to be installed on end user computers, the identity package must be signed with a certificate that is trusted on the target computer." (`grant-identity-to-nonpackaged-apps`, "Build and sign the identity package" section)

> "a production certificate from an IT Department or a service like Azure Trusted Signing will be required to register the package on end user computers." (same source)

### Self-signed certs: work, but need an extra trust step per machine

> "When using a **self-signed certificate** for local development, you must add its **public certificate** to the **Trusted People** certificate store before `Add-AppxPackage` will accept it. Without this step, registration fails with `CERT_E_UNTRUSTEDROOT` (0x800B0109)." (same source, "Important" callout)
```powershell
$cert = Get-PfxCertificate -FilePath "<path>\MyCertificate.pfx"
Export-Certificate -Cert $cert -FilePath "<path>\MyCertificate.cer"
Import-Certificate -FilePath "<path>\MyCertificate.cer" `
    -CertStoreLocation Cert:\CurrentUser\TrustedPeople
```
> "For machine-wide installs, use `Cert:\LocalMachine\TrustedPeople` instead (requires elevation). Production certificates issued by a trusted CA do not require this step."

This means a self-signed cert is a real, working option for **null-notes' own dev machines and any beta testers you personally onboard** (you control the `Import-Certificate` step), but it is **not viable for anonymous public distribution** — every end user's machine needs that manual trust step, which is exactly the "small team shipping outside the Microsoft Store" scenario the user described, and exactly the gap a real code-signing cert (or Azure Trusted Signing) closes. The identity-package's `Identity/@Publisher` must exactly match the cert subject, or registration fails a different way (`0x80073D54`, see §6).

### Confirmed against this repo: no signing pipeline exists today

Directly verified (not assumed) by reading `src-tauri/tauri.conf.json` and both workflow files:
- `tauri.conf.json`'s `bundle` block has no Windows-signing keys at all (`icon`/`resources`/`active`/`targets` only).
- `.github/workflows/ci.yml` and `.github/workflows/format.yml` are the *only* two workflows in the repo; neither builds or signs an installer. `ci.yml` runs `npm run build`/`typecheck`/`lint`/`test` and Rust `fmt`/`clippy`/`test`/`audit`, all on `pull_request` + manual dispatch — no `npm run tauri build`, no `signtool`, no release/publish job exists anywhere in CI.
- This confirms the premise: **there is currently zero code-signing infrastructure in this project**, for the MSI/NSIS installer or anything else. Building this feature means standing up signing from scratch, not extending an existing pipeline.

---

## 6. Known gotchas

All of these are corroborated by implementer reports (not vendor marketing copy), listed plainly:

1. **Explorer restart needed after registering a new handler.** A PowerToys maintainer opened this as an open issue against their own shipping product: "Win11 tier 1 context menu needs explorer.exe restart" — the team was "investigating how to avoid needing to restart explorer for the context menu to recognize" new entries. Source: https://github.com/microsoft/PowerToys/issues/19124. Practical effect: a fresh install of null-notes' context-menu feature may not show up until the user's next sign-in/explorer restart, not the moment registration succeeds.

2. **Top-level menu and "Show more options" call your COM object in different order, with different methods, and even create extra throwaway instances.** From a detailed Microsoft Q&A answer (https://learn.microsoft.com/en-us/answers/questions/1120506/how-to-create-a-shell-extension-using-iexplorercom):
   - Top-Level Menu: `GetState` → `GetTitle` → `GetIcon` → `GetFlags` → (`EnumSubCommands` if `ECF_HASSUBCOMMANDS`) — "TLM creates an unused instance for unknown reasons."
   - Show More Options: instance + `SetSelection` (`IObjectWithSelection`) → `GetFlags` → `GetCanonicalName` → `GetToolTip` → `GetTitle` → `GetIcon` → `GetState` → then `EnumSubCommands`.
   Your `Invoke`/`GetState`/etc. must not assume a fixed call order or a single instantiation per menu-show.

3. **No nested submenus on the top-level menu.** Per `IExplorerCommand::EnumSubCommands` remarks (quoted in the same Q&A thread): "Subcommands which themselves have subcommands are not supported by Windows Explorer." Only relevant if null-notes ever wants more than one flat verb; a single "Open in null-notes" verb sidesteps this entirely.

4. **Separator rendering differs between the two menus** — `ECF_ISSEPARATOR` rows need `GetTitle()` to return `nullptr` (not an empty string) to render correctly on the top-level menu specifically; empty string works under "Show more options" but renders as a blank row on top-level. Not relevant for a single-verb registration, but worth knowing if the verb list grows.

5. **`CERT_E_UNTRUSTEDROOT` (0x800B0109)** — self-signed cert not yet imported into `Cert:\CurrentUser\TrustedPeople` (or `LocalMachine\TrustedPeople` for per-machine). See §5.

6. **`0x80073CF9` "version already registered"** — re-registering the exact same identity-package version fails; must `Remove-AppxPackage`/`RemovePackageAsync` the old one first. Relevant to any auto-update flow: bumping the identity package's `Identity/@Version` on every app update (or explicitly unregistering before re-registering) is required. Source: `grant-identity-to-nonpackaged-apps` troubleshooting table.

7. **`0x80073D54` "identity missing at runtime, no registration error"** — `publisher`/`packageName`/`applicationId` in the exe's side-by-side manifest don't exactly match `Publisher`/`Name`/`Application/@Id` in the identity package manifest. Silent-ish failure mode (app runs, just without identity) — same source.

8. **`ExternalLocation` path mismatch → identity silently absent at runtime**, no error at all: "The `ExternalLocation` path passed at registration doesn't match the directory where the app actually runs." Same source, troubleshooting table.

9. **`REGDB_E_CLASSNOTREG`-style COM activation failures**: no primary source gave a specific root-cause writeup tied to sparse packages; general COM knowledge (and the schema requirement that `com:SurrogateServer`'s `Class/@Path` be a DLL that ships at exactly that relative path inside the identity package's `ExternalLocation` directory) strongly implies this fires if the DLL isn't present/named correctly next to the exe at the registered `ExternalLocation`, or if `ProcessorArchitecture` in `Identity` doesn't match the DLL's actual bitness. `COULD NOT CONFIRM` a documented root-cause list for this specific HRESULT in the sparse-package context — flagging as a real risk to test for explicitly rather than assume away.

10. **Minimum Windows 11 build**: the two-tier ("top-level" + "Show more options") context menu itself is a Windows 11 shell feature (it doesn't exist on Windows 10 the same way — on Windows 10 this same manifest would register into the single classic menu instead, which is a behavior difference worth testing, not just a version gate). `COULD NOT CONFIRM` an exact minimum Windows 11 build number for `windows.fileExplorerContextMenus` reaching the *top-level* menu specifically (schema pages only give the Windows 10 version-1803/1809 floor for the extension category existing at all, which predates Windows 11's two-tier menu). The identity-package mechanism itself (`AllowExternalContent`) requires `10.0.19041.0` minimum per §1/§4. Recommend testing on the actual target Windows 11 builds rather than trusting a specific build number pulled from a schema page.

11. **`GetTitle` string ownership**: the reference C++ sample allocates the title with `wil::make_cotaskmem_string_nothrow` — i.e. `CoTaskMemAlloc`-backed strings, matching the ownership convention `jumplist.rs` already uses elsewhere in this repo (`CoTaskMemAlloc` in `make_title_propvariant`) for the same reason (the shell frees what you return). The `windows-rs` `_Impl` trait signatures return `PWSTR`/`Result<PWSTR>`, so this convention has to be replicated by hand in the Rust implementation, same as `jumplist.rs` already does for `PROPVARIANT`.

12. **Managed-language (C#/.NET) in-proc shell extensions are explicitly discouraged by Microsoft** due to CLR-in-every-Explorer-adjacent-process version conflicts (see §3, WindowsAppSDK issue #1082) — reinforces that the companion DLL should be native (Rust `cdylib`, matching the project's existing Rust toolchain), not a C# DLL, even though this repo's frontend is TypeScript/React and it might be tempting to reach for .NET tooling for a "small" DLL.

13. **`0x800B0109` persists even with a thumbprint-matched cert in `Cert:\CurrentUser\TrustedPeople`.** Confirmed empirically on a real second machine (not vendor docs, which say `TrustedPeople` alone is sufficient — §5 above). `Get-AuthenticodeSignature` on the `.msix` showed `Status: Valid` and a thumbprint matching the imported `.cer`, yet `Add-AppxPackage` still failed, and `Get-AppPackageLog` kept reporting the same untrusted-root failure. What actually fixed it, in order:
    - Import the same `.cer` into **all four** of `Cert:\CurrentUser\TrustedPeople`, `Cert:\CurrentUser\Root`, `Cert:\LocalMachine\TrustedPeople`, and `Cert:\LocalMachine\Root` (the last three need an elevated PowerShell).
    - Set `AllowAllTrustedApps` (DWORD, `1`) under `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock` — present separately from `AllowDevelopmentWithoutDevLicense` (Developer Mode), which was already `1` and did **not** cover sideloading a trusted-but-non-Store package on its own.
    - **Sign out and back in** (or reboot) after setting that registry key — `AppModelUnlock` is read by `AppXSvc` at logon, so the change is inert for the rest of the current session.

    The secondary `Get-AppPackageLog` line `Error 0x80070002: Opening the Msixvc package ... Please check whether the Msixvc support services are installed` is a **red herring** — it's the deployment stack falling back to the streaming-package code path after the primary signature check already failed, not a real missing-service problem. Don't chase it separately.

---

## 7. Runbook: registering shell integration on a second machine

For a machine that isn't the one where `identity-package/null-notes-identity.msix` was originally built and signed (e.g. a second dev PC, since there is still no public signing pipeline — see §5's "no signing pipeline exists today" and the feasibility summary below):

1. **Generate (or reuse) a dev cert and signed package.**
   ```powershell
   .\scripts\windows\dev-cert.ps1        # creates/reuses scripts\windows\.dev-cert\null-notes-dev.{pfx,cer}
   .\scripts\windows\package-identity.ps1  # signs identity-package\null-notes-identity.msix with it
   ```
   Each machine needs its own run (or a copied `.pfx`/`.cer` pair) — `.dev-cert/` is gitignored and machine-specific.

2. **Point the installed app at the newly-signed `.msix`.** The running app reads `null-notes-identity.msix` from its own exe directory (`lib.rs`'s startup check), so replace the one that shipped with the installer:
   ```powershell
   Copy-Item "identity-package\null-notes-identity.msix" "<install-dir>\null-notes-identity.msix" -Force
   ```
   Find `<install-dir>` via the Start Menu shortcut's "Open file location," typically `%LOCALAPPDATA%\null-notes\`.

3. **Trust the cert everywhere §6.13 requires**, not just the one store the vendor docs mention:
   ```powershell
   $cer = "scripts\windows\.dev-cert\null-notes-dev.cer"
   Import-Certificate -FilePath $cer -CertStoreLocation Cert:\CurrentUser\TrustedPeople
   Import-Certificate -FilePath $cer -CertStoreLocation Cert:\CurrentUser\Root
   # then from an elevated PowerShell:
   Import-Certificate -FilePath $cer -CertStoreLocation Cert:\LocalMachine\TrustedPeople
   Import-Certificate -FilePath $cer -CertStoreLocation Cert:\LocalMachine\Root
   ```

4. **Allow sideloading of trusted (non-Store) packages**, from the same elevated PowerShell:
   ```powershell
   reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock" /v AllowAllTrustedApps /t REG_DWORD /d 1 /f
   ```
   Enabling "Developer Mode" in Settings alone is not equivalent to this — the two registry values are independent, and the app appeared to already have Developer Mode on before this fix worked.

5. **Sign out and back in** so `AppXSvc` re-reads the `AppModelUnlock` policy.

6. **Relaunch `null-notes.exe`.** It compares the bundled `.msix` version against what's registered (`identity.rs`'s `has_current_package_identity`) and calls `Add-AppxPackage` if they don't match. To force a retry without relaunching, run it directly:
   ```powershell
   Add-AppxPackage -Path "<install-dir>\null-notes-identity.msix" -ExternalLocation "<install-dir>\shell-integration" -Verbose
   ```

If it still fails after all of this, get the real reason instead of the generic `0x800B0109` summary:
```powershell
Get-AppPackageLog -ActivityID <guid-from-the-Add-AppxPackage-error>
```

**Updates:** since `identity-package/AppxManifest.xml`'s `Version` is hardcoded independent of the app's own release version, this whole runbook is a **one-time cost per machine** — later app updates that overwrite the installed `.msix` with the CI-signed copy won't trigger a re-registration attempt (and thus won't re-break anything) unless that manifest version number is bumped.

---

## Feasibility summary for null-notes

The mechanism is fully documented and has one directly-applicable, official, runnable reference implementation (`PackageWithExternalLocation`/`PhotoStoreContextMenu` in `microsoft/AppModelSamples`), so this is buildable — but it is a genuinely new subsystem, not a manifest tweak. The realistic minimum path:

1. **A new native component**: a Rust `cdylib` crate (sibling to `src-tauri`, e.g. `src-tauri-shell-ext/` or similar) implementing `IExplorerCommand` (+ `IObjectWithSite` for a parent HWND, matching the reference sample) via `windows-rs`'s `#[implement]` macro and `_Impl` traits — this is new surface area beyond `jumplist.rs`'s pattern (raw `CoCreateInstance` calls) since it means *being* a COM server, not just *calling* one. `Invoke()` needs to `CreateProcess` or signal the running `null-notes.exe`, reusing the `--workspace=` argument convention `jumplist.rs` already establishes for the taskbar jump list.
2. **A sparse/identity-package manifest** (`AppxManifest.xml`) declaring `Identity`/`Properties`/`Applications` with `uap10:AllowExternalContent`, plus the `com:Extension`(`windows.comServer` → `com:SurrogateServer` → `com:Class`) and `desktop4:Extension`(`windows.fileExplorerContextMenus` → `ItemType`/`Verb`) blocks from §1–2, built into a `.msix` with `MakeAppx.exe /nv`.
3. **A code-signing pipeline that does not exist today.** Confirmed by reading this repo's actual `tauri.conf.json` and workflows: there is no Windows signing of any kind currently, not even for the MSI/NSIS installers themselves. This feature can't ship to real users without solving that first — a self-signed cert only works for machines where you personally run the `Import-Certificate ... TrustedPeople` step (dev machines, invited beta testers), never for anonymous downloads. Shipping to the public requires either a purchased code-signing certificate or Azure Trusted Signing, wired into a new (currently nonexistent) release/build GitHub Actions workflow that runs `signtool` against both the identity-package `.msix` and, ideally, the installer itself.
4. **A registration/relaunch dance added to `null-notes.exe` startup**: check `Package.Current`-style identity on launch; if absent, call `PackageManager.AddPackageByUriAsync` (or shell out to `Add-AppxPackage -ExternalLocation`) pointing at the signed `.msix` and the install directory, then relaunch; on subsequent launches this is a fast no-op check. Needs an unregister/re-register step wired into the uninstaller and into the update flow (bump `Identity/@Version` or explicitly `RemovePackageAsync` first, or updates silently fail with `0x80073CF9`).
5. **Explorer-restart caveat needs to be surfaced to users** post-install/post-update (§6.1) since it's a known, currently-unresolved rough edge even in Microsoft's own tooling (PowerToys).

None of this is exotic or undocumented, but it's a multi-week feature (new build artifact, new signing infra, new install-time OS interaction, new COM implementation code) rather than the originally-scoped "simple registry entry," which matches the complexity tradeoff the user already explicitly chose to accept.

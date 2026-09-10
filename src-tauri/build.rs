fn main() {
    let venv_src = std::path::Path::new("pix2tex-venv");
    if venv_src.exists() {
        println!("cargo:rerun-if-changed=pix2tex-venv");
    }

    // Extends tauri-build's default app manifest with Common Controls v6,
    // needed for Tauri's native dialog APIs.
    //
    // Deliberately does NOT carry a <msix> fusion element. That element
    // (removed here — see git history) gave null-notes.exe itself package
    // identity whenever NullNotes.ShellIntegration was registered, which
    // broke the taskbar/Task Manager icon: a packaged process's icon comes
    // from the package's uap:VisualElements, not the exe's own resource,
    // and SetCurrentProcessExplicitAppUserModelID (lib.rs) is ignored for
    // it. Only the COM surrogate hosting the context-menu DLL needs
    // identity (identity-package/AppxManifest.xml); the main exe must not
    // have it.
    let windows = tauri_build::WindowsAttributes::new().app_manifest(
        r#"<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <dependency>
    <dependentAssembly>
      <assemblyIdentity
        type="win32"
        name="Microsoft.Windows.Common-Controls"
        version="6.0.0.0"
        processorArchitecture="*"
        publicKeyToken="6595b64144ccf1df"
        language="*"
      />
    </dependentAssembly>
  </dependency>
</assembly>"#,
    );
    let attrs = tauri_build::Attributes::new().windows_attributes(windows);
    tauri_build::try_build(attrs).expect("failed to run build script");
}

fn main() {
    let venv_src = std::path::Path::new("pix2tex-venv");
    if venv_src.exists() {
        println!("cargo:rerun-if-changed=pix2tex-venv");
    }

    // Extends tauri-build's default app manifest (Common Controls v6, needed
    // for Tauri's native dialog APIs) with the <msix> fusion element that
    // links this exe to the Explorer shell-integration identity package
    // (identity-package/AppxManifest.xml). publisher/packageName/applicationId
    // must match that manifest's Identity/@Publisher, Identity/@Name, and
    // Application/@Id exactly — a mismatch fails silently with 0x80073D54.
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

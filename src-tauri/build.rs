fn main() {
    let venv_src = std::path::Path::new("pix2tex-venv");
    if venv_src.exists() {
        println!("cargo:rerun-if-changed=pix2tex-venv");
    }
    tauri_build::build();
}

#[cfg(feature = "cef")]
fn main() {
    tauri::run_cef_helper_process();
}

#[cfg(not(feature = "cef"))]
fn main() {
    eprintln!("openducktor-desktop-helper only runs when the `cef` feature is enabled");
    std::process::exit(1);
}

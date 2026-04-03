#[cfg_attr(feature = "cef", tauri::cef_entry_point)]
fn main() {
    if let Err(error) = openducktor_desktop_lib::run() {
        eprintln!("OpenDucktor failed to start: {error:#}");
        std::process::exit(1);
    }
}

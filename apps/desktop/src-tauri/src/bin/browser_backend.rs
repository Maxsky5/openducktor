#[tokio::main]
async fn main() {
    let port = std::env::var("ODT_BROWSER_BACKEND_PORT")
        .ok()
        .and_then(|raw| raw.parse::<u16>().ok())
        .unwrap_or(14327);

    if let Err(error) = openducktor_desktop_lib::run_browser_backend(port).await {
        eprintln!("OpenDucktor browser backend failed to start: {error:#}");
        std::process::exit(1);
    }
}

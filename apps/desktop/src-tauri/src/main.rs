#[cfg_attr(feature = "cef", tauri::cef_entry_point)]
fn main() {
    if let Some(port) = parse_browser_backend_port(std::env::args().skip(1).collect()) {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("browser backend runtime should build");
        runtime.block_on(async move {
            if let Err(error) = openducktor_desktop_lib::run_browser_backend(port).await {
                eprintln!("OpenDucktor browser backend failed to start: {error:#}");
                std::process::exit(1);
            }
        });
        return;
    }

    if let Err(error) = openducktor_desktop_lib::run() {
        eprintln!("OpenDucktor failed to start: {error:#}");
        std::process::exit(1);
    }
}

fn parse_browser_backend_port(args: Vec<String>) -> Option<u16> {
    if !args.iter().any(|arg| arg == "--browser-backend") {
        return None;
    }

    let port = args
        .windows(2)
        .find(|pair| pair[0] == "--port")
        .and_then(|pair| pair[1].parse::<u16>().ok())
        .or_else(|| {
            std::env::var("ODT_BROWSER_BACKEND_PORT")
                .ok()
                .and_then(|raw| raw.parse::<u16>().ok())
        })
        .unwrap_or(14327);
    Some(port)
}

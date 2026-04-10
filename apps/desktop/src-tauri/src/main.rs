#[cfg_attr(feature = "cef", tauri::cef_entry_point)]
fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let browser_backend_port = match parse_browser_backend_port(&args) {
        Ok(port) => port,
        Err(error) => {
            eprintln!("OpenDucktor browser backend argument error: {error}");
            std::process::exit(1);
        }
    };

    if let Some(port) = browser_backend_port {
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

fn parse_port_value(raw: &str, source: &str) -> Result<u16, String> {
    raw.parse::<u16>()
        .map_err(|_| format!("Invalid {source} value for --browser-backend: `{raw}`"))
}

fn parse_browser_backend_port_from_sources(
    args: &[String],
    env_port: Option<&str>,
) -> Result<Option<u16>, String> {
    if !args.iter().any(|arg| arg == "--browser-backend") {
        return Ok(None);
    }

    if args.iter().any(|arg| arg == "--port") {
        let raw = args
            .windows(2)
            .find(|pair| pair[0] == "--port")
            .map(|pair| pair[1].as_str())
            .ok_or_else(|| "Missing value for --port with --browser-backend.".to_string())?;
        return parse_port_value(raw, "--port").map(Some);
    }

    if let Some(raw) = env_port {
        return parse_port_value(raw, "ODT_BROWSER_BACKEND_PORT").map(Some);
    }

    Ok(Some(14327))
}

fn parse_browser_backend_port(args: &[String]) -> Result<Option<u16>, String> {
    let env_port = std::env::var("ODT_BROWSER_BACKEND_PORT").ok();
    parse_browser_backend_port_from_sources(args, env_port.as_deref())
}

#[cfg(test)]
mod tests {
    use super::parse_browser_backend_port_from_sources;

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn parse_browser_backend_port_returns_none_without_browser_backend_flag() {
        assert_eq!(
            parse_browser_backend_port_from_sources(&args(&["--port", "1234"]), None),
            Ok(None)
        );
    }

    #[test]
    fn parse_browser_backend_port_uses_explicit_cli_port() {
        assert_eq!(
            parse_browser_backend_port_from_sources(
                &args(&["--browser-backend", "--port", "2345"]),
                Some("9999"),
            ),
            Ok(Some(2345))
        );
    }

    #[test]
    fn parse_browser_backend_port_rejects_invalid_explicit_cli_port() {
        let error = parse_browser_backend_port_from_sources(
            &args(&["--browser-backend", "--port", "invalid"]),
            None,
        )
        .expect_err("invalid explicit port should fail");

        assert!(error.contains("Invalid --port value"));
    }

    #[test]
    fn parse_browser_backend_port_applies_default_when_no_override_is_provided() {
        assert_eq!(
            parse_browser_backend_port_from_sources(&args(&["--browser-backend"]), None),
            Ok(Some(14327))
        );
    }
}

#[cfg_attr(feature = "cef", tauri::cef_entry_point)]
fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let browser_backend_config = match parse_browser_backend_config(&args) {
        Ok(config) => config,
        Err(error) => {
            eprintln!("OpenDucktor web host argument error: {error}");
            std::process::exit(1);
        }
    };

    if let Some(config) = browser_backend_config {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("web host runtime should build");
        runtime.block_on(async move {
            if let Err(error) = openducktor_desktop_lib::run_web_host(
                config.port,
                config.frontend_origin,
                config.control_token,
                config.app_token,
            )
            .await
            {
                eprintln!("OpenDucktor web host failed to start: {error:#}");
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

const WEB_HOST_FLAG: &str = "--web-host";
const LEGACY_BROWSER_BACKEND_FLAG: &str = "--browser-backend";
const WEB_HOST_FLAG_LABEL: &str = "--web-host/--browser-backend";

#[derive(Debug, PartialEq, Eq)]
struct BrowserBackendConfig {
    port: u16,
    frontend_origin: String,
    control_token: String,
    app_token: String,
}

fn parse_port_value(raw: &str, source: &str) -> Result<u16, String> {
    raw.parse::<u16>()
        .map_err(|_| format!("Invalid {source} value for {WEB_HOST_FLAG_LABEL}: `{raw}`"))
}

fn arg_value<'a>(args: &'a [String], flag: &str) -> Option<&'a str> {
    args.windows(2)
        .find(|pair| pair[0] == flag)
        .map(|pair| pair[1].as_str())
}

fn parse_required_non_empty_arg(args: &[String], flag: &str) -> Result<String, String> {
    let raw = arg_value(args, flag)
        .ok_or_else(|| format!("Missing required {flag} value with {WEB_HOST_FLAG_LABEL}."))?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(format!(
            "{flag} value for {WEB_HOST_FLAG_LABEL} cannot be empty."
        ));
    }
    Ok(trimmed.to_string())
}

fn parse_frontend_origin_arg(args: &[String]) -> Result<String, String> {
    let raw = parse_required_non_empty_arg(args, "--frontend-origin")?;
    openducktor_desktop_lib::validate_web_frontend_origin(&raw).map_err(|error| {
        format!("Invalid --frontend-origin value with {WEB_HOST_FLAG_LABEL}: {error:#}")
    })
}

fn has_web_host_flag(args: &[String]) -> bool {
    args.iter()
        .any(|arg| arg == WEB_HOST_FLAG || arg == LEGACY_BROWSER_BACKEND_FLAG)
}

fn parse_browser_backend_config_from_sources(
    args: &[String],
    env_port: Option<&str>,
) -> Result<Option<BrowserBackendConfig>, String> {
    if !has_web_host_flag(args) {
        return Ok(None);
    }

    let port = if args.iter().any(|arg| arg == "--port") {
        let raw = arg_value(args, "--port")
            .ok_or_else(|| format!("Missing value for --port with {WEB_HOST_FLAG_LABEL}."))?;
        parse_port_value(raw, "--port")?
    } else if let Some(raw) = env_port {
        parse_port_value(raw, "ODT_BROWSER_BACKEND_PORT")?
    } else {
        14327
    };

    Ok(Some(BrowserBackendConfig {
        port,
        frontend_origin: parse_frontend_origin_arg(args)?,
        control_token: parse_required_non_empty_arg(args, "--control-token")?,
        app_token: parse_required_non_empty_arg(args, "--app-token")?,
    }))
}

fn parse_browser_backend_config(args: &[String]) -> Result<Option<BrowserBackendConfig>, String> {
    let env_port = std::env::var("ODT_BROWSER_BACKEND_PORT").ok();
    parse_browser_backend_config_from_sources(args, env_port.as_deref())
}

#[cfg(test)]
mod tests {
    use super::{parse_browser_backend_config_from_sources, BrowserBackendConfig};

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn parse_browser_backend_config_returns_none_without_browser_backend_flag() {
        assert_eq!(
            parse_browser_backend_config_from_sources(&args(&["--port", "1234"]), None),
            Ok(None)
        );
    }

    #[test]
    fn parse_browser_backend_config_uses_explicit_cli_port() {
        assert_eq!(
            parse_browser_backend_config_from_sources(
                &args(&[
                    "--web-host",
                    "--port",
                    "2345",
                    "--frontend-origin",
                    "http://127.0.0.1:1420",
                    "--control-token",
                    "token-1",
                    "--app-token",
                    "app-token-1",
                ]),
                Some("9999"),
            ),
            Ok(Some(BrowserBackendConfig {
                port: 2345,
                frontend_origin: "http://127.0.0.1:1420".to_string(),
                control_token: "token-1".to_string(),
                app_token: "app-token-1".to_string(),
            }))
        );
    }

    #[test]
    fn parse_browser_backend_config_accepts_legacy_browser_backend_flag() {
        assert_eq!(
            parse_browser_backend_config_from_sources(
                &args(&[
                    "--browser-backend",
                    "--frontend-origin",
                    "http://127.0.0.1:1420",
                    "--control-token",
                    "token-1",
                    "--app-token",
                    "app-token-1",
                ]),
                None,
            ),
            Ok(Some(BrowserBackendConfig {
                port: 14327,
                frontend_origin: "http://127.0.0.1:1420".to_string(),
                control_token: "token-1".to_string(),
                app_token: "app-token-1".to_string(),
            }))
        );
    }

    #[test]
    fn parse_browser_backend_config_rejects_invalid_explicit_cli_port() {
        let error = parse_browser_backend_config_from_sources(
            &args(&[
                "--browser-backend",
                "--port",
                "invalid",
                "--frontend-origin",
                "http://127.0.0.1:1420",
                "--control-token",
                "token-1",
                "--app-token",
                "app-token-1",
            ]),
            None,
        )
        .expect_err("invalid explicit port should fail");

        assert!(error.contains("Invalid --port value"));
    }

    #[test]
    fn parse_browser_backend_config_applies_default_when_no_override_is_provided() {
        assert_eq!(
            parse_browser_backend_config_from_sources(
                &args(&[
                    "--browser-backend",
                    "--frontend-origin",
                    "http://127.0.0.1:1420",
                    "--control-token",
                    "token-1",
                    "--app-token",
                    "app-token-1",
                ]),
                None,
            ),
            Ok(Some(BrowserBackendConfig {
                port: 14327,
                frontend_origin: "http://127.0.0.1:1420".to_string(),
                control_token: "token-1".to_string(),
                app_token: "app-token-1".to_string(),
            }))
        );
    }

    #[test]
    fn parse_browser_backend_config_requires_frontend_origin() {
        let error = parse_browser_backend_config_from_sources(
            &args(&[
                "--browser-backend",
                "--control-token",
                "token-1",
                "--app-token",
                "app-token-1",
            ]),
            None,
        )
        .expect_err("missing frontend origin should fail");

        assert!(error.contains("Missing required --frontend-origin value"));
    }

    #[test]
    fn parse_browser_backend_config_requires_control_token() {
        let error = parse_browser_backend_config_from_sources(
            &args(&[
                "--browser-backend",
                "--frontend-origin",
                "http://127.0.0.1:1420",
                "--app-token",
                "app-token-1",
            ]),
            None,
        )
        .expect_err("missing control token should fail");

        assert!(error.contains("Missing required --control-token value"));
    }

    #[test]
    fn parse_browser_backend_config_requires_app_token() {
        let error = parse_browser_backend_config_from_sources(
            &args(&[
                "--browser-backend",
                "--frontend-origin",
                "http://127.0.0.1:1420",
                "--control-token",
                "token-1",
            ]),
            None,
        )
        .expect_err("missing app token should fail");

        assert!(error.contains("Missing required --app-token value"));
    }

    #[test]
    fn parse_browser_backend_config_rejects_non_loopback_origin() {
        let error = parse_browser_backend_config_from_sources(
            &args(&[
                "--browser-backend",
                "--frontend-origin",
                "https://example.com:1420",
                "--control-token",
                "token-1",
                "--app-token",
                "app-token-1",
            ]),
            None,
        )
        .expect_err("non-loopback origin should fail");

        assert!(error.contains("Invalid --frontend-origin value"));
    }
}

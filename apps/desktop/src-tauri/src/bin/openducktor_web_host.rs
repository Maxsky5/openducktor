use std::collections::VecDeque;

const DEFAULT_PORT: u16 = 14327;

#[derive(Debug, PartialEq, Eq)]
struct WebHostArgs {
    port: u16,
    frontend_origin: String,
    control_token: String,
    app_token: String,
}

fn parse_port_value(raw: &str, source: &str) -> Result<u16, String> {
    raw.parse::<u16>()
        .map_err(|_| format!("Invalid {source} value for openducktor-web-host: `{raw}`"))
}

fn require_value(args: &mut VecDeque<String>, flag: &str) -> Result<String, String> {
    args.pop_front()
        .ok_or_else(|| format!("Missing value for {flag}."))
}

fn parse_web_host_args_from<I>(values: I) -> Result<WebHostArgs, String>
where
    I: IntoIterator<Item = String>,
{
    let mut args = values.into_iter().collect::<VecDeque<_>>();
    let mut port = DEFAULT_PORT;
    let mut frontend_origin: Option<String> = None;
    let mut control_token: Option<String> = None;
    let mut app_token: Option<String> = None;

    while let Some(arg) = args.pop_front() {
        match arg.as_str() {
            "--port" => {
                port = parse_port_value(&require_value(&mut args, "--port")?, "--port")?;
            }
            "--frontend-origin" => {
                let value = require_value(&mut args, "--frontend-origin")?;
                let origin = openducktor_desktop_lib::validate_web_frontend_origin(&value)
                    .map_err(|error| format!("Invalid --frontend-origin: {error:#}"))?;
                frontend_origin = Some(origin);
            }
            "--control-token" => {
                let value = require_value(&mut args, "--control-token")?;
                if value.trim().is_empty() {
                    return Err("--control-token cannot be empty.".to_string());
                }
                control_token = Some(value);
            }
            "--app-token" => {
                let value = require_value(&mut args, "--app-token")?;
                if value.trim().is_empty() {
                    return Err("--app-token cannot be empty.".to_string());
                }
                app_token = Some(value);
            }
            "--web-host" | "--browser-backend" => {
                // The dedicated binary is already the web host. Accept the desktop
                // executable's mode selectors so internal bridge spawns can reuse
                // the same argument vector regardless of which binary is current.
            }
            "-h" | "--help" => {
                return Err(
                    "Usage: openducktor-web-host [--web-host] --frontend-origin <origin> --control-token <token> --app-token <token> [--port <port>]"
                        .to_string(),
                );
            }
            _ => return Err(format!("Unknown openducktor-web-host option: {arg}")),
        }
    }

    Ok(WebHostArgs {
        port,
        frontend_origin: frontend_origin
            .ok_or_else(|| "Missing required --frontend-origin.".to_string())?,
        control_token: control_token
            .ok_or_else(|| "Missing required --control-token.".to_string())?,
        app_token: app_token.ok_or_else(|| "Missing required --app-token.".to_string())?,
    })
}

fn parse_web_host_args() -> Result<WebHostArgs, String> {
    parse_web_host_args_from(std::env::args().skip(1))
}

fn main() {
    let args = match parse_web_host_args() {
        Ok(args) => args,
        Err(error) => {
            eprintln!("OpenDucktor web host argument error: {error}");
            std::process::exit(1);
        }
    };

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("web host runtime should build");
    runtime.block_on(async move {
        if let Err(error) = openducktor_desktop_lib::run_web_host(
            args.port,
            args.frontend_origin,
            args.control_token,
            args.app_token,
        )
        .await
        {
            eprintln!("OpenDucktor web host failed to start: {error:#}");
            std::process::exit(1);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{parse_web_host_args_from, WebHostArgs};

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn parse_web_host_args_requires_frontend_origin() {
        let error = parse_web_host_args_from(args(&[
            "--control-token",
            "token",
            "--app-token",
            "app-token",
        ]))
        .expect_err("missing frontend origin should fail");

        assert!(error.contains("Missing required --frontend-origin"));
    }

    #[test]
    fn parse_web_host_args_requires_control_token() {
        let error = parse_web_host_args_from(args(&[
            "--frontend-origin",
            "http://127.0.0.1:1420",
            "--app-token",
            "app-token",
        ]))
        .expect_err("missing control token should fail");

        assert!(error.contains("Missing required --control-token"));
    }

    #[test]
    fn parse_web_host_args_requires_app_token() {
        let error = parse_web_host_args_from(args(&[
            "--frontend-origin",
            "http://127.0.0.1:1420",
            "--control-token",
            "token",
        ]))
        .expect_err("missing app token should fail");

        assert!(error.contains("Missing required --app-token"));
    }

    #[test]
    fn parse_web_host_args_uses_explicit_port() {
        assert_eq!(
            parse_web_host_args_from(args(&[
                "--frontend-origin",
                "http://127.0.0.1:1420",
                "--control-token",
                "token",
                "--app-token",
                "app-token",
                "--port",
                "2345",
            ])),
            Ok(WebHostArgs {
                port: 2345,
                frontend_origin: "http://127.0.0.1:1420".to_string(),
                control_token: "token".to_string(),
                app_token: "app-token".to_string(),
            })
        );
    }

    #[test]
    fn parse_web_host_args_accepts_desktop_mode_selector_for_bridge_spawns() {
        assert_eq!(
            parse_web_host_args_from(args(&[
                "--web-host",
                "--frontend-origin",
                "http://127.0.0.1:1420",
                "--control-token",
                "token",
                "--app-token",
                "app-token",
                "--port",
                "2345",
            ])),
            Ok(WebHostArgs {
                port: 2345,
                frontend_origin: "http://127.0.0.1:1420".to_string(),
                control_token: "token".to_string(),
                app_token: "app-token".to_string(),
            })
        );
    }

    #[test]
    fn parse_web_host_args_accepts_legacy_browser_backend_selector_for_bridge_spawns() {
        assert_eq!(
            parse_web_host_args_from(args(&[
                "--browser-backend",
                "--frontend-origin",
                "http://127.0.0.1:1420",
                "--control-token",
                "token",
                "--app-token",
                "app-token",
            ])),
            Ok(WebHostArgs {
                port: 14327,
                frontend_origin: "http://127.0.0.1:1420".to_string(),
                control_token: "token".to_string(),
                app_token: "app-token".to_string(),
            })
        );
    }

    #[test]
    fn parse_web_host_args_rejects_origin_with_path() {
        let error = parse_web_host_args_from(args(&[
            "--frontend-origin",
            "http://127.0.0.1:1420/app",
            "--control-token",
            "token",
            "--app-token",
            "app-token",
        ]))
        .expect_err("origin path should fail");

        assert!(error.contains("Invalid --frontend-origin"));
    }
}

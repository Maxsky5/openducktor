use anyhow::{anyhow, Context, Result};
use host_domain::RuntimeRoute;
use std::collections::HashMap;
use std::io::ErrorKind;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::time::Duration;
use url::{form_urlencoded, Url};

#[derive(serde::Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(crate) enum OpencodeSessionStatus {
    Idle,
    Retry {
        #[allow(dead_code)]
        attempt: u64,
        #[allow(dead_code)]
        message: String,
        #[allow(dead_code)]
        next: u64,
    },
    Busy,
}

pub(crate) type OpencodeSessionStatusMap = HashMap<String, OpencodeSessionStatus>;

pub(crate) fn is_unreachable_opencode_session_status_error(error: &anyhow::Error) -> bool {
    error.chain().any(|cause| {
        cause
            .downcast_ref::<std::io::Error>()
            .is_some_and(|io_error| {
                matches!(
                    io_error.kind(),
                    ErrorKind::ConnectionRefused
                        | ErrorKind::ConnectionReset
                        | ErrorKind::ConnectionAborted
                        | ErrorKind::NotConnected
                        | ErrorKind::TimedOut
                        | ErrorKind::UnexpectedEof
                )
            })
    })
}

pub(crate) fn has_live_opencode_session_status(
    statuses: &OpencodeSessionStatusMap,
    external_session_id: &str,
) -> bool {
    matches!(
        statuses.get(external_session_id),
        Some(OpencodeSessionStatus::Busy | OpencodeSessionStatus::Retry { .. })
    )
}

pub(crate) fn load_opencode_session_statuses(
    runtime_route: &RuntimeRoute,
    working_directory: &str,
) -> Result<OpencodeSessionStatusMap> {
    let endpoint = match runtime_route {
        RuntimeRoute::LocalHttp { endpoint } => endpoint.as_str(),
    };
    let parsed_endpoint = Url::parse(endpoint)
        .with_context(|| format!("Invalid OpenCode runtime endpoint: {endpoint}"))?;
    let host = parsed_endpoint
        .host_str()
        .ok_or_else(|| anyhow!("OpenCode runtime endpoint is missing a host: {endpoint}"))?;
    let port = parsed_endpoint
        .port()
        .ok_or_else(|| anyhow!("OpenCode runtime route must expose a port: {endpoint}"))?;
    let request_path = format!(
        "/session/status?{}",
        form_urlencoded::Serializer::new(String::new())
            .append_pair("directory", working_directory)
            .finish()
    );
    let mut stream = TcpStream::connect((host, port)).with_context(|| {
        format!(
            "Failed to connect to OpenCode runtime at {endpoint} to inspect session status for {working_directory}"
        )
    })?;
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .context("Failed configuring OpenCode session status read timeout")?;
    stream
        .set_write_timeout(Some(Duration::from_secs(2)))
        .context("Failed configuring OpenCode session status write timeout")?;

    let request =
        format!("GET {request_path} HTTP/1.1\r\nHost: {host}:{port}\r\nConnection: close\r\n\r\n");
    stream.write_all(request.as_bytes()).with_context(|| {
        format!("Failed sending OpenCode session status request for {working_directory}")
    })?;
    stream.flush().with_context(|| {
        format!("Failed flushing OpenCode session status request for {working_directory}")
    })?;

    let mut reader = BufReader::new(stream);
    let mut status_line = String::new();
    reader.read_line(&mut status_line).with_context(|| {
        format!("Failed reading OpenCode session status response for {working_directory}")
    })?;
    let status_code = parse_http_status_code(status_line.as_str())?;

    let mut response = String::new();
    reader.read_to_string(&mut response).with_context(|| {
        format!("Failed reading OpenCode session status body for {working_directory}")
    })?;

    if !(200..300).contains(&status_code) {
        let response_body = extract_http_response_body(response.as_str());
        let detail_suffix = if response_body.is_empty() {
            String::new()
        } else {
            format!(": {response_body}")
        };
        return Err(anyhow!(
            "OpenCode runtime failed to load session status for {working_directory}: HTTP {status_code}{detail_suffix}"
        ));
    }

    let body = extract_http_response_body(response.as_str());
    serde_json::from_str::<OpencodeSessionStatusMap>(body.as_str()).with_context(|| {
        format!("Failed parsing OpenCode session status response for {working_directory}")
    })
}

fn parse_http_status_code(status_line: &str) -> Result<u16> {
    let trimmed = status_line.trim();
    let status_code = trimmed
        .split_whitespace()
        .nth(1)
        .ok_or_else(|| anyhow!("OpenCode response missing HTTP status code"))?;
    status_code
        .parse::<u16>()
        .with_context(|| format!("Invalid OpenCode HTTP status code: {status_code}"))
}

fn extract_http_response_body(response: &str) -> String {
    response
        .split_once("\r\n\r\n")
        .or_else(|| response.split_once("\n\n"))
        .map(|(_, body)| body.trim().to_string())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::{
        has_live_opencode_session_status, load_opencode_session_statuses, OpencodeSessionStatus,
    };
    use host_domain::AgentRuntimeKind;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};

    #[test]
    fn load_opencode_session_statuses_sends_directory_query_and_parses_response() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
        let port = listener
            .local_addr()
            .expect("listener should expose addr")
            .port();
        let request_line = Arc::new(Mutex::new(None::<String>));
        let request_line_for_thread = Arc::clone(&request_line);

        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("server should accept request");
            let mut request_buffer = [0_u8; 4096];
            let bytes_read = stream
                .read(&mut request_buffer)
                .expect("server should read request");
            let request_text = String::from_utf8_lossy(&request_buffer[..bytes_read]);
            let first_line = request_text.lines().next().unwrap_or_default().to_string();
            *request_line_for_thread
                .lock()
                .expect("request line lock poisoned") = Some(first_line);

            let body = r#"{"external-session":{"type":"busy"}}"#;
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            stream
                .write_all(response.as_bytes())
                .expect("server should write response");
            stream.flush().expect("server should flush response");
        });

        let runtime_route = AgentRuntimeKind::Opencode.route_for_port(port);

        let statuses = load_opencode_session_statuses(&runtime_route, "/tmp/repo path")
            .expect("status request should succeed");
        assert!(matches!(
            statuses.get("external-session"),
            Some(OpencodeSessionStatus::Busy)
        ));
        assert!(has_live_opencode_session_status(
            &statuses,
            "external-session"
        ));

        server.join().expect("server thread should finish");
        let captured_request = request_line
            .lock()
            .expect("request line lock poisoned")
            .clone()
            .expect("request line should be captured");
        assert!(
            captured_request
                .starts_with("GET /session/status?directory=%2Ftmp%2Frepo+path HTTP/1.1"),
            "unexpected request line: {captured_request}"
        );
    }
}

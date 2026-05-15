use super::CodexAppServerEventEmitter;
use anyhow::{anyhow, Context, Result};
use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{ChildStderr, ChildStdin, ChildStdout};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

const DEFAULT_CODEX_APP_SERVER_REQUEST_TIMEOUT: Duration = Duration::from_secs(120);

struct CodexAppServerTransportInner {
    identity: String,
    stdin: Mutex<Option<ChildStdin>>,
    pending_requests: Mutex<HashMap<u64, mpsc::Sender<Result<Value>>>>,
    events: Mutex<CodexAppServerEvents>,
    event_emitter: Option<CodexAppServerEventEmitter>,
    fatal_error: Mutex<Option<String>>,
    next_request_id: AtomicU64,
    closed: AtomicBool,
    stdout_thread: Mutex<Option<JoinHandle<()>>>,
    stderr_thread: Mutex<Option<JoinHandle<()>>>,
}

#[derive(Default)]
struct CodexAppServerEvents {
    notifications: Vec<Value>,
    server_requests: Vec<Value>,
}

#[derive(Clone)]
pub(crate) struct CodexAppServerTransport {
    inner: Arc<CodexAppServerTransportInner>,
}

impl CodexAppServerTransport {
    pub(crate) fn spawn(
        identity: impl Into<String>,
        stdin: ChildStdin,
        stdout: ChildStdout,
        stderr: ChildStderr,
        event_emitter: Option<CodexAppServerEventEmitter>,
    ) -> Result<Arc<Self>> {
        let identity = identity.into();
        let inner = Arc::new(CodexAppServerTransportInner {
            identity,
            stdin: Mutex::new(Some(stdin)),
            pending_requests: Mutex::new(HashMap::new()),
            events: Mutex::new(CodexAppServerEvents::default()),
            event_emitter,
            fatal_error: Mutex::new(None),
            next_request_id: AtomicU64::new(1),
            closed: AtomicBool::new(false),
            stdout_thread: Mutex::new(None),
            stderr_thread: Mutex::new(None),
        });
        let transport = Arc::new(Self { inner });

        Self::spawn_stdout_thread(transport.clone(), stdout)?;
        Self::spawn_stderr_thread(transport.clone(), stderr)?;

        Ok(transport)
    }

    pub(crate) fn request(&self, method: &str, params: Option<Value>) -> Result<Value> {
        self.request_with_timeout(method, params, DEFAULT_CODEX_APP_SERVER_REQUEST_TIMEOUT)
    }

    pub(crate) fn request_with_timeout(
        &self,
        method: &str,
        params: Option<Value>,
        timeout: Duration,
    ) -> Result<Value> {
        let request_id = self.inner.next_request_id.fetch_add(1, Ordering::SeqCst);
        self.ensure_open()?;

        let (tx, rx) = mpsc::channel();
        self.inner
            .pending_requests
            .lock()
            .map_err(|_| anyhow!("Codex app-server pending request map is poisoned"))?
            .insert(request_id, tx);

        if let Err(error) = self.write_message(Some(request_id), method, params) {
            let _ = self
                .inner
                .pending_requests
                .lock()
                .ok()
                .and_then(|mut pending| pending.remove(&request_id));
            return Err(error);
        }

        match rx.recv_timeout(timeout) {
            Ok(result) => result,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                let _ = self
                    .inner
                    .pending_requests
                    .lock()
                    .ok()
                    .and_then(|mut pending| pending.remove(&request_id));
                Err(anyhow!(
                    "Timed out waiting for Codex app-server request {method} on runtime {} after {}ms",
                    self.inner.identity,
                    timeout.as_millis()
                ))
            }
            Err(_) => Err(anyhow!(
                "Codex app-server request {method} on runtime {} was interrupted",
                self.inner.identity
            )),
        }
    }

    pub(crate) fn notify(&self, method: &str, params: Option<Value>) -> Result<()> {
        self.ensure_open()?;
        self.write_message(None, method, params)
    }

    pub(crate) fn drain_notifications(&self) -> Result<Vec<Value>> {
        self.inner
            .events
            .lock()
            .map(|mut events| std::mem::take(&mut events.notifications))
            .map_err(|_| anyhow!("Codex app-server notifications queue is poisoned"))
    }

    pub(crate) fn drain_server_requests(&self) -> Result<Vec<Value>> {
        self.inner
            .events
            .lock()
            .map(|mut events| std::mem::take(&mut events.server_requests))
            .map_err(|_| anyhow!("Codex app-server request queue is poisoned"))
    }

    pub(crate) fn respond_server_request(
        &self,
        request_id: u64,
        result: Option<Value>,
        error: Option<Value>,
    ) -> Result<()> {
        self.ensure_open()?;
        self.write_server_request_response(request_id, result, error)
    }

    pub(crate) fn close(&self) -> Result<()> {
        self.inner.closed.store(true, Ordering::SeqCst);
        self.inner
            .stdin
            .lock()
            .map_err(|_| anyhow!("Codex app-server stdin lock is poisoned"))?
            .take();

        let mut errors = Vec::new();
        if let Some(handle) = self
            .inner
            .stdout_thread
            .lock()
            .map_err(|_| anyhow!("Codex app-server stdout thread lock is poisoned"))?
            .take()
        {
            if let Err(error) = handle.join() {
                errors.push(format!("stdout reader thread panicked: {error:?}"));
            }
        }
        if let Some(handle) = self
            .inner
            .stderr_thread
            .lock()
            .map_err(|_| anyhow!("Codex app-server stderr thread lock is poisoned"))?
            .take()
        {
            if let Err(error) = handle.join() {
                errors.push(format!("stderr reader thread panicked: {error:?}"));
            }
        }

        if errors.is_empty() {
            Ok(())
        } else {
            Err(anyhow!(errors.join("\n")))
        }
    }

    fn spawn_stdout_thread(transport: Arc<Self>, stdout: ChildStdout) -> Result<()> {
        let reader_transport = transport.clone();
        let handle = thread::Builder::new()
            .name(format!(
                "codex-app-server-stdout-{}",
                transport.inner.identity
            ))
            .spawn(move || reader_transport.read_stdout(stdout))
            .context("Failed to spawn Codex app-server stdout reader thread")?;
        *transport
            .inner
            .stdout_thread
            .lock()
            .map_err(|_| anyhow!("Codex app-server stdout thread lock is poisoned"))? =
            Some(handle);
        Ok(())
    }

    fn spawn_stderr_thread(transport: Arc<Self>, stderr: ChildStderr) -> Result<()> {
        let reader_transport = transport.clone();
        let handle = thread::Builder::new()
            .name(format!(
                "codex-app-server-stderr-{}",
                transport.inner.identity
            ))
            .spawn(move || reader_transport.drain_stderr(stderr))
            .context("Failed to spawn Codex app-server stderr drain thread")?;
        *transport
            .inner
            .stderr_thread
            .lock()
            .map_err(|_| anyhow!("Codex app-server stderr thread lock is poisoned"))? =
            Some(handle);
        Ok(())
    }

    fn read_stdout(&self, stdout: ChildStdout) {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        loop {
            line.clear();
            let read_result = reader.read_line(&mut line);
            match read_result {
                Ok(0) => {
                    self.fail_fast(anyhow!(
                        "Codex app-server stdout closed unexpectedly for runtime {}",
                        self.inner.identity
                    ));
                    break;
                }
                Ok(_) => {
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    if let Err(error) = self.handle_stdout_line(trimmed) {
                        self.fail_fast(error);
                        break;
                    }
                }
                Err(error) => {
                    self.fail_fast(anyhow!(
                        "Failed reading Codex app-server stdout for runtime {}: {error}",
                        self.inner.identity
                    ));
                    break;
                }
            }
        }
    }

    fn drain_stderr(&self, stderr: ChildStderr) {
        let mut reader = BufReader::new(stderr);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) => break,
                Ok(_) => {
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    tracing::warn!(
                        "Codex app-server stderr for runtime {}: {trimmed}",
                        self.inner.identity
                    );
                }
                Err(error) => {
                    tracing::warn!(
                        "Failed reading Codex app-server stderr for runtime {}: {error}",
                        self.inner.identity
                    );
                    break;
                }
            }
        }
    }

    fn handle_stdout_line(&self, line: &str) -> Result<()> {
        let message: Value = serde_json::from_str(line).with_context(|| {
            format!(
                "Invalid Codex app-server JSON on stdout for runtime {}: {line}",
                self.inner.identity
            )
        })?;
        let Some(object) = message.as_object() else {
            return Err(anyhow!(
                "Codex app-server stdout message for runtime {} must be a JSON object",
                self.inner.identity
            ));
        };

        let has_method = object.contains_key("method");
        let has_result = object.contains_key("result");
        let has_error = object.contains_key("error");
        let id = object.get("id").and_then(Value::as_u64);

        if has_result || has_error {
            let Some(request_id) = id else {
                return Err(anyhow!(
                    "Codex app-server response for runtime {} is missing a numeric id",
                    self.inner.identity
                ));
            };
            return self.resolve_request(request_id, message);
        }

        if has_method && id.is_none() {
            self.emit_stream_event("notification", &message);
            if self.inner.event_emitter.is_none() {
                self.inner
                    .events
                    .lock()
                    .map_err(|_| anyhow!("Codex app-server event queues are poisoned"))?
                    .notifications
                    .push(message);
            }
            return Ok(());
        }

        if has_method && id.is_some() {
            self.emit_stream_event("server_request", &message);
            if self.inner.event_emitter.is_none() {
                self.inner
                    .events
                    .lock()
                    .map_err(|_| anyhow!("Codex app-server event queues are poisoned"))?
                    .server_requests
                    .push(message.clone());
            }
            return Ok(());
        }

        Err(anyhow!(
            "Codex app-server stdout message for runtime {} is not valid JSON-RPC",
            self.inner.identity
        ))
    }

    fn resolve_request(&self, request_id: u64, message: Value) -> Result<()> {
        let pending = self
            .inner
            .pending_requests
            .lock()
            .map_err(|_| anyhow!("Codex app-server pending request map is poisoned"))?
            .remove(&request_id)
            .ok_or_else(|| {
                anyhow!(
                    "Received Codex app-server response with unexpected id {request_id} for runtime {}",
                    self.inner.identity
                )
            })?;

        if let Some(error_value) = message.get("error") {
            let error_message = if error_value.is_string() {
                error_value.as_str().unwrap_or_default().to_string()
            } else {
                error_value.to_string()
            };
            let _ = pending.send(Err(anyhow!(
                "Codex app-server request {request_id} failed for runtime {}: {error_message}",
                self.inner.identity
            )));
            return Ok(());
        }

        let Some(result) = message.get("result") else {
            let _ = pending.send(Err(anyhow!(
                "Codex app-server response {request_id} for runtime {} is missing result or error",
                self.inner.identity
            )));
            return Ok(());
        };

        let _ = pending.send(Ok(result.clone()));
        Ok(())
    }

    fn fail_fast(&self, error: anyhow::Error) {
        let error_message = error.to_string();
        self.inner.closed.store(true, Ordering::SeqCst);
        if let Ok(mut stdin) = self.inner.stdin.lock() {
            stdin.take();
        }
        let Ok(mut fatal_error) = self.inner.fatal_error.lock() else {
            return;
        };
        if fatal_error.is_none() {
            *fatal_error = Some(error_message.clone());
        }

        if let Ok(mut pending_requests) = self.inner.pending_requests.lock() {
            for (_, sender) in pending_requests.drain() {
                let _ = sender.send(Err(anyhow!(error_message.clone())));
            }
        }
    }

    fn emit_stream_event(&self, kind: &str, message: &Value) {
        let Some(emitter) = &self.inner.event_emitter else {
            return;
        };
        emitter(serde_json::json!({
            "runtimeId": self.inner.identity,
            "kind": kind,
            "message": message,
        }));
    }

    fn ensure_open(&self) -> Result<()> {
        if self.inner.closed.load(Ordering::SeqCst) {
            return Err(anyhow!(
                "Codex app-server transport for runtime {} is closed",
                self.inner.identity
            ));
        }

        if let Some(error) = self
            .inner
            .fatal_error
            .lock()
            .map_err(|_| anyhow!("Codex app-server fatal error state is poisoned"))?
            .clone()
        {
            return Err(anyhow!(error));
        }

        Ok(())
    }

    fn write_message(&self, id: Option<u64>, method: &str, params: Option<Value>) -> Result<()> {
        let mut object = serde_json::Map::new();
        object.insert("jsonrpc".to_string(), Value::String("2.0".to_string()));
        if let Some(id) = id {
            object.insert("id".to_string(), Value::from(id));
        }
        object.insert("method".to_string(), Value::String(method.to_string()));
        if let Some(params) = params {
            object.insert("params".to_string(), params);
        }

        let line = Value::Object(object).to_string();
        let mut stdin = self
            .inner
            .stdin
            .lock()
            .map_err(|_| anyhow!("Codex app-server stdin lock is poisoned"))?;
        let Some(stdin) = stdin.as_mut() else {
            return Err(anyhow!(
                "Codex app-server transport for runtime {} is closed",
                self.inner.identity
            ));
        };
        stdin.write_all(line.as_bytes()).with_context(|| {
            format!(
                "Failed writing Codex app-server request {method} for runtime {}",
                self.inner.identity
            )
        })?;
        stdin.write_all(b"\n").with_context(|| {
            format!(
                "Failed writing Codex app-server line terminator for runtime {}",
                self.inner.identity
            )
        })?;
        stdin.flush().with_context(|| {
            format!(
                "Failed flushing Codex app-server request {method} for runtime {}",
                self.inner.identity
            )
        })
    }

    fn write_server_request_response(
        &self,
        id: u64,
        result: Option<Value>,
        error: Option<Value>,
    ) -> Result<()> {
        if result.is_some() && error.is_some() {
            return Err(anyhow!(
                "Codex app-server response for runtime {} cannot include both result and error",
                self.inner.identity
            ));
        }
        if result.is_none() && error.is_none() {
            return Err(anyhow!(
                "Codex app-server response for runtime {} must include either result or error",
                self.inner.identity
            ));
        }

        let mut response = serde_json::Map::new();
        response.insert("jsonrpc".to_string(), Value::String("2.0".to_string()));
        response.insert("id".to_string(), Value::from(id));
        if let Some(result) = result {
            response.insert("result".to_string(), result);
        }
        if let Some(error) = error {
            response.insert("error".to_string(), error);
        }
        let response = Value::Object(response);
        let line = response.to_string();
        let mut stdin = self
            .inner
            .stdin
            .lock()
            .map_err(|_| anyhow!("Codex app-server stdin lock is poisoned"))?;
        let Some(stdin) = stdin.as_mut() else {
            return Err(anyhow!(
                "Codex app-server transport for runtime {} is closed",
                self.inner.identity
            ));
        };
        stdin.write_all(line.as_bytes()).with_context(|| {
            format!(
                "Failed writing Codex app-server error response for runtime {}",
                self.inner.identity
            )
        })?;
        stdin.write_all(b"\n").with_context(|| {
            format!(
                "Failed writing Codex app-server error response terminator for runtime {}",
                self.inner.identity
            )
        })?;
        stdin.flush().with_context(|| {
            format!(
                "Failed flushing Codex app-server error response for runtime {}",
                self.inner.identity
            )
        })
    }
}

use super::{AppService, DevServerGroupRuntime};
use host_domain::{now_rfc3339, DevServerEvent, DevServerScriptState, DevServerTerminalChunk};
use std::collections::HashMap;
use std::io::Read;
use std::sync::{Arc, Mutex};

pub(super) const DEV_SERVER_TERMINAL_BUFFER_CHUNK_LIMIT: usize = 2_000;
pub(super) const DEV_SERVER_TERMINAL_BUFFER_BYTE_LIMIT: usize = 512 * 1024;
const DEV_SERVER_TERMINAL_CHUNK_READ_SIZE: usize = 4 * 1024;

pub(super) fn emit_group_snapshot(
    groups: Arc<Mutex<HashMap<String, DevServerGroupRuntime>>>,
    group_key: &str,
) {
    let (emitter, state) = {
        let Ok(groups) = groups.lock() else {
            return;
        };
        let Some(runtime) = groups.get(group_key) else {
            return;
        };
        (runtime.emitter.clone(), runtime.state.clone())
    };
    if let Some(emitter) = emitter {
        emitter(DevServerEvent::Snapshot { state });
    }
}

pub(super) fn emit_terminal_chunk(
    groups: &Arc<Mutex<HashMap<String, DevServerGroupRuntime>>>,
    group_key: &str,
    repo_path: &str,
    task_id: &str,
    script_id: &str,
    data: String,
) {
    if data.is_empty() {
        return;
    }

    let timestamp = now_rfc3339();
    let (emitter, terminal_chunk) = {
        let Ok(mut groups) = groups.lock() else {
            return;
        };
        let Some(runtime) = groups.get_mut(group_key) else {
            return;
        };
        let Some(script) = runtime
            .state
            .scripts
            .iter_mut()
            .find(|script| script.script_id == script_id)
        else {
            return;
        };
        let terminal_chunk = push_terminal_chunk(script, data, timestamp);
        runtime.state.updated_at = now_rfc3339();
        (runtime.emitter.clone(), terminal_chunk)
    };

    if let Some(emitter) = emitter {
        emitter(DevServerEvent::TerminalChunk {
            repo_path: repo_path.to_string(),
            task_id: task_id.to_string(),
            terminal_chunk,
        });
    }
}

pub(super) fn spawn_terminal_forwarder<R>(
    groups: Arc<Mutex<HashMap<String, DevServerGroupRuntime>>>,
    group_key: String,
    repo_path: String,
    task_id: String,
    script_id: String,
    reader: R,
) where
    R: Read + Send + 'static,
{
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buffer = [0_u8; DEV_SERVER_TERMINAL_CHUNK_READ_SIZE];
        let mut pending = Vec::new();

        loop {
            match reader.read(&mut buffer) {
                Ok(0) => {
                    let _ = flush_pending_terminal_bytes(
                        &groups,
                        group_key.as_str(),
                        repo_path.as_str(),
                        task_id.as_str(),
                        script_id.as_str(),
                        &mut pending,
                        true,
                    );
                    break;
                }
                Ok(read) => {
                    pending.extend_from_slice(&buffer[..read]);
                    if !flush_pending_terminal_bytes(
                        &groups,
                        group_key.as_str(),
                        repo_path.as_str(),
                        task_id.as_str(),
                        script_id.as_str(),
                        &mut pending,
                        false,
                    ) {
                        break;
                    }
                }
                Err(error) => {
                    if error.kind() == std::io::ErrorKind::Interrupted {
                        continue;
                    }
                    emit_terminal_chunk(
                        &groups,
                        group_key.as_str(),
                        repo_path.as_str(),
                        task_id.as_str(),
                        script_id.as_str(),
                        format_terminal_system_message(
                            format!("Dev server terminal stream failed: {error}").as_str(),
                        ),
                    );
                    break;
                }
            }
        }
    });
}

fn flush_pending_terminal_bytes(
    groups: &Arc<Mutex<HashMap<String, DevServerGroupRuntime>>>,
    group_key: &str,
    repo_path: &str,
    task_id: &str,
    script_id: &str,
    pending: &mut Vec<u8>,
    reached_eof: bool,
) -> bool {
    loop {
        if pending.is_empty() {
            return true;
        }

        match std::str::from_utf8(pending) {
            Ok(text) => {
                emit_terminal_chunk(
                    groups,
                    group_key,
                    repo_path,
                    task_id,
                    script_id,
                    text.to_string(),
                );
                pending.clear();
                return true;
            }
            Err(error) => {
                let valid_up_to = error.valid_up_to();
                if valid_up_to > 0 {
                    let text = std::str::from_utf8(&pending[..valid_up_to])
                        .expect("valid UTF-8 prefix should decode");
                    emit_terminal_chunk(
                        groups,
                        group_key,
                        repo_path,
                        task_id,
                        script_id,
                        text.to_string(),
                    );
                    pending.drain(0..valid_up_to);
                    continue;
                }

                if error.error_len().is_none() && !reached_eof {
                    return true;
                }

                if let Some(error_len) = error.error_len() {
                    emit_terminal_chunk(
                        groups,
                        group_key,
                        repo_path,
                        task_id,
                        script_id,
                        format_terminal_system_message(
                            "Dev server terminal output contained invalid UTF-8 bytes and could not be fully rendered.",
                        ),
                    );
                    pending.drain(0..error_len);
                    continue;
                }

                emit_terminal_chunk(
                    groups,
                    group_key,
                    repo_path,
                    task_id,
                    script_id,
                    format_terminal_system_message(
                        "Dev server terminal output contained invalid UTF-8 bytes and could not be fully rendered.",
                    ),
                );
                pending.clear();
                return true;
            }
        }
    }
}

pub(super) fn push_terminal_chunk(
    script: &mut DevServerScriptState,
    data: String,
    timestamp: String,
) -> DevServerTerminalChunk {
    let terminal_chunk = DevServerTerminalChunk {
        script_id: script.script_id.clone(),
        sequence: script.next_terminal_sequence,
        data,
        timestamp,
    };
    script.next_terminal_sequence = script.next_terminal_sequence.saturating_add(1);
    script.buffered_terminal_chunks.push(terminal_chunk.clone());
    trim_terminal_chunk_buffer(&mut script.buffered_terminal_chunks);
    terminal_chunk
}

fn trim_terminal_chunk_buffer(chunks: &mut Vec<DevServerTerminalChunk>) {
    let mut remove_count = 0;
    let mut total_bytes = chunks.iter().map(|chunk| chunk.data.len()).sum::<usize>();

    while chunks.len().saturating_sub(remove_count) > DEV_SERVER_TERMINAL_BUFFER_CHUNK_LIMIT
        || total_bytes > DEV_SERVER_TERMINAL_BUFFER_BYTE_LIMIT
    {
        let Some(chunk) = chunks.get(remove_count) else {
            break;
        };
        total_bytes = total_bytes.saturating_sub(chunk.data.len());
        remove_count += 1;
    }

    if remove_count > 0 {
        chunks.drain(0..remove_count);
    }
}

pub(super) fn format_terminal_system_message(message: &str) -> String {
    let normalized = message.replace("\r\n", "\n").replace('\n', "\r\n");
    if normalized.ends_with("\r\n") {
        normalized
    } else {
        format!("{normalized}\r\n")
    }
}

impl AppService {
    pub(super) fn append_terminal_system_message(
        &self,
        group_key: &str,
        repo_path: &str,
        task_id: &str,
        script_id: &str,
        message: impl AsRef<str>,
    ) {
        emit_terminal_chunk(
            &self.dev_server_groups,
            group_key,
            repo_path,
            task_id,
            script_id,
            format_terminal_system_message(message.as_ref()),
        );
    }
}

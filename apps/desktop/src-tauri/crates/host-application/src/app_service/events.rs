use super::RunEmitter;
use host_domain::{now_rfc3339, RunEvent};
use std::io::{BufRead, BufReader};

pub(crate) fn emit_event(emitter: &RunEmitter, event: RunEvent) {
    (emitter)(event);
}

pub(crate) fn spawn_output_forwarder(
    run_id: String,
    source: &'static str,
    stream: impl std::io::Read + Send + 'static,
    emitter: RunEmitter,
) {
    std::thread::spawn(move || {
        let reader = BufReader::new(stream);
        for line in reader.lines() {
            let Ok(line) = line else {
                continue;
            };
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }

            if trimmed.contains("permission") || trimmed.contains("git push") {
                emit_event(
                    &emitter,
                    RunEvent::PermissionRequired {
                        run_id: run_id.clone(),
                        message: format!("{}: {}", source, trimmed),
                        command: if trimmed.contains("git push") {
                            Some("git push".to_string())
                        } else {
                            None
                        },
                        timestamp: now_rfc3339(),
                    },
                );
            } else {
                emit_event(
                    &emitter,
                    RunEvent::ToolExecution {
                        run_id: run_id.clone(),
                        message: format!("{}: {}", source, trimmed),
                        timestamp: now_rfc3339(),
                    },
                );
            }
        }
    });
}

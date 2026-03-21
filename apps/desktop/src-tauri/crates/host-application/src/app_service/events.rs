use super::RunEmitter;
use host_domain::RunEvent;

pub(crate) fn emit_event(emitter: &RunEmitter, event: RunEvent) {
    (emitter)(event);
}

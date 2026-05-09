use host_application::AppService;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

fn install_shutdown_signal_handler(
    service: Arc<AppService>,
    shutdown_requested: Arc<AtomicBool>,
    shutdown_signal: Option<Arc<tokio::sync::Notify>>,
) {
    let shutdown_service = service.clone();
    let shutdown_requested_signal = shutdown_requested.clone();
    let shutdown_signal_for_handler = shutdown_signal.clone();
    if let Err(error) = ctrlc::set_handler(move || {
        if shutdown_requested_signal.swap(true, Ordering::SeqCst) {
            return;
        }
        if let Some(shutdown_signal) = &shutdown_signal_for_handler {
            shutdown_signal.notify_waiters();
        }
        let exit_code = match shutdown_service.shutdown() {
            Ok(()) => 0,
            Err(error) => {
                tracing::error!(
                    target: "openducktor.startup",
                    error = %error,
                    "Signal-triggered shutdown failed"
                );
                1
            }
        };
        std::process::exit(exit_code);
    }) {
        tracing::warn!(
            target: "openducktor.startup",
            error = %format!("{error:#}"),
            "Failed to install process signal handler; cleanup on SIGTERM/SIGINT may be incomplete"
        );
    }
}

pub(crate) fn startup_phase_shutdown_hooks_with_gate(
    service: Arc<AppService>,
    shutdown_requested: Arc<AtomicBool>,
    shutdown_signal: Option<Arc<tokio::sync::Notify>>,
) {
    install_shutdown_signal_handler(service, shutdown_requested, shutdown_signal);
}

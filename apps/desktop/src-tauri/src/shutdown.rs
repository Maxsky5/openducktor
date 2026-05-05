use crate::app_state::PullRequestSyncLoopState;
use crate::external_task_sync::TaskEventRelayState;
use crate::TauriRuntime;
use host_application::AppService;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Manager, RunEvent as TauriRunEvent};

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
            Ok(()) => shutdown_exit_code(true),
            Err(error) => {
                tracing::error!(
                    target: "openducktor.startup",
                    error = %error,
                    "Signal-triggered shutdown failed"
                );
                shutdown_exit_code(false)
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

pub(crate) fn startup_phase_shutdown_hooks(service: Arc<AppService>) {
    startup_phase_shutdown_hooks_with_gate(service, Arc::new(AtomicBool::new(false)), None);
}

pub(crate) fn startup_phase_shutdown_hooks_with_gate(
    service: Arc<AppService>,
    shutdown_requested: Arc<AtomicBool>,
    shutdown_signal: Option<Arc<tokio::sync::Notify>>,
) {
    install_shutdown_signal_handler(service, shutdown_requested, shutdown_signal);
}

pub(crate) fn startup_phase_exit_shutdown_handler(
    app_service: Arc<AppService>,
) -> impl FnMut(&AppHandle<TauriRuntime>, TauriRunEvent) {
    let shutdown_started = Arc::new(AtomicBool::new(false));

    move |handle, event| {
        if let TauriRunEvent::ExitRequested { api, code, .. } = event {
            let action =
                classify_exit_request(code.is_some(), shutdown_started.load(Ordering::SeqCst));
            if action == ExitRequestAction::AllowProgrammaticExit {
                return;
            }

            api.prevent_exit();

            if action == ExitRequestAction::IgnoreRepeatedUserExit
                || shutdown_started.swap(true, Ordering::SeqCst)
            {
                return;
            }

            handle
                .state::<TaskEventRelayState>()
                .stop_requested
                .store(true, Ordering::SeqCst);
            handle
                .state::<PullRequestSyncLoopState>()
                .stop_requested
                .store(true, Ordering::SeqCst);

            for window in handle.webview_windows().into_values() {
                let _ = window.hide();
            }

            let shutdown_service = app_service.clone();
            let exit_handle = handle.clone();
            std::thread::spawn(move || {
                let exit_code =
                    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
                        shutdown_service.shutdown()
                    })) {
                        Ok(Ok(())) => shutdown_exit_code(true),
                        Ok(Err(error)) => {
                            tracing::error!(
                                target: "openducktor.desktop-shutdown",
                                error = %error,
                                "Desktop shutdown failed"
                            );
                            shutdown_exit_code(false)
                        }
                        Err(_) => {
                            tracing::error!(
                                target: "openducktor.desktop-shutdown",
                                "Desktop shutdown panicked"
                            );
                            shutdown_exit_code(false)
                        }
                    };
                exit_handle.exit(exit_code);
            });
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ExitRequestAction {
    AllowProgrammaticExit,
    StartUserShutdown,
    IgnoreRepeatedUserExit,
}

fn classify_exit_request(code_present: bool, shutdown_already_started: bool) -> ExitRequestAction {
    if code_present {
        ExitRequestAction::AllowProgrammaticExit
    } else if shutdown_already_started {
        ExitRequestAction::IgnoreRepeatedUserExit
    } else {
        ExitRequestAction::StartUserShutdown
    }
}

fn shutdown_exit_code(success: bool) -> i32 {
    if success {
        0
    } else {
        1
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_exit_request_distinguishes_programmatic_and_user_paths() {
        assert_eq!(
            classify_exit_request(true, false),
            ExitRequestAction::AllowProgrammaticExit
        );
        assert_eq!(
            classify_exit_request(false, false),
            ExitRequestAction::StartUserShutdown
        );
        assert_eq!(
            classify_exit_request(false, true),
            ExitRequestAction::IgnoreRepeatedUserExit
        );
    }

    #[test]
    fn shutdown_exit_code_maps_success_and_failure() {
        assert_eq!(shutdown_exit_code(true), 0);
        assert_eq!(shutdown_exit_code(false), 1);
    }
}

use anyhow::anyhow;
use host_application::DevServerEmitter;
use host_domain::DevServerEvent;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

pub(crate) fn as_error<T>(result: anyhow::Result<T>) -> Result<T, String> {
    result.map_err(|error| format!("{error:#}"))
}

pub(crate) fn runtime_ensure_failure_kind(error: &anyhow::Error) -> Option<&'static str> {
    error.chain().find_map(|cause| {
        cause
            .downcast_ref::<host_application::RuntimeStartupWaitFailure>()
            .map(|failure| {
                if failure.reason().is_timeout() {
                    "timeout"
                } else {
                    "error"
                }
            })
    })
}

pub(crate) async fn run_service_blocking<T, F>(
    operation_name: &'static str,
    operation: F,
) -> anyhow::Result<T>
where
    T: Send + 'static,
    F: FnOnce() -> anyhow::Result<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| anyhow!("{operation_name} worker join failure: {error}"))?
}

pub(crate) async fn run_service_blocking_tokio<T, F>(
    operation_name: &'static str,
    operation: F,
) -> anyhow::Result<T>
where
    T: Send + 'static,
    F: FnOnce() -> anyhow::Result<T> + Send + 'static,
{
    tokio::task::spawn_blocking(operation)
        .await
        .map_err(|error| anyhow!("{operation_name} worker join failure: {error}"))?
}

pub(crate) fn dev_server_emitter<R: tauri::Runtime>(app: AppHandle<R>) -> DevServerEmitter {
    Arc::new(move |event: DevServerEvent| {
        let _ = app.emit("openducktor://dev-server-event", event);
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_service_blocking_propagates_operation_error() {
        let result = tauri::async_runtime::block_on(run_service_blocking(
            "test-op",
            || -> anyhow::Result<()> { Err(anyhow!("service failure")) },
        ));
        let error = result.expect_err("service error should propagate");
        assert!(error.to_string().contains("service failure"));
    }

    #[test]
    fn run_service_blocking_maps_join_failures() {
        let result = tauri::async_runtime::block_on(run_service_blocking(
            "test-join",
            || -> anyhow::Result<()> { panic!("simulated join panic") },
        ));
        let error = result.expect_err("panic in worker should map to join failure");
        assert!(error.to_string().contains("test-join worker join failure"));
    }

    #[tokio::test]
    async fn run_service_blocking_tokio_propagates_operation_error() {
        let result = run_service_blocking_tokio("tokio-test-op", || -> anyhow::Result<()> {
            Err(anyhow!("service failure"))
        })
        .await;
        let error = result.expect_err("service error should propagate");
        assert!(error.to_string().contains("service failure"));
    }

    #[tokio::test]
    async fn run_service_blocking_tokio_maps_join_failures() {
        let result = run_service_blocking_tokio("tokio-test-join", || -> anyhow::Result<()> {
            panic!("simulated join panic")
        })
        .await;
        let error = result.expect_err("panic in worker should map to join failure");
        assert!(error
            .to_string()
            .contains("tokio-test-join worker join failure"));
    }
}

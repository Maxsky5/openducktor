use anyhow::anyhow;

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

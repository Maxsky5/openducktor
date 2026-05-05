use host_application::AppService;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

pub(crate) struct AppState {
    pub(crate) service: Arc<AppService>,
}

pub(crate) struct PullRequestSyncLoopState {
    pub(crate) stop_requested: Arc<AtomicBool>,
}

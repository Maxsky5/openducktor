use std::sync::atomic::AtomicU64;
use std::sync::Arc;

pub(crate) type StartupCancelEpoch = Arc<AtomicU64>;

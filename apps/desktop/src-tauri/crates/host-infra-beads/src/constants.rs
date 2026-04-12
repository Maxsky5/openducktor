pub(crate) const DEFAULT_METADATA_NAMESPACE: &str = host_domain::TASK_METADATA_NAMESPACE;
pub(crate) const CUSTOM_STATUS_VALUES: &str = "spec_ready,ready_for_dev,ai_review,human_review";
pub(crate) const TASK_LIST_CACHE_TTL_MS: u64 = 2_000;

// Keep candidate cache entries alive longer than the 5-minute host sync cadence so
// recurring sync still scales with linked PR candidates, but expire them eventually
// so tasks changed by other Beads processes are rediscovered without a restart.
#[cfg(not(test))]
pub(crate) const PULL_REQUEST_SYNC_CANDIDATE_CACHE_TTL_MS: u64 = 10 * 60 * 1_000;
#[cfg(test)]
pub(crate) const PULL_REQUEST_SYNC_CANDIDATE_CACHE_TTL_MS: u64 = 50;

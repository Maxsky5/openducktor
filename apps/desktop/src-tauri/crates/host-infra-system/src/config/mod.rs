mod migrate;
mod normalize;
mod persistence;
mod security;
mod store;
mod types;

pub use normalize::normalize_hook_set;
pub use store::{AppConfigStore, RuntimeConfigStore};
pub use types::{
    hook_set_fingerprint, AgentDefaults, AgentModelDefault, GlobalConfig, HookSet,
    OpencodeStartupReadinessConfig, PromptOverride, PromptOverrides, RepoConfig, RuntimeConfig,
    SchedulerConfig, SoftGuardrails,
};

#[cfg(test)]
pub(super) use store::touch_recent;

#[cfg(test)]
mod tests;

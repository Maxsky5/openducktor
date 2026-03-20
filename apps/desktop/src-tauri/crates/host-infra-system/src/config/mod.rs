mod migrate;
mod normalize;
mod persistence;
mod security;
mod store;
mod types;

pub use normalize::{normalize_hook_set, normalize_repo_dev_servers};
pub use store::{AppConfigStore, RuntimeConfigStore};
pub use types::{
    hook_set_fingerprint, repo_script_fingerprint, AgentDefaults, AgentModelDefault, ChatSettings,
    GitMergeMethod, GitProviderConfig, GitProviderRepository, GitTargetBranch, GlobalConfig,
    GlobalGitConfig, HookSet, OpencodeStartupReadinessConfig, PromptOverride, PromptOverrides,
    RepoConfig, RepoDevServerScript, RepoGitConfig, RuntimeConfig, SchedulerConfig, SoftGuardrails,
};

#[cfg(test)]
pub(super) use store::touch_recent;

#[cfg(test)]
mod tests;

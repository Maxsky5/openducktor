mod migrate;
mod normalize;
mod persistence;
mod security;
mod store;
mod types;

pub use migrate::{
    derive_workspace_name_from_repo_path, propose_workspace_id, uniquify_workspace_id,
};
pub use normalize::{normalize_hook_set, normalize_repo_dev_servers};
pub use persistence::resolve_openducktor_base_dir;
pub use store::{AppConfigStore, RuntimeConfigStore};
pub use types::{
    hook_set_fingerprint, repo_script_fingerprint, AgentDefaults, AgentModelDefault,
    AutopilotActionId, AutopilotEventId, AutopilotRule, AutopilotSettings, ChatSettings,
    GitMergeMethod, GitProviderConfig, GitProviderRepository, GitTargetBranch, GlobalConfig,
    GlobalGitConfig, HookSet, KanbanSettings, OpencodeStartupReadinessConfig, PromptOverride,
    PromptOverrides, RepoConfig, RepoDevServerScript, RepoGitConfig, RuntimeConfig,
    SchedulerConfig, SoftGuardrails,
};

#[cfg(test)]
pub(super) use store::touch_recent;

#[cfg(test)]
mod tests;

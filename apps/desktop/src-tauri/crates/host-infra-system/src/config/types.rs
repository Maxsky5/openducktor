use host_domain::{
    default_runtime_kind as registry_default_runtime_kind, RuntimeRegistry,
    RuntimeStartupReadinessConfig, DEFAULT_BRANCH_PREFIX,
};
use serde::{Deserialize, Deserializer, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum GitMergeMethod {
    #[default]
    MergeCommit,
    Squash,
    Rebase,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GitProviderRepository {
    #[serde(default = "default_github_host")]
    pub host: String,
    pub owner: String,
    pub name: String,
}

fn default_github_host() -> String {
    "github.com".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitTargetBranch {
    #[serde(default)]
    pub remote: Option<String>,
    pub branch: String,
}

pub(super) fn default_target_branch() -> GitTargetBranch {
    GitTargetBranch {
        remote: Some("origin".to_string()),
        branch: "main".to_string(),
    }
}

fn deserialize_git_target_branch<'de, D>(deserializer: D) -> Result<GitTargetBranch, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Option::<GitTargetBranch>::deserialize(deserializer)?;
    let parsed = value.unwrap_or_default();
    Ok(normalize_git_target_branch_value(parsed))
}

pub(crate) fn normalize_git_target_branch_value(mut value: GitTargetBranch) -> GitTargetBranch {
    let branch = value.branch.trim();
    if branch.is_empty() {
        return default_target_branch();
    }
    value.branch = branch.to_string();
    if value.branch == "@{upstream}" {
        value.remote = None;
        return value;
    }

    let mut remote = value.remote.take().and_then(|entry| {
        let trimmed = entry.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    });

    if let Some(branch_name) = value.branch.strip_prefix("refs/heads/") {
        value.branch = branch_name.to_string();
    } else if let Some(remote_ref) = value.branch.strip_prefix("refs/remotes/") {
        let mut segments = remote_ref.splitn(2, '/');
        let parsed_remote = segments.next();
        let parsed_branch = segments.next();
        if let (Some(parsed_remote), Some(parsed_branch)) = (parsed_remote, parsed_branch) {
            if remote.is_none() {
                remote = Some(parsed_remote.to_string());
            }
            value.branch = parsed_branch.to_string();
        }
    }

    if let Some(remote_name) = remote.as_deref() {
        let prefix = format!("{remote_name}/");
        if let Some(branch_name) = value.branch.strip_prefix(prefix.as_str()) {
            if !branch_name.is_empty() {
                value.branch = branch_name.to_string();
            }
        }
    }

    value.remote = remote;
    value
}

impl Default for GitTargetBranch {
    fn default() -> Self {
        default_target_branch()
    }
}

impl GitTargetBranch {
    pub fn canonical(&self) -> String {
        if self.branch == "@{upstream}" {
            return self.branch.clone();
        }
        match self.remote.as_deref() {
            Some(remote) => format!("{remote}/{}", self.branch),
            None => self.branch.clone(),
        }
    }

    pub fn display(&self) -> String {
        self.canonical()
    }

    pub fn checkout_branch(&self) -> String {
        self.branch.clone()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GitProviderConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub repository: Option<GitProviderRepository>,
    #[serde(default)]
    pub auto_detected: bool,
}

pub type GitProviderConfigs = HashMap<String, GitProviderConfig>;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RepoGitConfig {
    #[serde(default)]
    pub providers: GitProviderConfigs,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GlobalGitConfig {
    #[serde(default)]
    pub default_merge_method: GitMergeMethod,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChatSettings {
    #[serde(default)]
    pub show_thinking_messages: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct KanbanSettings {
    #[serde(default = "default_done_visible_days")]
    pub done_visible_days: i32,
}

const fn default_done_visible_days() -> i32 {
    1
}

impl Default for KanbanSettings {
    fn default() -> Self {
        Self {
            done_visible_days: default_done_visible_days(),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum AutopilotEventId {
    TaskProgressedToSpecReady,
    TaskProgressedToReadyForDev,
    TaskProgressedToAiReview,
    TaskRejectedByQa,
    TaskProgressedToHumanReview,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum AutopilotActionId {
    StartPlanner,
    StartBuilder,
    StartQa,
    StartReviewQaFeedbacks,
    StartGeneratePullRequest,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AutopilotRule {
    pub event_id: AutopilotEventId,
    #[serde(default)]
    pub action_ids: Vec<AutopilotActionId>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AutopilotSettings {
    #[serde(default)]
    pub rules: Vec<AutopilotRule>,
}

pub const AUTOPILOT_EVENT_ORDER: [AutopilotEventId; 5] = [
    AutopilotEventId::TaskProgressedToSpecReady,
    AutopilotEventId::TaskProgressedToReadyForDev,
    AutopilotEventId::TaskProgressedToAiReview,
    AutopilotEventId::TaskRejectedByQa,
    AutopilotEventId::TaskProgressedToHumanReview,
];

impl Default for AutopilotSettings {
    fn default() -> Self {
        Self {
            rules: AUTOPILOT_EVENT_ORDER
                .into_iter()
                .map(|event_id| AutopilotRule {
                    event_id,
                    action_ids: Vec::new(),
                })
                .collect(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct HookSet {
    #[serde(default)]
    pub pre_start: Vec<String>,
    #[serde(default)]
    pub post_complete: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct RepoDevServerScript {
    pub id: String,
    pub name: String,
    pub command: String,
}

pub fn hook_set_fingerprint(hooks: &HookSet) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"openducktor-hookset-fingerprint-v2");
    update_hasher_with_hook_group(&mut hasher, b"pre_start", &hooks.pre_start);
    update_hasher_with_hook_group(&mut hasher, b"post_complete", &hooks.post_complete);
    format!("{:x}", hasher.finalize())
}

pub fn repo_script_fingerprint(hooks: &HookSet, dev_servers: &[RepoDevServerScript]) -> String {
    if dev_servers.is_empty() {
        return hook_set_fingerprint(hooks);
    }

    let mut hasher = Sha256::new();
    hasher.update(b"openducktor-repo-script-fingerprint-v3");
    update_hasher_with_hook_group(&mut hasher, b"pre_start", &hooks.pre_start);
    update_hasher_with_hook_group(&mut hasher, b"post_complete", &hooks.post_complete);
    hasher.update(b"dev_servers");
    hasher.update([0u8]);
    hasher.update((dev_servers.len() as u64).to_be_bytes());
    for dev_server in dev_servers {
        let bytes = dev_server.command.as_bytes();
        hasher.update((bytes.len() as u64).to_be_bytes());
        hasher.update(bytes);
    }
    format!("{:x}", hasher.finalize())
}

fn update_hasher_with_hook_group(hasher: &mut Sha256, group: &[u8], commands: &[String]) {
    hasher.update(group);
    hasher.update([0u8]);
    hasher.update((commands.len() as u64).to_be_bytes());
    for command in commands {
        let bytes = command.as_bytes();
        hasher.update((bytes.len() as u64).to_be_bytes());
        hasher.update(bytes);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AgentModelDefault {
    pub runtime_kind: String,
    pub provider_id: String,
    pub model_id: String,
    #[serde(default)]
    pub variant: Option<String>,
    #[serde(default, rename = "profileId", alias = "opencodeAgent")]
    pub profile_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AgentDefaults {
    #[serde(default)]
    pub spec: Option<AgentModelDefault>,
    #[serde(default)]
    pub planner: Option<AgentModelDefault>,
    #[serde(default)]
    pub build: Option<AgentModelDefault>,
    #[serde(default)]
    pub qa: Option<AgentModelDefault>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PromptOverride {
    pub template: String,
    pub base_version: u32,
    #[serde(default = "default_prompt_override_enabled")]
    pub enabled: bool,
}

pub type PromptOverrides = HashMap<String, PromptOverride>;

const fn default_prompt_override_enabled() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoConfig {
    pub default_runtime_kind: String,
    pub worktree_base_path: Option<String>,
    #[serde(default = "default_branch_prefix")]
    pub branch_prefix: String,
    #[serde(
        default = "default_target_branch",
        deserialize_with = "deserialize_git_target_branch"
    )]
    pub default_target_branch: GitTargetBranch,
    #[serde(default)]
    pub git: RepoGitConfig,
    #[serde(default)]
    pub trusted_hooks: bool,
    #[serde(default)]
    pub trusted_hooks_fingerprint: Option<String>,
    #[serde(default)]
    pub hooks: HookSet,
    #[serde(default)]
    pub dev_servers: Vec<RepoDevServerScript>,
    #[serde(default)]
    pub worktree_file_copies: Vec<String>,
    #[serde(default)]
    pub prompt_overrides: PromptOverrides,
    #[serde(default)]
    pub agent_defaults: AgentDefaults,
}

pub(super) fn default_branch_prefix() -> String {
    DEFAULT_BRANCH_PREFIX.to_string()
}

pub(super) fn default_runtime_kind() -> String {
    registry_default_runtime_kind().to_string()
}

impl Default for RepoConfig {
    fn default() -> Self {
        Self {
            default_runtime_kind: default_runtime_kind(),
            worktree_base_path: None,
            branch_prefix: default_branch_prefix(),
            default_target_branch: default_target_branch(),
            git: RepoGitConfig::default(),
            trusted_hooks: false,
            trusted_hooks_fingerprint: None,
            hooks: HookSet::default(),
            dev_servers: Vec::new(),
            worktree_file_copies: Vec::new(),
            prompt_overrides: PromptOverrides::default(),
            agent_defaults: AgentDefaults::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SoftGuardrails {
    #[serde(default = "default_cpu")]
    pub cpu_high_watermark_percent: u8,
    #[serde(default = "default_mem")]
    pub min_free_memory_mb: u32,
    #[serde(default = "default_backoff")]
    pub backoff_seconds: u16,
}

const fn default_cpu() -> u8 {
    85
}
const fn default_mem() -> u32 {
    2048
}
const fn default_backoff() -> u16 {
    30
}

impl Default for SoftGuardrails {
    fn default() -> Self {
        Self {
            cpu_high_watermark_percent: default_cpu(),
            min_free_memory_mb: default_mem(),
            backoff_seconds: default_backoff(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SchedulerConfig {
    #[serde(default)]
    pub soft_guardrails: SoftGuardrails,
}

pub type OpencodeStartupReadinessConfig = RuntimeStartupReadinessConfig;

fn default_theme() -> String {
    "light".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalConfig {
    pub version: u8,
    pub active_repo: Option<String>,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default)]
    pub git: GlobalGitConfig,
    #[serde(default)]
    pub chat: ChatSettings,
    #[serde(default)]
    pub kanban: KanbanSettings,
    #[serde(default)]
    pub autopilot: AutopilotSettings,
    #[serde(default)]
    pub global_prompt_overrides: PromptOverrides,
    #[serde(default)]
    pub repos: HashMap<String, RepoConfig>,
    #[serde(default)]
    pub recent_repos: Vec<String>,
}

impl Default for GlobalConfig {
    fn default() -> Self {
        Self {
            version: 1,
            active_repo: None,
            theme: default_theme(),
            git: GlobalGitConfig::default(),
            chat: ChatSettings::default(),
            kanban: KanbanSettings::default(),
            autopilot: AutopilotSettings::default(),
            global_prompt_overrides: PromptOverrides::default(),
            repos: HashMap::new(),
            recent_repos: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeConfigSerde {
    pub version: u8,
    #[serde(default)]
    pub runtimes: BTreeMap<String, RuntimeStartupReadinessConfig>,
    #[serde(default)]
    pub opencode_startup: Option<RuntimeStartupReadinessConfig>,
    #[serde(default)]
    pub scheduler: SchedulerConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    from = "RuntimeConfigSerde",
    into = "RuntimeConfigSerde"
)]
pub struct RuntimeConfig {
    pub version: u8,
    pub runtimes: BTreeMap<String, RuntimeStartupReadinessConfig>,
    pub scheduler: SchedulerConfig,
}

impl From<RuntimeConfigSerde> for RuntimeConfig {
    fn from(value: RuntimeConfigSerde) -> Self {
        let mut runtimes = value.runtimes;
        if let Some(opencode_startup) = value.opencode_startup {
            runtimes
                .entry("opencode".to_string())
                .or_insert(opencode_startup);
        }
        Self {
            version: value.version,
            runtimes,
            scheduler: value.scheduler,
        }
    }
}

impl From<RuntimeConfig> for RuntimeConfigSerde {
    fn from(value: RuntimeConfig) -> Self {
        Self {
            version: value.version,
            runtimes: value.runtimes,
            opencode_startup: None,
            scheduler: value.scheduler,
        }
    }
}

impl Default for RuntimeConfig {
    fn default() -> Self {
        Self::from_runtime_registry(host_domain::builtin_runtime_registry())
    }
}

impl RuntimeConfig {
    pub fn from_runtime_registry(runtime_registry: &RuntimeRegistry) -> Self {
        let runtimes = runtime_registry
            .definitions()
            .into_iter()
            .map(|definition| {
                (
                    definition.kind().to_string(),
                    definition.default_startup_config().clone(),
                )
            })
            .collect();
        Self {
            version: 1,
            runtimes,
            scheduler: SchedulerConfig::default(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        hook_set_fingerprint, repo_script_fingerprint, HookSet, RepoConfig, RepoDevServerScript,
    };

    #[test]
    fn hook_set_fingerprint_changes_with_command_boundaries() {
        let grouped = HookSet {
            pre_start: vec!["echo a".to_string(), "echo b".to_string()],
            post_complete: Vec::new(),
        };
        let embedded_newline = HookSet {
            pre_start: vec!["echo a\necho b".to_string()],
            post_complete: Vec::new(),
        };

        assert_ne!(
            hook_set_fingerprint(&grouped),
            hook_set_fingerprint(&embedded_newline),
            "fingerprint must be sensitive to command boundaries"
        );
    }

    #[test]
    fn hook_set_fingerprint_changes_with_group_assignment() {
        let pre_start = HookSet {
            pre_start: vec!["echo test".to_string()],
            post_complete: Vec::new(),
        };
        let post_complete = HookSet {
            pre_start: Vec::new(),
            post_complete: vec!["echo test".to_string()],
        };

        assert_ne!(
            hook_set_fingerprint(&pre_start),
            hook_set_fingerprint(&post_complete),
            "fingerprint must include the target hook group"
        );
    }

    #[test]
    fn repo_config_default_target_branch_is_origin_main() {
        let config = RepoConfig::default();
        assert_eq!(config.default_target_branch.canonical(), "origin/main");
    }

    #[test]
    fn repo_script_fingerprint_ignores_dev_server_names_but_tracks_commands() {
        let hooks = HookSet::default();
        let renamed = vec![RepoDevServerScript {
            id: "frontend".to_string(),
            name: "Frontend".to_string(),
            command: "bun run dev".to_string(),
        }];
        let same_command_new_name = vec![RepoDevServerScript {
            id: "frontend".to_string(),
            name: "Web".to_string(),
            command: "bun run dev".to_string(),
        }];
        let changed_command = vec![RepoDevServerScript {
            id: "frontend".to_string(),
            name: "Frontend".to_string(),
            command: "bun run start".to_string(),
        }];

        assert_eq!(
            repo_script_fingerprint(&hooks, &renamed),
            repo_script_fingerprint(&hooks, &same_command_new_name)
        );
        assert_ne!(
            repo_script_fingerprint(&hooks, &renamed),
            repo_script_fingerprint(&hooks, &changed_command)
        );
    }

    #[test]
    fn repo_script_fingerprint_matches_legacy_hook_fingerprint_without_dev_servers() {
        let hooks = HookSet {
            pre_start: vec!["echo pre".to_string()],
            post_complete: vec!["echo post".to_string()],
        };

        assert_eq!(
            hook_set_fingerprint(&hooks),
            repo_script_fingerprint(&hooks, &[])
        );
    }
}

use super::migrate::{current_global_config_version, default_theme};
use host_domain::{
    default_runtime_kind as registry_default_runtime_kind, RuntimeRegistry,
    RuntimeStartupReadinessConfig, DEFAULT_BRANCH_PREFIX,
};
use serde::{Deserialize, Deserializer, Serialize};
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

// RepoConfig intentionally allows unknown legacy keys such as "trustedHooks" and
// "trustedHooksFingerprint" so old on-disk configs deserialize and drop them on save.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoConfig {
    #[serde(default)]
    pub workspace_id: String,
    #[serde(default)]
    pub workspace_name: String,
    #[serde(default)]
    pub repo_path: String,
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
            workspace_id: String::new(),
            workspace_name: String::new(),
            repo_path: String::new(),
            default_runtime_kind: default_runtime_kind(),
            worktree_base_path: None,
            branch_prefix: default_branch_prefix(),
            default_target_branch: default_target_branch(),
            git: RepoGitConfig::default(),
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedGlobalConfigV2 {
    pub version: u8,
    pub active_workspace: Option<String>,
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
    pub workspaces: HashMap<String, RepoConfig>,
    #[serde(default)]
    pub workspace_order: Vec<String>,
    #[serde(default)]
    pub recent_workspaces: Vec<String>,
}

pub(super) fn deserialize_global_config(data: &str) -> Result<GlobalConfig, String> {
    let payload: serde_json::Value =
        serde_json::from_str(data).map_err(|error| error.to_string())?;
    let version = payload
        .get("version")
        .and_then(|value| value.as_u64())
        .ok_or_else(|| "Missing config version.".to_string())?;

    if version != u64::from(current_global_config_version()) {
        return Err(format!(
            "Unsupported config version {version}. Expected {}.",
            current_global_config_version()
        ));
    }

    serde_json::from_value::<GlobalConfig>(payload).map_err(|error| error.to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(try_from = "PersistedGlobalConfigV2", into = "PersistedGlobalConfigV2")]
pub struct GlobalConfig {
    pub version: u8,
    pub active_workspace: Option<String>,
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
    pub workspaces: HashMap<String, RepoConfig>,
    #[serde(default)]
    pub workspace_order: Vec<String>,
    #[serde(default)]
    pub recent_workspaces: Vec<String>,
}

impl TryFrom<PersistedGlobalConfigV2> for GlobalConfig {
    type Error = String;

    fn try_from(config: PersistedGlobalConfigV2) -> Result<Self, Self::Error> {
        Ok(Self {
            version: config.version,
            active_workspace: config.active_workspace,
            theme: config.theme,
            git: config.git,
            chat: config.chat,
            kanban: config.kanban,
            autopilot: config.autopilot,
            global_prompt_overrides: config.global_prompt_overrides,
            workspaces: config.workspaces,
            workspace_order: config.workspace_order,
            recent_workspaces: config.recent_workspaces,
        })
    }
}

impl From<GlobalConfig> for PersistedGlobalConfigV2 {
    fn from(value: GlobalConfig) -> Self {
        Self {
            version: value.version,
            active_workspace: value.active_workspace,
            theme: value.theme,
            git: value.git,
            chat: value.chat,
            kanban: value.kanban,
            autopilot: value.autopilot,
            global_prompt_overrides: value.global_prompt_overrides,
            workspaces: value.workspaces,
            workspace_order: value.workspace_order,
            recent_workspaces: value.recent_workspaces,
        }
    }
}

impl Default for GlobalConfig {
    fn default() -> Self {
        Self {
            version: current_global_config_version(),
            active_workspace: None,
            theme: default_theme(),
            git: GlobalGitConfig::default(),
            chat: ChatSettings::default(),
            kanban: KanbanSettings::default(),
            autopilot: AutopilotSettings::default(),
            global_prompt_overrides: PromptOverrides::default(),
            workspaces: HashMap::new(),
            workspace_order: Vec::new(),
            recent_workspaces: Vec::new(),
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
    use super::RepoConfig;

    #[test]
    fn repo_config_default_target_branch_is_origin_main() {
        let config = RepoConfig::default();
        assert_eq!(config.default_target_branch.canonical(), "origin/main");
    }
}

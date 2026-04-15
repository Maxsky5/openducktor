use super::migrate::{
    canonicalize_repo_path, current_global_config_version, default_theme,
    derive_workspace_name_from_repo_path, migrate_legacy_repos_to_canonical_paths,
    propose_workspace_id, uniquify_workspace_id, LegacyGlobalConfigV1, LegacyRepoConfigV1,
};
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
            workspace_id: String::new(),
            workspace_name: String::new(),
            repo_path: String::new(),
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
    pub recent_workspaces: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
enum PersistedGlobalConfig {
    V2(PersistedGlobalConfigV2),
    V1(LegacyGlobalConfigV1),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(try_from = "PersistedGlobalConfig", into = "PersistedGlobalConfigV2")]
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
    pub recent_workspaces: Vec<String>,
}

impl TryFrom<PersistedGlobalConfig> for GlobalConfig {
    type Error = String;

    fn try_from(value: PersistedGlobalConfig) -> Result<Self, Self::Error> {
        match value {
            PersistedGlobalConfig::V2(config) => {
                if config.version != current_global_config_version() {
                    return Err(format!(
                        "Unsupported config version {}. Expected {}.",
                        config.version,
                        current_global_config_version()
                    ));
                }

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
                    recent_workspaces: config.recent_workspaces,
                })
            }
            PersistedGlobalConfig::V1(legacy) => migrate_legacy_global_config(legacy),
        }
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
            recent_workspaces: Vec::new(),
        }
    }
}

fn migrate_legacy_global_config(legacy: LegacyGlobalConfigV1) -> Result<GlobalConfig, String> {
    if legacy.version != 1 {
        return Err(format!(
            "Unsupported legacy config version {}. Expected 1.",
            legacy.version
        ));
    }

    let active_repo = legacy.active_repo.as_ref().and_then(|value| {
        canonicalize_repo_path(value)
            .ok()
            .or_else(|| Some(value.clone()))
    });

    let mut repos = legacy.repos;
    let canonical_repos =
        migrate_legacy_repos_to_canonical_paths(&mut repos, legacy.active_repo.as_ref());
    let mut workspaces = HashMap::new();
    let mut repo_path_to_workspace_id = HashMap::new();

    let mut entries: Vec<(String, LegacyRepoConfigV1)> = canonical_repos.into_iter().collect();
    entries.sort_by(|a, b| a.0.cmp(&b.0));

    for (repo_path, legacy_repo) in entries {
        let workspace_name = derive_workspace_name_from_repo_path(&repo_path);
        let workspace_id =
            uniquify_workspace_id(&propose_workspace_id(&workspace_name), &workspaces);
        let mut repo = RepoConfig::from(legacy_repo);
        repo.workspace_id = workspace_id.clone();
        repo.workspace_name = workspace_name;
        repo.repo_path = repo_path.clone();
        repo_path_to_workspace_id.insert(repo_path, workspace_id.clone());
        workspaces.insert(workspace_id, repo);
    }

    let active_workspace = active_repo
        .as_ref()
        .and_then(|repo_path| repo_path_to_workspace_id.get(repo_path))
        .cloned();
    let mut recent_workspaces = Vec::new();
    for recent_repo in legacy.recent_repos {
        let canonical_recent = canonicalize_repo_path(&recent_repo).unwrap_or(recent_repo);
        let Some(workspace_id) = repo_path_to_workspace_id.get(&canonical_recent) else {
            continue;
        };
        if !recent_workspaces.contains(workspace_id) {
            recent_workspaces.push(workspace_id.clone());
        }
    }

    Ok(GlobalConfig {
        version: current_global_config_version(),
        active_workspace,
        theme: legacy.theme,
        git: legacy.git,
        chat: legacy.chat,
        kanban: legacy.kanban,
        autopilot: legacy.autopilot,
        global_prompt_overrides: legacy.global_prompt_overrides,
        workspaces,
        recent_workspaces,
    })
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

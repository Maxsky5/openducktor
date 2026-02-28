use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HookSet {
    #[serde(default)]
    pub pre_start: Vec<String>,
    #[serde(default)]
    pub post_complete: Vec<String>,
}

impl Default for HookSet {
    fn default() -> Self {
        Self {
            pre_start: Vec::new(),
            post_complete: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AgentModelDefault {
    pub provider_id: String,
    pub model_id: String,
    #[serde(default)]
    pub variant: Option<String>,
    #[serde(default)]
    pub opencode_agent: Option<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoConfig {
    pub worktree_base_path: Option<String>,
    #[serde(default = "default_branch_prefix")]
    pub branch_prefix: String,
    #[serde(default)]
    pub trusted_hooks: bool,
    #[serde(default)]
    pub hooks: HookSet,
    #[serde(default)]
    pub agent_defaults: AgentDefaults,
}

pub(super) fn default_branch_prefix() -> String {
    "obp".to_string()
}

pub(super) fn default_task_metadata_namespace() -> String {
    "openducktor".to_string()
}

impl Default for RepoConfig {
    fn default() -> Self {
        Self {
            worktree_base_path: None,
            branch_prefix: default_branch_prefix(),
            trusted_hooks: false,
            hooks: HookSet::default(),
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpencodeStartupReadinessConfig {
    #[serde(default = "default_opencode_startup_timeout_ms")]
    pub timeout_ms: u64,
    #[serde(default = "default_opencode_startup_connect_timeout_ms")]
    pub connect_timeout_ms: u64,
    #[serde(default = "default_opencode_startup_initial_retry_delay_ms")]
    pub initial_retry_delay_ms: u64,
    #[serde(default = "default_opencode_startup_max_retry_delay_ms")]
    pub max_retry_delay_ms: u64,
    #[serde(default = "default_opencode_startup_child_check_interval_ms")]
    pub child_check_interval_ms: u64,
}

const fn default_opencode_startup_timeout_ms() -> u64 {
    8_000
}
const fn default_opencode_startup_connect_timeout_ms() -> u64 {
    250
}
const fn default_opencode_startup_initial_retry_delay_ms() -> u64 {
    25
}
const fn default_opencode_startup_max_retry_delay_ms() -> u64 {
    250
}
const fn default_opencode_startup_child_check_interval_ms() -> u64 {
    75
}

impl Default for OpencodeStartupReadinessConfig {
    fn default() -> Self {
        Self {
            timeout_ms: default_opencode_startup_timeout_ms(),
            connect_timeout_ms: default_opencode_startup_connect_timeout_ms(),
            initial_retry_delay_ms: default_opencode_startup_initial_retry_delay_ms(),
            max_retry_delay_ms: default_opencode_startup_max_retry_delay_ms(),
            child_check_interval_ms: default_opencode_startup_child_check_interval_ms(),
        }
    }
}

fn default_theme() -> String {
    "light".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalConfig {
    pub version: u8,
    pub active_repo: Option<String>,
    #[serde(default = "default_task_metadata_namespace")]
    pub task_metadata_namespace: String,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default)]
    pub opencode_startup: OpencodeStartupReadinessConfig,
    #[serde(default)]
    pub repos: HashMap<String, RepoConfig>,
    #[serde(default)]
    pub recent_repos: Vec<String>,
    #[serde(default)]
    pub scheduler: SchedulerConfig,
}

impl Default for GlobalConfig {
    fn default() -> Self {
        Self {
            version: 1,
            active_repo: None,
            task_metadata_namespace: default_task_metadata_namespace(),
            theme: default_theme(),
            opencode_startup: OpencodeStartupReadinessConfig::default(),
            repos: HashMap::new(),
            recent_repos: Vec::new(),
            scheduler: SchedulerConfig::default(),
        }
    }
}

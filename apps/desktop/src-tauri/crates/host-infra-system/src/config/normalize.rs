use super::types::{
    default_branch_prefix, default_target_branch, hook_set_fingerprint, AgentModelDefault,
    GlobalConfig, OpencodeStartupReadinessConfig, PromptOverrides, RepoConfig, RuntimeConfig,
};

fn normalize_optional_non_empty(value: Option<String>) -> Option<String> {
    value.and_then(|entry| {
        let trimmed = entry.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn normalize_hook_commands(commands: &mut Vec<String>) {
    *commands = std::mem::take(commands)
        .into_iter()
        .filter_map(|command| {
            let trimmed = command.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        })
        .collect();
}

fn normalize_agent_model_default(value: &mut Option<AgentModelDefault>) {
    let Some(entry) = value.as_mut() else {
        return;
    };

    entry.provider_id = entry.provider_id.trim().to_string();
    entry.model_id = entry.model_id.trim().to_string();
    entry.variant = normalize_optional_non_empty(entry.variant.take());
    entry.profile_id = normalize_optional_non_empty(entry.profile_id.take());

    if entry.provider_id.is_empty() || entry.model_id.is_empty() {
        *value = None;
    }
}

fn normalize_prompt_overrides(overrides: &mut PromptOverrides) {
    *overrides = std::mem::take(overrides)
        .into_iter()
        .filter_map(|(key, mut entry)| {
            let normalized_key = key.trim();
            if normalized_key.is_empty() {
                return None;
            }

            entry.template = entry.template.trim().to_string();
            if entry.base_version == 0 {
                entry.base_version = 1;
            }

            Some((normalized_key.to_string(), entry))
        })
        .collect();
}

fn canonicalize_default_target_branch(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return default_target_branch();
    }
    if trimmed.contains('/') {
        return trimmed.to_string();
    }
    format!("origin/{trimmed}")
}

pub(super) fn normalize_repo_config(repo: &mut RepoConfig) {
    repo.worktree_base_path = normalize_optional_non_empty(repo.worktree_base_path.take());
    let branch_prefix = repo.branch_prefix.trim();
    repo.branch_prefix = if branch_prefix.is_empty() {
        default_branch_prefix()
    } else {
        branch_prefix.to_string()
    };
    repo.default_target_branch = canonicalize_default_target_branch(&repo.default_target_branch);
    normalize_hook_commands(&mut repo.hooks.pre_start);
    normalize_hook_commands(&mut repo.hooks.post_complete);
    normalize_hook_commands(&mut repo.worktree_file_copies);
    let current_fingerprint = hook_set_fingerprint(&repo.hooks);
    if repo.trusted_hooks {
        if repo.trusted_hooks_fingerprint.as_deref() != Some(current_fingerprint.as_str()) {
            repo.trusted_hooks = false;
            repo.trusted_hooks_fingerprint = None;
        } else {
            repo.trusted_hooks_fingerprint = Some(current_fingerprint);
        }
    } else {
        repo.trusted_hooks_fingerprint = None;
    }
    normalize_prompt_overrides(&mut repo.prompt_overrides);
    normalize_agent_model_default(&mut repo.agent_defaults.spec);
    normalize_agent_model_default(&mut repo.agent_defaults.planner);
    normalize_agent_model_default(&mut repo.agent_defaults.build);
    normalize_agent_model_default(&mut repo.agent_defaults.qa);
}

pub(super) fn normalize_opencode_startup_readiness_config(
    config: &mut OpencodeStartupReadinessConfig,
) {
    config.timeout_ms = config.timeout_ms.clamp(250, 120_000);
    config.connect_timeout_ms = config.connect_timeout_ms.clamp(25, 10_000);
    config.initial_retry_delay_ms = config.initial_retry_delay_ms.clamp(5, 5_000);
    config.max_retry_delay_ms = config.max_retry_delay_ms.clamp(10, 10_000);
    config.child_check_interval_ms = config.child_check_interval_ms.clamp(10, 2_000);
    if config.max_retry_delay_ms < config.initial_retry_delay_ms {
        config.max_retry_delay_ms = config.initial_retry_delay_ms;
    }
}

pub(super) fn normalize_global_config(config: &mut GlobalConfig) {
    normalize_prompt_overrides(&mut config.global_prompt_overrides);
    for repo in config.repos.values_mut() {
        normalize_repo_config(repo);
    }
}

pub(super) fn normalize_runtime_config(config: &mut RuntimeConfig) {
    normalize_opencode_startup_readiness_config(&mut config.opencode_startup);
}

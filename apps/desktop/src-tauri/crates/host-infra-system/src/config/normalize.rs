use super::types::{
    default_branch_prefix, normalize_git_target_branch_value, AgentModelDefault, AutopilotActionId,
    AutopilotRule, AutopilotSettings, GitProviderConfig, GitProviderRepository, GitTargetBranch,
    GlobalConfig, HookSet, KanbanSettings, PromptOverrides, RepoConfig, RepoDevServerScript,
    RuntimeConfig, AUTOPILOT_EVENT_ORDER,
};
use anyhow::{anyhow, Result};
use host_domain::RuntimeRegistry;
use std::collections::HashSet;

fn normalize_required_string(value: &mut String, field_name: &str) -> Result<()> {
    *value = value.trim().to_string();
    if value.is_empty() {
        return Err(anyhow!("{field_name} cannot be blank."));
    }
    Ok(())
}

fn is_valid_workspace_id(value: &str) -> bool {
    let mut segments = value.split('-');
    let Some(first_segment) = segments.next() else {
        return false;
    };
    if first_segment.is_empty()
        || !first_segment
            .chars()
            .all(|character| character.is_ascii_lowercase() || character.is_ascii_digit())
    {
        return false;
    }

    segments.all(|segment| {
        !segment.is_empty()
            && segment
                .chars()
                .all(|character| character.is_ascii_lowercase() || character.is_ascii_digit())
    })
}

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

pub fn normalize_repo_dev_servers(dev_servers: &mut Vec<RepoDevServerScript>) -> Result<()> {
    let mut seen_ids = HashSet::new();
    let mut normalized = Vec::with_capacity(dev_servers.len());
    for mut dev_server in std::mem::take(dev_servers) {
        dev_server.id = dev_server.id.trim().to_string();
        dev_server.name = dev_server.name.trim().to_string();
        dev_server.command = dev_server.command.trim().to_string();

        if dev_server.command.is_empty() {
            continue;
        }

        if dev_server.id.is_empty() {
            return Err(anyhow!(
                "Dev server id cannot be blank when a command is configured."
            ));
        }
        if dev_server.name.is_empty() {
            return Err(anyhow!(
                "Dev server name cannot be blank when a command is configured."
            ));
        }
        if !seen_ids.insert(dev_server.id.clone()) {
            return Err(anyhow!("Duplicate dev server id: {}", dev_server.id));
        }

        normalized.push(dev_server);
    }

    *dev_servers = normalized;
    Ok(())
}

fn normalize_agent_model_default(
    value: &mut Option<AgentModelDefault>,
    field_name: &str,
) -> Result<()> {
    let Some(entry) = value.as_mut() else {
        return Ok(());
    };

    entry.runtime_kind = entry.runtime_kind.trim().to_string();
    entry.provider_id = entry.provider_id.trim().to_string();
    entry.model_id = entry.model_id.trim().to_string();
    entry.variant = normalize_optional_non_empty(entry.variant.take());
    entry.profile_id = normalize_optional_non_empty(entry.profile_id.take());

    if entry.provider_id.is_empty() || entry.model_id.is_empty() {
        *value = None;
        return Ok(());
    }

    if entry.runtime_kind.is_empty() {
        return Err(anyhow!(
            "{field_name} runtime kind is required when provider and model are configured."
        ));
    }

    Ok(())
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

fn normalize_git_provider_repository(value: &mut Option<GitProviderRepository>) {
    let Some(entry) = value.as_mut() else {
        return;
    };

    let host = entry.host.trim();
    entry.host = if host.is_empty() {
        "github.com".to_string()
    } else {
        host.to_string()
    };
    entry.owner = entry.owner.trim().to_string();
    entry.name = entry.name.trim().to_string();

    if entry.owner.is_empty() || entry.name.is_empty() {
        *value = None;
    }
}

fn normalize_git_provider_configs(
    overrides: &mut std::collections::HashMap<String, GitProviderConfig>,
) {
    *overrides = std::mem::take(overrides)
        .into_iter()
        .filter_map(|(key, mut entry)| {
            let normalized_key = key.trim().to_string();
            if normalized_key.is_empty() {
                return None;
            }
            normalize_git_provider_repository(&mut entry.repository);
            Some((normalized_key, entry))
        })
        .collect();
}

fn canonicalize_default_target_branch(value: GitTargetBranch) -> GitTargetBranch {
    normalize_git_target_branch_value(value)
}

pub fn normalize_hook_set(mut hooks: HookSet) -> HookSet {
    normalize_hook_commands(&mut hooks.pre_start);
    normalize_hook_commands(&mut hooks.post_complete);
    hooks
}

pub(super) fn normalize_repo_config(repo: &mut RepoConfig) -> Result<()> {
    normalize_required_string(&mut repo.workspace_id, "Workspace ID")?;
    if !is_valid_workspace_id(&repo.workspace_id) {
        return Err(anyhow!(
            "Workspace ID must contain only lowercase letters, digits, and single dashes."
        ));
    }
    normalize_required_string(&mut repo.workspace_name, "Workspace name")?;
    normalize_required_string(&mut repo.repo_path, "Repository path")?;
    repo.default_runtime_kind = repo.default_runtime_kind.trim().to_string();
    if repo.default_runtime_kind.is_empty() {
        return Err(anyhow!("Default runtime kind cannot be blank."));
    }
    repo.worktree_base_path = normalize_optional_non_empty(repo.worktree_base_path.take());
    let branch_prefix = repo.branch_prefix.trim();
    repo.branch_prefix = if branch_prefix.is_empty() {
        default_branch_prefix()
    } else {
        branch_prefix.to_string()
    };
    repo.default_target_branch =
        canonicalize_default_target_branch(std::mem::take(&mut repo.default_target_branch));
    normalize_git_provider_configs(&mut repo.git.providers);
    repo.hooks = normalize_hook_set(std::mem::take(&mut repo.hooks));
    normalize_repo_dev_servers(&mut repo.dev_servers)?;
    normalize_hook_commands(&mut repo.worktree_file_copies);
    normalize_prompt_overrides(&mut repo.prompt_overrides);
    normalize_agent_model_default(&mut repo.agent_defaults.spec, "Specification agent default")?;
    normalize_agent_model_default(&mut repo.agent_defaults.planner, "Planner agent default")?;
    normalize_agent_model_default(&mut repo.agent_defaults.build, "Builder agent default")?;
    normalize_agent_model_default(&mut repo.agent_defaults.qa, "QA agent default")?;
    Ok(())
}

fn normalize_kanban_settings(config: &mut KanbanSettings) {
    config.done_visible_days = config.done_visible_days.max(0);
}

fn normalize_autopilot_settings(config: &mut AutopilotSettings) {
    let mut rules_by_event = std::collections::HashMap::new();
    for mut rule in std::mem::take(&mut config.rules) {
        let mut seen_actions = HashSet::new();
        rule.action_ids
            .retain(|action_id| seen_actions.insert(*action_id));
        rules_by_event.insert(rule.event_id, rule);
    }

    config.rules = AUTOPILOT_EVENT_ORDER
        .into_iter()
        .map(|event_id| {
            rules_by_event.remove(&event_id).unwrap_or(AutopilotRule {
                event_id,
                action_ids: Vec::<AutopilotActionId>::new(),
            })
        })
        .collect();
}

fn normalize_workspace_order(config: &mut GlobalConfig) {
    let mut normalized_order = Vec::new();
    let mut seen_workspace_ids = HashSet::new();

    for workspace_id in std::mem::take(&mut config.workspace_order) {
        let trimmed = workspace_id.trim();
        if trimmed.is_empty()
            || !config.workspaces.contains_key(trimmed)
            || !seen_workspace_ids.insert(trimmed.to_string())
        {
            continue;
        }
        normalized_order.push(trimmed.to_string());
    }

    let mut remaining_workspaces = config.workspaces.iter().collect::<Vec<_>>();
    remaining_workspaces.sort_by(|(left_id, left_repo), (right_id, right_repo)| {
        left_repo
            .workspace_name
            .cmp(&right_repo.workspace_name)
            .then_with(|| left_id.cmp(right_id))
    });

    for (workspace_id, _) in remaining_workspaces {
        if seen_workspace_ids.insert(workspace_id.clone()) {
            normalized_order.push(workspace_id.clone());
        }
    }

    config.workspace_order = normalized_order;
}

pub(super) fn normalize_global_config(config: &mut GlobalConfig) -> Result<()> {
    normalize_kanban_settings(&mut config.kanban);
    normalize_autopilot_settings(&mut config.autopilot);
    normalize_prompt_overrides(&mut config.global_prompt_overrides);
    config.active_workspace = normalize_optional_non_empty(config.active_workspace.take());
    let mut normalized_recent = Vec::new();
    for workspace_id in std::mem::take(&mut config.recent_workspaces) {
        let trimmed = workspace_id.trim();
        if trimmed.is_empty()
            || normalized_recent
                .iter()
                .any(|entry: &String| entry == trimmed)
        {
            continue;
        }
        normalized_recent.push(trimmed.to_string());
    }
    config.recent_workspaces = normalized_recent;
    for (workspace_id, repo) in &mut config.workspaces {
        repo.workspace_id = workspace_id.clone();
        normalize_repo_config(repo)?;
    }
    if let Some(active_workspace) = config.active_workspace.as_ref() {
        if !config.workspaces.contains_key(active_workspace) {
            config.active_workspace = None;
        }
    }
    config
        .recent_workspaces
        .retain(|workspace_id| config.workspaces.contains_key(workspace_id));
    normalize_workspace_order(config);
    Ok(())
}

pub(super) fn normalize_runtime_config(
    config: &mut RuntimeConfig,
    runtime_registry: &RuntimeRegistry,
) -> Result<()> {
    let configured_runtime_kinds = config.runtimes.keys().cloned().collect::<Vec<_>>();
    for runtime_kind in configured_runtime_kinds {
        runtime_registry.definition_by_str(runtime_kind.as_str())?;
    }

    let mut normalized_runtimes = std::collections::BTreeMap::new();
    for definition in runtime_registry.definitions() {
        let runtime_kind = definition.kind().to_string();
        let mut startup_config = config
            .runtimes
            .remove(runtime_kind.as_str())
            .unwrap_or_else(|| definition.default_startup_config().clone());
        startup_config.normalize();
        normalized_runtimes.insert(runtime_kind, startup_config);
    }

    config.runtimes = normalized_runtimes;
    Ok(())
}

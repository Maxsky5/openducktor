use super::AppService;
use anyhow::{anyhow, Result};
use host_domain::WorkspaceRecord;
use host_infra_system::{
    normalize_hook_set, normalize_repo_dev_servers, AgentDefaults, AutopilotSettings, ChatSettings,
    GitTargetBranch, HookSet, KanbanSettings, PromptOverrides, RepoConfig, RepoDevServerScript,
    RepoGitConfig,
};
use std::collections::HashMap;

#[derive(Debug, Clone, Default)]
pub struct RepoConfigUpdate {
    pub default_runtime_kind: Option<String>,
    pub worktree_base_path: Option<String>,
    pub branch_prefix: Option<String>,
    pub default_target_branch: Option<GitTargetBranch>,
    pub git: Option<RepoGitConfig>,
    pub dev_servers: Option<Vec<RepoDevServerScript>>,
    pub worktree_copy_paths: Option<Vec<String>>,
    pub prompt_overrides: Option<PromptOverrides>,
    pub agent_defaults: Option<AgentDefaults>,
}

#[derive(Debug, Clone)]
pub struct RepoSettingsUpdate {
    pub default_runtime_kind: Option<String>,
    pub worktree_base_path: Option<String>,
    pub branch_prefix: Option<String>,
    pub default_target_branch: Option<GitTargetBranch>,
    pub git: Option<RepoGitConfig>,
    pub hooks: Option<HookSet>,
    pub dev_servers: Option<Vec<RepoDevServerScript>>,
    pub worktree_copy_paths: Option<Vec<String>>,
    pub prompt_overrides: Option<PromptOverrides>,
    pub agent_defaults: Option<AgentDefaults>,
}

#[derive(Debug, Clone)]
pub struct WorkspaceSettingsSnapshotUpdate {
    pub theme: String,
    pub git: host_infra_system::GlobalGitConfig,
    pub chat: ChatSettings,
    pub kanban: KanbanSettings,
    pub autopilot: AutopilotSettings,
    pub workspaces: HashMap<String, RepoConfig>,
    pub global_prompt_overrides: PromptOverrides,
}

impl AppService {
    pub fn workspace_merge_repo_config(
        &self,
        workspace_id: &str,
        update: RepoConfigUpdate,
    ) -> Result<WorkspaceRecord> {
        let existing = self.workspace_get_repo_config_optional(workspace_id)?;
        let defaults = RepoConfig::default();
        let dev_servers = normalize_dev_servers(
            update
                .dev_servers
                .or_else(|| existing.as_ref().map(|entry| entry.dev_servers.clone()))
                .unwrap_or_default(),
        )?;
        let workspace_name = existing
            .as_ref()
            .map(|entry| entry.workspace_name.clone())
            .unwrap_or_else(|| workspace_id.to_string());
        let repo_path = existing
            .as_ref()
            .map(|entry| entry.repo_path.clone())
            .unwrap_or_default();
        let repo_config = RepoConfig {
            workspace_id: workspace_id.to_string(),
            workspace_name,
            repo_path,
            default_runtime_kind: update
                .default_runtime_kind
                .or_else(|| {
                    existing
                        .as_ref()
                        .map(|entry| entry.default_runtime_kind.clone())
                })
                .unwrap_or(defaults.default_runtime_kind),
            worktree_base_path: update.worktree_base_path.or_else(|| {
                existing
                    .as_ref()
                    .and_then(|entry| entry.worktree_base_path.clone())
            }),
            branch_prefix: update
                .branch_prefix
                .or_else(|| existing.as_ref().map(|entry| entry.branch_prefix.clone()))
                .unwrap_or(defaults.branch_prefix),
            default_target_branch: update
                .default_target_branch
                .or_else(|| {
                    existing
                        .as_ref()
                        .map(|entry| entry.default_target_branch.clone())
                })
                .unwrap_or(defaults.default_target_branch),
            git: update
                .git
                .or_else(|| existing.as_ref().map(|entry| entry.git.clone()))
                .unwrap_or_default(),
            hooks: existing
                .as_ref()
                .map(|entry| entry.hooks.clone())
                .unwrap_or_default(),
            dev_servers,
            worktree_copy_paths: update
                .worktree_copy_paths
                .or_else(|| {
                    existing
                        .as_ref()
                        .map(|entry| entry.worktree_copy_paths.clone())
                })
                .unwrap_or_default(),
            prompt_overrides: update
                .prompt_overrides
                .or_else(|| {
                    existing
                        .as_ref()
                        .map(|entry| entry.prompt_overrides.clone())
                })
                .unwrap_or_default(),
            agent_defaults: update
                .agent_defaults
                .or_else(|| existing.as_ref().map(|entry| entry.agent_defaults.clone()))
                .unwrap_or_default(),
        };

        self.workspace_update_repo_config(workspace_id, repo_config)
    }

    pub fn workspace_save_repo_settings(
        &self,
        workspace_id: &str,
        settings: RepoSettingsUpdate,
    ) -> Result<WorkspaceRecord> {
        let existing = self
            .workspace_get_repo_config_optional(workspace_id)?
            .unwrap_or_default();

        let normalized_hooks =
            normalize_hook_set(settings.hooks.unwrap_or_else(|| existing.hooks.clone()));
        let normalized_dev_servers = normalize_dev_servers(
            settings
                .dev_servers
                .unwrap_or_else(|| existing.dev_servers.clone()),
        )?;

        let final_repo_config = RepoConfig {
            workspace_id: existing.workspace_id.clone(),
            workspace_name: existing.workspace_name.clone(),
            repo_path: existing.repo_path.clone(),
            default_runtime_kind: normalize_runtime_kind(settings.default_runtime_kind)?
                .unwrap_or(existing.default_runtime_kind),
            worktree_base_path: settings.worktree_base_path.or(existing.worktree_base_path),
            branch_prefix: settings.branch_prefix.unwrap_or(existing.branch_prefix),
            default_target_branch: settings
                .default_target_branch
                .unwrap_or(existing.default_target_branch),
            git: settings.git.unwrap_or(existing.git),
            hooks: normalized_hooks,
            dev_servers: normalized_dev_servers,
            worktree_copy_paths: settings
                .worktree_copy_paths
                .unwrap_or(existing.worktree_copy_paths),
            prompt_overrides: settings
                .prompt_overrides
                .unwrap_or(existing.prompt_overrides),
            agent_defaults: settings.agent_defaults.unwrap_or(existing.agent_defaults),
        };

        self.workspace_update_repo_config(workspace_id, final_repo_config)
    }

    pub fn workspace_save_settings_snapshot(
        &self,
        mut update: WorkspaceSettingsSnapshotUpdate,
    ) -> Result<Vec<WorkspaceRecord>> {
        for repo_config in update.workspaces.values_mut() {
            repo_config.hooks = normalize_hook_set(std::mem::take(&mut repo_config.hooks));
            repo_config.dev_servers =
                normalize_dev_servers(std::mem::take(&mut repo_config.dev_servers))?;
        }

        self.workspace_persist_settings_snapshot(update)?;
        self.workspace_list()
    }
}

fn normalize_dev_servers(
    dev_servers: Vec<RepoDevServerScript>,
) -> Result<Vec<RepoDevServerScript>> {
    let mut normalized = dev_servers;
    normalize_repo_dev_servers(&mut normalized)?;
    Ok(normalized)
}

fn normalize_runtime_kind(value: Option<String>) -> Result<Option<String>> {
    let Some(runtime_kind) = value else {
        return Ok(None);
    };

    let trimmed = runtime_kind.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("defaultRuntimeKind cannot be blank"));
    }

    Ok(Some(trimmed.to_string()))
}

#[cfg(test)]
mod tests {
    use super::{
        normalize_hook_set, AppService, RepoConfigUpdate, RepoSettingsUpdate,
        WorkspaceSettingsSnapshotUpdate,
    };
    use crate::app_service::test_support::{
        lock_env, set_env_var, unique_temp_path, EnvVarGuard, FakeTaskStore, TaskStoreState,
    };
    use anyhow::{anyhow, Result};
    use host_domain::TaskStore;
    use host_infra_system::{
        AppConfigStore, AutopilotSettings, GitCliPort, HookSet, KanbanEmptyColumnDisplay,
        PromptOverride, RepoDevServerScript,
    };
    use std::fs;
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};

    struct WorkspacePolicyFixture {
        service: AppService,
        workspace_id: String,
        root: PathBuf,
        _env_lock: std::sync::MutexGuard<'static, ()>,
        _home_guard: EnvVarGuard,
    }

    impl Drop for WorkspacePolicyFixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn setup_fixture(prefix: &str, hooks: HookSet) -> WorkspacePolicyFixture {
        let env_lock = lock_env();
        let root = unique_temp_path(prefix);
        fs::create_dir_all(&root).expect("fixture root should exist");
        let home_guard = set_env_var("HOME", root.to_string_lossy().as_ref());
        let repo = root.join("repo");
        fs::create_dir_all(repo.join(".git")).expect("fake git workspace should exist");
        let repo_path = repo.to_string_lossy().to_string();
        let workspace_id = "repo".to_string();

        let config_store = AppConfigStore::from_path(root.join("config.json"));
        config_store
            .add_workspace(&workspace_id, "repo", repo_path.as_str())
            .expect("workspace should be allowlisted");
        config_store
            .update_repo_hooks(&workspace_id, hooks)
            .expect("hooks should persist");

        let task_store: Arc<dyn TaskStore> = Arc::new(FakeTaskStore {
            state: Arc::new(Mutex::new(TaskStoreState::default())),
        });
        let service =
            AppService::with_git_port(task_store, config_store, Arc::new(GitCliPort::new()));

        WorkspacePolicyFixture {
            service,
            workspace_id,
            root,
            _env_lock: env_lock,
            _home_guard: home_guard,
        }
    }

    #[test]
    fn workspace_merge_repo_config_preserves_existing_hooks() -> Result<()> {
        let fixture = setup_fixture(
            "merge-repo-config",
            HookSet {
                pre_start: vec!["echo pre".to_string()],
                post_complete: vec!["echo post".to_string()],
            },
        );

        fixture.service.workspace_merge_repo_config(
            fixture.workspace_id.as_str(),
            RepoConfigUpdate {
                default_target_branch: Some(host_infra_system::GitTargetBranch {
                    remote: Some("origin".to_string()),
                    branch: "release".to_string(),
                }),
                ..RepoConfigUpdate::default()
            },
        )?;

        let updated = fixture
            .service
            .workspace_get_repo_config(&fixture.workspace_id)?;
        assert_eq!(updated.default_target_branch.canonical(), "origin/release");
        assert_eq!(updated.hooks.pre_start, vec!["echo pre".to_string()]);
        Ok(())
    }

    #[test]
    fn workspace_merge_repo_config_normalizes_dev_servers_and_skips_empty_commands() -> Result<()> {
        let fixture = setup_fixture("merge-repo-config-dev-servers", HookSet::default());

        fixture.service.workspace_merge_repo_config(
            fixture.workspace_id.as_str(),
            RepoConfigUpdate {
                dev_servers: Some(vec![
                    RepoDevServerScript {
                        id: " frontend ".to_string(),
                        name: " Frontend ".to_string(),
                        command: " bun run dev ".to_string(),
                    },
                    RepoDevServerScript {
                        id: "ignored".to_string(),
                        name: "Ignored".to_string(),
                        command: "   ".to_string(),
                    },
                ]),
                ..RepoConfigUpdate::default()
            },
        )?;

        let updated = fixture
            .service
            .workspace_get_repo_config(&fixture.workspace_id)?;
        assert_eq!(
            updated.dev_servers,
            vec![RepoDevServerScript {
                id: "frontend".to_string(),
                name: "Frontend".to_string(),
                command: "bun run dev".to_string(),
            }]
        );
        Ok(())
    }

    #[test]
    fn workspace_save_repo_settings_rejects_blank_default_runtime_kind() {
        let fixture = setup_fixture("blank-runtime-kind", HookSet::default());

        let error = fixture
            .service
            .workspace_save_repo_settings(
                fixture.workspace_id.as_str(),
                RepoSettingsUpdate {
                    default_runtime_kind: Some("   ".to_string()),
                    worktree_base_path: None,
                    branch_prefix: None,
                    default_target_branch: None,
                    git: None,
                    hooks: None,
                    dev_servers: None,
                    worktree_copy_paths: None,
                    prompt_overrides: None,
                    agent_defaults: None,
                },
            )
            .expect_err("blank runtime kind should fail");

        assert!(error
            .to_string()
            .contains("defaultRuntimeKind cannot be blank"));
    }

    #[test]
    fn workspace_save_repo_settings_rejects_duplicate_dev_server_ids() {
        let fixture = setup_fixture("duplicate-dev-server-ids", HookSet::default());

        let error = fixture
            .service
            .workspace_save_repo_settings(
                fixture.workspace_id.as_str(),
                RepoSettingsUpdate {
                    default_runtime_kind: None,
                    worktree_base_path: None,
                    branch_prefix: None,
                    default_target_branch: None,
                    git: None,
                    hooks: None,
                    dev_servers: Some(vec![
                        RepoDevServerScript {
                            id: "frontend".to_string(),
                            name: "Frontend".to_string(),
                            command: "bun run dev".to_string(),
                        },
                        RepoDevServerScript {
                            id: " frontend ".to_string(),
                            name: "Backend".to_string(),
                            command: "bun run api".to_string(),
                        },
                    ]),
                    worktree_copy_paths: None,
                    prompt_overrides: None,
                    agent_defaults: None,
                },
            )
            .expect_err("duplicate ids should fail");

        assert!(error
            .to_string()
            .contains("Duplicate dev server id: frontend"));
    }

    #[test]
    fn workspace_save_repo_settings_trims_runtime_kind() -> Result<()> {
        let fixture = setup_fixture("trim-runtime-kind", HookSet::default());

        fixture.service.workspace_save_repo_settings(
            fixture.workspace_id.as_str(),
            RepoSettingsUpdate {
                default_runtime_kind: Some("  claude-code  ".to_string()),
                worktree_base_path: None,
                branch_prefix: None,
                default_target_branch: None,
                git: None,
                hooks: None,
                dev_servers: None,
                worktree_copy_paths: None,
                prompt_overrides: None,
                agent_defaults: None,
            },
        )?;

        let persisted = fixture
            .service
            .workspace_get_repo_config(&fixture.workspace_id)?;
        assert_eq!(persisted.default_runtime_kind, "claude-code");
        Ok(())
    }

    #[test]
    fn workspace_save_settings_snapshot_normalizes_hooks_and_chat_settings() -> Result<()> {
        let fixture = setup_fixture(
            "snapshot-save-normalize",
            HookSet {
                pre_start: vec![" echo pre ".to_string()],
                post_complete: vec!["echo post".to_string()],
            },
        );

        let (theme, git, mut chat, kanban, autopilot, mut workspaces, mut global_prompt_overrides) =
            fixture.service.workspace_get_settings_snapshot()?;
        chat.show_thinking_messages = true;
        global_prompt_overrides.insert(
            "system.shared.workflow_guards".to_string(),
            PromptOverride {
                template: "global workflow guards".to_string(),
                base_version: 1,
                enabled: true,
            },
        );
        let repo_config = workspaces
            .get_mut(fixture.workspace_id.as_str())
            .ok_or_else(|| anyhow!("repo config missing"))?;
        repo_config.hooks = HookSet {
            pre_start: vec!["  echo pre  ".to_string()],
            post_complete: vec!["echo post".to_string()],
        };

        fixture
            .service
            .workspace_save_settings_snapshot(WorkspaceSettingsSnapshotUpdate {
                theme,
                git,
                chat,
                kanban,
                autopilot,
                workspaces,
                global_prompt_overrides,
            })?;

        let persisted = fixture
            .service
            .workspace_get_repo_config(&fixture.workspace_id)?;
        assert_eq!(
            persisted.hooks,
            HookSet {
                pre_start: vec!["echo pre".to_string()],
                post_complete: vec!["echo post".to_string()],
            }
        );

        let (_, _, persisted_chat, _, persisted_autopilot, _, _) =
            fixture.service.workspace_get_settings_snapshot()?;
        assert!(persisted_chat.show_thinking_messages);
        assert_eq!(persisted_autopilot, AutopilotSettings::default());
        Ok(())
    }

    #[test]
    fn workspace_save_settings_snapshot_preserves_kanban_empty_column_display() -> Result<()> {
        let fixture = setup_fixture("snapshot-kanban-empty-display", HookSet::default());

        let (theme, git, chat, mut kanban, autopilot, workspaces, global_prompt_overrides) =
            fixture.service.workspace_get_settings_snapshot()?;
        kanban.empty_column_display = KanbanEmptyColumnDisplay::Collapsed;

        fixture
            .service
            .workspace_save_settings_snapshot(WorkspaceSettingsSnapshotUpdate {
                theme,
                git,
                chat,
                kanban,
                autopilot,
                workspaces,
                global_prompt_overrides,
            })?;

        let (
            _persisted_theme,
            _persisted_git,
            _persisted_chat,
            persisted_kanban,
            _persisted_autopilot,
            _persisted_repos,
            _persisted_global_prompt_overrides,
        ) = fixture.service.workspace_get_settings_snapshot()?;

        assert_eq!(
            persisted_kanban.empty_column_display,
            KanbanEmptyColumnDisplay::Collapsed
        );
        Ok(())
    }

    #[test]
    fn workspace_save_settings_snapshot_rejects_duplicate_repo_paths() -> Result<()> {
        let fixture = setup_fixture("snapshot-duplicate-repo-path", HookSet::default());
        let second_repo = fixture.root.join("repo-two");
        fs::create_dir_all(second_repo.join(".git")).expect("second repo should exist");
        fixture.service.workspace_create(
            "repo-two",
            "Repo Two",
            second_repo.to_string_lossy().as_ref(),
        )?;

        let (theme, git, chat, kanban, autopilot, mut workspaces, global_prompt_overrides) =
            fixture.service.workspace_get_settings_snapshot()?;
        let duplicate_path = fixture
            .service
            .workspace_get_repo_config(&fixture.workspace_id)?
            .repo_path;
        let second_config = workspaces
            .get_mut("repo-two")
            .ok_or_else(|| anyhow!("second repo config missing"))?;
        second_config.repo_path = duplicate_path;

        let error = fixture
            .service
            .workspace_save_settings_snapshot(WorkspaceSettingsSnapshotUpdate {
                theme,
                git,
                chat,
                kanban,
                autopilot,
                workspaces,
                global_prompt_overrides,
            })
            .expect_err("duplicate repo path should be rejected");

        assert!(error
            .to_string()
            .contains("Repository path is already registered to workspace repo"));
        Ok(())
    }

    #[test]
    fn normalize_hook_set_trims_and_removes_blank_commands() {
        let normalized = normalize_hook_set(HookSet {
            pre_start: vec!["  echo pre  ".to_string(), "   ".to_string()],
            post_complete: vec!["".to_string(), " echo post ".to_string()],
        });
        assert_eq!(normalized.pre_start, vec!["echo pre".to_string()]);
        assert_eq!(normalized.post_complete, vec!["echo post".to_string()]);
    }
}

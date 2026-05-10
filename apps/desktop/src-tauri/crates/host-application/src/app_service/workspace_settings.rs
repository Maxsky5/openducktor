use anyhow::{anyhow, Result};
use host_domain::WorkspaceRecord;
use host_infra_system::{GlobalGitConfig, HookSet, KanbanSettings, RepoConfig};

#[cfg(test)]
use host_infra_system::{
    derive_workspace_name_from_repo_path, propose_workspace_id, uniquify_workspace_id,
};

use super::workspace_policy::WorkspaceSettingsSnapshot;
use super::AppService;

#[cfg(test)]
use std::collections::HashMap;

impl AppService {
    fn best_effort_auto_detect_git_provider_for_repo(&self, repo_path: &str, operation: &str) {
        if let Err(error) = self.auto_detect_git_provider_for_repo(repo_path) {
            tracing::warn!(
                "OpenDucktor warning: {operation} completed but GitHub repository auto-detect failed for {repo_path}: {error:#}"
            );
        }
    }

    pub fn workspace_repo_path(&self, workspace_id: &str) -> Result<String> {
        Ok(self.workspace_get_repo_config(workspace_id)?.repo_path)
    }

    pub(crate) fn workspace_id_for_repo_path(&self, repo_path: &str) -> Result<String> {
        Ok(self
            .config_store
            .find_workspace_by_repo_path(repo_path)?
            .ok_or_else(|| anyhow!("Workspace is not configured in {repo_path}"))?
            .workspace_id)
    }

    pub fn workspace_list(&self) -> Result<Vec<WorkspaceRecord>> {
        self.config_store.list_workspaces()
    }

    pub fn workspace_create(
        &self,
        workspace_id: &str,
        workspace_name: &str,
        repo_path: &str,
    ) -> Result<WorkspaceRecord> {
        let workspace = self
            .config_store
            .add_workspace(workspace_id, workspace_name, repo_path)?;
        self.best_effort_auto_detect_git_provider_for_repo(repo_path, "workspace create");
        Ok(workspace)
    }

    #[cfg(test)]
    pub fn workspace_add(&self, repo_path: &str) -> Result<WorkspaceRecord> {
        let config = self.config_store.load()?;
        let (workspace_id, workspace_name) =
            build_initial_workspace_identity(&config.workspaces, repo_path);
        self.workspace_create(&workspace_id, &workspace_name, repo_path)
    }

    pub fn workspace_select(&self, workspace_id: &str) -> Result<WorkspaceRecord> {
        let workspace = self.config_store.select_workspace(workspace_id)?;
        self.best_effort_auto_detect_git_provider_for_repo(
            workspace.repo_path.as_str(),
            "workspace select",
        );
        Ok(workspace)
    }

    pub fn workspace_reorder(&self, workspace_order: Vec<String>) -> Result<Vec<WorkspaceRecord>> {
        self.config_store.reorder_workspaces(workspace_order)
    }

    pub fn workspace_update_repo_config(
        &self,
        workspace_id: &str,
        config: RepoConfig,
    ) -> Result<WorkspaceRecord> {
        self.config_store.update_repo_config(workspace_id, config)
    }

    pub fn workspace_update_repo_hooks(
        &self,
        workspace_id: &str,
        hooks: HookSet,
    ) -> Result<WorkspaceRecord> {
        self.config_store.update_repo_hooks(workspace_id, hooks)
    }

    pub fn workspace_get_repo_config(&self, workspace_id: &str) -> Result<RepoConfig> {
        self.config_store.repo_config(workspace_id)
    }

    pub(crate) fn workspace_get_repo_config_by_repo_path(
        &self,
        repo_path: &str,
    ) -> Result<RepoConfig> {
        self.config_store.repo_config_by_repo_path(repo_path)
    }

    pub fn workspace_get_repo_config_optional(
        &self,
        workspace_id: &str,
    ) -> Result<Option<RepoConfig>> {
        self.config_store.repo_config_optional(workspace_id)
    }

    pub(crate) fn workspace_get_repo_config_optional_by_repo_path(
        &self,
        repo_path: &str,
    ) -> Result<Option<RepoConfig>> {
        self.config_store
            .repo_config_optional_by_repo_path(repo_path)
    }

    pub(crate) fn workspace_update_repo_config_by_repo_path(
        &self,
        repo_path: &str,
        config: RepoConfig,
    ) -> Result<WorkspaceRecord> {
        let workspace_id = self.workspace_id_for_repo_path(repo_path)?;
        self.workspace_update_repo_config(workspace_id.as_str(), config)
    }

    pub fn workspace_get_settings_snapshot(&self) -> Result<WorkspaceSettingsSnapshot> {
        let config = self.config_store.load()?;
        Ok(WorkspaceSettingsSnapshot {
            theme: config.theme,
            git: config.git,
            general: config.general,
            chat: config.chat,
            reusable_prompts: config.reusable_prompts,
            kanban: config.kanban,
            autopilot: config.autopilot,
            agent_runtimes: config.agent_runtimes,
            workspaces: config.workspaces,
            global_prompt_overrides: config.global_prompt_overrides,
        })
    }

    pub fn workspace_update_global_git_config(&self, git: GlobalGitConfig) -> Result<()> {
        self.config_store.update_global_git_config(git)
    }

    pub(super) fn workspace_persist_settings_snapshot(
        &self,
        snapshot: WorkspaceSettingsSnapshot,
    ) -> Result<()> {
        let mut config = self.config_store.load()?;
        let next_workspaces = self
            .config_store
            .normalize_settings_snapshot_workspaces(&config, snapshot.workspaces)?;

        config.theme = snapshot.theme;
        config.git = snapshot.git;
        config.general = snapshot.general;
        config.chat = snapshot.chat;
        config.reusable_prompts = snapshot.reusable_prompts;
        config.kanban = KanbanSettings {
            done_visible_days: snapshot.kanban.done_visible_days.max(0),
            empty_column_display: snapshot.kanban.empty_column_display,
        };
        config.autopilot = snapshot.autopilot;
        config.agent_runtimes = snapshot.agent_runtimes;
        config.global_prompt_overrides = snapshot.global_prompt_overrides;
        config.workspaces = next_workspaces;
        self.config_store.save(&config)
    }

    pub fn set_theme(&self, theme: &str) -> Result<()> {
        self.config_store.set_theme(theme)
    }
}

#[cfg(test)]
fn build_initial_workspace_identity(
    existing_workspaces: &HashMap<String, RepoConfig>,
    repo_path: &str,
) -> (String, String) {
    let workspace_name = derive_workspace_name_from_repo_path(repo_path);
    let workspace_id = uniquify_workspace_id(
        propose_workspace_id(&workspace_name).as_str(),
        existing_workspaces,
    );
    (workspace_id, workspace_name)
}

#[cfg(test)]
mod tests {
    use super::super::test_support::{
        build_service_with_state, init_git_repo, unique_temp_path, workspace_select_by_repo_path,
    };
    use host_infra_system::{AgentRuntimeConfig, ChatSettings, GeneralSettings};
    use std::fs;

    #[test]
    fn workspace_get_settings_snapshot_returns_defaulted_chat_settings() {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);

        let snapshot = service
            .workspace_get_settings_snapshot()
            .expect("settings snapshot should load");

        assert_eq!(snapshot.chat, ChatSettings::default());
        assert_eq!(snapshot.general, GeneralSettings::default());
        assert!(
            snapshot
                .general
                .open_agent_studio_tab_on_background_session_start
        );
        assert!(snapshot.reusable_prompts.is_empty());
        assert!(!snapshot.chat.show_thinking_messages);
        assert_eq!(snapshot.kanban.done_visible_days, 1);
        assert!(snapshot.agent_runtimes["opencode"].enabled);
        assert!(!snapshot.agent_runtimes["codex"].enabled);
        assert!(snapshot.workspaces.is_empty());
        assert!(snapshot.global_prompt_overrides.is_empty());
    }

    #[test]
    fn workspace_save_settings_snapshot_preserves_agent_runtime_enablement() {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let mut snapshot = service
            .workspace_get_settings_snapshot()
            .expect("settings snapshot should load");
        snapshot
            .agent_runtimes
            .insert("codex".to_string(), AgentRuntimeConfig { enabled: true });

        service
            .workspace_save_settings_snapshot(snapshot)
            .expect("settings snapshot should save");

        let snapshot = service
            .workspace_get_settings_snapshot()
            .expect("settings snapshot should reload");
        assert!(snapshot.agent_runtimes["codex"].enabled);
    }

    #[test]
    fn workspace_save_settings_snapshot_preserves_disabled_general_setting() {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let mut snapshot = service
            .workspace_get_settings_snapshot()
            .expect("settings snapshot should load");
        snapshot
            .general
            .open_agent_studio_tab_on_background_session_start = false;

        service
            .workspace_save_settings_snapshot(snapshot)
            .expect("settings snapshot should save");

        let snapshot = service
            .workspace_get_settings_snapshot()
            .expect("settings snapshot should reload");
        assert!(
            !snapshot
                .general
                .open_agent_studio_tab_on_background_session_start
        );
    }

    #[test]
    fn workspace_add_persists_selection_without_beads_initialization() {
        let (service, task_state, _git_state) = build_service_with_state(vec![]);
        let repo_path = unique_temp_path("workspace-add-without-beads-init");
        init_git_repo(&repo_path).expect("git repo should initialize");

        {
            let mut state = task_state.lock().expect("task state lock poisoned");
            state.ensure_error = Some("beads init failed".to_string());
        }

        let workspace = service
            .workspace_add(repo_path.to_string_lossy().as_ref())
            .expect("workspace add should not fail on beads init");

        assert!(workspace.is_active);
        assert_eq!(
            workspace.repo_path,
            repo_path
                .canonicalize()
                .expect("canonical repo path")
                .to_string_lossy()
        );

        let state = task_state.lock().expect("task state lock poisoned");
        assert!(
            state.ensure_calls.is_empty(),
            "workspace add should not initialize beads"
        );
    }

    #[test]
    fn workspace_select_persists_selection_without_beads_initialization() {
        let (service, task_state, _git_state) = build_service_with_state(vec![]);
        let repo_path = unique_temp_path("workspace-select-without-beads-init");
        init_git_repo(&repo_path).expect("git repo should initialize");

        service
            .workspace_add(repo_path.to_string_lossy().as_ref())
            .expect("workspace add should succeed");

        {
            let mut state = task_state.lock().expect("task state lock poisoned");
            state.ensure_error = Some("beads init failed".to_string());
            state.ensure_calls.clear();
        }

        let workspace =
            workspace_select_by_repo_path(&service, repo_path.to_string_lossy().as_ref())
                .expect("workspace select should not fail on beads init");

        assert!(workspace.is_active);

        let state = task_state.lock().expect("task state lock poisoned");
        assert!(
            state.ensure_calls.is_empty(),
            "workspace select should not initialize beads"
        );
    }

    #[test]
    fn workspace_select_succeeds_when_git_provider_auto_detect_fails() {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let repo_path = unique_temp_path("workspace-select-autodetect-best-effort");
        init_git_repo(&repo_path).expect("git repo should initialize");

        let workspace = service
            .workspace_add(repo_path.to_string_lossy().as_ref())
            .expect("workspace add should succeed");

        fs::remove_dir_all(&repo_path).expect("repo path should be removed to break auto-detect");

        let selected = service
            .workspace_select(workspace.workspace_id.as_str())
            .expect("workspace select should succeed when auto-detect fails");

        assert!(selected.is_active);
        assert_eq!(selected.workspace_id, workspace.workspace_id);
    }

    #[test]
    fn resolve_initialized_repo_path_reinitializes_after_workspace_rebind() {
        let (service, task_state, _git_state) = build_service_with_state(vec![]);
        let original_repo = unique_temp_path("workspace-rebind-init-original");
        let rebound_repo = unique_temp_path("workspace-rebind-init-rebound");
        init_git_repo(&original_repo).expect("original repo should initialize");
        init_git_repo(&rebound_repo).expect("rebound repo should initialize");

        let workspace = service
            .workspace_add(original_repo.to_string_lossy().as_ref())
            .expect("workspace add should succeed");
        let original_resolved = service
            .resolve_initialized_repo_path(original_repo.to_string_lossy().as_ref())
            .expect("original repo should initialize");

        let mut repo_config = service
            .workspace_get_repo_config(workspace.workspace_id.as_str())
            .expect("repo config should load");
        repo_config.repo_path = rebound_repo.to_string_lossy().to_string();
        service
            .workspace_update_repo_config(workspace.workspace_id.as_str(), repo_config)
            .expect("workspace rebind should succeed");
        let rebound_resolved = service
            .resolve_initialized_repo_path(rebound_repo.to_string_lossy().as_ref())
            .expect("rebound repo should initialize");

        let state = task_state.lock().expect("task state lock poisoned");
        assert_eq!(state.ensure_calls.len(), 2);
        assert!(state.ensure_calls.contains(&original_resolved));
        assert!(state.ensure_calls.contains(&rebound_resolved));
    }
}

use super::{read_opencode_version, resolve_opencode_binary_path, AppService};
use anyhow::{anyhow, Result};
use host_domain::{
    BeadsCheck, GitBranch, GitCurrentBranch, GitPushSummary, GitWorktreeSummary, RuntimeCheck,
    SystemCheck, WorkspaceRecord,
};
use host_infra_system::{command_exists, resolve_central_beads_dir, version_command, RepoConfig};
use std::path::Path;

impl AppService {
    pub fn runtime_check(&self) -> Result<RuntimeCheck> {
        let git_ok = command_exists("git");
        let opencode_binary = resolve_opencode_binary_path();
        let opencode_ok = opencode_binary.is_some();

        let mut errors = Vec::new();
        if !git_ok {
            errors.push("git not found in PATH".to_string());
        }
        if !opencode_ok {
            errors.push("opencode not found in PATH".to_string());
        }

        Ok(RuntimeCheck {
            git_ok,
            git_version: version_command("git", &["--version"]),
            opencode_ok,
            opencode_version: opencode_binary.as_ref().map(|binary| {
                if let Some(version) = read_opencode_version(binary.as_str()) {
                    format!("{version} ({binary})")
                } else {
                    format!("installed ({binary})")
                }
            }),
            errors,
        })
    }

    pub fn beads_check(&self, repo_path: &str) -> Result<BeadsCheck> {
        if !command_exists("bd") {
            return Ok(BeadsCheck {
                beads_ok: false,
                beads_path: None,
                beads_error: Some("bd not found in PATH".to_string()),
            });
        }

        let repo = Path::new(repo_path);
        match resolve_central_beads_dir(repo) {
            Ok(path) => {
                let path_string = path.to_string_lossy().to_string();
                match self.ensure_repo_initialized(repo_path) {
                    Ok(()) => Ok(BeadsCheck {
                        beads_ok: true,
                        beads_path: Some(path_string),
                        beads_error: None,
                    }),
                    Err(error) => Ok(BeadsCheck {
                        beads_ok: false,
                        beads_path: Some(path_string),
                        beads_error: Some(error.to_string()),
                    }),
                }
            }
            Err(error) => Ok(BeadsCheck {
                beads_ok: false,
                beads_path: None,
                beads_error: Some(error.to_string()),
            }),
        }
    }

    pub fn system_check(&self, repo_path: &str) -> Result<SystemCheck> {
        let runtime = self.runtime_check()?;
        let beads = self.beads_check(repo_path)?;
        let mut errors = runtime.errors;
        if let Some(beads_error) = beads.beads_error.as_deref() {
            errors.push(format!("beads: {beads_error}"));
        }

        Ok(SystemCheck {
            git_ok: runtime.git_ok,
            git_version: runtime.git_version,
            opencode_ok: runtime.opencode_ok,
            opencode_version: runtime.opencode_version,
            beads_ok: beads.beads_ok,
            beads_path: beads.beads_path,
            beads_error: beads.beads_error,
            errors,
        })
    }

    pub fn workspace_list(&self) -> Result<Vec<WorkspaceRecord>> {
        self.config_store.list_workspaces()
    }

    pub fn workspace_add(&self, repo_path: &str) -> Result<WorkspaceRecord> {
        let workspace = self.config_store.add_workspace(repo_path)?;
        self.ensure_repo_initialized(repo_path)?;
        Ok(workspace)
    }

    pub fn workspace_select(&self, repo_path: &str) -> Result<WorkspaceRecord> {
        let workspace = self.config_store.select_workspace(repo_path)?;
        self.ensure_repo_initialized(repo_path)?;
        Ok(workspace)
    }

    pub fn workspace_update_repo_config(
        &self,
        repo_path: &str,
        config: RepoConfig,
    ) -> Result<WorkspaceRecord> {
        self.config_store.update_repo_config(repo_path, config)
    }

    pub fn workspace_get_repo_config(&self, repo_path: &str) -> Result<RepoConfig> {
        self.config_store.repo_config(repo_path)
    }

    pub fn workspace_get_repo_config_optional(
        &self,
        repo_path: &str,
    ) -> Result<Option<RepoConfig>> {
        self.config_store.repo_config_optional(repo_path)
    }

    pub fn workspace_set_trusted_hooks(
        &self,
        repo_path: &str,
        trusted: bool,
    ) -> Result<WorkspaceRecord> {
        self.config_store.set_repo_trust_hooks(repo_path, trusted)
    }

    pub fn git_get_branches(&self, repo_path: &str) -> Result<Vec<GitBranch>> {
        self.ensure_repo_initialized(repo_path)?;
        self.git_port.get_branches(Path::new(repo_path))
    }

    pub fn git_get_current_branch(&self, repo_path: &str) -> Result<GitCurrentBranch> {
        self.ensure_repo_initialized(repo_path)?;
        self.git_port.get_current_branch(Path::new(repo_path))
    }

    pub fn git_switch_branch(
        &self,
        repo_path: &str,
        branch: &str,
        create: bool,
    ) -> Result<GitCurrentBranch> {
        self.ensure_repo_initialized(repo_path)?;
        self.git_port
            .switch_branch(Path::new(repo_path), branch, create)
    }

    pub fn git_create_worktree(
        &self,
        repo_path: &str,
        worktree_path: &str,
        branch: &str,
        create_branch: bool,
    ) -> Result<GitWorktreeSummary> {
        self.ensure_repo_initialized(repo_path)?;
        let worktree = worktree_path.trim();
        if worktree.is_empty() {
            return Err(anyhow!("worktree path cannot be empty"));
        }

        self.git_port.create_worktree(
            Path::new(repo_path),
            Path::new(worktree),
            branch,
            create_branch,
        )?;

        Ok(GitWorktreeSummary {
            branch: branch.trim().to_string(),
            worktree_path: worktree.to_string(),
        })
    }

    pub fn git_remove_worktree(
        &self,
        repo_path: &str,
        worktree_path: &str,
        force: bool,
    ) -> Result<bool> {
        self.ensure_repo_initialized(repo_path)?;
        let worktree = worktree_path.trim();
        if worktree.is_empty() {
            return Err(anyhow!("worktree path cannot be empty"));
        }
        self.git_port
            .remove_worktree(Path::new(repo_path), Path::new(worktree), force)?;
        Ok(true)
    }

    pub fn git_push_branch(
        &self,
        repo_path: &str,
        remote: Option<&str>,
        branch: &str,
        set_upstream: bool,
        force_with_lease: bool,
    ) -> Result<GitPushSummary> {
        self.ensure_repo_initialized(repo_path)?;
        let remote = remote
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("origin");
        self.git_port.push_branch(
            Path::new(repo_path),
            remote,
            branch,
            set_upstream,
            force_with_lease,
        )
    }
}

#[cfg(test)]
mod tests {
    use crate::app_service::test_support::build_service_with_state;

    #[test]
    fn module_git_create_worktree_rejects_empty_path() {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);

        let error = service
            .git_create_worktree("/tmp/odt-repo-module", "   ", "feature/x", true)
            .expect_err("empty worktree path should fail");

        assert!(error.to_string().contains("worktree path cannot be empty"));
    }

    #[test]
    fn module_git_push_branch_defaults_remote_to_origin() {
        let (service, _task_state, git_state) = build_service_with_state(vec![]);

        let summary = service
            .git_push_branch(
                "/tmp/odt-repo-module",
                Some("   "),
                "feature/x",
                false,
                false,
            )
            .expect("push summary should be returned");

        assert_eq!(summary.remote, "origin");
        let state = git_state.lock().expect("git state lock poisoned");
        assert_eq!(state.last_push_remote.as_deref(), Some("origin"));
    }
}

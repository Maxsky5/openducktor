use anyhow::{anyhow, Context, Result};
use host_domain::{
    GitResetWorktreeSelectionRequest, GitResetWorktreeSelectionResult, GitWorktreeSummary,
};
use host_infra_system::{
    copy_configured_worktree_paths, remove_worktree, remove_worktree_path_if_present,
    resolve_effective_worktree_base_dir_for_workspace, run_command,
};
use std::fs;
use std::path::{Path, PathBuf};

use super::git_operations::resolve_execution_path;
use super::AppService;

fn is_definitive_non_worktree_git_error(error: &anyhow::Error) -> bool {
    let error_text = format!("{error:#}").to_ascii_lowercase();
    [
        "not a git repository",
        "not a git worktree",
        "not a working tree",
        "is not a working tree",
    ]
    .into_iter()
    .any(|needle| error_text.contains(needle))
}

fn resolve_worktree_path(repo_path: &Path, worktree_path: &Path) -> PathBuf {
    if worktree_path.is_absolute() {
        return worktree_path.to_path_buf();
    }

    repo_path.join(worktree_path)
}

fn path_is_within_root(root: &Path, candidate: &Path) -> bool {
    let normalized_root = normalize_path_for_comparison(root.to_string_lossy().as_ref());
    let normalized_candidate = normalize_path_for_comparison(candidate.to_string_lossy().as_ref());

    normalized_candidate.starts_with(&normalized_root)
}

fn normalize_path_for_comparison(path: &str) -> PathBuf {
    fs::canonicalize(path).unwrap_or_else(|_| Path::new(path).to_path_buf())
}

impl AppService {
    fn is_allowed_force_worktree_cleanup_path(
        &self,
        repo_path: &str,
        candidate_path: &Path,
    ) -> Result<bool> {
        let repo_path_ref = Path::new(repo_path);
        if path_is_within_root(repo_path_ref, candidate_path) {
            return Ok(true);
        }

        let repo_config = self.config_store.repo_config_by_repo_path(repo_path)?;
        let managed_worktree_base = resolve_effective_worktree_base_dir_for_workspace(
            repo_config.workspace_id.as_str(),
            repo_config.worktree_base_path.as_deref(),
        )?;

        Ok(
            path_is_within_root(managed_worktree_base.as_path(), candidate_path)
                || self.is_recorded_task_worktree_path(repo_path, candidate_path)?,
        )
    }

    fn is_recorded_task_worktree_path(
        &self,
        repo_path: &str,
        candidate_path: &Path,
    ) -> Result<bool> {
        let normalized_candidate =
            normalize_path_for_comparison(candidate_path.to_string_lossy().as_ref());
        let normalized_repo = normalize_path_for_comparison(repo_path);
        if normalized_candidate == normalized_repo {
            return Ok(false);
        }

        Ok(self
            .task_store
            .list_tasks(Path::new(repo_path))?
            .into_iter()
            .flat_map(|task| task.agent_sessions.into_iter())
            .map(|session| normalize_path_for_comparison(session.working_directory.as_str()))
            .any(|recorded_path| recorded_path == normalized_candidate))
    }

    pub fn git_create_worktree(
        &self,
        repo_path: &str,
        worktree_path: &str,
        branch: &str,
        create_branch: bool,
    ) -> Result<GitWorktreeSummary> {
        let repo_path = self.resolve_authorized_repo_path(repo_path)?;
        let worktree = worktree_path.trim();
        if worktree.is_empty() {
            return Err(anyhow!("worktree path cannot be empty"));
        }
        let repo_config = self
            .config_store
            .repo_config_by_repo_path(repo_path.as_str())?;

        self.git_port.create_worktree(
            Path::new(&repo_path),
            Path::new(worktree),
            branch,
            create_branch,
        )?;

        if let Err(error) = copy_configured_worktree_paths(
            Path::new(&repo_path),
            Path::new(worktree),
            repo_config.worktree_copy_paths.as_slice(),
        ) {
            let cleanup_error = self.cleanup_failed_created_worktree(
                Path::new(&repo_path),
                Path::new(worktree),
                branch,
                create_branch,
            );
            return Err(anyhow!(
                "Configured worktree copy failed: {error}{}",
                cleanup_error
            ));
        }

        Ok(GitWorktreeSummary {
            branch: branch.trim().to_string(),
            worktree_path: worktree.to_string(),
        })
    }

    fn cleanup_failed_created_worktree(
        &self,
        repo_path: &Path,
        worktree_path: &Path,
        branch: &str,
        delete_branch: bool,
    ) -> String {
        let mut cleanup_errors = Vec::new();

        if let Err(error) = remove_worktree(repo_path, worktree_path) {
            cleanup_errors.push(format!("Also failed to remove worktree: {error}"));
        }
        if let Err(error) = run_command(
            "git",
            &["worktree", "prune", "--expire", "now"],
            Some(repo_path),
        ) {
            cleanup_errors.push(format!("Also failed to prune worktree metadata: {error}"));
        }
        if delete_branch {
            if let Err(error) = self.git_port.delete_local_branch(repo_path, branch, true) {
                cleanup_errors.push(format!(
                    "Also failed to delete created branch {branch}: {error}"
                ));
            }
        }

        if cleanup_errors.is_empty() {
            String::new()
        } else {
            format!("\n{}", cleanup_errors.join("\n"))
        }
    }

    pub fn git_remove_worktree(
        &self,
        repo_path: &str,
        worktree_path: &str,
        force: bool,
    ) -> Result<bool> {
        let repo_path = self.resolve_authorized_repo_path(repo_path)?;
        let worktree = worktree_path.trim();
        if worktree.is_empty() {
            return Err(anyhow!("worktree path cannot be empty"));
        }

        let repo_path_ref = Path::new(&repo_path);
        let requested_worktree_path = Path::new(worktree);
        let effective_worktree_path = resolve_worktree_path(repo_path_ref, requested_worktree_path);

        let normalized_repo = normalize_path_for_comparison(&repo_path);
        let normalized_worktree =
            normalize_path_for_comparison(effective_worktree_path.to_string_lossy().as_ref());
        if normalized_repo == normalized_worktree {
            return Err(anyhow!("worktree path cannot be the repository root"));
        }

        if let Err(error) =
            self.git_port
                .remove_worktree(repo_path_ref, requested_worktree_path, force)
        {
            if !force || !is_definitive_non_worktree_git_error(&error) {
                return Err(error);
            }

            if !self.is_allowed_force_worktree_cleanup_path(
                repo_path.as_str(),
                effective_worktree_path.as_path(),
            )? {
                return Err(error).with_context(|| {
                    format!(
                        "Refusing forced worktree cleanup outside managed roots for {}",
                        effective_worktree_path.display()
                    )
                });
            }
        }
        remove_worktree_path_if_present(effective_worktree_path.as_path()).with_context(|| {
            format!("git worktree removal left filesystem path cleanup incomplete for {worktree}")
        })?;
        Ok(true)
    }

    pub fn git_reset_worktree_selection(
        &self,
        repo_path: &str,
        request: GitResetWorktreeSelectionRequest,
    ) -> Result<GitResetWorktreeSelectionResult> {
        let repo_path = self.resolve_authorized_repo_path(repo_path)?;
        let execution_path =
            resolve_execution_path(repo_path.as_str(), request.working_dir.as_deref());

        self.git_port
            .reset_worktree_selection(Path::new(&execution_path), request)
    }
}

#[cfg(test)]
mod tests {
    use super::super::test_support::{
        add_workspace_with_repo_config, build_service_with_state, init_git_repo, unique_temp_path,
    };
    use std::fs;

    #[test]
    fn module_git_create_worktree_rejects_empty_path() {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);

        let error = service
            .git_create_worktree("/tmp/odt-repo-module", "   ", "feature/x", true)
            .expect_err("empty worktree path should fail");

        assert!(error.to_string().contains("worktree path cannot be empty"));
    }

    #[test]
    fn module_git_remove_worktree_rejects_repository_root() {
        let (service, _task_state, git_state) = build_service_with_state(vec![]);

        let error = service
            .git_remove_worktree("/tmp/odt-repo-module", "/tmp/odt-repo-module", true)
            .expect_err("repository root should be rejected for worktree removal");

        assert!(error
            .to_string()
            .contains("worktree path cannot be the repository root"));

        let git_state = git_state.lock().expect("git state lock poisoned");
        assert!(
            git_state.calls.is_empty(),
            "git port should not run when path is repository root"
        );
    }

    #[test]
    fn module_git_remove_worktree_force_cleans_up_stranded_directory_after_non_worktree_error() {
        let root = unique_temp_path("module-git-remove-worktree-stranded");
        let repo = root.join("repo");
        let worktree = root.join("worktree");
        fs::create_dir_all(&repo).expect("repo directory should exist");
        init_git_repo(&repo).expect("repo should be initialized");
        fs::create_dir_all(worktree.join("nested")).expect("worktree directory should exist");

        let (service, _task_state, git_state) = build_service_with_state(vec![]);
        add_workspace_with_repo_config(
            &service,
            repo.to_string_lossy().as_ref(),
            host_infra_system::RepoConfig {
                worktree_base_path: Some(root.to_string_lossy().to_string()),
                ..Default::default()
            },
        )
        .expect("worktree base should be configured");
        git_state
            .lock()
            .expect("git state lock poisoned")
            .remove_worktree_error = Some("fatal: '/tmp/wt' is not a working tree".to_string());

        assert!(service
            .git_remove_worktree(
                repo.to_string_lossy().as_ref(),
                worktree.to_string_lossy().as_ref(),
                true,
            )
            .expect("forced stranded cleanup should succeed"));
        assert!(
            !worktree.exists(),
            "stranded worktree directory should be removed"
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn module_git_remove_worktree_resolves_relative_cleanup_path_against_repo() {
        let root = unique_temp_path("module-git-remove-worktree-relative");
        let repo = root.join("repo");
        let worktree = repo.join("nested").join("task-1");
        fs::create_dir_all(worktree.join("nested")).expect("relative worktree should exist");

        let (service, _task_state, _git_state) = build_service_with_state(vec![]);

        assert!(service
            .git_remove_worktree(repo.to_string_lossy().as_ref(), "nested/task-1", true)
            .expect("relative worktree cleanup should succeed"));
        assert!(
            !worktree.exists(),
            "relative worktree directory should be removed"
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn module_git_remove_worktree_does_not_force_delete_unmanaged_relative_paths() {
        let root = unique_temp_path("module-git-remove-worktree-unmanaged-relative");
        let repo = root.join("repo");
        let outside = root.join("outside");
        fs::create_dir_all(&repo).expect("repo directory should exist");
        init_git_repo(&repo).expect("repo should be initialized");
        fs::create_dir_all(outside.join("nested")).expect("outside directory should exist");

        let (service, _task_state, git_state) = build_service_with_state(vec![]);
        service
            .workspace_add(repo.to_string_lossy().as_ref())
            .expect("repo should be registered");
        git_state
            .lock()
            .expect("git state lock poisoned")
            .remove_worktree_error = Some("fatal: '../outside' is not a working tree".to_string());

        let error = service
            .git_remove_worktree(repo.to_string_lossy().as_ref(), "../outside", true)
            .expect_err("unmanaged paths should not be force-deleted");
        assert!(error.to_string().contains("outside managed roots"));
        assert!(outside.exists(), "unmanaged directory should be preserved");

        let _ = fs::remove_dir_all(root);
    }
}

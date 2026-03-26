use super::{read_opencode_version, resolve_opencode_binary_path, AppService, CachedRuntimeCheck};
use anyhow::{anyhow, Result};
use host_domain::{
    BeadsCheck, GitAheadBehind, GitBranch, GitCommitAllRequest, GitCommitAllResult,
    GitConflictAbortRequest, GitConflictAbortResult, GitCurrentBranch, GitFileDiff, GitFileStatus,
    GitPullRequest, GitPullResult, GitPushResult, GitRebaseAbortRequest, GitRebaseAbortResult,
    GitRebaseBranchRequest, GitRebaseBranchResult, GitResetWorktreeSelectionRequest,
    GitResetWorktreeSelectionResult, GitWorktreeSummary, RuntimeCheck, RuntimeHealth, SystemCheck,
    WorkspaceRecord,
};
use host_infra_system::{
    command_exists, copy_configured_worktree_files, remove_worktree, repo_script_fingerprint,
    resolve_central_beads_dir, run_command, run_command_allow_failure_with_env, version_command,
    ChatSettings, GlobalGitConfig, HookSet, KanbanSettings, PromptOverrides, RepoConfig,
};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

const RUNTIME_CHECK_CACHE_TTL: Duration = Duration::from_secs(5 * 60);
const GH_NON_INTERACTIVE_ENV: [(&str, &str); 1] = [("GH_PROMPT_DISABLED", "1")];

type SettingsSnapshotTuple = (
    String,
    GlobalGitConfig,
    ChatSettings,
    KanbanSettings,
    HashMap<String, RepoConfig>,
    PromptOverrides,
);

fn resolve_execution_path(repo_path: &str, working_dir: Option<&str>) -> String {
    working_dir
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(repo_path)
        .to_string()
}

fn normalize_path_for_comparison(path: &str) -> PathBuf {
    fs::canonicalize(path).unwrap_or_else(|_| Path::new(path).to_path_buf())
}

impl AppService {
    pub fn runtime_check(&self) -> Result<RuntimeCheck> {
        self.runtime_check_with_refresh(false)
    }

    pub fn runtime_check_with_refresh(&self, force_refresh: bool) -> Result<RuntimeCheck> {
        if !force_refresh {
            if let Some(cached) = self.cached_runtime_check()? {
                return Ok(cached);
            }
        }

        let runtime = Self::probe_runtime_check();
        self.update_runtime_check_cache(runtime.clone())?;
        Ok(runtime)
    }

    fn probe_runtime_check() -> RuntimeCheck {
        let git_ok = command_exists("git");
        let gh_ok = command_exists("gh");
        let (gh_auth_ok, gh_auth_login, gh_auth_error) = if gh_ok {
            probe_github_auth_status()
        } else {
            (
                false,
                None,
                Some(
                    "gh not found in bundled locations, standard install locations, or PATH"
                        .to_string(),
                ),
            )
        };
        let opencode_binary = resolve_opencode_binary_path();
        let opencode_ok = opencode_binary.is_some();

        let mut errors = Vec::new();
        if !git_ok {
            errors.push(
                "git not found in bundled locations, standard install locations, or PATH"
                    .to_string(),
            );
        }
        if !gh_ok {
            errors.push(
                "gh not found in bundled locations, standard install locations, or PATH"
                    .to_string(),
            );
        }
        if !opencode_ok {
            errors.push(
                "opencode not found in bundled locations, standard install locations, PATH, or ~/.opencode/bin"
                    .to_string(),
            );
        }

        RuntimeCheck {
            git_ok,
            git_version: version_command("git", &["--version"]),
            gh_ok,
            gh_version: version_command("gh", &["--version"]),
            gh_auth_ok,
            gh_auth_login,
            gh_auth_error,
            runtimes: vec![RuntimeHealth {
                kind: "opencode".to_string(),
                ok: opencode_ok,
                version: opencode_binary.as_ref().map(|binary| {
                    if let Some(version) = read_opencode_version(binary.as_str()) {
                        format!("{version} ({binary})")
                    } else {
                        format!("installed ({binary})")
                    }
                }),
                error: (!opencode_ok).then(|| {
                    "opencode not found in bundled locations, standard install locations, PATH, or ~/.opencode/bin"
                        .to_string()
                }),
            }],
            errors,
        }
    }

    fn cached_runtime_check(&self) -> Result<Option<RuntimeCheck>> {
        let mut cache = self
            .runtime_check_cache
            .lock()
            .map_err(|_| anyhow!("Runtime check cache lock poisoned in `cached_runtime_check`"))?;
        if let Some(entry) = cache.as_ref() {
            if entry.checked_at.elapsed() <= RUNTIME_CHECK_CACHE_TTL {
                return Ok(Some(entry.value.clone()));
            }
        }
        *cache = None;
        Ok(None)
    }

    fn update_runtime_check_cache(&self, check: RuntimeCheck) -> Result<()> {
        let mut cache = self.runtime_check_cache.lock().map_err(|_| {
            anyhow!("Runtime check cache lock poisoned in `update_runtime_check_cache`")
        })?;
        *cache = Some(CachedRuntimeCheck {
            checked_at: Instant::now(),
            value: check,
        });
        Ok(())
    }

    pub fn beads_check(&self, repo_path: &str) -> Result<BeadsCheck> {
        if !command_exists("bd") {
            return Ok(BeadsCheck {
                beads_ok: false,
                beads_path: None,
                beads_error: Some(
                    "bd not found in bundled locations, standard install locations, or PATH"
                        .to_string(),
                ),
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
                        beads_error: Some(format!("{error:#}")),
                    }),
                }
            }
            Err(error) => Ok(BeadsCheck {
                beads_ok: false,
                beads_path: None,
                beads_error: Some(format!("{error:#}")),
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
            gh_ok: runtime.gh_ok,
            gh_version: runtime.gh_version,
            gh_auth_ok: runtime.gh_auth_ok,
            gh_auth_login: runtime.gh_auth_login,
            gh_auth_error: runtime.gh_auth_error,
            runtimes: runtime.runtimes,
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
        self.auto_detect_git_provider_for_repo(repo_path)?;
        Ok(workspace)
    }

    pub fn workspace_select(&self, repo_path: &str) -> Result<WorkspaceRecord> {
        let workspace = self.config_store.select_workspace(repo_path)?;
        self.auto_detect_git_provider_for_repo(repo_path)?;
        Ok(workspace)
    }

    pub fn workspace_update_repo_config(
        &self,
        repo_path: &str,
        config: RepoConfig,
    ) -> Result<WorkspaceRecord> {
        self.config_store.update_repo_config(repo_path, config)
    }

    pub fn workspace_update_repo_hooks(
        &self,
        repo_path: &str,
        hooks: HookSet,
    ) -> Result<WorkspaceRecord> {
        self.config_store.update_repo_hooks(repo_path, hooks)
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

    pub fn workspace_get_settings_snapshot(&self) -> Result<SettingsSnapshotTuple> {
        let config = self.config_store.load()?;
        Ok((
            config.theme,
            config.git,
            config.chat,
            config.kanban,
            config.repos,
            config.global_prompt_overrides,
        ))
    }

    pub fn workspace_update_global_git_config(&self, git: GlobalGitConfig) -> Result<()> {
        self.config_store.update_global_git_config(git)
    }

    pub(super) fn workspace_persist_settings_snapshot(
        &self,
        theme: String,
        git: GlobalGitConfig,
        chat: ChatSettings,
        kanban: KanbanSettings,
        repos: HashMap<String, RepoConfig>,
        global_prompt_overrides: PromptOverrides,
    ) -> Result<()> {
        let mut config = self.config_store.load()?;
        for repo_path in repos.keys() {
            if !config.repos.contains_key(repo_path) {
                return Err(anyhow!(
                    "Workspace not found in config: {repo_path}. Add/select the workspace before updating configuration."
                ));
            }
        }

        config.theme = theme;
        config.git = git;
        config.chat = chat;
        config.kanban = kanban;
        config.global_prompt_overrides = global_prompt_overrides;
        for (repo_path, repo_config) in repos {
            config.repos.insert(repo_path, repo_config);
        }
        self.config_store.save(&config)
    }

    pub(super) fn workspace_persist_trusted_hooks(
        &self,
        repo_path: &str,
        trusted: bool,
        expected_fingerprint: Option<&str>,
    ) -> Result<WorkspaceRecord> {
        if trusted {
            let config = self.config_store.repo_config(repo_path)?;
            let current_fingerprint = repo_script_fingerprint(&config.hooks, &config.dev_servers);
            if let Some(expected) = expected_fingerprint {
                if expected != current_fingerprint {
                    return Err(anyhow!(
                        "Hook trust challenge is stale for {repo_path}; hooks changed before confirmation."
                    ));
                }
            } else {
                return Err(anyhow!(
                    "Hook trust confirmation requires fingerprint challenge."
                ));
            }

            return self.config_store.set_repo_trust_hooks(
                repo_path,
                true,
                Some(current_fingerprint),
            );
        }

        self.config_store
            .set_repo_trust_hooks(repo_path, false, None)
    }

    pub fn set_theme(&self, theme: &str) -> Result<()> {
        self.config_store.set_theme(theme)
    }

    pub fn git_get_branches(&self, repo_path: &str) -> Result<Vec<GitBranch>> {
        let repo_path = self.resolve_authorized_repo_path(repo_path)?;
        self.git_port.get_branches(Path::new(&repo_path))
    }

    pub fn git_get_current_branch(&self, repo_path: &str) -> Result<GitCurrentBranch> {
        let repo_path = self.resolve_authorized_repo_path(repo_path)?;
        self.git_port.get_current_branch(Path::new(&repo_path))
    }

    pub fn git_switch_branch(
        &self,
        repo_path: &str,
        branch: &str,
        create: bool,
    ) -> Result<GitCurrentBranch> {
        let repo_path = self.resolve_authorized_repo_path(repo_path)?;
        self.git_port
            .switch_branch(Path::new(&repo_path), branch, create)
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
        let repo_config = self.config_store.repo_config(repo_path.as_str())?;

        self.git_port.create_worktree(
            Path::new(&repo_path),
            Path::new(worktree),
            branch,
            create_branch,
        )?;

        if let Err(error) = copy_configured_worktree_files(
            Path::new(&repo_path),
            Path::new(worktree),
            repo_config.worktree_file_copies.as_slice(),
        ) {
            let cleanup_error = self.cleanup_failed_created_worktree(
                Path::new(&repo_path),
                Path::new(worktree),
                branch,
                create_branch,
            );
            return Err(anyhow!(
                "Configured worktree file copy failed: {error}{}",
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

        let normalized_repo = normalize_path_for_comparison(&repo_path);
        let normalized_worktree = normalize_path_for_comparison(worktree);
        if normalized_repo == normalized_worktree {
            return Err(anyhow!("worktree path cannot be the repository root"));
        }

        self.git_port
            .remove_worktree(Path::new(&repo_path), Path::new(worktree), force)?;
        Ok(true)
    }

    pub fn git_delete_local_branch(
        &self,
        repo_path: &str,
        branch: &str,
        force: bool,
    ) -> Result<bool> {
        let repo_path = self.resolve_authorized_repo_path(repo_path)?;
        let branch = branch.trim();
        if branch.is_empty() {
            return Err(anyhow!("branch cannot be empty"));
        }

        self.git_port
            .delete_local_branch(Path::new(&repo_path), branch, force)?;
        Ok(true)
    }

    pub fn git_push_branch(
        &self,
        repo_path: &str,
        working_dir: Option<&str>,
        remote: Option<&str>,
        branch: &str,
        set_upstream: bool,
        force_with_lease: bool,
    ) -> Result<GitPushResult> {
        let repo_path = self.resolve_authorized_repo_path(repo_path)?;
        let execution_path = resolve_execution_path(repo_path.as_str(), working_dir);
        let remote = remote
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("origin");
        self.git_port.push_branch(
            Path::new(&execution_path),
            remote,
            branch,
            set_upstream,
            force_with_lease,
        )
    }

    pub fn git_pull_branch(
        &self,
        repo_path: &str,
        request: GitPullRequest,
    ) -> Result<GitPullResult> {
        let repo_path = self.resolve_authorized_repo_path(repo_path)?;
        let execution_path =
            resolve_execution_path(repo_path.as_str(), request.working_dir.as_deref());
        self.git_port
            .pull_branch(Path::new(&execution_path), request)
    }

    pub fn git_commit_all(
        &self,
        repo_path: &str,
        request: GitCommitAllRequest,
    ) -> Result<GitCommitAllResult> {
        let repo_path = self.resolve_authorized_repo_path(repo_path)?;
        let execution_path =
            resolve_execution_path(repo_path.as_str(), request.working_dir.as_deref());
        let message = request.message.trim();
        if message.is_empty() {
            return Err(anyhow!("commit message cannot be empty"));
        }

        self.git_port.commit_all(
            Path::new(&execution_path),
            GitCommitAllRequest {
                working_dir: request.working_dir,
                message: message.to_string(),
            },
        )
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

    pub fn git_rebase_branch(
        &self,
        repo_path: &str,
        request: GitRebaseBranchRequest,
    ) -> Result<GitRebaseBranchResult> {
        let repo_path = self.resolve_authorized_repo_path(repo_path)?;
        let execution_path =
            resolve_execution_path(repo_path.as_str(), request.working_dir.as_deref());
        let target_branch = request.target_branch.trim();
        if target_branch.is_empty() {
            return Err(anyhow!("target branch cannot be empty"));
        }

        self.git_port.rebase_branch(
            Path::new(&execution_path),
            GitRebaseBranchRequest {
                working_dir: request.working_dir,
                target_branch: target_branch.to_string(),
            },
        )
    }

    pub fn git_rebase_abort(
        &self,
        repo_path: &str,
        request: GitRebaseAbortRequest,
    ) -> Result<GitRebaseAbortResult> {
        let repo_path = self.resolve_authorized_repo_path(repo_path)?;
        let execution_path =
            resolve_execution_path(repo_path.as_str(), request.working_dir.as_deref());

        self.git_port.rebase_abort(
            Path::new(&execution_path),
            GitRebaseAbortRequest {
                working_dir: request.working_dir,
            },
        )
    }

    pub fn git_abort_conflict(
        &self,
        repo_path: &str,
        request: GitConflictAbortRequest,
    ) -> Result<GitConflictAbortResult> {
        let repo_path = self.resolve_authorized_repo_path(repo_path)?;
        let execution_path =
            resolve_execution_path(repo_path.as_str(), request.working_dir.as_deref());

        self.git_port.abort_conflict(
            Path::new(&execution_path),
            GitConflictAbortRequest {
                operation: request.operation,
                working_dir: request.working_dir,
            },
        )
    }

    pub fn git_get_status(&self, repo_path: &str) -> Result<Vec<GitFileStatus>> {
        let repo_path = self.resolve_authorized_repo_path(repo_path)?;
        self.git_port.get_status(Path::new(&repo_path))
    }

    pub fn git_get_diff(
        &self,
        repo_path: &str,
        target_branch: Option<&str>,
    ) -> Result<Vec<GitFileDiff>> {
        let repo_path = self.resolve_authorized_repo_path(repo_path)?;
        self.git_port.get_diff(Path::new(&repo_path), target_branch)
    }

    pub fn git_commits_ahead_behind(
        &self,
        repo_path: &str,
        target_branch: &str,
    ) -> Result<GitAheadBehind> {
        let repo_path = self.resolve_authorized_repo_path(repo_path)?;
        self.git_port
            .commits_ahead_behind(Path::new(&repo_path), target_branch)
    }
}

fn probe_github_auth_status() -> (bool, Option<String>, Option<String>) {
    let result = run_command_allow_failure_with_env(
        "gh",
        &["auth", "status", "--hostname", "github.com"],
        None,
        &GH_NON_INTERACTIVE_ENV,
    );
    let Ok((ok, stdout, stderr)) = result else {
        return (
            false,
            None,
            Some("Failed to query GitHub authentication status.".to_string()),
        );
    };

    let combined = if stderr.trim().is_empty() {
        stdout.trim().to_string()
    } else if stdout.trim().is_empty() {
        stderr.trim().to_string()
    } else {
        format!("{}\n{}", stdout.trim(), stderr.trim())
    };

    if ok {
        return (true, parse_github_auth_login(combined.as_str()), None);
    }

    let detail = if combined.is_empty() {
        "GitHub authentication is not configured. Run `gh auth login`.".to_string()
    } else {
        combined
    };
    (false, None, Some(detail))
}

fn parse_github_auth_login(output: &str) -> Option<String> {
    let account_marker = "account ";
    let marker_index = output.find(account_marker)?;
    let login_start = marker_index + account_marker.len();
    let remainder = output.get(login_start..)?.trim_start();
    let login = remainder
        .split(|character: char| character.is_whitespace() || character == '(' || character == '\'')
        .next()
        .unwrap_or_default()
        .trim();
    if login.is_empty() {
        None
    } else {
        Some(login.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::super::CachedRuntimeCheck;
    use super::RUNTIME_CHECK_CACHE_TTL;
    use crate::app_service::test_support::{
        build_service_with_state, init_git_repo, unique_temp_path,
    };
    use host_domain::{
        GitConflictAbortRequest, GitConflictOperation, GitPushResult, RuntimeCheck, RuntimeHealth,
    };
    use host_infra_system::ChatSettings;
    use std::time::{Duration, Instant};

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
    fn module_git_push_branch_defaults_remote_to_origin() {
        let (service, _task_state, git_state) = build_service_with_state(vec![]);

        let result = service
            .git_push_branch(
                "/tmp/odt-repo-module",
                None,
                Some("   "),
                "feature/x",
                false,
                false,
            )
            .expect("push summary should be returned");

        match result {
            GitPushResult::Pushed { remote, .. } => assert_eq!(remote, "origin"),
            other => panic!("expected pushed result, got {other:?}"),
        }
        let state = git_state.lock().expect("git state lock poisoned");
        assert_eq!(state.last_push_remote.as_deref(), Some("origin"));
    }

    #[test]
    fn module_git_abort_conflict_forwards_operation_and_execution_path() {
        let (service, _task_state, git_state) = build_service_with_state(vec![]);

        let result = service
            .git_abort_conflict(
                "/tmp/odt-repo-module",
                GitConflictAbortRequest {
                    operation: GitConflictOperation::DirectMergeRebase,
                    working_dir: Some("/tmp/odt-repo-module/worktrees/task-1".to_string()),
                },
            )
            .expect("abort conflict should be forwarded");
        assert_eq!(result.output, "conflict aborted");

        let state = git_state.lock().expect("git state lock poisoned");
        assert!(state.calls.iter().any(|call| matches!(
            call,
            crate::app_service::test_support::GitCall::AbortConflict {
                repo_path,
                operation,
                working_dir,
            } if repo_path == "/tmp/odt-repo-module/worktrees/task-1"
                && *operation == GitConflictOperation::DirectMergeRebase
                && working_dir.as_deref() == Some("/tmp/odt-repo-module/worktrees/task-1")
        )));
    }

    #[test]
    fn module_runtime_check_returns_cached_value_when_fresh() {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let cached = RuntimeCheck {
            git_ok: false,
            git_version: Some("cached-git-sentinel".to_string()),
            gh_ok: false,
            gh_version: Some("cached-gh-sentinel".to_string()),
            gh_auth_ok: false,
            gh_auth_login: None,
            gh_auth_error: Some("cached-gh-auth-sentinel".to_string()),
            runtimes: vec![RuntimeHealth {
                kind: "opencode".to_string(),
                ok: false,
                version: Some("cached-opencode-sentinel".to_string()),
                error: None,
            }],
            errors: vec!["cached-runtime-sentinel".to_string()],
        };
        {
            let mut cache = service
                .runtime_check_cache
                .lock()
                .expect("runtime cache lock poisoned");
            *cache = Some(CachedRuntimeCheck {
                checked_at: Instant::now(),
                value: cached.clone(),
            });
        }

        let runtime = service
            .runtime_check()
            .expect("runtime check should use cached entry");
        assert_eq!(runtime.git_version, cached.git_version);
        assert_eq!(
            runtime
                .runtimes
                .iter()
                .find(|entry| entry.kind == "opencode")
                .and_then(|entry| entry.version.as_deref()),
            cached
                .runtimes
                .iter()
                .find(|entry| entry.kind == "opencode")
                .and_then(|entry| entry.version.as_deref())
        );
        assert_eq!(runtime.errors, cached.errors);
    }

    #[test]
    fn module_runtime_check_force_refresh_bypasses_cache() {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let sentinel_error = "cached-runtime-sentinel".to_string();
        {
            let mut cache = service
                .runtime_check_cache
                .lock()
                .expect("runtime cache lock poisoned");
            *cache = Some(CachedRuntimeCheck {
                checked_at: Instant::now(),
                value: RuntimeCheck {
                    git_ok: false,
                    git_version: Some("cached-git-sentinel".to_string()),
                    gh_ok: false,
                    gh_version: Some("cached-gh-sentinel".to_string()),
                    gh_auth_ok: false,
                    gh_auth_login: None,
                    gh_auth_error: Some("cached-gh-auth-sentinel".to_string()),
                    runtimes: vec![RuntimeHealth {
                        kind: "opencode".to_string(),
                        ok: false,
                        version: Some("cached-opencode-sentinel".to_string()),
                        error: None,
                    }],
                    errors: vec![sentinel_error.clone()],
                },
            });
        }

        let runtime = service
            .runtime_check_with_refresh(true)
            .expect("runtime check should bypass cache when forced");
        assert!(!runtime.errors.contains(&sentinel_error));
        assert_ne!(runtime.git_version.as_deref(), Some("cached-git-sentinel"));
        assert_ne!(
            runtime
                .runtimes
                .iter()
                .find(|entry| entry.kind == "opencode")
                .and_then(|entry| entry.version.as_deref()),
            Some("cached-opencode-sentinel")
        );
    }

    #[test]
    fn module_runtime_check_refreshes_when_cache_is_stale() {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let sentinel_error = "cached-runtime-sentinel".to_string();
        {
            let mut cache = service
                .runtime_check_cache
                .lock()
                .expect("runtime cache lock poisoned");
            *cache = Some(CachedRuntimeCheck {
                checked_at: Instant::now() - (RUNTIME_CHECK_CACHE_TTL + Duration::from_secs(1)),
                value: RuntimeCheck {
                    git_ok: false,
                    git_version: Some("cached-git-sentinel".to_string()),
                    gh_ok: false,
                    gh_version: Some("cached-gh-sentinel".to_string()),
                    gh_auth_ok: false,
                    gh_auth_login: None,
                    gh_auth_error: Some("cached-gh-auth-sentinel".to_string()),
                    runtimes: vec![RuntimeHealth {
                        kind: "opencode".to_string(),
                        ok: false,
                        version: Some("cached-opencode-sentinel".to_string()),
                        error: None,
                    }],
                    errors: vec![sentinel_error.clone()],
                },
            });
        }

        let runtime = service
            .runtime_check()
            .expect("runtime check should refresh stale cache entries");
        assert!(!runtime.errors.contains(&sentinel_error));
        assert_ne!(runtime.git_version.as_deref(), Some("cached-git-sentinel"));
        assert_ne!(
            runtime
                .runtimes
                .iter()
                .find(|entry| entry.kind == "opencode")
                .and_then(|entry| entry.version.as_deref()),
            Some("cached-opencode-sentinel")
        );
    }

    #[test]
    fn workspace_get_settings_snapshot_returns_defaulted_chat_settings() {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);

        let (_theme, _git, chat, kanban, repos, global_prompt_overrides) = service
            .workspace_get_settings_snapshot()
            .expect("settings snapshot should load");

        assert_eq!(chat, ChatSettings::default());
        assert!(!chat.show_thinking_messages);
        assert_eq!(kanban.done_visible_days, 1);
        assert!(repos.is_empty());
        assert!(global_prompt_overrides.is_empty());
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
            workspace.path,
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

        let workspace = service
            .workspace_select(repo_path.to_string_lossy().as_ref())
            .expect("workspace select should not fail on beads init");

        assert!(workspace.is_active);

        let state = task_state.lock().expect("task state lock poisoned");
        assert!(
            state.ensure_calls.is_empty(),
            "workspace select should not initialize beads"
        );
    }
}

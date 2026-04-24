use super::super::{
    run_parsed_hook_command_allow_failure, validate_hook_trust,
    validate_transition_without_related_tasks, AppService,
};
use crate::app_service::task_workflow::builder_branch_service::BuilderBranchService;
use anyhow::{anyhow, Context, Result};
use host_domain::{GitTargetBranch, TaskStatus};
use host_infra_system::{
    build_branch_name, copy_configured_worktree_files,
    resolve_effective_worktree_base_dir_for_workspace, run_command, RepoConfig,
};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn path_buf_to_utf8(path: PathBuf, context: &str) -> Result<String> {
    path.into_os_string().into_string().map_err(|value| {
        anyhow!(
            "{context}: path contains non-UTF-8 data ({})",
            PathBuf::from(value).display()
        )
    })
}

pub(super) struct BuildPrerequisites {
    pub(super) repo_path: String,
    pub(super) repo_config: RepoConfig,
    pub(super) target_branch: GitTargetBranch,
    pub(super) allow_local_branch_fallback: bool,
    pub(super) branch: String,
    pub(super) worktree_base: String,
}

pub(super) struct PreparedBuildWorktree {
    pub(super) worktree_dir: PathBuf,
}

struct BuildStartPoint {
    reference: String,
    upstream_remote: Option<String>,
}

#[derive(Default)]
struct BuildUpstreamSetup {
    created_tracking_ref: Option<String>,
}

fn git_reference_exists(repo_path_ref: &Path, reference: &str) -> Result<bool> {
    let status = Command::new("git")
        .args(["rev-parse", "--verify", "--quiet", reference])
        .current_dir(repo_path_ref)
        .status()
        .with_context(|| {
            format!(
                "Failed checking configured target branch {} in {}",
                reference,
                repo_path_ref.display()
            )
        })?;
    Ok(status.success())
}

fn resolve_build_start_point(
    repo_path_ref: &Path,
    target_branch: &GitTargetBranch,
    allow_local_branch_fallback: bool,
) -> Result<BuildStartPoint> {
    let configured_target_branch = target_branch.canonical();
    if git_reference_exists(repo_path_ref, configured_target_branch.as_str())? {
        return Ok(BuildStartPoint {
            reference: configured_target_branch,
            upstream_remote: target_branch.remote.clone(),
        });
    }

    if allow_local_branch_fallback {
        if let Some(local_branch) = configured_target_branch.strip_prefix("origin/") {
            if git_reference_exists(repo_path_ref, local_branch)? {
                return Ok(BuildStartPoint {
                    reference: local_branch.to_string(),
                    upstream_remote: None,
                });
            }
        }
    }

    Err(anyhow!(
        "Configured target branch is unavailable for build worktree creation: {}",
        configured_target_branch
    ))
}

fn configure_build_worktree_upstream(
    repo_path_ref: &Path,
    worktree_dir: &Path,
    branch: &str,
    upstream_remote: Option<&str>,
) -> Result<BuildUpstreamSetup> {
    let Some(remote) = upstream_remote else {
        return Ok(BuildUpstreamSetup::default());
    };

    let branch_remote_key = format!("branch.{branch}.remote");
    let branch_merge_key = format!("branch.{branch}.merge");
    let local_branch_ref = format!("refs/heads/{branch}");
    let tracking_ref = format!("refs/remotes/{remote}/{branch}");
    let expected_upstream = format!("{remote}/{branch}");

    run_command(
        "git",
        &["config", branch_remote_key.as_str(), remote],
        Some(repo_path_ref),
    )?;
    if let Err(error) = run_command(
        "git",
        &[
            "config",
            branch_merge_key.as_str(),
            local_branch_ref.as_str(),
        ],
        Some(repo_path_ref),
    ) {
        let cleanup_error =
            cleanup_failed_upstream_branch_config(repo_path_ref, branch_remote_key.as_str(), None);
        return Err(anyhow!(
            "Failed configuring upstream merge for build worktree branch {branch}: {error}{cleanup_error}"
        ));
    }

    let tracking_ref_already_exists = git_reference_exists(repo_path_ref, tracking_ref.as_str())?;
    let created_tracking_ref = !tracking_ref_already_exists;
    if created_tracking_ref {
        // Git stores upstream config independently, but `@{upstream}` only resolves
        // when the matching tracking ref exists. Seed the local tracking ref without
        // publishing remote state so later generic push flows target the task branch.
        if let Err(error) = run_command(
            "git",
            &[
                "update-ref",
                tracking_ref.as_str(),
                local_branch_ref.as_str(),
            ],
            Some(repo_path_ref),
        ) {
            let cleanup_error = cleanup_failed_upstream_setup(
                repo_path_ref,
                branch_remote_key.as_str(),
                branch_merge_key.as_str(),
                None,
            );
            return Err(anyhow!(
                "Failed creating upstream tracking ref {tracking_ref} for build worktree branch {branch}: {error}{cleanup_error}"
            ));
        }
    }

    let resolved_upstream = match run_command(
        "git",
        &[
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
        ],
        Some(worktree_dir),
    ) {
        Ok(upstream) => upstream,
        Err(error) => {
            let cleanup_error = cleanup_failed_upstream_setup(
                repo_path_ref,
                branch_remote_key.as_str(),
                branch_merge_key.as_str(),
                created_tracking_ref.then_some(tracking_ref.as_str()),
            );
            return Err(anyhow!(
                "Failed verifying upstream tracking for build worktree branch {branch}: {error}{cleanup_error}"
            ));
        }
    };
    if resolved_upstream != expected_upstream {
        let cleanup_error = cleanup_failed_upstream_setup(
            repo_path_ref,
            branch_remote_key.as_str(),
            branch_merge_key.as_str(),
            created_tracking_ref.then_some(tracking_ref.as_str()),
        );
        return Err(anyhow!(
            "configured upstream resolved to {resolved_upstream}, expected {expected_upstream}{cleanup_error}"
        ));
    }

    Ok(BuildUpstreamSetup {
        created_tracking_ref: created_tracking_ref.then_some(tracking_ref),
    })
}

fn cleanup_failed_upstream_setup(
    repo_path_ref: &Path,
    branch_remote_key: &str,
    branch_merge_key: &str,
    created_tracking_ref: Option<&str>,
) -> String {
    let mut cleanup_errors = Vec::new();
    if let Some(tracking_ref) = created_tracking_ref {
        if let Err(error) = run_command(
            "git",
            &["update-ref", "-d", tracking_ref],
            Some(repo_path_ref),
        ) {
            cleanup_errors.push(format!(
                "Also failed to delete created upstream tracking ref {tracking_ref}: {error}"
            ));
        }
    }

    collect_failed_upstream_branch_config_cleanup(
        repo_path_ref,
        branch_remote_key,
        Some(branch_merge_key),
        &mut cleanup_errors,
    );
    format_cleanup_errors(cleanup_errors)
}

fn cleanup_failed_upstream_branch_config(
    repo_path_ref: &Path,
    branch_remote_key: &str,
    branch_merge_key: Option<&str>,
) -> String {
    let mut cleanup_errors = Vec::new();
    collect_failed_upstream_branch_config_cleanup(
        repo_path_ref,
        branch_remote_key,
        branch_merge_key,
        &mut cleanup_errors,
    );
    format_cleanup_errors(cleanup_errors)
}

fn collect_failed_upstream_branch_config_cleanup(
    repo_path_ref: &Path,
    branch_remote_key: &str,
    branch_merge_key: Option<&str>,
    cleanup_errors: &mut Vec<String>,
) {
    for key in [Some(branch_remote_key), branch_merge_key]
        .into_iter()
        .flatten()
    {
        if let Err(error) = run_command("git", &["config", "--unset-all", key], Some(repo_path_ref))
        {
            cleanup_errors.push(format!("Also failed to unset git config {key}: {error}"));
        }
    }
}

fn format_cleanup_errors(cleanup_errors: Vec<String>) -> String {
    if cleanup_errors.is_empty() {
        String::new()
    } else {
        format!("\n{}", cleanup_errors.join("\n"))
    }
}

impl AppService {
    pub(super) fn validate_build_prerequisites(
        &self,
        repo_path: &str,
        task_id: &str,
    ) -> Result<BuildPrerequisites> {
        let repo_path = self.resolve_initialized_repo_path(repo_path)?;
        let repo_path = repo_path.as_str().to_string();
        let repo_config = self.workspace_get_repo_config_by_repo_path(repo_path.as_str())?;

        let worktree_base = resolve_effective_worktree_base_dir_for_workspace(
            repo_config.workspace_id.as_str(),
            repo_config.worktree_base_path.as_deref(),
        )
        .with_context(|| {
            format!(
                "Build blocked: unable to resolve effective worktree base path for workspace {} ({repo_path}). Ensure HOME is set or configure workspaces.{}.worktreeBasePath in {}",
                repo_config.workspace_id,
                repo_config.workspace_id,
                self.config_store.path().display()
            )
        })
        .and_then(|path| {
            path_buf_to_utf8(
                path,
                &format!(
                    "Build blocked: effective worktree base path must be valid UTF-8 for workspace {} ({repo_path}). Ensure HOME is set or configure workspaces.{}.worktreeBasePath in {}",
                    repo_config.workspace_id,
                    repo_config.workspace_id,
                    self.config_store.path().display()
                ),
            )
        })?;

        validate_hook_trust(repo_path.as_str(), &repo_config)?;

        let task = self
            .task_store
            .get_task(Path::new(repo_path.as_str()), task_id)?;
        validate_transition_without_related_tasks(&task, &task.status, &TaskStatus::InProgress)?;

        let branch = build_branch_name(&repo_config.branch_prefix, task_id, &task.title);
        let resolved_target_branch = BuilderBranchService::new(self)
            .resolve_target_branch_for_task(repo_path.as_str(), task_id)?;

        Ok(BuildPrerequisites {
            repo_path,
            repo_config,
            target_branch: resolved_target_branch.target_branch,
            allow_local_branch_fallback: !resolved_target_branch.has_task_override,
            branch,
            worktree_base,
        })
    }

    pub(super) fn prepare_build_worktree(
        &self,
        prerequisites: &BuildPrerequisites,
        task_id: &str,
    ) -> Result<PreparedBuildWorktree> {
        let worktree_dir = Path::new(prerequisites.worktree_base.as_str()).join(task_id);
        fs::create_dir_all(Path::new(prerequisites.worktree_base.as_str())).with_context(|| {
            format!(
                "Failed creating worktree base directory {}",
                Path::new(prerequisites.worktree_base.as_str()).display()
            )
        })?;

        if worktree_dir.exists() {
            return Err(anyhow!(
                "Worktree path already exists for task {}: {}",
                task_id,
                worktree_dir.display()
            ));
        }

        let repo_path_ref = Path::new(prerequisites.repo_path.as_str());
        let start_point = resolve_build_start_point(
            repo_path_ref,
            &prerequisites.target_branch,
            prerequisites.allow_local_branch_fallback,
        )?;
        host_infra_system::run_command(
            "git",
            &[
                "worktree",
                "add",
                "-b",
                prerequisites.branch.as_str(),
                worktree_dir
                    .to_str()
                    .ok_or_else(|| anyhow!("Invalid worktree path"))?,
                start_point.reference.as_str(),
            ],
            Some(repo_path_ref),
        )?;

        let upstream_setup = match configure_build_worktree_upstream(
            repo_path_ref,
            worktree_dir.as_path(),
            prerequisites.branch.as_str(),
            start_point.upstream_remote.as_deref(),
        ) {
            Ok(setup) => setup,
            Err(error) => {
                // Upstream setup removes any tracking ref and branch config it creates before
                // returning an error, so rollback only needs to remove the worktree and branch.
                let cleanup_error = self.rollback_failed_build_worktree(
                    repo_path_ref,
                    worktree_dir.as_path(),
                    prerequisites.branch.as_str(),
                    None,
                );
                return Err(anyhow!(
                    "Failed configuring upstream tracking for build worktree branch {}: {error}{}",
                    prerequisites.branch,
                    cleanup_error
                ));
            }
        };

        if let Err(error) = copy_configured_worktree_files(
            repo_path_ref,
            worktree_dir.as_path(),
            prerequisites.repo_config.worktree_file_copies.as_slice(),
        ) {
            let cleanup_error = self.rollback_failed_build_worktree(
                repo_path_ref,
                worktree_dir.as_path(),
                prerequisites.branch.as_str(),
                upstream_setup.created_tracking_ref.as_deref(),
            );
            return Err(anyhow!(
                "Configured worktree file copy failed: {error}{}",
                cleanup_error
            ));
        }

        self.run_pre_start_hooks(
            prerequisites,
            repo_path_ref,
            worktree_dir.as_path(),
            upstream_setup.created_tracking_ref.as_deref(),
            task_id,
        )?;

        Ok(PreparedBuildWorktree { worktree_dir })
    }

    fn run_pre_start_hooks(
        &self,
        prerequisites: &BuildPrerequisites,
        repo_path_ref: &Path,
        worktree_dir: &Path,
        created_tracking_ref: Option<&str>,
        _task_id: &str,
    ) -> Result<()> {
        for hook in &prerequisites.repo_config.hooks.pre_start {
            let (ok, _stdout, stderr) = run_parsed_hook_command_allow_failure(hook, worktree_dir);
            if !ok {
                let cleanup_error = self.rollback_failed_build_worktree(
                    repo_path_ref,
                    worktree_dir,
                    prerequisites.branch.as_str(),
                    created_tracking_ref,
                );
                return Err(anyhow!(
                    "Worktree setup script command failed: {hook}\n{stderr}{}",
                    cleanup_error
                ));
            }
        }
        Ok(())
    }

    fn rollback_failed_build_worktree(
        &self,
        repo_path_ref: &Path,
        worktree_dir: &Path,
        branch: &str,
        created_tracking_ref: Option<&str>,
    ) -> String {
        let mut cleanup_errors = Vec::new();

        if let Some(tracking_ref) = created_tracking_ref {
            if let Err(error) = run_command(
                "git",
                &["update-ref", "-d", tracking_ref],
                Some(repo_path_ref),
            ) {
                cleanup_errors.push(format!(
                    "Also failed to delete created upstream tracking ref {tracking_ref}: {error}"
                ));
            }
        }
        let worktree_dir_string = match worktree_dir.to_str() {
            Some(value) => value,
            None => {
                cleanup_errors.push(format!(
                    "Also failed to remove worktree: path contains non-UTF-8 data ({})",
                    worktree_dir.display()
                ));
                ""
            }
        };
        if !worktree_dir_string.is_empty() {
            if let Err(error) = run_command(
                "git",
                &[
                    "worktree",
                    "remove",
                    "--force",
                    "--end-of-options",
                    worktree_dir_string,
                ],
                Some(repo_path_ref),
            ) {
                cleanup_errors.push(format!("Also failed to remove worktree: {error}"));
            }
        }
        if let Err(error) = run_command(
            "git",
            &["worktree", "prune", "--expire", "now"],
            Some(repo_path_ref),
        ) {
            cleanup_errors.push(format!("Also failed to prune worktree metadata: {error}"));
        }
        if let Err(error) = run_command(
            "git",
            &["branch", "-D", "--end-of-options", branch],
            Some(repo_path_ref),
        ) {
            cleanup_errors.push(format!(
                "Also failed to delete created branch {branch}: {error}"
            ));
        }

        format_cleanup_errors(cleanup_errors)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app_service::test_support::{
        build_service_with_store, init_git_repo, make_task, unique_temp_path,
    };
    use host_domain::GitCurrentBranch;
    use host_infra_system::AppConfigStore;

    fn run_git(repo_path: &Path, args: &[&str]) -> Result<String> {
        let output = Command::new("git")
            .current_dir(repo_path)
            .args(args)
            .output()
            .with_context(|| {
                format!(
                    "failed running git in {} with args {:?}",
                    repo_path.display(),
                    args
                )
            })?;
        if output.status.success() {
            return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
        }

        Err(anyhow!(
            "git {:?} failed in {} with status {}\n{}",
            args,
            repo_path.display(),
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }

    fn run_git_success(repo_path: &Path, args: &[&str]) -> Result<()> {
        run_git(repo_path, args).map(|_| ())
    }

    fn add_bare_remote(root: &Path, repo_path: &Path, remote_name: &str) -> Result<()> {
        fs::create_dir_all(root)?;
        let remote_dir = root.join(format!("{remote_name}.git"));
        let remote_dir_string = remote_dir.to_string_lossy().to_string();
        run_git_success(root, &["init", "--bare", remote_dir_string.as_str()])?;
        run_git_success(
            repo_path,
            &["remote", "add", remote_name, remote_dir_string.as_str()],
        )
    }

    fn git_config_value(repo_path: &Path, key: &str) -> Result<Option<String>> {
        let output = Command::new("git")
            .current_dir(repo_path)
            .args(["config", "--get", key])
            .output()
            .with_context(|| {
                format!("failed reading git config {key} in {}", repo_path.display())
            })?;
        if output.status.success() {
            return Ok(Some(
                String::from_utf8_lossy(&output.stdout).trim().to_string(),
            ));
        }
        Ok(None)
    }

    fn current_upstream(worktree_path: &Path) -> Result<String> {
        run_git(
            worktree_path,
            &[
                "rev-parse",
                "--abbrev-ref",
                "--symbolic-full-name",
                "@{upstream}",
            ],
        )
    }

    fn create_branch_with_commit(repo_path: &Path, branch: &str, file_name: &str) -> Result<()> {
        run_git_success(repo_path, &["checkout", "-b", branch])?;
        fs::write(repo_path.join(file_name), format!("{branch}\n"))?;
        run_git_success(repo_path, &["add", file_name])?;
        run_git_success(repo_path, &["commit", "-m", branch])
    }

    #[test]
    fn resolve_start_point_preserves_remote_for_available_remote_target() -> Result<()> {
        let root = unique_temp_path("build-start-remote-target");
        let repo = root.join("repo");
        init_git_repo(repo.as_path())?;
        add_bare_remote(root.as_path(), repo.as_path(), "upstream")?;
        create_branch_with_commit(repo.as_path(), "release", "release.txt")?;
        run_git_success(
            repo.as_path(),
            &["update-ref", "refs/remotes/upstream/release", "release"],
        )?;

        let start_point = resolve_build_start_point(
            repo.as_path(),
            &GitTargetBranch {
                remote: Some("upstream".to_string()),
                branch: "release".to_string(),
            },
            false,
        )?;

        assert_eq!(start_point.reference, "upstream/release");
        assert_eq!(start_point.upstream_remote.as_deref(), Some("upstream"));

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn resolve_start_point_does_not_guess_upstream_when_default_origin_falls_back_to_local_branch(
    ) -> Result<()> {
        let root = unique_temp_path("build-start-local-fallback");
        let repo = root.join("repo");
        init_git_repo(repo.as_path())?;
        create_branch_with_commit(repo.as_path(), "develop", "develop.txt")?;

        let start_point = resolve_build_start_point(
            repo.as_path(),
            &GitTargetBranch {
                remote: Some("origin".to_string()),
                branch: "develop".to_string(),
            },
            true,
        )?;

        assert_eq!(start_point.reference, "develop");
        assert_eq!(start_point.upstream_remote, None);

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn configure_build_worktree_upstream_tracks_same_task_branch_on_target_remote() -> Result<()> {
        let root = unique_temp_path("build-upstream-remote-task-branch");
        let repo = root.join("repo");
        let worktree = root.join("worktree");
        init_git_repo(repo.as_path())?;
        add_bare_remote(root.as_path(), repo.as_path(), "upstream")?;
        create_branch_with_commit(repo.as_path(), "release", "release.txt")?;
        run_git_success(
            repo.as_path(),
            &["update-ref", "refs/remotes/upstream/release", "release"],
        )?;
        run_git_success(
            repo.as_path(),
            &[
                "worktree",
                "add",
                "-b",
                "odt/task-1",
                worktree
                    .to_str()
                    .ok_or_else(|| anyhow!("Invalid worktree path"))?,
                "upstream/release",
            ],
        )?;

        let setup = configure_build_worktree_upstream(
            repo.as_path(),
            worktree.as_path(),
            "odt/task-1",
            Some("upstream"),
        )?;

        assert_eq!(current_upstream(worktree.as_path())?, "upstream/odt/task-1");
        assert_eq!(
            setup.created_tracking_ref.as_deref(),
            Some("refs/remotes/upstream/odt/task-1")
        );
        assert_eq!(
            git_config_value(repo.as_path(), "branch.odt/task-1.remote")?.as_deref(),
            Some("upstream")
        );
        assert_eq!(
            git_config_value(repo.as_path(), "branch.odt/task-1.merge")?.as_deref(),
            Some("refs/heads/odt/task-1")
        );
        assert_ne!(current_upstream(worktree.as_path())?, "upstream/release");

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn configure_build_worktree_upstream_leaves_local_only_target_without_upstream() -> Result<()> {
        let root = unique_temp_path("build-upstream-local-only");
        let repo = root.join("repo");
        let worktree = root.join("worktree");
        init_git_repo(repo.as_path())?;
        create_branch_with_commit(repo.as_path(), "develop", "develop.txt")?;
        run_git_success(
            repo.as_path(),
            &[
                "worktree",
                "add",
                "-b",
                "odt/task-1",
                worktree
                    .to_str()
                    .ok_or_else(|| anyhow!("Invalid worktree path"))?,
                "develop",
            ],
        )?;

        let setup = configure_build_worktree_upstream(
            repo.as_path(),
            worktree.as_path(),
            "odt/task-1",
            None,
        )?;

        assert_eq!(setup.created_tracking_ref, None);
        assert!(current_upstream(worktree.as_path()).is_err());
        assert_eq!(
            git_config_value(repo.as_path(), "branch.odt/task-1.remote")?,
            None
        );
        assert_eq!(
            git_config_value(repo.as_path(), "branch.odt/task-1.merge")?,
            None
        );

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn prepare_build_worktree_rolls_back_when_required_upstream_setup_fails() -> Result<()> {
        let root = unique_temp_path("build-upstream-failure-cleanup");
        let repo = root.join("repo");
        let worktree_base = root.join("worktrees");
        init_git_repo(repo.as_path())?;
        create_branch_with_commit(repo.as_path(), "release", "release.txt")?;
        run_git_success(
            repo.as_path(),
            &["update-ref", "refs/remotes/upstream/release", "release"],
        )?;

        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let (service, _task_state, _git_state) = build_service_with_store(
            vec![make_task("task-1", "bug", TaskStatus::Open)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
                revision: None,
            },
            config_store,
        );
        let prerequisites = BuildPrerequisites {
            repo_path: repo.to_string_lossy().to_string(),
            repo_config: RepoConfig::default(),
            target_branch: GitTargetBranch {
                remote: Some("upstream".to_string()),
                branch: "release".to_string(),
            },
            allow_local_branch_fallback: false,
            branch: "odt/task-1".to_string(),
            worktree_base: worktree_base.to_string_lossy().to_string(),
        };

        let error = match service.prepare_build_worktree(&prerequisites, "task-1") {
            Ok(_) => {
                return Err(anyhow!(
                    "missing remote config should fail upstream verification"
                ))
            }
            Err(error) => error,
        };
        let error_message = error.to_string();

        assert!(error_message
            .contains("Failed configuring upstream tracking for build worktree branch odt/task-1"));
        assert!(error_message
            .contains("Failed verifying upstream tracking for build worktree branch odt/task-1"));
        assert!(!worktree_base.join("task-1").exists());
        assert!(!git_reference_exists(
            repo.as_path(),
            "refs/heads/odt/task-1"
        )?);
        assert!(!git_reference_exists(
            repo.as_path(),
            "refs/remotes/upstream/odt/task-1"
        )?);
        assert_eq!(
            git_config_value(repo.as_path(), "branch.odt/task-1.remote")?,
            None
        );
        assert_eq!(
            git_config_value(repo.as_path(), "branch.odt/task-1.merge")?,
            None
        );

        let _ = fs::remove_dir_all(root);
        Ok(())
    }
}

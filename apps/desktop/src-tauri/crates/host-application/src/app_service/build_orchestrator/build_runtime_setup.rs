use super::super::{
    run_parsed_hook_command_allow_failure, spawn_opencode_server, terminate_child_process,
    validate_hook_trust, validate_transition, wait_for_local_server_with_process, AppService,
    OpencodeStartupReadinessPolicy, OpencodeStartupWaitReport, StartupEventCorrelation,
    StartupEventPayload, TrackedOpencodeProcessGuard,
};
use anyhow::{anyhow, Context, Result};
use host_domain::{TaskStatus, TASK_METADATA_NAMESPACE};
use host_infra_system::{build_branch_name, pick_free_port, remove_worktree, RepoConfig};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Child;

pub(super) struct BuildPrerequisites {
    pub(super) repo_path: String,
    pub(super) repo_config: RepoConfig,
    pub(super) branch: String,
    pub(super) worktree_base: String,
}

pub(super) struct PreparedBuildWorktree {
    pub(super) worktree_dir: PathBuf,
}

pub(super) struct SpawnedBuildAgent {
    pub(super) child: Child,
    pub(super) opencode_process_guard: TrackedOpencodeProcessGuard,
    pub(super) port: u16,
}

struct BuildRuntimeFailureEvent<'a> {
    repo_path: &'a str,
    task_id: &'a str,
    run_id: &'a str,
    port: u16,
    startup_policy: OpencodeStartupReadinessPolicy,
    startup_report: OpencodeStartupWaitReport,
    reason: &'static str,
}

impl AppService {
    pub(super) fn validate_build_prerequisites(
        &self,
        repo_path: &str,
        task_id: &str,
    ) -> Result<BuildPrerequisites> {
        let repo_path = self.resolve_initialized_repo_path(repo_path)?;
        let repo_path = repo_path.as_str().to_string();
        let repo_config = self.config_store.repo_config(repo_path.as_str())?;

        let worktree_base = repo_config.worktree_base_path.clone().ok_or_else(|| {
            anyhow!(
                "Build blocked: configure repos.{repo_path}.worktreeBasePath in {}",
                self.config_store.path().display()
            )
        })?;

        validate_hook_trust(repo_path.as_str(), &repo_config)?;

        let tasks = self.task_store.list_tasks(Path::new(repo_path.as_str()))?;
        let task = tasks
            .iter()
            .find(|entry| entry.id == task_id)
            .cloned()
            .ok_or_else(|| anyhow!("Task not found: {task_id}"))?;
        validate_transition(&task, &tasks, &task.status, &TaskStatus::InProgress)?;

        let branch = build_branch_name(&repo_config.branch_prefix, task_id, &task.title);

        Ok(BuildPrerequisites {
            repo_path,
            repo_config,
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
        host_infra_system::run_command(
            "git",
            &[
                "worktree",
                "add",
                worktree_dir
                    .to_str()
                    .ok_or_else(|| anyhow!("Invalid worktree path"))?,
                "-b",
                prerequisites.branch.as_str(),
            ],
            Some(repo_path_ref),
        )?;

        self.run_pre_start_hooks(
            prerequisites,
            repo_path_ref,
            worktree_dir.as_path(),
            task_id,
        )?;

        Ok(PreparedBuildWorktree { worktree_dir })
    }

    fn run_pre_start_hooks(
        &self,
        prerequisites: &BuildPrerequisites,
        repo_path_ref: &Path,
        worktree_dir: &Path,
        task_id: &str,
    ) -> Result<()> {
        for hook in &prerequisites.repo_config.hooks.pre_start {
            let (ok, _stdout, stderr) = run_parsed_hook_command_allow_failure(hook, worktree_dir);
            if !ok {
                let _ = self.task_transition(
                    prerequisites.repo_path.as_str(),
                    task_id,
                    TaskStatus::Blocked,
                    Some("Pre-start hook failed"),
                );
                let cleanup_error = remove_worktree(repo_path_ref, worktree_dir)
                    .err()
                    .map(|error| error.to_string());
                return Err(anyhow!(
                    "Pre-start hook failed: {hook}\n{stderr}{}",
                    cleanup_error
                        .map(|error| format!("\nAlso failed to remove worktree: {error}"))
                        .unwrap_or_default()
                ));
            }
        }
        Ok(())
    }

    pub(super) fn spawn_and_wait_for_agent(
        &self,
        prerequisites: &BuildPrerequisites,
        prepared_worktree: &PreparedBuildWorktree,
        task_id: &str,
        run_id: &str,
        startup_policy: OpencodeStartupReadinessPolicy,
    ) -> Result<SpawnedBuildAgent> {
        let mut spawned_agent = self.spawn_build_agent_process(prerequisites, prepared_worktree)?;
        if let Err(error) = self.wait_for_build_agent_readiness(
            &mut spawned_agent,
            prerequisites.repo_path.as_str(),
            task_id,
            run_id,
            startup_policy,
        ) {
            terminate_child_process(&mut spawned_agent.child);
            return Err(error);
        }
        Ok(spawned_agent)
    }

    fn spawn_build_agent_process(
        &self,
        prerequisites: &BuildPrerequisites,
        prepared_worktree: &PreparedBuildWorktree,
    ) -> Result<SpawnedBuildAgent> {
        let port = pick_free_port()?;
        let mut child = spawn_opencode_server(
            prepared_worktree.worktree_dir.as_path(),
            Path::new(prerequisites.repo_path.as_str()),
            TASK_METADATA_NAMESPACE,
            port,
        )?;
        let opencode_process_guard = match self.track_pending_opencode_process(child.id()) {
            Ok(guard) => guard,
            Err(error) => {
                terminate_child_process(&mut child);
                return Err(error).context("Failed tracking spawned OpenCode build process");
            }
        };

        Ok(SpawnedBuildAgent {
            child,
            opencode_process_guard,
            port,
        })
    }

    fn wait_for_build_agent_readiness(
        &self,
        spawned_agent: &mut SpawnedBuildAgent,
        repo_path: &str,
        task_id: &str,
        run_id: &str,
        startup_policy: OpencodeStartupReadinessPolicy,
    ) -> Result<()> {
        let startup_cancel_epoch = self.startup_cancel_epoch();
        let startup_cancel_snapshot = self.startup_cancel_snapshot();
        self.emit_build_runtime_wait_begin(
            repo_path,
            task_id,
            run_id,
            spawned_agent.port,
            startup_policy,
        );

        let startup_report = match wait_for_local_server_with_process(
            &mut spawned_agent.child,
            spawned_agent.port,
            startup_policy,
            &startup_cancel_epoch,
            startup_cancel_snapshot,
        ) {
            Ok(report) => report,
            Err(error) => {
                self.emit_build_runtime_failed(BuildRuntimeFailureEvent {
                    repo_path,
                    task_id,
                    run_id,
                    port: spawned_agent.port,
                    startup_policy,
                    startup_report: error.report,
                    reason: error.reason,
                });
                return Err(anyhow!(error)).with_context(|| {
                    format!("OpenCode build runtime failed to start for task {task_id}")
                });
            }
        };

        self.emit_build_runtime_ready(
            repo_path,
            task_id,
            run_id,
            spawned_agent.port,
            startup_policy,
            startup_report,
        );
        Ok(())
    }

    fn emit_build_runtime_wait_begin(
        &self,
        repo_path: &str,
        task_id: &str,
        run_id: &str,
        port: u16,
        startup_policy: OpencodeStartupReadinessPolicy,
    ) {
        self.emit_opencode_startup_event(StartupEventPayload::wait_begin(
            "build_runtime",
            repo_path,
            Some(task_id),
            "build",
            port,
            Some(StartupEventCorrelation::new("run_id", run_id)),
            Some(startup_policy),
        ));
    }

    fn emit_build_runtime_failed(&self, failure: BuildRuntimeFailureEvent<'_>) {
        self.emit_opencode_startup_event(StartupEventPayload::failed(
            "build_runtime",
            failure.repo_path,
            Some(failure.task_id),
            "build",
            failure.port,
            Some(StartupEventCorrelation::new("run_id", failure.run_id)),
            Some(failure.startup_policy),
            failure.startup_report,
            failure.reason,
        ));
    }

    fn emit_build_runtime_ready(
        &self,
        repo_path: &str,
        task_id: &str,
        run_id: &str,
        port: u16,
        startup_policy: OpencodeStartupReadinessPolicy,
        startup_report: OpencodeStartupWaitReport,
    ) {
        self.emit_opencode_startup_event(StartupEventPayload::ready(
            "build_runtime",
            repo_path,
            Some(task_id),
            "build",
            port,
            Some(StartupEventCorrelation::new("run_id", run_id)),
            Some(startup_policy),
            startup_report,
        ));
    }
}

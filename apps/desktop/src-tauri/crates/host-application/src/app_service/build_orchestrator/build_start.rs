use super::super::{
    emit_event, run_parsed_hook_command_allow_failure, spawn_opencode_server,
    spawn_output_forwarder, terminate_child_process, validate_hook_trust, validate_transition,
    wait_for_local_server_with_process, AppService, OpencodeStartupReadinessPolicy,
    OpencodeStartupWaitReport, RunEmitter, RunProcess, StartupEventCorrelation,
    StartupEventPayload, TrackedOpencodeProcessGuard,
};
use anyhow::{anyhow, Context, Result};
use host_domain::{now_rfc3339, RunEvent, RunState, RunSummary, TaskStatus};
use host_infra_system::{build_branch_name, pick_free_port, remove_worktree, RepoConfig};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStderr, ChildStdout};
use uuid::Uuid;

struct BuildPrerequisites {
    repo_path: String,
    repo_config: RepoConfig,
    branch: String,
    worktree_base: String,
}

struct PreparedBuildWorktree {
    worktree_dir: PathBuf,
}

struct SpawnedBuildAgent {
    child: Child,
    opencode_process_guard: TrackedOpencodeProcessGuard,
    port: u16,
}

impl AppService {
    pub fn build_start(
        &self,
        repo_path: &str,
        task_id: &str,
        emitter: RunEmitter,
    ) -> Result<RunSummary> {
        let run_id = format!("run-{}", Uuid::new_v4().simple());
        let prerequisites = self.validate_build_prerequisites(repo_path, task_id)?;
        let prepared_worktree = self.prepare_build_worktree(&prerequisites, task_id)?;
        let spawned_agent = self.spawn_and_wait_for_agent(
            &prerequisites,
            &prepared_worktree,
            task_id,
            run_id.as_str(),
        )?;
        self.initiate_build_mode(
            prerequisites,
            prepared_worktree,
            spawned_agent,
            task_id,
            run_id.as_str(),
            emitter,
        )
    }

    fn validate_build_prerequisites(
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

    fn prepare_build_worktree(
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

    fn spawn_and_wait_for_agent(
        &self,
        prerequisites: &BuildPrerequisites,
        prepared_worktree: &PreparedBuildWorktree,
        task_id: &str,
        run_id: &str,
    ) -> Result<SpawnedBuildAgent> {
        let mut spawned_agent = self.spawn_build_agent_process(prerequisites, prepared_worktree)?;
        if let Err(error) = self.wait_for_build_agent_readiness(
            &mut spawned_agent,
            prerequisites.repo_path.as_str(),
            task_id,
            run_id,
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
        let metadata_namespace = self.config_store.task_metadata_namespace()?;
        let mut child = spawn_opencode_server(
            prepared_worktree.worktree_dir.as_path(),
            Path::new(prerequisites.repo_path.as_str()),
            metadata_namespace.as_str(),
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
    ) -> Result<()> {
        let startup_policy = self.opencode_startup_readiness_policy();
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
                self.emit_build_runtime_failed(
                    repo_path,
                    task_id,
                    run_id,
                    spawned_agent.port,
                    startup_policy,
                    error.report,
                    error.reason,
                );
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

    fn emit_build_runtime_failed(
        &self,
        repo_path: &str,
        task_id: &str,
        run_id: &str,
        port: u16,
        startup_policy: OpencodeStartupReadinessPolicy,
        startup_report: OpencodeStartupWaitReport,
        reason: &'static str,
    ) {
        self.emit_opencode_startup_event(StartupEventPayload::failed(
            "build_runtime",
            repo_path,
            Some(task_id),
            "build",
            port,
            Some(StartupEventCorrelation::new("run_id", run_id)),
            Some(startup_policy),
            startup_report,
            reason,
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

    fn abort_started_build<T>(
        spawned_agent: &mut SpawnedBuildAgent,
        error: anyhow::Error,
    ) -> Result<T> {
        terminate_child_process(&mut spawned_agent.child);
        Err(error)
    }

    fn emit_build_started_and_forward_output(
        run_id: &str,
        task_id: &str,
        branch: &str,
        stdout: Option<ChildStdout>,
        stderr: Option<ChildStderr>,
        emitter: RunEmitter,
    ) {
        emit_event(
            &emitter,
            RunEvent::RunStarted {
                run_id: run_id.to_string(),
                message: format!("Delegated task {} on branch {}", task_id, branch),
                timestamp: now_rfc3339(),
            },
        );

        if let Some(stdout) = stdout {
            spawn_output_forwarder(run_id.to_string(), "stdout", stdout, emitter.clone());
        }
        if let Some(stderr) = stderr {
            spawn_output_forwarder(run_id.to_string(), "stderr", stderr, emitter.clone());
        }
    }

    fn register_build_run(
        &self,
        run_id: &str,
        summary: RunSummary,
        prerequisites: BuildPrerequisites,
        task_id: &str,
        worktree_path: String,
        spawned_agent: SpawnedBuildAgent,
        emitter: RunEmitter,
    ) -> Result<RunSummary> {
        let SpawnedBuildAgent {
            mut child,
            opencode_process_guard,
            ..
        } = spawned_agent;
        let mut runs = match self.runs.lock() {
            Ok(runs) => runs,
            Err(_) => {
                terminate_child_process(&mut child);
                return Err(anyhow!("Run state lock poisoned"));
            }
        };

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let process = RunProcess {
            summary: summary.clone(),
            child,
            _opencode_process_guard: Some(opencode_process_guard),
            repo_path: prerequisites.repo_path,
            task_id: task_id.to_string(),
            worktree_path: worktree_path.clone(),
            repo_config: prerequisites.repo_config,
        };

        runs.insert(run_id.to_string(), process);
        drop(runs);
        Self::emit_build_started_and_forward_output(
            run_id,
            task_id,
            summary.branch.as_str(),
            stdout,
            stderr,
            emitter,
        );
        Ok(summary)
    }

    fn initiate_build_mode(
        &self,
        prerequisites: BuildPrerequisites,
        prepared_worktree: PreparedBuildWorktree,
        mut spawned_agent: SpawnedBuildAgent,
        task_id: &str,
        run_id: &str,
        emitter: RunEmitter,
    ) -> Result<RunSummary> {
        self.task_transition(
            prerequisites.repo_path.as_str(),
            task_id,
            TaskStatus::InProgress,
            Some("Builder delegated"),
        )
        .or_else(|error| Self::abort_started_build(&mut spawned_agent, error))?;

        let worktree_path = prepared_worktree
            .worktree_dir
            .to_str()
            .ok_or_else(|| anyhow!("Invalid worktree path"))
            .map(|path| path.to_string())
            .or_else(|error| Self::abort_started_build(&mut spawned_agent, error))?;

        let summary = RunSummary {
            run_id: run_id.to_string(),
            repo_path: prerequisites.repo_path.clone(),
            task_id: task_id.to_string(),
            branch: prerequisites.branch.clone(),
            worktree_path: worktree_path.clone(),
            port: spawned_agent.port,
            state: RunState::Running,
            last_message: Some("Opencode server running".to_string()),
            started_at: now_rfc3339(),
        };

        self.register_build_run(
            run_id,
            summary,
            prerequisites,
            task_id,
            worktree_path,
            spawned_agent,
            emitter,
        )
    }
}

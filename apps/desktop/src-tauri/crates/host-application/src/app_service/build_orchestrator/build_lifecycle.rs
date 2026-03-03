use super::super::{
    emit_event, spawn_output_forwarder, terminate_child_process, AppService,
    OpencodeStartupReadinessPolicy, OpencodeStartupWaitReport, RunEmitter, RunProcess,
    StartupEventCorrelation, StartupEventPayload,
};
use super::build_runtime_setup::{BuildPrerequisites, PreparedBuildWorktree, SpawnedBuildAgent};
use super::BuildResponseAction;
use anyhow::{anyhow, Context, Result};
use host_domain::{now_rfc3339, RunEvent, RunState, RunSummary, TaskStatus};
use std::process::{ChildStderr, ChildStdout};
use uuid::Uuid;

const STARTUP_CONFIG_INVALID_REASON: &str = "startup_config_invalid";

struct BuildRunRegistration {
    run_id: String,
    summary: RunSummary,
    prerequisites: BuildPrerequisites,
    task_id: String,
    worktree_path: String,
    spawned_agent: SpawnedBuildAgent,
    emitter: RunEmitter,
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
        let startup_policy = self.resolve_build_startup_policy(
            prerequisites.repo_path.as_str(),
            task_id,
            run_id.as_str(),
        )?;
        let prepared_worktree = self.prepare_build_worktree(&prerequisites, task_id)?;
        let spawned_agent = self.spawn_and_wait_for_agent(
            &prerequisites,
            &prepared_worktree,
            task_id,
            run_id.as_str(),
            startup_policy,
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

    pub fn build_respond(
        &self,
        run_id: &str,
        action: BuildResponseAction,
        payload: Option<&str>,
        emitter: RunEmitter,
    ) -> Result<bool> {
        let mut runs = self
            .runs
            .lock()
            .map_err(|_| anyhow!("Run state lock poisoned"))?;
        let run = runs
            .get_mut(run_id)
            .ok_or_else(|| anyhow!("Run not found: {run_id}"))?;

        match action {
            BuildResponseAction::Approve => {
                if payload
                    .map(|entry| entry.contains("git push"))
                    .unwrap_or(false)
                {
                    run.summary.last_message =
                        Some("Approved sensitive command: git push".to_string());
                } else {
                    run.summary.last_message = Some("Approval received".to_string());
                }
                run.summary.state = RunState::Running;
            }
            BuildResponseAction::Deny => {
                run.summary.last_message = Some("Command denied by user".to_string());
                run.summary.state = RunState::Blocked;
                let _ = self.task_transition(
                    &run.repo_path,
                    &run.task_id,
                    TaskStatus::Blocked,
                    Some("User denied command"),
                );
            }
            BuildResponseAction::Message => {
                run.summary.last_message = payload.map(|entry| entry.to_string());
            }
        }

        emit_event(
            &emitter,
            RunEvent::AgentThought {
                run_id: run_id.to_string(),
                message: run
                    .summary
                    .last_message
                    .clone()
                    .unwrap_or_else(|| "User response applied".to_string()),
                timestamp: now_rfc3339(),
            },
        );

        Ok(true)
    }

    pub fn build_stop(&self, run_id: &str, emitter: RunEmitter) -> Result<bool> {
        let mut runs = self
            .runs
            .lock()
            .map_err(|_| anyhow!("Run state lock poisoned"))?;
        let run = runs
            .get_mut(run_id)
            .ok_or_else(|| anyhow!("Run not found: {run_id}"))?;

        terminate_child_process(&mut run.child);
        run.summary.state = RunState::Stopped;
        run.summary.last_message = Some("Run stopped by user".to_string());

        emit_event(
            &emitter,
            RunEvent::RunFinished {
                run_id: run_id.to_string(),
                message: "Run stopped".to_string(),
                timestamp: now_rfc3339(),
                success: false,
            },
        );

        Ok(true)
    }

    pub(crate) fn resolve_build_startup_policy(
        &self,
        repo_path: &str,
        task_id: &str,
        run_id: &str,
    ) -> Result<OpencodeStartupReadinessPolicy> {
        self.opencode_startup_readiness_policy()
            .map_err(|error| {
                self.emit_opencode_startup_event(StartupEventPayload::failed(
                    "build_runtime",
                    repo_path,
                    Some(task_id),
                    "build",
                    0,
                    Some(StartupEventCorrelation::new("run_id", run_id)),
                    None,
                    OpencodeStartupWaitReport::zero(),
                    STARTUP_CONFIG_INVALID_REASON,
                ));
                error
            })
            .with_context(|| {
                format!(
                    "OpenCode build runtime failed before worktree preparation for task {task_id}"
                )
            })
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

    fn register_build_run(&self, registration: BuildRunRegistration) -> Result<RunSummary> {
        let BuildRunRegistration {
            run_id,
            summary,
            prerequisites,
            task_id,
            worktree_path,
            spawned_agent,
            emitter,
        } = registration;

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
        let task_id_for_event = task_id.clone();
        let process = RunProcess {
            summary: summary.clone(),
            child,
            _opencode_process_guard: Some(opencode_process_guard),
            repo_path: prerequisites.repo_path,
            task_id,
            worktree_path,
            repo_config: prerequisites.repo_config,
        };

        runs.insert(run_id.clone(), process);
        drop(runs);
        Self::emit_build_started_and_forward_output(
            run_id.as_str(),
            task_id_for_event.as_str(),
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
        let run_id_string = run_id.to_string();
        let task_id_string = task_id.to_string();

        let summary = RunSummary {
            run_id: run_id_string.clone(),
            repo_path: prerequisites.repo_path.clone(),
            task_id: task_id_string.clone(),
            branch: prerequisites.branch.clone(),
            worktree_path: worktree_path.clone(),
            port: spawned_agent.port,
            state: RunState::Running,
            last_message: Some("Opencode server running".to_string()),
            started_at: now_rfc3339(),
        };

        self.register_build_run(BuildRunRegistration {
            run_id: run_id_string,
            summary,
            prerequisites,
            task_id: task_id_string,
            worktree_path,
            spawned_agent,
            emitter,
        })
    }
}

use super::super::{
    emit_event, AppService, OpencodeStartupReadinessPolicy, OpencodeStartupWaitReport, RunEmitter,
    RunProcess, RuntimeInstanceSummary, StartupEventContext, StartupEventCorrelation,
    StartupEventPayload, STARTUP_CONFIG_INVALID_REASON,
};
use super::build_runtime_setup::{BuildPrerequisites, PreparedBuildWorktree};
use super::BuildResponseAction;
use anyhow::{anyhow, Context, Result};
use host_domain::{now_rfc3339, AgentRuntimeKind, RunEvent, RunState, RunSummary, TaskStatus};
use uuid::Uuid;

struct BuildRunRegistration {
    run_id: String,
    summary: RunSummary,
    prerequisites: BuildPrerequisites,
    task_id: String,
    worktree_path: String,
    emitter: RunEmitter,
}

struct BuildModeStartInput<'a> {
    runtime_kind: AgentRuntimeKind,
    prerequisites: BuildPrerequisites,
    prepared_worktree: PreparedBuildWorktree,
    runtime_summary: RuntimeInstanceSummary,
    task_id: &'a str,
    run_id: &'a str,
    emitter: RunEmitter,
}

impl AppService {
    pub fn build_start(
        &self,
        repo_path: &str,
        task_id: &str,
        runtime_kind: &str,
        emitter: RunEmitter,
    ) -> Result<RunSummary> {
        let runtime_kind = Self::resolve_supported_runtime_kind(runtime_kind)?;
        Self::ensure_runtime_supports_all_workflow_scopes(runtime_kind)?;
        let run_id = format!("run-{}", Uuid::new_v4().simple());
        let prerequisites = self.validate_build_prerequisites(repo_path, task_id)?;
        let _startup_policy = self.resolve_build_startup_policy(
            prerequisites.repo_path.as_str(),
            task_id,
            run_id.as_str(),
        )?;
        let prepared_worktree = self.prepare_build_worktree(&prerequisites, task_id)?;
        let runtime_summary = self
            .runtime_ensure(runtime_kind.as_str(), prerequisites.repo_path.as_str())
            .with_context(|| {
                format!("OpenCode build runtime failed to start for task {task_id}")
            })?;

        self.initiate_build_mode(BuildModeStartInput {
            runtime_kind,
            prerequisites,
            prepared_worktree,
            runtime_summary,
            task_id,
            run_id: run_id.as_str(),
            emitter,
        })
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
            .inspect_err(|_| {
                self.emit_opencode_startup_event(StartupEventPayload::failed(
                    StartupEventContext::new(
                        "build_runtime",
                        repo_path,
                        Some(task_id),
                        "build",
                        0,
                        Some(StartupEventCorrelation::new("run_id", run_id)),
                        None,
                    ),
                    OpencodeStartupWaitReport::zero(),
                    STARTUP_CONFIG_INVALID_REASON,
                ));
            })
            .with_context(|| {
                format!(
                    "OpenCode build runtime failed before worktree preparation for task {task_id}"
                )
            })
    }

    fn emit_build_started(run_id: &str, task_id: &str, branch: &str, emitter: RunEmitter) {
        emit_event(
            &emitter,
            RunEvent::RunStarted {
                run_id: run_id.to_string(),
                message: format!("Delegated task {} on branch {}", task_id, branch),
                timestamp: now_rfc3339(),
            },
        );
    }

    fn register_build_run(&self, registration: BuildRunRegistration) -> Result<RunSummary> {
        let BuildRunRegistration {
            run_id,
            summary,
            prerequisites,
            task_id,
            worktree_path,
            emitter,
        } = registration;
        let mut runs = match self.runs.lock() {
            Ok(runs) => runs,
            Err(_) => return Err(anyhow!("Run state lock poisoned")),
        };

        let task_id_for_event = task_id.clone();
        let process = RunProcess {
            summary: summary.clone(),
            child: None,
            _opencode_process_guard: None,
            repo_path: prerequisites.repo_path,
            task_id,
            worktree_path,
            repo_config: prerequisites.repo_config,
        };

        runs.insert(run_id.clone(), process);
        drop(runs);
        Self::emit_build_started(
            run_id.as_str(),
            task_id_for_event.as_str(),
            summary.branch.as_str(),
            emitter,
        );
        Ok(summary)
    }

    fn initiate_build_mode(&self, input: BuildModeStartInput<'_>) -> Result<RunSummary> {
        let BuildModeStartInput {
            runtime_kind,
            prerequisites,
            prepared_worktree,
            runtime_summary,
            task_id,
            run_id,
            emitter,
        } = input;
        self.task_transition(
            prerequisites.repo_path.as_str(),
            task_id,
            TaskStatus::InProgress,
            Some("Builder delegated"),
        )?;

        let worktree_path = prepared_worktree
            .worktree_dir
            .to_str()
            .ok_or_else(|| anyhow!("Invalid worktree path"))
            .map(|path| path.to_string())?;
        let run_id_string = run_id.to_string();
        let task_id_string = task_id.to_string();
        let port = runtime_summary
            .runtime_route
            .port()
            .ok_or_else(|| anyhow!("Build runtime route must expose a port"))?;

        let summary = RunSummary {
            run_id: run_id_string.clone(),
            runtime_kind,
            runtime_route: runtime_summary.runtime_route,
            repo_path: prerequisites.repo_path.clone(),
            task_id: task_id_string.clone(),
            branch: prerequisites.branch.clone(),
            worktree_path: worktree_path.clone(),
            port,
            state: RunState::Running,
            last_message: Some(format!("{} runtime running", runtime_kind.as_str())),
            started_at: now_rfc3339(),
        };

        self.register_build_run(BuildRunRegistration {
            run_id: run_id_string,
            summary,
            prerequisites,
            task_id: task_id_string,
            worktree_path,
            emitter,
        })
    }
}

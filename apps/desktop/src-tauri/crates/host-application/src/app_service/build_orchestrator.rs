use super::{
    emit_event, run_parsed_hook_command_allow_failure, spawn_opencode_server,
    spawn_output_forwarder, terminate_child_process, validate_hook_trust, validate_transition,
    wait_for_local_server_with_process, AppService, RunEmitter, RunProcess, StartupEventPayload,
};
use anyhow::{anyhow, Context, Result};
use host_domain::{now_rfc3339, RunEvent, RunState, RunSummary, TaskStatus};
use host_infra_system::{build_branch_name, pick_free_port, remove_worktree};
use serde::Deserialize;
use std::fs;
use std::path::Path;
use uuid::Uuid;

/// Action responded by user during build/run (for approve/deny/message flow).
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BuildResponseAction {
    Approve,
    Deny,
    Message,
}

impl BuildResponseAction {
    pub fn as_str(&self) -> &'static str {
        match self {
            BuildResponseAction::Approve => "approve",
            BuildResponseAction::Deny => "deny",
            BuildResponseAction::Message => "message",
        }
    }
}

/// Cleanup mode after build/run completion.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CleanupMode {
    Success,
    Failure,
}

impl CleanupMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            CleanupMode::Success => "success",
            CleanupMode::Failure => "failure",
        }
    }
}

struct ReviewTransition {
    status: TaskStatus,
    label: &'static str,
}

enum CleanupEvent<'a> {
    RunFailed,
    PostHookStarted { hook: &'a str },
    PostHookFailed { hook: &'a str, stderr: &'a str },
    ReadyForReview { review_label: &'a str },
    RunCompleted { review_label: &'a str },
}

impl AppService {
    pub fn build_start(
        &self,
        repo_path: &str,
        task_id: &str,
        emitter: RunEmitter,
    ) -> Result<RunSummary> {
        let repo_path = self.resolve_initialized_repo_path(repo_path)?;
        let repo_path = repo_path.as_str();

        let repo_config = self.config_store.repo_config(repo_path)?;

        let worktree_base = repo_config.worktree_base_path.clone().ok_or_else(|| {
            anyhow!(
                "Build blocked: configure repos.{repo_path}.worktreeBasePath in {}",
                self.config_store.path().display()
            )
        })?;

        validate_hook_trust(repo_path, &repo_config)?;

        let tasks = self.task_store.list_tasks(Path::new(repo_path))?;
        let task = tasks
            .iter()
            .find(|entry| entry.id == task_id)
            .cloned()
            .ok_or_else(|| anyhow!("Task not found: {task_id}"))?;
        validate_transition(&task, &tasks, &task.status, &TaskStatus::InProgress)?;

        let branch = build_branch_name(&repo_config.branch_prefix, task_id, &task.title);

        let worktree_dir = Path::new(&worktree_base).join(task_id);
        fs::create_dir_all(Path::new(&worktree_base)).with_context(|| {
            format!(
                "Failed creating worktree base directory {}",
                Path::new(&worktree_base).display()
            )
        })?;

        if worktree_dir.exists() {
            return Err(anyhow!(
                "Worktree path already exists for task {}: {}",
                task_id,
                worktree_dir.display()
            ));
        }

        let repo_path_ref = Path::new(repo_path);
        host_infra_system::run_command(
            "git",
            &[
                "worktree",
                "add",
                worktree_dir
                    .to_str()
                    .ok_or_else(|| anyhow!("Invalid worktree path"))?,
                "-b",
                &branch,
            ],
            Some(repo_path_ref),
        )?;

        for hook in &repo_config.hooks.pre_start {
            let (ok, _stdout, stderr) =
                run_parsed_hook_command_allow_failure(hook, worktree_dir.as_path());
            if !ok {
                let _ = self.task_transition(
                    repo_path,
                    task_id,
                    TaskStatus::Blocked,
                    Some("Pre-start hook failed"),
                );
                let cleanup_error = remove_worktree(repo_path_ref, worktree_dir.as_path())
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

        let run_id = format!("run-{}", Uuid::new_v4().simple());
        let port = pick_free_port()?;
        let metadata_namespace = self.config_store.task_metadata_namespace()?;

        let mut child = spawn_opencode_server(
            worktree_dir.as_path(),
            Path::new(repo_path),
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
        let startup_policy = self.opencode_startup_readiness_policy();
        let startup_cancel_epoch = self.startup_cancel_epoch();
        let startup_cancel_snapshot = self.startup_cancel_snapshot();
        self.emit_opencode_startup_event(StartupEventPayload {
            event_name: "startup_wait_begin",
            runtime_type: "build_runtime",
            repo_path,
            task_id: Some(task_id),
            role: "build",
            port,
            extra: Some(("run_id", run_id.as_str())),
            policy: Some(startup_policy),
            report: None,
            failure_reason: None,
        });
        let startup_report = match wait_for_local_server_with_process(
            &mut child,
            port,
            startup_policy,
            &startup_cancel_epoch,
            startup_cancel_snapshot,
        ) {
            Ok(report) => report,
            Err(error) => {
                self.emit_opencode_startup_event(StartupEventPayload {
                    event_name: "startup_failed",
                    runtime_type: "build_runtime",
                    repo_path,
                    task_id: Some(task_id),
                    role: "build",
                    port,
                    extra: Some(("run_id", run_id.as_str())),
                    policy: Some(startup_policy),
                    report: Some(error.report),
                    failure_reason: Some(error.reason),
                });
                terminate_child_process(&mut child);
                return Err(anyhow!(error)).with_context(|| {
                    format!("OpenCode build runtime failed to start for task {task_id}")
                });
            }
        };
        self.emit_opencode_startup_event(StartupEventPayload {
            event_name: "startup_ready",
            runtime_type: "build_runtime",
            repo_path,
            task_id: Some(task_id),
            role: "build",
            port,
            extra: Some(("run_id", run_id.as_str())),
            policy: Some(startup_policy),
            report: Some(startup_report),
            failure_reason: None,
        });

        self.task_transition(
            repo_path,
            task_id,
            TaskStatus::InProgress,
            Some("Builder delegated"),
        )?;

        let summary = RunSummary {
            run_id: run_id.clone(),
            repo_path: repo_path.to_string(),
            task_id: task_id.to_string(),
            branch,
            worktree_path: worktree_dir
                .to_str()
                .ok_or_else(|| anyhow!("Invalid worktree path"))?
                .to_string(),
            port,
            state: RunState::Running,
            last_message: Some("Opencode server running".to_string()),
            started_at: now_rfc3339(),
        };

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        let process = RunProcess {
            summary: summary.clone(),
            child,
            _opencode_process_guard: Some(opencode_process_guard),
            repo_path: repo_path.to_string(),
            task_id: task_id.to_string(),
            worktree_path: worktree_dir
                .to_str()
                .ok_or_else(|| anyhow!("Invalid worktree path"))?
                .to_string(),
            repo_config,
        };

        self.runs
            .lock()
            .map_err(|_| anyhow!("Run state lock poisoned"))?
            .insert(run_id.clone(), process);

        emit_event(
            &emitter,
            RunEvent::RunStarted {
                run_id: run_id.clone(),
                message: format!("Delegated task {} on branch {}", task_id, summary.branch),
                timestamp: now_rfc3339(),
            },
        );

        if let Some(stdout) = stdout {
            spawn_output_forwarder(run_id.clone(), "stdout", stdout, emitter.clone());
        }
        if let Some(stderr) = stderr {
            spawn_output_forwarder(run_id.clone(), "stderr", stderr, emitter.clone());
        }

        Ok(summary)
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

    pub fn build_cleanup(
        &self,
        run_id: &str,
        mode: CleanupMode,
        emitter: RunEmitter,
    ) -> Result<bool> {
        let mut run = self.take_run_for_cleanup(run_id)?;

        terminate_child_process(&mut run.child);

        match mode {
            CleanupMode::Failure => self.cleanup_failed_run(run_id, &mut run, &emitter),
            CleanupMode::Success => self.cleanup_success_run(run_id, &mut run, &emitter),
        }
    }

    fn take_run_for_cleanup(&self, run_id: &str) -> Result<RunProcess> {
        self.runs
            .lock()
            .map_err(|_| anyhow!("Run state lock poisoned"))?
            .remove(run_id)
            .ok_or_else(|| anyhow!("Run not found: {run_id}"))
    }

    fn cleanup_failed_run(
        &self,
        run_id: &str,
        run: &mut RunProcess,
        emitter: &RunEmitter,
    ) -> Result<bool> {
        self.apply_blocked_transition(run, "Run failed; worktree retained", true)?;
        self.emit_cleanup_events(emitter, run_id, CleanupEvent::RunFailed);
        Ok(true)
    }

    fn cleanup_success_run(
        &self,
        run_id: &str,
        run: &mut RunProcess,
        emitter: &RunEmitter,
    ) -> Result<bool> {
        if !self.run_post_complete_hooks(run_id, run, emitter)? {
            return Ok(false);
        }

        let review_transition = self.determine_review_transition(run)?;
        self.emit_cleanup_events(
            emitter,
            run_id,
            CleanupEvent::ReadyForReview {
                review_label: review_transition.label,
            },
        );
        self.apply_review_transition(run, &review_transition)?;
        self.cleanup_worktree(run)?;
        self.emit_cleanup_events(
            emitter,
            run_id,
            CleanupEvent::RunCompleted {
                review_label: review_transition.label,
            },
        );
        Ok(true)
    }

    fn run_post_complete_hooks(
        &self,
        run_id: &str,
        run: &mut RunProcess,
        emitter: &RunEmitter,
    ) -> Result<bool> {
        let post_complete_hooks = run.repo_config.hooks.post_complete.clone();
        for hook in post_complete_hooks {
            self.emit_cleanup_events(
                emitter,
                run_id,
                CleanupEvent::PostHookStarted {
                    hook: hook.as_str(),
                },
            );

            let (ok, _stdout, stderr) =
                run_parsed_hook_command_allow_failure(hook.as_str(), Path::new(&run.worktree_path));

            if !ok {
                self.apply_blocked_transition(run, "Post-complete hook failed", false)?;
                self.emit_cleanup_events(
                    emitter,
                    run_id,
                    CleanupEvent::PostHookFailed {
                        hook: hook.as_str(),
                        stderr: stderr.as_str(),
                    },
                );
                return Ok(false);
            }
        }
        Ok(true)
    }

    fn cleanup_worktree(&self, run: &RunProcess) -> Result<()> {
        remove_worktree(Path::new(&run.repo_path), Path::new(&run.worktree_path))
    }

    fn apply_blocked_transition(
        &self,
        run: &mut RunProcess,
        reason: &'static str,
        mark_run_failed: bool,
    ) -> Result<()> {
        self.task_transition(
            &run.repo_path,
            &run.task_id,
            TaskStatus::Blocked,
            Some(reason),
        )?;
        if mark_run_failed {
            run.summary.state = RunState::Failed;
        }
        Ok(())
    }

    fn determine_review_transition(&self, run: &RunProcess) -> Result<ReviewTransition> {
        let current_task = self
            .task_store
            .list_tasks(Path::new(&run.repo_path))?
            .into_iter()
            .find(|task| task.id == run.task_id)
            .ok_or_else(|| anyhow!("Task not found: {}", run.task_id))?;

        Ok(if current_task.ai_review_enabled {
            ReviewTransition {
                status: TaskStatus::AiReview,
                label: "AI review",
            }
        } else {
            ReviewTransition {
                status: TaskStatus::HumanReview,
                label: "Human review",
            }
        })
    }

    fn apply_review_transition(
        &self,
        run: &RunProcess,
        review_transition: &ReviewTransition,
    ) -> Result<()> {
        self.task_transition(
            &run.repo_path,
            &run.task_id,
            review_transition.status.clone(),
            Some("Builder completed"),
        )?;
        Ok(())
    }

    fn emit_cleanup_events(&self, emitter: &RunEmitter, run_id: &str, event: CleanupEvent<'_>) {
        let event = match event {
            CleanupEvent::RunFailed => RunEvent::RunFinished {
                run_id: run_id.to_string(),
                message: "Run marked as failed; worktree retained".to_string(),
                timestamp: now_rfc3339(),
                success: false,
            },
            CleanupEvent::PostHookStarted { hook } => RunEvent::PostHookStarted {
                run_id: run_id.to_string(),
                message: format!("Running post-complete hook: {hook}"),
                timestamp: now_rfc3339(),
            },
            CleanupEvent::PostHookFailed { hook, stderr } => RunEvent::PostHookFailed {
                run_id: run_id.to_string(),
                message: format!("Post-complete hook failed: {hook}\n{stderr}"),
                timestamp: now_rfc3339(),
            },
            CleanupEvent::ReadyForReview { review_label } => {
                RunEvent::ReadyForManualDoneConfirmation {
                    run_id: run_id.to_string(),
                    message: format!(
                        "Post-complete hooks passed. Transitioning to {review_label}."
                    ),
                    timestamp: now_rfc3339(),
                }
            }
            CleanupEvent::RunCompleted { review_label } => RunEvent::RunFinished {
                run_id: run_id.to_string(),
                message: format!("Run completed; moved to {review_label}; worktree removed"),
                timestamp: now_rfc3339(),
                success: true,
            },
        };
        emit_event(emitter, event);
    }
}

#[cfg(test)]
mod tests {
    use crate::app_service::build_orchestrator::BuildResponseAction;
    use crate::app_service::test_support::{build_service_with_state, make_emitter};
    use std::sync::{Arc, Mutex};

    #[test]
    fn module_build_stop_reports_missing_run() {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let events = Arc::new(Mutex::new(Vec::new()));

        let error = service
            .build_stop("missing-run", make_emitter(events))
            .expect_err("stopping unknown run should fail");

        assert!(error.to_string().contains("Run not found: missing-run"));
    }

    #[test]
    fn module_build_respond_reports_missing_run() {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let events = Arc::new(Mutex::new(Vec::new()));

        let error = service
            .build_respond(
                "missing-run",
                BuildResponseAction::Approve,
                None,
                make_emitter(events),
            )
            .expect_err("responding to unknown run should fail");

        assert!(error.to_string().contains("Run not found: missing-run"));
    }
}

use super::{
    emit_event, spawn_opencode_server, spawn_output_forwarder, terminate_child_process,
    validate_transition, wait_for_local_server_with_process, AppService, RunEmitter, RunProcess,
};
use anyhow::{anyhow, Context, Result};
use host_domain::{now_rfc3339, RunEvent, RunState, RunSummary, TaskStatus};
use host_infra_system::{
    build_branch_name, pick_free_port, remove_worktree, run_command_allow_failure,
};
use std::fs;
use std::path::Path;
use std::time::Duration;
use uuid::Uuid;

impl AppService {
    pub fn build_start(
        &self,
        repo_path: &str,
        task_id: &str,
        emitter: RunEmitter,
    ) -> Result<RunSummary> {
        let repo_config = self.config_store.repo_config(repo_path)?;

        let worktree_base = repo_config.worktree_base_path.clone().ok_or_else(|| {
            anyhow!(
                "Build blocked: configure repos.{repo_path}.worktreeBasePath in {}",
                self.config_store.path().display()
            )
        })?;

        if (!repo_config.hooks.pre_start.is_empty() || !repo_config.hooks.post_complete.is_empty())
            && !repo_config.trusted_hooks
        {
            return Err(anyhow!(
                "Hooks are configured but not trusted for {repo_path}. Confirm trust first."
            ));
        }

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
                run_command_allow_failure("sh", &["-lc", hook], Some(worktree_dir.as_path()))?;
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

        let port = pick_free_port()?;
        let metadata_namespace = self.config_store.task_metadata_namespace()?;

        let mut child = spawn_opencode_server(
            worktree_dir.as_path(),
            Path::new(repo_path),
            metadata_namespace.as_str(),
            port,
        )?;
        if let Err(error) =
            wait_for_local_server_with_process(&mut child, port, Duration::from_secs(8))
        {
            terminate_child_process(&mut child);
            return Err(error).with_context(|| {
                format!("OpenCode build runtime failed to start for task {task_id}")
            });
        }

        self.task_transition(
            repo_path,
            task_id,
            TaskStatus::InProgress,
            Some("Builder delegated"),
        )?;

        let run_id = format!("run-{}", Uuid::new_v4().simple());

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
        action: &str,
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
            "approve" => {
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
            "deny" => {
                run.summary.last_message = Some("Command denied by user".to_string());
                run.summary.state = RunState::Blocked;
                let _ = self.task_transition(
                    &run.repo_path,
                    &run.task_id,
                    TaskStatus::Blocked,
                    Some("User denied command"),
                );
            }
            "message" => {
                run.summary.last_message = payload.map(|entry| entry.to_string());
            }
            other => return Err(anyhow!("Unknown build response action: {other}")),
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

    pub fn build_cleanup(&self, run_id: &str, mode: &str, emitter: RunEmitter) -> Result<bool> {
        let mut runs = self
            .runs
            .lock()
            .map_err(|_| anyhow!("Run state lock poisoned"))?;
        let mut run = runs
            .remove(run_id)
            .ok_or_else(|| anyhow!("Run not found: {run_id}"))?;

        terminate_child_process(&mut run.child);

        match mode {
            "failure" => {
                self.task_transition(
                    &run.repo_path,
                    &run.task_id,
                    TaskStatus::Blocked,
                    Some("Run failed; worktree retained"),
                )?;

                run.summary.state = RunState::Failed;
                emit_event(
                    &emitter,
                    RunEvent::RunFinished {
                        run_id: run_id.to_string(),
                        message: "Run marked as failed; worktree retained".to_string(),
                        timestamp: now_rfc3339(),
                        success: false,
                    },
                );
                return Ok(true);
            }
            "success" => {}
            other => return Err(anyhow!("Unknown cleanup mode: {other}")),
        }

        for hook in &run.repo_config.hooks.post_complete {
            emit_event(
                &emitter,
                RunEvent::PostHookStarted {
                    run_id: run_id.to_string(),
                    message: format!("Running post-complete hook: {hook}"),
                    timestamp: now_rfc3339(),
                },
            );

            let (ok, _stdout, stderr) = run_command_allow_failure(
                "sh",
                &["-lc", hook],
                Some(Path::new(&run.worktree_path)),
            )?;

            if !ok {
                self.task_transition(
                    &run.repo_path,
                    &run.task_id,
                    TaskStatus::Blocked,
                    Some("Post-complete hook failed"),
                )?;

                emit_event(
                    &emitter,
                    RunEvent::PostHookFailed {
                        run_id: run_id.to_string(),
                        message: format!("Post-complete hook failed: {hook}\n{stderr}"),
                        timestamp: now_rfc3339(),
                    },
                );

                return Ok(false);
            }
        }

        let current_task = self
            .task_store
            .list_tasks(Path::new(&run.repo_path))?
            .into_iter()
            .find(|task| task.id == run.task_id)
            .ok_or_else(|| anyhow!("Task not found: {}", run.task_id))?;

        let review_status = if current_task.ai_review_enabled {
            TaskStatus::AiReview
        } else {
            TaskStatus::HumanReview
        };

        let review_label = if current_task.ai_review_enabled {
            "AI review"
        } else {
            "Human review"
        };

        emit_event(
            &emitter,
            RunEvent::ReadyForManualDoneConfirmation {
                run_id: run_id.to_string(),
                message: format!("Post-complete hooks passed. Transitioning to {review_label}."),
                timestamp: now_rfc3339(),
            },
        );

        self.task_transition(
            &run.repo_path,
            &run.task_id,
            review_status,
            Some("Builder completed"),
        )?;

        remove_worktree(Path::new(&run.repo_path), Path::new(&run.worktree_path))?;

        emit_event(
            &emitter,
            RunEvent::RunFinished {
                run_id: run_id.to_string(),
                message: format!("Run completed; moved to {review_label}; worktree removed"),
                timestamp: now_rfc3339(),
                success: true,
            },
        );

        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use crate::app_service::test_support::{build_service_with_state, make_emitter};
    use std::sync::{Arc, Mutex};

    #[test]
    fn module_build_stop_reports_missing_run() {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let events = Arc::new(Mutex::new(Vec::new()));

        let error = service
            .build_stop("missing-run", make_emitter(events))
            .expect_err("stopping unknown run should fail");

        assert!(error.to_string().contains("Run missing-run not found"));
    }

    #[test]
    fn module_build_respond_reports_missing_run() {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let events = Arc::new(Mutex::new(Vec::new()));

        let error = service
            .build_respond("missing-run", "approve", None, make_emitter(events))
            .expect_err("responding to unknown run should fail");

        assert!(error.to_string().contains("Run missing-run not found"));
    }
}

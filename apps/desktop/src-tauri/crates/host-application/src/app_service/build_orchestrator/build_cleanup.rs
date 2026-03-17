use super::super::{
    emit_event, run_parsed_hook_command_allow_failure, terminate_child_process, AppService,
    RunEmitter, RunProcess,
};
use super::CleanupMode;
use anyhow::{anyhow, Result};
use host_domain::{now_rfc3339, RunEvent, RunState, TaskStatus};
use std::path::Path;

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
        for hook_index in 0..run.repo_config.hooks.post_complete.len() {
            let hook = run.repo_config.hooks.post_complete[hook_index].clone();
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
                self.apply_blocked_transition(run, "Worktree cleanup script failed", false)?;
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
                message: format!("Running worktree cleanup script command: {hook}"),
                timestamp: now_rfc3339(),
            },
            CleanupEvent::PostHookFailed { hook, stderr } => RunEvent::PostHookFailed {
                run_id: run_id.to_string(),
                message: format!("Worktree cleanup script command failed: {hook}\n{stderr}"),
                timestamp: now_rfc3339(),
            },
            CleanupEvent::ReadyForReview { review_label } => {
                RunEvent::ReadyForManualDoneConfirmation {
                    run_id: run_id.to_string(),
                    message: format!(
                        "Post-complete hooks passed. Transitioning to {review_label} with the builder worktree retained."
                    ),
                    timestamp: now_rfc3339(),
                }
            }
            CleanupEvent::RunCompleted { review_label } => RunEvent::RunFinished {
                run_id: run_id.to_string(),
                message: format!("Run completed; moved to {review_label}; builder worktree retained"),
                timestamp: now_rfc3339(),
                success: true,
            },
        };
        emit_event(emitter, event);
    }
}

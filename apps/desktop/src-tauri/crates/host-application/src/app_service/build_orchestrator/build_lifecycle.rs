use super::super::{
    emit_event, AppService, RunEmitter, RunProcess, RuntimeInstanceSummary,
    RuntimeStartupReadinessPolicy, RuntimeStartupWaitReport, StartupEventContext,
    StartupEventCorrelation, StartupEventPayload, STARTUP_CONFIG_INVALID_REASON,
};
use super::build_runtime_setup::{BuildPrerequisites, PreparedBuildWorktree};
use super::BuildResponseAction;
use anyhow::{anyhow, Context, Result};
use host_domain::{
    now_rfc3339, AgentRuntimeKind, AgentSessionDocument, RunEvent, RunState, RunSummary,
    RuntimeRoute, TaskStatus,
};
use std::path::{Component, PathBuf};
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

struct BuildStopContext {
    runtime_kind: AgentRuntimeKind,
    runtime_route: RuntimeRoute,
    repo_path: String,
    task_id: String,
    worktree_path: String,
}

impl AppService {
    pub fn build_start(
        &self,
        repo_path: &str,
        task_id: &str,
        runtime_kind: &str,
        emitter: RunEmitter,
    ) -> Result<RunSummary> {
        let runtime_kind = self.resolve_supported_runtime_kind(runtime_kind)?;
        self.ensure_runtime_supports_all_workflow_scopes(runtime_kind.clone())?;
        let run_id = format!("run-{}", Uuid::new_v4().simple());
        let prerequisites = self.validate_build_prerequisites(repo_path, task_id)?;
        self.resolve_build_startup_policy(
            &runtime_kind,
            prerequisites.repo_path.as_str(),
            task_id,
            run_id.as_str(),
        )?;
        let prepared_worktree = self.prepare_build_worktree(&prerequisites, task_id)?;
        let runtime_summary = self
            .runtime_ensure(runtime_kind.as_str(), prerequisites.repo_path.as_str())
            .with_context(|| {
                format!(
                    "{} build runtime failed to start for task {task_id}",
                    runtime_kind.as_str()
                )
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
        let stop_context = {
            let runs = self
                .runs
                .lock()
                .map_err(|_| anyhow!("Run state lock poisoned"))?;
            let run = runs
                .get(run_id)
                .ok_or_else(|| anyhow!("Run not found: {run_id}"))?;
            BuildStopContext {
                runtime_kind: run.summary.runtime_kind.clone(),
                runtime_route: run.summary.runtime_route.clone(),
                repo_path: run.repo_path.clone(),
                task_id: run.task_id.clone(),
                worktree_path: run.worktree_path.clone(),
            }
        };
        self.abort_build_session_for_stop(&stop_context)?;

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
        runtime_kind: &AgentRuntimeKind,
        repo_path: &str,
        task_id: &str,
        run_id: &str,
    ) -> Result<RuntimeStartupReadinessPolicy> {
        self.runtime_registry
            .runtime(runtime_kind)?
            .startup_policy(self)
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
                    RuntimeStartupWaitReport::zero(),
                    STARTUP_CONFIG_INVALID_REASON,
                ));
            })
            .with_context(|| {
                format!(
                    "{} build runtime failed before worktree preparation for task {task_id}",
                    runtime_kind.as_str()
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

    fn abort_build_session_for_stop(&self, context: &BuildStopContext) -> Result<()> {
        let Some(session) = self.find_abortable_build_session_for_stop(context)? else {
            return Ok(());
        };
        let external_session_id = session
            .external_session_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| anyhow!("Build session is missing an external runtime session id"))?;

        self.runtime_registry
            .runtime(&context.runtime_kind)?
            .abort_build_session(
                &context.runtime_route,
                external_session_id,
                session.working_directory.as_str(),
            )?;

        Ok(())
    }

    fn find_abortable_build_session_for_stop(
        &self,
        context: &BuildStopContext,
    ) -> Result<Option<AgentSessionDocument>> {
        let normalized_worktree = normalize_path_for_comparison(context.worktree_path.as_str());
        Ok(self
            .agent_sessions_list(context.repo_path.as_str(), context.task_id.as_str())?
            .into_iter()
            .filter(|session| session.role.trim() == "build")
            .filter(|session| session.runtime_kind.trim() == context.runtime_kind.as_str())
            .filter(is_active_build_session)
            .filter(|session| {
                normalize_path_for_comparison(session.working_directory.as_str())
                    == normalized_worktree
            })
            .filter(|session| {
                session
                    .external_session_id
                    .as_deref()
                    .is_some_and(|value| !value.trim().is_empty())
            })
            .max_by(|left, right| {
                build_session_sort_key(left)
                    .cmp(&build_session_sort_key(right))
                    .then_with(|| left.session_id.cmp(&right.session_id))
            }))
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
            _runtime_process_guard: None,
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
        let port = runtime_summary
            .runtime_route
            .local_http_port()
            .ok_or_else(|| anyhow!("Build runs require a local_http runtime route with a port"))?;
        self.task_transition_to_in_progress_without_related_tasks(
            prerequisites.repo_path.as_str(),
            task_id,
        )?;

        let worktree_path = prepared_worktree
            .worktree_dir
            .to_str()
            .ok_or_else(|| anyhow!("Invalid worktree path"))
            .map(|path| path.to_string())?;
        let run_id_string = run_id.to_string();
        let task_id_string = task_id.to_string();

        let summary = RunSummary {
            run_id: run_id_string.clone(),
            runtime_kind: runtime_kind.clone(),
            runtime_route: runtime_summary.runtime_route,
            repo_path: prerequisites.repo_path.clone(),
            task_id: task_id_string.clone(),
            branch: prerequisites.branch.clone(),
            worktree_path: worktree_path.clone(),
            port: Some(port),
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

fn build_session_sort_key(session: &AgentSessionDocument) -> (&str, &str) {
    (session.started_at.as_str(), session.session_id.as_str())
}

fn is_active_build_session(session: &AgentSessionDocument) -> bool {
    session
        .external_session_id
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
}

fn normalize_path_for_comparison(path: &str) -> PathBuf {
    let path = path.trim();
    let mut normalized = PathBuf::new();
    for component in PathBuf::from(path).components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            other => normalized.push(other.as_os_str()),
        }
    }

    if normalized.as_os_str().is_empty() {
        PathBuf::from(path)
    } else {
        normalized
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app_service::test_support::{
        build_service_with_state, builtin_opencode_runtime_descriptor, make_emitter, make_task,
    };
    use host_domain::{GitTargetBranch, RuntimeRole, TaskStatus};
    use host_infra_system::RepoConfig;
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};

    fn make_stdio_runtime_summary() -> RuntimeInstanceSummary {
        RuntimeInstanceSummary {
            kind: AgentRuntimeKind::opencode(),
            runtime_id: "runtime-1".to_string(),
            repo_path: "/tmp/repo".to_string(),
            task_id: None,
            role: RuntimeRole::Workspace,
            working_directory: "/tmp/repo".to_string(),
            runtime_route: RuntimeRoute::Stdio,
            started_at: "2026-04-13T00:00:00Z".to_string(),
            descriptor: builtin_opencode_runtime_descriptor(),
        }
    }

    fn make_build_prerequisites() -> BuildPrerequisites {
        BuildPrerequisites {
            repo_path: "/tmp/repo".to_string(),
            repo_config: RepoConfig::default(),
            target_branch: GitTargetBranch {
                remote: Some("origin".to_string()),
                branch: "main".to_string(),
            },
            allow_local_branch_fallback: false,
            branch: "odt/task-1".to_string(),
            worktree_base: "/tmp/worktrees".to_string(),
        }
    }

    #[test]
    fn initiate_build_mode_rejects_stdio_routes_before_transitioning_task() {
        let (service, task_state, _git_state) =
            build_service_with_state(vec![make_task("task-1", "task", TaskStatus::Open)]);

        let error = service
            .initiate_build_mode(BuildModeStartInput {
                runtime_kind: AgentRuntimeKind::opencode(),
                prerequisites: make_build_prerequisites(),
                prepared_worktree: PreparedBuildWorktree {
                    worktree_dir: PathBuf::from("/tmp/worktrees/task-1"),
                },
                runtime_summary: make_stdio_runtime_summary(),
                task_id: "task-1",
                run_id: "run-1",
                emitter: make_emitter(Arc::new(Mutex::new(Vec::new()))),
            })
            .expect_err("stdio build routes should fail fast");

        assert!(error
            .to_string()
            .contains("local_http runtime route with a port"));
        assert!(task_state
            .lock()
            .expect("task store lock poisoned")
            .updated_patches
            .is_empty());
    }

    #[test]
    fn abort_opencode_session_rejects_stdio_routes() {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let error = service
            .runtime_registry
            .runtime(&AgentRuntimeKind::opencode())
            .expect("opencode runtime should be registered")
            .abort_build_session(
                &RuntimeRoute::Stdio,
                "external-session-1",
                "/tmp/repo/worktree",
            )
            .expect_err("stdio abort should fail fast");

        assert!(error
            .to_string()
            .contains("local_http runtime route with a port"));
    }
}

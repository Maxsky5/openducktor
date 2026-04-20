use super::super::{
    AppService, RuntimeInstanceSummary, RuntimeStartupReadinessPolicy, RuntimeStartupWaitReport,
    StartupEventContext, StartupEventCorrelation, StartupEventPayload,
    STARTUP_CONFIG_INVALID_REASON,
};
use super::build_runtime_setup::{BuildPrerequisites, PreparedBuildWorktree};
use anyhow::{anyhow, Context, Result};
use host_domain::{AgentRuntimeKind, BuildSessionBootstrap};

#[cfg(test)]
use std::path::PathBuf;

struct BuildModeStartInput<'a> {
    runtime_kind: AgentRuntimeKind,
    prerequisites: BuildPrerequisites,
    prepared_worktree: PreparedBuildWorktree,
    runtime_summary: RuntimeInstanceSummary,
    task_id: &'a str,
}

impl AppService {
    pub fn build_start(
        &self,
        repo_path: &str,
        task_id: &str,
        runtime_kind: &str,
    ) -> Result<BuildSessionBootstrap> {
        let runtime_kind = self.resolve_supported_runtime_kind(runtime_kind)?;
        self.ensure_runtime_supports_all_workflow_scopes(runtime_kind.clone())?;
        let prerequisites = self.validate_build_prerequisites(repo_path, task_id)?;
        self.resolve_build_startup_policy(
            &runtime_kind,
            prerequisites.repo_path.as_str(),
            task_id,
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
        })
    }

    pub(crate) fn resolve_build_startup_policy(
        &self,
        runtime_kind: &AgentRuntimeKind,
        repo_path: &str,
        task_id: &str,
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
                        Some(StartupEventCorrelation::new("task_id", task_id)),
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

    fn initiate_build_mode(&self, input: BuildModeStartInput<'_>) -> Result<BuildSessionBootstrap> {
        let BuildModeStartInput {
            runtime_kind,
            prerequisites,
            prepared_worktree,
            runtime_summary,
            task_id,
        } = input;
        runtime_summary
            .runtime_route
            .local_http_port()
            .ok_or_else(|| {
                anyhow!("Build sessions require a local_http runtime route with a port")
            })?;
        self.task_transition_to_in_progress_without_related_tasks(
            prerequisites.repo_path.as_str(),
            task_id,
        )?;

        let working_directory = prepared_worktree
            .worktree_dir
            .to_str()
            .ok_or_else(|| anyhow!("Invalid worktree path"))?
            .to_string();

        Ok(BuildSessionBootstrap {
            runtime_kind,
            runtime_route: runtime_summary.runtime_route,
            working_directory,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app_service::test_support::{
        build_service_with_state, builtin_opencode_runtime_descriptor, make_task,
    };
    use host_domain::{GitTargetBranch, RuntimeRole, RuntimeRoute, TaskStatus};

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
            repo_config: Default::default(),
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
}

use super::super::{
    AppService, RuntimeInstanceSummary, RuntimeStartupReadinessPolicy, RuntimeStartupWaitReport,
    StartupEventContext, StartupEventCorrelation, StartupEventPayload, STARTUP_CONFIG_INVALID_REASON,
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
                        None,
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

        self.runtime_registry
            .runtime(&runtime_kind)?
            .validate_build_session_bootstrap(&runtime_summary)?;

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
        build_service_with_runtime_registry, build_service_with_state,
        builtin_opencode_runtime_descriptor, make_task,
    };
    use crate::app_service::runtime_registry::{AppRuntime, AppRuntimeRegistry};
    use anyhow::anyhow;
    use host_domain::{GitTargetBranch, RuntimeHealth, RuntimeRole, RuntimeRoute, TaskStatus};
    use std::sync::Arc;

    #[derive(Clone)]
    struct TestRuntimeAdapter;

    impl AppRuntime for TestRuntimeAdapter {
        fn definition(&self) -> host_domain::RuntimeDefinition {
            let mut descriptor = builtin_opencode_runtime_descriptor();
            descriptor.kind = AgentRuntimeKind::from("test-runtime");
            descriptor.label = "Test Runtime".to_string();
            descriptor.description = "Test Runtime runtime".to_string();
            host_domain::RuntimeDefinition::new(descriptor, Default::default())
        }

        fn runtime_health(&self) -> RuntimeHealth {
            RuntimeHealth {
                kind: "test-runtime".to_string(),
                ok: true,
                version: Some("1.0.0".to_string()),
                error: None,
            }
        }

        fn stop_session(
            &self,
            _runtime_route: &RuntimeRoute,
            _external_session_id: &str,
            _working_directory: &str,
        ) -> Result<()> {
            Err(anyhow!("stop_session should not be used in this test"))
        }
    }

    fn test_runtime_definition() -> host_domain::RuntimeDefinition {
        let adapter = TestRuntimeAdapter;
        <TestRuntimeAdapter as AppRuntime>::definition(&adapter)
    }

    fn make_runtime_summary(
        kind: AgentRuntimeKind,
        runtime_route: RuntimeRoute,
        descriptor: host_domain::RuntimeDescriptor,
    ) -> RuntimeInstanceSummary {
        RuntimeInstanceSummary {
            kind,
            runtime_id: "runtime-1".to_string(),
            repo_path: "/tmp/repo".to_string(),
            task_id: None,
            role: RuntimeRole::Workspace,
            working_directory: "/tmp/repo".to_string(),
            runtime_route,
            started_at: "2026-04-13T00:00:00Z".to_string(),
            descriptor,
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
                runtime_summary: make_runtime_summary(
                    AgentRuntimeKind::opencode(),
                    RuntimeRoute::stdio("runtime-stdio").expect("stdio route"),
                    builtin_opencode_runtime_descriptor(),
                ),
                task_id: "task-1",
            })
            .expect_err("opencode build startup should reject stdio routes before task transition");

        assert!(
            error
                .to_string()
                .contains("OpenCode build session startup"),
            "error should come from the OpenCode runtime boundary: {error}"
        );
        let updated_patches = &task_state
            .lock()
            .expect("task store lock poisoned")
            .updated_patches;
        assert!(updated_patches.is_empty());
    }

    #[test]
    fn initiate_build_mode_accepts_local_http_routes_without_explicit_ports() {
        let (service, task_state, _git_state) =
            build_service_with_state(vec![make_task("task-1", "task", TaskStatus::Open)]);

        let bootstrap = service
            .initiate_build_mode(BuildModeStartInput {
                runtime_kind: AgentRuntimeKind::opencode(),
                prerequisites: make_build_prerequisites(),
                prepared_worktree: PreparedBuildWorktree {
                    worktree_dir: PathBuf::from("/tmp/worktrees/task-1"),
                },
                runtime_summary: make_runtime_summary(
                    AgentRuntimeKind::opencode(),
                    RuntimeRoute::LocalHttp {
                        endpoint: "http://127.0.0.1".to_string(),
                    },
                    builtin_opencode_runtime_descriptor(),
                ),
                task_id: "task-1",
            })
            .expect("local_http routes should remain bootstrap-compatible without explicit ports");

        assert!(matches!(
            bootstrap.runtime_route,
            RuntimeRoute::LocalHttp { ref endpoint } if endpoint == "http://127.0.0.1"
        ));
        assert_eq!(bootstrap.working_directory, "/tmp/worktrees/task-1");
        let updated_patches = &task_state
            .lock()
            .expect("task store lock poisoned")
            .updated_patches;
        assert_eq!(updated_patches.len(), 1);
        assert_eq!(updated_patches[0].0, "task-1");
        assert_eq!(updated_patches[0].1.status, Some(TaskStatus::InProgress));
    }

    #[test]
    fn initiate_build_mode_accepts_stdio_routes_for_non_opencode_runtimes() {
        let runtime_registry = AppRuntimeRegistry::new(
            vec![Arc::new(TestRuntimeAdapter)],
            host_domain::AgentRuntimeKind::from("test-runtime"),
        )
        .expect("test runtime registry");
        let (service, task_state, _git_state) = build_service_with_runtime_registry(
            vec![make_task("task-1", "task", TaskStatus::Open)],
            runtime_registry,
        );

        let bootstrap = service
            .initiate_build_mode(BuildModeStartInput {
                runtime_kind: host_domain::AgentRuntimeKind::from("test-runtime"),
                prerequisites: make_build_prerequisites(),
                prepared_worktree: PreparedBuildWorktree {
                    worktree_dir: PathBuf::from("/tmp/worktrees/task-1"),
                },
                runtime_summary: make_runtime_summary(
                    host_domain::AgentRuntimeKind::from("test-runtime"),
                    RuntimeRoute::stdio("runtime-stdio").expect("stdio route"),
                    test_runtime_definition().descriptor().clone(),
                ),
                task_id: "task-1",
            })
            .expect("non-OpenCode runtimes should accept stdio build bootstrap routes");

        assert!(matches!(bootstrap.runtime_route, RuntimeRoute::Stdio { .. }));
        let updated_patches = &task_state
            .lock()
            .expect("task store lock poisoned")
            .updated_patches;
        assert_eq!(updated_patches.len(), 1);
        assert_eq!(updated_patches[0].1.status, Some(TaskStatus::InProgress));
    }
}

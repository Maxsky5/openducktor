mod registry;
mod startup;

use super::AppService;
use anyhow::{anyhow, Result};
use host_domain::{
    AgentRuntimeKind, RunSummary, RuntimeDescriptor, RuntimeInstanceSummary, RuntimeRole,
};
use std::collections::HashSet;
use std::process::Child;

#[derive(Clone, Copy)]
pub(super) struct RuntimeExistingLookup<'a> {
    repo_key: &'a str,
    role: RuntimeRole,
    task_id: Option<&'a str>,
}

pub(super) struct RuntimePostStartPolicy<'a> {
    existing_lookup: RuntimeExistingLookup<'a>,
    prune_error_context: String,
}

pub(super) struct RuntimeStartInput<'a> {
    runtime_kind: AgentRuntimeKind,
    startup_scope: &'a str,
    repo_path: &'a str,
    repo_key: String,
    task_id: &'a str,
    role: RuntimeRole,
    startup_policy: super::OpencodeStartupReadinessPolicy,
    working_directory: String,
    cleanup_target: Option<super::RuntimeCleanupTarget>,
    tracking_error_context: &'static str,
    startup_error_context: String,
    post_start_policy: Option<RuntimePostStartPolicy<'a>>,
}

pub(super) struct SpawnedRuntimeServer {
    runtime_id: String,
    port: u16,
    child: Child,
    opencode_process_guard: super::TrackedOpencodeProcessGuard,
}

impl AppService {
    pub(super) fn ensure_runtime_supports_all_workflow_scopes(
        runtime_kind: AgentRuntimeKind,
    ) -> Result<()> {
        let descriptor = runtime_kind.descriptor();
        let validation_errors = descriptor.validate_for_openducktor();
        if validation_errors.is_empty() {
            return Ok(());
        }

        Err(anyhow!(
            "Runtime '{}' is incompatible with OpenDucktor: {}.",
            runtime_kind.as_str(),
            validation_errors.join("; "),
        ))
    }

    pub fn runtime_definitions_list(&self) -> Result<Vec<RuntimeDescriptor>> {
        let definitions = vec![AgentRuntimeKind::Opencode.descriptor()];
        for definition in &definitions {
            let validation_errors = definition.validate_for_openducktor();
            if !validation_errors.is_empty() {
                return Err(anyhow!(
                    "Runtime '{}' is incompatible with OpenDucktor: {}.",
                    definition.kind.as_str(),
                    validation_errors.join("; "),
                ));
            }
        }

        Ok(definitions)
    }

    pub fn runtime_list(
        &self,
        runtime_kind: &str,
        repo_path: Option<&str>,
    ) -> Result<Vec<RuntimeInstanceSummary>> {
        let supported_kind = Self::resolve_supported_runtime_kind(runtime_kind)?;
        Ok(self
            .list_registered_runtimes(repo_path)?
            .into_iter()
            .filter(|runtime| runtime.kind == supported_kind)
            .collect())
    }

    pub fn runtime_ensure(
        &self,
        runtime_kind: &str,
        repo_path: &str,
    ) -> Result<RuntimeInstanceSummary> {
        let runtime_kind = Self::resolve_supported_runtime_kind(runtime_kind)?;
        Self::ensure_runtime_supports_all_workflow_scopes(runtime_kind)?;
        self.ensure_workspace_runtime(runtime_kind, repo_path)
    }

    pub fn runtime_stop(&self, runtime_id: &str) -> Result<bool> {
        self.stop_registered_runtime(runtime_id)
    }

    pub fn runs_list(&self, repo_path: Option<&str>) -> Result<Vec<RunSummary>> {
        let repo_key_filter = repo_path
            .map(|path| self.resolve_authorized_repo_path(path))
            .transpose()?;
        let allowlisted_repo_keys = if repo_key_filter.is_none() && self.enforce_repo_allowlist {
            Some(
                self.config_store
                    .list_workspaces()?
                    .into_iter()
                    .map(|workspace| workspace.path)
                    .collect::<HashSet<_>>(),
            )
        } else {
            None
        };
        let runs = self
            .runs
            .lock()
            .map_err(|_| anyhow!("Run state lock poisoned"))?;

        let mut list = runs
            .values()
            .filter(|run| {
                if let Some(path_key) = repo_key_filter.as_deref() {
                    Self::repo_key(run.repo_path.as_str()) == path_key
                } else if let Some(allowlist) = allowlisted_repo_keys.as_ref() {
                    let run_repo_key = Self::repo_key(run.repo_path.as_str());
                    allowlist.contains(&run_repo_key)
                } else {
                    true
                }
            })
            .map(|run| run.summary.clone())
            .collect::<Vec<_>>();

        list.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        Ok(list)
    }

    fn ensure_workspace_runtime(
        &self,
        runtime_kind: AgentRuntimeKind,
        repo_path: &str,
    ) -> Result<RuntimeInstanceSummary> {
        let repo_key = self.resolve_authorized_repo_path(repo_path)?;
        let repo_path = repo_key.as_str();

        {
            let mut runtimes = self
                .agent_runtimes
                .lock()
                .map_err(|_| anyhow!("Agent runtime state lock poisoned"))?;
            Self::prune_stale_runtimes(&mut runtimes)?;

            if let Some(existing) = Self::find_existing_runtime(
                &runtimes,
                RuntimeExistingLookup {
                    repo_key: repo_key.as_str(),
                    role: Self::WORKSPACE_RUNTIME_ROLE,
                    task_id: None,
                },
            ) {
                return Ok(existing);
            }
        }

        let startup_error_context = format!(
            "{} workspace runtime failed to start for {repo_path}",
            runtime_kind.as_str()
        );
        let startup_policy = self.resolve_runtime_startup_policy(
            "workspace_runtime",
            repo_path,
            Self::WORKSPACE_RUNTIME_TASK_ID,
            Self::WORKSPACE_RUNTIME_ROLE,
            startup_error_context.as_str(),
        )?;

        self.spawn_and_register_runtime(RuntimeStartInput {
            runtime_kind,
            startup_scope: "workspace_runtime",
            repo_path,
            repo_key: repo_key.clone(),
            task_id: Self::WORKSPACE_RUNTIME_TASK_ID,
            role: Self::WORKSPACE_RUNTIME_ROLE,
            startup_policy,
            working_directory: repo_key.clone(),
            cleanup_target: None,
            tracking_error_context: "Failed tracking spawned OpenCode workspace runtime",
            startup_error_context,
            post_start_policy: Some(RuntimePostStartPolicy {
                existing_lookup: RuntimeExistingLookup {
                    repo_key: repo_key.as_str(),
                    role: Self::WORKSPACE_RUNTIME_ROLE,
                    task_id: None,
                },
                prune_error_context: format!(
                    "Failed pruning stale runtimes while finalizing workspace runtime for {repo_path}"
                ),
            }),
        })
    }

    fn spawn_and_register_runtime(
        &self,
        input: RuntimeStartInput<'_>,
    ) -> Result<RuntimeInstanceSummary> {
        let spawned_server = self.spawn_runtime_server(&input)?;
        self.attach_runtime_session(input, spawned_server)
    }

    pub(super) fn resolve_supported_runtime_kind(runtime_kind: &str) -> Result<AgentRuntimeKind> {
        match runtime_kind.trim() {
            "opencode" => Ok(AgentRuntimeKind::Opencode),
            other => Err(anyhow!("Unsupported agent runtime kind: {other}")),
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::app_service::test_support::build_service_with_state;

    #[test]
    fn module_runs_list_is_empty_on_fresh_service() {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);

        let runs = service
            .runs_list(None)
            .expect("runs list should be available");

        assert!(runs.is_empty());
    }

    #[test]
    fn module_runtime_stop_reports_missing_runtime() {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);

        let error = service
            .runtime_stop("missing-runtime")
            .expect_err("stopping unknown runtime should fail");

        assert!(error
            .to_string()
            .contains("Runtime not found: missing-runtime"));
    }

    #[test]
    fn module_shutdown_succeeds_when_no_processes_are_running() {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        service
            .shutdown()
            .expect("shutdown should be idempotent for empty state");
    }
}

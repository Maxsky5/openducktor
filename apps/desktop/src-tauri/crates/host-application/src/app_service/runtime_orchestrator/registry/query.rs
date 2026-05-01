use super::super::super::{AgentRuntimeProcess, AppService};
use super::super::start_pipeline::RuntimeExistingLookup;
use anyhow::{anyhow, Result};
use host_domain::RuntimeInstanceSummary;
use std::collections::{HashMap, HashSet};

impl AppService {
    pub(in crate::app_service::runtime_orchestrator) fn list_registered_runtimes(
        &self,
        repo_path: Option<&str>,
    ) -> Result<Vec<RuntimeInstanceSummary>> {
        let repo_key_filter = repo_path
            .map(|path| self.resolve_authorized_repo_path(path))
            .transpose()?;
        let allowlisted_repo_keys: Option<HashSet<String>> =
            if repo_key_filter.is_none() && self.enforce_repo_allowlist {
                Some(
                    self.config_store
                        .list_workspaces()?
                        .into_iter()
                        .map(|workspace| Self::repo_key(workspace.repo_path.as_str()))
                        .collect::<HashSet<_>>(),
                )
            } else {
                None
            };
        let mut runtimes = self
            .agent_runtimes
            .lock()
            .map_err(|_| anyhow!("Agent runtime state lock poisoned"))?;
        self.prune_stale_runtimes(&mut runtimes)?;

        let mut list = runtimes
            .values()
            .filter(|runtime| {
                if let Some(path_key) = repo_key_filter.as_deref() {
                    Self::repo_key(runtime.summary.repo_path.as_str()) == path_key
                } else if let Some(allowlist) = allowlisted_repo_keys.as_ref() {
                    let runtime_repo_key = Self::repo_key(runtime.summary.repo_path.as_str());
                    allowlist.contains(&runtime_repo_key)
                } else {
                    true
                }
            })
            .map(|runtime| runtime.summary.clone())
            .collect::<Vec<_>>();

        list.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        Ok(list)
    }

    pub(in crate::app_service::runtime_orchestrator) fn find_existing_runtime(
        runtimes: &HashMap<String, AgentRuntimeProcess>,
        lookup: RuntimeExistingLookup<'_>,
    ) -> Option<RuntimeInstanceSummary> {
        runtimes
            .values()
            .find(|runtime| {
                runtime.summary.repo_path == lookup.repo_key
                    && runtime.summary.kind == *lookup.runtime_kind
                    && runtime.summary.role == lookup.role
                    && lookup
                        .task_id
                        .is_none_or(|task_id| runtime.summary.task_id.as_deref() == Some(task_id))
            })
            .map(|runtime| runtime.summary.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::{AgentRuntimeProcess, AppService, RuntimeExistingLookup};
    use host_domain::{
        builtin_runtime_registry, AgentRuntimeKind, RuntimeInstanceSummary, RuntimeRole,
        RuntimeRoute,
    };
    use std::collections::HashMap;

    fn runtime_summary(
        runtime_id: &str,
        runtime_kind: AgentRuntimeKind,
        repo_path: &str,
    ) -> RuntimeInstanceSummary {
        let descriptor = builtin_runtime_registry()
            .definition_by_str("opencode")
            .expect("opencode runtime should exist")
            .descriptor()
            .clone();

        RuntimeInstanceSummary {
            kind: runtime_kind,
            runtime_id: runtime_id.to_string(),
            repo_path: repo_path.to_string(),
            task_id: None,
            role: RuntimeRole::Workspace,
            working_directory: repo_path.to_string(),
            runtime_route: RuntimeRoute::LocalHttp {
                endpoint: format!("http://127.0.0.1/{runtime_id}"),
            },
            started_at: "2026-02-22T08:00:00.000Z".to_string(),
            descriptor,
        }
    }

    fn runtime_process(summary: RuntimeInstanceSummary) -> AgentRuntimeProcess {
        AgentRuntimeProcess {
            summary,
            child: None,
            _runtime_process_guard: None,
            cleanup_target: None,
        }
    }

    #[test]
    fn find_existing_runtime_matches_repo_role_task_and_runtime_kind() {
        let repo_path = "/tmp/repo";
        let opencode = AgentRuntimeKind::opencode();
        let codex = AgentRuntimeKind::new("codex");
        let mut runtimes = HashMap::new();
        runtimes.insert(
            "runtime-codex".to_string(),
            runtime_process(runtime_summary("runtime-codex", codex.clone(), repo_path)),
        );
        runtimes.insert(
            "runtime-opencode".to_string(),
            runtime_process(runtime_summary(
                "runtime-opencode",
                opencode.clone(),
                repo_path,
            )),
        );

        let found = AppService::find_existing_runtime(
            &runtimes,
            RuntimeExistingLookup {
                repo_key: repo_path,
                runtime_kind: &opencode,
                role: RuntimeRole::Workspace,
                task_id: None,
            },
        )
        .expect("opencode runtime should be found");

        assert_eq!(found.runtime_id, "runtime-opencode");
        assert_eq!(found.kind, opencode);
    }

    #[test]
    fn find_existing_runtime_does_not_match_another_runtime_kind() {
        let repo_path = "/tmp/repo";
        let opencode = AgentRuntimeKind::opencode();
        let codex = AgentRuntimeKind::new("codex");
        let mut runtimes = HashMap::new();
        runtimes.insert(
            "runtime-codex".to_string(),
            runtime_process(runtime_summary("runtime-codex", codex, repo_path)),
        );

        let found = AppService::find_existing_runtime(
            &runtimes,
            RuntimeExistingLookup {
                repo_key: repo_path,
                runtime_kind: &opencode,
                role: RuntimeRole::Workspace,
                task_id: None,
            },
        );

        assert!(found.is_none());
    }
}

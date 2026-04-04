use super::super::super::{AgentRuntimeProcess, AppService};
use super::super::RuntimeExistingLookup;
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
                    && runtime.summary.role == lookup.role
                    && lookup
                        .task_id
                        .is_none_or(|task_id| runtime.summary.task_id.as_deref() == Some(task_id))
            })
            .map(|runtime| runtime.summary.clone())
    }
}

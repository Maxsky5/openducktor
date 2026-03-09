use super::super::{qa_worktree::prepare_qa_worktree, AppService, RuntimeCleanupTarget};
use super::{RuntimeExistingLookup, RuntimePrerequisiteResolution, RuntimePrerequisites};
use anyhow::{anyhow, Result};
use host_domain::{AgentRuntimeRole, RuntimeInstanceSummary, RuntimeRole};
use std::path::Path;

impl AppService {
    pub(super) fn resolve_existing_runtime_for_start(
        &self,
        repo_key: &str,
        role: RuntimeRole,
        task_id: &str,
    ) -> Result<Option<RuntimeInstanceSummary>> {
        let mut runtimes = self
            .agent_runtimes
            .lock()
            .map_err(|_| anyhow!("Agent runtime state lock poisoned"))?;
        Self::prune_stale_runtimes(&mut runtimes)?;

        Ok(Self::find_existing_runtime(
            &runtimes,
            RuntimeExistingLookup {
                repo_key,
                role,
                task_id: Some(task_id),
            },
        ))
    }

    pub(super) fn resolve_runtime_prerequisites(
        &self,
        repo_key: &str,
        task_id: &str,
        role: AgentRuntimeRole,
    ) -> Result<RuntimePrerequisiteResolution> {
        let tasks = self.task_store.list_tasks(Path::new(repo_key))?;
        let task = tasks
            .iter()
            .find(|entry| entry.id == task_id)
            .ok_or_else(|| anyhow!("Task not found: {task_id}"))?;

        {
            let mut runtimes = self
                .agent_runtimes
                .lock()
                .map_err(|_| anyhow!("Agent runtime state lock poisoned"))?;
            Self::prune_stale_runtimes(&mut runtimes)?;

            if let Some(existing) = Self::find_existing_runtime(
                &runtimes,
                RuntimeExistingLookup {
                    repo_key,
                    role: role.into(),
                    task_id: Some(task_id),
                },
            ) {
                return Ok(RuntimePrerequisiteResolution::Existing(existing));
            }
        }

        let prerequisites = match role {
            AgentRuntimeRole::Qa => {
                let setup = prepare_qa_worktree(
                    repo_key,
                    task_id,
                    task.title.as_str(),
                    &self.config_store,
                )?;
                RuntimePrerequisites {
                    working_directory: setup.worktree_path.clone(),
                    cleanup_target: Some(RuntimeCleanupTarget {
                        repo_path: setup.repo_path,
                        worktree_path: setup.worktree_path,
                    }),
                }
            }
            AgentRuntimeRole::Build | AgentRuntimeRole::Spec | AgentRuntimeRole::Planner => {
                RuntimePrerequisites {
                    working_directory: repo_key.to_string(),
                    cleanup_target: None,
                }
            }
        };

        Ok(RuntimePrerequisiteResolution::Ready(prerequisites))
    }
}

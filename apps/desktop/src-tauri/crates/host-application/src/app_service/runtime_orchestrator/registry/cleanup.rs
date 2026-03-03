use super::super::super::{
    qa_worktree::remove_runtime_worktree, terminate_child_process, AgentRuntimeProcess, AppService,
    RuntimeCleanupTarget,
};
use anyhow::{anyhow, Result};
use std::path::Path;
use std::process::Child;

impl AppService {
    pub(super) fn cleanup_runtime_worktree_if_needed(
        cleanup_target: Option<&RuntimeCleanupTarget>,
    ) -> Result<()> {
        if let Some(cleanup_target) = cleanup_target {
            remove_runtime_worktree(
                Path::new(cleanup_target.repo_path.as_str()),
                Path::new(cleanup_target.worktree_path.as_str()),
            )?;
        }
        Ok(())
    }

    pub(in crate::app_service::runtime_orchestrator) fn cleanup_started_runtime(
        child: &mut Child,
        cleanup_target: Option<&RuntimeCleanupTarget>,
    ) -> Result<()> {
        terminate_child_process(child);
        Self::cleanup_runtime_worktree_if_needed(cleanup_target)
    }

    pub(super) fn cleanup_runtime_process(runtime: &mut AgentRuntimeProcess) -> Result<()> {
        terminate_child_process(&mut runtime.child);
        Self::cleanup_runtime_worktree_if_needed(runtime.cleanup_target.as_ref())
    }

    pub(in crate::app_service::runtime_orchestrator) fn append_cleanup_error(
        base_error: anyhow::Error,
        cleanup_error: anyhow::Error,
    ) -> anyhow::Error {
        anyhow!("{base_error}\nAlso failed to remove QA worktree: {cleanup_error}")
    }
}

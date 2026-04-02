use super::super::super::{
    AgentRuntimeProcess, AppService, RuntimeCleanupTarget, terminate_child_process,
};
use anyhow::{Result, anyhow};
use std::process::Child;

impl AppService {
    pub(super) fn cleanup_runtime_worktree_if_needed(
        cleanup_target: Option<&RuntimeCleanupTarget>,
    ) -> Result<()> {
        let _ = cleanup_target;
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
